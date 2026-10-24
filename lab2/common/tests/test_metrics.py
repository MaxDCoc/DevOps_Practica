import os
import socket
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry import trace
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind, StatusCode
from prometheus_client.parser import text_string_to_metric_families

from deployflow_common.metrics import instrument_fastapi
from deployflow_common.observability import current_trace_id


@pytest.fixture(autouse=True)
def no_remote_export(monkeypatch):
    monkeypatch.setenv("TELEMETRY", "off")


def values(client, name):
    response = client.get("/metrics")
    assert response.status_code == 200
    assert "text/plain" in response.headers["content-type"]
    return [sample for family in text_string_to_metric_families(response.text) for sample in family.samples if sample.name == name]


def sample(client, name, **labels):
    return sum(s.value for s in values(client, name) if all(s.labels.get(k) == v for k, v in labels.items()))


def test_dynamic_routes_are_aggregated_by_template_not_job_id():
    app = FastAPI()
    instrument_fastapi(app, "api")

    @app.get("/jobs/{job_id}")
    def job(job_id: str):
        return {"job_id": job_id}

    with TestClient(app) as client:
        before = sample(client, "http_requests_total", route="/jobs/{job_id}", method="GET", status="200")
        assert client.get("/jobs/one").status_code == 200
        assert client.get("/jobs/two").status_code == 200
        assert sample(client, "http_requests_total", route="/jobs/{job_id}", method="GET", status="200") - before == 2
        assert sample(client, "http_request_duration_seconds_count", route="/jobs/{job_id}", method="GET") >= 2
        assert not any(s.labels.get("route") in ("/jobs/one", "/jobs/two") for s in values(client, "http_requests_total"))


def test_unmatched_paths_have_bounded_cardinality_and_errors_are_counted():
    app = FastAPI()
    instrument_fastapi(app, "api")

    @app.get("/broken")
    def broken():
        raise RuntimeError("broken")

    with TestClient(app, raise_server_exceptions=False) as client:
        missing = sample(client, "http_requests_total", route="__unmatched__", status="404")
        errors = sample(client, "http_requests_total", route="/broken", status="500")
        assert client.get("/unknown/one").status_code == 404
        assert client.get("/unknown/two").status_code == 404
        assert client.get("/broken").status_code == 500
        assert sample(client, "http_requests_total", route="__unmatched__", status="404") - missing == 2
        assert sample(client, "http_requests_total", route="/broken", status="500") - errors == 1


def test_repeated_instrumentation_and_multiple_apps_do_not_duplicate_metrics():
    for _ in range(2):
        app = FastAPI()
        instrument_fastapi(app, "api")
        instrument_fastapi(app, "api")

        @app.get("/once")
        def once():
            return {}

        with TestClient(app) as client:
            before = sample(client, "http_requests_total", route="/once", status="200")
            client.get("/once")
            assert sample(client, "http_requests_total", route="/once", status="200") - before == 1
            assert len([r for r in app.routes if r.path == "/metrics"]) == 1


def test_health_and_scrapes_do_not_pollute_business_http_metrics():
    app = FastAPI()
    instrument_fastapi(app, "validator")

    @app.get("/health")
    def health():
        return {"status": "ok"}

    with TestClient(app) as client:
        client.get("/health")
        client.get("/metrics")
        assert not any(s.labels.get("route") in ("/metrics", "/health") for s in values(client, "http_requests_total"))


def test_fastapi_and_httpx_propagate_the_incoming_trace_and_record_errors(monkeypatch):
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setenv("TELEMETRY", "on")
    monkeypatch.setattr(trace, "get_tracer_provider", lambda: provider)
    incoming_headers = []

    class Validator(BaseHTTPRequestHandler):
        def do_POST(self):
            incoming_headers.append(self.headers.get("traceparent"))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Validator)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    app = FastAPI()
    instrument_fastapi(app, "api")

    @app.post("/pipelines")
    def submit():
        with httpx.Client() as http:
            http.post(f"http://127.0.0.1:{server.server_port}/validate")
        return {"trace_id": current_trace_id()}

    @app.get("/error")
    def error():
        raise ValueError("test")

    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.post("/pipelines", headers={"traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"})
            assert response.json()["trace_id"] == "4bf92f3577b34da6a3ce929d0e0e4736"
            assert incoming_headers[0].split("-")[1] == "4bf92f3577b34da6a3ce929d0e0e4736"
            assert client.get("/error").status_code == 500
        spans = exporter.get_finished_spans()
        server_span = next(s for s in spans if s.kind == SpanKind.SERVER and s.name == "POST /pipelines")
        outgoing = next(s for s in spans if s.kind == SpanKind.CLIENT)
        assert outgoing.parent.span_id == server_span.context.span_id
        assert outgoing.context.trace_id == server_span.context.trace_id
        assert any(s.kind == SpanKind.SERVER and s.status.status_code == StatusCode.ERROR for s in spans)
    finally:
        HTTPXClientInstrumentor().uninstrument()
        server.shutdown()
        server.server_close()
        thread.join()
        provider.shutdown()


def test_auxiliary_metrics_server_exposes_the_default_registry():
    # El helper conserva el contrato, pero no reemplaza el servidor existente del worker.
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    result = subprocess.run([sys.executable, "-c", f"""
import urllib.request
from prometheus_client import Counter
from deployflow_common.metrics import start_metrics_server
Counter('helper_probe_total', 'probe').inc()
start_metrics_server({port})
with urllib.request.urlopen('http://127.0.0.1:{port}/metrics', timeout=3) as response:
    assert response.status == 200
    assert b'helper_probe_total 1.0' in response.read()
"""], env={**os.environ, "TELEMETRY": "off"}, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
