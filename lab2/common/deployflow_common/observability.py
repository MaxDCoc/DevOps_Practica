"""Trazas distribuidas de DeployFlow: OTLP gRPC y propagación W3C por AMQP."""

import os
from collections.abc import Mapping
from threading import Lock
from typing import Any

from opentelemetry import trace
from opentelemetry.context import Context
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from .contract import ENV_OTLP_ENDPOINT
from .factory import telemetry_enabled

_propagator = TraceContextTextMapPropagator()
_provider: TracerProvider | None = None
_lock = Lock()


def setup_telemetry(service_name: str) -> None:
    """Un provider por proceso; invocaciones repetidas no duplican exportadores.

    El cierre es definitivo, como el del SDK: cada servicio tiene un único ciclo
    de vida. Los tests con distintos providers deben usar procesos separados.
    """
    global _provider
    if not telemetry_enabled():
        return
    with _lock:
        if _provider is not None:
            return
        provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
        exporter = OTLPSpanExporter(
            endpoint=os.environ.get(ENV_OTLP_ENDPOINT, "http://jaeger:4317"),
        )
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)
        _provider = provider


def shutdown_telemetry() -> None:
    """Vacía el batch y cierra el exportador; el SDK tolera el cierre repetido."""
    with _lock:
        if _provider is not None:
            _provider.force_flush()
            _provider.shutdown()


def inject_trace_context(headers: dict[str, Any]) -> dict[str, Any]:
    """Agrega traceparent/tracestate sin descartar headers de negocio (p.ej. x-attempt)."""
    _propagator.inject(headers)
    return headers


def extract_trace_context(headers: Mapping[str, Any] | None) -> Context:
    """AMQP admite bytes y valores no textuales. Nunca hereda un contexto ajeno.

    Sin traceparent válido devuelve un contexto vacío: el consumidor inicia una
    nueva traza en lugar de asociar el job con un span residual de otro mensaje.
    """
    carrier = {}
    for key, value in (headers or {}).items():
        try:
            if isinstance(key, bytes):
                key = key.decode("utf-8")
            if isinstance(value, bytes):
                value = value.decode("utf-8")
        except UnicodeDecodeError:
            continue
        if isinstance(key, str) and isinstance(value, str):
            carrier[key.lower()] = value
    return _propagator.extract(carrier, context=Context())


def current_trace_id() -> str | None:
    """trace_id de 32 hex del span activo, o None fuera de una traza."""
    context = trace.get_current_span().get_span_context()
    return f"{context.trace_id:032x}" if context.is_valid else None
