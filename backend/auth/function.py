import json
import logging

from db import pg_version

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def handler(event=None, context=None):
    event = event or {}
    # names only, never values: x-access-token and cookie carry credentials
    header_names = sorted((event.get("headers") or {}).keys())
    logger.info("headers received: %s", header_names)

    try:
        version = pg_version()
    except Exception as e:
        logger.error("db error: %s", e)
        return _resp(500, {"error": "database unavailable", "message": str(e)})

    return _resp(200, {
        "service": "auth",
        "postgres": version,
        "headers_received": header_names,
    })
