import json
from pathlib import Path

import pytest
from deployflow_common.contract import PipelineRequest

from app.rules import validate_request

EXAMPLES = Path(__file__).resolve().parents[3] / "docs" / "contract-examples"


def request(project="shop-frontend", stages=None, stage_seconds=3, fail_at=None):
    config = {"stage_seconds": stage_seconds, "fail_at": fail_at}
    if stages is not None:
        config["stages"] = stages
    return PipelineRequest.model_validate({"project": project, "config": config})


def test_the_default_demo_request_is_valid():
    assert validate_request(PipelineRequest(project="shop-frontend")) == []


@pytest.mark.parametrize("project", ["ab", "a1", "shop-frontend", "a" + "b" * 40, "9lives"])
def test_valid_project_names(project):
    assert validate_request(request(project=project)) == []


@pytest.mark.parametrize(
    "project",
    ["", "a", "a" + "b" * 41, "Shop", "shop frontend", "shop_frontend", "-shop", "shop\n", "tienda-ñandú"],
)
def test_invalid_project_names_are_reported_against_the_project_field(project):
    errors = validate_request(request(project=project))

    assert len(errors) == 1
    assert errors[0].startswith("project:")


@pytest.mark.parametrize(
    "stages",
    [["build"], ["test"], ["deploy"], ["build", "test"], ["build", "deploy"], ["test", "deploy"], ["build", "test", "deploy"]],
)
def test_any_ordered_subset_of_the_stages_is_valid(stages):
    assert validate_request(request(stages=stages)) == []


@pytest.mark.parametrize(
    "stages",
    [[], ["lint"], ["build", "lint"], ["test", "build"], ["build", "build"], ["deploy", "build", "test"]],
)
def test_invalid_stage_lists_are_reported_against_the_stages_field(stages):
    errors = validate_request(request(stages=stages))

    assert len(errors) == 1
    assert errors[0].startswith("config.stages:")


@pytest.mark.parametrize("seconds", [1, 3, 30])
def test_valid_stage_durations(seconds):
    assert validate_request(request(stage_seconds=seconds)) == []


@pytest.mark.parametrize("seconds", [0, -1, 31, 999])
def test_out_of_range_stage_durations_are_reported_against_stage_seconds(seconds):
    errors = validate_request(request(stage_seconds=seconds))

    assert len(errors) == 1
    assert errors[0].startswith("config.stage_seconds:")


def test_fail_at_must_be_one_of_the_requested_stages():
    assert validate_request(request(fail_at="test")) == []
    assert validate_request(request(stages=["build", "test"], fail_at="test")) == []

    for bad in (request(fail_at="nope"), request(stages=["build", "deploy"], fail_at="test")):
        errors = validate_request(bad)
        assert len(errors) == 1
        assert errors[0].startswith("config.fail_at:")


def test_every_broken_rule_is_reported_in_one_pass_with_the_documented_messages():
    # Los mensajes exactos son parte del contrato: salen en el 422 de la API y en el ejemplo del front.
    expected = json.loads((EXAMPLES / "validate-rejected.json").read_text(encoding="utf-8"))["errors"]

    errors = validate_request(request(project="NOT valid!", stage_seconds=999))

    assert errors == expected
