"""La cola contra un RabbitMQ real (docker compose up -d rabbitmq). Se saltea sola si no está levantado.

Usa las colas reales del contrato: correrla con la infraestructura sola, sin ningún worker consumiendo.
"""

import json
import threading
import time
from contextlib import contextmanager

import pika
import pytest
from pika.exceptions import AMQPConnectionError
from store_contract import T0

from deployflow_common import messaging
from deployflow_common.contract import (
    EXCHANGE,
    QUEUE_DEAD,
    QUEUE_JOBS,
    QUEUE_RETRY,
    ROUTING_KEY,
    PipelineRequest,
    build_job_message,
)
from deployflow_common.interfaces import Publisher, PublishError
from deployflow_common.messaging import Consumer, RabbitPublisher, declare_topology

URL = "amqp://deployflow:deployflow@localhost:5672/"


def message(job_id: str = "job-1"):
    return build_job_message(job_id, PipelineRequest(project="shop-frontend"), T0)


@pytest.fixture(scope="module")
def rabbit():
    try:
        connection = pika.BlockingConnection(pika.URLParameters(URL))
    except AMQPConnectionError:
        pytest.skip("RabbitMQ no está disponible: docker compose up -d rabbitmq")
    channel = connection.channel()
    declare_topology(channel)
    yield channel
    connection.close()


@pytest.fixture(autouse=True)
def empty_queues(rabbit):
    # Primero la de reintento: lo que quedó esperando ahí vencería y volvería a la cola principal.
    rabbit.queue_purge(QUEUE_RETRY)
    rabbit.queue_purge(QUEUE_JOBS)
    rabbit.queue_purge(QUEUE_DEAD)


@pytest.fixture
def publisher():
    publisher = RabbitPublisher(URL)
    yield publisher
    publisher.close()


def ready(rabbit, queue: str = QUEUE_JOBS) -> int:
    return rabbit.queue_declare(queue=queue, passive=True).method.message_count


def wait_until(condition, timeout: float = 10.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.05)
    return False


@contextmanager
def running(consumer: Consumer):
    thread = threading.Thread(target=consumer.run, daemon=True)
    thread.start()
    try:
        yield
    finally:
        consumer.stop()
        thread.join(timeout=10)
        assert not thread.is_alive(), "el consumidor no se detuvo"


def test_the_topology_can_be_declared_again_without_errors(rabbit):
    declare_topology(rabbit)
    declare_topology(rabbit)


def test_the_real_publisher_satisfies_the_shared_interface():
    assert isinstance(RabbitPublisher(URL), Publisher)


def test_a_published_job_arrives_persistent_with_its_id_and_its_attempt_header(publisher, rabbit):
    job = message("job-1")

    publisher.publish_job(job)

    method, properties, body = rabbit.basic_get(QUEUE_JOBS, auto_ack=True)
    assert method is not None
    assert json.loads(body) == json.loads(job.model_dump_json())
    assert properties.delivery_mode == 2
    assert properties.content_type == "application/json"
    assert properties.message_id == "job-1"
    assert properties.headers["x-attempt"] == 1


def test_the_trace_context_is_injected_into_the_message_headers(monkeypatch, publisher, rabbit):
    traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    monkeypatch.setattr(messaging, "inject_trace_context", lambda headers: {**headers, "traceparent": traceparent})

    publisher.publish_job(message())

    _, properties, _ = rabbit.basic_get(QUEUE_JOBS, auto_ack=True)
    assert properties.headers["traceparent"] == traceparent


def test_queue_depth_counts_the_jobs_waiting(publisher, rabbit):
    for number in range(3):
        publisher.publish_job(message(f"job-{number}"))
    assert publisher.queue_depth() == 3

    rabbit.basic_get(QUEUE_JOBS, auto_ack=True)

    assert publisher.queue_depth() == 2


def test_the_publisher_reconnects_by_itself_after_closing_its_connection(publisher, rabbit):
    publisher.publish_job(message("job-1"))
    publisher.close()

    publisher.publish_job(message("job-2"))

    assert ready(rabbit) == 2


