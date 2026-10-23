"""Métricas del worker. Los nombres son los del contrato (contract.py)."""

from deployflow_common.contract import (
    METRIC_JOB_DURATION,
    METRIC_JOBS,
    METRIC_JOBS_IN_PROGRESS,
    METRIC_REDELIVERED,
    METRIC_STAGE_DURATION,
    METRIC_STAGE_FAILURES,
)
from prometheus_client import Counter, Gauge, Histogram

JOBS = Counter(
    METRIC_JOBS,
    "Pipelines que terminó el worker, según cómo terminaron",
    ["status"],  # succeeded | failed | errored
)
JOB_DURATION = Histogram(
    METRIC_JOB_DURATION,
    "Segundos desde que se pidió el pipeline hasta que terminó (incluye la espera en la cola)",
    buckets=(1, 2, 5, 10, 20, 30, 60, 120, 300),
)
STAGE_DURATION = Histogram(
    METRIC_STAGE_DURATION,
    "Segundos que tardó cada etapa",
    ["stage"],
    buckets=(0.5, 1, 2, 3, 5, 10, 20, 30),
)
STAGE_FAILURES = Counter(METRIC_STAGE_FAILURES, "Etapas que fallaron", ["stage"])
IN_PROGRESS = Gauge(METRIC_JOBS_IN_PROGRESS, "Pipelines que este worker está procesando ahora")
REDELIVERED = Counter(
    METRIC_REDELIVERED,
    "Mensajes que RabbitMQ entregó de nuevo porque un worker anterior murió sin confirmarlos",
)
