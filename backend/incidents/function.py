from shared import log
from shared.db import get_conn
from shared.http import Request, dispatch
from shared.router import Router

log.setup("incidents")
router = Router("incidents")


# public liveness check; reachability only (no versions or hostnames)
@router.on("GET", "/health", public=True)
def health(request: Request) -> tuple[int, dict]:
    with get_conn().cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
    return 200, {"service": "incidents", "database": "ok"}


def handler(event=None, context=None):
    return dispatch(router, event, context)
