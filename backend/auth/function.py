from shared import log
from shared.db import get_conn
from shared.http import Request, dispatch
from shared.router import Router

log.setup("auth")
router = Router("auth")


# public liveness check; reports reachability only, never versions or hostnames (fingerprinting)
@router.on("GET", "/", public=True)
def health(request: Request) -> tuple[int, dict]:
    with get_conn().cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
    return 200, {"service": "auth", "database": "ok"}


def handler(event=None, context=None):
    return dispatch(router, event, context)
