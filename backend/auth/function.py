import json
import logging

from shared.db import get_conn, reset_conn

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _pg_version() -> str:
    try:
        with get_conn().cursor() as cur:
            cur.execute("SELECT version();")
            row = cur.fetchone()
            return row[0] if row else "unknown"
    except Exception:
        reset_conn()
        raise


def handler(event=None, context=None):
    event = event or {}
    # names only, never values: x-access-token and cookie carry credentials
    header_names = sorted((event.get("headers") or {}).keys())
    logger.info("headers received: %s", header_names)

    request_id = getattr(context, "aws_request_id", None)
    try:
        version = _pg_version()
    except Exception:
        # detail stays in the log, keyed by request id; the caller gets no internals (AD-12)
        logger.exception("db error, request_id=%s", request_id)
        return _resp(500, {"error": {
            "code": "internal",
            "message": "internal error",
            "request_id": request_id,
        }})

    return _resp(200, {
        "service": "auth",
        "postgres": version,
        "headers_received": header_names,
    })
