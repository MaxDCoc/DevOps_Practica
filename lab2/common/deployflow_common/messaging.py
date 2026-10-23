"""Cola de trabajos (RabbitMQ): publicador con confirmaciones y consumidor con ack manual.

Topología: exchange `pipelines` -> cola `pipeline.jobs` (durable). Lo que se rechaza o agota sus intentos va por el
DLX `pipelines.dlx` a la cola `pipeline.jobs.dead`. Un fallo inesperado con intentos disponibles se vuelve a
encolar en `pipeline.jobs.retry`, que espera su TTL y devuelve el mensaje a `pipelines` (ver retry.py).
"""

import logging
import os
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

import pika
from opentelemetry import trace
from pika.exceptions import AMQPError

from .contract import (
    DEAD_ROUTING_KEY,
    DLX_EXCHANGE,
    ENV_RABBITMQ_URL,
    EXCHANGE,
    HEADER_ATTEMPT,
    QUEUE_DEAD,
    QUEUE_JOBS,
    QUEUE_RETRY,
    RETRY_DELAY_MS,
    ROUTING_KEY,
    SPAN_PUBLISH,
    JobMessage,
)
from .interfaces import PublishError
from .observability import inject_trace_context
from .retry import DEFAULT_MAX_ATTEMPTS, attempt_of, retry_headers

logger = logging.getLogger("messaging")
tracer = trace.get_tracer("deployflow.messaging")

DEFAULT_RABBITMQ_URL = "amqp://deployflow:deployflow@rabbitmq:5672/"


def declare_topology(channel) -> None:
    """Declara exchange, cola principal, DLX, cola de mensajes muertos y cola de reintento. Se puede repetir."""
    channel.exchange_declare(exchange=DLX_EXCHANGE, exchange_type="direct", durable=True)
    channel.queue_declare(queue=QUEUE_DEAD, durable=True)
    channel.queue_bind(queue=QUEUE_DEAD, exchange=DLX_EXCHANGE, routing_key=DEAD_ROUTING_KEY)
    channel.exchange_declare(exchange=EXCHANGE, exchange_type="direct", durable=True)
    channel.queue_declare(
        queue=QUEUE_JOBS,
        durable=True,
        arguments={"x-dead-letter-exchange": DLX_EXCHANGE, "x-dead-letter-routing-key": DEAD_ROUTING_KEY},
    )
    channel.queue_bind(queue=QUEUE_JOBS, exchange=EXCHANGE, routing_key=ROUTING_KEY)
    # Los argumentos de una cola no se pueden cambiar una vez creada (el broker rechaza el declare con otros):
    # por eso la demora es una constante del contrato y no una variable de entorno.
    channel.queue_declare(
        queue=QUEUE_RETRY,
        durable=True,
        arguments={
            "x-message-ttl": RETRY_DELAY_MS,
            # Al vencer, el mensaje vuelve a la cola de trabajos por el mismo exchange que usa la API.
            "x-dead-letter-exchange": EXCHANGE,
            "x-dead-letter-routing-key": ROUTING_KEY,
        },
    )


def connect(url: str, *, attempts: int = 5, delay: float = 1.0) -> pika.BlockingConnection:
    """Conecta con reintentos: RabbitMQ acepta conexiones TCP un rato antes de estar listo de verdad."""
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return pika.BlockingConnection(pika.URLParameters(url))
        except (AMQPError, OSError) as exc:
            last_error = exc
            if attempt < attempts:
                time.sleep(delay)
    assert last_error is not None
    raise last_error


def _close_quietly(connection: pika.BlockingConnection | None) -> None:
    try:
        if connection is not None and connection.is_open:
            connection.close()
    except Exception:  # noqa: BLE001 - cerrar una conexión rota no debe tapar el error original
        pass


