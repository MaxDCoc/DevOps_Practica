import json
import logging
from datetime import datetime

import pytest
from opentelemetry.sdk.trace import TracerProvider

from deployflow_common.logging import setup_logging


@pytest.fixture
def output(capsys):
    # Restaurar handlers ajenos (incluido caplog) al terminar cada prueba.
    root = logging.getLogger()
    loggers = [root, *(logging.getLogger(n) for n in ("uvicorn", "uvicorn.error", "uvicorn.access"))]
    previous = [(log, log.handlers[:], log.level, log.propagate) for log in loggers]
    yield capsys
    for log, handlers, level, propagate in previous:
        for handler in log.handlers:
            if handler not in handlers:
                handler.close()
        log.handlers = handlers
        log.setLevel(level)
        log.propagate = propagate


def test_json_logs_preserve_message_extras_and_active_span_ids(output):
    setup_logging("worker")
    provider = TracerProvider()
    try:
        with provider.get_tracer("test").start_as_current_span("stage test") as span:
            logging.getLogger("worker.runner").error(
                "falló %s\nsegunda línea", "test",
                extra={"job_id": "job-1", "stage": "test", "error": "simulado"},
            )
        lines = output.readouterr().err.splitlines()
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert datetime.fromisoformat(entry["ts"]).utcoffset().total_seconds() == 0
        assert entry["level"] == "error"
        assert entry["service"] == "worker"
        assert entry["logger"] == "worker.runner"
        assert entry["msg"] == "falló test\nsegunda línea"
        assert entry["trace_id"] == f"{span.get_span_context().trace_id:032x}"
        assert entry["span_id"] == f"{span.get_span_context().span_id:016x}"
        assert entry["job_id"] == "job-1"
        assert entry["stage"] == "test"
        assert entry["error"] == "simulado"
    finally:
        provider.shutdown()


def test_exception_is_json_on_one_line_and_missing_span_ids_are_null(output):
    setup_logging("api")
    try:
        raise ValueError("invalid\ninput")
    except ValueError:
        logging.getLogger("api").exception("no se pudo publicar")
    lines = output.readouterr().err.splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["trace_id"] is None
    assert entry["span_id"] is None
    assert "ValueError: invalid\ninput" in entry["error"]


def test_setup_is_idempotent_and_respects_log_level(output):
    setup_logging("validator", "WARNING")
    setup_logging("validator", "WARNING")
    logging.getLogger("validator").info("no debe salir")
    logging.getLogger("validator").warning("una vez")
    assert [json.loads(line)["msg"] for line in output.readouterr().err.splitlines()] == ["una vez"]


def test_preconfigured_console_handlers_do_not_duplicate_json_but_capture_is_preserved(output):
    root = logging.getLogger()
    # basicConfig (y muchos launchers) dejan un handler antes de setup_logging.
    console = logging.StreamHandler()
    root.addHandler(console)

    class Capture(logging.Handler):
        def __init__(self):
            super().__init__()
            self.records = []

        def emit(self, record):
            self.records.append(record)

    capture = Capture()
    root.addHandler(capture)
    try:
        setup_logging("api")
        setup_logging("api")
        try:
            raise ValueError("dos\nlíneas")
        except ValueError:
            logging.getLogger("api").exception("falló\nel pedido")
        lines = output.readouterr().err.splitlines()
        assert len(lines) == 1
        assert json.loads(lines[0])["level"] == "error"
        assert capture in root.handlers
        assert len(capture.records) == 1
    finally:
        root.removeHandler(capture)
        root.removeHandler(console)


def test_uvicorn_logs_use_the_same_json_output(output):
    setup_logging("api")
    logging.getLogger("uvicorn.error").info("servidor listo")
    entry = json.loads(output.readouterr().err)
    assert entry["service"] == "api"
    assert entry["logger"] == "uvicorn.error"
