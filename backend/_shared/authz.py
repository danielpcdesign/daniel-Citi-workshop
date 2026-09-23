from dataclasses import dataclass

from .errors import Unauthenticated

ROLES = frozenset({"employee", "engineer", "admin"})


@dataclass(frozen=True)
class User:
    id: int
    role: str


def authenticate(event: dict) -> User:
    # closed by default until M3 lands RS256 verification of X-Access-Token (AD-07, AD-08c):
    # every non-public route is unreachable rather than accidentally open
    raise Unauthenticated("authentication required")
