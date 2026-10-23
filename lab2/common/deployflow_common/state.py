"""Estado de los pipelines en Redis. Lo implementa P2.

Hasta entonces falla fuerte: elegir STATE_BACKEND=redis antes de que P2 entregue no debe caer
en silencio en el almacén en memoria. Con STATE_BACKEND=memory no se importa este módulo.

RedisJobStore tiene que pasar la suite de tests/store_contract.py (JobStoreContract) y puede
reusar las reglas de transitions.py: la persistencia cambia, las transiciones no.
"""

from .contract import JobState, StageStatus, StatsCounts
from .transitions import FinalStatus

_PENDIENTE = "Lo implementa P2 (lab2/PLAN.md, Fase 1)"


class RedisJobStore:
    """Implementa interfaces.JobStore sobre Redis (claves y TTL en contract.py)."""

    @classmethod
    def from_env(cls) -> "RedisJobStore":
        raise NotImplementedError(_PENDIENTE)

    def create(self, state: JobState) -> None:
        raise NotImplementedError(_PENDIENTE)

    def get(self, job_id: str) -> JobState | None:
        raise NotImplementedError(_PENDIENTE)

    def begin_attempt(self, job_id: str) -> JobState | None:
        raise NotImplementedError(_PENDIENTE)

    def update_stage(
        self,
        job_id: str,
        stage: str,
        status: StageStatus,
        *,
        error: str | None = None,
        duration_s: float | None = None,
    ) -> JobState | None:
        raise NotImplementedError(_PENDIENTE)

    def finish(self, job_id: str, status: FinalStatus, *, error: str | None = None) -> JobState | None:
        raise NotImplementedError(_PENDIENTE)

    def list_recent(self, limit: int = 20) -> list[JobState]:
        raise NotImplementedError(_PENDIENTE)

    def counts(self) -> StatsCounts:
        raise NotImplementedError(_PENDIENTE)

    def heartbeat(self, worker_id: str) -> None:
        raise NotImplementedError(_PENDIENTE)

    def live_workers(self) -> int:
        raise NotImplementedError(_PENDIENTE)
