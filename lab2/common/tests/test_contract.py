import json

from deployflow_common.contract import (
    JobMessage,
    PipelineConfig,
    PipelineRequest,
    build_job_message,
    new_job_state,
)


def test_a_request_with_only_a_project_gets_the_demo_defaults():
    request = PipelineRequest(project="shop-frontend")

    assert request.branch == "main"
    assert request.config.stages == ["build", "test", "deploy"]
    assert request.config.stage_seconds == 3
    assert request.config.fail_at is None


def test_the_model_accepts_values_that_only_the_validator_may_reject():
    # El rechazo de negocio es del servicio de validación (422 con sus errores). Si el modelo ya
    # los rechazara, FastAPI contestaría con su propio 422 y el validador nunca se consultaría.
    request = PipelineRequest.model_validate(
        {
            "project": "NOT valid!",
            "config": {"stages": ["lint"], "stage_seconds": 999, "fail_at": "nope"},
        }
    )

    assert request.project == "NOT valid!"
    assert request.config.stages == ["lint"]
    assert request.config.stage_seconds == 999
    assert request.config.fail_at == "nope"


def test_a_new_job_is_queued_with_every_requested_stage_pending(t0):
    request = PipelineRequest(project="shop-frontend", config=PipelineConfig(stages=["build", "test"]))

    state = new_job_state("job-1", request, trace_id="abc", now=t0)

    assert state.status == "queued"
    assert state.current_stage is None
    assert state.attempts == 0
    assert [(s.name, s.status) for s in state.stages] == [("build", "pending"), ("test", "pending")]
    assert (state.project, state.branch, state.trace_id) == ("shop-frontend", "main", "abc")
    assert state.submitted_at == t0
    assert state.finished_at is None


def test_timestamps_travel_as_iso_8601_utc(t0):
    state = new_job_state("job-1", PipelineRequest(project="shop-frontend"), now=t0)

    assert json.loads(state.model_dump_json())["submitted_at"] == "2026-10-22T15:00:00Z"


def test_the_queue_message_has_exactly_the_agreed_fields(t0):
    request = PipelineRequest(
        project="shop-frontend",
        branch="dev",
        config=PipelineConfig(stages=["build", "test"], stage_seconds=5, fail_at="test"),
    )

    message = build_job_message("job-1", request, submitted_at=t0)

    # Es lo que el worker de P2 lee de RabbitMQ: agregar o quitar un campo rompe ese acuerdo.
    assert json.loads(message.model_dump_json()) == {
        "job_id": "job-1",
        "project": "shop-frontend",
        "branch": "dev",
        "config": {"stages": ["build", "test"], "stage_seconds": 5, "fail_at": "test"},
        "submitted_at": "2026-10-22T15:00:00Z",
    }
    assert JobMessage.model_validate_json(message.model_dump_json()) == message
