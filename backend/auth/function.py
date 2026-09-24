from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

import passwords
import tokens
from shared import listing, log, roles, text
from shared.authz import ROLES, User
from shared.db import get_conn
from shared.errors import Conflict, Forbidden, NotFound, Unauthenticated, ValidationFailed
from shared.incident_ops import unassign_all_for
from shared.http import Request, dispatch
from shared.router import Router

log.setup("auth")
router = Router("auth")

DOMAIN = "acme.inc"
# a user with the roles granted on top of employee (v1.1); _user_json turns them into the full held list
USER_SELECT = """
    SELECT u.id, u.email, u.full_name, ARRAY(SELECT r.role FROM user_roles r WHERE r.user_id = u.id)
    FROM users u
"""
# AD-13 sort allow-list; "role" sorts by the highest role held
USER_SORTS = {
    "email": "email",
    "full_name": "full_name",
    "role": "(SELECT coalesce(max(CASE r.role WHEN 'admin' THEN 2 ELSE 1 END), 0) FROM user_roles r WHERE r.user_id = u.id)",
}
DEMOTION_REASON = "assignee removed from the engineer role"


def _normalise_email(value: str) -> str:
    email = value.strip().lower()
    local, sep, domain = email.partition("@")
    # exact domain match (AD-21): rejects acme.inc.evil.com, notacme.inc, and subdomains alike
    if not sep or not local or "@" in domain or domain != DOMAIN:
        raise ValueError(f"must be an @{DOMAIN} address")
    return email


class RegisterIn(BaseModel):
    email: str
    password: str
    full_name: str

    @field_validator("email")
    @classmethod
    def acme_email(cls, value: str) -> str:
        return _normalise_email(value)

    @field_validator("password")
    @classmethod
    def password_policy(cls, value: str) -> str:
        problem = passwords.policy_error(value)
        if problem:
            raise ValueError(problem)
        return value

    @field_validator("full_name")
    @classmethod
    def named(cls, value: str) -> str:
        return text.person_name(value)


class LoginIn(BaseModel):
    email: str
    password: str


class RolesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # the whole list the user should hold; employee is implicit, so sending it or not changes nothing
    roles: list[Literal["employee", "engineer", "admin"]]


class ActiveRoleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["employee", "engineer", "admin"]


def _user_json(row: tuple, active: str | None = None) -> dict:
    held = roles.ordered(row[3])
    # `role` is the role being acted as: the session's for the caller, otherwise the highest held
    return {"id": row[0], "email": row[1], "full_name": row[2], "role": active or roles.highest(held), "roles": held}


def _load_user(conn, user_id: int) -> tuple | None:
    return conn.execute(f"{USER_SELECT} WHERE u.id = %s", (user_id,)).fetchone()


def _session_body(row: tuple, active: str, session_id) -> dict:
    user = User(row[0], active, str(session_id) if session_id else None)
    return {"access_token": tokens.issue_access(user, roles.ordered(row[3])), "expires_in": tokens.ACCESS_TTL,
            "user": _user_json(row, active)}


# public liveness check; reports reachability only, never versions or hostnames (fingerprinting)
@router.on("GET", "/", public=True)
def health(request: Request) -> tuple[int, dict]:
    with get_conn().cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
    return 200, {"service": "auth", "database": "ok"}


# self-registration only ever creates employees; any role in the body is ignored (AD-21)
@router.on("POST", "/register", public=True)
def register(request: Request) -> tuple[int, dict]:
    data = RegisterIn.model_validate(request.body)
    conn = get_conn()
    if conn.execute("SELECT 1 FROM users WHERE email = %s", (data.email,)).fetchone():
        raise Conflict("that email is already registered")
    (user_id,) = conn.execute(
        "INSERT INTO users (email, password_hash, full_name) VALUES (%s, %s, %s) RETURNING id",
        (data.email, passwords.hash_password(data.password), data.full_name),
    ).fetchone()
    return 201, _user_json(_load_user(conn, user_id))


@router.on("POST", "/login", public=True)
def login(request: Request) -> tuple[int, dict, list[str]]:
    data = LoginIn.model_validate(request.body)
    conn = get_conn()
    found = conn.execute("SELECT id, password_hash FROM users WHERE email = %s", (data.email.strip().lower(),)).fetchone()
    # one message for unknown email and wrong password, and the same bcrypt cost for both
    if not passwords.verify(data.password, found[1] if found else None):
        raise Unauthenticated("invalid email or password")
    row = _load_user(conn, found[0])
    # a session starts as the highest role held (v1.1)
    active = roles.highest(row[3])
    refresh, family = tokens.issue_refresh(conn, row[0], active_role=active)
    return 200, _session_body(row, active, family), [tokens.set_cookie(refresh)]


@router.on("POST", "/refresh", public=True)
def refresh(request: Request) -> tuple[int, dict, list[str]]:
    presented = request.cookies.get(tokens.COOKIE)
    if not presented:
        raise Unauthenticated("no session")
    conn = get_conn()
    user_id, rotated, family, stored = tokens.rotate(conn, presented)
    # roles are read fresh here, so a grant or removal lands within one access-token lifetime (AD-09).
    # the session keeps the role it switched to while that role is still held; otherwise it falls back
    row = _load_user(conn, user_id)
    held = roles.ordered(row[3])
    active = stored if stored in held else roles.highest(held)
    if active != stored:
        tokens.set_active_role(conn, str(family), active)
    return 200, _session_body(row, active, family), [tokens.set_cookie(rotated)]


