"""Demo de la plataforma DeployFlow, sin observabilidad.

Desde lab2/, con el compose arriba:

    python scripts/demo.py ok
    python scripts/demo.py fail
    python scripts/demo.py burst --n 30
    python scripts/demo.py scale 3

`scale` llama a Docker. El resto solo habla con la API en el host.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "docs" / "contract-examples"
DEFAULT_API = "http://127.0.0.1:8000"


def main() -> None:
    parser = argparse.ArgumentParser(description="Demo de DeployFlow (API, cola y worker).")
    parser.add_argument("--api", default=DEFAULT_API, help=f"base de la API (default {DEFAULT_API})")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("ok", help="un pipeline que termina succeeded")
    sub.add_parser("fail", help="un pipeline que falla en test y deja deploy pending")

    burst = sub.add_parser("burst", help="varios pipelines seguidos")
    burst.add_argument("--n", type=int, default=30, help="cuántos pedidos (default 30)")

    scale = sub.add_parser("scale", help="levanta N workers y espera a verlos en /stats")
    scale.add_argument("workers", type=int, nargs="?", default=3)

    args = parser.parse_args()
    api = args.api.rstrip("/")

    if args.command == "ok":
        final = run_example(api, EXAMPLES / "pipeline-request.json")
        expect(final["status"] == "succeeded", f"esperaba succeeded y llegó {final['status']}", final)
        print(f"ok  {final['job_id']}  succeeded")
    elif args.command == "fail":
        final = run_example(api, EXAMPLES / "pipeline-request-fail-at-test.json")
        deploy = stage_status(final, "deploy")
        expect(final["status"] == "failed", f"esperaba failed y llegó {final['status']}", final)
        expect(deploy == "pending", f"deploy quedó {deploy}; esperaba pending", final)
        print(f"ok  {final['job_id']}  failed en test, deploy pending")
    elif args.command == "burst":
        expect(args.n >= 1, "--n tiene que ser al menos 1", None)
        burst_jobs(api, args.n)
    elif args.command == "scale":
        expect(args.workers >= 1, "la cantidad de workers tiene que ser al menos 1", None)
        scale_workers(api, args.workers)


def run_example(api: str, path: Path) -> dict:
    body = json.loads(path.read_text(encoding="utf-8"))
    started = time.monotonic()
    status, accepted = request(api, "POST", "/pipelines", body)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    expect(status == 202, f"POST /pipelines respondió {status}", accepted)
    job_id = accepted["job_id"]
    print(f"202  {job_id}  en {elapsed_ms} ms  trace_id={accepted.get('trace_id')}")
    return wait_job(api, job_id, timeout_for(body, jobs=1))


def burst_jobs(api: str, n: int) -> None:
    body = json.loads((EXAMPLES / "pipeline-request.json").read_text(encoding="utf-8"))
    job_ids: list[str] = []
    for _ in range(n):
        status, accepted = request(api, "POST", "/pipelines", body)
        expect(status == 202, f"POST /pipelines respondió {status}", accepted)
        job_ids.append(accepted["job_id"])
    _, stats = request(api, "GET", "/stats")
    print(f"encolados {n}  queue_depth={stats['queue_depth']}  workers={stats['workers']}")
    for job_id in job_ids:
        final = wait_job(api, job_id, timeout_for(body, jobs=n))
        expect(final["status"] == "succeeded", f"{job_id} terminó {final['status']}", final)
    print(f"ok  {n} pipelines succeeded")


def scale_workers(api: str, n: int) -> None:
    print(f"docker compose up -d --scale worker={n} --no-recreate")
    subprocess.run(
        ["docker", "compose", "up", "-d", "--scale", f"worker={n}", "--no-recreate"],
        cwd=ROOT,
        check=True,
    )
    deadline = time.monotonic() + 90
    last = None
    while time.monotonic() < deadline:
        _, last = request(api, "GET", "/stats")
        print(f"workers={last['workers']}  queue_depth={last['queue_depth']}")
        if last["workers"] >= n:
            print(f"ok  {last['workers']} workers vivos")
            return
        time.sleep(2)
    expect(False, f"a los 90 s /stats sigue en {last}", last)


def wait_job(api: str, job_id: str, timeout: float) -> dict:
    deadline = time.monotonic() + timeout
    last: dict | None = None
    while time.monotonic() < deadline:
        status, last = request(api, "GET", f"/pipelines/{job_id}")
        expect(status == 200, f"GET /pipelines/{job_id} respondió {status}", last)
        if last["status"] in ("succeeded", "failed"):
            return last
        time.sleep(0.5)
    expect(False, f"timeout de {int(timeout)} s esperando {job_id}", last)
    return {}  # expect ya cortó


def timeout_for(body: dict, jobs: int) -> float:
    """Cota para un solo worker: cada etapa duerme stage_seconds y hay 3 etapas."""
    seconds = int(body["config"]["stage_seconds"])
    stages = len(body["config"]["stages"])
    return jobs * seconds * stages + 45


def stage_status(job: dict, name: str) -> str:
    for stage in job["stages"]:
        if stage["name"] == name:
            return stage["status"]
    expect(False, f"el job no tiene la etapa {name}", job)
    return ""


def request(api: str, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(api + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return exc.code, payload
    except urllib.error.URLError as exc:
        print(
            f"no llega la API en {api} ({exc.reason}). "
            "Desde lab2/: docker compose up --build -d",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc


def expect(ok: bool, message: str, detail: dict | None) -> None:
    if ok:
        return
    print(message, file=sys.stderr)
    if detail is not None:
        print(json.dumps(detail, indent=2, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(1)


if __name__ == "__main__":
    main()
