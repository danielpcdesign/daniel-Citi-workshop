from dataclasses import dataclass

from shared.authz import User
from shared.errors import Forbidden, ValidationFailed

# codes, not labels (schema decisions); unassigned was added before the brief's five (AD-17)
STATUSES = ("unassigned", "open", "in_progress", "blocked", "resolved", "closed")

# what an engineer may do on a ticket assigned to them: one step forward, plus unblocking (AD-17)
ENGINEER_MOVES = frozenset({
    ("open", "in_progress"),
    ("in_progress", "blocked"),
    ("blocked", "in_progress"),
    ("in_progress", "resolved"),
})


# the fields a decision needs, independent of how the row was loaded
@dataclass(frozen=True)
class Incident:
    id: int
    status: str
    reporter_id: int
    assignee_id: int | None
    escalation_status: str = "none"


def needs_reason(current: str, target: str) -> bool:
    # blocked must say why; going back to unassigned is a reassignment, which must say why (AD-17)
    return target == "blocked" or (target == "unassigned" and current != "unassigned")


def allowed_transitions(user: User, incident: Incident) -> list[str]:
    current = incident.status
    # an unassigned incident leaves only through assignment, never through a status change
    if current == "unassigned":
        return []
    if user.role == "admin":
        return [status for status in STATUSES if status != current]
    if user.role == "engineer" and incident.assignee_id == user.id:
        return [target for (source, target) in sorted(ENGINEER_MOVES) if source == current]
    return []


def check_transition(user: User, incident: Incident, target: str, reason: str | None) -> None:
    if target not in STATUSES:
        raise ValidationFailed("unknown status", {"to": f"must be one of {', '.join(STATUSES)}"})
    if target == incident.status:
        raise ValidationFailed(f"incident is already {target}", {"to": "must differ from the current status"})
    if incident.status == "unassigned":
        raise ValidationFailed("an unassigned incident leaves unassigned only by assignment")
    if target not in allowed_transitions(user, incident):
        # the caller can see the incident (checked before this), so this is 403, not 404 (AD-09)
        raise Forbidden(f"you cannot move this incident from {incident.status} to {target}")
    if needs_reason(incident.status, target) and not (reason or "").strip():
        raise ValidationFailed("a reason is required", {"reason": f"required when moving to {target}"})
