import json

import pytest


@pytest.fixture
def auth(load_service):
    return load_service("auth")


def test_reports_postgres_and_header_names(auth, isolated_schema):
    event = {"headers": {"x-access-token": "secret-value", "accept": "*/*"}}
    response = auth.handler(event)
    body = json.loads(response["body"])
    assert response["statusCode"] == 200
    assert body["postgres"].startswith("PostgreSQL")
    assert body["headers_received"] == ["accept", "x-access-token"]
    # header names only: credential values must never be echoed back
    assert "secret-value" not in response["body"]


def test_event_without_headers(auth, isolated_schema):
    assert auth.handler({})["statusCode"] == 200
    assert auth.handler(None)["statusCode"] == 200


def test_database_error_returns_generic_500_and_resets(auth, db_env, monkeypatch, caplog):
    resets = []

    def unreachable():
        raise ConnectionError("no route to host db-internal.acme.local:5432 as user superadmin")

    class Context:
        aws_request_id = "req-123"

    monkeypatch.setattr(auth, "get_conn", unreachable)
    monkeypatch.setattr(auth, "reset_conn", lambda: resets.append(True))
    response = auth.handler({}, Context())
    assert response["statusCode"] == 500
    assert json.loads(response["body"]) == {"error": {
        "code": "internal", "message": "internal error", "request_id": "req-123"}}
    # internals never reach the caller; they reach the log, findable by request id (AD-12)
    assert "superadmin" not in response["body"]
    assert "db-internal" not in response["body"]
    assert "req-123" in caplog.text and "superadmin" in caplog.text
    # a broken connection is dropped so the next invocation reconnects
    assert resets == [True]


def test_empty_version_row_reads_unknown(auth, db_env, monkeypatch):
    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def execute(self, sql):
            pass

        def fetchone(self):
            return None

    class Conn:
        def cursor(self):
            return Cursor()

    monkeypatch.setattr(auth, "get_conn", lambda: Conn())
    assert json.loads(auth.handler({})["body"])["postgres"] == "unknown"
