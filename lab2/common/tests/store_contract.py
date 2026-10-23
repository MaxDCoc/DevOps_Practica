"""Suite de contrato de cualquier JobStore.

La corren InMemoryJobStore (test_fakes.py) y, cuando exista, RedisJobStore (P2):
si pasa con las dos, la API y el worker se comportan igual con memoria o con Redis.
"""

from datetime import UTC, datetime, timedelta

from deployflow_common.contract import PipelineRequest, StatsCounts, new_job_state

T0 = datetime(2026, 10, 22, 15, 0, 0, tzinfo=UTC)


def make_job(job_id: str, submitted_at: datetime = T0, stages: list[str] | None = None):
    config = {"stages": stages} if stages else {}
    request = PipelineRequest.model_validate({"project": "shop-frontend", "config": config})
    return new_job_state(job_id, request, trace_id=f"trace-{job_id}", now=submitted_at)


class JobStoreContract:
    """Las subclases definen la fixture `store`: un almacén vacío."""

    def test_get_returns_what_was_created_and_none_for_unknown_jobs(self, store):
        job = make_job("job-1")
        store.create(job)

        assert store.get("job-1") == job
        assert store.get("job-404") is None

    def test_mutating_a_returned_job_does_not_change_the_stored_one(self, store):
        store.create(make_job("job-1"))

        returned = store.get("job-1")
        returned.status = "failed"
        returned.stages[0].status = "failed"

        stored = store.get("job-1")
        assert stored.status == "queued"
        assert stored.stages[0].status == "pending"

    def test_operations_on_an_unknown_job_return_none(self, store):
        # Un job puede vencer por TTL entre que se encola y se procesa: el worker no debe romperse.
        assert store.begin_attempt("job-404") is None
        assert store.update_stage("job-404", "build", "running") is None
        assert store.finish("job-404", "failed", error="x") is None

    def test_a_successful_run_is_persisted_step_by_step(self, store):
        store.create(make_job("job-1", stages=["build", "test"]))

        started = store.begin_attempt("job-1")
        assert (started.status, started.attempts) == ("running", 1)

        store.update_stage("job-1", "build", "running")
        assert store.get("job-1").current_stage == "build"
        store.update_stage("job-1", "build", "succeeded")
        store.update_stage("job-1", "test", "running")
        store.update_stage("job-1", "test", "succeeded")
        done = store.finish("job-1", "succeeded")

        stored = store.get("job-1")
        assert stored == done
        assert stored.status == "succeeded"
        assert stored.finished_at is not None
        assert [s.status for s in stored.stages] == ["succeeded", "succeeded"]

    def test_a_failed_stage_leaves_the_later_stages_pending(self, store):
        store.create(make_job("job-1"))  # build, test, deploy
        store.begin_attempt("job-1")
        store.update_stage("job-1", "build", "running")
        store.update_stage("job-1", "build", "succeeded")
        store.update_stage("job-1", "test", "running")
        store.update_stage("job-1", "test", "failed", error="2 tests failed")
        store.finish("job-1", "failed", error="2 tests failed")

        stored = store.get("job-1")
        assert stored.status == "failed"
        assert stored.error == "2 tests failed"
        assert [(s.name, s.status) for s in stored.stages] == [
            ("build", "succeeded"),
            ("test", "failed"),
            ("deploy", "pending"),
        ]
        assert stored.stages[1].error == "2 tests failed"

    def test_list_recent_returns_the_newest_submissions_first_and_honours_the_limit(self, store):
        store.create(make_job("job-b", T0 + timedelta(seconds=1)))
        store.create(make_job("job-c", T0 + timedelta(seconds=2)))
        store.create(make_job("job-a", T0))

        assert [j.job_id for j in store.list_recent(limit=2)] == ["job-c", "job-b"]
        assert [j.job_id for j in store.list_recent()] == ["job-c", "job-b", "job-a"]

    def test_counts_group_the_jobs_by_status(self, store):
        for job_id in ("queued", "running", "ok", "bad"):
            store.create(make_job(job_id))
        store.begin_attempt("running")
        store.begin_attempt("ok")
        store.finish("ok", "succeeded")
        store.begin_attempt("bad")
        store.finish("bad", "failed", error="boom")

        assert store.counts() == StatsCounts(queued=1, running=1, succeeded=1, failed=1)

    def test_heartbeats_count_each_worker_once(self, store):
        assert store.live_workers() == 0

        store.heartbeat("worker-1")
        store.heartbeat("worker-2")
        store.heartbeat("worker-1")

        assert store.live_workers() == 2
