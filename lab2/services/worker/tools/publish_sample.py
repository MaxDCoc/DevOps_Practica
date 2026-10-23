"""Publica pipelines de prueba directo en la cola, sin pasar por la API.

Hace lo mismo que la API: guarda el estado "queued" en Redis y después publica el mensaje.
Sirve para probar el worker solo, con la infraestructura de compose levantada:

    cd lab2
    python services/worker/tools/publish_sample.py --count 5 --stage-seconds 2 --follow
    python services/worker/tools/publish_sample.py --fail-at test --follow
"""

import argparse
import os
import time
from uuid import uuid4

import redis
from deployflow_common.contract import PipelineRequest, build_job_message, new_job_state
from deployflow_common.messaging import RabbitPublisher
from deployflow_common.state import RedisJobStore


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--count", type=int, default=1, help="cuántos pipelines publicar")
    parser.add_argument("--project", default="shop-frontend")
    parser.add_argument("--stage-seconds", type=int, default=3)
    parser.add_argument("--fail-at", choices=["build", "test", "deploy"], default=None)
    parser.add_argument("--follow", action="store_true", help="esperar y mostrar cómo termina cada uno")
    parser.add_argument("--rabbitmq-url", default=os.environ.get("RABBITMQ_URL", "amqp://deployflow:deployflow@localhost:5672/"))
    parser.add_argument("--redis-url", default=os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    args = parser.parse_args()

    store = RedisJobStore(redis.Redis.from_url(args.redis_url, decode_responses=True))
    publisher = RabbitPublisher(args.rabbitmq_url)
    config = {"stage_seconds": args.stage_seconds, "fail_at": args.fail_at}

    job_ids = []
    for _ in range(args.count):
        job_id = str(uuid4())
        request = PipelineRequest.model_validate({"project": args.project, "config": config})
        state = new_job_state(job_id, request)
        store.create(state)
        publisher.publish_job(build_job_message(job_id, request, state.submitted_at))
        job_ids.append(job_id)
        print(f"publicado {job_id}")
    publisher.close()

    if args.follow:
        pending = set(job_ids)
        while pending:
            for job_id in sorted(pending):
                job = store.get(job_id)
                if job is None or job.is_finished:
                    pending.discard(job_id)
                    detail = f"{job.status} {job.error or ''}" if job else "vencido"
                    print(f"terminó   {job_id} -> {detail}")
            time.sleep(0.5)


if __name__ == "__main__":
    main()
