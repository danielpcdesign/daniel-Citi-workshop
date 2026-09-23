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
# $2a$/$2b$/$2y$, two-digit cost, 53 chars of salt+hash
BCRYPT_PATTERN = re.compile(r"^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$")


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


def _seed_admin(conn: Connection, bootstrap: dict) -> str:
    email = (bootstrap.get("email") or "").strip().lower()
    full_name = (bootstrap.get("full_name") or "").strip()
    password_hash = bootstrap.get("password_hash") or ""

    with conn.transaction():
        if conn.execute("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").fetchone():
            return "exists"

        # no admin means nobody can ever promote anyone: fail the deploy rather than ship that
        if not email or not password_hash:
            raise RuntimeError(
                "no admin exists and TF_VAR_bootstrap_admin_email / "
                "TF_VAR_bootstrap_admin_password_hash are not set"
            )
        # a plaintext password here would be stored as-is, so refuse anything that is not a bcrypt hash
        if not BCRYPT_PATTERN.match(password_hash):
            raise ValueError("bootstrap_admin_password_hash is not a bcrypt hash")

        existing = conn.execute("SELECT role FROM users WHERE email = %s", (email,)).fetchone()
        # silently promoting an existing account would hand admin to whoever registered that email
        if existing:
            raise RuntimeError(f"{email} is already registered as {existing[0]}; choose another email")

        conn.execute(
            "INSERT INTO users (email, password_hash, full_name, role) VALUES (%s, %s, %s, 'admin')",
            (email, password_hash, full_name),
        )
    logger.info("seeded first admin %s", email)
    return "seeded"


def run(bootstrap: dict) -> dict:
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

            # after migrations, still under the lock: needs the users table, and two runs must not both seed
            admin = _seed_admin(conn, bootstrap)
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_KEY,))

    return {"applied": newly_applied, "admin": admin}


def handler(event=None, context=None):
    # no function url exists (AD-03), but refuse http-shaped events in case one is ever added
    if isinstance(event, dict) and "requestContext" in event:
        return {"statusCode": 404, "body": ""}

    bootstrap = (event or {}).get("bootstrap_admin") or {}
    # exceptions propagate on purpose: a lambda error is what fails terraform apply
    result = run(bootstrap)
    logger.info("migrations done; newly applied: %s; admin: %s", result["applied"], result["admin"])
    return result
