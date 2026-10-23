from datetime import UTC, datetime, timedelta

import pytest
from deployflow_common.contract import JobState, PipelineRequest, build_job_message, new_job_state
from deployflow_common.interfaces import PublishError

T0 = datetime(2026, 10, 22, 15, 0, 0, tzinfo=UTC)


def job(job_id: str, seconds: int = 0) -> JobState:
    return new_job_state(job_id, PipelineRequest(project="shop-frontend"), now=T0 + timedelta(seconds=seconds))


def test_get_returns_the_stored_job(api):
    stored = job("job-1")
    api.store.create(stored)

    response = api.client.get("/pipelines/job-1")

    assert response.status_code == 200
    assert JobState.model_validate(response.json()) == stored


def test_get_of_an_unknown_job_is_a_404(api):
    response = api.client.get("/pipelines/nope")

    assert response.status_code == 404
    assert response.json() == {"detail": "pipeline no encontrado"}


def test_the_list_returns_the_newest_first_and_honours_the_limit(api):
    for job_id, seconds in (("job-b", 1), ("job-c", 2), ("job-a", 0)):
        api.store.create(job(job_id, seconds))

    response = api.client.get("/pipelines", params={"limit": 2})

    assert [item["job_id"] for item in response.json()["items"]] == ["job-c", "job-b"]


def test_the_list_shows_twenty_by_default(api):
    for number in range(25):
        api.store.create(job(f"job-{number:02d}", number))

    assert len(api.client.get("/pipelines").json()["items"]) == 20


@pytest.mark.parametrize("limit", [0, 101])
def test_the_list_rejects_a_limit_out_of_range(api, limit):
    assert api.client.get("/pipelines", params={"limit": limit}).status_code == 422


def test_stats_combine_job_counts_queue_depth_and_live_workers(api):
    api.store.create(job("queued-job"))
    api.store.create(job("running-job", 1))
    api.store.begin_attempt("running-job")
    api.store.heartbeat("worker-1")
    api.store.heartbeat("worker-2")
    for job_id in ("job-x", "job-y"):
        api.publisher.publish_job(build_job_message(job_id, PipelineRequest(project="shop-frontend"), T0))

    response = api.client.get("/stats")

    assert response.status_code == 200
    assert response.json() == {
        "counts": {"queued": 1, "running": 1, "succeeded": 0, "failed": 0},
        "queue_depth": 2,
        "workers": 2,
    }


def test_stats_say_503_when_the_queue_cannot_be_reached(api):
    def unreachable():
        raise PublishError("broker caído")

    api.publisher.queue_depth = unreachable

    assert api.client.get("/stats").status_code == 503


def test_health_reports_ok_and_the_container_hostname(api):
    body = api.client.get("/health").json()

    assert body["status"] == "ok"
    assert body["hostname"]


def test_swagger_offers_ready_to_run_examples_for_the_success_and_the_failure_demo(api):
    schema = api.app.openapi()
    examples = schema["paths"]["/pipelines"]["post"]["requestBody"]["content"]["application/json"]["examples"]

    values = [example["value"] for example in examples.values()]
    # FastAPI omite los None al generar el ejemplo: "sin fail_at" y "fail_at null" son lo mismo.
    assert any(value["config"].get("fail_at") is None for value in values)
    assert any(value["config"].get("fail_at") == "test" for value in values)
    for value in values:
        PipelineRequest.model_validate(value)
