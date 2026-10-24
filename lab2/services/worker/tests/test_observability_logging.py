import io
import json
import logging

from deployflow_common.logging import JsonFormatter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from app.runner import run_pipeline


def test_a_controlled_stage_failure_logs_its_job_and_active_trace(store, sleep, enqueue):
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter("worker"))
    logger = logging.getLogger("worker")
    logger.addHandler(handler)
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    try:
        outcome = run_pipeline(enqueue(fail_at="test"), store, sleep=sleep, tracer=provider.get_tracer("test"))
        assert outcome.status == "failed"
        entries = [json.loads(line) for line in stream.getvalue().splitlines()]
        errors = [entry for entry in entries if entry["level"] == "error"]
        assert len(errors) == 1
        entry = errors[0]
        assert entry["job_id"] == "job-1"
        assert entry["stage"] == "test"
        assert entry["error"]
        stage = next(s for s in exporter.get_finished_spans() if s.name == "stage test")
        assert entry["trace_id"] == f"{stage.context.trace_id:032x}"
        assert entry["span_id"] == f"{stage.context.span_id:016x}"
    finally:
        logger.removeHandler(handler)
        handler.close()
        provider.shutdown()
