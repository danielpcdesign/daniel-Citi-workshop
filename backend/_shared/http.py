import base64
import binascii
import json
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import date, datetime
from urllib.parse import parse_qs

import psycopg
from psycopg import errors as pg_errors
from pydantic import ValidationError

from . import authz, log
from .db import reset_conn
from .errors import ApiError, BadRequest, Forbidden, MethodNotAllowed
from .router import Router

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Request:
    method: str
    path: str
    params: dict[str, str]
    query: dict[str, list[str]]
    body: object
    user: authz.User | None
    headers: dict[str, str]
    cookies: dict[str, str]


# the single entry point every lambda's handler calls (AD-12): route, authorise, parse, run, envelope, log
def dispatch(router: Router, event: dict | None, context: object) -> dict:
    started = time.perf_counter()
    event = event or {}
    headers = {name.lower(): value for name, value in (event.get("headers") or {}).items()}
    req_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())
    log.request_id.set(req_id)
    log.correlation_id.set(_correlation_id(headers.get("x-correlation-id"), req_id))

    http = (event.get("requestContext") or {}).get("http") or {}
    method = (http.get("method") or "").upper()
    raw_path = event.get("rawPath") or "/"
    route = None
    user = None
    extra_headers: dict[str, str] = {}

    try:
        route, params = router.resolve(method, raw_path)
        if not route.public:
            user = authz.authenticate(event)
            # the route exists and is public knowledge, so a role mismatch is 403, not 404 (AD-09)
            if user.role not in route.roles:
                raise Forbidden("your role cannot use this endpoint")
        request = Request(
            method=method,
            path=router.normalize(raw_path),
            params=params,
            query=parse_qs(event.get("rawQueryString") or ""),
            body=_body(event),
            user=user,
            headers=headers,
            cookies=_cookies(event, headers),
        )
        # a handler returns (status, body) or (status, body, set_cookies)
        status, body, *rest = route.handler(request)
        set_cookies = rest[0] if rest else []
    except Exception as exc:
        status, body, extra_headers = _error(exc, req_id)
        set_cookies = []

    response = {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "X-Correlation-Id": log.correlation_id.get(),
            **extra_headers,
        },
        "body": "" if body is None else json.dumps(body, default=_json_default),
    }
    if set_cookies:
        # aws function urls set cookies from the `cookies` field; localstack ignores it and only honours a
        # Set-Cookie header (probed 2026-09-23). we set one cookie at most, so send it both ways.
        response["cookies"] = set_cookies
        response["headers"]["Set-Cookie"] = set_cookies[0]
    # one access line per request (AD-16): the route pattern, not the path, so requests group by endpoint
    logger.info("request", extra={"fields": {
        "method": method,
        "route": route.pattern if route else None,
        "status": status,
        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
        "user_id": user.id if user else None,
    }})
    return response


def _json_default(value: object) -> str:
    # iso 8601 with a "T": str(datetime) uses a space, which some browsers (historically safari) cannot parse (E7)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _correlation_id(value: str | None, fallback: str) -> str:
    if value is None:
        return fallback
    try:
        # only a real uuid is trusted into the logs; anything else could be log injection
        return str(uuid.UUID(value))
    except ValueError:
        logger.warning("malformed correlation id ignored")
        return fallback


def _cookies(event: dict, headers: dict[str, str]) -> dict[str, str]:
    # aws delivers cookies as a list in event["cookies"]; localstack leaves them in the cookie header
    pairs = event.get("cookies") or (headers.get("cookie") or "").split(";")
    cookies = {}
    for pair in pairs:
        name, sep, value = pair.strip().partition("=")
        if sep and name:
            cookies[name] = value
    return cookies


def _body(event: dict) -> object:
    raw = event.get("body")
    if raw in (None, ""):
        return None
    try:
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        return json.loads(raw)
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError):
        raise BadRequest("request body is not valid JSON")


def _envelope(code: str, message: str, req_id: str, fields: dict | None = None) -> dict:
    error = {"code": code, "message": message, "request_id": req_id}
    if fields:
        error["fields"] = fields
    return {"error": error}


def _error(exc: Exception, req_id: str) -> tuple[int, dict, dict[str, str]]:
    if isinstance(exc, MethodNotAllowed):
        return exc.status, _envelope(exc.code, exc.message, req_id), {"Allow": ", ".join(exc.allowed)}
    if isinstance(exc, ApiError):
        return exc.status, _envelope(exc.code, exc.message, req_id, exc.fields), {}
    if isinstance(exc, ValidationError):
        fields = {".".join(str(part) for part in err["loc"]) or "body": err["msg"] for err in exc.errors()}
        return 400, _envelope("validation_failed", f"{len(fields)} field(s) invalid", req_id, fields), {}
    # the database is the backstop for checks a service missed (AD-12, AD-22)
    if isinstance(exc, pg_errors.ForeignKeyViolation):
        return 400, _envelope("validation_failed", "a referenced record does not exist", req_id), {}
    if isinstance(exc, pg_errors.UniqueViolation):
        return 409, _envelope("conflict", "a record with these values already exists", req_id), {}
    if isinstance(exc, (psycopg.OperationalError, psycopg.InterfaceError)):
        # a broken connection is dropped so the next invocation reconnects (AD-04)
        reset_conn()
    # detail stays in the log, keyed by request id; the caller gets nothing internal
    logger.exception("unhandled error")
    return 500, _envelope("internal", "internal error", req_id), {}
