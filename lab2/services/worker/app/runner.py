"""Ejecuta un pipeline simulado: etapa por etapa, anotando el avance en el estado."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from deployflow_common.contract import SPAN_STAGE, JobMessage, JobState
from deployflow_common.interfaces import JobStore
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

logger = logging.getLogger("worker.runner")


class StageFailed(Exception):
    """La etapa falló a propósito (fail_at). Existe para que el span registre una excepción."""


@dataclass(frozen=True)
class Outcome:
    # missing: el job ya no existe (venció por TTL) · skipped: ya había terminado (mensaje duplicado)
    status: Literal["succeeded", "failed", "skipped", "missing"]
    failed_stage: str | None = None
    state: JobState | None = None


def run_pipeline(
    message: JobMessage,
    store: JobStore,
    *,
    sleep: Callable[[float], None],
    tracer: trace.Tracer | None = None,
) -> Outcome:
    """`sleep` se inyecta: el worker real pasa el de la conexión de RabbitMQ (no corta los heartbeats)."""
    tracer = tracer or trace.get_tracer("deployflow.worker")

    state = store.begin_attempt(message.job_id)
    if state is None:
        return Outcome("missing")
    if state.is_finished:
        return Outcome("skipped", state=state)

    config = message.config
    for stage in config.stages:
        store.update_stage(message.job_id, stage, "running")
        with tracer.start_as_current_span(
            SPAN_STAGE.format(stage=stage),
            attributes={"stage.name": stage, "job.id": message.job_id},
        ) as span:
            sleep(config.stage_seconds)
            if stage == config.fail_at:
                error = f"falló la etapa {stage} (simulado)"
                span.set_status(Status(StatusCode.ERROR, error))
                span.record_exception(StageFailed(error))
                logger.error(error, extra={"job_id": message.job_id, "stage": stage, "error": error})
                store.update_stage(message.job_id, stage, "failed", error=error)
                final = store.finish(message.job_id, "failed", error=error)
                return Outcome("failed", failed_stage=stage, state=final)
        store.update_stage(message.job_id, stage, "succeeded")

    return Outcome("succeeded", state=store.finish(message.job_id, "succeeded"))
