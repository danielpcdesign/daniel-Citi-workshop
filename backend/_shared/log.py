import json
import logging
import os
from contextvars import ContextVar
from datetime import datetime, timezone

# set once per request by the wrapper, so every log line in that request carries them (AD-16)
request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
correlation_id: ContextVar[str | None] = ContextVar("correlation_id", default=None)
_service: str | None = None


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "service": _service,
            "request_id": request_id.get(),
            "correlation_id": correlation_id.get(),
            "message": record.getMessage(),
        }
        # structured fields passed as logger.info("...", extra={"fields": {...}})
        line.update(getattr(record, "fields", {}) or {})
        if record.exc_info:
            line["exception"] = self.formatException(record.exc_info)
        return json.dumps(line, default=str)


def setup(service: str) -> logging.Logger:
    global _service
    _service = service
    root = logging.getLogger()
    root.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())
    # the lambda runtime installs its own handler on the root logger; reformat it rather than add a second
    if not root.handlers:
        root.addHandler(logging.StreamHandler())
    for handler in root.handlers:
        handler.setFormatter(JsonFormatter())
    return root
