import hashlib
import logging
import re
from pathlib import Path

from psycopg import Connection, connect

from shared.db import conn_str

logger = logging.getLogger()
logger.setLevel(logging.INFO)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
FILE_PATTERN = re.compile(r"^\d{3}_[a-z0-9_]+\.sql$")
# arbitrary constant; any two concurrent runs contend for the same lock
LOCK_KEY = 22_031_001


def _migration_files() -> list[Path]:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    bad = [f.name for f in files if not FILE_PATTERN.match(f.name)]
    # a misnamed file would sort unpredictably, so refuse rather than guess its order
    if bad:
        raise ValueError(f"migration files must be NNN_name.sql: {bad}")
    return files


def _applied(conn: Connection) -> dict[str, str]:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    TEXT PRIMARY KEY,
            checksum   TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    rows = conn.execute("SELECT version, checksum FROM schema_migrations").fetchall()
    return dict(rows)


def run() -> list[str]:
    files = _migration_files()
    newly_applied = []

    # a dedicated connection, not the shared module-scope one: the advisory lock belongs to this session
    with connect(conn_str(), autocommit=True) as conn:
        conn.execute("SELECT pg_advisory_lock(%s)", (LOCK_KEY,))
        try:
            applied = _applied(conn)
            for path in files:
                version = path.stem
                sql = path.read_text()
                checksum = hashlib.sha256(sql.encode()).hexdigest()

                if version in applied:
                    # an applied file must never change; a new change is a new file
                    if applied[version] != checksum:
                        raise RuntimeError(f"{path.name} was edited after being applied")
                    continue

                # file and its bookkeeping row commit together or not at all
                with conn.transaction():
                    conn.execute(sql)
                    conn.execute(
                        "INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s)",
                        (version, checksum),
                    )
                logger.info("applied %s", path.name)
                newly_applied.append(version)
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_KEY,))

    return newly_applied


def handler(event=None, context=None):
    # no function url exists (AD-03), but refuse http-shaped events in case one is ever added
    if isinstance(event, dict) and "requestContext" in event:
        return {"statusCode": 404, "body": ""}

    # exceptions propagate on purpose: a lambda error is what fails terraform apply
    applied = run()
    logger.info("migrations done; newly applied: %s", applied)
    return {"applied": applied}
