from shared import listing, log
from shared.authz import ROLES
from shared.db import get_conn
from shared.errors import ValidationFailed
from shared.http import Request, dispatch
from shared.router import Router
from shared.visibility import incident_visibility

log.setup("reports")
router = Router("reports")

STATUSES = ("unassigned", "open", "in_progress", "blocked", "resolved", "closed")
FINISHED = ("resolved", "closed")
PRIORITY_LABEL = {1: "low", 2: "medium", 3: "high", 4: "critical"}
CATEGORIES = ("electrical", "plumbing", "hvac", "cleaning", "furniture",
              "access_security", "network", "hardware", "software", "other")
ESCALATIONS = ("none", "pending", "granted", "declined")
TOP_DEFAULT, TOP_MAX = 10, 50


# the same repeatable status filter as the incidents list: how old closed tickets are left out (AD-19)
def _status_filter(request: Request) -> tuple[str, dict]:
    statuses = request.query.get("status") or []
    bad = [s for s in statuses if s not in STATUSES]
    if bad:
        raise ValidationFailed("invalid filters", {"status": f"unknown: {', '.join(bad)}"})
    return ("AND i.status = ANY(%(statuses)s)", {"statuses": statuses}) if statuses else ("", {})


def _top(request: Request) -> int:
    raw = listing.first(request.query, "limit")
    if raw is None:
        return TOP_DEFAULT
    if not raw.isdigit() or not 1 <= int(raw) <= TOP_MAX:
        raise ValidationFailed("invalid limit", {"limit": f"must be between 1 and {TOP_MAX}"})
    return int(raw)


def _counts(rows, keys) -> dict:
    # every key present, zero included, so a dashboard never has to guess a missing bucket
    found = dict(rows)
    return {key: found.get(key, 0) for key in keys}


@router.on("GET", "/health", public=True)
def health(request: Request) -> tuple[int, dict]:
    with get_conn().cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
    return 200, {"service": "reports", "database": "ok"}


# every persona's dashboard: the same counts, seen through the caller's own visibility (AD-19, AD-09)
@router.on("GET", "/summary", roles=set(ROLES))
def summary(request: Request) -> tuple[int, dict]:
    visible, params = incident_visibility(request.user)
    conn = get_conn()

    def grouped(column: str):
        return conn.execute(f"SELECT {column}, count(*) FROM incidents WHERE {visible} GROUP BY {column}", params).fetchall()

    total = conn.execute(f"SELECT count(*) FROM incidents WHERE {visible}", params).fetchone()[0]
    oldest = conn.execute(
        f"""SELECT id, title, created_at, extract(epoch FROM now() - created_at)::bigint
            FROM incidents WHERE {visible} AND status <> ALL(%(finished)s)
            ORDER BY created_at, id LIMIT 1""",
        {**params, "finished": list(FINISHED)},
    ).fetchone()
    return 200, {
        "total": total,
        "by_status": _counts(grouped("status"), STATUSES),
        "by_priority": _counts([(PRIORITY_LABEL[p], n) for p, n in grouped("priority")], PRIORITY_LABEL.values()),
        "by_category": _counts(grouped("category"), CATEGORIES),
        "by_escalation": _counts(grouped("escalation_status"), ESCALATIONS),
        # the longest-waiting unfinished ticket: the aging signal for every persona
        "oldest_active": None if oldest is None else {
            "id": oldest[0], "title": oldest[1], "created_at": oldest[2], "age_seconds": oldest[3]},
    }


# where issues recur (a required question); archived locations still count: the history is what matters
@router.on("GET", "/hotspots", roles={"admin"})
def hotspots(request: Request) -> tuple[int, dict]:
    status_clause, params = _status_filter(request)
    params["top"] = _top(request)
    conn = get_conn()

    def top(level: str, table: str, name: str, parent: str) -> list[dict]:
        rows = conn.execute(
            f"""SELECT l.id, l.{name}, {parent}, l.archived_at IS NOT NULL, count(*) AS incidents
                FROM incidents i JOIN {table} l ON l.id = i.{level}_id
                WHERE i.deleted_at IS NULL {status_clause}
                GROUP BY l.id, l.{name}, {parent}, l.archived_at
                ORDER BY incidents DESC, l.id LIMIT %(top)s""",
            params,
        ).fetchall()
        return [{"id": r[0], "name": r[1], "parent_id": r[2], "archived": r[3], "incidents": r[4]} for r in rows]

    return 200, {
        "buildings": top("building", "buildings", "name", "NULL::bigint"),
        "floors": top("floor", "floors", "name", "l.building_id"),
        "seats": top("seat", "seats", "label", "l.floor_id"),
    }


