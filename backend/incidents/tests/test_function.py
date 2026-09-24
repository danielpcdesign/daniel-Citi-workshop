import json
import time

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from _shared import authz
from _shared.db import conn_str

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PRIVATE = _KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption()).decode()
PUBLIC = _KEY.public_key().public_bytes(serialization.Encoding.PEM,
                                        serialization.PublicFormat.SubjectPublicKeyInfo).decode()


@pytest.fixture
def svc(load_service, monkeypatch):
    monkeypatch.setenv("JWT_PUBLIC_KEY", PUBLIC.strip())
    return load_service("incidents")


def sql(statement, params=()):
    with psycopg.connect(conn_str(), autocommit=True) as conn:
        cur = conn.execute(statement, params)
        return cur.fetchall() if cur.description else None


@pytest.fixture
def world(svc, migrated_schema) -> dict:
    ids = {}
    for name, role in (("alice", "employee"), ("bob", "employee"), ("eve", "engineer"), ("ada", "admin")):
        ids[name] = sql("INSERT INTO users (email, password_hash, full_name, role) VALUES (%s, 'x', %s, %s) RETURNING id",
                        (f"{name}@acme.inc", name, role))[0][0]
    ids["hq"] = sql("INSERT INTO buildings (name) VALUES ('HQ') RETURNING id")[0][0]
    ids["annex"] = sql("INSERT INTO buildings (name) VALUES ('Annex') RETURNING id")[0][0]
    ids["f1"] = sql("INSERT INTO floors (building_id, name) VALUES (%s, 'F1') RETURNING id", (ids["hq"],))[0][0]
    ids["a1"] = sql("INSERT INTO floors (building_id, name) VALUES (%s, 'A1') RETURNING id", (ids["annex"],))[0][0]
    ids["s1"] = sql("INSERT INTO seats (floor_id, label) VALUES (%s, 'S1') RETURNING id", (ids["f1"],))[0][0]
    ids["old"] = sql("INSERT INTO buildings (name, archived_at) VALUES ('Old', now()) RETURNING id")[0][0]
    return ids


def token(user_id: int, role: str) -> str:
    now = int(time.time())
    return jwt.encode({"sub": str(user_id), "role": role, "iss": authz.ISSUER, "iat": now, "exp": now + 900},
                      PRIVATE, algorithm="RS256")


def call(svc, world, who, method, path="", body=None, query=""):
    role = {"alice": "employee", "bob": "employee", "eve": "engineer", "ada": "admin"}[who]
    event = {"rawPath": f"/api/incidents{path}", "rawQueryString": query,
             "requestContext": {"http": {"method": method}},
             "headers": {"x-access-token": token(world[who], role)},
             "body": None if body is None else json.dumps(body)}
    response = svc.handler(event, None)
    return response["statusCode"], (json.loads(response["body"]) if response["body"] else None)


def report(svc, world, who="alice", **overrides):
    body = {"title": "Leaking tap", "description": "Kitchen, 2nd floor", "category": "plumbing",
            "priority": "medium", "building_id": world["hq"], **overrides}
    return call(svc, world, who, "POST", "", body)


def assign(world, incident_id, engineer="eve", status="open"):
    sql("UPDATE incidents SET status = %s, assignee_id = %s WHERE id = %s", (status, world[engineer], incident_id))


# --- create ---------------------------------------------------------------------------------

def test_report_starts_unassigned_with_a_creation_row(svc, world):
    status, body = report(svc, world, floor_id=world["f1"], seat_id=world["s1"])
    assert status == 201
    assert (body["status"], body["priority"], body["requested_priority"]) == ("unassigned", "medium", "medium")
    assert body["reporter_id"] == world["alice"]
    assert body["location"] == {"building_id": world["hq"], "floor_id": world["f1"], "seat_id": world["s1"]}
    assert sql("SELECT from_status, to_status, actor_id FROM incident_status_history") == [
        (None, "unassigned", world["alice"])]


@pytest.mark.parametrize("who", ["alice", "eve", "ada"])
def test_any_role_may_report(svc, world, who):
    assert report(svc, world, who=who)[0] == 201


def test_reporter_cannot_be_chosen_by_the_caller(svc, world):
    status, body = report(svc, world, reporter_id=world["bob"])
    assert status == 400
    assert "reporter_id" in body["error"]["fields"]


@pytest.mark.parametrize("override,field", [
    ({"title": "  "}, "title"),
    ({"title": "x" * 201}, "title"),
    ({"category": "magic"}, "category"),
    ({"priority": "urgent"}, "priority"),
    ({"building_id": 999999}, "building_id"),
])
def test_report_validation(svc, world, override, field):
    status, body = report(svc, world, **override)
    assert status == 400
    assert field in body["error"]["fields"]


