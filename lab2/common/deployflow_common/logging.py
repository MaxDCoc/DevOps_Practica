"""Una línea JSON por evento, correlacionada con el span activo."""

import json
import logging as std_logging
import sys
from datetime import UTC, datetime

from opentelemetry import trace


class JsonFormatter(std_logging.Formatter):
    def __init__(self, service_name: str):
        super().__init__()
        self.service_name = service_name

    def format(self, record: std_logging.LogRecord) -> str:
        context = trace.get_current_span().get_span_context()
        entry = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname.lower(),
            "service": self.service_name,
            "logger": record.name,
            "msg": record.getMessage(),
            "trace_id": f"{context.trace_id:032x}" if context.is_valid else None,
            "span_id": f"{context.span_id:016x}" if context.is_valid else None,
        }
        for key in ("job_id", "stage", "error"):
            if hasattr(record, key):
                entry[key] = getattr(record, key)
        if record.exc_info:
            entry["error"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False, default=str)


def setup_logging(service_name: str, level: str = "INFO") -> None:
    """Un único console handler JSON; preserva capturadores y archivos ajenos."""
    root = std_logging.getLogger()
    root.setLevel(level.upper())
    handler = next((h for h in root.handlers if getattr(h, "_deployflow_json", False)), None)
    if handler is None:
        handler = std_logging.StreamHandler(sys.stderr)
        handler._deployflow_json = True
        root.addHandler(handler)
    else:
        handler.setStream(sys.stderr)
    handler.setFormatter(JsonFormatter(service_name))
    for existing in root.handlers[:]:
        if existing is handler or isinstance(existing, std_logging.FileHandler):
            continue
        # basicConfig usa StreamHandler. Las subclases de captura (p.ej.
        # pytest, con StringIO) y handlers de archivo no son consolas.
        console = type(existing) is std_logging.StreamHandler or (
            isinstance(existing, std_logging.StreamHandler)
            and existing.stream in (sys.stdout, sys.stderr, sys.__stdout__, sys.__stderr__)
        )
        if console:
            root.removeHandler(existing)
    # Uvicorn instala sus propios handlers antes del lifespan. Evitar texto plano
    # y duplicados, enviando sus eventos al handler JSON de la aplicación.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = std_logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
        logger.setLevel(level.upper())
