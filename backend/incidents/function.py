from typing import Literal

from psycopg import Connection
from pydantic import BaseModel, ConfigDict, Field, field_validator

import notes
import policy
import workflow
from shared import listing, log, text
from shared.authz import ROLES, User
from shared.db import get_conn
from shared.errors import Forbidden, NotFound, ValidationFailed
from shared.incident_ops import apply_transition
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

# read from the incidents_read view (migration 002): the base columns plus names, so no extra round-trip (E1, E2)
COLUMNS = ("id, title, description, category, status, priority, requested_priority, escalation_status, "
           "reporter_id, assignee_id, building_id, floor_id, seat_id, created_at, updated_at, "
           "building_name, building_archived, floor_name, floor_archived, seat_name, seat_archived, "
           "reporter_name, assignee_name")
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

    @field_validator("title")
    @classmethod
    def titled(cls, value: str) -> str:
        return text.clean(value, text.TITLE_MAX)

    @field_validator("description")
    @classmethod
    def described(cls, value: str) -> str:
        return text.clean(value, text.LONG_TEXT_MAX, multiline=True)


class TransitionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    to: str
    reason: str | None = None

    @field_validator("reason")
    @classmethod
    def explained(cls, value: str | None) -> str | None:
        # blank stays "no reason": whether one is required depends on the move (AD-17)
        return text.optional(value, text.REASON_MAX, multiline=True)


class EscalationRequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str

    @field_validator("reason")
    @classmethod
    def explained(cls, value: str) -> str:
        # blank passes through to _required_reason, which owns that message
        return text.optional(value, text.REASON_MAX, multiline=True) or ""


class EscalationDecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # pending is reachable only through a reporter's request (AD-20)
    status: Literal["none", "granted", "declined"]
    reason: str

    @field_validator("reason")
    @classmethod
    def explained(cls, value: str) -> str:
        return text.optional(value, text.REASON_MAX, multiline=True) or ""


def _required_reason(reason: str) -> str:
    reason = reason.strip()
    if not reason:
        # every escalation change posts a note with a reason (AD-20)
        raise ValidationFailed("a reason is required", {"reason": "must not be empty"})
    return reason


class AssignmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    engineer_id: int


class IncidentEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=200)
    description: str | None = None
    category: Category | None = None
    priority: Priority | None = None
    building_id: int | None = None
    floor_id: int | None = None
    seat_id: int | None = None

    # None means "leave unchanged"; a value given must meet the same rules as on create
    @field_validator("title")
    @classmethod
    def titled(cls, value: str | None) -> str | None:
        return None if value is None else text.clean(value, text.TITLE_MAX)

    @field_validator("description")
    @classmethod
    def described(cls, value: str | None) -> str | None:
        return None if value is None else text.clean(value, text.LONG_TEXT_MAX, multiline=True)


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
        "reporter_name": data["reporter_name"],
        "assignee_id": data["assignee_id"],
        "assignee_name": data["assignee_name"],
        # names travel with ids, archived flagged: an old ticket still names its location (E1, M6 consequence)
        "location": {
            level: None if data[f"{level}_id"] is None else {
                "id": data[f"{level}_id"], "name": data[f"{level}_name"], "archived": data[f"{level}_archived"]}
            for level in ("building", "floor", "seat")
        },
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
    params = {**params, "id": _incident_id(raw_id)}
    if lock:
        # the lock goes on the base row: postgres refuses FOR UPDATE through the view's outer joins
        conn.execute(f"SELECT 1 FROM incidents WHERE id = %(id)s AND {where} FOR UPDATE", params)
    row = conn.execute(f"SELECT {COLUMNS} FROM incidents_read WHERE id = %(id)s AND {where}", params).fetchone()
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
        incident_id = conn.execute(
            """
            INSERT INTO incidents (title, description, category, requested_priority, priority,
                                   reporter_id, building_id, floor_id, seat_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            # the reporter is always the caller, never taken from the body
            (data.title, data.description, data.category, rank, rank,
             request.user.id, data.building_id, data.floor_id, data.seat_id),
        ).fetchone()[0]
        # the creation row: the start of every timing metric (schema note 4)
        conn.execute(
            "INSERT INTO incident_status_history (incident_id, from_status, to_status, actor_id) VALUES (%s, NULL, 'unassigned', %s)",
            (incident_id, request.user.id),
        )
        row = load(conn, request.user, str(incident_id))
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
    # reporter_id: "my reports" for engineers and admins, who see more than their own (E5, reopened AD-13)
    for name in ("building_id", "floor_id", "seat_id", "assignee_id", "reporter_id"):
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
        text = "title ILIKE %(q)s OR description ILIKE %(q)s"
        # a bare ticket number ("42" or "#42") also finds that incident; visibility still applies (M9)
        number = search.removeprefix("#")
        if number.isdigit():
            clauses.append(f"(id = %(q_id)s OR {text})")
            params["q_id"] = int(number)
        else:
            clauses.append(f"({text})")
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
        f"SELECT {COLUMNS} FROM incidents_read WHERE {where} ORDER BY {order} LIMIT %(limit)s OFFSET %(offset)s", params
    ).fetchall()
    return 200, listing.envelope([_to_json(row, request.user) for row in rows], total, page, limit)


@router.on("GET", "/{incident_id}", roles=ANYONE)
def detail(request: Request) -> tuple[int, dict]:
    conn = get_conn()
    body = _to_json(load(conn, request.user, request.params["incident_id"]), request.user)
    # the stepper's timestamps and the authoritative reasons, in the same response: one query, no round-trip (E3)
    body["history"] = [
        dict(zip(("from", "to", "at", "actor_id", "actor_name", "assignee_id", "assignee_name", "reason"), row))
        for row in conn.execute(
            """
            SELECT h.from_status, h.to_status, h.created_at, h.actor_id, actor.full_name,
                   h.assignee_id, holder.full_name, h.reason
            FROM incident_status_history h
            JOIN users actor ON actor.id = h.actor_id
            LEFT JOIN users holder ON holder.id = h.assignee_id
            WHERE h.incident_id = %s ORDER BY h.created_at, h.id
            """,
            (body["id"],),
        ).fetchall()
    ]
    return 200, body


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
        conn.execute(
            f"UPDATE incidents SET {assignments}, updated_at = now() WHERE id = %(id)s",
            {**changes, "id": current["id"]},
        )
        row = load(conn, request.user, str(current["id"]))
    return 200, _to_json(row, request.user)


# the only way a status changes (AD-17): legality from workflow.py, recording from the shared writer
@router.on("POST", "/{incident_id}/transitions", roles=ANYONE)
def transition(request: Request) -> tuple[int, dict]:
    data = TransitionIn.model_validate(request.body)
    reason = (data.reason or "").strip() or None
    conn = get_conn()
    with conn.transaction():
        # locked: two people moving the same ticket at once are applied one after the other
        row = load(conn, request.user, request.params["incident_id"], lock=True)
        incident = _incident(row)
        workflow.check_transition(request.user, incident, data.to, reason)
        # going back to unassigned releases the engineer; every other move keeps them
        assignee = None if data.to == "unassigned" else incident.assignee_id
        # blocked and unassigned carry a reason the requester must see (AD-17)
        note_kind = data.to if data.to in ("blocked", "unassigned") else None
        apply_transition(conn, incident.id, incident.status, data.to, request.user.id, assignee, reason, note_kind)
        row = load(conn, request.user, str(incident.id))
    return 200, _to_json(row, request.user)


# assignment is the only way out of unassigned (AD-17); reassignment goes back through unassigned first
@router.on("POST", "/{incident_id}/assignment", roles={"admin"})
def assign(request: Request) -> tuple[int, dict]:
    data = AssignmentIn.model_validate(request.body)
    conn = get_conn()
    with conn.transaction():
        row = load(conn, request.user, request.params["incident_id"], lock=True)
        incident = _incident(row)
        if incident.status != "unassigned":
            raise ValidationFailed(
                "only an unassigned incident can be assigned",
                {"incident": "move it to unassigned first, with a reason (reassignment)"},
            )
        # the database lets assignee_id reference any user; "engineers only" is enforced here (AD-21)
        target = conn.execute(
            """SELECT u.role, p.is_available FROM users u
               LEFT JOIN engineer_profiles p ON p.user_id = u.id WHERE u.id = %s""",
            (data.engineer_id,),
        ).fetchone()
        if target is None or target[0] != "engineer":
            raise ValidationFailed("invalid assignee", {"engineer_id": f"user {data.engineer_id} is not an engineer"})
        # an unavailable engineer gets no new work; the admin switches them back on first, deliberately (M7)
        if not target[1]:
            raise ValidationFailed("invalid assignee", {"engineer_id": f"engineer {data.engineer_id} is not available"})
        apply_transition(conn, incident.id, "unassigned", "open", request.user.id, data.engineer_id, None)
        row = load(conn, request.user, str(incident.id))
    return 200, _to_json(row, request.user)


def _set_escalation(conn: Connection, incident_id: int, actor_id: int, status: str, reason: str) -> None:
    # the status is the only stored field; the reason lives in the conversation (AD-20)
    conn.execute(
        "UPDATE incidents SET escalation_status = %s, updated_at = now() WHERE id = %s", (status, incident_id)
    )
    conn.execute(
        "INSERT INTO ticket_notes (incident_id, author_id, kind, body) VALUES (%s, %s, 'escalation', %s)",
        (incident_id, actor_id, reason),
    )


# a reporter asks; what escalation means for this issue is the admin's call, so granting triggers nothing (AD-20)
@router.on("POST", "/{incident_id}/escalation", roles=ANYONE)
def request_escalation(request: Request) -> tuple[int, dict]:
    reason = _required_reason(EscalationRequestIn.model_validate(request.body).reason)
    conn = get_conn()
    with conn.transaction():
        row = load(conn, request.user, request.params["incident_id"], lock=True)
        incident = _incident(row)
        if not policy.can_request_escalation(request.user, incident):
            raise Forbidden("you cannot request escalation of this incident now")
        _set_escalation(conn, incident.id, request.user.id, "pending", reason)
        row = load(conn, request.user, str(incident.id))
    return 200, _to_json(row, request.user)


# an admin decides, withdraws a grant, or reverses a decline: any value but pending, always with a reason
@router.on("PUT", "/{incident_id}/escalation", roles={"admin"})
def decide_escalation(request: Request) -> tuple[int, dict]:
    data = EscalationDecisionIn.model_validate(request.body)
    reason = _required_reason(data.reason)
    conn = get_conn()
    with conn.transaction():
        row = load(conn, request.user, request.params["incident_id"], lock=True)
        incident = _incident(row)
        # a note announcing a change that did not happen would mislead the reporter
        if incident.escalation_status == data.status:
            raise ValidationFailed(f"escalation is already {data.status}", {"status": "must differ from the current value"})
        _set_escalation(conn, incident.id, request.user.id, data.status, reason)
        row = load(conn, request.user, str(incident.id))
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


# the conversation on each incident (M8), checked through the same visibility as the incident itself (AD-01)
notes.register(router, lambda conn, user, raw_id, lock=False: _incident(load(conn, user, raw_id, lock)))


def handler(event=None, context=None):
    return dispatch(router, event, context)