@pytest.mark.parametrize("location,field", [
    ({"floor_id": "a1"}, "floor_id"),                     # a floor from another building
    ({"floor_id": "f1", "seat_id": 999999}, "seat_id"),
    ({"seat_id": "s1"}, "seat_id"),                        # a seat needs a floor
    ({"building_id": "old"}, "building_id"),               # archived: the fk alone would accept it
])
def test_location_is_checked_by_the_service(svc, world, location, field):
    resolved = {k: world[v] if isinstance(v, str) else v for k, v in location.items()}
    status, body = report(svc, world, **resolved)
    assert status == 400
    assert field in body["error"]["fields"]


# --- visibility (AD-09, reported-or-assigned union) ---------------------------------------------

def test_who_sees_what(svc, world):
    alices = report(svc, world, who="alice")[1]["id"]
    bobs = report(svc, world, who="bob")[1]["id"]
    eves_own = report(svc, world, who="eve")[1]["id"]
    assign(world, bobs)

    def visible(who):
        return sorted(item["id"] for item in call(svc, world, who, "GET")[1]["items"])

    assert visible("alice") == [alices]
    assert visible("bob") == [bobs]
    # an engineer is an employee too: their own report plus what is assigned to them
    assert visible("eve") == sorted([bobs, eves_own])
    assert visible("ada") == sorted([alices, bobs, eves_own])


def test_someone_elses_incident_is_404_not_403(svc, world):
    alices = report(svc, world, who="alice")[1]["id"]
    assert call(svc, world, "bob", "GET", f"/{alices}")[0] == 404
    assert call(svc, world, "alice", "GET", f"/{alices}")[0] == 200


@pytest.mark.parametrize("raw_id", ["999999", "abc"])
def test_unknown_or_malformed_id_is_404(svc, world, raw_id):
    assert call(svc, world, "ada", "GET", f"/{raw_id}")[0] == 404


def test_detail_carries_the_callers_actions(svc, world):
    alices = report(svc, world, who="alice")[1]["id"]
    _, as_reporter = call(svc, world, "alice", "GET", f"/{alices}")
    _, as_admin = call(svc, world, "ada", "GET", f"/{alices}")
    assert as_reporter["actions"]["edit"] == ["category", "description", "location", "title"]
    assert as_reporter["actions"]["assign"] is False
    assert as_admin["actions"]["assign"] is True


# --- list: filters, paging, sort (AD-13) -------------------------------------------------------

def test_default_order_is_triage(svc, world):
    low = report(svc, world, priority="low")[1]["id"]
    critical_old = report(svc, world, priority="critical")[1]["id"]
    critical_new = report(svc, world, priority="critical")[1]["id"]
    ids = [item["id"] for item in call(svc, world, "ada", "GET")[1]["items"]]
    assert ids == [critical_old, critical_new, low]


def test_paging_envelope_and_stable_pages(svc, world):
    made = [report(svc, world)[1]["id"] for _ in range(5)]
    _, page1 = call(svc, world, "ada", "GET", query="limit=2&page=1")
    _, page3 = call(svc, world, "ada", "GET", query="limit=2&page=3")
    assert (page1["total"], page1["page"], page1["limit"]) == (5, 1, 2)
    assert [i["id"] for i in page1["items"]] == made[:2]
    assert [i["id"] for i in page3["items"]] == made[4:]


@pytest.mark.parametrize("query,expected", [
    ("status=open", {"b"}),
    ("status=unassigned&status=open", {"a", "b", "c"}),   # repeating a filter widens it
    ("priority=high", {"b"}),
    ("category=hvac", {"c"}),
    ("q=BOILER", {"c"}),
    ("q=50%25", {"b"}),                  # a literal "50%", not a wildcard
    ("assignee_id={eve}", {"b"}),
    ("escalation_status=pending", {"c"}),
])
def test_filters(svc, world, query, expected):
    made = {
        "a": report(svc, world)[1]["id"],
        "b": report(svc, world, priority="high", title="Blind at 50% broken")[1]["id"],
        "c": report(svc, world, category="hvac", description="boiler noise")[1]["id"],
    }
    assign(world, made["b"])
    sql("UPDATE incidents SET escalation_status = 'pending' WHERE id = %s", (made["c"],))
    _, body = call(svc, world, "ada", "GET", query=query.replace("{eve}", str(world["eve"])))
    assert {i["id"] for i in body["items"]} == {made[k] for k in expected}


