"""Dobles de prueba que cumplen el mismo contrato que las implementaciones reales.

Son los de los interruptores STATE_BACKEND=memory y PUBLISHER=fake: con ellos cada parte
trabaja y testea sola, sin Redis ni RabbitMQ.
"""

import threading
from collections.abc import Callable
from datetime import datetime, timedelta

from .contract import (
    RECENT_WINDOW,
    WORKER_HEARTBEAT_TTL_S,
    JobMessage,
    JobState,
    StageStatus,
    StatsCounts,
    utcnow,
)
from .interfaces import PublishError
from .transitions import FinalStatus, apply_finish, apply_stage_update, begin_attempt


class InMemoryJobStore:
    """JobStore en memoria. Las reglas de cada transición viven en transitions.py."""

    def __init__(self, clock: Callable[[], datetime] = utcnow):
        self._clock = clock
        self._jobs: dict[str, JobState] = {}
        self._workers: dict[str, datetime] = {}
        self._lock = threading.RLock()

    def create(self, state: JobState) -> None:
        with self._lock:
            self._jobs[state.job_id] = state.model_copy(deep=True)

    def get(self, job_id: str) -> JobState | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return job.model_copy(deep=True) if job else None

    def _transition(self, job_id: str, transition: Callable[[JobState], JobState]) -> JobState | None:
        with self._lock:
            current = self._jobs.get(job_id)
            if current is None:
                return None
            updated = transition(current)
            self._jobs[job_id] = updated
            return updated.model_copy(deep=True)

    def begin_attempt(self, job_id: str) -> JobState | None:
        return self._transition(job_id, begin_attempt)

    def update_stage(
        self,
        job_id: str,
        stage: str,
        status: StageStatus,
        *,
        error: str | None = None,
        duration_s: float | None = None,
    ) -> JobState | None:
        return self._transition(
            job_id,
            lambda job: apply_stage_update(
                job, stage, status, now=self._clock(), error=error, duration_s=duration_s
            ),
        )

    def finish(self, job_id: str, status: FinalStatus, *, error: str | None = None) -> JobState | None:
        return self._transition(job_id, lambda job: apply_finish(job, status, now=self._clock(), error=error))

    def list_recent(self, limit: int = 20) -> list[JobState]:
        with self._lock:
            newest_first = sorted(self._jobs.values(), key=lambda job: job.submitted_at, reverse=True)
            return [job.model_copy(deep=True) for job in newest_first[:limit]]

    def counts(self) -> StatsCounts:
        tally = {"queued": 0, "running": 0, "succeeded": 0, "failed": 0}
        for job in self.list_recent(RECENT_WINDOW):
            tally[job.status] += 1
        return StatsCounts(**tally)

    def heartbeat(self, worker_id: str) -> None:
        with self._lock:
            self._workers[worker_id] = self._clock()

    def live_workers(self) -> int:
        with self._lock:
            now = self._clock()
            ttl = timedelta(seconds=WORKER_HEARTBEAT_TTL_S)
            return sum(1 for last_seen in self._workers.values() if now - last_seen < ttl)


class FakePublisher:
    """Publisher que guarda los mensajes en una lista. `fail = True` simula el broker caído
    para ejercitar el camino del 503."""

    def __init__(self) -> None:
        self.published: list[JobMessage] = []
        self.fail = False

    def publish_job(self, message: JobMessage) -> None:
        if self.fail:
            raise PublishError("broker simulado: sin confirmación")
        self.published.append(message.model_copy(deep=True))

    def queue_depth(self) -> int:
        return len(self.published)

    def close(self) -> None:
        pass
