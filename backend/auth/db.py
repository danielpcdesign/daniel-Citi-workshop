import os

from psycopg import Connection, connect

# reused across warm invocations; provisional until AD-04 settles the access layer
_conn: Connection | None = None


def _conn_str() -> str:
    # os.environ[] not getenv: terraform always injects these, so a missing one is a deploy bug
    parts = [
        f"host={os.environ['POSTGRES_HOST']}",
        f"port={os.environ['POSTGRES_PORT']}",
        f"user={os.environ['POSTGRES_USER']}",
        f"password={os.environ['POSTGRES_PASS']}",
        f"dbname={os.environ['POSTGRES_NAME']}",
        "connect_timeout=15",
    ]
    # local postgres has no tls; aurora requires it
    if os.environ.get("IS_LOCAL") != "true":
        parts.append("sslmode=require")
    return " ".join(parts)


def get_conn() -> Connection:
    global _conn
    if _conn is None or _conn.closed:
        _conn = connect(_conn_str(), autocommit=True)
    return _conn


def pg_version() -> str:
    global _conn
    try:
        with get_conn().cursor() as cur:
            cur.execute("SELECT version();")
            row = cur.fetchone()
            return row[0] if row else "unknown"
    except Exception:
        # drop a stale connection so the next invocation reconnects
        _conn = None
        raise