# sign-out: revoke server-side, then clear the cookie; clearing alone protects nobody (AD-08)
@router.on("DELETE", "/refresh", public=True)
def sign_out(request: Request) -> tuple[int, None, list[str]]:
    presented = request.cookies.get(tokens.COOKIE)
    if presented:
        conn = get_conn()
        family = tokens.family_of(conn, presented)
        if family is not None:
            tokens.revoke_family(conn, family)
    return 204, None, [tokens.clear_cookie()]


@router.on("GET", "/me", roles=set(ROLES))
def me(request: Request) -> tuple[int, dict]:
    row = _load_user(get_conn(), request.user.id)
    if row is None:
        raise NotFound("user not found")
    return 200, _user_json(row, request.user.role)


# switch the role this session acts as (v1.1): a new access token, and the choice kept for later refreshes
@router.on("POST", "/active-role", roles=set(ROLES))
def switch_role(request: Request) -> tuple[int, dict]:
    wanted = ActiveRoleIn.model_validate(request.body).role
    conn = get_conn()
    row = _load_user(conn, request.user.id)
    if row is None:
        raise NotFound("user not found")
    if wanted not in roles.ordered(row[3]):
        raise Forbidden("you do not hold that role")
    if request.user.session_id:
        tokens.set_active_role(conn, request.user.session_id, wanted)
    return 200, _session_body(row, wanted, request.user.session_id)


# admins find the people they promote (AD-21)
@router.on("GET", "/users", roles={"admin"})
def list_users(request: Request) -> tuple[int, dict]:
    page, limit, offset = listing.paging(request.query)
    order = listing.order_by(request.query, USER_SORTS, "email")
    search = (listing.first(request.query, "q") or "").strip().lower()
    role = listing.first(request.query, "role")
    if role is not None and role not in ROLES:
        raise ValidationFailed("invalid filters", {"role": f"must be one of {', '.join(sorted(ROLES))}"})
    # "lacks" finds people to grant a role to, e.g. employees who are not yet engineers
    lacks = listing.first(request.query, "lacks")
    if lacks is not None and lacks not in roles.GRANTABLE:
        raise ValidationFailed("invalid filters", {"lacks": f"must be one of {', '.join(roles.GRANTABLE)}"})
    # role=X means "holds X": everyone holds employee
    where = """(%(search)s = '' OR lower(email) LIKE %(pattern)s ESCAPE '\\' OR lower(full_name) LIKE %(pattern)s ESCAPE '\\')
               AND (%(role)s::text IS NULL OR %(role)s = 'employee'
                    OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = %(role)s))
               AND (%(lacks)s::text IS NULL
                    OR NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = %(lacks)s))"""
    # % and _ are LIKE wildcards: escaped so a search matches its literal text
    escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    params = {"search": search, "pattern": f"%{escaped}%", "role": role, "lacks": lacks, "limit": limit,
              "offset": offset}
    conn = get_conn()
    total = conn.execute(f"SELECT count(*) FROM users u WHERE {where}", params).fetchone()[0]
    rows = conn.execute(
        f"{USER_SELECT} WHERE {where} ORDER BY {order} LIMIT %(limit)s OFFSET %(offset)s", params
    ).fetchall()
    return 200, listing.envelope([_user_json(row) for row in rows], total, page, limit)


def _user_id(raw: str) -> int:
    try:
        return int(raw)
    except ValueError:
        raise NotFound("user not found")


# every role change in one transaction (AD-21, M4 option A): profile, roles, and any unassignments together.
# v1.1: the admin sends the whole list the user should hold; the difference is applied
@router.on("PUT", "/users/{user_id}/roles", roles={"admin"})
def set_roles(request: Request) -> tuple[int, dict]:
    target_id = _user_id(request.params["user_id"])
    wanted = set(RolesIn.model_validate(request.body).roles) - {"employee"}
    conn = get_conn()
    with conn.transaction():
        # lock every admin grant first, always in id order: two admins removing each other at once then queue
        # behind the same locks instead of deadlocking, and the second sees the first's result
        admins = [a for (a,) in conn.execute(
            "SELECT user_id FROM user_roles WHERE role = 'admin' ORDER BY user_id FOR UPDATE")]
        if conn.execute("SELECT 1 FROM users WHERE id = %s FOR UPDATE", (target_id,)).fetchone() is None:
            raise NotFound("user not found")
        current = set(roles.held(conn, target_id)) - {"employee"}
        removed, added = current - wanted, wanted - current
        # with no admin nobody can grant anything, and seeding only runs when none exists
        if "admin" in removed and admins == [target_id]:
            raise Conflict("the last admin cannot be removed")
        unassigned: list[int] = []
        if "engineer" in removed:
            unassigned = unassign_all_for(conn, target_id, request.user.id, DEMOTION_REASON)
            conn.execute("DELETE FROM engineer_profiles WHERE user_id = %s", (target_id,))
        if "engineer" in added:
            conn.execute(
                "INSERT INTO engineer_profiles (user_id, created_by) VALUES (%s, %s)", (target_id, request.user.id)
            )
        for role in sorted(removed):
            conn.execute("DELETE FROM user_roles WHERE user_id = %s AND role = %s", (target_id, role))
        for role in sorted(added):
            conn.execute("INSERT INTO user_roles (user_id, role) VALUES (%s, %s)", (target_id, role))
        row = _load_user(conn, target_id)
    # the change reaches the user's token at their next refresh, within 15 minutes (AD-09)
    return 200, {"user": _user_json(row), "unassigned_incidents": unassigned}


def handler(event=None, context=None):
    return dispatch(router, event, context)