def test_if_the_queue_disappears_the_publisher_recreates_it_and_still_delivers(publisher, rabbit):
    publisher.publish_job(message("job-1"))
    rabbit.queue_delete(QUEUE_JOBS)

    publisher.publish_job(message("job-2"))

    _, _, body = rabbit.basic_get(QUEUE_JOBS, auto_ack=True)
    assert json.loads(body)["job_id"] == "job-2"


def test_without_a_reachable_broker_publishing_and_asking_the_depth_raise_publish_error():
    publisher = RabbitPublisher("amqp://deployflow:deployflow@localhost:1/", connect_attempts=1, retry_delay=0)

    with pytest.raises(PublishError):
        publisher.publish_job(message())
    with pytest.raises(PublishError):
        publisher.queue_depth()


def test_the_consumer_hands_over_each_job_and_acks_it(publisher, rabbit):
    publisher.publish_job(message("job-1"))
    publisher.publish_job(message("job-2"))
    seen = []

    with running(Consumer(URL, lambda delivery: seen.append(delivery.message.job_id), retry_delay=0.2)):
        assert wait_until(lambda: len(seen) == 2)

    # Si no se hubieran confirmado, al cerrarse la conexión volverían a la cola.
    assert seen == ["job-1", "job-2"]
    assert ready(rabbit) == 0
    assert ready(rabbit, QUEUE_DEAD) == 0


def failing(delivery):
    raise RuntimeError("falló el handler")


def publish_raw(rabbit, job_id: str = "job-1", headers: dict | None = None) -> None:
    """Publica como lo haría otro productor: sin pasar por RabbitPublisher, con los headers que se le den."""
    rabbit.basic_publish(
        exchange=EXCHANGE,
        routing_key=ROUTING_KEY,
        body=message(job_id).model_dump_json().encode(),
        properties=pika.BasicProperties(delivery_mode=2, message_id=job_id, headers=headers),
    )


def test_with_a_single_attempt_allowed_a_handler_error_goes_straight_to_the_dead_letter_queue(publisher, rabbit):
    publisher.publish_job(message("job-1"))

    with running(Consumer(URL, failing, retry_delay=0.2, max_attempts=1)):
        assert wait_until(lambda: ready(rabbit, QUEUE_DEAD) == 1)

    assert ready(rabbit) == 0
    assert ready(rabbit, QUEUE_RETRY) == 0


def test_the_retry_queue_exists_waits_five_seconds_and_returns_messages_to_the_jobs_queue_through_the_exchange(rabbit):
    # Si la cola no existe, el passive falla; si sus argumentos difieren de los esperados, RabbitMQ rechaza el declare.
    # Va en otra conexión porque un rechazo cierra el canal.
    connection = pika.BlockingConnection(pika.URLParameters(URL))
    try:
        channel = connection.channel()
        channel.queue_declare(queue=QUEUE_RETRY, passive=True)
        channel.queue_declare(
            queue=QUEUE_RETRY,
            durable=True,
            arguments={"x-message-ttl": 5000, "x-dead-letter-exchange": EXCHANGE, "x-dead-letter-routing-key": ROUTING_KEY},
        )
    finally:
        connection.close()


def test_a_failing_job_goes_to_the_retry_queue_as_the_next_attempt_keeping_its_trace(monkeypatch, publisher, rabbit):
    traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    monkeypatch.setattr(messaging, "inject_trace_context", lambda headers: {**headers, "traceparent": traceparent})
    job = message("job-1")
    publisher.publish_job(job)

    with running(Consumer(URL, failing, retry_delay=0.2, max_attempts=3)):
        assert wait_until(lambda: ready(rabbit, QUEUE_RETRY) == 1)

    # El original se confirmó (no queda en la cola principal ni en la de muertos) y la copia espera su turno.
    assert ready(rabbit) == 0
    assert ready(rabbit, QUEUE_DEAD) == 0
    method, properties, body = rabbit.basic_get(QUEUE_RETRY, auto_ack=True)
    assert json.loads(body) == json.loads(job.model_dump_json())
    assert properties.message_id == "job-1"
    assert properties.delivery_mode == 2
    assert properties.content_type == "application/json"
    assert properties.headers["x-attempt"] == 2
    assert properties.headers["traceparent"] == traceparent
    assert "x-death" not in properties.headers


