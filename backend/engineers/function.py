from pydantic import BaseModel, ConfigDict, StrictBool

from shared import listing, log
from shared.db import get_conn
from shared.errors import NotFound, ValidationFailed
from shared.http import Request, dispatch
from shared.incident_ops import ACTIVE
from shared.router import Router

log.setup("engineers")
router = Router("engineers")

# the workload is computed from the tickets themselves at read time, so it can never drift from them (M7).
# a named subquery gives every column one unambiguous name for filtering, sorting, and the id tie-breaker
ENGINEERS = """
    WITH engineers AS (
        SELECT u.id, u.email, u.full_name, p.is_available,
               count(i.id) FILTER (WHERE i.status = ANY(%(active)s) AND i.deleted_at IS NULL) AS workload
        FROM engineer_profiles p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN incidents i ON i.assignee_id = u.id
        GROUP BY u.id, u.email, u.full_name, p.is_available
    )
"""
COLUMNS = ("id", "email", "full_name", "is_available", "workload")
# AD-13 allow-list; "workload" ascending answers "who has capacity?"
SORTS = {"name": "full_name", "email": "email", "workload": "workload"}


class AvailabilityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # strict: "yes" or 1 is a 400, not a silent True
    is_available: StrictBool


def _to_json(row: tuple) -> dict:
    return dict(zip(COLUMNS, row))


def _user_id(raw: str) -> int:
    try:
        return int(raw)
    except ValueError:
        raise NotFound("engineer not found")


def _one(user_id: int) -> dict:
    row = get_conn().execute(
        f"{ENGINEERS} SELECT {', '.join(COLUMNS)} FROM engineers WHERE id = %(id)s",
        {"active": list(ACTIVE), "id": user_id},
    ).fetchone()
    if row is None:
        raise NotFound("engineer not found")
    return _to_json(row)


@router.on("GET", "/health", public=True)
def health(request: Request) -> tuple[int, dict]:
    with get_conn().cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
    return 200, {"service": "engineers", "database": "ok"}


# the assignment tool: who is available, and how is work distributed (admins only, M7)
@router.on("GET", "/", roles={"admin"})
def list_engineers(request: Request) -> tuple[int, dict]:
    page, limit, offset = listing.paging(request.query)
    order = listing.order_by(request.query, SORTS, "name")
    clauses, params = [], {"active": list(ACTIVE), "limit": limit, "offset": offset}
    available = listing.first(request.query, "available")
    if available is not None:
        if available not in ("true", "false"):
            raise ValidationFailed("invalid filters", {"available": "must be true or false"})
        clauses.append("is_available = %(available)s")
        params["available"] = available == "true"
    search = (listing.first(request.query, "q") or "").strip()
    if search:
        clauses.append("(full_name ILIKE %(q)s OR email ILIKE %(q)s)")
        params["q"] = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    conn = get_conn()
    total = conn.execute(f"{ENGINEERS} SELECT count(*) FROM engineers {where}", params).fetchone()[0]
    rows = conn.execute(
        f"{ENGINEERS} SELECT {', '.join(COLUMNS)} FROM engineers {where} ORDER BY {order} LIMIT %(limit)s OFFSET %(offset)s",
        params,
    ).fetchall()
    return 200, listing.envelope([_to_json(row) for row in rows], total, page, limit)


# a literal route: it wins over /{user_id} whatever the registration order (AD-05 specificity fix)
@router.on("GET", "/me", roles={"engineer"})
def me(request: Request) -> tuple[int, dict]:
    return 200, _one(request.user.id)


@router.on("GET", "/{user_id}", roles={"admin"})
def get_engineer(request: Request) -> tuple[int, dict]:
    return 200, _one(_user_id(request.params["user_id"]))


# decided: toggled by the engineer or an admin. current tickets stay: unavailable means "no new work" (M7)
@router.on("PUT", "/{user_id}/availability", roles={"engineer", "admin"})
def set_availability(request: Request) -> tuple[int, dict]:
    user_id = _user_id(request.params["user_id"])
    # an engineer cannot see other engineers, so another's id is indistinguishable from none (AD-09)
    if request.user.role == "engineer" and user_id != request.user.id:
        raise NotFound("engineer not found")
    data = AvailabilityIn.model_validate(request.body)
    updated = get_conn().execute(
        "UPDATE engineer_profiles SET is_available = %s WHERE user_id = %s RETURNING user_id",
        (data.is_available, user_id),
    ).fetchone()
    if updated is None:
        raise NotFound("engineer not found")
    return 200, _one(user_id)


def handler(event=None, context=None):
    return dispatch(router, event, context)
