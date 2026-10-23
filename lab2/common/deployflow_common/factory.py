"""Interruptores del contrato: eligen entre la implementación real y el doble de prueba.

    STATE_BACKEND = memory | redis    (por defecto redis)
    PUBLISHER     = fake   | rabbit   (por defecto rabbit)
    TELEMETRY     = on     | off      (por defecto on)

En compose va todo real. En desarrollo y en tests se exporta memory / fake / off, y cada parte
trabaja sola sin esperar a las demás.
"""

import os
from functools import lru_cache

from .contract import ENV_PUBLISHER, ENV_STATE_BACKEND, ENV_TELEMETRY
from .fakes import FakePublisher, InMemoryJobStore
from .interfaces import JobStore, Publisher


def _choice(name: str, allowed: tuple[str, ...], default: str) -> str:
    value = os.environ.get(name, default).strip().lower()
    if value not in allowed:
        raise ValueError(f"{name}={value!r} no es válido; valores posibles: {', '.join(allowed)}")
    return value


@lru_cache(maxsize=1)
def get_job_store() -> JobStore:
    if _choice(ENV_STATE_BACKEND, ("memory", "redis"), "redis") == "memory":
        return InMemoryJobStore()
    from .state import RedisJobStore  # import diferido: solo hace falta con el estado real

    return RedisJobStore.from_env()


@lru_cache(maxsize=1)
def get_publisher() -> Publisher:
    if _choice(ENV_PUBLISHER, ("fake", "rabbit"), "rabbit") == "fake":
        return FakePublisher()
    from .messaging import RabbitPublisher  # import diferido: solo hace falta con la cola real

    return RabbitPublisher.from_env()


def telemetry_enabled() -> bool:
    return _choice(ENV_TELEMETRY, ("on", "off"), "on") == "on"
