import psycopg
import pytest

from _shared import incident_ops
from _shared.db import conn_str


@pytest.fixture
def conn(migrated_schema):
    with psycopg.connect(conn_str(), autocommit=True) as connection:
        yield connection


@pytest.fixture
def people(conn) -> dict[str, int]:
    ids = {}
    for name, role in (("reporter", "employee"), ("engineer", "engineer"), ("admin", "admin")):
        ids[name] = conn.execute(
            "INSERT INTO users (email, password_hash, full_name, role) VALUES (%s, 'x', %s, %s) RETURNING id",
            (f"{name}@acme.inc", name, role),
        ).fetchone()[0]
    ids["building"] = conn.execute("INSERT INTO buildings (name) VALUES ('HQ') RETURNING id").fetchone()[0]
    return ids


def incident(conn, people, status: str, assigned: bool = True) -> int:
    return conn.execute(
        """
        INSERT INTO incidents (title, description, category, status, requested_priority, priority,
                               reporter_id, assignee_id, building_id)
        VALUES ('t', 'd', 'plumbing', %s, 2, 2, %s, %s, %s) RETURNING id
        """,
        (status, people["reporter"], people["engineer"] if assigned else None, people["building"]),
    ).fetchone()[0]


@pytest.mark.parametrize("status", ["open", "in_progress", "blocked"])
def test_active_incident_goes_back_to_unassigned_with_history_and_note(conn, people, status):
    incident_id = incident(conn, people, status)
    with conn.transaction():
        assert incident_ops.unassign(conn, incident_id, people["admin"], "reassigning") is True
    assert conn.execute("SELECT status, assignee_id FROM incidents").fetchone() == ("unassigned", None)
    assert conn.execute(
        "SELECT from_status, to_status, actor_id, assignee_id, reason FROM incident_status_history"
    ).fetchall() == [(status, "unassigned", people["admin"], None, "reassigning")]
    assert conn.execute("SELECT kind, author_id, body FROM ticket_notes").fetchall() == [
        ("unassigned", people["admin"], "reassigning")]


@pytest.mark.parametrize("status", ["resolved", "closed"])
def test_finished_work_keeps_its_assignee(conn, people, status):
    incident_id = incident(conn, people, status)
    assert incident_ops.unassign(conn, incident_id, people["admin"], "demoted") is False
    assert conn.execute("SELECT status, assignee_id FROM incidents").fetchone() == (status, people["engineer"])
    assert conn.execute("SELECT count(*) FROM incident_status_history").fetchone() == (0,)


def test_deleted_or_missing_incident_is_skipped(conn, people):
    incident_id = incident(conn, people, "open")
    conn.execute("UPDATE incidents SET deleted_at = now(), deleted_by = %s", (people["admin"],))
    assert incident_ops.unassign(conn, incident_id, people["admin"], "x") is False
    assert incident_ops.unassign(conn, 999999999, people["admin"], "x") is False


def test_unassign_all_takes_only_active_work(conn, people):
    active = [incident(conn, people, s) for s in ("open", "in_progress", "blocked")]
    incident(conn, people, "resolved")
    incident(conn, people, "unassigned", assigned=False)
    with conn.transaction():
        moved = incident_ops.unassign_all_for(conn, people["engineer"], people["admin"], "demoted")
    assert moved == active
    assert conn.execute("SELECT count(*) FROM incidents WHERE assignee_id IS NOT NULL").fetchone() == (1,)


def test_all_three_writes_roll_back_together(conn, people):
    incident_id = incident(conn, people, "open")
    with pytest.raises(RuntimeError):
        with conn.transaction():
            incident_ops.unassign(conn, incident_id, people["admin"], "x")
            raise RuntimeError("caller fails after the unassign")
    # the caller's transaction owns the operation: nothing half-applied survives
    assert conn.execute("SELECT status FROM incidents").fetchone() == ("open",)
    assert conn.execute("SELECT count(*) FROM incident_status_history").fetchone() == (0,)
    assert conn.execute("SELECT count(*) FROM ticket_notes").fetchone() == (0,)
