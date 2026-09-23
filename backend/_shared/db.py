import os

from psycopg import Connection, connect

# one connection per warm container (AD-04): a lambda container serves one request at a time
_conn: Connection | None = None


def conn_str() -> str:
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
        _conn = connect(conn_str(), autocommit=True)
    return _conn


def reset_conn() -> None:
    # after any error, drop the connection so the next call reconnects instead of reusing a broken one
    global _conn
    if _conn is not None:
        try:
            _conn.close()
        except Exception:
            pass
    _conn = None
