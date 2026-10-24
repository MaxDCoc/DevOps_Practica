"""Pruebas opt-in contra el compose local real (no levantan ni borran servicios).

Desde lab2/: .venv/bin/python -m pytest observability/check_local.py -v
Con tres workers: EXPECTED_WORKERS=3 .venv/bin/python -m pytest observability/check_local.py -v
No ejecutar simultáneamente los tests de common: purgan las colas del contrato.
"""

import json
import os
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pytest

LAB2 = Path(__file__).resolve().parents[1]
API = "http://127.0.0.1:8000"
JAEGER = "http://127.0.0.1:16686"
PROMETHEUS = "http://127.0.0.1:9090"


def get_json(url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = Request(url, data=data, headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=5) as response:
        return response.status, json.load(response)


def eventually(probe, timeout=40):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        last = probe()
        if last:
            return last
        time.sleep(0.5)
    pytest.fail(f"La condición no se cumplió en {timeout} s; último resultado: {last!r}")


def query(expression):
    _, body = get_json(PROMETHEUS + "/api/v1/query?" + urlencode({"query": expression}))
    assert body["status"] == "success", body
    return body["data"]["result"]


def counter(expression):
    return sum(float(item["value"][1]) for item in query(expression))


def complete_trace(trace_id, failed):
    try:
        _, body = get_json(JAEGER + "/api/traces/" + trace_id)
    except HTTPError as exc:
        if exc.code == 404:
            return None
        raise
    data = body.get("data", [])
    # Cada proceso exporta su batch en momentos distintos: encontrar el span
    # del worker no garantiza que el batch del validador ya haya llegado.
    required = {"POST /pipelines", "POST", "POST /validate", "publish pipeline.jobs",
                "process pipeline.jobs", "stage build", "stage test"}
    if not failed:
        required.add("stage deploy")
    if data and required <= {s["operationName"] for s in data[0]["spans"]}:
        return data[0]
    return None


@pytest.fixture(scope="module")
def executions():
    failed_before = counter('pipeline_jobs_total{status="failed"}')
    jobs = {}
    for name, fail_at in (("success", None), ("failure", "test")):
        started = time.monotonic()
        status, accepted = get_json(API + "/pipelines", {
            "project": "p3-local", "config": {"stage_seconds": 1, "fail_at": fail_at},
        })
        assert status == 202
        assert len(accepted["trace_id"]) == 32
        elapsed = time.monotonic() - started

        def finished():
            _, state = get_json(API + "/pipelines/" + accepted["job_id"])
            return state if state["status"] in ("succeeded", "failed") else None

        state = eventually(finished)
        data = eventually(lambda: complete_trace(accepted["trace_id"], failed=fail_at is not None))
        jobs[name] = {"accepted": accepted, "state": state, "trace": data, "response_seconds": elapsed}
    jobs["failed_before"] = failed_before
    return jobs


def tags(span):
    return {tag["key"]: tag["value"] for tag in span["tags"]}


def test_success_is_one_trace_with_the_correct_parent_chain(executions):
    job = executions["success"]
    assert job["state"]["status"] == "succeeded"
    trace_id = job["accepted"]["trace_id"]
    assert job["state"]["trace_id"] == trace_id
    data = job["trace"]
    assert {p["serviceName"] for p in data["processes"].values()} == {"api", "validator", "worker"}
    spans = {s["operationName"]: s for s in data["spans"]}
    assert {"POST /pipelines", "POST", "POST /validate", "publish pipeline.jobs", "process pipeline.jobs", "stage build", "stage test", "stage deploy"} <= spans.keys()
    for child, parent in (("POST", "POST /pipelines"), ("POST /validate", "POST"),
                          ("publish pipeline.jobs", "POST /pipelines"),
                          ("process pipeline.jobs", "publish pipeline.jobs"),
                          ("stage build", "process pipeline.jobs"),
                          ("stage test", "process pipeline.jobs"),
                          ("stage deploy", "process pipeline.jobs")):
        assert any(ref["spanID"] == spans[parent]["spanID"] for ref in spans[child]["references"])
    assert all(s["traceID"] == trace_id for s in data["spans"])
    assert tags(spans["publish pipeline.jobs"])["span.kind"] == "producer"
    assert tags(spans["process pipeline.jobs"])["span.kind"] == "consumer"
    print(f"\nOK: {job['accepted']['job_id']}, respuesta {job['response_seconds']:.3f} s, traza {JAEGER}/trace/{trace_id}")


def test_failure_has_an_error_span_and_correlated_json_log(executions):
    job = executions["failure"]
    assert job["state"]["status"] == "failed"
    spans = {s["operationName"]: s for s in job["trace"]["spans"]}
    assert "stage deploy" not in spans
    stage = spans["stage test"]
    assert tags(stage)["error"] is True
    assert any(field["key"] == "exception.type" for event in stage["logs"] for field in event["fields"])
    result = subprocess.run(
        ["docker", "compose", "-f", "docker-compose.yml", "-f", "observability/compose.local.yml",
         "logs", "--no-color", "--no-log-prefix", "worker"],
        cwd=LAB2, check=True, capture_output=True, text=True, timeout=15,
    )
    entries = [json.loads(line) for line in result.stdout.splitlines() if line.startswith("{")]
    matching = [e for e in entries if e.get("job_id") == job["accepted"]["job_id"] and e.get("level") == "error"]
    assert len(matching) == 1
    assert matching[0]["trace_id"] == job["accepted"]["trace_id"]
    assert matching[0]["span_id"] == stage["spanID"]
    assert matching[0]["stage"] == "test"
    assert matching[0]["service"] == "worker"
    print(f"\nFALLO: traza {JAEGER}/trace/{job['accepted']['trace_id']}")


def test_prometheus_scrapes_all_services_and_expected_worker_replicas():
    expected = int(os.environ.get("EXPECTED_WORKERS", "1"))

    def healthy_targets():
        _, body = get_json(PROMETHEUS + "/api/v1/targets")
        targets = body["data"]["activeTargets"]
        for job, count in (("api", 1), ("validator", 1), ("rabbitmq", 1), ("rabbitmq-queues", 1), ("worker", expected)):
            group = [t for t in targets if t["labels"]["job"] == job]
            if len(group) != count or any(t["health"] != "up" for t in group):
                return None
        return targets

    eventually(healthy_targets)
    assert counter('sum(up{job="worker"})') == expected


def test_pipeline_failure_increments_prometheus_counter(executions):
    eventually(lambda: counter('pipeline_jobs_total{status="failed"}') >= executions["failed_before"] + 1)
    assert counter('pipeline_stage_failures_total{stage="test"}') >= 1


def test_queue_specific_metrics_are_available():
    eventually(lambda: query('rabbitmq_detailed_queue_messages_ready{job="rabbitmq-queues",queue="pipeline.jobs",vhost="/"}'))
