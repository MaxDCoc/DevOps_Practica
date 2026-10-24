"""Métricas HTTP y trazas automáticas, sin duplicar las métricas de P1/P2."""

from time import perf_counter
from typing import Any

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest, start_http_server

from .contract import METRIC_HTTP_DURATION, METRIC_HTTP_REQUESTS
from .factory import telemetry_enabled

# Compartidas por proceso, no por create_app(): evita collectors duplicados en tests.
_REQUESTS = Counter(METRIC_HTTP_REQUESTS, "Respuestas HTTP por método, plantilla y estado", ["method", "route", "status"])
_DURATION = Histogram(
    METRIC_HTTP_DURATION,
    "Duración de las solicitudes HTTP en segundos",
    ["method", "route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5, 10),
)
_EXCLUDED_PATHS = {"/health", "/metrics"}


class _HTTPMetricsMiddleware:
    """ASGI puro: preserva contextvars y cuenta también excepciones no manejadas."""

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope.get("path") in _EXCLUDED_PATHS:
            await self.app(scope, receive, send)
            return
        status = 500
        started = perf_counter()

        async def capture_status(message: Any) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, capture_status)
        finally:
            # El router resuelve la plantilla durante la llamada, no al entrar.
            # Los 404 usan un único valor: nunca una URL arbitraria o un job_id.
            route = getattr(scope.get("route"), "path", "__unmatched__")
            method = scope["method"]
            _REQUESTS.labels(method, route, str(status)).inc()
            _DURATION.labels(method, route).observe(perf_counter() - started)


def instrument_fastapi(app: Any, service_name: str) -> None:
    """Instrumenta una app una sola vez. TELEMETRY=off apaga trazas, no métricas."""
    if getattr(app.state, "_deployflow_instrumented", False):
        return
    enabled = telemetry_enabled()  # valida el interruptor antes de modificar la app
    # FastAPI es dependencia de P1, no del worker; importar solo cuando se usa.
    from fastapi import Response

    def metrics() -> Response:
        return Response(generate_latest(), headers={"Content-Type": CONTENT_TYPE_LATEST})

    app.add_api_route("/metrics", metrics, methods=["GET"], include_in_schema=False)
    app.add_middleware(_HTTPMetricsMiddleware)
    if enabled:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        FastAPIInstrumentor.instrument_app(
            app,
            excluded_urls=r".*/(health|metrics)($|\?)",
            exclude_spans=["receive", "send"],
        )
        instrumentor = HTTPXClientInstrumentor()
        if not instrumentor.is_instrumented_by_opentelemetry:
            instrumentor.instrument()
    app.state._deployflow_instrumented = True


def start_metrics_server(port: int) -> None:
    """Servidor auxiliar en un hilo. El worker de P2 ya tiene el suyo: no duplicarlo."""
    start_http_server(port)
