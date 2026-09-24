from collections.abc import Callable

from pydantic import BaseModel, ConfigDict, Field, field_validator

from shared import listing, text
from shared.authz import ROLES
from shared.db import get_conn
from shared.errors import Forbidden, NotFound
from shared.http import Request
from shared.router import Router

# read from the ticket_notes_read view (migration 002): the note plus who wrote it (E2)
COLUMNS = "id, incident_id, author_id, author_name, author_role, kind, body, created_at, edited_at, deleted_at, deleted_by"
FIELDS = [c.strip() for c in COLUMNS.split(",")]
MAX_BODY = 5000
# a conversation reads oldest first (AD-01: one chronological thread)
SORTS = {"created_at": "created_at"}


class NoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(max_length=MAX_BODY)

    @field_validator("body")
    @classmethod
    def not_blank(cls, value: str) -> str:
        return text.clean(value, MAX_BODY, multiline=True)


def _to_json(row: tuple) -> dict:
    note = dict(zip(FIELDS, row))
    # a removed note stays in the thread as a placeholder: the conversation shows that something was removed
    if note["deleted_at"] is not None:
        note["body"] = None
    return note


def _note_id(raw: str) -> int:
    try:
        return int(raw)
    except ValueError:
        raise NotFound("note not found")


# notes live inside incidents (AD-01): every check starts from the parent's visibility, via the loader it is given,
# which returns a typed Incident (or raises 404) so this module never depends on the incidents row layout
def register(router: Router, load: Callable) -> None:
    anyone = set(ROLES)

    def read(conn, note_id: int) -> tuple:
        return conn.execute(f"SELECT {COLUMNS} FROM ticket_notes_read WHERE id = %s", (note_id,)).fetchone()

    def load_note(conn, incident_id: int, raw_note_id: str) -> dict:
        # lock the base row, then read the named view (the view's join is not the thing to lock)
        locked = conn.execute(
            "SELECT id FROM ticket_notes WHERE id = %s AND incident_id = %s FOR UPDATE",
            (_note_id(raw_note_id), incident_id),
        ).fetchone()
        row = read(conn, locked[0]) if locked else None
        # a deleted note can be seen as a placeholder but not changed again
        if row is None or row[FIELDS.index("deleted_at")] is not None:
            raise NotFound("note not found")
        return dict(zip(FIELDS, row))

    @router.on("GET", "/{incident_id}/notes", roles=anyone)
    def list_notes(request: Request) -> tuple[int, dict]:
        conn = get_conn()
        incident_id = load(conn, request.user, request.params["incident_id"]).id
        page, limit, offset = listing.paging(request.query)
        order = listing.order_by(request.query, SORTS, "created_at")
        total = conn.execute("SELECT count(*) FROM ticket_notes WHERE incident_id = %s", (incident_id,)).fetchone()[0]
        rows = conn.execute(
            f"SELECT {COLUMNS} FROM ticket_notes_read WHERE incident_id = %s ORDER BY {order} LIMIT %s OFFSET %s",
            (incident_id, limit, offset),
        ).fetchall()
        return 200, listing.envelope([_to_json(row) for row in rows], total, page, limit)

    @router.on("POST", "/{incident_id}/notes", roles=anyone)
    def add_note(request: Request) -> tuple[int, dict]:
        body = NoteIn.model_validate(request.body).body
        conn = get_conn()
        with conn.transaction():
            # locked: a note cannot slip in while another request closes the incident
            incident = load(conn, request.user, request.params["incident_id"], lock=True)
            if incident.status == "closed":
                raise Forbidden("a closed incident is read-only")
            # the api only ever writes comments; the other kinds come from transitions and escalation
            note_id = conn.execute(
                "INSERT INTO ticket_notes (incident_id, author_id, kind, body) VALUES (%s, %s, 'comment', %s) RETURNING id",
                (incident.id, request.user.id, body),
            ).fetchone()[0]
            # a reply is activity on the ticket: "last updated" and sort=-updated_at must see it (E4)
            conn.execute("UPDATE incidents SET updated_at = now() WHERE id = %s", (incident.id,))
            row = read(conn, note_id)
        return 201, _to_json(row)

    @router.on("PUT", "/{incident_id}/notes/{note_id}", roles=anyone)
    def edit_note(request: Request) -> tuple[int, dict]:
        body = NoteIn.model_validate(request.body).body
        conn = get_conn()
        with conn.transaction():
            incident = load(conn, request.user, request.params["incident_id"], lock=True)
            note = load_note(conn, incident.id, request.params["note_id"])
            # only the author edits: nobody, admins included, rewrites someone else's words (AD-01)
            if note["author_id"] != request.user.id:
                raise Forbidden("only the author can edit a note")
            if incident.status == "closed":
                raise Forbidden("a closed incident is read-only")
            # edited_at is returned, so a rewrite after replies is visible (M8)
            conn.execute("UPDATE ticket_notes SET body = %s, edited_at = now() WHERE id = %s", (body, note["id"]))
            row = read(conn, note["id"])
        return 200, _to_json(row)

    @router.on("DELETE", "/{incident_id}/notes/{note_id}", roles=anyone)
    def delete_note(request: Request) -> tuple[int, None]:
        conn = get_conn()
        with conn.transaction():
            incident = load(conn, request.user, request.params["incident_id"], lock=True)
            note = load_note(conn, incident.id, request.params["note_id"])
            admin = request.user.role == "admin"
            if note["author_id"] != request.user.id and not admin:
                raise Forbidden("only the author or an admin can delete a note")
            # closed is read-only, except admin moderation (M8)
            if incident.status == "closed" and not admin:
                raise Forbidden("a closed incident is read-only")
            conn.execute(
                "UPDATE ticket_notes SET deleted_at = now(), deleted_by = %s WHERE id = %s",
                (request.user.id, note["id"]),
            )
        return 204, None