def test_a_message_that_comes_without_the_attempt_header_counts_as_the_first_attempt(rabbit):
    publish_raw(rabbit, headers=None)

    with running(Consumer(URL, failing, retry_delay=0.2, max_attempts=3)):
        assert wait_until(lambda: ready(rabbit, QUEUE_RETRY) == 1)

    _, properties, _ = rabbit.basic_get(QUEUE_RETRY, auto_ack=True)
    assert properties.headers["x-attempt"] == 2


def test_when_the_attempts_run_out_the_message_goes_to_the_dead_letter_queue_not_to_the_retry_queue(rabbit):
    publish_raw(rabbit, headers={"x-attempt": 3})

    with running(Consumer(URL, failing, retry_delay=0.2, max_attempts=3)):
        assert wait_until(lambda: ready(rabbit, QUEUE_DEAD) == 1)

    assert ready(rabbit) == 0
    assert ready(rabbit, QUEUE_RETRY) == 0


def test_the_handler_is_told_which_attempt_it_is_and_how_many_there_are(rabbit):
    publish_raw(rabbit, headers={"x-attempt": 2})
    seen = []

    with running(Consumer(URL, seen.append, retry_delay=0.2, max_attempts=4)):
        assert wait_until(lambda: seen)

    assert (seen[0].attempt, seen[0].max_attempts, seen[0].last_attempt) == (2, 4, False)


def test_a_business_outcome_is_never_retried_because_the_handler_returns_normally(publisher, rabbit):
    publisher.publish_job(message("job-1"))
    seen = []

    with running(Consumer(URL, seen.append, retry_delay=0.2, max_attempts=3)):
        assert wait_until(lambda: seen)

    assert ready(rabbit, QUEUE_RETRY) == 0
    assert ready(rabbit, QUEUE_DEAD) == 0


def test_a_job_that_fails_twice_comes_back_each_time_after_the_delay_and_the_third_attempt_can_succeed(publisher, rabbit):
    # Dos vueltas completas por la cola de reintento (unos 10 s): confirma que el mensaje no se pierde ni se corta
    # el ciclo la segunda vez que pasa por ahí, y que la demora es la del contrato (5 s) y no otra.
    publisher.publish_job(message("job-1"))
    calls = []

    def flaky(delivery):
        calls.append((delivery.attempt, delivery.redelivered, time.monotonic()))
        if delivery.attempt < 3:
            raise RuntimeError("falló el handler")

    with running(Consumer(URL, flaky, retry_delay=0.2, max_attempts=3)):
        assert wait_until(lambda: len(calls) == 3, timeout=25)

    assert [attempt for attempt, _, _ in calls] == [1, 2, 3]
    assert [redelivered for _, redelivered, _ in calls] == [False, False, False]  # un reintento no es un redelivery
    gaps = [later[2] - earlier[2] for earlier, later in zip(calls, calls[1:])]
    assert all(4.5 <= gap <= 9 for gap in gaps), gaps
    assert (ready(rabbit), ready(rabbit, QUEUE_RETRY), ready(rabbit, QUEUE_DEAD)) == (0, 0, 0)


def test_if_the_retry_cannot_be_scheduled_the_message_is_not_lost_and_is_tried_again(rabbit):
    publish_raw(rabbit, headers={"x-attempt": 1})
    calls = []

    def handler(delivery):
        calls.append(delivery.redelivered)
        if len(calls) == 1:
            # Justo antes de que el consumidor intente encolar el reintento. Con conexión propia: el handler corre
            # en el hilo del consumidor y una BlockingConnection de pika no se comparte entre hilos.
            other = pika.BlockingConnection(pika.URLParameters(URL))
            try:
                other.channel().queue_delete(QUEUE_RETRY)
            finally:
                other.close()
        raise RuntimeError("falló el handler")

    with running(Consumer(URL, handler, retry_delay=0.2, max_attempts=3)):
        # Primero el segundo procesamiento: recién ahí el consumidor ya recreó la cola borrada. Consultar una cola
        # que no existe haría que el broker cierre el canal de prueba.
        assert wait_until(lambda: len(calls) == 2)
        assert wait_until(lambda: ready(rabbit, QUEUE_RETRY) == 1)

    # El primer reintento no pudo encolarse: no se confirmó el original, volvió a la cola y se reprocesó.
    assert calls == [False, True]
    assert ready(rabbit, QUEUE_DEAD) == 0
    _, properties, _ = rabbit.basic_get(QUEUE_RETRY, auto_ack=True)
    assert properties.headers["x-attempt"] == 2


