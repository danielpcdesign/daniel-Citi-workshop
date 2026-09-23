import base64
import json
import logging
import uuid

import psycopg
import pytest
from psycopg import errors as pg_errors
from pydantic import BaseModel, Field

from _shared import authz, http
from _shared.errors import Conflict, NotFound
from _shared.router import Router

ANY = {"employee", "engineer", "admin"}


class Context:
    aws_request_id = "req-1"


class NoteIn(BaseModel):
    body: str = Field(min_length=1)
    kind: str = "comment"


@pytest.fixture
def router() -> Router:
    r = Router("incidents")

    @r.on("GET", "/", public=True)
    def health(request):
        return 200, {"ok": True, "query": request.query}

    @r.on("GET", "/{incident_id}", roles=ANY)
    def get_incident(request):
        return 200, {"id": request.params["incident_id"], "user": request.user.id}

    @r.on("POST", "/{incident_id}/notes", roles={"employee"})
    def add_note(request):
        note = NoteIn.model_validate(request.body)
        return 201, {"body": note.body}

    @r.on("DELETE", "/{incident_id}", roles={"admin"})
    def delete_incident(request):
        return 204, None

    @r.on("POST", "/boom", public=True)
    def boom(request):
        raise RuntimeError("secret detail: host db-internal, user superadmin")

    @r.on("POST", "/fk", public=True)
    def fk(request):
        raise pg_errors.ForeignKeyViolation("insert violates fk on floors")

    @r.on("POST", "/dupe", public=True)
    def dupe(request):
        raise pg_errors.UniqueViolation("duplicate key users_email_key")

    @r.on("POST", "/gone", public=True)
    def gone(request):
        raise psycopg.OperationalError("server closed the connection")

    @r.on("POST", "/taken", public=True)
    def taken(request):
        raise Conflict("that email is already registered")

    return r


def event(method: str, path: str, body=None, headers=None, query="", b64=False) -> dict:
    raw = None if body is None else (body if isinstance(body, str) else json.dumps(body))
    if b64 and raw is not None:
        raw = base64.b64encode(raw.encode()).decode()
    return {
        "rawPath": path,
        "rawQueryString": query,
        "headers": headers or {},
        "body": raw,
        "isBase64Encoded": b64,
        "requestContext": {"http": {"method": method}},
    }


def call(router, *args, **kwargs) -> tuple[int, dict, dict]:
    response = http.dispatch(router, event(*args, **kwargs), Context())
    body = json.loads(response["body"]) if response["body"] else None
    return response["statusCode"], body, response["headers"]


def as_user(monkeypatch, role: str, user_id: int = 7) -> None:
    monkeypatch.setattr(authz, "authenticate", lambda event: authz.User(user_id, role))


# --- routing and access (AD-05, AD-09) ----------------------------------------------------

def test_public_route_needs_no_user(router):
    status, body, _ = call(router, "GET", "/api/incidents", query="status=open&status=blocked")
    assert status == 200
    assert body["query"] == {"status": ["open", "blocked"]}


def test_protected_route_without_a_token_is_401(router):
    status, body, _ = call(router, "GET", "/api/incidents/42")
    assert status == 401
    assert body["error"]["code"] == "unauthenticated"


def test_allowed_role_reaches_the_handler(router, monkeypatch):
    as_user(monkeypatch, "engineer", user_id=9)
    status, body, _ = call(router, "GET", "/42")
    assert (status, body) == (200, {"id": "42", "user": 9})


def test_wrong_role_is_forbidden(router, monkeypatch):
    as_user(monkeypatch, "engineer")
    status, body, _ = call(router, "DELETE", "/api/incidents/42")
    assert status == 403
    assert body["error"]["code"] == "forbidden"


def test_unknown_route_is_404_with_envelope(router):
    status, body, _ = call(router, "GET", "/api/incidents/42/attachments")
    assert status == 404
    assert body == {"error": {"code": "not_found", "message": "no such route", "request_id": "req-1"}}


def test_wrong_method_is_405_with_allow_header(router):
    status, body, headers = call(router, "PATCH", "/")
    assert status == 405
    assert body["error"]["code"] == "method_not_allowed"
    assert headers["Allow"] == "GET"


def test_no_content_has_empty_body(router, monkeypatch):
    as_user(monkeypatch, "admin")
    response = http.dispatch(router, event("DELETE", "/42"), Context())
    assert response["statusCode"] == 204
    assert response["body"] == ""


# --- request bodies and validation (AD-12) ------------------------------------------------

def test_valid_body_reaches_the_handler(router, monkeypatch):
    as_user(monkeypatch, "employee")
    status, body, _ = call(router, "POST", "/42/notes", {"body": "still leaking"})
    assert (status, body) == (201, {"body": "still leaking"})


def test_base64_body_is_decoded(router, monkeypatch):
    as_user(monkeypatch, "employee")
    status, body, _ = call(router, "POST", "/42/notes", {"body": "encoded"}, b64=True)
    assert (status, body) == (201, {"body": "encoded"})


