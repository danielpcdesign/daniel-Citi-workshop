import json

import psycopg
import pytest


@pytest.fixture
def auth(load_service):
    return load_service("auth")


def get(auth, path="/api/auth"):
    event = {"rawPath": path, "requestContext": {"http": {"method": "GET"}}}
    return auth.handler(event, None)


def test_health_reports_database_reachable(auth, isolated_schema):
    response = get(auth)
    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {"service": "auth", "database": "ok"}


def test_health_does_not_fingerprint_the_server(auth, isolated_schema):
    # the m1 version returned "PostgreSQL 18.6 on x86_64..."; a public route must not
    assert "PostgreSQL" not in get(auth)["body"]


def test_health_through_the_local_proxy_path_shape(auth, isolated_schema):
    assert get(auth, "/")["statusCode"] == 200


def test_database_down_is_generic_500(auth, db_env, monkeypatch):
    def unreachable():
        raise psycopg.OperationalError("no route to host db-internal as superadmin")

    monkeypatch.setattr(auth, "get_conn", unreachable)
    response = get(auth)
    assert response["statusCode"] == 500
    assert json.loads(response["body"])["error"]["code"] == "internal"
    assert "superadmin" not in response["body"]
