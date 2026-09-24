from dataclasses import dataclass

from psycopg import Connection
from pydantic import BaseModel, ConfigDict, Field, field_validator

from shared import listing, log, text
from shared.authz import ROLES
from shared.db import get_conn
from shared.errors import Conflict, NotFound
from shared.http import Request, dispatch
from shared.router import Router

log.setup("facilities")
router = Router("facilities")

ANYONE = set(ROLES)
ADMIN = {"admin"}


# one description per level of the hierarchy (AD-22), so list / create / read / rename / archive are written once.
# every sql identifier below comes from this fixed table, never from the request
@dataclass(frozen=True)
class Level:
    table: str
    noun: str
    name_column: str                 # seats have a label, the others a name
    parent_table: str | None = None
    parent_column: str | None = None
    children: "Level | None" = None


SEATS = Level("seats", "seat", "label", "floors", "floor_id")
FLOORS = Level("floors", "floor", "name", "buildings", "building_id", SEATS)
BUILDINGS = Level("buildings", "building", "name", children=FLOORS)
PARENT_NOUN = {"buildings": "building", "floors": "floor"}


class NameIn(BaseModel):
    # only the name: floors and seats cannot move to another parent (M6), and unknown fields are a 400
    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=100)

    @field_validator("name")
    @classmethod
    def not_blank(cls, value: str) -> str:
        return text.clean(value, text.NAME_MAX)


def _id(raw: str, noun: str) -> int:
    try:
        return int(raw)
    except ValueError:
        raise NotFound(f"{noun} not found")


def _columns(level: Level) -> str:
    parent = f", {level.parent_column}" if level.parent_column else ""
    return f"id, {level.name_column}{parent}, created_at"


def _to_json(level: Level, row: tuple) -> dict:
    keys = ["id", "name"] + ([level.parent_column] if level.parent_column else []) + ["created_at"]
    return dict(zip(keys, row))


# active rows only: an archived location is hidden everywhere, so it is indistinguishable from a missing one (M6)
def _load(conn: Connection, level: Level, raw_id: str, lock: bool = False) -> tuple:
    row = conn.execute(
        f"SELECT {_columns(level)} FROM {level.table} WHERE id = %s AND archived_at IS NULL{' FOR UPDATE' if lock else ''}",
        (_id(raw_id, level.noun),),
    ).fetchone()
    if row is None:
        raise NotFound(f"{level.noun} not found")
    return row


def _check_unique(conn: Connection, level: Level, name: str, parent_id: int | None, exclude_id: int | None = None) -> None:
    # a friendly message first; the partial unique index is the backstop if two requests race (schema decisions)
    scope = f"{level.parent_column} = %(parent)s AND " if level.parent_column else ""
    clash = conn.execute(
        f"""SELECT 1 FROM {level.table}
            WHERE {scope}lower({level.name_column}) = lower(%(name)s) AND archived_at IS NULL AND id <> %(exclude)s""",
        {"parent": parent_id, "name": name, "exclude": exclude_id or 0},
    ).fetchone()
    if clash:
        where = f" in this {PARENT_NOUN[level.parent_table]}" if level.parent_table else ""
        raise Conflict(f"a {level.noun} named {name!r} already exists{where}")


def _list(level: Level, request: Request, parent_id: int | None = None) -> tuple[int, dict]:
    page, limit, offset = listing.paging(request.query)
    order = listing.order_by(request.query, {"name": level.name_column, "created_at": "created_at"}, "name")
    search = (listing.first(request.query, "q") or "").strip()
    clauses = ["archived_at IS NULL"]
    params: dict = {"limit": limit, "offset": offset}
    if level.parent_column:
        clauses.append(f"{level.parent_column} = %(parent)s")
        params["parent"] = parent_id
    if search:
        clauses.append(f"{level.name_column} ILIKE %(q)s")
        params["q"] = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    where = " AND ".join(clauses)
    conn = get_conn()
    total = conn.execute(f"SELECT count(*) FROM {level.table} WHERE {where}", params).fetchone()[0]
    rows = conn.execute(
        f"SELECT {_columns(level)} FROM {level.table} WHERE {where} ORDER BY {order} LIMIT %(limit)s OFFSET %(offset)s",
        params,
    ).fetchall()
    return 200, listing.envelope([_to_json(level, row) for row in rows], total, page, limit)


def _create(level: Level, request: Request, parent_id: int | None = None) -> tuple[int, dict]:
    name = NameIn.model_validate(request.body).name
    conn = get_conn()
    with conn.transaction():
        if level.parent_table:
            # re-checked under a share lock: an archive of the parent that races this insert waits for it,
            # instead of leaving a new floor under an archived building (check-then-act)
            if not conn.execute(
                f"SELECT 1 FROM {level.parent_table} WHERE id = %s AND archived_at IS NULL FOR SHARE", (parent_id,)
            ).fetchone():
                raise NotFound(f"{PARENT_NOUN[level.parent_table]} not found")
        _check_unique(conn, level, name, parent_id)
        columns = f"{level.name_column}" + (f", {level.parent_column}" if level.parent_column else "")
        values = "%s" + (", %s" if level.parent_column else "")
        params = (name, parent_id) if level.parent_column else (name,)
        row = conn.execute(
            f"INSERT INTO {level.table} ({columns}) VALUES ({values}) RETURNING {_columns(level)}", params
        ).fetchone()
    return 201, _to_json(level, row)


