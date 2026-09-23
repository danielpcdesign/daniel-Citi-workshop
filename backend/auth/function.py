from pydantic import BaseModel, field_validator

import passwords
import tokens
from shared import log
from shared.authz import ROLES, User
from shared.db import get_conn
from shared.errors import Conflict, NotFound, Unauthenticated
from shared.http import Request, dispatch
from shared.router import Router

log.setup("auth")
router = Router("auth")

DOMAIN = "acme.inc"
USER_COLUMNS = "id, email, full_name, role"


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
        if not value.strip():
            raise ValueError("must not be empty")
        return value.strip()


class LoginIn(BaseModel):
    email: str
    password: str


def _user_json(row: tuple) -> dict:
    return dict(zip(("id", "email", "full_name", "role"), row))


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
    row = conn.execute(
        f"INSERT INTO users (email, password_hash, full_name) VALUES (%s, %s, %s) RETURNING {USER_COLUMNS}",
        (data.email, passwords.hash_password(data.password), data.full_name),
    ).fetchone()
    return 201, _user_json(row)


@router.on("POST", "/login", public=True)
def login(request: Request) -> tuple[int, dict, list[str]]:
    data = LoginIn.model_validate(request.body)
    conn = get_conn()
    row = conn.execute(
        f"SELECT {USER_COLUMNS}, password_hash FROM users WHERE email = %s",
        (data.email.strip().lower(),),
    ).fetchone()
    # one message for unknown email and wrong password, and the same bcrypt cost for both
    if not passwords.verify(data.password, row[4] if row else None):
        raise Unauthenticated("invalid email or password")
    user = User(row[0], row[3])
    refresh = tokens.issue_refresh(conn, user.id)
    body = {"access_token": tokens.issue_access(user), "expires_in": tokens.ACCESS_TTL, "user": _user_json(row[:4])}
    return 200, body, [tokens.set_cookie(refresh)]


@router.on("POST", "/refresh", public=True)
def refresh(request: Request) -> tuple[int, dict, list[str]]:
    presented = request.cookies.get(tokens.COOKIE)
    if not presented:
        raise Unauthenticated("no session")
    conn = get_conn()
    user_id, rotated = tokens.rotate(conn, presented)
    # the role is read fresh here, so a promotion or demotion lands within one access-token lifetime (AD-09)
    row = conn.execute(f"SELECT {USER_COLUMNS} FROM users WHERE id = %s", (user_id,)).fetchone()
    user = User(row[0], row[3])
    body = {"access_token": tokens.issue_access(user), "expires_in": tokens.ACCESS_TTL, "user": _user_json(row)}
    return 200, body, [tokens.set_cookie(rotated)]


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
    row = get_conn().execute(f"SELECT {USER_COLUMNS} FROM users WHERE id = %s", (request.user.id,)).fetchone()
    if row is None:
        raise NotFound("user not found")
    return 200, _user_json(row)


def handler(event=None, context=None):
    return dispatch(router, event, context)
