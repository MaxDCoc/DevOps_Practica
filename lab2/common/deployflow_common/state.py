"""Estado de los pipelines en Redis.

Claves (en contract.py): job:{id} = JobState en JSON con TTL de 24 h, jobs:recent = ZSET ordenado por
submitted_at, worker:{id} = latido con TTL de 15 s. Las reglas de cada transición viven en
transitions.py (las mismas que usa el almacén en memoria): acá solo se persiste.

El cliente de Redis tiene que crearse con decode_responses=True.
"""

import os
from collections.abc import Callable
from datetime import datetime

import redis

from .contract import (
    ENV_REDIS_URL,
    JOB_TTL_SECONDS,
    KEY_JOB,
    KEY_RECENT,
    KEY_WORKER,
    RECENT_WINDOW,
    WORKER_HEARTBEAT_TTL_S,
    JobState,
    StageStatus,
    StatsCounts,
    utcnow,
)
from .transitions import FinalStatus, apply_finish, apply_stage_update, begin_attempt

DEFAULT_REDIS_URL = "redis://redis:6379/0"


class RedisJobStore:
    def __init__(self, client: redis.Redis, clock: Callable[[], datetime] = utcnow):
        self._redis = client
        self._clock = clock

    @classmethod
    def from_env(cls) -> "RedisJobStore":
        url = os.environ.get(ENV_REDIS_URL, DEFAULT_REDIS_URL)
        return cls(redis.Redis.from_url(url, decode_responses=True))

    def create(self, state: JobState) -> None:
        pipe = self._redis.pipeline()
        pipe.set(KEY_JOB.format(job_id=state.job_id), state.model_dump_json(), ex=JOB_TTL_SECONDS)
        pipe.zadd(KEY_RECENT, {state.job_id: state.submitted_at.timestamp()})
        pipe.execute()

    def get(self, job_id: str) -> JobState | None:
        raw = self._redis.get(KEY_JOB.format(job_id=job_id))
        return JobState.model_validate_json(raw) if raw else None

    def _transition(self, job_id: str, transition: Callable[[JobState], JobState]) -> JobState | None:
        """Lee, transforma y escribe con bloqueo optimista (WATCH): si otro proceso cambió el job
        entre la lectura y la escritura, se reintenta en vez de pisarlo."""
        key = KEY_JOB.format(job_id=job_id)
        with self._redis.pipeline() as pipe:
            while True:
                try:
                    pipe.watch(key)
                    raw = pipe.get(key)
                    if raw is None:
                        pipe.unwatch()
                        return None
                    updated = transition(JobState.model_validate_json(raw))
                    pipe.multi()
                    pipe.set(key, updated.model_dump_json(), ex=JOB_TTL_SECONDS)
                    pipe.execute()
                    return updated
                except redis.WatchError:
                    continue

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

    def _load(self, job_ids: list[str]) -> list[JobState]:
        if not job_ids:
            return []
        raws = self._redis.mget([KEY_JOB.format(job_id=job_id) for job_id in job_ids])
        expired = [job_id for job_id, raw in zip(job_ids, raws, strict=True) if raw is None]
        if expired:  # el TTL borró el job: se limpia también del índice
            self._redis.zrem(KEY_RECENT, *expired)
        return [JobState.model_validate_json(raw) for raw in raws if raw is not None]

    def list_recent(self, limit: int = 20) -> list[JobState]:
        return self._load(self._redis.zrevrange(KEY_RECENT, 0, limit - 1))

    def counts(self) -> StatsCounts:
        tally = {"queued": 0, "running": 0, "succeeded": 0, "failed": 0}
        for job in self._load(self._redis.zrevrange(KEY_RECENT, 0, RECENT_WINDOW - 1)):
            tally[job.status] += 1
        return StatsCounts(**tally)

    def heartbeat(self, worker_id: str) -> None:
        self._redis.set(KEY_WORKER.format(worker_id=worker_id), "1", ex=WORKER_HEARTBEAT_TTL_S)

    def live_workers(self) -> int:
        return sum(1 for _ in self._redis.scan_iter(match=KEY_WORKER.format(worker_id="*")))
