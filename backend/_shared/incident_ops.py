from psycopg import Connection

# work still in progress; resolved and closed incidents keep their assignee (AD-21)
ACTIVE = ("open", "in_progress", "blocked")


# the one writer of a status change: incident row, history row, and optional note, in the caller's transaction.
# whether a move is *legal* is decided by incidents/workflow.py (AD-17); this only records it
def apply_transition(
    conn: Connection, incident_id: int, from_status: str, to_status: str,
    actor_id: int, assignee_id: int | None, reason: str | None, note_kind: str | None = None,
) -> None:
    conn.execute(
        "UPDATE incidents SET status = %s, assignee_id = %s, updated_at = now() WHERE id = %s",
        (to_status, assignee_id, incident_id),
    )
    conn.execute(
        """
        INSERT INTO incident_status_history (incident_id, from_status, to_status, actor_id, assignee_id, reason)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (incident_id, from_status, to_status, actor_id, assignee_id, reason),
    )
    # a reason-bearing move is posted to the conversation so the requester reads why (AD-17)
    if note_kind:
        conn.execute(
            "INSERT INTO ticket_notes (incident_id, author_id, kind, body) VALUES (%s, %s, %s, %s)",
            (incident_id, actor_id, note_kind, reason),
        )


# back to unassigned (AD-17 reassignment, AD-21 demotion); shared because two services need it
def unassign(conn: Connection, incident_id: int, actor_id: int, reason: str) -> bool:
    # lock the row so a concurrent status change cannot interleave with this one
    row = conn.execute(
        "SELECT status FROM incidents WHERE id = %s AND deleted_at IS NULL FOR UPDATE", (incident_id,)
    ).fetchone()
    if row is None or row[0] not in ACTIVE:
        return False
    apply_transition(conn, incident_id, row[0], "unassigned", actor_id, None, reason, note_kind="unassigned")
    return True


def unassign_all_for(conn: Connection, engineer_id: int, actor_id: int, reason: str) -> list[int]:
    ids = [
        incident_id
        for (incident_id,) in conn.execute(
            "SELECT id FROM incidents WHERE assignee_id = %s AND status = ANY(%s) AND deleted_at IS NULL ORDER BY id",
            (engineer_id, list(ACTIVE)),
        ).fetchall()
    ]
    return [incident_id for incident_id in ids if unassign(conn, incident_id, actor_id, reason)]
