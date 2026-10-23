"""Los ejemplos de docs/contract-examples/ alimentan los mocks del dashboard y los tests de la API.

Si un ejemplo se desvía del contrato, el front se construye contra algo que la API real nunca devuelve.
"""

import json
from pathlib import Path

import pytest

from deployflow_common.contract import (
    AcceptedResponse,
    JobMessage,
    JobState,
    PipelineList,
    PipelineRequest,
    Stats,
    ValidationErrorResponse,
    ValidationResult,
)

EXAMPLES = Path(__file__).resolve().parents[2] / "docs" / "contract-examples"

MODEL_BY_FILE = {
    "pipeline-request.json": PipelineRequest,
    "pipeline-request-fail-at-test.json": PipelineRequest,
    "accepted-202.json": AcceptedResponse,
    "job-queued.json": JobState,
    "job-running.json": JobState,
    "job-succeeded.json": JobState,
    "job-failed.json": JobState,
    "validation-rejected-422.json": ValidationErrorResponse,
    "validate-rejected.json": ValidationResult,
    "pipelines-list.json": PipelineList,
    "stats.json": Stats,
    "job-message.json": JobMessage,
}


@pytest.mark.parametrize("name,model", sorted(MODEL_BY_FILE.items()))
def test_example_matches_its_model_field_for_field(name, model):
    raw = json.loads((EXAMPLES / name).read_text(encoding="utf-8"))

    parsed = model.model_validate(raw)

    # Pydantic ignora los campos desconocidos: comparar la salida con el original delata un
    # campo mal escrito o faltante en el ejemplo.
    assert parsed.model_dump(mode="json") == raw


def test_every_example_file_is_registered_in_this_test():
    on_disk = {path.name for path in EXAMPLES.glob("*.json")}

    assert on_disk == set(MODEL_BY_FILE)
