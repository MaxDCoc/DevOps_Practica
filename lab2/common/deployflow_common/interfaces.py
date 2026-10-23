"""Interfaces que une el contrato entre las partes.

P1 (API) y P2 (worker) programan contra estas interfaces; `factory` les da la implementación
real o el doble de prueba según los interruptores STATE_BACKEND y PUBLISHER.
"""

from typing import Protocol, runtime_checkable

from .contract import JobMessage, JobState, StageStatus, StatsCounts
from .transitions import FinalStatus


class PublishError(Exception):
    """No se pudo publicar en la cola (broker caído o sin confirmación). La API responde 503."""


@runtime_checkable
class JobStore(Protocol):
    """Estado de los pipelines. Las operaciones sobre un job inexistente (por ejemplo, vencido
    por TTL) devuelven None en vez de lanzar. Siempre se devuelven copias."""

    def create(self, state: JobState) -> None: ...

    def get(self, job_id: str) -> JobState | None: ...

    def begin_attempt(self, job_id: str) -> JobState | None: ...

    def update_stage(
        self,
        job_id: str,
        stage: str,
        status: StageStatus,
        *,
        error: str | None = None,
        duration_s: float | None = None,
    ) -> JobState | None: ...

    def finish(self, job_id: str, status: FinalStatus, *, error: str | None = None) -> JobState | None: ...

    def list_recent(self, limit: int = 20) -> list[JobState]:
        """Los más recientes primero, según submitted_at."""
        ...

    def counts(self) -> StatsCounts: ...

    def heartbeat(self, worker_id: str) -> None: ...

    def live_workers(self) -> int: ...


@runtime_checkable
class Publisher(Protocol):
    """Publica trabajos en la cola. La implementación real inyecta el traceparent en los headers."""

    def publish_job(self, message: JobMessage) -> None:
        """Lanza PublishError si el broker no confirma."""
        ...

    def queue_depth(self) -> int:
        """Mensajes esperando en la cola principal."""
        ...

    def close(self) -> None: ...
