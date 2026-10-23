import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client():
    return TestClient(create_app(latency_ms=0))


def test_a_valid_request_is_approved(client):
    response = client.post("/validate", json={"project": "shop-frontend"})

    assert response.status_code == 200
    assert response.json() == {"valid": True, "errors": []}


def test_a_rejected_request_is_still_a_200_carrying_the_errors(client):
    # Rechazar es un resultado de negocio, no una falla del servicio: la API distingue
    # 422 (pedido inválido) de 503 (validador caído) justamente por esto.
    response = client.post(
        "/validate",
        json={"project": "NOT valid!", "config": {"stage_seconds": 999}},
    )

    assert response.status_code == 200
    assert response.json() == {
        "valid": False,
        "errors": [
            "project: solo minúsculas, números y guiones (2 a 41 caracteres)",
            "config.stage_seconds: debe estar entre 1 y 30",
        ],
    }


def test_health_reports_ok_and_the_container_hostname(client):
    body = client.get("/health").json()

    assert body["status"] == "ok"
    assert body["hostname"]


def test_the_artificial_latency_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("VALIDATOR_LATENCY_MS", "300")
    client = TestClient(create_app())

    started = time.monotonic()
    client.post("/validate", json={"project": "shop-frontend"})

    assert time.monotonic() - started >= 0.25


def test_without_configuration_the_validator_is_slow_enough_to_show_up_in_a_trace(monkeypatch):
    monkeypatch.delenv("VALIDATOR_LATENCY_MS", raising=False)
    client = TestClient(create_app())

    started = time.monotonic()
    client.post("/validate", json={"project": "shop-frontend"})

    assert time.monotonic() - started >= 0.12
