"""Servidor HTTP mínimo del worker (/health y /metrics) y el latido que lo mantiene "vivo" en /stats."""

import json
import logging
import socket
import threading
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from deployflow_common.contract import WORKER_HEARTBEAT_INTERVAL_S
from deployflow_common.interfaces import JobStore
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from . import metrics  # noqa: F401 - al importarlo se registran las métricas del worker

logger = logging.getLogger("worker")


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/health":
            body = json.dumps({"status": "ok", "hostname": socket.gethostname()}).encode()
            self._reply(200, body, "application/json")
        elif path == "/metrics":
            self._reply(200, generate_latest(), CONTENT_TYPE_LATEST)
        else:
            self._reply(404, b"not found", "text/plain")

    def _reply(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - firma de la clase base
        pass  # Prometheus consulta cada pocos segundos: no llenar el log


def start_http_server(port: int) -> ThreadingHTTPServer:
    """Arranca el servidor en un hilo. Con port=0 el sistema operativo elige uno libre."""
    server = ThreadingHTTPServer(("0.0.0.0", port), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True, name="worker-http").start()
    return server


def start_heartbeat(
    store: JobStore,
    worker_id: str,
    interval: float = WORKER_HEARTBEAT_INTERVAL_S,
) -> Callable[[], None]:
    """Late una vez ya y después cada `interval` segundos. Devuelve la función que lo detiene."""

    def beat() -> None:
        try:
            store.heartbeat(worker_id)
        except Exception:  # noqa: BLE001 - un latido perdido no debe tirar abajo al worker
            logger.warning("no se pudo registrar el latido del worker", exc_info=True)

    stopping = threading.Event()

    def loop() -> None:
        while not stopping.wait(interval):
            beat()

    beat()
    thread = threading.Thread(target=loop, daemon=True, name="worker-heartbeat")
    thread.start()

    def stop() -> None:
        stopping.set()
        thread.join(timeout=2)

    return stop
