import json

import httpx
import pytest
from deployflow_common.contract import PipelineRequest, ValidationResult
from validator_doubles import (
    connect_error,
    not_json,
    read_timeout,
    server_error,
    wrong_shape,
)

from app.validator_client import ValidatorClient, ValidatorUnavailable


def client_with(handler) -> ValidatorClient:
    http = httpx.Client(base_url="http://validator", transport=httpx.MockTransport(handler))
    return ValidatorClient(http)


def test_it_posts_the_request_to_validate_and_returns_the_verdict():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"valid": False, "errors": ["project: mal"]})

    verdict = client_with(handler).validate(PipelineRequest(project="shop-frontend"))

    assert (seen["method"], seen["path"]) == ("POST", "/validate")
    assert seen["body"] == {
        "project": "shop-frontend",
        "branch": "main",
        "config": {"stages": ["build", "test", "deploy"], "stage_seconds": 3, "fail_at": None},
    }
    assert verdict == ValidationResult(valid=False, errors=["project: mal"])


@pytest.mark.parametrize(
    "handler",
    [connect_error, read_timeout, server_error, not_json, wrong_shape],
    ids=["sin conexión", "timeout", "500", "no es JSON", "forma inesperada"],
)
def test_any_failure_to_obtain_a_verdict_is_reported_as_unavailable(handler):
    # La API necesita distinguir "el validador dijo que no" (422) de "no pude preguntarle" (503).
    with pytest.raises(ValidatorUnavailable):
        client_with(handler).validate(PipelineRequest(project="shop-frontend"))
