"""RedisJobStore contra un Redis real (docker compose up -d redis). Se saltea solo si no está levantado."""

import threading
from datetime import timedelta

import pytest
import redis
from store_contract import T0, JobStoreContract, make_job

from deployflow_common.state import RedisJobStore

# Base 15: no pisa lo que haya en la 0 de quien use la misma Redis para desarrollar.
REDIS_URL = "redis://localhost:6379/15"


@pytest.fixture(scope="module")
def redis_client():
    client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    try:
        client.ping()
    except redis.ConnectionError:
        pytest.skip("Redis no está disponible: docker compose up -d redis")
    yield client
    client.flushdb()
    client.close()


class TestRedisJobStore(JobStoreContract):
    @pytest.fixture
    def store(self, redis_client):
        redis_client.flushdb()
        return RedisJobStore(redis_client)

    def test_the_state_expires_after_24_hours(self, store, redis_client):
        store.create(make_job("job-1"))

        assert 86_000 < redis_client.ttl("job:job-1") <= 86_400

    def test_a_job_that_expired_disappears_from_the_listings_without_breaking_them(self, store, redis_client):
        store.create(make_job("job-1"))
        store.create(make_job("job-2", T0 + timedelta(seconds=1)))

        redis_client.delete("job:job-1")  # lo que hace Redis al vencer el TTL

        assert [job.job_id for job in store.list_recent()] == ["job-2"]
        assert store.counts().queued == 1
        # El índice se limpia solo: si no, jobs:recent crecería para siempre con ids de jobs vencidos.
        assert redis_client.zscore("jobs:recent", "job-1") is None

    def test_a_worker_heartbeat_expires_by_itself(self, store, redis_client):
        store.heartbeat("worker-1")

        assert 0 < redis_client.ttl("worker:worker-1") <= 15

    def test_the_api_and_the_worker_see_the_same_job(self, store):
        # Son procesos distintos con conexiones distintas: el estado compartido tiene que estar en Redis.
        other_process = RedisJobStore(redis.Redis.from_url(REDIS_URL, decode_responses=True))
        job = make_job("job-1")

        store.create(job)

        assert other_process.get("job-1") == job

    def test_concurrent_updates_to_different_stages_are_not_lost(self, store):
        job_ids = [f"job-{number}" for number in range(100)]
        for job_id in job_ids:
            store.create(make_job(job_id))
            store.begin_attempt(job_id)
        barrier = threading.Barrier(3)

        def mark_running(stage: str):
            for job_id in job_ids:
                barrier.wait()  # las tres actualizaciones del mismo job arrancan a la vez, una sola vez cada una
                store.update_stage(job_id, stage, "running")

        threads = [threading.Thread(target=mark_running, args=(stage,)) for stage in ("build", "test", "deploy")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        # Sin bloqueo optimista (WATCH), una lectura-modificación-escritura pisa a la otra y esa etapa se pierde.
        lost = [
            job_id
            for job_id in job_ids
            if [stage.status for stage in store.get(job_id).stages] != ["running", "running", "running"]
        ]
        assert lost == []
