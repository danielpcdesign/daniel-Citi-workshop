import json
import logging

import pytest

from _shared import log


@pytest.fixture
def root_logger():
    root = logging.getLogger()
    saved = (root.level, list(root.handlers), [h.formatter for h in root.handlers])
    yield root
    root.setLevel(saved[0])
    root.handlers[:] = saved[1]
    for handler, formatter in zip(saved[1], saved[2]):
        handler.setFormatter(formatter)


def record(message="hello", fields=None, exc_info=None) -> logging.LogRecord:
    rec = logging.LogRecord("t", logging.INFO, __file__, 1, message, None, exc_info)
    if fields is not None:
        rec.fields = fields
    return rec


def test_line_is_json_with_request_context():
    log.request_id.set("req-9")
    log.correlation_id.set("cid-9")
    line = json.loads(log.JsonFormatter().format(record("did a thing", {"status": 201})))
    assert line["level"] == "INFO"
    assert line["message"] == "did a thing"
    assert (line["request_id"], line["correlation_id"]) == ("req-9", "cid-9")
    assert line["status"] == 201
    assert "timestamp" in line


def test_exception_is_included():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys
        line = json.loads(log.JsonFormatter().format(record(exc_info=sys.exc_info())))
    assert "ValueError: boom" in line["exception"]


def test_setup_reformats_existing_handlers_and_sets_service(root_logger, monkeypatch):
    monkeypatch.setenv("LOG_LEVEL", "debug")
    existing = logging.StreamHandler()
    root_logger.handlers[:] = [existing]
    log.setup("incidents")
    assert root_logger.handlers == [existing]
    assert isinstance(existing.formatter, log.JsonFormatter)
    assert root_logger.level == logging.DEBUG
    assert json.loads(existing.formatter.format(record()))["service"] == "incidents"


def test_setup_adds_a_handler_when_none_exist(root_logger, monkeypatch):
    monkeypatch.delenv("LOG_LEVEL", raising=False)
    root_logger.handlers[:] = []
    log.setup("auth")
    assert len(root_logger.handlers) == 1
    assert root_logger.level == logging.INFO
