import pytest

from deployflow_common import factory
from deployflow_common.fakes import FakePublisher, InMemoryJobStore


@pytest.fixture(autouse=True)
def fresh_factory_cache():
    factory.get_job_store.cache_clear()
    factory.get_publisher.cache_clear()
    yield
    factory.get_job_store.cache_clear()
    factory.get_publisher.cache_clear()


def test_the_memory_backend_gives_one_store_shared_by_every_caller(monkeypatch):
    monkeypatch.setenv("STATE_BACKEND", "memory")

    first = factory.get_job_store()
    second = factory.get_job_store()

    # Si cada llamada creara un almacén nuevo, un pipeline creado por un handler
    # sería invisible para el siguiente.
    assert isinstance(first, InMemoryJobStore)
    assert first is second


def test_the_fake_publisher_is_shared_by_every_caller(monkeypatch):
    monkeypatch.setenv("PUBLISHER", "fake")

    first = factory.get_publisher()
    second = factory.get_publisher()

    assert isinstance(first, FakePublisher)
    assert first is second


def test_an_unknown_state_backend_fails_loudly_instead_of_falling_back(monkeypatch):
    monkeypatch.setenv("STATE_BACKEND", "postgres")

    with pytest.raises(ValueError, match="STATE_BACKEND"):
        factory.get_job_store()


def test_an_unknown_publisher_fails_loudly_instead_of_falling_back(monkeypatch):
    monkeypatch.setenv("PUBLISHER", "kafka")

    with pytest.raises(ValueError, match="PUBLISHER"):
        factory.get_publisher()


@pytest.mark.parametrize(
    "value,expected",
    [(None, True), ("on", True), ("ON", True), ("off", False), (" Off ", False)],
)
def test_telemetry_is_on_unless_explicitly_turned_off(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv("TELEMETRY", raising=False)
    else:
        monkeypatch.setenv("TELEMETRY", value)

    assert factory.telemetry_enabled() is expected


def test_an_unknown_telemetry_value_is_rejected(monkeypatch):
    monkeypatch.setenv("TELEMETRY", "maybe")

    with pytest.raises(ValueError, match="TELEMETRY"):
        factory.telemetry_enabled()
