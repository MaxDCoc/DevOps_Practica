import pytest
from deployflow_common.messaging import Delivery
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind, StatusCode
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from prometheus_client import REGISTRY

from app import processing
from app.processing import process


def sample(name: str, **labels: str) -> float:
    return REGISTRY.get_sample_value(name, labels) or 0.0


def delivery(
    message, sleep, *, redelivered: bool = False, headers: dict | None = None, attempt: int = 1, max_attempts: int = 3
) -> Delivery:
    return Delivery(
        message=message,
        headers=headers or {},
        redelivered=redelivered,
        sleep=sleep,
        attempt=attempt,
        max_attempts=max_attempts,
    )


def exploding_sleep(seconds: float) -> None:
    raise RuntimeError("se cayó a mitad de la etapa")


@pytest.fixture
def tracing():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("test"), exporter


def test_a_successful_job_is_counted_and_timed_end_to_end_and_by_stage(store, sleep, enqueue):
    jobs = sample("pipeline_jobs_total", status="succeeded")
    job_seconds = sample("pipeline_job_duration_seconds_sum")
    job_count = sample("pipeline_job_duration_seconds_count")
    stage_seconds = {stage: sample("pipeline_stage_duration_seconds_sum", stage=stage) for stage in ("build", "test", "deploy")}
    redelivered = sample("worker_messages_redelivered_total")

    process(delivery(enqueue(), sleep), store)

    assert sample("worker_messages_redelivered_total") == redelivered  # una entrega normal no es un redelivery
    assert sample("pipeline_jobs_total", status="succeeded") - jobs == 1
    assert sample("pipeline_job_duration_seconds_count") - job_count == 1
    # Duración de punta a punta: desde que se pidió hasta que terminó (3 etapas de 3 s).
    assert sample("pipeline_job_duration_seconds_sum") - job_seconds == 9.0
    for stage, before in stage_seconds.items():
        assert sample("pipeline_stage_duration_seconds_sum", stage=stage) - before == 3.0
    assert sample("worker_jobs_in_progress") == 0


def test_a_failed_job_counts_the_failure_and_the_stage_that_broke(store, sleep, enqueue):
    failed = sample("pipeline_jobs_total", status="failed")
    broken = sample("pipeline_stage_failures_total", stage="test")
    deploy_runs = sample("pipeline_stage_duration_seconds_count", stage="deploy")

    process(delivery(enqueue(fail_at="test"), sleep), store)

    assert sample("pipeline_jobs_total", status="failed") - failed == 1
    assert sample("pipeline_stage_failures_total", stage="test") - broken == 1
    # La etapa que nunca corrió no se mide.
    assert sample("pipeline_stage_duration_seconds_count", stage="deploy") == deploy_runs


def test_a_redelivered_message_is_counted(store, sleep, enqueue):
    before = sample("worker_messages_redelivered_total")

    process(delivery(enqueue(), sleep, redelivered=True), store)

    assert sample("worker_messages_redelivered_total") - before == 1


def test_skipped_and_missing_jobs_are_not_counted_as_runs(store, sleep, enqueue):
    message = enqueue()
    process(delivery(message, sleep), store)
    statuses = ("succeeded", "failed", "errored", "skipped", "missing")
    runs = {status: sample("pipeline_jobs_total", status=status) for status in statuses}

    process(delivery(message, sleep), store)  # duplicado de un job que ya terminó

    assert {status: sample("pipeline_jobs_total", status=status) for status in runs} == runs


def test_an_unexpected_error_is_counted_re_raised_and_leaves_no_job_in_progress(sleep, enqueue):
    class BrokenStore:
        def begin_attempt(self, job_id):
            raise RuntimeError("Redis caído")

    errored = sample("pipeline_jobs_total", status="errored")
    message = enqueue()

    with pytest.raises(RuntimeError, match="Redis caído"):
        process(delivery(message, sleep), BrokenStore())

    assert sample("pipeline_jobs_total", status="errored") - errored == 1
    assert sample("worker_jobs_in_progress") == 0


def test_an_unexpected_error_with_attempts_left_leaves_the_job_waiting_for_its_retry(store, enqueue):
    message = enqueue()

    with pytest.raises(RuntimeError, match="se cayó"):
        process(delivery(message, exploding_sleep, attempt=1, max_attempts=3), store)

    # Todavía no está perdido: el mensaje vuelve por la cola de reintento, así que el job no se marca como fallado.
    state = store.get("job-1")
    assert state.status == "running"
    assert state.finished_at is None


def test_an_unexpected_error_on_the_last_attempt_marks_the_job_and_its_broken_stage_as_failed(store, enqueue):
    message = enqueue()

    with pytest.raises(RuntimeError, match="se cayó"):
        process(delivery(message, exploding_sleep, attempt=3, max_attempts=3), store)

    # Sin esto el job quedaría «running» para siempre en el dashboard aunque el mensaje ya esté en la cola de muertos.
    state = store.get("job-1")
    assert state.status == "failed"
    assert state.finished_at is not None
    assert "intento 3 de 3" in state.error
    assert "RuntimeError: se cayó a mitad de la etapa" in state.error
    assert [(stage.name, stage.status) for stage in state.stages] == [
        ("build", "failed"),
        ("test", "pending"),
        ("deploy", "pending"),
    ]
    assert state.stages[0].error == state.error


