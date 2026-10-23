from datetime import UTC, datetime, timedelta

import pytest
from deployflow_common.contract import PipelineRequest, build_job_message, new_job_state
from deployflow_common.fakes import InMemoryJobStore

T0 = datetime(2026, 10, 22, 15, 0, 0, tzinfo=UTC)


class Clock:
    """Reloj de prueba: solo avanza cuando el test (o un sleep simulado) lo pide."""

    def __init__(self, start: datetime):
        self.now = start

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


class SleepRecorder:
    """Reemplaza al sleep real: anota cuánto se pidió dormir y adelanta el reloj en esa cantidad."""

    def __init__(self, clock: Clock):
        self.clock = clock
        self.calls: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)
        self.clock.advance(seconds)


@pytest.fixture
def t0() -> datetime:
    return T0


@pytest.fixture
def clock() -> Clock:
    return Clock(T0)


@pytest.fixture
def store(clock) -> InMemoryJobStore:
    return InMemoryJobStore(clock=clock)


@pytest.fixture
def sleep(clock) -> SleepRecorder:
    return SleepRecorder(clock)


@pytest.fixture
def enqueue(store, clock):
    """enqueue(job_id="job-1", stages=[...], stage_seconds=..., fail_at=...) hace lo que la API:
    guarda el estado "queued" y devuelve el mensaje que viajaría por la cola."""

    def _enqueue(job_id: str = "job-1", **config):
        request = PipelineRequest.model_validate({"project": "shop-frontend", "config": config})
        state = new_job_state(job_id, request, now=clock())
        store.create(state)
        return build_job_message(job_id, request, state.submitted_at)

    return _enqueue
