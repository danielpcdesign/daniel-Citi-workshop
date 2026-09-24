import json
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from _shared.db import conn_str
from testing_support import PUBLIC, token

T0 = datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc)
ROLE = {"alice": "employee", "bob": "employee", "eve": "engineer", "ada": "admin"}


@pytest.fixture
def svc(load_service, monkeypatch, migrated_schema):
    monkeypatch.setenv("JWT_PUBLIC_KEY", PUBLIC.strip())
    return load_service("reports")


def sql(statement, params=()):
    with psycopg.connect(conn_str(), autocommit=True) as conn:
        cur = conn.execute(statement, params)
        return cur.fetchall() if cur.description else None


@pytest.fixture
def world(svc) -> dict:
    ids = {}
    for name, role in ROLE.items():
        ids[name] = sql("INSERT INTO users (email, password_hash, full_name, role) VALUES (%s, 'x', %s, %s) RETURNING id",
                        (f"{name}@acme.inc", name, role))[0][0]
    ids["hq"] = sql("INSERT INTO buildings (name) VALUES ('HQ') RETURNING id")[0][0]
    ids["annex"] = sql("INSERT INTO buildings (name) VALUES ('Annex') RETURNING id")[0][0]
    ids["f1"] = sql("INSERT INTO floors (building_id, name) VALUES (%s, 'F1') RETURNING id", (ids["hq"],))[0][0]
    ids["s1"] = sql("INSERT INTO seats (floor_id, label) VALUES (%s, 'S1') RETURNING id", (ids["f1"],))[0][0]
    return ids