def test_a_malformed_message_goes_straight_to_the_dead_letter_queue_without_calling_the_handler(rabbit):
    rabbit.basic_publish(exchange=EXCHANGE, routing_key=ROUTING_KEY, body=b"esto no es json")
    called = []

    with running(Consumer(URL, called.append, retry_delay=0.2)):
        assert wait_until(lambda: ready(rabbit, QUEUE_DEAD) == 1)

    assert called == []
    assert ready(rabbit) == 0


def test_a_job_left_unacked_by_a_dead_worker_is_redelivered_with_the_flag(publisher):
    publisher.publish_job(message("job-1"))
    doomed = pika.BlockingConnection(pika.URLParameters(URL))
    method, _, _ = doomed.channel().basic_get(QUEUE_JOBS, auto_ack=False)
    assert method is not None
    doomed.close()  # muere sin confirmar: RabbitMQ lo devuelve a la cola
    seen = []

    with running(Consumer(URL, seen.append, retry_delay=0.2)):
        assert wait_until(lambda: seen)

    assert seen[0].message.job_id == "job-1"
    assert seen[0].redelivered is True


def test_a_fresh_job_is_not_flagged_as_redelivered(publisher):
    publisher.publish_job(message("job-1"))
    seen = []

    with running(Consumer(URL, seen.append, retry_delay=0.2)):
        assert wait_until(lambda: seen)

    assert seen[0].redelivered is False


def test_the_delivery_sleep_really_waits(publisher):
    publisher.publish_job(message())
    measured = []

    def handler(delivery):
        started = time.monotonic()
        delivery.sleep(0.3)
        measured.append(time.monotonic() - started)

    with running(Consumer(URL, handler, retry_delay=0.2)):
        assert wait_until(lambda: measured)

    assert measured[0] >= 0.25


def test_a_job_longer_than_the_heartbeat_interval_keeps_its_connection_alive(publisher, rabbit):
    # delivery.sleep atiende los heartbeats mientras duerme. Con time.sleep, RabbitMQ cortaría la conexión
    # a los pocos segundos y el trabajo se redeliveraría solo, corriendo dos veces.
    publisher.publish_job(message("job-1"))
    calls = []

    def handler(delivery):
        calls.append(delivery.redelivered)
        delivery.sleep(6)

    consumer = Consumer(URL + "?heartbeat=2", handler, retry_delay=0.2)
    with running(consumer):
        assert wait_until(lambda: calls)
        time.sleep(7)  # deja pasar el trabajo entero y un margen para que se note un redelivery

    assert calls == [False]
    assert ready(rabbit) == 0


def test_a_busy_consumer_holds_only_one_job_so_other_workers_get_their_share(publisher, rabbit):
    # Con prefetch=1 el consumidor retiene un solo trabajo a la vez: al escalar a varios workers, el resto
    # de la cola queda disponible para los demás en vez de acumularse en uno solo.
    for number in range(3):
        publisher.publish_job(message(f"job-{number}"))
    started, release = threading.Event(), threading.Event()

    def handler(delivery):
        started.set()
        release.wait(10)

    with running(Consumer(URL, handler, retry_delay=0.2)):
        assert started.wait(10)
        assert wait_until(lambda: ready(rabbit) == 2)
        release.set()


def test_stop_lets_the_job_in_progress_finish_and_acks_it(publisher, rabbit):
    publisher.publish_job(message("job-1"))
    started = threading.Event()
    finished = []

    def handler(delivery):
        started.set()
        delivery.sleep(0.6)
        finished.append(delivery.message.job_id)

    consumer = Consumer(URL, handler, retry_delay=0.2)
    with running(consumer):
        assert started.wait(10)
        consumer.stop()  # llega la señal de apagado en medio del job

    assert finished == ["job-1"]
    assert ready(rabbit) == 0