def test_an_error_between_two_stages_does_not_mark_the_stage_that_already_succeeded_as_failed(store, sleep, enqueue):
    message = enqueue()

    class BreaksWhenTestStarts:
        def begin_attempt(self, job_id):
            return store.begin_attempt(job_id)

        def update_stage(self, job_id, stage, status, **kwargs):
            if (stage, status) == ("test", "running"):
                raise RuntimeError("explotó entre build y test")
            return store.update_stage(job_id, stage, status, **kwargs)

        get = staticmethod(store.get)
        finish = staticmethod(store.finish)

    with pytest.raises(RuntimeError, match="entre build y test"):
        process(delivery(message, sleep, attempt=3, max_attempts=3), BreaksWhenTestStarts())

    state = store.get("job-1")
    assert state.status == "failed"
    assert [(stage.name, stage.status) for stage in state.stages] == [
        ("build", "succeeded"),
        ("test", "pending"),
        ("deploy", "pending"),
    ]


def test_a_single_attempt_allowed_fails_the_job_on_its_first_error(store, enqueue):
    message = enqueue()

    with pytest.raises(RuntimeError):
        process(delivery(message, exploding_sleep, attempt=1, max_attempts=1), store)

    assert store.get("job-1").status == "failed"


def test_a_job_that_broke_before_starting_any_stage_is_also_failed_when_attempts_run_out(store, sleep, enqueue):
    message = enqueue()

    class BreaksOnStart:
        def begin_attempt(self, job_id):
            raise RuntimeError("explotó al arrancar")

        get = staticmethod(store.get)
        update_stage = staticmethod(store.update_stage)
        finish = staticmethod(store.finish)

    with pytest.raises(RuntimeError, match="explotó"):
        process(delivery(message, sleep, attempt=3, max_attempts=3), BreaksOnStart())

    state = store.get("job-1")
    assert state.status == "failed"
    assert [stage.status for stage in state.stages] == ["pending", "pending", "pending"]


def test_giving_up_does_not_hide_the_original_error_when_the_state_store_is_down_too(sleep, enqueue):
    class DeadStore:
        def begin_attempt(self, job_id):
            raise RuntimeError("Redis caído")

        def get(self, job_id):
            raise ConnectionError("sigue caído")

    with pytest.raises(RuntimeError, match="Redis caído"):
        process(delivery(enqueue(), sleep, attempt=3, max_attempts=3), DeadStore())


def test_giving_up_on_a_job_that_already_expired_is_not_an_error(sleep, enqueue):
    class ExpiredJobStore:
        def begin_attempt(self, job_id):
            raise RuntimeError("falló antes de encontrar el job")

        def get(self, job_id):
            return None

    with pytest.raises(RuntimeError, match="falló antes"):
        process(delivery(enqueue(), sleep, attempt=3, max_attempts=3), ExpiredJobStore())


def test_giving_up_on_a_job_that_already_finished_leaves_its_result_alone(store, sleep, enqueue):
    message = enqueue()
    process(delivery(message, sleep), store)  # el job terminó bien
    finished = store.get("job-1")

    class FailsAfterwards:
        """Un duplicado tardío cuyo procesamiento revienta: el resultado que ya existe no se pisa."""

        def begin_attempt(self, job_id):
            raise RuntimeError("explotó")

        get = staticmethod(store.get)
        update_stage = staticmethod(store.update_stage)
        finish = staticmethod(store.finish)

    with pytest.raises(RuntimeError, match="explotó"):
        process(delivery(message, sleep, attempt=3, max_attempts=3), FailsAfterwards())

    assert store.get("job-1") == finished


def test_a_job_is_traced_as_a_consumer_span_with_one_child_per_stage(store, sleep, enqueue, tracing):
    tracer, exporter = tracing

    process(delivery(enqueue(), sleep), store, tracer=tracer)

    spans = {span.name: span for span in exporter.get_finished_spans()}
    job_span = spans["process pipeline.jobs"]
    assert job_span.kind == SpanKind.CONSUMER
    assert job_span.attributes["job.id"] == "job-1"
    for stage in ("build", "test", "deploy"):
        assert spans[f"stage {stage}"].parent.span_id == job_span.context.span_id


def test_the_job_span_says_which_attempt_it_is(store, sleep, enqueue, tracing):
    tracer, exporter = tracing

    process(delivery(enqueue(), sleep, attempt=2, max_attempts=3), store, tracer=tracer)

    job_span = next(span for span in exporter.get_finished_spans() if span.name == "process pipeline.jobs")
    assert job_span.attributes["job.attempt"] == 2


def test_a_failed_stage_marks_its_own_span_as_an_error(store, sleep, enqueue, tracing):
    tracer, exporter = tracing

    process(delivery(enqueue(fail_at="test"), sleep), store, tracer=tracer)

    spans = {span.name: span for span in exporter.get_finished_spans()}
    assert spans["stage test"].status.status_code == StatusCode.ERROR
    assert spans["stage build"].status.status_code != StatusCode.ERROR


def test_the_job_span_continues_the_trace_that_came_in_the_message_headers(monkeypatch, store, sleep, enqueue, tracing):
    tracer, exporter = tracing
    headers = {"traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"}
    # extract_trace_context es de P3; acá se usa el propagador estándar de W3C para probar el cableado.
    monkeypatch.setattr(processing, "extract_trace_context", lambda h: TraceContextTextMapPropagator().extract(h))

    process(delivery(enqueue(), sleep, headers=headers), store, tracer=tracer)

    job_span = next(span for span in exporter.get_finished_spans() if span.name == "process pipeline.jobs")
    assert job_span.context.trace_id == 0x4BF92F3577B34DA6A3CE929D0E0E4736
    assert job_span.parent.span_id == 0x00F067AA0BA902B7