class RabbitPublisher:
    """Implementa interfaces.Publisher. Seguro entre hilos: la API publica desde el threadpool de FastAPI."""

    def __init__(self, url: str, *, connect_attempts: int = 5, retry_delay: float = 1.0):
        self._url = url
        self._connect_attempts = connect_attempts
        self._retry_delay = retry_delay
        self._lock = threading.RLock()
        self._connection: pika.BlockingConnection | None = None
        self._channel = None

    @classmethod
    def from_env(cls) -> "RabbitPublisher":
        return cls(os.environ.get(ENV_RABBITMQ_URL, DEFAULT_RABBITMQ_URL))

    def _ready_channel(self):
        if self._channel is not None and self._channel.is_open:
            return self._channel
        self._reset()
        self._connection = connect(self._url, attempts=self._connect_attempts, delay=self._retry_delay)
        self._channel = self._connection.channel()
        self._channel.confirm_delivery()  # basic_publish espera la confirmación del broker
        declare_topology(self._channel)
        return self._channel

    def _reset(self) -> None:
        _close_quietly(self._connection)
        self._connection = None
        self._channel = None

    def publish_job(self, message: JobMessage) -> None:
        body = message.model_dump_json().encode()
        attributes = {
            "messaging.system": "rabbitmq",
            "messaging.destination.name": EXCHANGE,
            "messaging.rabbitmq.destination.routing_key": ROUTING_KEY,
            "messaging.message.id": message.job_id,
        }
        with tracer.start_as_current_span(SPAN_PUBLISH, kind=trace.SpanKind.PRODUCER, attributes=attributes):
            # Dentro del span: el traceparent que viaja es el del span de publicación.
            headers = inject_trace_context({HEADER_ATTEMPT: 1})
            properties = pika.BasicProperties(
                content_type="application/json",
                delivery_mode=2,  # persistente
                message_id=message.job_id,
                headers=headers,
            )
            last_error: Exception | None = None
            with self._lock:
                for _ in range(2):  # un reintento: la conexión pudo haberse perdido sin que nos enteráramos
                    try:
                        self._ready_channel().basic_publish(
                            exchange=EXCHANGE,
                            routing_key=ROUTING_KEY,
                            body=body,
                            properties=properties,
                            mandatory=True,  # sin cola enlazada, el broker lo devuelve y pika lo reporta
                        )
                        return
                    except (AMQPError, OSError) as exc:
                        last_error = exc
                        self._reset()
            raise PublishError(f"no se pudo publicar el job {message.job_id}: {last_error!r}") from last_error

    def queue_depth(self) -> int:
        with self._lock:
            try:
                return self._ready_channel().queue_declare(queue=QUEUE_JOBS, passive=True).method.message_count
            except (AMQPError, OSError) as exc:
                self._reset()
                raise PublishError(f"no se pudo consultar la cola: {exc!r}") from exc

    def close(self) -> None:
        with self._lock:
            self._reset()


@dataclass(frozen=True)
class Delivery:
    """Un trabajo entregado por la cola, con lo que el worker necesita para procesarlo."""

    message: JobMessage
    headers: Mapping[str, Any]  # incluye el traceparent para continuar la traza
    redelivered: bool  # True si un worker anterior lo tomó y murió sin confirmarlo
    sleep: Callable[[float], None]  # duerme sin cortar los heartbeats de la conexión con RabbitMQ
    attempt: int = 1  # 1 la primera vez; sube con cada vuelta por la cola de reintento
    max_attempts: int = DEFAULT_MAX_ATTEMPTS  # intentos totales permitidos, el primero incluido

    @property
    def last_attempt(self) -> bool:
        """Si este intento falla, el mensaje ya no vuelve a intentarse: va a la cola de muertos."""
        return self.attempt >= self.max_attempts


