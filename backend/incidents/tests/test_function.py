import json

import psycopg
import pytest

from _shared.db import conn_str
from testing_support import PUBLIC, token


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
    # an engineer always has a profile: M4's promotion creates both in one transaction
    sql("INSERT INTO engineer_profiles (user_id, created_by) VALUES (%s, %s)", (ids["eve"], ids["ada"]))
    ids["hq"] = sql("INSERT INTO buildings (name) VALUES ('HQ') RETURNING id")[0][0]
    ids["annex"] = sql("INSERT INTO buildings (name) VALUES ('Annex') RETURNING id")[0][0]
    ids["f1"] = sql("INSERT INTO floors (building_id, name) VALUES (%s, 'F1') RETURNING id", (ids["hq"],))[0][0]
    ids["a1"] = sql("INSERT INTO floors (building_id, name) VALUES (%s, 'A1') RETURNING id", (ids["annex"],))[0][0]
    ids["s1"] = sql("INSERT INTO seats (floor_id, label) VALUES (%s, 'S1') RETURNING id", (ids["f1"],))[0][0]
    ids["old"] = sql("INSERT INTO buildings (name, archived_at) VALUES ('Old', now()) RETURNING id")[0][0]
    return ids


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


# --- transitions and assignment (phase C, AD-17) ------------------------------------------------

def move(svc, world, who, incident_id, to, reason=None):
    body = {"to": to} if reason is None else {"to": to, "reason": reason}
    return call(svc, world, who, "POST", f"/{incident_id}/transitions", body)


def give(svc, world, incident_id, engineer="eve", who="ada"):
    return call(svc, world, who, "POST", f"/{incident_id}/assignment", {"engineer_id": world[engineer]})


def test_full_lifecycle_records_every_step_for_the_metrics(svc, world):
    incident_id = report(svc, world)[1]["id"]
    status, body = give(svc, world, incident_id)
    assert (status, body["status"], body["assignee_id"]) == (200, "open", world["eve"])
    assert move(svc, world, "eve", incident_id, "in_progress")[0] == 200
    assert move(svc, world, "eve", incident_id, "blocked", "waiting for a spare part")[0] == 200
    assert move(svc, world, "eve", incident_id, "in_progress")[0] == 200
    assert move(svc, world, "eve", incident_id, "resolved")[0] == 200
    status, body = move(svc, world, "ada", incident_id, "closed")
    assert (status, body["status"]) == (200, "closed")
    # created -> assigned -> acknowledged -> ... -> resolved -> closed, each with actor and holder
    assert sql("SELECT from_status, to_status, actor_id, assignee_id FROM incident_status_history ORDER BY id") == [
        (None, "unassigned", world["alice"], None),
        ("unassigned", "open", world["ada"], world["eve"]),
        ("open", "in_progress", world["eve"], world["eve"]),
        ("in_progress", "blocked", world["eve"], world["eve"]),
        ("blocked", "in_progress", world["eve"], world["eve"]),
        ("in_progress", "resolved", world["eve"], world["eve"]),
        ("resolved", "closed", world["ada"], world["eve"]),
    ]
    # the blocked reason lives twice: the record (history) and the notification (note)
    assert sql("SELECT reason FROM incident_status_history WHERE to_status = 'blocked'") == [("waiting for a spare part",)]
    assert sql("SELECT kind, author_id, body FROM ticket_notes") == [("blocked", world["eve"], "waiting for a spare part")]


def test_detail_offers_exactly_the_next_moves(svc, world):
    incident_id = report(svc, world)[1]["id"]
    give(svc, world, incident_id)
    _, body = move(svc, world, "eve", incident_id, "in_progress")
    assert body["actions"]["transitions"] == ["blocked", "resolved"]


@pytest.mark.parametrize("who,to,status", [
    ("eve", "resolved", 403),     # skipping in_progress
    ("eve", "closed", 403),       # only admins close
    ("alice", "in_progress", 403),  # the reporter sees it but changes no status
    ("eve", "open", 400),         # already open
    ("eve", "done", 400),         # unknown status
])
def test_refused_moves(svc, world, who, to, status):
    incident_id = report(svc, world)[1]["id"]
    give(svc, world, incident_id)
    assert move(svc, world, who, incident_id, to)[0] == status