@pytest.mark.parametrize("query,field", [
    ("status=done", "status"), ("priority=urgent", "priority"), ("category=x", "category"),
    ("escalation_status=maybe", "escalation_status"), ("building_id=abc", "building_id"),
    ("page=0", "page"), ("limit=101", "limit"), ("limit=-1", "limit"), ("sort=title", "sort"),
])
def test_invalid_list_parameters_are_400(svc, world, query, field):
    status, body = call(svc, world, "ada", "GET", query=query)
    assert status == 400
    assert field in body["error"]["fields"]


def test_sort_can_be_chosen_from_the_allow_list(svc, world):
    first = report(svc, world, priority="critical")[1]["id"]
    second = report(svc, world, priority="low")[1]["id"]
    ids = [i["id"] for i in call(svc, world, "ada", "GET", query="sort=-created_at")[1]["items"]]
    assert ids == [second, first]


# --- edit (M5 scope rule 2) ---------------------------------------------------------------------

def test_reporter_edits_while_unassigned(svc, world):
    incident_id = report(svc, world)[1]["id"]
    status, body = call(svc, world, "alice", "PUT", f"/{incident_id}", {"title": "Leaking tap, now flooding"})
    assert (status, body["title"]) == (200, "Leaking tap, now flooding")


def test_reporter_is_frozen_out_once_assigned(svc, world):
    incident_id = report(svc, world)[1]["id"]
    assign(world, incident_id)
    status, body = call(svc, world, "alice", "PUT", f"/{incident_id}", {"title": "changed"})
    assert status == 403
    assert body["error"]["fields"] == {"title": "not editable by you now"}


def test_only_admins_set_priority(svc, world):
    incident_id = report(svc, world)[1]["id"]
    assert call(svc, world, "alice", "PUT", f"/{incident_id}", {"priority": "critical"})[0] == 403
    status, body = call(svc, world, "ada", "PUT", f"/{incident_id}", {"priority": "critical"})
    assert (status, body["priority"], body["requested_priority"]) == (200, "critical", "medium")


def test_engineers_never_edit_fields(svc, world):
    incident_id = report(svc, world)[1]["id"]
    assign(world, incident_id)
    assert call(svc, world, "eve", "PUT", f"/{incident_id}", {"description": "x"})[0] == 403


def test_location_edit_is_validated_and_resets_what_depends_on_it(svc, world):
    incident_id = report(svc, world, floor_id=world["f1"], seat_id=world["s1"])[1]["id"]
    bad = call(svc, world, "alice", "PUT", f"/{incident_id}", {"floor_id": world["a1"]})
    assert bad[0] == 400
    status, body = call(svc, world, "alice", "PUT", f"/{incident_id}", {"building_id": world["annex"]})
    # moving building clears floor and seat unless they are given again
    assert (status, body["location"]) == (200, {"building_id": world["annex"], "floor_id": None, "seat_id": None})


@pytest.mark.parametrize("body,status", [({}, 400), ({"reporter_id": 1}, 400), ({"title": " "}, 400)])
def test_edit_body_validation(svc, world, body, status):
    incident_id = report(svc, world)[1]["id"]
    assert call(svc, world, "alice", "PUT", f"/{incident_id}", body)[0] == status


def test_editing_an_invisible_incident_is_404(svc, world):
    incident_id = report(svc, world)[1]["id"]
    assert call(svc, world, "bob", "PUT", f"/{incident_id}", {"title": "mine now"})[0] == 404


# --- delete (admin soft delete) ------------------------------------------------------------------

def test_admin_soft_deletes_and_history_survives(svc, world):
    incident_id = report(svc, world)[1]["id"]
    assert call(svc, world, "ada", "DELETE", f"/{incident_id}")[0] == 204
    assert call(svc, world, "ada", "GET", f"/{incident_id}")[0] == 404
    assert call(svc, world, "ada", "GET")[1]["total"] == 0
    assert sql("SELECT deleted_by FROM incidents") == [(world["ada"],)]
    assert sql("SELECT count(*) FROM incident_status_history") == [(1,)]


def test_non_admins_cannot_delete(svc, world):
    incident_id = report(svc, world)[1]["id"]
    assert call(svc, world, "alice", "DELETE", f"/{incident_id}")[0] == 403


def test_health(svc, world):
    response = svc.handler({"rawPath": "/api/incidents/health", "requestContext": {"http": {"method": "GET"}}}, None)
    assert json.loads(response["body"]) == {"service": "incidents", "database": "ok"}