# three timings reconstructed from the history, all measured from creation so they read as one timeline (AD-19):
# assigned, acknowledged (the engineer's first open -> in_progress, AD-17), resolved. first occurrence, because
# reassignment can repeat a step
@router.on("GET", "/timings", roles={"admin"})
def timings(request: Request) -> tuple[int, dict]:
    status_clause, params = _status_filter(request)
    row = get_conn().execute(
        f"""
        WITH steps AS (
            SELECT h.incident_id,
                   min(h.created_at) FILTER (WHERE h.from_status IS NULL) AS created,
                   min(h.created_at) FILTER (WHERE h.from_status = 'unassigned' AND h.to_status = 'open') AS assigned,
                   min(h.created_at) FILTER (WHERE h.from_status = 'open' AND h.to_status = 'in_progress') AS acknowledged,
                   min(h.created_at) FILTER (WHERE h.to_status = 'resolved') AS resolved
            FROM incident_status_history h
            JOIN incidents i ON i.id = h.incident_id
            WHERE i.deleted_at IS NULL {status_clause}
            GROUP BY h.incident_id
        ),
        durations AS (
            SELECT extract(epoch FROM assigned - created) AS to_assign,
                   extract(epoch FROM acknowledged - created) AS to_acknowledge,
                   extract(epoch FROM resolved - created) AS to_resolve
            FROM steps
        )
        SELECT count(to_assign), percentile_cont(0.5) WITHIN GROUP (ORDER BY to_assign), avg(to_assign),
               count(to_acknowledge), percentile_cont(0.5) WITHIN GROUP (ORDER BY to_acknowledge), avg(to_acknowledge),
               count(to_resolve), percentile_cont(0.5) WITHIN GROUP (ORDER BY to_resolve), avg(to_resolve)
        FROM durations
        """,
        params,
    ).fetchone()

    # incidents that have not reached a step are left out of that step; the count says how many were measured
    def stat(count, median, average) -> dict:
        return {
            "count": count,
            "median_seconds": None if median is None else round(float(median)),
            "average_seconds": None if average is None else round(float(average)),
        }

    return 200, {
        "time_to_assign": stat(*row[0:3]),
        "time_to_acknowledge": stat(*row[3:6]),
        "time_to_resolve": stat(*row[6:9]),
    }


# which incidents are blocked or escalated, and why (a required question)
@router.on("GET", "/attention", roles={"admin"})
def attention(request: Request) -> tuple[int, dict]:
    top = _top(request)
    conn = get_conn()
    blocked = conn.execute(
        """
        SELECT i.id, i.title, i.assignee_id, holder.full_name, h.created_at, h.reason
        FROM incidents i
        LEFT JOIN users holder ON holder.id = i.assignee_id
        JOIN LATERAL (
            SELECT created_at, reason FROM incident_status_history
            WHERE incident_id = i.id AND to_status = 'blocked' ORDER BY created_at DESC, id DESC LIMIT 1
        ) h ON true
        WHERE i.deleted_at IS NULL AND i.status = 'blocked'
        ORDER BY h.created_at, i.id LIMIT %s
        """,
        (top,),
    ).fetchall()
    escalated = conn.execute(
        """
        SELECT i.id, i.title, i.escalation_status, n.created_at, n.body
        FROM incidents i
        LEFT JOIN LATERAL (
            SELECT created_at, body FROM ticket_notes
            WHERE incident_id = i.id AND kind = 'escalation' AND author_id = i.reporter_id AND deleted_at IS NULL
            ORDER BY created_at DESC, id DESC LIMIT 1
        ) n ON true
        WHERE i.deleted_at IS NULL AND i.status <> 'closed' AND i.escalation_status IN ('pending', 'granted')
        ORDER BY i.escalation_status DESC, n.created_at NULLS LAST, i.id LIMIT %s
        """,
        (top,),
    ).fetchall()
    return 200, {
        # the reason from history: the record, which no note deletion can erase (AD-17)
        "blocked": [{"id": r[0], "title": r[1], "assignee_id": r[2], "assignee_name": r[3],
                     "blocked_since": r[4], "reason": r[5]}
                    for r in blocked],
        # the reporter's own words from the escalation note; null if they have since deleted it (AD-20)
        "escalated": [{"id": r[0], "title": r[1], "escalation_status": r[2], "requested_at": r[3], "reason": r[4]}
                      for r in escalated],
    }


def handler(event=None, context=None):
    return dispatch(router, event, context)
