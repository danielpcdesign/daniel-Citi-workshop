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


def test_database_error_returns_500_and_resets(auth, db_env, monkeypatch):
    resets = []

    def unreachable():
        raise ConnectionError("no route to host")

    monkeypatch.setattr(auth, "get_conn", unreachable)
    monkeypatch.setattr(auth, "reset_conn", lambda: resets.append(True))
    response = auth.handler({})
    assert response["statusCode"] == 500
    assert json.loads(response["body"])["error"] == "database unavailable"
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
