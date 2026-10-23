"""Servicio de validación: revisa que un pedido de pipeline tenga sentido antes de encolarlo."""

import asyncio
import os
import socket
from contextlib import asynccontextmanager

from deployflow_common.contract import (
    ENV_LOG_LEVEL,
    ENV_VALIDATOR_LATENCY_MS,
    PipelineRequest,
    ValidationResult,
)
from deployflow_common.logging import setup_logging
from deployflow_common.metrics import instrument_fastapi
from deployflow_common.observability import setup_telemetry, shutdown_telemetry
from fastapi import FastAPI

from .rules import validate_request

SERVICE_NAME = "validator"
# Latencia artificial: con 150 ms el span del validador se distingue en Jaeger.
DEFAULT_LATENCY_MS = 150


def create_app(latency_ms: int | None = None) -> FastAPI:
    if latency_ms is None:
        latency_ms = int(os.environ.get(ENV_VALIDATOR_LATENCY_MS, DEFAULT_LATENCY_MS))

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        setup_logging(SERVICE_NAME, os.environ.get(ENV_LOG_LEVEL, "INFO"))
        setup_telemetry(SERVICE_NAME)
        yield
        shutdown_telemetry()

    app = FastAPI(title="DeployFlow · validador", lifespan=lifespan)
    instrument_fastapi(app, SERVICE_NAME)

    @app.post("/validate", response_model=ValidationResult)
    async def validate(request: PipelineRequest) -> ValidationResult:
        # Rechazar un pedido es un resultado de negocio: siempre 200, con los errores en el cuerpo.
        # Solo una falla de infraestructura devuelve 5xx (y la API la traduce a 503).
        await asyncio.sleep(latency_ms / 1000)
        errors = validate_request(request)
        return ValidationResult(valid=not errors, errors=errors)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "hostname": socket.gethostname()}

    return app


app = create_app()
