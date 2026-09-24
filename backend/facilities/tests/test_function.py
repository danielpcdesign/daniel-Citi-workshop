import json

import psycopg
import pytest

from _shared.db import conn_str
from testing_support import PUBLIC, token

ROLE_OF = {"emp": "employee", "eng": "engineer", "adm": "admin"}


@pytest.fixture
def svc(load_service, monkeypatch, migrated_schema):
    monkeypatch.setenv("JWT_PUBLIC_KEY", PUBLIC.strip())
    return load_service("facilities")


def sql(statement, params=()):
    with psycopg.connect(conn_str(), autocommit=True) as conn:
        cur = conn.execute(statement, params)
        return cur.fetchall() if cur.description else None


def call(svc, who, method, path, body=None, query=""):
    headers = {} if who is None else {"x-access-token": token(1, ROLE_OF[who])}
    event = {"rawPath": f"/api/facilities{path}", "rawQueryString": query,
             "requestContext": {"http": {"method": method}}, "headers": headers,
             "body": None if body is None else json.dumps(body)}
    response = svc.handler(event, None)
    return response["statusCode"], (json.loads(response["body"]) if response["body"] else None)


def create(svc, path, name):
    status, body = call(svc, "adm", "POST", path, {"name": name})
    assert status == 201, body
    return body["id"]


@pytest.fixture
def tree(svc) -> dict:
    hq = create(svc, "/buildings", "HQ")
    f1 = create(svc, f"/buildings/{hq}/floors", "F1")
    f2 = create(svc, f"/buildings/{hq}/floors", "F2")
    s1 = create(svc, f"/floors/{f1}/seats", "S1")
    s2 = create(svc, f"/floors/{f1}/seats", "S2")
    return {"hq": hq, "f1": f1, "f2": f2, "s1": s1, "s2": s2}


# --- reading and the three levels ----------------------------------------------------------------

def test_every_level_can_be_read(svc, tree):
    assert call(svc, "emp", "GET", f"/buildings/{tree['hq']}")[1]["name"] == "HQ"
    assert call(svc, "emp", "GET", f"/floors/{tree['f1']}")[1] == {
        "id": tree["f1"], "name": "F1", "building_id": tree["hq"],
        "created_at": call(svc, "emp", "GET", f"/floors/{tree['f1']}")[1]["created_at"]}
    assert call(svc, "emp", "GET", f"/seats/{tree['s1']}")[1]["floor_id"] == tree["f1"]


def test_children_are_listed_under_their_parent(svc, tree):
    _, floors = call(svc, "emp", "GET", f"/buildings/{tree['hq']}/floors")
    _, seats = call(svc, "emp", "GET", f"/floors/{tree['f1']}/seats")
    assert [f["name"] for f in floors["items"]] == ["F1", "F2"]
    assert [s["name"] for s in seats["items"]] == ["S1", "S2"]
    assert (seats["total"], seats["page"], seats["limit"]) == (2, 1, 20)


def test_list_search_paging_and_sort(svc, tree):
    create(svc, "/buildings", "Annex")
    create(svc, "/buildings", "Warehouse_1")
    create(svc, "/buildings", "Warehouse21")
    names = lambda query: [b["name"] for b in call(svc, "emp", "GET", "/buildings", query=query)[1]["items"]]
    assert names("") == ["Annex", "HQ", "Warehouse_1", "Warehouse21"]
    assert names("sort=-name&limit=2&page=1") == ["Warehouse21", "Warehouse_1"]
    # "_" is literal, not a single-character wildcard
    assert names("q=house_") == ["Warehouse_1"]


# --- permissions (AD-22: everyone reads, admins write) -------------------------------------------

@pytest.mark.parametrize("who,method,path,expected", [
    (None, "GET", "/buildings", 401),
    ("emp", "GET", "/buildings", 200),
    ("eng", "GET", "/buildings", 200),
    ("emp", "POST", "/buildings", 403),
    ("eng", "POST", "/buildings", 403),
    ("emp", "PUT", "/buildings/{hq}", 403),
    ("emp", "DELETE", "/floors/{f1}", 403),
    ("emp", "POST", "/floors/{f1}/seats", 403),
])
def test_permissions(svc, tree, who, method, path, expected):
    body = {"name": "X"} if method in ("POST", "PUT") else None
    assert call(svc, who, method, path.format(**tree), body)[0] == expected


# --- names (M6 decision 4) -------------------------------------------------------------------------

@pytest.mark.parametrize("path,name,message", [
    ("/buildings", "hq", "a building named 'hq' already exists"),
    ("/buildings/{hq}/floors", "f1", "a floor named 'f1' already exists in this building"),
    ("/floors/{f1}/seats", "s1", "a seat named 's1' already exists in this floor"),
])
def test_duplicate_names_are_a_friendly_409(svc, tree, path, name, message):
    status, body = call(svc, "adm", "POST", path.format(**tree), {"name": name})
    assert (status, body["error"]["message"]) == (409, message)


def test_the_same_name_is_fine_under_a_different_parent(svc, tree):
    create(svc, f"/floors/{tree['f2']}/seats", "S1")


def test_the_database_backstops_a_race_past_the_check(svc, tree, monkeypatch):
    # simulate two requests passing the friendly check at once: the unique index still refuses the second
    monkeypatch.setattr(svc, "_check_unique", lambda *a, **k: None)
    status, body = call(svc, "adm", "POST", "/buildings", {"name": "HQ"})
    assert (status, body["error"]["code"]) == (409, "conflict")


