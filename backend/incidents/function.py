from typing import Literal

from psycopg import Connection
from pydantic import BaseModel, ConfigDict, Field, field_validator

import policy
import workflow
from shared import listing, log
from shared.authz import ROLES, User
from shared.db import get_conn
from shared.errors import Forbidden, NotFound, ValidationFailed
from shared.http import Request, dispatch
from shared.router import Router
from workflow import Incident

log.setup("incidents")
router = Router("incidents")

ANYONE = set(ROLES)
CATEGORIES = ("electrical", "plumbing", "hvac", "cleaning", "furniture",
              "access_security", "network", "hardware", "software", "other")
# stored as a rank so sorting is numeric; labels in the api (AD-20)
PRIORITY_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}
PRIORITY_LABEL = {rank: label for label, rank in PRIORITY_RANK.items()}
ESCALATIONS = ("none", "pending", "granted", "declined")

Category = Literal["electrical", "plumbing", "hvac", "cleaning", "furniture",
                   "access_security", "network", "hardware", "software", "other"]
Priority = Literal["low", "medium", "high", "critical"]

COLUMNS = ("id, title, description, category, status, priority, requested_priority, escalation_status, "
           "reporter_id, assignee_id, building_id, floor_id, seat_id, created_at, updated_at")
FIELDS = [c.strip() for c in COLUMNS.split(",")]

# AD-13 sort allow-list: request keys map to fixed sql, never interpolated
SORTS = {"priority": "priority", "created_at": "created_at", "updated_at": "updated_at", "status": "status"}
# triage order: most urgent first, then longest waiting
DEFAULT_SORT = "-priority,created_at"


class IncidentIn(BaseModel):
    # unknown fields are an error, not silently dropped: a client sending reporter_id should hear no
    model_config = ConfigDict(extra="forbid")

    title: str = Field(max_length=200)
    description: str
    category: Category
    priority: Priority
    building_id: int
    floor_id: int | None = None
    seat_id: int | None = None

    @field_validator("title", "description")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty")
        return value.strip()


class IncidentEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=200)
    description: str | None = None
    category: Category | None = None
    priority: Priority | None = None
    building_id: int | None = None
    floor_id: int | None = None
    seat_id: int | None = None

    @field_validator("title", "description")
    @classmethod
    def not_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("must not be empty")
        return value.strip() if value else value


def _to_json(row: tuple, user: User) -> dict:
    data = dict(zip(FIELDS, row))
    incident = _incident(row)
    return {
        "id": data["id"],
        "title": data["title"],
        "description": data["description"],
        "category": data["category"],
        "status": data["status"],
        "priority": PRIORITY_LABEL[data["priority"]],
        "requested_priority": PRIORITY_LABEL[data["requested_priority"]],
        "escalation_status": data["escalation_status"],
        "reporter_id": data["reporter_id"],
        "assignee_id": data["assignee_id"],
        "location": {"building_id": data["building_id"], "floor_id": data["floor_id"], "seat_id": data["seat_id"]},
        "created_at": data["created_at"],
        "updated_at": data["updated_at"],
        # what this caller may do, so the ui shows exactly what the server allows (AD-09)
        "actions": policy.actions(user, incident),
    }


def _incident(row: tuple) -> Incident:
    data = dict(zip(FIELDS, row))
    return Incident(data["id"], data["status"], data["reporter_id"], data["assignee_id"], data["escalation_status"])


def _incident_id(raw: str) -> int:
    try:
        return int(raw)
    except ValueError:
        raise NotFound("incident not found")


# loads a row the caller may see, or 404: an id the caller cannot see is indistinguishable from none (AD-09)
def load(conn: Connection, user: User, raw_id: str, lock: bool = False) -> tuple:
    where, params = policy.visibility(user)
    row = conn.execute(
        f"SELECT {COLUMNS} FROM incidents WHERE id = %(id)s AND {where}{' FOR UPDATE' if lock else ''}",
        {**params, "id": _incident_id(raw_id)},
    ).fetchone()
    if row is None:
        raise NotFound("incident not found")
    return row


# the service's own check, for a precise 400 and the "not archived" rule the foreign keys cannot express (AD-22)
def check_location(conn: Connection, building_id: int, floor_id: int | None, seat_id: int | None) -> None:
    if seat_id is not None and floor_id is None:
        raise ValidationFailed("invalid location", {"seat_id": "a seat needs a floor"})
    if not conn.execute(
        "SELECT 1 FROM buildings WHERE id = %s AND archived_at IS NULL", (building_id,)
    ).fetchone():
        raise ValidationFailed("invalid location", {"building_id": f"building {building_id} does not exist"})
    if floor_id is not None and not conn.execute(
        "SELECT 1 FROM floors WHERE id = %s AND building_id = %s AND archived_at IS NULL", (floor_id, building_id)
    ).fetchone():
        raise ValidationFailed("invalid location", {"floor_id": f"floor {floor_id} does not exist in building {building_id}"})
    if seat_id is not None and not conn.execute(
        "SELECT 1 FROM seats WHERE id = %s AND floor_id = %s AND archived_at IS NULL", (seat_id, floor_id)
    ).fetchone():
        raise ValidationFailed("invalid location", {"seat_id": f"seat {seat_id} does not exist on floor {floor_id}"})


@router.on("GET", "/health", public=True)
def health(request: Request) -> tuple[int, dict]:
    with get_conn().cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
    return 200, {"service": "incidents", "database": "ok"}


