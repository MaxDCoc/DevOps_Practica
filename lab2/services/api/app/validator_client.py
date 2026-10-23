"""Cliente HTTP del servicio de validación."""

import os

import httpx
from deployflow_common.contract import ENV_VALIDATOR_URL, PipelineRequest, ValidationResult

DEFAULT_VALIDATOR_URL = "http://validator:8000"
TIMEOUT_SECONDS = 2.0


class ValidatorUnavailable(Exception):
    """El validador no contestó, o contestó algo ilegible: la API responde 503.

    Es distinto de que el validador diga "no": eso es un resultado de negocio (422).
    """


class ValidatorClient:
    def __init__(self, http: httpx.Client):
        self._http = http

    @classmethod
    def from_env(cls) -> "ValidatorClient":
        base_url = os.environ.get(ENV_VALIDATOR_URL, DEFAULT_VALIDATOR_URL)
        return cls(httpx.Client(base_url=base_url, timeout=TIMEOUT_SECONDS))

    def validate(self, pipeline: PipelineRequest) -> ValidationResult:
        try:
            response = self._http.post("/validate", json=pipeline.model_dump(mode="json"))
            response.raise_for_status()
            return ValidationResult.model_validate(response.json())
        except (httpx.HTTPError, ValueError) as exc:  # ValueError cubre JSON roto y forma inesperada
            raise ValidatorUnavailable(str(exc)) from exc
