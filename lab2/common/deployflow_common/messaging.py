"""Cola de trabajos (RabbitMQ). Lo implementa P2.

Hasta entonces falla fuerte: elegir PUBLISHER=rabbit antes de que P2 entregue no debe caer
en silencio en un doble de prueba. Con PUBLISHER=fake no se importa este módulo.
"""

from collections.abc import Callable
from typing import Any

from .contract import JobMessage

_PENDIENTE = "Lo implementa P2 (lab2/PLAN.md, Fase 1)"


def declare_topology(channel: Any) -> None:
    """Declara exchange, cola principal, DLX y cola de mensajes muertos. Idempotente."""
    raise NotImplementedError(_PENDIENTE)


class RabbitPublisher:
    """Implementa interfaces.Publisher: confirmaciones del broker y traceparent en los headers."""

    @classmethod
    def from_env(cls) -> "RabbitPublisher":
        raise NotImplementedError(_PENDIENTE)

    def publish_job(self, message: JobMessage) -> None:
        raise NotImplementedError(_PENDIENTE)

    def queue_depth(self) -> int:
        raise NotImplementedError(_PENDIENTE)

    def close(self) -> None:
        raise NotImplementedError(_PENDIENTE)


def consume(handler: Callable[[JobMessage], None], *, prefetch: int = 1) -> None:
    """Consume la cola con ack manual: el mensaje se confirma recién cuando el handler termina."""
    raise NotImplementedError(_PENDIENTE)