class Consumer:
    """Consume la cola con ack manual y de a un trabajo por vez (prefetch=1).

    - El handler termina bien -> ack. Lanza una excepción -> si quedan intentos (max_attempts, el primero incluido),
      el mensaje se encola en la cola de reintento con `x-attempt` + 1 y recién después se confirma el original;
      si no quedan, nack sin reencolar (va a la cola de muertos). Si no se puede encolar el reintento, el original
      no se confirma: RabbitMQ lo redelivera y no se pierde.
    - Un mensaje que no es un JobMessage válido va directo a la cola de muertos, sin llamar al handler.
    - Si se pierde la conexión, reconecta. Lo que quedó sin confirmar vuelve a la cola (redelivered=True).
    - stop() deja terminar el trabajo en curso; después run() devuelve.
    """

    def __init__(
        self,
        url: str,
        handler: Callable[[Delivery], None],
        *,
        prefetch: int = 1,
        retry_delay: float = 2.0,
        max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    ):
        if max_attempts < 1:
            raise ValueError(f"max_attempts tiene que ser al menos 1, y llegó {max_attempts}")
        self._url = url
        self._handler = handler
        self._prefetch = prefetch
        self._retry_delay = retry_delay
        self._max_attempts = max_attempts
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                self._consume_until_stopped()
            except (AMQPError, OSError) as exc:
                logger.warning("se perdió la conexión con RabbitMQ (%r); reintento en %s s", exc, self._retry_delay)
                self._stop.wait(self._retry_delay)

    def _consume_until_stopped(self) -> None:
        connection = pika.BlockingConnection(pika.URLParameters(self._url))
        try:
            channel = connection.channel()
            declare_topology(channel)
            channel.basic_qos(prefetch_count=self._prefetch)
            # Canal aparte, con confirmaciones, para encolar los reintentos sin mezclarlos con el consumo.
            retry_channel = connection.channel()
            retry_channel.confirm_delivery()
            # inactivity_timeout hace que el ciclo se despierte seguido: atiende los heartbeats y mira stop().
            for method, properties, body in channel.consume(QUEUE_JOBS, inactivity_timeout=0.5):
                if method is not None:
                    self._deliver(connection, channel, retry_channel, method, properties, body)
                if self._stop.is_set():
                    break
            channel.cancel()  # devuelve a la cola lo que quedó prefetcheado sin procesar
        finally:
            _close_quietly(connection)

    def _deliver(self, connection, channel, retry_channel, method, properties, body) -> None:
        try:
            message = JobMessage.model_validate_json(body)
        except ValueError:
            logger.error("mensaje ilegible: va a la cola de mensajes muertos")
            channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
            return

        headers = dict(properties.headers or {})
        delivery = Delivery(
            message=message,
            headers=headers,
            redelivered=bool(method.redelivered),
            sleep=connection.sleep,
            attempt=attempt_of(headers),
            max_attempts=self._max_attempts,
        )
        try:
            self._handler(delivery)
        except AMQPError:
            raise  # se cayó la conexión: no se puede confirmar, y RabbitMQ lo va a redeliverar
        except Exception:
            if delivery.last_attempt:
                logger.exception(
                    "falló %s en el intento %d de %d: va a la cola de mensajes muertos",
                    message.job_id,
                    delivery.attempt,
                    delivery.max_attempts,
                )
                channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
            else:
                logger.exception(
                    "falló %s en el intento %d de %d: se reintenta en %s s",
                    message.job_id,
                    delivery.attempt,
                    delivery.max_attempts,
                    RETRY_DELAY_MS / 1000,
                )
                # Primero se encola la copia (con confirmación) y después se confirma el original: si la conexión
                # se corta entre una cosa y la otra queda un duplicado, nunca un trabajo perdido.
                self._schedule_retry(retry_channel, message, headers, body)
                channel.basic_ack(delivery_tag=method.delivery_tag)
        else:
            channel.basic_ack(delivery_tag=method.delivery_tag)

    @staticmethod
    def _schedule_retry(retry_channel, message: JobMessage, headers: dict[str, Any], body: bytes) -> None:
        retry_channel.basic_publish(
            exchange="",  # el exchange por defecto entrega directo a la cola que se llama como la routing key
            routing_key=QUEUE_RETRY,
            body=body,
            properties=pika.BasicProperties(
                content_type="application/json",
                delivery_mode=2,  # persistente
                message_id=message.job_id,
                headers=retry_headers(headers),
            ),
            mandatory=True,  # si la cola no existe, el broker lo devuelve y pika levanta un error
        )
