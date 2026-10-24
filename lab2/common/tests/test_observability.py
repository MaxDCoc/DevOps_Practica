"""Contrato P3: perder el contexto o no vaciar el batch debe romper estos tests."""

import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import grpc
import pytest
from opentelemetry import trace
from opentelemetry.proto.collector.trace.v1 import trace_service_pb2, trace_service_pb2_grpc
from opentelemetry.sdk.trace import TracerProvider

from deployflow_common import observability

TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"


def test_inject_extract_preserves_the_active_trace_and_existing_amqp_headers():
    provider = TracerProvider()
    try:
        with provider.get_tracer("test").start_as_current_span("publish") as span:
            headers = observability.inject_trace_context({"x-attempt": 1})
            assert headers["x-attempt"] == 1
            assert observability.current_trace_id() == f"{span.get_span_context().trace_id:032x}"
            context = observability.extract_trace_context(headers)
            parent = trace.get_current_span(context).get_span_context()
            assert parent.trace_id == span.get_span_context().trace_id
            assert parent.span_id == span.get_span_context().span_id
            assert parent.is_remote
    finally:
        provider.shutdown()
    assert observability.current_trace_id() is None


@pytest.mark.parametrize("headers", [
    {"traceparent": TRACEPARENT},
    {b"traceparent": TRACEPARENT.encode(), b"tracestate": b"vendor=value"},
    {"traceparent": TRACEPARENT.encode()},
])
def test_amqp_text_and_bytes_headers_continue_the_same_trace(headers):
    context = observability.extract_trace_context(headers)
    parent = trace.get_current_span(context).get_span_context()
    assert parent.trace_id == 0x4BF92F3577B34DA6A3CE929D0E0E4736
    assert parent.span_id == 0x00F067AA0BA902B7


@pytest.mark.parametrize("headers", [None, {}, {"traceparent": "invalid"}, {"traceparent": b"\xff"}, {"traceparent": 123}])
def test_missing_or_bad_headers_do_not_inherit_an_unrelated_active_span(headers):
    provider = TracerProvider()
    try:
        with provider.get_tracer("test").start_as_current_span("unrelated"):
            context = observability.extract_trace_context(headers)
            assert not trace.get_current_span(context).get_span_context().is_valid
    finally:
        provider.shutdown()


class Collector(trace_service_pb2_grpc.TraceServiceServicer):
    def __init__(self):
        self.batches = []

    def Export(self, request, context):
        self.batches.extend(request.resource_spans)
        return trace_service_pb2.ExportTraceServiceResponse()


def test_setup_exports_a_named_resource_and_shutdown_flushes_the_last_span():
    # gRPC real: un exportador apagado, un resource incorrecto o batch perdido fallan acá.
    collector = Collector()
    server = grpc.server(ThreadPoolExecutor(max_workers=1))
    trace_service_pb2_grpc.add_TraceServiceServicer_to_server(collector, server)
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    try:
        result = subprocess.run(
            [sys.executable, "-c", """
from opentelemetry import trace
from deployflow_common.observability import setup_telemetry, shutdown_telemetry
tracer = trace.get_tracer('created-before-setup')
setup_telemetry('api')
setup_telemetry('api')
with tracer.start_as_current_span('last job'):
    pass
shutdown_telemetry()
shutdown_telemetry()
"""],
            env={**os.environ, "TELEMETRY": "on", "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{port}"},
            capture_output=True, text=True, timeout=20,
        )
        assert result.returncode == 0, result.stderr
        assert "Overriding" not in result.stderr
        resources = collector.batches
        assert len(resources) == 1
        attributes = {a.key: a.value.string_value for a in resources[0].resource.attributes}
        assert attributes["service.name"] == "api"
        spans = [s for batch in resources for scope in batch.scope_spans for s in scope.spans]
        assert [s.name for s in spans] == ["last job"]
    finally:
        server.stop(0).wait()


def test_off_does_not_install_a_recording_provider():
    result = subprocess.run([sys.executable, "-c", """
from opentelemetry import trace
from deployflow_common.observability import setup_telemetry, shutdown_telemetry, current_trace_id
setup_telemetry('api')
with trace.get_tracer('test').start_as_current_span('off') as span:
    assert not span.is_recording()
    assert current_trace_id() is None
shutdown_telemetry()
"""], env={**os.environ, "TELEMETRY": "off"}, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr


def test_unknown_telemetry_switch_is_rejected(monkeypatch):
    monkeypatch.setenv("TELEMETRY", "typo")
    with pytest.raises(ValueError, match="TELEMETRY"):
        observability.setup_telemetry("api")
