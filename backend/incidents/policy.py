from shared.authz import User

import workflow
from workflow import Incident

REPORTER_FIELDS = frozenset({"title", "description", "category", "location"})
ADMIN_FIELDS = REPORTER_FIELDS | {"priority"}


# the AD-09 row filter, applied in SQL so no query can return a row the caller may not see.
# roles inherit employee capabilities: an engineer sees what they reported *or* what is assigned to them
def visibility(user: User) -> tuple[str, dict]:
    if user.role == "admin":
        return "deleted_at IS NULL", {}
    if user.role == "engineer":
        return "deleted_at IS NULL AND (reporter_id = %(me)s OR assignee_id = %(me)s)", {"me": user.id}
    return "deleted_at IS NULL AND reporter_id = %(me)s", {"me": user.id}


def can_view(user: User, incident: Incident) -> bool:
    return (
        user.role == "admin"
        or incident.reporter_id == user.id
        or (user.role == "engineer" and incident.assignee_id == user.id)
    )


def editable_fields(user: User, incident: Incident) -> frozenset[str]:
    if user.role == "admin":
        return ADMIN_FIELDS
    # the reporter's details are what an engineer works from, so they freeze once someone is assigned
    if incident.reporter_id == user.id and incident.status == "unassigned":
        return REPORTER_FIELDS
    return frozenset()


def can_request_escalation(user: User, incident: Incident) -> bool:
    return (
        incident.reporter_id == user.id
        and incident.status != "closed"
        and incident.escalation_status != "pending"
    )


# what the caller may do with this incident, so the UI shows exactly what the server allows (AD-09, AD-17)
def actions(user: User, incident: Incident) -> dict:
    admin = user.role == "admin"
    return {
        "edit": sorted(editable_fields(user, incident)),
        "delete": admin,
        "assign": admin and incident.status == "unassigned",
        "transitions": workflow.allowed_transitions(user, incident),
        "request_escalation": can_request_escalation(user, incident),
        "set_escalation": admin,
    }
