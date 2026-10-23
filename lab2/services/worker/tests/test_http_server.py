import json
import time
import urllib.error
import urllib.request

import pytest
from deployflow_common.contract import WORKER_HEARTBEAT_TTL_S
from deployflow_common.fakes import InMemoryJobStore

from app.http_server import start_heartbeat, start_http_server


def wait_until(condition, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.02)
    return False


def get(port: int, path: str) -> tuple[int, str]:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as response:
        return response.status, response.read().decode()


@pytest.fixture
def server():
    server = start_http_server(0)  # puerto 0: el sistema operativo elige uno libre
    yield server.server_address[1]
    server.shutdown()
    server.server_close()


def test_health_answers_ok(server):
    status, body = get(server, "/health")

    assert status == 200
    assert json.loads(body)["status"] == "ok"


def test_metrics_include_the_worker_metrics(server):
    status, body = get(server, "/metrics")

    assert status == 200
    assert "worker_jobs_in_progress" in body


def test_any_other_path_is_a_404(server):
    with pytest.raises(urllib.error.HTTPError) as error:
        get(server, "/nope")

    assert error.value.code == 404


def test_the_heartbeat_beats_at_once_and_keeps_beating_until_stopped(clock):
    store = InMemoryJobStore(clock=clock)

    stop = start_heartbeat(store, "worker-1", interval=0.05)
    assert store.live_workers() == 1  # el primer latido es inmediato

    clock.advance(WORKER_HEARTBEAT_TTL_S + 5)  # sin nuevos latidos, el worker ya figuraría muerto
    assert wait_until(lambda: store.live_workers() == 1)

    stop()
    clock.advance(WORKER_HEARTBEAT_TTL_S + 5)
    time.sleep(0.3)
    assert store.live_workers() == 0
