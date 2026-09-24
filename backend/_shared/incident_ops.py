from psycopg import Connection

# work still in progress; resolved and closed incidents keep their assignee (AD-21)
ACTIVE = ("open", "in_progress", "blocked")


# the one "back to unassigned" operation (AD-17 reassignment, AD-21 demotion), shared because two services need it.
# runs inside the caller's transaction, so the status change, history row, and note commit together or not at all
def unassign(conn: Connection, incident_id: int, actor_id: int, reason: str) -> bool:
    # lock the row so a concurrent status change cannot interleave with this one
    row = conn.execute(
        "SELECT status FROM incidents WHERE id = %s AND deleted_at IS NULL FOR UPDATE", (incident_id,)
    ).fetchone()
    if row is None or row[0] not in ACTIVE:
        return False
    conn.execute(
        "UPDATE incidents SET status = 'unassigned', assignee_id = NULL, updated_at = now() WHERE id = %s",
        (incident_id,),
    )
    conn.execute(
        """
        INSERT INTO incident_status_history (incident_id, from_status, to_status, actor_id, assignee_id, reason)
        VALUES (%s, %s, 'unassigned', %s, NULL, %s)
        """,
        (incident_id, row[0], actor_id, reason),
    )
    # the requester reads why in the same conversation as everything else (AD-17)
    conn.execute(
        "INSERT INTO ticket_notes (incident_id, author_id, kind, body) VALUES (%s, %s, 'unassigned', %s)",
        (incident_id, actor_id, reason),
    )
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
