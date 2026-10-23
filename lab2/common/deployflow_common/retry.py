"""Reglas del reintento, sin RabbitMQ: cuántos intentos lleva un mensaje y con qué headers vuelve a la cola.

Un fallo inesperado del handler no manda el mensaje a la cola de muertos de entrada: el consumidor lo vuelve
a encolar en `pipeline.jobs.retry`, donde espera RETRY_DELAY_MS y RabbitMQ lo devuelve a `pipeline.jobs`.
Recién al agotar MAX_ATTEMPTS intentos (contando el primero) va a la cola de muertos.
"""

import os
from collections.abc import Mapping
from typing import Any

from .contract import ENV_MAX_ATTEMPTS, HEADER_ATTEMPT

DEFAULT_MAX_ATTEMPTS = 3

# Los agrega RabbitMQ solo cuando vence el TTL de la cola de reintento. No se copian al mensaje que vuelve a esa
# cola: con la cola ya anotada en x-death, el broker podría tomarlo por un ciclo de dead-lettering y cortarlo.
_BROKER_DEATH_HEADERS = ("x-death", "x-first-death", "x-last-death")


def attempt_of(headers: Mapping[str, Any] | None) -> int:
    """Número de intento que dice el header `x-attempt`; 1 si falta o no tiene sentido (otro productor, un typo)."""
    try:
        attempt = int((headers or {}).get(HEADER_ATTEMPT))
    except (TypeError, ValueError):
        return 1
    return attempt if attempt >= 1 else 1


def retry_headers(headers: Mapping[str, Any] | None) -> dict[str, Any]:
    """Headers del mensaje que vuelve a la cola: los mismos (el traceparent sigue la misma traza), un intento más."""
    kept = {name: value for name, value in (headers or {}).items() if not name.startswith(_BROKER_DEATH_HEADERS)}
    kept[HEADER_ATTEMPT] = attempt_of(headers) + 1
    return kept


def max_attempts_from_env(environ: Mapping[str, str] | None = None) -> int:
    """MAX_ATTEMPTS (intentos totales por trabajo, el primero incluido). Un valor inválido frena el arranque."""
    environ = os.environ if environ is None else environ
    raw = environ.get(ENV_MAX_ATTEMPTS)
    if raw is None:
        return DEFAULT_MAX_ATTEMPTS
    try:
        value = int(raw)
    except ValueError:
        value = 0
    if value < 1:
        raise ValueError(f"{ENV_MAX_ATTEMPTS} tiene que ser un entero mayor o igual a 1, y llegó {raw!r}")
    return value
