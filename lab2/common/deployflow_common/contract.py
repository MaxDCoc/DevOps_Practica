"""Contrato de DeployFlow: constantes y modelos que comparten las cuatro partes.

Se congela en el Hito 0. Un cambio acá (un campo, el nombre de una cola o de una métrica)
afecta a todas las partes: va en un PR chico que se mergea primero y se avisa al grupo.
"""

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

# --- Cola (RabbitMQ) ---------------------------------------------------------------
EXCHANGE = "pipelines"
ROUTING_KEY = "pipeline.run"
QUEUE_JOBS = "pipeline.jobs"
DLX_EXCHANGE = "pipelines.dlx"
DEAD_ROUTING_KEY = "pipeline.dead"
QUEUE_DEAD = "pipeline.jobs.dead"
QUEUE_RETRY = "pipeline.jobs.retry"
RETRY_DELAY_MS = 5000
HEADER_TRACEPARENT = "traceparent"
HEADER_ATTEMPT = "x-attempt"

# --- Redis -------------------------------------------------------------------------
KEY_JOB = "job:{job_id}"
KEY_RECENT = "jobs:recent"
KEY_WORKER = "worker:{worker_id}"
JOB_TTL_SECONDS = 24 * 60 * 60
RECENT_WINDOW = 200
WORKER_HEARTBEAT_INTERVAL_S = 5
WORKER_HEARTBEAT_TTL_S = 15

# --- Pipelines ---------------------------------------------------------------------
STAGES = ("build", "test", "deploy")

# --- Variables de entorno ----------------------------------------------------------
ENV_STATE_BACKEND = "STATE_BACKEND"  # memory | redis
ENV_PUBLISHER = "PUBLISHER"  # fake | rabbit
ENV_TELEMETRY = "TELEMETRY"  # on | off
ENV_SERVICE_NAME = "SERVICE_NAME"
ENV_LOG_LEVEL = "LOG_LEVEL"
ENV_RABBITMQ_URL = "RABBITMQ_URL"
ENV_REDIS_URL = "REDIS_URL"
ENV_VALIDATOR_URL = "VALIDATOR_URL"
ENV_OTLP_ENDPOINT = "OTEL_EXPORTER_OTLP_ENDPOINT"
ENV_MAX_ATTEMPTS = "MAX_ATTEMPTS"
ENV_WORKER_METRICS_PORT = "WORKER_METRICS_PORT"
ENV_VALIDATOR_LATENCY_MS = "VALIDATOR_LATENCY_MS"

# --- Nombres de métricas (Prometheus) ----------------------------------------------
METRIC_HTTP_REQUESTS = "http_requests_total"
METRIC_HTTP_DURATION = "http_request_duration_seconds"
METRIC_SUBMITTED = "pipelines_submitted_total"
METRIC_JOBS = "pipeline_jobs_total"
METRIC_JOB_DURATION = "pipeline_job_duration_seconds"
METRIC_STAGE_DURATION = "pipeline_stage_duration_seconds"
METRIC_STAGE_FAILURES = "pipeline_stage_failures_total"
METRIC_JOBS_IN_PROGRESS = "worker_jobs_in_progress"
METRIC_REDELIVERED = "worker_messages_redelivered_total"

# --- Nombres de spans (OpenTelemetry) ----------------------------------------------
SPAN_PUBLISH = "publish pipeline.jobs"
SPAN_PROCESS = "process pipeline.jobs"
SPAN_STAGE = "stage {stage}"

# --- Modelos -----------------------------------------------------------------------
JobStatus = Literal["queued", "running", "succeeded", "failed"]
StageStatus = Literal["pending", "running", "succeeded", "failed"]


class PipelineConfig(BaseModel):
    # Los tipos son laxos a propósito: las reglas de negocio (etapas válidas, rangos) son del
    # servicio de validación, que contesta 422 con sus propios mensajes.
    stages: list[str] = Field(default_factory=lambda: list(STAGES))
    stage_seconds: int = 3
    fail_at: str | None = None


class PipelineRequest(BaseModel):
    project: str
    branch: str = "main"
    config: PipelineConfig = Field(default_factory=PipelineConfig)


class ValidationResult(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)


class ValidationErrorDetail(BaseModel):
    errors: list[str]


class ValidationErrorResponse(BaseModel):
    """Cuerpo del 422 que devuelve la API cuando el validador rechaza el pedido."""

    detail: ValidationErrorDetail


class StageState(BaseModel):
    name: str
    status: StageStatus = "pending"
    started_at: datetime | None = None
    duration_s: float | None = None
    error: str | None = None


class JobState(BaseModel):
    job_id: str
    project: str
    branch: str
    status: JobStatus = "queued"
    current_stage: str | None = None
    stages: list[StageState]
    attempts: int = 0
    trace_id: str | None = None
    submitted_at: datetime
    finished_at: datetime | None = None
    error: str | None = None

    @property
    def is_finished(self) -> bool:
        return self.status in ("succeeded", "failed")


class JobMessage(BaseModel):
    """Lo que viaja por RabbitMQ: el worker no necesita nada más que esto."""

    job_id: str
    project: str
    branch: str
    config: PipelineConfig
    submitted_at: datetime


class AcceptedResponse(BaseModel):
    job_id: str
    status: Literal["queued"] = "queued"
    trace_id: str | None = None


class PipelineList(BaseModel):
    items: list[JobState]


class StatsCounts(BaseModel):
    queued: int = 0
    running: int = 0
    succeeded: int = 0
    failed: int = 0


class Stats(BaseModel):
    counts: StatsCounts
    queue_depth: int
    workers: int


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_job_state(
    job_id: str,
    request: PipelineRequest,
    trace_id: str | None = None,
    now: datetime | None = None,
) -> JobState:
    """Estado inicial de un pipeline recién aceptado: en cola, con todas sus etapas pendientes."""
    return JobState(
        job_id=job_id,
        project=request.project,
        branch=request.branch,
        stages=[StageState(name=name) for name in request.config.stages],
        trace_id=trace_id,
        submitted_at=now or utcnow(),
    )


def build_job_message(job_id: str, request: PipelineRequest, submitted_at: datetime) -> JobMessage:
    return JobMessage(
        job_id=job_id,
        project=request.project,
        branch=request.branch,
        config=request.config.model_copy(deep=True),
        submitted_at=submitted_at,
    )