def test_blocked_needs_a_reason(svc, world):
    incident_id = report(svc, world)[1]["id"]
    give(svc, world, incident_id)
    move(svc, world, "eve", incident_id, "in_progress")
    status, body = move(svc, world, "eve", incident_id, "blocked", "   ")
    assert (status, body["error"]["fields"]) == (400, {"reason": "required when moving to blocked"})


def test_unassigned_cannot_be_moved_only_assigned(svc, world):
    incident_id = report(svc, world)[1]["id"]
    status, body = move(svc, world, "ada", incident_id, "open")
    assert (status, body["error"]["message"]) == (400, "an unassigned incident leaves unassigned only by assignment")


def test_an_engineer_cannot_move_a_ticket_they_cannot_see(svc, world):
    incident_id = report(svc, world)[1]["id"]
    # not assigned to eve and not reported by eve: invisible, so 404 rather than 403
    assert move(svc, world, "eve", incident_id, "in_progress")[0] == 404


def test_reassignment_goes_back_through_unassigned(svc, world):
    second = sql("INSERT INTO users (email, password_hash, full_name, role) VALUES ('fred@acme.inc', 'x', 'fred', 'engineer') RETURNING id")[0][0]
    sql("INSERT INTO engineer_profiles (user_id, created_by) VALUES (%s, %s)", (second, world["ada"]))
    world["fred"] = second
    incident_id = report(svc, world)[1]["id"]
    give(svc, world, incident_id)
    move(svc, world, "eve", incident_id, "in_progress")
    # direct engineer-to-engineer reassignment is refused
    assert give(svc, world, incident_id, engineer="fred")[0] == 400
    assert move(svc, world, "ada", incident_id, "unassigned")[0] == 400           # needs a reason
    status, body = move(svc, world, "ada", incident_id, "unassigned", "eve is on leave")
    assert (status, body["assignee_id"]) == (200, None)
    assert give(svc, world, incident_id, engineer="fred")[1]["assignee_id"] == second
    # "how many hands": distinct holders across the history
    assert sql("SELECT count(DISTINCT assignee_id) FROM incident_status_history") == [(2,)]
    assert sql("SELECT kind, body FROM ticket_notes") == [("unassigned", "eve is on leave")]


@pytest.mark.parametrize("target,status", [("bob", 400), ("ada", 400)])
def test_only_engineers_can_be_assigned(svc, world, target, status):
    incident_id = report(svc, world)[1]["id"]
    status_code, body = give(svc, world, incident_id, engineer=target)
    assert (status_code, body["error"]["fields"]["engineer_id"]) == (status, f"user {world[target]} is not an engineer")


def test_assigning_an_unknown_user(svc, world):
    incident_id = report(svc, world)[1]["id"]
    status, _ = call(svc, world, "ada", "POST", f"/{incident_id}/assignment", {"engineer_id": 999999})
    assert status == 400


@pytest.mark.parametrize("who", ["alice", "eve"])
def test_only_admins_assign(svc, world, who):
    incident_id = report(svc, world)[1]["id"]
    assert give(svc, world, incident_id, who=who)[0] == 403


def test_engineer_loses_visibility_of_a_ticket_taken_from_them(svc, world):
    incident_id = report(svc, world)[1]["id"]
    give(svc, world, incident_id)
    move(svc, world, "ada", incident_id, "unassigned", "rebalancing")
    assert call(svc, world, "eve", "GET", f"/{incident_id}")[0] == 404


# --- escalation (phase D, AD-20) --------------------------------------------------------------

def escalate(svc, world, who, incident_id, reason="nobody has looked at this in days"):
    return call(svc, world, who, "POST", f"/{incident_id}/escalation", {"reason": reason})


def decide(svc, world, incident_id, status, reason="spoke to facilities", who="ada"):
    return call(svc, world, who, "PUT", f"/{incident_id}/escalation", {"status": status, "reason": reason})


def test_reporter_requests_escalation_with_a_note(svc, world):
    incident_id = report(svc, world)[1]["id"]
    status, body = escalate(svc, world, "alice", incident_id)
    assert (status, body["escalation_status"]) == (200, "pending")
    assert body["actions"]["request_escalation"] is False     # one pending request at a time
    assert sql("SELECT kind, author_id, body FROM ticket_notes") == [
        ("escalation", world["alice"], "nobody has looked at this in days")]


def test_an_engineer_escalates_their_own_report(svc, world):
    # roles inherit employee capabilities
    incident_id = report(svc, world, who="eve")[1]["id"]
    assert escalate(svc, world, "eve", incident_id)[0] == 200


