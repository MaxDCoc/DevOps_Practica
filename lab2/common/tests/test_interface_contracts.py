"""Lo que P1 y P2 ya pueden asumir de la telemetría, y lo que la implementación real de P3 debe seguir cumpliendo.

Hoy corre contra los stubs; cuando P3 los reemplace, estos tests tienen que seguir en verde.
"""

from deployflow_common import observability


def test_injecting_a_trace_context_never_drops_the_existing_headers():
    headers = {"x-attempt": "1"}

    result = observability.inject_trace_context(headers)

    assert result["x-attempt"] == "1"


def test_extracting_from_missing_or_empty_headers_is_safe():
    # Un mensaje publicado sin telemetría no trae traceparent: el worker igual tiene que procesarlo.
    observability.extract_trace_context(None)
    observability.extract_trace_context({})


def test_there_is_no_trace_id_outside_a_span():
    assert observability.current_trace_id() is None


def test_telemetry_can_be_set_up_and_shut_down_when_switched_off(monkeypatch):
    monkeypatch.setenv("TELEMETRY", "off")

    observability.setup_telemetry("api")
    observability.shutdown_telemetry()
