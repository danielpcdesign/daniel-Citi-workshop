from shared.authz import User
from shared.visibility import incident_visibility as visibility  # noqa: F401  (one rule for incidents and reports)

import workflow
from workflow import Incident

REPORTER_FIELDS = frozenset({"title", "description", "category", "location"})
ADMIN_FIELDS = REPORTER_FIELDS | {"priority"}


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
