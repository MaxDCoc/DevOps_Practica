"""Procesa un mensaje de la cola: corre el pipeline y deja las métricas y las trazas."""

import logging

from deployflow_common.contract import SPAN_PROCESS
from deployflow_common.interfaces import JobStore
from deployflow_common.messaging import Delivery
from deployflow_common.observability import extract_trace_context
from opentelemetry import trace

from . import metrics
from .runner import Outcome, run_pipeline

logger = logging.getLogger("worker")


def process(delivery: Delivery, store: JobStore, *, tracer: trace.Tracer | None = None) -> Outcome:
    tracer = tracer or trace.get_tracer("deployflow.worker")
    message = delivery.message
    if delivery.redelivered:
        metrics.REDELIVERED.inc()

    # El traceparent viaja en los headers del mensaje: el span del job continúa la traza que arrancó la API.
    parent_context = extract_trace_context(delivery.headers)
    metrics.IN_PROGRESS.inc()
    try:
        with tracer.start_as_current_span(
            SPAN_PROCESS,
            context=parent_context,
            kind=trace.SpanKind.CONSUMER,
            attributes={
                "messaging.system": "rabbitmq",
                "messaging.operation": "process",
                "messaging.message.id": message.job_id,
                "job.id": message.job_id,
                "job.project": message.project,
                "job.attempt": delivery.attempt,
            },
        ):
            outcome = run_pipeline(message, store, sleep=delivery.sleep, tracer=tracer)
    except Exception as exc:
        metrics.JOBS.labels("errored").inc()
        if delivery.last_attempt:
            error = f"error inesperado en el intento {delivery.attempt} de {delivery.max_attempts}: {type(exc).__name__}: {exc}"
            _give_up(store, message.job_id, error)
        raise
    finally:
        metrics.IN_PROGRESS.dec()

    _record(outcome)
    return outcome


def _give_up(store: JobStore, job_id: str, error: str) -> None:
    """Último intento fallado: el mensaje va a la cola de muertos, así que el job se cierra como fallado.

    Sin esto el job quedaría «running» hasta que venza en Redis. Es un intento de mejor esfuerzo: si el estado
    tampoco responde, se anota en el log y el error que se propaga sigue siendo el original.
    """
    try:
        state = store.get(job_id)
        if state is None or state.is_finished:
            return
        # Solo la etapa que estaba corriendo: si el error cayó entre dos etapas, la anterior ya terminó bien.
        running = next((stage for stage in state.stages if stage.status == "running"), None)
        if running is not None:
            store.update_stage(job_id, running.name, "failed", error=error)
        store.finish(job_id, "failed", error=error)
    except Exception:  # noqa: BLE001 - no tapar el error original del handler
        logger.exception("no se pudo marcar el job %s como fallado", job_id)


def _record(outcome: Outcome) -> None:
    if outcome.status not in ("succeeded", "failed"):
        return  # un duplicado o un job vencido no es una ejecución
    metrics.JOBS.labels(outcome.status).inc()
    if outcome.failed_stage:
        metrics.STAGE_FAILURES.labels(outcome.failed_stage).inc()
    state = outcome.state
    if state is None:
        return
    if state.finished_at is not None:
        metrics.JOB_DURATION.observe((state.finished_at - state.submitted_at).total_seconds())
    for stage in state.stages:
        if stage.duration_s is not None:
            metrics.STAGE_DURATION.labels(stage.name).observe(stage.duration_s)
