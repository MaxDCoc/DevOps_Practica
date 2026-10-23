"""Trazas distribuidas (OpenTelemetry). Lo implementa P3.

Hasta entonces son funciones vacías con la firma final, para que P1 y P2 ya las llamen
(telemetría "apagada"). Cuando P3 las reemplace, tests/test_interface_contracts.py tiene
que seguir en verde.
"""

from collections.abc import Mapping
from typing import Any


def setup_telemetry(service_name: str) -> None:
    """Configura el exportador de trazas hacia Jaeger. No hace nada con TELEMETRY=off."""


def shutdown_telemetry() -> None:
    """Vacía los spans pendientes antes de salir (si no, se pierde el último job)."""


def inject_trace_context(headers: dict[str, str]) -> dict[str, str]:
    """Agrega el traceparent del span activo a los headers del mensaje y los devuelve."""
    return headers


def extract_trace_context(headers: Mapping[str, Any] | None) -> Any:
    """Devuelve el contexto de traza de los headers de un mensaje (None si no trae)."""
    return None


def current_trace_id() -> str | None:
    """trace_id (32 hex) del span activo, o None si no hay ninguno."""
    return None
