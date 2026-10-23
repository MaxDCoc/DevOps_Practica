import asyncio
import json
import time
import uuid
from pathlib import Path

import httpx
import pytest
from prometheus_client import REGISTRY
from validator_doubles import connect_error, read_timeout, rejecting, server_error

EXAMPLES = Path(__file__).resolve().parents[3] / "docs" / "contract-examples"
REJECTION = json.loads((EXAMPLES / "validation-rejected-422.json").read_text(encoding="utf-8"))
DEMO = {"project": "shop-frontend"}


def post(api, body=DEMO):
    return api.client.post("/pipelines", json=body)


def test_a_valid_request_is_accepted_with_a_job_id_and_its_location(api):
    response = post(api)

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "queued"
    uuid.UUID(body["job_id"])
    assert "trace_id" in body
    assert response.headers["location"] == f"/pipelines/{body['job_id']}"


def test_the_job_is_stored_as_queued_and_its_message_is_published(api):
    job_id = post(api).json()["job_id"]

    stored = api.store.get(job_id)
    assert (stored.status, stored.project, stored.branch) == ("queued", "shop-frontend", "main")
    assert [stage.name for stage in stored.stages] == ["build", "test", "deploy"]
    [message] = api.publisher.published
    assert message.job_id == job_id
    assert message.submitted_at == stored.submitted_at


def test_the_published_message_carries_the_requested_configuration(api):
    post(
        api,
        {
            "project": "shop-frontend",
            "branch": "dev",
            "config": {"stages": ["build", "test"], "stage_seconds": 5, "fail_at": "test"},
        },
    )

    [message] = api.publisher.published
    assert message.branch == "dev"
    assert message.config.model_dump() == {"stages": ["build", "test"], "stage_seconds": 5, "fail_at": "test"}


def test_the_job_is_stored_before_its_message_is_published(api):
    # El worker puede tomar el mensaje al instante: el estado "queued" ya tiene que existir.
    seen_when_published = []
    publish = api.publisher.publish_job

    def spying_publish(message):
        seen_when_published.append(api.store.get(message.job_id))
        publish(message)

    api.publisher.publish_job = spying_publish

    post(api)

    assert seen_when_published[0] is not None
    assert seen_when_published[0].status == "queued"


def test_the_validator_is_asked_about_the_request_as_sent(api):
    post(api)

    [asked] = api.validator_requests
    assert json.loads(asked.content) == {
        "project": "shop-frontend",
        "branch": "main",
        "config": {"stages": ["build", "test", "deploy"], "stage_seconds": 3, "fail_at": None},
    }


def test_a_request_the_validator_rejects_gets_a_422_with_its_errors_and_creates_nothing(make_api):
    api = make_api(rejecting(REJECTION["detail"]["errors"]))

    response = post(api, {"project": "NOT valid!"})

    assert response.status_code == 422
    assert response.json() == REJECTION
    assert api.store.list_recent() == []
    assert api.publisher.published == []


@pytest.mark.parametrize("handler", [connect_error, read_timeout, server_error], ids=["sin conexión", "timeout", "500"])
def test_when_the_validator_cannot_answer_the_api_says_503_and_creates_nothing(make_api, handler):
    api = make_api(handler)

    response = post(api)

    assert response.status_code == 503
    assert api.store.list_recent() == []
    assert api.publisher.published == []


def test_when_the_queue_is_down_the_api_says_503_and_leaves_the_job_marked_failed(api):
    api.publisher.fail = True

    response = post(api)

    assert response.status_code == 503
    [job] = api.store.list_recent()
    assert job.status == "failed"
    assert job.error
    assert api.publisher.published == []


def test_an_unexpected_publish_bug_is_not_disguised_as_a_503_and_does_not_leave_the_job_queued(api):
    def buggy_publish(message):
        raise RuntimeError("bug en el publisher")

    api.publisher.publish_job = buggy_publish

    with pytest.raises(RuntimeError, match="bug en el publisher"):
        post(api)

    [job] = api.store.list_recent()
    assert job.status == "failed"


def submitted(result: str) -> float:
    return REGISTRY.get_sample_value("pipelines_submitted_total", {"result": result}) or 0.0


def test_every_outcome_is_counted_in_pipelines_submitted(make_api):
    before = {result: submitted(result) for result in ("accepted", "rejected", "error")}

    post(make_api())
    post(make_api(rejecting(["project: mal"])))
    post(make_api(connect_error))
    queue_down = make_api()
    queue_down.publisher.fail = True
    post(queue_down)

    assert submitted("accepted") - before["accepted"] == 1
    assert submitted("rejected") - before["rejected"] == 1
    assert submitted("error") - before["error"] == 2  # validador caído + cola caída


def test_a_slow_publish_does_not_block_other_requests(api):
    # pika es bloqueante: si los endpoints fueran `async def`, una publicación lenta congelaría
    # el servidor entero. Dos pedidos en paralelo tienen que tardar ~0,4 s, no ~0,8 s.
    def slow_publish(message):
        time.sleep(0.4)

    api.publisher.publish_job = slow_publish

    async def two_at_once() -> float:
        transport = httpx.ASGITransport(app=api.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
            started = time.monotonic()
            await asyncio.gather(*(client.post("/pipelines", json=DEMO) for _ in range(2)))
            return time.monotonic() - started

    assert asyncio.run(two_at_once()) < 0.7
