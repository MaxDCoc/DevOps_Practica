"""Logs en JSON con trace_id. Lo implementa P3.

Hasta entonces configura el logging estándar en texto plano.
"""

import logging as std_logging


def setup_logging(service_name: str, level: str = "INFO") -> None:
    std_logging.basicConfig(
        level=level,
        format=f"%(asctime)s {service_name} %(levelname)s %(name)s: %(message)s",
    )
