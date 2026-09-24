import importlib
import itertools

import pytest

from _shared.authz import User
from _shared.errors import Forbidden, ValidationFailed

ME, SOMEONE_ELSE = 7, 8


@pytest.fixture
def wf(load_service):
    load_service("incidents")
    return importlib.import_module("workflow")


def incident(wf, status, assignee=ME, reporter=SOMEONE_ELSE):
    return wf.Incident(id=1, status=status, reporter_id=reporter, assignee_id=None if status == "unassigned" else assignee)


# written out by hand from AD-17, deliberately not derived from the code under test
ENGINEER_EXPECTED = {
    "open": ["in_progress"],
    "in_progress": ["blocked", "resolved"],
    "blocked": ["in_progress"],
    "resolved": [],
    "closed": [],
}


@pytest.mark.parametrize("status", ["open", "in_progress", "blocked", "resolved", "closed"])
def test_engineer_on_own_ticket_moves_one_step_forward_or_unblocks(wf, status):
    assert sorted(wf.allowed_transitions(User(ME, "engineer"), incident(wf, status))) == ENGINEER_EXPECTED[status]


@pytest.mark.parametrize("status", ["open", "in_progress", "blocked"])
def test_engineer_cannot_move_someone_elses_ticket(wf, status):
    assert wf.allowed_transitions(User(ME, "engineer"), incident(wf, status, assignee=SOMEONE_ELSE)) == []


@pytest.mark.parametrize("status", ["open", "in_progress", "blocked", "resolved", "closed"])
def test_employee_changes_no_status_even_as_reporter(wf, status):
    assert wf.allowed_transitions(User(ME, "employee"), incident(wf, status, reporter=ME)) == []


@pytest.mark.parametrize("status", ["open", "in_progress", "blocked", "resolved", "closed"])
def test_admin_moves_anywhere_except_where_it_is(wf, status):
    targets = wf.allowed_transitions(User(ME, "admin"), incident(wf, status))
    assert set(targets) == set(wf.STATUSES) - {status}


@pytest.mark.parametrize("role", ["employee", "engineer", "admin"])
def test_unassigned_leaves_only_by_assignment(wf, role):
    assert wf.allowed_transitions(User(ME, role), incident(wf, "unassigned")) == []


def test_only_admins_close(wf):
    closers = [role for role in ("employee", "engineer", "admin")
               if "closed" in wf.allowed_transitions(User(ME, role), incident(wf, "resolved", reporter=ME))]
    assert closers == ["admin"]


@pytest.mark.parametrize("current,target,expected", [
    ("in_progress", "blocked", True),
    ("open", "unassigned", True),
    ("closed", "unassigned", True),
    ("in_progress", "resolved", False),
    ("blocked", "in_progress", False),
])
def test_which_moves_need_a_reason(wf, current, target, expected):
    assert wf.needs_reason(current, target) is expected


# --- check_transition: every refusal has a distinct, correct error ---------------------------

def test_legal_move_passes(wf):
    wf.check_transition(User(ME, "engineer"), incident(wf, "open"), "in_progress", None)


@pytest.mark.parametrize("target", ["done", "", "OPEN"])
def test_unknown_status(wf, target):
    with pytest.raises(ValidationFailed, match="unknown status"):
        wf.check_transition(User(ME, "admin"), incident(wf, "open"), target, None)


def test_same_status(wf):
    with pytest.raises(ValidationFailed, match="already open"):
        wf.check_transition(User(ME, "admin"), incident(wf, "open"), "open", None)


def test_unassigned_cannot_be_moved_by_transition(wf):
    with pytest.raises(ValidationFailed, match="only by assignment"):
        wf.check_transition(User(ME, "admin"), incident(wf, "unassigned"), "open", None)


@pytest.mark.parametrize("role,status,target", [
    ("engineer", "open", "resolved"),        # skipping in_progress loses the acknowledged timestamp
    ("engineer", "blocked", "resolved"),     # unblock first
    ("engineer", "resolved", "closed"),      # only admins close
    ("engineer", "resolved", "in_progress"), # reopening is an admin move
    ("employee", "open", "in_progress"),
])
def test_forbidden_moves_are_403(wf, role, status, target):
    with pytest.raises(Forbidden, match=f"from {status} to {target}"):
        wf.check_transition(User(ME, role), incident(wf, status, reporter=ME), target, None)


@pytest.mark.parametrize("reason", [None, "", "   "])
def test_blocked_without_a_reason(wf, reason):
    with pytest.raises(ValidationFailed) as caught:
        wf.check_transition(User(ME, "engineer"), incident(wf, "in_progress"), "blocked", reason)
    assert caught.value.fields == {"reason": "required when moving to blocked"}


def test_reassignment_without_a_reason(wf):
    with pytest.raises(ValidationFailed, match="reason is required"):
        wf.check_transition(User(ME, "admin"), incident(wf, "in_progress"), "unassigned", None)


def test_every_pair_is_decided_without_crashing(wf):
    # exhaustive: every role x ownership x status pair either passes or raises one of our two errors
    for role, mine, (current, target) in itertools.product(
        ("employee", "engineer", "admin"), (True, False), itertools.permutations(wf.STATUSES, 2)
    ):
        ticket = incident(wf, current, assignee=ME if mine else SOMEONE_ELSE)
        try:
            wf.check_transition(User(ME, role), ticket, target, "a reason")
        except (Forbidden, ValidationFailed):
            pass
