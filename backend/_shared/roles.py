from psycopg import Connection

# several roles per user (version 1.1). employee is implicit: user_roles stores only the roles granted on top of
# it. a request acts as one *active* role (the token's `role` claim), so every route check stays a single compare
RANK = {"employee": 0, "engineer": 1, "admin": 2}
GRANTABLE = ("engineer", "admin")


def ordered(roles) -> list[str]:
    return sorted(set(roles) | {"employee"}, key=RANK.__getitem__)


def highest(roles) -> str:
    return ordered(roles)[-1]


def held(conn: Connection, user_id: int) -> list[str]:
    return ordered(role for (role,) in conn.execute("SELECT role FROM user_roles WHERE user_id = %s", (user_id,)))