def _rename(level: Level, request: Request) -> tuple[int, dict]:
    name = NameIn.model_validate(request.body).name
    conn = get_conn()
    with conn.transaction():
        row = _load(conn, level, request.params["id"], lock=True)
        parent_id = row[2] if level.parent_column else None
        _check_unique(conn, level, name, parent_id, exclude_id=row[0])
        row = conn.execute(
            f"UPDATE {level.table} SET {level.name_column} = %s WHERE id = %s RETURNING {_columns(level)}", (name, row[0])
        ).fetchone()
    return 200, _to_json(level, row)


def _archive(conn: Connection, level: Level, ids: list[int]) -> None:
    # children first, all in the caller's transaction: archiving a building archives its floors and seats (AD-22)
    if level.children:
        child_ids = [
            child for (child,) in conn.execute(
                f"SELECT id FROM {level.children.table} WHERE {level.children.parent_column} = ANY(%s) AND archived_at IS NULL",
                (ids,),
            ).fetchall()
        ]
        if child_ids:
            _archive(conn, level.children, child_ids)
    conn.execute(f"UPDATE {level.table} SET archived_at = now() WHERE id = ANY(%s) AND archived_at IS NULL", (ids,))


def _delete(level: Level, request: Request) -> tuple[int, None]:
    conn = get_conn()
    with conn.transaction():
        row = _load(conn, level, request.params["id"], lock=True)
        _archive(conn, level, [row[0]])
    return 204, None


def _parent(level: Level, request: Request) -> int:
    # a child can only be listed or created under an active parent
    parent_level = BUILDINGS if level.parent_table == "buildings" else FLOORS
    return _load(get_conn(), parent_level, request.params["id"])[0]


@router.on("GET", "/health", public=True)
def health(request: Request) -> tuple[int, dict]:
    with get_conn().cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
    return 200, {"service": "facilities", "database": "ok"}


# everyone reads (employees pick a location when reporting); only admins write (AD-22)
@router.on("GET", "/buildings", roles=ANYONE)
def list_buildings(request: Request):
    return _list(BUILDINGS, request)


@router.on("POST", "/buildings", roles=ADMIN)
def create_building(request: Request):
    return _create(BUILDINGS, request)


@router.on("GET", "/buildings/{id}", roles=ANYONE)
def get_building(request: Request):
    return 200, _to_json(BUILDINGS, _load(get_conn(), BUILDINGS, request.params["id"]))


@router.on("PUT", "/buildings/{id}", roles=ADMIN)
def rename_building(request: Request):
    return _rename(BUILDINGS, request)


@router.on("DELETE", "/buildings/{id}", roles=ADMIN)
def archive_building(request: Request):
    return _delete(BUILDINGS, request)


@router.on("GET", "/buildings/{id}/floors", roles=ANYONE)
def list_floors(request: Request):
    return _list(FLOORS, request, _parent(FLOORS, request))


@router.on("POST", "/buildings/{id}/floors", roles=ADMIN)
def create_floor(request: Request):
    return _create(FLOORS, request, _parent(FLOORS, request))


@router.on("GET", "/floors/{id}", roles=ANYONE)
def get_floor(request: Request):
    return 200, _to_json(FLOORS, _load(get_conn(), FLOORS, request.params["id"]))


@router.on("PUT", "/floors/{id}", roles=ADMIN)
def rename_floor(request: Request):
    return _rename(FLOORS, request)


@router.on("DELETE", "/floors/{id}", roles=ADMIN)
def archive_floor(request: Request):
    return _delete(FLOORS, request)


@router.on("GET", "/floors/{id}/seats", roles=ANYONE)
def list_seats(request: Request):
    return _list(SEATS, request, _parent(SEATS, request))


@router.on("POST", "/floors/{id}/seats", roles=ADMIN)
def create_seat(request: Request):
    return _create(SEATS, request, _parent(SEATS, request))


@router.on("GET", "/seats/{id}", roles=ANYONE)
def get_seat(request: Request):
    return 200, _to_json(SEATS, _load(get_conn(), SEATS, request.params["id"]))


@router.on("PUT", "/seats/{id}", roles=ADMIN)
def rename_seat(request: Request):
    return _rename(SEATS, request)


@router.on("DELETE", "/seats/{id}", roles=ADMIN)
def archive_seat(request: Request):
    return _delete(SEATS, request)


def handler(event=None, context=None):
    return dispatch(router, event, context)