@pytest.mark.parametrize("who", ["ada", "eve"])
def test_only_the_reporter_requests(svc, world, who):
    incident_id = report(svc, world)[1]["id"]
    give(svc, world, incident_id)   # so eve can see it
    assert escalate(svc, world, who, incident_id)[0] == 403


def test_no_second_request_while_pending_and_none_once_closed(svc, world):
    incident_id = report(svc, world)[1]["id"]
    escalate(svc, world, "alice", incident_id)
    assert escalate(svc, world, "alice", incident_id)[0] == 403
    sql("UPDATE incidents SET status = 'closed', assignee_id = %s, escalation_status = 'none' WHERE id = %s",
        (world["eve"], incident_id))
    assert escalate(svc, world, "alice", incident_id)[0] == 403


@pytest.mark.parametrize("reason", ["", "   "])
def test_a_request_needs_a_reason(svc, world, reason):
    incident_id = report(svc, world)[1]["id"]
    status, body = escalate(svc, world, "alice", incident_id, reason)
    assert (status, body["error"]["fields"]) == (400, {"reason": "must not be empty"})


def test_admin_decides_reverses_and_withdraws_always_with_a_note(svc, world):
    incident_id = report(svc, world)[1]["id"]
    escalate(svc, world, "alice", incident_id)
    assert decide(svc, world, incident_id, "declined", "not urgent")[1]["escalation_status"] == "declined"
    assert decide(svc, world, incident_id, "granted", "reconsidered")[1]["escalation_status"] == "granted"
    assert decide(svc, world, incident_id, "none", "handled")[1]["escalation_status"] == "none"
    assert [b for (b,) in sql("SELECT body FROM ticket_notes ORDER BY id")] == [
        "nobody has looked at this in days", "not urgent", "reconsidered", "handled"]
    # granting triggers nothing automatically: priority and assignment are untouched
    assert sql("SELECT priority, status FROM incidents") == [(2, "unassigned")]


def test_declined_lets_the_reporter_ask_again(svc, world):
    incident_id = report(svc, world)[1]["id"]
    escalate(svc, world, "alice", incident_id)
    decide(svc, world, incident_id, "declined", "not urgent")
    assert escalate(svc, world, "alice", incident_id, "it is now flooding")[1]["escalation_status"] == "pending"


@pytest.mark.parametrize("status,reason,field", [
    ("pending", "x", "status"),   # pending comes only from a request
    ("granted", " ", "reason"),
])
def test_decision_validation(svc, world, status, reason, field):
    incident_id = report(svc, world)[1]["id"]
    code, body = decide(svc, world, incident_id, status, reason)
    assert code == 400 and field in body["error"]["fields"]


def test_setting_the_same_value_is_refused(svc, world):
    incident_id = report(svc, world)[1]["id"]
    code, body = decide(svc, world, incident_id, "none")
    assert (code, body["error"]["message"]) == (400, "escalation is already none")
    assert sql("SELECT count(*) FROM ticket_notes") == [(0,)]


def test_only_admins_decide(svc, world):
    incident_id = report(svc, world)[1]["id"]
    assert decide(svc, world, incident_id, "granted", who="alice")[0] == 403


def test_pending_panel_count_comes_from_the_list(svc, world):
    # the admin dashboard needs no dedicated endpoint: filter + total (AD-13)
    for _ in range(3):
        escalate(svc, world, "alice", report(svc, world)[1]["id"])
    report(svc, world)
    _, body = call(svc, world, "ada", "GET", query="escalation_status=pending&limit=1")
    assert (body["total"], len(body["items"])) == (3, 1)


def test_an_unavailable_engineer_is_not_assigned_new_work(svc, world):
    incident_id = report(svc, world)[1]["id"]
    sql("UPDATE engineer_profiles SET is_available = false WHERE user_id = %s", (world["eve"],))
    status, body = give(svc, world, incident_id)
    assert (status, body["error"]["fields"]["engineer_id"]) == (400, f"engineer {world['eve']} is not available")
    # switching availability back on is the deliberate step that allows it (M7)
    sql("UPDATE engineer_profiles SET is_available = true WHERE user_id = %s", (world["eve"],))
    assert give(svc, world, incident_id)[0] == 200


