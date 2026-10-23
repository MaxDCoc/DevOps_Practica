"""Reglas de negocio del validador.

Son funciones puras: devuelven la lista de errores, y la lista vacía significa que el pedido es válido.
"""

import re

from deployflow_common.contract import STAGES, PipelineRequest

# 2 a 41 caracteres: empieza con minúscula o dígito y sigue con minúsculas, dígitos o guiones.
# Se usa fullmatch porque `$` aceptaría un salto de línea al final.
PROJECT_PATTERN = re.compile(r"[a-z0-9][a-z0-9-]{1,40}")
MIN_STAGE_SECONDS = 1
MAX_STAGE_SECONDS = 30


def validate_request(request: PipelineRequest) -> list[str]:
    config = request.config
    errors: list[str] = []

    if not PROJECT_PATTERN.fullmatch(request.project):
        errors.append("project: solo minúsculas, números y guiones (2 a 41 caracteres)")

    errors.extend(_stage_errors(config.stages))

    if not MIN_STAGE_SECONDS <= config.stage_seconds <= MAX_STAGE_SECONDS:
        errors.append(f"config.stage_seconds: debe estar entre {MIN_STAGE_SECONDS} y {MAX_STAGE_SECONDS}")

    if config.fail_at is not None and config.fail_at not in config.stages:
        errors.append("config.fail_at: debe ser una de las etapas del pipeline o null")

    return errors


def _stage_errors(stages: list[str]) -> list[str]:
    if not stages:
        return ["config.stages: no puede estar vacío"]
    unknown = [stage for stage in stages if stage not in STAGES]
    if unknown:
        return [f"config.stages: etapas desconocidas {unknown} (válidas: {', '.join(STAGES)})"]
    positions = [STAGES.index(stage) for stage in stages]
    if positions != sorted(set(positions)):
        return [f"config.stages: deben ir en el orden {', '.join(STAGES)} y sin repetir"]
    return []
