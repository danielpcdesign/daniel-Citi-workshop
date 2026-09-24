import shutil
from pathlib import Path

import psycopg
import pytest

from _shared.db import conn_str

REAL_MIGRATIONS = Path(__file__).parent.parent / "migrations"
# derived, not hard-coded: adding a migration must not break these tests
REAL_VERSIONS = sorted(p.stem for p in REAL_MIGRATIONS.glob("*.sql"))
# shape-valid bcrypt string; seeding stores it, it never needs to verify a password
HASH = "$2b$12$" + "a" * 53


@pytest.fixture
def migrate(load_service, isolated_schema, tmp_path, monkeypatch):
    module = load_service("_migrate")
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    monkeypatch.setattr(module, "MIGRATIONS_DIR", migrations)
    return module


def query(sql: str, params: tuple = ()) -> list[tuple]:
    with psycopg.connect(conn_str(), autocommit=True) as conn:
        return conn.execute(sql, params).fetchall()


def execute(sql: str) -> None:
    with psycopg.connect(conn_str(), autocommit=True) as conn:
        conn.execute(sql)


def use_real_migrations(module) -> None:
    for path in REAL_MIGRATIONS.glob("*.sql"):
        shutil.copy(path, module.MIGRATIONS_DIR / path.name)


def admin(email: str = "first@acme.inc", password_hash: str = HASH) -> dict:
    return {"email": email, "full_name": "First Admin", "password_hash": password_hash}


# --- migrations (AD-03) --------------------------------------------------------------------

def test_real_schema_applies_from_scratch_then_is_idempotent(migrate):
    use_real_migrations(migrate)
    first = migrate.run(admin())
    assert first["applied"] == REAL_VERSIONS
    tables = {row[0] for row in query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema()")}
    assert {"users", "incidents", "incident_status_history", "ticket_notes"} <= tables
    # a second run finds everything recorded and applies nothing
    assert migrate.run(admin())["applied"] == []


def test_edited_applied_migration_stops_the_run(migrate):
    # 000_ sorts before the real schema, which still runs because seeding afterwards needs the users table
    (migrate.MIGRATIONS_DIR / "000_a.sql").write_text("CREATE TABLE a (id INT);")
    use_real_migrations(migrate)
    migrate.run(admin())
    (migrate.MIGRATIONS_DIR / "000_a.sql").write_text("CREATE TABLE a (id BIGINT);")
    with pytest.raises(RuntimeError, match="000_a.sql was edited after being applied"):
        migrate.run(admin())


def test_failing_migration_rolls_back_and_is_not_recorded(migrate):
    use_real_migrations(migrate)
    (migrate.MIGRATIONS_DIR / "999_broken.sql").write_text(
        "CREATE TABLE should_not_survive (id INT);\nSELECT * FROM no_such_table;"
    )
    with pytest.raises(psycopg.errors.UndefinedTable):
        migrate.run(admin())
    assert query("SELECT version FROM schema_migrations ORDER BY version") == [(v,) for v in REAL_VERSIONS]
    assert query("SELECT to_regclass('should_not_survive')") == [(None,)]


def test_misnamed_migration_is_refused(migrate):
    (migrate.MIGRATIONS_DIR / "1_init.sql").write_text("SELECT 1;")
    with pytest.raises(ValueError, match="NNN_name.sql"):
        migrate.run(admin())


# --- first admin (AD-21) -------------------------------------------------------------------

def test_first_admin_is_seeded_once(migrate):
    use_real_migrations(migrate)
    assert migrate.run(admin())["admin"] == "seeded"
    assert query("SELECT u.email, r.role, u.password_hash FROM users u JOIN user_roles r ON r.user_id = u.id") == [
        ("first@acme.inc", "admin", HASH)]
    # an admin now exists: a different email changes nothing
    assert migrate.run(admin("second@acme.inc"))["admin"] == "exists"
    assert query("SELECT count(*) FROM users") == [(1,)]


def test_email_is_normalised(migrate):
    use_real_migrations(migrate)
    migrate.run(admin("  First@ACME.inc "))
    assert query("SELECT email FROM users") == [("first@acme.inc",)]


@pytest.mark.parametrize("bootstrap", [{}, {"email": "a@acme.inc"}, {"password_hash": HASH}])
def test_no_admin_and_no_credentials_fails(migrate, bootstrap):
    use_real_migrations(migrate)
    with pytest.raises(RuntimeError, match="no admin exists"):
        migrate.run(bootstrap)


def test_plaintext_password_is_refused(migrate):
    use_real_migrations(migrate)
    with pytest.raises(ValueError, match="not a bcrypt hash"):
        migrate.run(admin(password_hash="hunter2"))
    assert query("SELECT count(*) FROM users") == [(0,)]


def test_registered_email_is_not_silently_promoted(migrate):
    use_real_migrations(migrate)
    migrate.run(admin())
    execute("DELETE FROM user_roles")
    with pytest.raises(RuntimeError, match="already registered"):
        migrate.run(admin())


# --- entry point ---------------------------------------------------------------------------

def test_http_shaped_event_is_refused_without_touching_the_database(load_service, monkeypatch):
    module = load_service("_migrate")
    monkeypatch.setattr(module, "run", lambda bootstrap: pytest.fail("run must not be reached"))
    assert module.handler({"requestContext": {"http": {"method": "GET"}}}) == {"statusCode": 404, "body": ""}


def test_handler_passes_the_bootstrap_admin_through(migrate):
    use_real_migrations(migrate)
    result = migrate.handler({"action": "migrate", "bootstrap_admin": admin()})
    assert result == {"applied": REAL_VERSIONS, "admin": "seeded"}
