import hashlib
import logging
import os
import secrets
import time
import uuid

import jwt
from psycopg import Connection

from shared.authz import ALGORITHM, ISSUER, User
from shared.errors import Unauthenticated

logger = logging.getLogger(__name__)

ACCESS_TTL = 15 * 60
REFRESH_TTL = 7 * 24 * 3600
COOKIE = "refresh_token"
# the browser sends the cookie to this path only (AD-08a), which is why sign-out lives here too
COOKIE_PATH = "/api/auth/refresh"

# fetched once per warm container: a secrets manager call per request is a latency and cost bug (AD-07b)
_signing_key: str | None = None


def _private_key() -> str:
    global _signing_key
    if _signing_key is None:
        if "JWT_PRIVATE_KEY" in os.environ:
            # local: terraform passes the key directly (AD-07b)
            _signing_key = os.environ["JWT_PRIVATE_KEY"]
        else:
            import boto3  # provided by the lambda runtime; only the cloud path needs it
            secret = boto3.client("secretsmanager").get_secret_value(SecretId=os.environ["JWT_SECRET_NAME"])
            _signing_key = secret["SecretString"]
    return _signing_key


def issue_access(user: User) -> str:
    now = int(time.time())
    # sub is a string: the jwt spec requires it, and pyjwt enforces it
    claims = {"sub": str(user.id), "role": user.role, "iss": ISSUER, "iat": now, "exp": now + ACCESS_TTL}
    return jwt.encode(claims, _private_key(), algorithm=ALGORITHM)


def _digest(token: str) -> str:
    # sha256, not bcrypt: the token is 256 random bits and lookup needs a deterministic hash
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def issue_refresh(conn: Connection, user_id: int, family_id: uuid.UUID | None = None) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute(
        """
        INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
        VALUES (%s, %s, %s, now() + make_interval(secs => %s))
        """,
        (user_id, _digest(token), family_id or uuid.uuid4(), REFRESH_TTL),
    )
    return token


def rotate(conn: Connection, token: str) -> tuple[int, str]:
    # decide inside the transaction, act outside it: raising inside would roll back a family revocation
    with conn.transaction():
        row = conn.execute(
            """
            SELECT user_id, family_id, revoked_at IS NOT NULL, expires_at <= now()
            FROM refresh_tokens WHERE token_hash = %s
            FOR UPDATE
            """,
            (_digest(token),),
        ).fetchone()
        if row is None:
            verdict = "unknown"
        else:
            user_id, family_id, revoked, expired = row
            if revoked:
                verdict = "reused"
            elif expired:
                verdict = "expired"
            else:
                conn.execute(
                    "UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = %s", (_digest(token),)
                )
                return user_id, issue_refresh(conn, user_id, family_id)

    if verdict == "reused":
        # a rotated token presented again: the holder and a thief both have one, so end the whole family (AD-07d)
        revoke_family(conn, family_id)
        logger.warning("refresh token reuse detected; family revoked", extra={"fields": {"user_id": user_id}})
    raise Unauthenticated("session expired" if verdict == "expired" else "invalid session")


def revoke_family(conn: Connection, family_id: uuid.UUID) -> None:
    conn.execute(
        "UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = %s AND revoked_at IS NULL",
        (family_id,),
    )


def family_of(conn: Connection, token: str) -> uuid.UUID | None:
    row = conn.execute("SELECT family_id FROM refresh_tokens WHERE token_hash = %s", (_digest(token),)).fetchone()
    return row[0] if row else None


def set_cookie(token: str) -> str:
    return f"{COOKIE}={token}; HttpOnly; Secure; SameSite=Strict; Path={COOKIE_PATH}; Max-Age={REFRESH_TTL}"


def clear_cookie() -> str:
    return f"{COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path={COOKIE_PATH}; Max-Age=0"