def test_an_engineer_without_a_profile_is_refused(svc, world):
    orphan = sql("INSERT INTO users (email, password_hash, full_name, role) VALUES ('orphan@acme.inc', 'x', 'o', 'engineer') RETURNING id")[0][0]
    world["orphan"] = orphan
    incident_id = report(svc, world)[1]["id"]
    assert give(svc, world, incident_id, engineer="orphan")[0] == 400


# --- notes (M8, AD-01 note rules) -----------------------------------------------------------------

def note(svc, world, who, incident_id, body="Is anyone on this?"):
    return call(svc, world, who, "POST", f"/{incident_id}/notes", {"body": body})


def notes_of(svc, world, who, incident_id, query=""):
    return call(svc, world, who, "GET", f"/{incident_id}/notes", query=query)


def test_reporter_and_assigned_engineer_hold_one_conversation(svc, world):
    incident_id = report(svc, world)[1]["id"]
    give(svc, world, incident_id)
    note(svc, world, "alice", incident_id, "It is getting worse")
    note(svc, world, "eve", incident_id, "On my way")
    status, body = notes_of(svc, world, "alice", incident_id)
    # oldest first: one chronological thread, not replies
    assert [(n["author_id"], n["kind"], n["body"]) for n in body["items"]] == [
        (world["alice"], "comment", "It is getting worse"), (world["eve"], "comment", "On my way")]
    assert (status, body["total"]) == (200, 2)


def test_system_notes_share_the_thread(svc, world):
    incident_id = report(svc, world)[1]["id"]
    give(svc, world, incident_id)
    move(svc, world, "eve", incident_id, "in_progress")
    move(svc, world, "eve", incident_id, "blocked", "waiting on the landlord")
    note(svc, world, "alice", incident_id, "How long?")
    kinds = [n["kind"] for n in notes_of(svc, world, "alice", incident_id)[1]["items"]]
    assert kinds == ["blocked", "comment"]


def test_someone_elses_conversation_is_404(svc, world):
    incident_id = report(svc, world)[1]["id"]
    assert notes_of(svc, world, "bob", incident_id)[0] == 404
    assert note(svc, world, "bob", incident_id)[0] == 404


@pytest.mark.parametrize("status_before", ["unassigned", "open", "blocked", "resolved"])
def test_notes_are_writable_until_closed(svc, world, status_before):
    incident_id = report(svc, world)[1]["id"]
    if status_before != "unassigned":
        assign(world, incident_id, status=status_before)
    assert note(svc, world, "alice", incident_id)[0] == 201


def test_a_closed_incident_is_read_only(svc, world):
    incident_id = report(svc, world)[1]["id"]
    note_id = note(svc, world, "alice", incident_id)[1]["id"]
    assign(world, incident_id, status="closed")
    assert note(svc, world, "alice", incident_id)[1]["error"]["message"] == "a closed incident is read-only"
    assert call(svc, world, "alice", "PUT", f"/{incident_id}/notes/{note_id}", {"body": "edit"})[0] == 403
    assert call(svc, world, "alice", "DELETE", f"/{incident_id}/notes/{note_id}")[0] == 403
    # the one exception: admin moderation outlives the ticket (M8)
    assert call(svc, world, "ada", "DELETE", f"/{incident_id}/notes/{note_id}")[0] == 204


def test_only_the_author_edits_and_the_edit_is_visible(svc, world):
    incident_id = report(svc, world)[1]["id"]
    note_id = note(svc, world, "alice", incident_id, "tap drips")[1]["id"]
    assert call(svc, world, "ada", "PUT", f"/{incident_id}/notes/{note_id}", {"body": "rewritten"})[0] == 403
    status, body = call(svc, world, "alice", "PUT", f"/{incident_id}/notes/{note_id}", {"body": "tap pours"})
    assert (status, body["body"]) == (200, "tap pours")
    # edited_at makes a rewrite visible after others replied (M8)
    assert body["edited_at"] is not None


def test_a_new_note_is_not_marked_edited(svc, world):
    incident_id = report(svc, world)[1]["id"]
    assert note(svc, world, "alice", incident_id)[1]["edited_at"] is None