def test_rename(svc, tree):
    status, body = call(svc, "adm", "PUT", f"/floors/{tree['f1']}", {"name": "Ground"})
    assert (status, body["name"], body["building_id"]) == (200, "Ground", tree["hq"])
    # renaming to its own name (different case) is not a clash with itself
    assert call(svc, "adm", "PUT", f"/floors/{tree['f1']}", {"name": "GROUND"})[0] == 200
    assert call(svc, "adm", "PUT", f"/floors/{tree['f1']}", {"name": "F2"})[0] == 409


@pytest.mark.parametrize("body", [{"name": "x", "building_id": 1}, {"name": "  "}, {"name": "x" * 101}, {}])
def test_floors_cannot_move_and_names_are_validated(svc, tree, body):
    assert call(svc, "adm", "PUT", f"/floors/{tree['f1']}", body)[0] == 400


# --- archiving (AD-22, M6 decisions 1-2) -----------------------------------------------------------

def test_archiving_a_building_cascades_and_hides_everything(svc, tree):
    assert call(svc, "adm", "DELETE", f"/buildings/{tree['hq']}")[0] == 204
    assert sql("SELECT count(*) FROM seats WHERE archived_at IS NULL") == [(0,)]
    assert sql("SELECT count(*) FROM floors WHERE archived_at IS NULL") == [(0,)]
    # hidden everywhere: direct reads and lists alike
    for path in (f"/buildings/{tree['hq']}", f"/floors/{tree['f1']}", f"/seats/{tree['s1']}",
                 f"/buildings/{tree['hq']}/floors"):
        assert call(svc, "adm", "GET", path)[0] == 404
    assert call(svc, "adm", "GET", "/buildings")[1]["total"] == 0


def test_archiving_a_floor_leaves_its_siblings(svc, tree):
    call(svc, "adm", "DELETE", f"/floors/{tree['f1']}")
    assert [f["name"] for f in call(svc, "emp", "GET", f"/buildings/{tree['hq']}/floors")[1]["items"]] == ["F2"]
    assert sql("SELECT count(*) FROM seats WHERE archived_at IS NULL") == [(0,)]


def test_nothing_can_be_added_under_an_archived_parent(svc, tree):
    call(svc, "adm", "DELETE", f"/floors/{tree['f2']}")
    status, body = call(svc, "adm", "POST", f"/floors/{tree['f2']}/seats", {"name": "S9"})
    assert (status, body["error"]["message"]) == (404, "floor not found")


def test_an_archived_name_can_be_reused(svc, tree):
    call(svc, "adm", "DELETE", f"/buildings/{tree['hq']}")
    create(svc, "/buildings", "HQ")


def test_archived_is_final_and_archiving_twice_is_404(svc, tree):
    call(svc, "adm", "DELETE", f"/seats/{tree['s1']}")
    assert call(svc, "adm", "DELETE", f"/seats/{tree['s1']}")[0] == 404
    assert call(svc, "adm", "PUT", f"/seats/{tree['s1']}", {"name": "back"})[0] == 404


def test_archived_locations_still_hold_incident_history(svc, tree):
    sql("INSERT INTO users (id, email, password_hash, full_name) OVERRIDING SYSTEM VALUE VALUES (1, 'a@acme.inc', 'x', 'a')")
    sql("""INSERT INTO incidents (title, description, category, requested_priority, priority, reporter_id,
                                  building_id, floor_id, seat_id)
           VALUES ('t', 'd', 'hvac', 2, 2, 1, %s, %s, %s)""", (tree["hq"], tree["f1"], tree["s1"]))
    assert call(svc, "adm", "DELETE", f"/buildings/{tree['hq']}")[0] == 204
    # soft delete: the incident still points at its (archived) location for the hotspot reports
    assert sql("SELECT building_id, seat_id FROM incidents") == [(tree["hq"], tree["s1"])]


@pytest.mark.parametrize("path", ["/buildings/abc", "/floors/999999", "/seats/999999/", "/buildings/999999/floors"])
def test_unknown_or_malformed_ids_are_404(svc, tree, path):
    assert call(svc, "emp", "GET", path)[0] == 404


def test_health(svc):
    assert call(svc, None, "GET", "/health") == (200, {"service": "facilities", "database": "ok"})


def test_rename_building(svc, tree):
    assert call(svc, "adm", "PUT", f"/buildings/{tree['hq']}", {"name": "Head Office"})[1]["name"] == "Head Office"


def test_a_parent_archived_after_the_first_check_still_refuses_the_child(svc, tree, monkeypatch):
    # reproduce the race deterministically: another admin archives the floor right after the first check passes
    real_parent = svc._parent

    def parent_then_archived(level, request):
        parent_id = real_parent(level, request)
        sql("UPDATE floors SET archived_at = now() WHERE id = %s", (parent_id,))
        return parent_id

    monkeypatch.setattr(svc, "_parent", parent_then_archived)
    status, body = call(svc, "adm", "POST", f"/floors/{tree['f2']}/seats", {"name": "S9"})
    # the re-check inside the transaction catches it: no seat under an archived floor
    assert (status, body["error"]["message"]) == (404, "floor not found")
    assert sql("SELECT count(*) FROM seats WHERE floor_id = %s", (tree["f2"],)) == [(0,)]


@pytest.mark.parametrize("name,problem", [("nul\u0000b", "control characters"), ("   ", "must not be empty")])
def test_place_names_must_be_well_formed(svc, name, problem):
    status, body = call(svc, "adm", "POST", "/buildings", {"name": name})
    assert status == 400 and problem in body["error"]["fields"]["name"]