@pytest.mark.parametrize("raw,b64", [
    ("{not json", False),                          # invalid json
    ("%%%", True),                                 # invalid base64
    (base64.b64encode(b"\xff").decode(), True),   # valid base64, not utf-8
])
def test_malformed_body_is_bad_request(router, monkeypatch, raw, b64):
    as_user(monkeypatch, "employee")
    ev = event("POST", "/42/notes")
    ev["body"], ev["isBase64Encoded"] = raw, b64
    response = http.dispatch(router, ev, Context())
    assert response["statusCode"] == 400
    assert json.loads(response["body"])["error"]["code"] == "bad_request"


def test_validation_errors_map_to_fields(router, monkeypatch):
    as_user(monkeypatch, "employee")
    status, body, _ = call(router, "POST", "/42/notes", {"body": ""})
    assert status == 400
    assert body["error"]["code"] == "validation_failed"
    assert set(body["error"]["fields"]) == {"body"}


def test_missing_body_is_a_validation_error_not_a_crash(router, monkeypatch):
    as_user(monkeypatch, "employee")
    status, body, _ = call(router, "POST", "/42/notes")
    assert status == 400
    assert body["error"]["fields"] == {"body": "Input should be a valid dictionary or instance of NoteIn"}


def test_api_error_from_a_handler(router):
    status, body, _ = call(router, "POST", "/taken")
    assert status == 409
    assert body["error"] == {"code": "conflict", "message": "that email is already registered", "request_id": "req-1"}


# --- database backstops and failures (AD-12, AD-22) ---------------------------------------

def test_foreign_key_violation_is_400(router):
    status, body, _ = call(router, "POST", "/fk")
    assert status == 400
    assert body["error"]["code"] == "validation_failed"


def test_unique_violation_is_409(router):
    status, body, _ = call(router, "POST", "/dupe")
    assert status == 409
    assert body["error"]["code"] == "conflict"


def test_lost_connection_is_500_and_resets(router, monkeypatch):
    resets = []
    monkeypatch.setattr(http, "reset_conn", lambda: resets.append(True))
    status, body, _ = call(router, "POST", "/gone")
    assert status == 500
    assert resets == [True]


def test_unexpected_error_is_generic_500_and_logged(router, caplog):
    with caplog.at_level(logging.INFO):
        response = http.dispatch(router, event("POST", "/boom"), Context())
    assert response["statusCode"] == 500
    assert json.loads(response["body"]) == {"error": {
        "code": "internal", "message": "internal error", "request_id": "req-1"}}
    # internals reach the log, never the caller
    assert "superadmin" not in response["body"]
    assert "superadmin" in caplog.text


# --- correlation and access log (AD-16) ---------------------------------------------------

def test_valid_correlation_id_is_echoed(router):
    cid = str(uuid.uuid4())
    _, _, headers = call(router, "GET", "/", headers={"X-Correlation-Id": cid})
    assert headers["X-Correlation-Id"] == cid


def test_malformed_correlation_id_falls_back_to_request_id(router, caplog):
    with caplog.at_level(logging.WARNING):
        _, _, headers = call(router, "GET", "/", headers={"x-correlation-id": "abc\ninjected"})
    assert headers["X-Correlation-Id"] == "req-1"
    assert "malformed correlation id" in caplog.text


def test_missing_correlation_id_uses_request_id(router):
    _, _, headers = call(router, "GET", "/")
    assert headers["X-Correlation-Id"] == "req-1"


def test_request_id_is_generated_without_a_context(router):
    response = http.dispatch(router, event("GET", "/"), None)
    assert uuid.UUID(response["headers"]["X-Correlation-Id"])


def test_one_access_line_with_route_pattern(router, monkeypatch, caplog):
    as_user(monkeypatch, "engineer", user_id=9)
    with caplog.at_level(logging.INFO):
        call(router, "GET", "/api/incidents/42")
    access = [r for r in caplog.records if r.getMessage() == "request"]
    assert len(access) == 1
    fields = access[0].fields
    # the pattern, not /42, so every incident's requests group together
    assert fields["route"] == "/{incident_id}"
    assert (fields["method"], fields["status"], fields["user_id"]) == ("GET", 200, 9)
    assert fields["duration_ms"] >= 0


def test_access_line_for_unrouted_request_has_no_route(router, caplog):
    with caplog.at_level(logging.INFO):
        call(router, "GET", "/nowhere/at/all")
    fields = next(r for r in caplog.records if r.getMessage() == "request").fields
    assert fields["route"] is None and fields["status"] == 404


def test_none_event_is_handled(router):
    # an empty event has no method; the root path exists, so it is a method mismatch, not a crash
    assert http.dispatch(router, None, Context())["statusCode"] == 405


def test_not_found_raised_by_a_handler_uses_its_message(monkeypatch):
    r = Router("x")

    @r.on("GET", "/{id}", public=True)
    def missing(request):
        raise NotFound("incident 42 not found")

    status, body, _ = call(r, "GET", "/42")
    assert (status, body["error"]["message"]) == (404, "incident 42 not found")