def test_author_or_admin_deletes_and_the_thread_keeps_a_placeholder(svc, world):
    incident_id = report(svc, world)[1]["id"]
    give(svc, world, incident_id)
    mine = note(svc, world, "alice", incident_id, "phone me on 555-0100")[1]["id"]
    theirs = note(svc, world, "eve", incident_id, "noted")[1]["id"]
    assert call(svc, world, "alice", "DELETE", f"/{incident_id}/notes/{theirs}")[0] == 403
    assert call(svc, world, "alice", "DELETE", f"/{incident_id}/notes/{mine}")[0] == 204
    assert call(svc, world, "ada", "DELETE", f"/{incident_id}/notes/{theirs}")[0] == 204
    items = notes_of(svc, world, "alice", incident_id)[1]["items"]
    assert [(n["body"], n["deleted_by"]) for n in items] == [(None, world["alice"]), (None, world["ada"])]
    # soft delete: the text is hidden from the api, but the row survives
    assert sql("SELECT count(*) FROM ticket_notes WHERE body = 'phone me on 555-0100'") == [(1,)]


def test_a_deleted_note_cannot_be_edited_or_deleted_again(svc, world):
    incident_id = report(svc, world)[1]["id"]
    note_id = note(svc, world, "alice", incident_id)[1]["id"]
    call(svc, world, "alice", "DELETE", f"/{incident_id}/notes/{note_id}")
    assert call(svc, world, "alice", "PUT", f"/{incident_id}/notes/{note_id}", {"body": "back"})[0] == 404
    assert call(svc, world, "alice", "DELETE", f"/{incident_id}/notes/{note_id}")[0] == 404


def test_a_blocked_reason_note_is_edited_like_any_note_but_history_keeps_the_record(svc, world):
    incident_id = report(svc, world)[1]["id"]
    give(svc, world, incident_id)
    move(svc, world, "eve", incident_id, "in_progress")
    move(svc, world, "eve", incident_id, "blocked", "part on order")
    note_id = notes_of(svc, world, "eve", incident_id)[1]["items"][0]["id"]
    call(svc, world, "eve", "DELETE", f"/{incident_id}/notes/{note_id}")
    # AD-17: the history row is the record, the note only the notification
    assert sql("SELECT reason FROM incident_status_history WHERE to_status = 'blocked'") == [("part on order",)]


@pytest.mark.parametrize("body", [{"body": "  "}, {"body": "x" * 5001}, {}, {"body": "ok", "kind": "blocked"}])
def test_note_body_validation(svc, world, body):
    incident_id = report(svc, world)[1]["id"]
    status, _ = call(svc, world, "alice", "POST", f"/{incident_id}/notes", body)
    assert status == 400


@pytest.mark.parametrize("note_id", ["999999", "abc"])
def test_unknown_note_is_404(svc, world, note_id):
    incident_id = report(svc, world)[1]["id"]
    assert call(svc, world, "alice", "PUT", f"/{incident_id}/notes/{note_id}", {"body": "x"})[0] == 404


def test_a_note_id_from_another_incident_is_404(svc, world):
    first = report(svc, world)[1]["id"]
    second = report(svc, world)[1]["id"]
    note_id = note(svc, world, "alice", first)[1]["id"]
    assert call(svc, world, "alice", "PUT", f"/{second}/notes/{note_id}", {"body": "x"})[0] == 404


def test_notes_page(svc, world):
    incident_id = report(svc, world)[1]["id"]
    for i in range(3):
        note(svc, world, "alice", incident_id, f"n{i}")
    _, body = notes_of(svc, world, "alice", incident_id, "limit=2&page=2")
    assert (body["total"], [n["body"] for n in body["items"]]) == (3, ["n2"])


# --- search by ticket number (M9) -----------------------------------------------------------------

@pytest.mark.parametrize("form", ["{id}", "#{id}", " {id} "])
def test_a_ticket_number_finds_the_ticket(svc, world, form):
    wanted = report(svc, world, title="Door jammed")[1]["id"]
    report(svc, world, title="Window stuck")
    _, body = call(svc, world, "ada", "GET", query=f"q={form.format(id=wanted).replace('#', '%23')}")
    assert [i["id"] for i in body["items"]] == [wanted]


def test_a_number_still_matches_text_too(svc, world):
    by_text = report(svc, world, title="Printer 9000 offline")[1]["id"]
    _, body = call(svc, world, "ada", "GET", query="q=9000")
    assert by_text in [i["id"] for i in body["items"]]


def test_searching_someone_elses_number_finds_nothing(svc, world):
    alices = report(svc, world, who="alice")[1]["id"]
    _, body = call(svc, world, "bob", "GET", query=f"q={alices}")
    assert body["total"] == 0
