import logging
import os
from dataclasses import dataclass

import jwt

from .errors import Unauthenticated

logger = logging.getLogger(__name__)

ROLES = frozenset({"employee", "engineer", "admin"})
# the only algorithm accepted: pinning it blocks alg=none and rs256/hs256 key-confusion attacks
ALGORITHM = "RS256"
ISSUER = "acme-incidents-auth"
REQUIRED_CLAIMS = ["exp", "iat", "iss", "sub", "role"]


@dataclass(frozen=True)
class User:
    id: int
    role: str


def _public_key() -> str:
    # public by design (AD-07a): every lambda gets it as an env var; no secret is needed to verify
    return os.environ["JWT_PUBLIC_KEY"]


def authenticate(event: dict) -> User:
    headers = {name.lower(): value for name, value in (event.get("headers") or {}).items()}
    # X-Access-Token, never Authorization: cloudfront's oac signature occupies that header (AD-08c)
    token = headers.get("x-access-token")
    if not token:
        raise Unauthenticated("authentication required")

    try:
        claims = jwt.decode(
            token,
            _public_key(),
            algorithms=[ALGORITHM],
            issuer=ISSUER,
            options={"require": REQUIRED_CLAIMS},
        )
    except jwt.ExpiredSignatureError:
        # the frontend refreshes on this; distinct enough to act on, not to probe (AD-07)
        raise Unauthenticated("token expired")
    except jwt.InvalidTokenError as exc:
        # the precise reason (bad signature, wrong algorithm, missing claim) goes to the log only
        logger.info("rejected access token: %s", type(exc).__name__)
        raise Unauthenticated("invalid token")

    role = claims["role"]
    if role not in ROLES:
        logger.info("rejected access token: unknown role")
        raise Unauthenticated("invalid token")
    try:
        user_id = int(claims["sub"])
    except (TypeError, ValueError):
        logger.info("rejected access token: non-numeric subject")
        raise Unauthenticated("invalid token")
    return User(user_id, role)
