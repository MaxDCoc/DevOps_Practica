"""Punto de entrada del worker:  python -m app.worker"""

import logging
import os
import signal
import socket

from deployflow_common import factory
from deployflow_common.contract import ENV_LOG_LEVEL, ENV_RABBITMQ_URL, ENV_WORKER_METRICS_PORT
from deployflow_common.logging import setup_logging
from deployflow_common.messaging import DEFAULT_RABBITMQ_URL, Consumer
from deployflow_common.observability import setup_telemetry, shutdown_telemetry

from .http_server import start_heartbeat, start_http_server
from .processing import process

SERVICE_NAME = "worker"
DEFAULT_METRICS_PORT = 8000

logger = logging.getLogger("worker")


def main() -> None:
    setup_logging(SERVICE_NAME, os.environ.get(ENV_LOG_LEVEL, "INFO"))
    setup_telemetry(SERVICE_NAME)

    store = factory.get_job_store()
    server = start_http_server(int(os.environ.get(ENV_WORKER_METRICS_PORT, DEFAULT_METRICS_PORT)))
    stop_heartbeat = start_heartbeat(store, socket.gethostname())
    consumer = Consumer(
        os.environ.get(ENV_RABBITMQ_URL, DEFAULT_RABBITMQ_URL),
        lambda delivery: process(delivery, store),
    )

    # SIGTERM (docker stop / --scale hacia abajo): el trabajo en curso termina y recién ahí se sale.
    def shutdown(signum, _frame) -> None:
        logger.info("señal %s recibida: termino el trabajo en curso y salgo", signum)
        consumer.stop()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    logger.info("worker %s listo, esperando trabajos", socket.gethostname())
    try:
        consumer.run()
    finally:
        stop_heartbeat()
        server.shutdown()
        shutdown_telemetry()
        logger.info("worker detenido")


if __name__ == "__main__":
    main()
