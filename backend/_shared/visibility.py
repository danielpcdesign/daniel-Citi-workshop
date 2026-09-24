from .authz import User


# which incidents a caller may see (AD-09), as a sql filter. shared because incidents (lists, detail, notes)
# and reports (dashboards) must apply exactly the same rule, or a dashboard could count what the list hides.
# roles inherit employee capabilities: an engineer sees what they reported *or* what is assigned to them
def incident_visibility(user: User) -> tuple[str, dict]:
    if user.role == "admin":
        return "deleted_at IS NULL", {}
    if user.role == "engineer":
        return "deleted_at IS NULL AND (reporter_id = %(me)s OR assignee_id = %(me)s)", {"me": user.id}
    return "deleted_at IS NULL AND reporter_id = %(me)s", {"me": user.id}