def incident(world, *, reporter="alice", status="unassigned", assignee=None, priority=2, category="hvac",
             building="hq", floor=None, seat=None, escalation="none", created=T0, deleted=False) -> int:
    return sql(
        """INSERT INTO incidents (title, description, category, status, requested_priority, priority, reporter_id,
                                  assignee_id, building_id, floor_id, seat_id, escalation_status, created_at,
                                  deleted_at, deleted_by)
           VALUES ('t', 'd', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
        (category, status, priority, priority, world[reporter], world[assignee] if assignee else None,
         world[building], world[floor] if floor else None, world[seat] if seat else None, escalation, created,
         T0 if deleted else None, world["ada"] if deleted else None),
    )[0][0]


def history(world, incident_id, steps):
    # steps: (seconds after T0, from, to, assignee, reason)
    for seconds, source, target, holder, reason in steps:
        sql("""INSERT INTO incident_status_history (incident_id, from_status, to_status, actor_id, assignee_id,
                                                    reason, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (incident_id, source, target, world["ada"], world[holder] if holder else None, reason,
             T0 + timedelta(seconds=seconds)))


def call(svc, world, who, path, query=""):
    headers = {} if who is None else {"x-access-token": token(world[who], ROLE[who])}
    event = {"rawPath": f"/api/reports{path}", "rawQueryString": query, "headers": headers,
             "requestContext": {"http": {"method": "GET"}}}
    response = svc.handler(event, None)
    return response["statusCode"], json.loads(response["body"])


# --- summary: one endpoint, every persona's own slice ------------------------------------------------

def test_summary_counts_through_each_persona_visibility(svc, world):
    incident(world, reporter="alice", priority=4)
    incident(world, reporter="bob", status="open", assignee="eve", category="network")
    incident(world, reporter="eve", status="resolved", assignee="eve")
    incident(world, reporter="alice", deleted=True)
    totals = {who: call(svc, world, who, "/summary")[1]["total"] for who in ROLE}
    # alice: her own; bob: his own; eve: reported or assigned; ada: everything not deleted
    assert totals == {"alice": 1, "bob": 1, "eve": 2, "ada": 3}


def test_summary_has_every_bucket_and_the_oldest_active_ticket(svc, world):
    old = incident(world, created=T0)
    incident(world, status="closed", assignee="eve", created=T0 - timedelta(days=30))
    incident(world, priority=4, category="network", created=T0 + timedelta(hours=1))
    _, body = call(svc, world, "ada", "/summary")
    assert body["by_status"] == {"unassigned": 2, "open": 0, "in_progress": 0, "blocked": 0, "resolved": 0, "closed": 1}
    assert body["by_priority"] == {"low": 0, "medium": 2, "high": 0, "critical": 1}
    assert body["by_category"]["network"] == 1 and body["by_category"]["plumbing"] == 0
    assert body["by_escalation"] == {"none": 3, "pending": 0, "granted": 0, "declined": 0}
    # the closed ticket is older but finished: the oldest *active* one is reported
    assert body["oldest_active"]["id"] == old and body["oldest_active"]["age_seconds"] > 0


def test_summary_with_nothing_visible(svc, world):
    _, body = call(svc, world, "bob", "/summary")
    assert (body["total"], body["oldest_active"]) == (0, None)


# --- timings (AD-19): from history, first occurrence ---------------------------------------------------

@pytest.fixture
def timeline(world) -> dict:
    ids = {}
    ids["a"] = incident(world, status="resolved", assignee="eve")
    history(world, ids["a"], [(0, None, "unassigned", None, None), (60, "unassigned", "open", "eve", None),
                              (120, "open", "in_progress", "eve", None), (600, "in_progress", "resolved", "eve", None)])
    ids["b"] = incident(world, status="open", assignee="eve")
    history(world, ids["b"], [(0, None, "unassigned", None, None), (180, "unassigned", "open", "eve", None)])
    # reassigned: the *first* assignment (100s) counts, not the second (500s)
    ids["d"] = incident(world, status="in_progress", assignee="eve")
    history(world, ids["d"], [(0, None, "unassigned", None, None), (100, "unassigned", "open", "eve", None),
                              (300, "open", "unassigned", None, "rebalancing"), (500, "unassigned", "open", "eve", None),
                              (560, "open", "in_progress", "eve", None)])
    ids["never"] = incident(world)
    history(world, ids["never"], [(0, None, "unassigned", None, None)])
    return ids


def test_timings_use_the_first_occurrence_and_skip_unreached_steps(svc, world, timeline):
    _, body = call(svc, world, "ada", "/timings")
    # assign: 60, 180, 100 -> median 100, mean 113; the never-assigned ticket is not measured
    assert body["time_to_assign"] == {"count": 3, "median_seconds": 100, "average_seconds": 113}
    # acknowledged = the engineer's first open -> in_progress, from creation: 120 and 560 -> median 340
    assert body["time_to_acknowledge"] == {"count": 2, "median_seconds": 340, "average_seconds": 340}
    assert body["time_to_resolve"] == {"count": 1, "median_seconds": 600, "average_seconds": 600}


def test_timings_filtered_by_current_status(svc, world, timeline):
    _, body = call(svc, world, "ada", "/timings", "status=resolved")
    assert body["time_to_assign"]["count"] == 1 and body["time_to_assign"]["median_seconds"] == 60


def test_timings_with_no_data(svc, world):
    _, body = call(svc, world, "ada", "/timings")
    for timing in ("time_to_assign", "time_to_acknowledge", "time_to_resolve"):
        assert body[timing] == {"count": 0, "median_seconds": None, "average_seconds": None}


# --- hotspots ----------------------------------------------------------------------------------------------

def test_hotspots_rank_locations_and_keep_archived_history(svc, world):
    for _ in range(3):
        incident(world, building="hq", floor="f1", seat="s1")
    incident(world, building="annex")
    incident(world, building="annex", deleted=True)
    sql("UPDATE seats SET archived_at = now()")
    _, body = call(svc, world, "ada", "/hotspots")
    assert [(b["name"], b["incidents"]) for b in body["buildings"]] == [("HQ", 3), ("Annex", 1)]
    assert [(f["name"], f["parent_id"], f["incidents"]) for f in body["floors"]] == [("F1", world["hq"], 3)]
    # an archived seat still shows where issues recurred
    assert [(s["name"], s["archived"], s["incidents"]) for s in body["seats"]] == [("S1", True, 3)]


def test_hotspots_status_filter_and_limit(svc, world):
    incident(world, building="hq", status="closed", assignee="eve")
    incident(world, building="annex")
    _, open_only = call(svc, world, "ada", "/hotspots", "status=unassigned")
    assert [b["name"] for b in open_only["buildings"]] == ["Annex"]
    _, top1 = call(svc, world, "ada", "/hotspots", "limit=1")
    assert len(top1["buildings"]) == 1


# --- attention: blocked and escalated, and why --------------------------------------------------------------

def test_blocked_incidents_carry_the_latest_reason_from_history(svc, world):
    blocked = incident(world, status="blocked", assignee="eve")
    history(world, blocked, [(0, None, "unassigned", None, None), (10, "unassigned", "open", "eve", None),
                             (20, "open", "in_progress", "eve", None),
                             (30, "in_progress", "blocked", "eve", "no power"),
                             (40, "blocked", "in_progress", "eve", None),
                             (50, "in_progress", "blocked", "eve", "part on order")])
    _, body = call(svc, world, "ada", "/attention")
    assert [(b["id"], b["reason"]) for b in body["blocked"]] == [(blocked, "part on order")]


def test_escalations_carry_the_reporters_reason(svc, world):
    pending = incident(world, escalation="pending")
    granted = incident(world, escalation="granted", created=T0 + timedelta(minutes=5))
    incident(world, escalation="declined")
    incident(world, escalation="granted", status="closed", assignee="eve")
    for incident_id, author, body in ((pending, "alice", "flooding"), (granted, "alice", "no heating"),
                                      (granted, "ada", "facilities paged")):
        sql("INSERT INTO ticket_notes (incident_id, author_id, kind, body) VALUES (%s, %s, 'escalation', %s)",
            (incident_id, world[author], body))
    _, body = call(svc, world, "ada", "/attention")
    # pending first; the admin's decision note is not the "why" - the reporter's request is
    assert [(e["id"], e["escalation_status"], e["reason"]) for e in body["escalated"]] == [
        (pending, "pending", "flooding"), (granted, "granted", "no heating")]


def test_a_deleted_escalation_note_leaves_the_reason_empty(svc, world):
    pending = incident(world, escalation="pending")
    sql("""INSERT INTO ticket_notes (incident_id, author_id, kind, body, deleted_at, deleted_by)
           VALUES (%s, %s, 'escalation', 'x', now(), %s)""", (pending, world["alice"], world["alice"]))
    _, body = call(svc, world, "ada", "/attention")
    assert body["escalated"][0]["reason"] is None


# --- access and validation ---------------------------------------------------------------------------------

@pytest.mark.parametrize("path", ["/hotspots", "/timings", "/attention"])
@pytest.mark.parametrize("who,expected", [(None, 401), ("alice", 403), ("eve", 403), ("ada", 200)])
def test_admin_reports(svc, world, path, who, expected):
    assert call(svc, world, who, path)[0] == expected


@pytest.mark.parametrize("path,query,field", [
    ("/timings", "status=done", "status"), ("/hotspots", "limit=0", "limit"), ("/hotspots", "limit=51", "limit"),
    ("/attention", "limit=x", "limit"),
])
def test_invalid_report_parameters(svc, world, path, query, field):
    status, body = call(svc, world, "ada", path, query)
    assert status == 400 and field in body["error"]["fields"]


def test_health(svc, world):
    assert call(svc, world, None, "/health") == (200, {"service": "reports", "database": "ok"})
