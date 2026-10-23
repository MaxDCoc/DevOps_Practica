"""Métricas de Prometheus. Lo implementa P3.

Hasta entonces son funciones vacías con la firma final.
"""

from typing import Any


def instrument_fastapi(app: Any, service_name: str) -> None:
    """Agrega a la app FastAPI las métricas HTTP (con la ruta como plantilla) y GET /metrics."""


def start_metrics_server(port: int) -> None:
    """Expone /metrics en un hilo aparte (lo usa el worker, que no es una app FastAPI)."""
