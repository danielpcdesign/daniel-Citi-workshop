import importlib

import pytest

from _shared.authz import User

ME, OTHER = 7, 8


@pytest.fixture
def mods(load_service):
    load_service("incidents")
    return importlib.import_module("policy"), importlib.import_module("workflow")


def ticket(wf, status="open", reporter=OTHER, assignee=OTHER, escalation="none"):
    return wf.Incident(1, status, reporter, None if status == "unassigned" else assignee, escalation)


# (role, reporter is me, assignee is me) -> can view
@pytest.mark.parametrize("role,reporter,assignee,expected", [
    ("employee", True, False, True),
    ("employee", False, False, False),
    ("employee", False, True, False),   # an employee is never an assignee in practice; still not visible
    ("engineer", True, False, True),    # roles inherit employee capabilities: their own report
    ("engineer", False, True, True),
    ("engineer", False, False, False),
    ("admin", False, False, True),
])
def test_can_view(mods, role, reporter, assignee, expected):
    policy, wf = mods
    t = ticket(wf, reporter=ME if reporter else OTHER, assignee=ME if assignee else OTHER)
    assert policy.can_view(User(ME, role), t) is expected


@pytest.mark.parametrize("role,expected", [
    ("employee", ("deleted_at IS NULL AND reporter_id = %(me)s", {"me": ME})),
    ("engineer", ("deleted_at IS NULL AND (reporter_id = %(me)s OR assignee_id = %(me)s)", {"me": ME})),
    ("admin", ("deleted_at IS NULL", {})),
])
def test_visibility_sql_matches_can_view(mods, role, expected):
    policy, _ = mods
    assert policy.visibility(User(ME, role)) == expected


@pytest.mark.parametrize("role,reporter,status,expected", [
    ("employee", True, "unassigned", {"title", "description", "category", "location"}),
    ("employee", True, "open", set()),          # frozen once someone is assigned
    ("employee", False, "unassigned", set()),
    ("engineer", True, "unassigned", {"title", "description", "category", "location"}),
    ("engineer", False, "in_progress", set()),  # engineers change status, never fields
    ("admin", False, "closed", {"title", "description", "category", "location", "priority"}),
])
def test_editable_fields(mods, role, reporter, status, expected):
    policy, wf = mods
    t = ticket(wf, status=status, reporter=ME if reporter else OTHER)
    assert set(policy.editable_fields(User(ME, role), t)) == expected


@pytest.mark.parametrize("reporter,status,escalation,expected", [
    (True, "open", "none", True),
    (True, "resolved", "declined", True),
    (True, "closed", "none", False),
    (True, "open", "pending", False),   # one pending request at a time
    (False, "open", "none", False),
])
def test_can_request_escalation(mods, reporter, status, escalation, expected):
    policy, wf = mods
    t = ticket(wf, status=status, reporter=ME if reporter else OTHER, escalation=escalation)
    assert policy.can_request_escalation(User(ME, "engineer"), t) is expected


def test_actions_for_an_admin_on_an_unassigned_ticket(mods):
    policy, wf = mods
    assert policy.actions(User(ME, "admin"), ticket(wf, status="unassigned")) == {
        "edit": ["category", "description", "location", "priority", "title"],
        "delete": True, "assign": True, "transitions": [],
        "request_escalation": False, "set_escalation": True,
    }


def test_actions_for_an_engineer_on_their_ticket(mods):
    policy, wf = mods
    assert policy.actions(User(ME, "engineer"), ticket(wf, status="in_progress", assignee=ME)) == {
        "edit": [], "delete": False, "assign": False, "transitions": ["blocked", "resolved"],
        "request_escalation": False, "set_escalation": False,
    }
