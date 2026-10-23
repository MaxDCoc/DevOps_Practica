import pytest
from store_contract import T0, JobStoreContract, make_job

from deployflow_common.contract import WORKER_HEARTBEAT_TTL_S, PipelineRequest, build_job_message
from deployflow_common.fakes import FakePublisher, InMemoryJobStore
from deployflow_common.interfaces import JobStore, Publisher, PublishError


class TestInMemoryJobStore(JobStoreContract):
    @pytest.fixture
    def store(self):
        return InMemoryJobStore()

    def test_stage_durations_follow_the_store_clock(self, clock):
        store = InMemoryJobStore(clock=clock)
        store.create(make_job("job-1"))
        store.begin_attempt("job-1")

        store.update_stage("job-1", "build", "running")
        clock.advance(3)
        store.update_stage("job-1", "build", "succeeded")

        assert store.get("job-1").stages[0].duration_s == 3.0

    def test_a_worker_stops_counting_as_live_after_its_heartbeat_ttl(self, clock):
        store = InMemoryJobStore(clock=clock)
        store.heartbeat("worker-1")

        clock.advance(WORKER_HEARTBEAT_TTL_S - 1)
        assert store.live_workers() == 1

        clock.advance(2)
        assert store.live_workers() == 0


def make_message(job_id="job-1"):
    return build_job_message(job_id, PipelineRequest(project="shop-frontend"), submitted_at=T0)


class TestFakePublisher:
    def test_published_messages_wait_in_order_and_count_as_queue_depth(self):
        publisher = FakePublisher()
        first, second = make_message("job-1"), make_message("job-2")

        publisher.publish_job(first)
        publisher.publish_job(second)

        assert publisher.published == [first, second]
        assert publisher.queue_depth() == 2

    def test_a_broker_outage_can_be_simulated_without_recording_the_message(self):
        publisher = FakePublisher()
        publisher.fail = True

        with pytest.raises(PublishError):
            publisher.publish_job(make_message())

        assert publisher.published == []
        publisher.fail = False
        publisher.publish_job(make_message())
        assert publisher.queue_depth() == 1


def test_the_fakes_satisfy_the_shared_interfaces():
    assert isinstance(InMemoryJobStore(), JobStore)
    assert isinstance(FakePublisher(), Publisher)
