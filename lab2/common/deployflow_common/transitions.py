"""Transiciones de estado de un pipeline, como funciones puras.

Las usan InMemoryJobStore y el RedisJobStore de P2: la persistencia cambia, las reglas no.
Ninguna función modifica el estado que recibe: devuelven uno nuevo.
"""

from datetime import datetime
from typing import Literal

from .contract import JobState, StageStatus

FinalStatus = Literal["succeeded", "failed"]


def begin_attempt(state: JobState) -> JobState:
    """Arranca un intento: cuenta el intento y deja todas las etapas pendientes.

    Un mensaje redelivered (el worker murió antes del ack) repite el pipeline desde cero.
    Si el pipeline ya terminó, no hace nada: un duplicado no lo resucita.
    """
    if state.is_finished:
        return state
    new = state.model_copy(deep=True)
    new.attempts += 1
    new.status = "running"
    new.current_stage = None
    for stage in new.stages:
        stage.status = "pending"
        stage.started_at = None
        stage.duration_s = None
        stage.error = None
    return new


def apply_stage_update(
    state: JobState,
    stage: str,
    status: StageStatus,
    *,
    now: datetime,
    error: str | None = None,
    duration_s: float | None = None,
) -> JobState:
    """Registra que una etapa pasó a running, succeeded o failed."""
    index = next((i for i, s in enumerate(state.stages) if s.name == stage), None)
    if index is None:
        raise ValueError(f"etapa desconocida {stage!r}; las del pipeline son {[s.name for s in state.stages]}")
    if status == "pending":
        raise ValueError("una etapa no vuelve a 'pending'; usar begin_attempt para reiniciar el intento")
    if state.is_finished:
        return state

    new = state.model_copy(deep=True)
    target = new.stages[index]
    target.status = status
    new.status = "running"
    new.current_stage = stage

    if status == "running":
        target.started_at = target.started_at or now
    else:
        if duration_s is None and target.started_at is not None:
            duration_s = (now - target.started_at).total_seconds()
        target.duration_s = duration_s
        if status == "failed":
            target.error = error
    return new


def apply_finish(
    state: JobState,
    status: FinalStatus,
    *,
    now: datetime,
    error: str | None = None,
) -> JobState:
    """Cierra el pipeline. Gana el primer resultado: repetir el cierre no lo cambia."""
    if status not in ("succeeded", "failed"):
        raise ValueError(f"estado final inválido {status!r}; usar 'succeeded' o 'failed'")
    if state.is_finished:
        return state

    new = state.model_copy(deep=True)
    new.status = status
    new.finished_at = now
    new.error = error
    return new
