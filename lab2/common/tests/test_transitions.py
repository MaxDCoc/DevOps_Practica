from datetime import timedelta

import pytest

from deployflow_common.transitions import apply_finish, apply_stage_update, begin_attempt


def at(t0, seconds):
    return t0 + timedelta(seconds=seconds)


def test_begin_attempt_marks_the_job_running_and_counts_the_attempt(queued_job):
    state = begin_attempt(queued_job)

    assert (state.status, state.attempts, state.current_stage) == ("running", 1, None)


def test_begin_attempt_after_a_crash_starts_the_stages_from_scratch(queued_job, t0):
    mid = apply_stage_update(begin_attempt(queued_job), "build", "running", now=t0)
    mid = apply_stage_update(mid, "build", "succeeded", now=at(t0, 3))

    again = begin_attempt(mid)

    assert again.attempts == 2
    assert again.current_stage is None
    assert [(s.status, s.started_at, s.duration_s) for s in again.stages] == [("pending", None, None)] * 3


def test_begin_attempt_leaves_a_finished_job_alone(queued_job, t0):
    # Un mensaje duplicado no puede resucitar un pipeline que ya terminó.
    done = apply_finish(begin_attempt(queued_job), "succeeded", now=t0)

    assert begin_attempt(done) == done


def test_a_running_stage_records_its_start_and_moves_the_job_to_running(queued_job, t0):
    state = apply_stage_update(queued_job, "build", "running", now=t0)

    assert (state.status, state.current_stage) == ("running", "build")
    assert (state.stages[0].status, state.stages[0].started_at) == ("running", t0)


def test_repeating_a_running_update_keeps_the_original_start(queued_job, t0):
    once = apply_stage_update(queued_job, "build", "running", now=t0)

    twice = apply_stage_update(once, "build", "running", now=at(t0, 9))

    assert twice.stages[0].started_at == t0


def test_a_finished_stage_computes_its_duration_from_its_start(queued_job, t0):
    running = apply_stage_update(queued_job, "build", "running", now=t0)

    done = apply_stage_update(running, "build", "succeeded", now=at(t0, 3))

    assert (done.stages[0].status, done.stages[0].duration_s) == ("succeeded", 3.0)


def test_an_explicit_duration_wins_over_the_computed_one(queued_job, t0):
    running = apply_stage_update(queued_job, "build", "running", now=t0)

    done = apply_stage_update(running, "build", "succeeded", now=at(t0, 10), duration_s=2.5)

    assert done.stages[0].duration_s == 2.5


def test_a_failed_stage_keeps_the_error_text(queued_job, t0):
    running = apply_stage_update(queued_job, "test", "running", now=t0)

    failed = apply_stage_update(running, "test", "failed", now=at(t0, 4), error="2 tests failed")

    assert (failed.stages[1].status, failed.stages[1].error) == ("failed", "2 tests failed")


def test_an_unknown_stage_is_a_programming_error(queued_job, t0):
    with pytest.raises(ValueError, match="lint"):
        apply_stage_update(queued_job, "lint", "running", now=t0)


def test_a_stage_cannot_be_moved_back_to_pending(queued_job, t0):
    with pytest.raises(ValueError, match="begin_attempt"):
        apply_stage_update(queued_job, "build", "pending", now=t0)


def test_a_stage_update_does_not_mutate_the_state_it_receives(queued_job, t0):
    before = queued_job.model_copy(deep=True)

    apply_stage_update(queued_job, "build", "running", now=t0)

    assert queued_job == before


def test_stage_updates_after_the_job_finished_are_ignored(queued_job, t0):
    running = apply_stage_update(queued_job, "build", "running", now=t0)
    finished = apply_finish(running, "failed", now=at(t0, 2), error="x")

    late = apply_stage_update(finished, "build", "succeeded", now=at(t0, 5))

    assert late == finished


def test_finishing_successfully_sets_the_final_status_and_timestamp(queued_job, t0):
    state = apply_finish(begin_attempt(queued_job), "succeeded", now=at(t0, 9))

    assert (state.status, state.finished_at, state.error) == ("succeeded", at(t0, 9), None)


def test_a_failure_keeps_its_error_and_leaves_the_later_stages_pending(queued_job, t0):
    state = apply_stage_update(begin_attempt(queued_job), "build", "running", now=t0)
    state = apply_stage_update(state, "build", "succeeded", now=at(t0, 3))
    state = apply_stage_update(state, "test", "running", now=at(t0, 3))
    state = apply_stage_update(state, "test", "failed", now=at(t0, 6), error="2 tests failed")

    final = apply_finish(state, "failed", now=at(t0, 6), error="2 tests failed")

    assert [s.status for s in final.stages] == ["succeeded", "failed", "pending"]
    assert (final.status, final.error, final.current_stage) == ("failed", "2 tests failed", "test")


def test_the_first_result_wins_when_finish_is_repeated(queued_job, t0):
    failed = apply_finish(begin_attempt(queued_job), "failed", now=at(t0, 1), error="boom")

    later = apply_finish(failed, "succeeded", now=at(t0, 2))

    assert later == failed


def test_finish_only_accepts_final_statuses(queued_job, t0):
    with pytest.raises(ValueError, match="succeeded"):
        apply_finish(queued_job, "running", now=t0)
