from datetime import UTC, datetime, timedelta

import pytest

from deployflow_common.contract import PipelineRequest, new_job_state

T0 = datetime(2026, 10, 22, 15, 0, 0, tzinfo=UTC)


class Clock:
    """Reloj de prueba: solo avanza cuando el test lo pide."""

    def __init__(self, start: datetime):
        self.now = start

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


@pytest.fixture
def t0() -> datetime:
    return T0


@pytest.fixture
def clock() -> Clock:
    return Clock(T0)


@pytest.fixture
def queued_job():
    """Un pipeline recién aceptado, con las tres etapas por defecto."""
    request = PipelineRequest(project="shop-frontend")
    return new_job_state("job-1", request, trace_id="trace-1", now=T0)