# anyone signed in may report; roles inherit employee capabilities (M5 scope)
@router.on("POST", "/", roles=ANYONE)
def create(request: Request) -> tuple[int, dict]:
    data = IncidentIn.model_validate(request.body)
    conn = get_conn()
    check_location(conn, data.building_id, data.floor_id, data.seat_id)
    rank = PRIORITY_RANK[data.priority]
    with conn.transaction():
        row = conn.execute(
            f"""
            INSERT INTO incidents (title, description, category, requested_priority, priority,
                                   reporter_id, building_id, floor_id, seat_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {COLUMNS}
            """,
            # the reporter is always the caller, never taken from the body
            (data.title, data.description, data.category, rank, rank,
             request.user.id, data.building_id, data.floor_id, data.seat_id),
        ).fetchone()
        # the creation row: the start of every timing metric (schema note 4)
        conn.execute(
            "INSERT INTO incident_status_history (incident_id, from_status, to_status, actor_id) VALUES (%s, NULL, 'unassigned', %s)",
            (row[0], request.user.id),
        )
    return 201, _to_json(row, request.user)


def _filters(query: dict[str, list[str]]) -> tuple[list[str], dict]:
    clauses, params, errors = [], {}, {}
    statuses = query.get("status") or []
    if statuses:
        bad = [s for s in statuses if s not in workflow.STATUSES]
        if bad:
            errors["status"] = f"unknown: {', '.join(bad)}"
        clauses.append("status = ANY(%(statuses)s)")
        params["statuses"] = statuses
    for name, allowed, column, convert in (
        ("priority", PRIORITY_RANK, "priority", PRIORITY_RANK.get),
        ("category", CATEGORIES, "category", str),
        ("escalation_status", ESCALATIONS, "escalation_status", str),
    ):
        value = listing.first(query, name)
        if value is None:
            continue
        if value not in allowed:
            errors[name] = f"must be one of {', '.join(allowed)}"
            continue
        clauses.append(f"{column} = %({name})s")
        params[name] = convert(value)
    for name in ("building_id", "floor_id", "seat_id", "assignee_id"):
        value = listing.first(query, name)
        if value is None:
            continue
        if not value.isdigit():
            errors[name] = "must be a whole number"
            continue
        clauses.append(f"{name} = %({name})s")
        params[name] = int(value)
    search = (listing.first(query, "q") or "").strip()
    if search:
        clauses.append("(title ILIKE %(q)s OR description ILIKE %(q)s)")
        # % and _ are wildcards in LIKE: escape them so a search for "50%" means the text "50%"
        params["q"] = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    if errors:
        raise ValidationFailed("invalid filters", errors)
    return clauses, params


@router.on("GET", "/", roles=ANYONE)
def list_incidents(request: Request) -> tuple[int, dict]:
    page, limit, offset = listing.paging(request.query)
    order = listing.order_by(request.query, SORTS, DEFAULT_SORT)
    visible, params = policy.visibility(request.user)
    clauses, filter_params = _filters(request.query)
    where = " AND ".join([visible, *clauses])
    params = {**params, **filter_params, "limit": limit, "offset": offset}
    conn = get_conn()
    total = conn.execute(f"SELECT count(*) FROM incidents WHERE {where}", params).fetchone()[0]
    rows = conn.execute(
        f"SELECT {COLUMNS} FROM incidents WHERE {where} ORDER BY {order} LIMIT %(limit)s OFFSET %(offset)s", params
    ).fetchall()
    return 200, listing.envelope([_to_json(row, request.user) for row in rows], total, page, limit)


@router.on("GET", "/{incident_id}", roles=ANYONE)
def detail(request: Request) -> tuple[int, dict]:
    return 200, _to_json(load(get_conn(), request.user, request.params["incident_id"]), request.user)


@router.on("PUT", "/{incident_id}", roles=ANYONE)
def edit(request: Request) -> tuple[int, dict]:
    changes = IncidentEdit.model_validate(request.body or {}).model_dump(exclude_unset=True)
    if not changes:
        raise ValidationFailed("nothing to change", {"body": "provide at least one field"})
    conn = get_conn()
    with conn.transaction():
        row = load(conn, request.user, request.params["incident_id"], lock=True)
        current = dict(zip(FIELDS, row))
        # location is one editable unit: building, floor, and seat are validated together
        wanted = {"location" if k in ("building_id", "floor_id", "seat_id") else k for k in changes}
        refused = wanted - policy.editable_fields(request.user, _incident(row))
        if refused:
            raise Forbidden("you cannot edit these fields", {name: "not editable by you now" for name in sorted(refused)})
        if "location" in wanted:
            building = changes.get("building_id", current["building_id"])
            # a new building resets floor and seat unless they are given again
            floor = changes.get("floor_id", None if "building_id" in changes else current["floor_id"])
            seat = changes.get("seat_id", None if {"building_id", "floor_id"} & changes.keys() else current["seat_id"])
            check_location(conn, building, floor, seat)
            changes.update(building_id=building, floor_id=floor, seat_id=seat)
        if "priority" in changes:
            changes["priority"] = PRIORITY_RANK[changes["priority"]]
        assignments = ", ".join(f"{column} = %({column})s" for column in changes)
        row = conn.execute(
            f"UPDATE incidents SET {assignments}, updated_at = now() WHERE id = %(id)s RETURNING {COLUMNS}",
            {**changes, "id": current["id"]},
        ).fetchone()
    return 200, _to_json(row, request.user)


# soft delete, admin only: history and notes survive for the reports (schema decision B)
@router.on("DELETE", "/{incident_id}", roles={"admin"})
def delete(request: Request) -> tuple[int, None]:
    conn = get_conn()
    row = load(conn, request.user, request.params["incident_id"])
    conn.execute(
        "UPDATE incidents SET deleted_at = now(), deleted_by = %s WHERE id = %s", (request.user.id, row[0])
    )
    return 204, None


def handler(event=None, context=None):
    return dispatch(router, event, context)
