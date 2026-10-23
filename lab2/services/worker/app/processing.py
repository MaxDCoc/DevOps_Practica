"""Procesa un mensaje de la cola: corre el pipeline y deja las métricas y las trazas."""

from deployflow_common.contract import SPAN_PROCESS
from deployflow_common.interfaces import JobStore
from deployflow_common.messaging import Delivery
from deployflow_common.observability import extract_trace_context
from opentelemetry import trace

from . import metrics
from .runner import Outcome, run_pipeline


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
            },
        ):
            outcome = run_pipeline(message, store, sleep=delivery.sleep, tracer=tracer)
    except Exception:
        metrics.JOBS.labels("errored").inc()
        raise
    finally:
        metrics.IN_PROGRESS.dec()

    _record(outcome)
    return outcome


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
