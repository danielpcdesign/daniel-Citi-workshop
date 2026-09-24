import json
from datetime import datetime, timezone

import psycopg
import pytest

from _shared.db import conn_str
from testing_support import PUBLIC, token


@pytest.fixture
def svc(load_service, monkeypatch, migrated_schema):
    monkeypatch.setenv("JWT_PUBLIC_KEY", PUBLIC.strip())
    return load_service("engineers")


def sql(statement, params=()):
    with psycopg.connect(conn_str(), autocommit=True) as conn:
        cur = conn.execute(statement, params)
        return cur.fetchall() if cur.description else None


@pytest.fixture
def team(svc) -> dict:
    ids = {}
    for name, role in (("ada", "admin"), ("emp", "employee"), ("eve", "engineer"), ("fred", "engineer"), ("gus", "engineer")):
        ids[name] = sql("INSERT INTO users (email, password_hash, full_name, role) VALUES (%s, 'x', %s, %s) RETURNING id",
                        (f"{name}@acme.inc", name.title(), role))[0][0]
    for name in ("eve", "fred", "gus"):
        sql("INSERT INTO engineer_profiles (user_id, created_by) VALUES (%s, %s)", (ids[name], ids["ada"]))
    building = sql("INSERT INTO buildings (name) VALUES ('HQ') RETURNING id")[0][0]
    # eve: 3 active + 1 resolved + 1 deleted; fred: 1 active; gus: none
    for engineer, status, deleted in (("eve", "open", False), ("eve", "in_progress", False), ("eve", "blocked", False),
                                      ("eve", "resolved", False), ("eve", "open", True), ("fred", "open", False)):
        sql("""INSERT INTO incidents (title, description, category, status, requested_priority, priority, reporter_id,
                                      assignee_id, building_id, deleted_at, deleted_by)
               VALUES ('t', 'd', 'hvac', %s, 2, 2, %s, %s, %s, %s, %s)""",
            (status, ids["emp"], ids[engineer], building,
             datetime.now(timezone.utc) if deleted else None, ids["ada"] if deleted else None))
    return ids


ROLE = {"ada": "admin", "emp": "employee", "eve": "engineer", "fred": "engineer", "gus": "engineer"}


def call(svc, team, who, method, path="", body=None, query=""):
    headers = {} if who is None else {"x-access-token": token(team[who], ROLE[who])}
    event = {"rawPath": f"/api/engineers{path}", "rawQueryString": query, "headers": headers,
             "requestContext": {"http": {"method": method}}, "body": None if body is None else json.dumps(body)}
    response = svc.handler(event, None)
    return response["statusCode"], (json.loads(response["body"]) if response["body"] else None)


def test_workload_counts_only_active_undeleted_tickets(svc, team):
    _, body = call(svc, team, "ada", "GET")
    assert {e["full_name"]: e["workload"] for e in body["items"]} == {"Eve": 3, "Fred": 1, "Gus": 0}


def test_who_has_capacity(svc, team):
    # lowest workload first: the assignment screen's question
    _, body = call(svc, team, "ada", "GET", query="sort=workload")
    assert [e["full_name"] for e in body["items"]] == ["Gus", "Fred", "Eve"]


def test_filters_and_paging(svc, team):
    sql("UPDATE engineer_profiles SET is_available = false WHERE user_id = %s", (team["fred"],))
    _, available = call(svc, team, "ada", "GET", query="available=true")
    assert [e["full_name"] for e in available["items"]] == ["Eve", "Gus"]
    _, found = call(svc, team, "ada", "GET", query="q=FRE")
    assert [e["email"] for e in found["items"]] == ["fred@acme.inc"]
    _, page = call(svc, team, "ada", "GET", query="limit=1&page=2&sort=-name")
    assert (page["total"], [e["full_name"] for e in page["items"]]) == (3, ["Fred"])


@pytest.mark.parametrize("query,field", [("available=maybe", "available"), ("sort=salary", "sort"), ("limit=0", "limit")])
def test_invalid_list_parameters(svc, team, query, field):
    status, body = call(svc, team, "ada", "GET", query=query)
    assert status == 400 and field in body["error"]["fields"]


@pytest.mark.parametrize("who,expected", [(None, 401), ("emp", 403), ("eve", 403), ("ada", 200)])
def test_only_admins_list(svc, team, who, expected):
    assert call(svc, team, who, "GET")[0] == expected


def test_an_engineer_sees_themselves(svc, team):
    status, body = call(svc, team, "eve", "GET", "/me")
    assert (status, body["email"], body["workload"]) == (200, "eve@acme.inc", 3)


def test_admin_reads_one_engineer(svc, team):
    assert call(svc, team, "ada", "GET", f"/{team['fred']}")[1]["workload"] == 1
    # an employee is not an engineer
    assert call(svc, team, "ada", "GET", f"/{team['emp']}")[0] == 404
    assert call(svc, team, "ada", "GET", "/abc")[0] == 404


def test_an_engineer_toggles_their_own_availability_and_keeps_their_tickets(svc, team):
    status, body = call(svc, team, "eve", "PUT", f"/{team['eve']}/availability", {"is_available": False})
    assert (status, body["is_available"]) == (200, False)
    # unavailable means "no new work", not "take my work away"
    assert body["workload"] == 3


def test_an_engineer_cannot_touch_anothers_availability(svc, team):
    # they cannot see other engineers, so it is 404, not 403
    assert call(svc, team, "eve", "PUT", f"/{team['fred']}/availability", {"is_available": False})[0] == 404


def test_an_admin_toggles_anyone(svc, team):
    assert call(svc, team, "ada", "PUT", f"/{team['gus']}/availability", {"is_available": False})[1]["is_available"] is False
    assert call(svc, team, "ada", "PUT", f"/{team['emp']}/availability", {"is_available": False})[0] == 404


@pytest.mark.parametrize("body", [{"is_available": "yes"}, {"is_available": 1}, {}, {"is_available": True, "x": 1}])
def test_availability_body_is_strict(svc, team, body):
    assert call(svc, team, "ada", "PUT", f"/{team['gus']}/availability", body)[0] == 400


def test_employees_cannot_toggle(svc, team):
    assert call(svc, team, "emp", "PUT", f"/{team['eve']}/availability", {"is_available": False})[0] == 403


def test_health(svc):
    event = {"rawPath": "/api/engineers/health", "requestContext": {"http": {"method": "GET"}}}
    assert json.loads(svc.handler(event, None)["body"]) == {"service": "engineers", "database": "ok"}
