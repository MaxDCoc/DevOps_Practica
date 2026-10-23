"""Política de reintento: reglas puras, sin RabbitMQ. La cola real se prueba en test_messaging.py."""

import pytest
from store_contract import T0

from deployflow_common.contract import PipelineRequest, build_job_message
from deployflow_common.messaging import DEFAULT_MAX_ATTEMPTS, Consumer, Delivery
from deployflow_common.retry import attempt_of, max_attempts_from_env, retry_headers


class TestAttemptOf:
    @pytest.mark.parametrize("headers", [None, {}, {"traceparent": "x"}])
    def test_a_message_without_the_header_is_on_its_first_attempt(self, headers):
        assert attempt_of(headers) == 1

    @pytest.mark.parametrize(("value", "expected"), [(1, 1), (2, 2), (3, 3), ("2", 2), (b"3", 3)])
    def test_it_reads_the_attempt_the_message_carries(self, value, expected):
        assert attempt_of({"x-attempt": value}) == expected

    @pytest.mark.parametrize("value", [0, -1, "abc", "", None, [2]])
    def test_a_nonsensical_value_counts_as_the_first_attempt(self, value):
        assert attempt_of({"x-attempt": value}) == 1


class TestRetryHeaders:
    def test_the_next_attempt_is_one_more_than_the_current_one(self):
        assert retry_headers({"x-attempt": 1})["x-attempt"] == 2
        assert retry_headers({"x-attempt": 2})["x-attempt"] == 3

    def test_a_message_without_the_header_goes_to_its_second_attempt(self):
        assert retry_headers({})["x-attempt"] == 2
        assert retry_headers(None)["x-attempt"] == 2

    def test_the_trace_context_travels_with_the_retry(self):
        headers = {"x-attempt": 1, "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", "tracestate": "a=b"}

        assert retry_headers(headers) == {**headers, "x-attempt": 2}

    def test_what_the_broker_adds_when_it_dead_letters_is_dropped(self):
        # Si x-death viajara en la copia, RabbitMQ vería la cola de reintento ya recorrida y podría cortar el ciclo.
        headers = {
            "x-attempt": 2,
            "traceparent": "tp",
            "x-death": [{"queue": "pipeline.jobs.retry", "reason": "expired", "count": 1}],
            "x-first-death-queue": "pipeline.jobs.retry",
            "x-first-death-reason": "expired",
            "x-first-death-exchange": "",
            "x-last-death-queue": "pipeline.jobs.retry",
            "x-last-death-reason": "expired",
            "x-last-death-exchange": "",
        }

        assert retry_headers(headers) == {"x-attempt": 3, "traceparent": "tp"}

    def test_the_headers_that_came_in_are_not_modified(self):
        headers = {"x-attempt": 1, "x-death": [{"count": 1}]}

        retry_headers(headers)

        assert headers == {"x-attempt": 1, "x-death": [{"count": 1}]}


class TestMaxAttemptsFromEnv:
    def test_it_defaults_to_three_attempts(self):
        assert max_attempts_from_env({}) == 3
        assert DEFAULT_MAX_ATTEMPTS == 3

    @pytest.mark.parametrize(("value", "expected"), [("1", 1), ("3", 3), ("5", 5)])
    def test_it_reads_MAX_ATTEMPTS(self, value, expected):
        assert max_attempts_from_env({"MAX_ATTEMPTS": value}) == expected

    @pytest.mark.parametrize("value", ["0", "-2", "abc", "", "2.5"])
    def test_an_invalid_value_stops_the_start_up_naming_the_variable(self, value):
        with pytest.raises(ValueError, match="MAX_ATTEMPTS"):
            max_attempts_from_env({"MAX_ATTEMPTS": value})


class TestConsumerConfiguration:
    @pytest.mark.parametrize("max_attempts", [0, -1])
    def test_a_consumer_that_would_never_try_a_job_is_rejected(self, max_attempts):
        with pytest.raises(ValueError, match="max_attempts"):
            Consumer("amqp://localhost/", lambda delivery: None, max_attempts=max_attempts)

    def test_one_attempt_is_valid_and_means_no_retries(self):
        Consumer("amqp://localhost/", lambda delivery: None, max_attempts=1)


class TestDelivery:
    @staticmethod
    def delivery(**kwargs) -> Delivery:
        message = build_job_message("job-1", PipelineRequest(project="shop-frontend"), T0)
        return Delivery(message=message, headers={}, redelivered=False, sleep=lambda seconds: None, **kwargs)

    def test_a_delivery_is_the_first_attempt_with_retries_available_by_default(self):
        delivery = self.delivery()

        assert delivery.attempt == 1
        assert delivery.max_attempts == DEFAULT_MAX_ATTEMPTS
        assert delivery.last_attempt is False

    @pytest.mark.parametrize(("attempt", "max_attempts", "last"), [(1, 3, False), (2, 3, False), (3, 3, True), (1, 1, True), (4, 3, True)])
    def test_the_last_attempt_is_the_one_that_uses_up_the_allowed_attempts(self, attempt, max_attempts, last):
        assert self.delivery(attempt=attempt, max_attempts=max_attempts).last_attempt is last
