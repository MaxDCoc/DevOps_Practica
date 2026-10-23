from datetime import timedelta

from deployflow_common.contract import PipelineRequest, build_job_message

from app.runner import run_pipeline


def test_a_pipeline_runs_every_stage_for_its_configured_time(store, sleep, enqueue):
    outcome = run_pipeline(enqueue(), store, sleep=sleep)

    job = store.get("job-1")
    assert outcome.status == "succeeded"
    assert sleep.calls == [3, 3, 3]
    assert [(s.name, s.status, s.duration_s) for s in job.stages] == [
        ("build", "succeeded", 3.0),
        ("test", "succeeded", 3.0),
        ("deploy", "succeeded", 3.0),
    ]
    assert (job.status, job.attempts) == ("succeeded", 1)
    assert job.finished_at == job.submitted_at + timedelta(seconds=9)


def test_the_requested_stages_and_duration_are_respected(store, sleep, enqueue):
    run_pipeline(enqueue(stages=["build", "deploy"], stage_seconds=5), store, sleep=sleep)

    assert sleep.calls == [5, 5]
    assert [s.name for s in store.get("job-1").stages] == ["build", "deploy"]


def test_a_pipeline_set_to_fail_stops_at_that_stage_and_leaves_the_rest_pending(store, sleep, enqueue):
    outcome = run_pipeline(enqueue(fail_at="test"), store, sleep=sleep)

    job = store.get("job-1")
    assert (outcome.status, outcome.failed_stage) == ("failed", "test")
    assert [(s.name, s.status) for s in job.stages] == [
        ("build", "succeeded"),
        ("test", "failed"),
        ("deploy", "pending"),
    ]
    assert job.status == "failed"
    assert "test" in job.error
    assert job.stages[1].error == job.error
    assert sleep.calls == [3, 3]  # la etapa de test corre su tiempo completo antes de fallar


def test_a_job_that_no_longer_exists_is_reported_missing_and_nothing_runs(store, sleep, t0):
    ghost = build_job_message("ghost", PipelineRequest(project="shop-frontend"), t0)

    outcome = run_pipeline(ghost, store, sleep=sleep)

    assert outcome.status == "missing"
    assert sleep.calls == []


def test_a_duplicate_delivery_of_a_finished_job_is_skipped_and_leaves_it_untouched(store, sleep, enqueue):
    message = enqueue()
    run_pipeline(message, store, sleep=sleep)
    finished = store.get("job-1")
    sleep.calls.clear()

    outcome = run_pipeline(message, store, sleep=sleep)

    assert outcome.status == "skipped"
    assert store.get("job-1") == finished
    assert sleep.calls == []


def test_a_redelivered_job_starts_over_and_counts_the_new_attempt(store, sleep, enqueue):
    message = enqueue()
    # El worker anterior murió después de terminar la etapa de build.
    store.begin_attempt("job-1")
    store.update_stage("job-1", "build", "running")
    store.update_stage("job-1", "build", "succeeded")

    outcome = run_pipeline(message, store, sleep=sleep)

    job = store.get("job-1")
    assert (outcome.status, job.attempts) == ("succeeded", 2)
    assert sleep.calls == [3, 3, 3]
