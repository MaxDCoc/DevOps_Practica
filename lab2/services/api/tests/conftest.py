import httpx
import pytest
from deployflow_common.fakes import FakePublisher, InMemoryJobStore
from fastapi.testclient import TestClient
from validator_doubles import approving

from app import main
from app.validator_client import ValidatorClient


class ApiHarness:
    """La API armada con dobles: estado en memoria, publisher falso y un validador simulado por HTTP."""

    def __init__(self, validator_handler=approving):
        self.store = InMemoryJobStore()
        self.publisher = FakePublisher()
        self.validator_requests: list[httpx.Request] = []

        def recording(request: httpx.Request) -> httpx.Response:
            self.validator_requests.append(request)
            return validator_handler(request)

        validator = ValidatorClient(
            httpx.Client(base_url="http://validator", transport=httpx.MockTransport(recording))
        )
        self.app = main.create_app()
        self.app.dependency_overrides[main.get_store] = lambda: self.store
        self.app.dependency_overrides[main.get_publisher] = lambda: self.publisher
        self.app.dependency_overrides[main.get_validator] = lambda: validator
        self.client = TestClient(self.app)


@pytest.fixture
def make_api():
    """Fábrica: make_api(handler) arma la API con otro comportamiento del validador."""
    return ApiHarness


@pytest.fixture
def api() -> ApiHarness:
    return ApiHarness()
