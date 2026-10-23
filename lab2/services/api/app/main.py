"""API principal: recibe los pedidos de pipeline, los valida y los deja en la cola sin esperar a que terminen."""

import logging
import os
import socket
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Annotated
from uuid import uuid4

from deployflow_common import factory
from deployflow_common.contract import (
    ENV_LOG_LEVEL,
    METRIC_SUBMITTED,
    AcceptedResponse,
    JobState,
    PipelineList,
    PipelineRequest,
    Stats,
    ValidationErrorResponse,
    build_job_message,
    new_job_state,
)
from deployflow_common.interfaces import JobStore, Publisher, PublishError
from deployflow_common.logging import setup_logging
from deployflow_common.metrics import instrument_fastapi
from deployflow_common.observability import current_trace_id, setup_telemetry, shutdown_telemetry
from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException, Query, Response
from prometheus_client import Counter

from .validator_client import ValidatorClient, ValidatorUnavailable

SERVICE_NAME = "api"
logger = logging.getLogger("api")

SUBMITTED = Counter(
    METRIC_SUBMITTED,
    "Pedidos recibidos en POST /pipelines, según su resultado",
    ["result"],  # accepted | rejected | error
)

# Los dos ejemplos de la demo, listos para ejecutar desde Swagger.
PIPELINE_EXAMPLES = {
    "exito": {
        "summary": "Un pipeline que termina bien",
        "value": {
            "project": "shop-frontend",
            "branch": "main",
            "config": {"stages": ["build", "test", "deploy"], "stage_seconds": 3, "fail_at": None},
        },
    },
    "falla_en_test": {
        "summary": "Un pipeline que falla en la etapa de test",
        "value": {
            "project": "shop-frontend",
            "branch": "main",
            "config": {"stages": ["build", "test", "deploy"], "stage_seconds": 3, "fail_at": "test"},
        },
    },
}


def get_store() -> JobStore:
    return factory.get_job_store()


def get_publisher() -> Publisher:
    return factory.get_publisher()


@lru_cache(maxsize=1)
def get_validator() -> ValidatorClient:
    return ValidatorClient.from_env()


StoreDep = Annotated[JobStore, Depends(get_store)]
PublisherDep = Annotated[Publisher, Depends(get_publisher)]
ValidatorDep = Annotated[ValidatorClient, Depends(get_validator)]

router = APIRouter()


# Los endpoints son `def` y no `async def` a propósito: publicar en RabbitMQ con pika bloquea, y en
# un endpoint async congelaría el servidor entero mientras espera la confirmación del broker.
@router.post(
    "/pipelines",
    status_code=202,
    response_model=AcceptedResponse,
    summary="Pide ejecutar un pipeline",
    responses={
        422: {"model": ValidationErrorResponse, "description": "El validador rechazó el pedido"},
        503: {"description": "El validador o la cola no están disponibles"},
    },
)
def create_pipeline(
    pipeline: Annotated[PipelineRequest, Body(openapi_examples=PIPELINE_EXAMPLES)],
    response: Response,
    store: StoreDep,
    publisher: PublisherDep,
    validator: ValidatorDep,
) -> AcceptedResponse:
    """Responde `202` apenas el trabajo queda en la cola: no espera a que termine.
    Para ver cómo avanza, consultar `GET /pipelines/{job_id}`."""
    try:
        verdict = validator.validate(pipeline)
    except ValidatorUnavailable as exc:
        SUBMITTED.labels("error").inc()
        logger.error("el validador no responde")
        raise HTTPException(status_code=503, detail="el servicio de validación no responde") from exc
    if not verdict.valid:
        SUBMITTED.labels("rejected").inc()
        raise HTTPException(status_code=422, detail={"errors": verdict.errors})

    job_id = str(uuid4())
    trace_id = current_trace_id()
    state = new_job_state(job_id, pipeline, trace_id)
    # Primero el estado y después el mensaje: el worker puede tomarlo al instante y "queued" ya tiene que existir.
    store.create(state)
    try:
        publisher.publish_job(build_job_message(job_id, pipeline, state.submitted_at))
    except PublishError as exc:
        _abandon(store, job_id)
        logger.error("no se pudo encolar el pipeline", extra={"job_id": job_id})
        raise HTTPException(status_code=503, detail="no se pudo encolar el pipeline") from exc
    except Exception:
        # Un error de programación se ve como 500 (no se disfraza de "cola caída"), pero el job no
        # puede quedar para siempre en "queued" sin haber llegado a la cola.
        _abandon(store, job_id)
        logger.exception("error inesperado al encolar el pipeline", extra={"job_id": job_id})
        raise

    SUBMITTED.labels("accepted").inc()
    logger.info("pipeline aceptado", extra={"job_id": job_id})
    response.headers["Location"] = f"/pipelines/{job_id}"
    return AcceptedResponse(job_id=job_id, trace_id=trace_id)


def _abandon(store: JobStore, job_id: str) -> None:
    store.finish(job_id, "failed", error="no se pudo encolar el pipeline")
    SUBMITTED.labels("error").inc()


@router.get(
    "/pipelines/{job_id}",
    response_model=JobState,
    summary="Estado de un pipeline",
    responses={404: {"description": "No existe (o ya venció)"}},
)
def get_pipeline(job_id: str, store: StoreDep) -> JobState:
    state = store.get(job_id)
    if state is None:
        raise HTTPException(status_code=404, detail="pipeline no encontrado")
    return state


@router.get("/pipelines", response_model=PipelineList, summary="Los pipelines más recientes")
def list_pipelines(store: StoreDep, limit: Annotated[int, Query(ge=1, le=100)] = 20) -> PipelineList:
    return PipelineList(items=store.list_recent(limit))


@router.get(
    "/stats",
    response_model=Stats,
    summary="Pipelines por estado, cola y workers vivos",
    responses={503: {"description": "No se pudo consultar la cola"}},
)
def stats(store: StoreDep, publisher: PublisherDep) -> Stats:
    try:
        queue_depth = publisher.queue_depth()
    except PublishError as exc:
        raise HTTPException(status_code=503, detail="no se pudo consultar la cola") from exc
    return Stats(counts=store.counts(), queue_depth=queue_depth, workers=store.live_workers())


@router.get("/health", summary="Estado del servicio")
def health() -> dict[str, str]:
    return {"status": "ok", "hostname": socket.gethostname()}


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        setup_logging(SERVICE_NAME, os.environ.get(ENV_LOG_LEVEL, "INFO"))
        setup_telemetry(SERVICE_NAME)
        yield
        shutdown_telemetry()

    app = FastAPI(title="DeployFlow · API", lifespan=lifespan)
    instrument_fastapi(app, SERVICE_NAME)
    app.include_router(router)
    return app


app = create_app()
