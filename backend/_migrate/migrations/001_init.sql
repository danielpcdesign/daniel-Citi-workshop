-- 001_init: initial schema (M2).
-- decisions: AD-17 workflow, AD-20 priority/escalation, AD-21 users/roles, AD-22 facilities,
-- AD-01 note rules, AGENTS.md -> AD-03 -> "Schema decisions for 001_init".
-- foreign keys use the default NO ACTION: a referenced row cannot be deleted, so history
-- the reports depend on is never removed out from under them. refresh_tokens is the exception.

-- users (AD-21) ---------------------------------------------------------------------------

CREATE TABLE users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL CHECK (btrim(full_name) <> ''),
    role          TEXT NOT NULL DEFAULT 'employee'
                  CHECK (role IN ('employee', 'engineer', 'admin')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- backstop to the api check: stored normalised, one @, domain exactly acme.inc
    CONSTRAINT users_email_acme_inc
        CHECK (email = lower(btrim(email)) AND email ~ '^[^@[:space:]]+@acme\.inc$')
);

-- refresh tokens (AD-07d): server-side state for rotation and reuse detection
CREATE TABLE refresh_tokens (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- sha256 of the token: high-entropy, so no bcrypt needed, and lookup must be deterministic
    token_hash TEXT NOT NULL UNIQUE,
    family_id  UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- one profile per engineer: the primary key is the foreign key
CREATE TABLE engineer_profiles (
    user_id      BIGINT PRIMARY KEY REFERENCES users (id),
    is_available BOOLEAN NOT NULL DEFAULT true,
    created_by   BIGINT NOT NULL REFERENCES users (id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- facilities (AD-22) ----------------------------------------------------------------------

CREATE TABLE buildings (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL CHECK (btrim(name) <> ''),
    archived_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- unique among active rows only, so an archived name can be reused
CREATE UNIQUE INDEX buildings_name_active_uq
    ON buildings (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE floors (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    building_id BIGINT NOT NULL REFERENCES buildings (id),
    name        TEXT NOT NULL CHECK (btrim(name) <> ''),
    archived_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- target of the incidents composite fk: "this floor, in this building"
    UNIQUE (building_id, id)
);

CREATE UNIQUE INDEX floors_name_active_uq
    ON floors (building_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE seats (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    floor_id    BIGINT NOT NULL REFERENCES floors (id),
    label       TEXT NOT NULL CHECK (btrim(label) <> ''),
    archived_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (floor_id, id)
);

CREATE UNIQUE INDEX seats_label_active_uq
    ON seats (floor_id, lower(label)) WHERE archived_at IS NULL;

-- incidents (AD-17, AD-20, AD-22) ----------------------------------------------------------

CREATE TABLE incidents (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title              TEXT NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 200),
    description        TEXT NOT NULL CHECK (btrim(description) <> ''),
    category           TEXT NOT NULL CHECK (category IN (
                           'electrical', 'plumbing', 'hvac', 'cleaning', 'furniture',
                           'access_security', 'network', 'hardware', 'software', 'other')),
    status             TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN (
                           'unassigned', 'open', 'in_progress', 'blocked', 'resolved', 'closed')),
    -- 1 = low, 2 = medium, 3 = high, 4 = critical
    requested_priority SMALLINT NOT NULL CHECK (requested_priority BETWEEN 1 AND 4),
    priority           SMALLINT NOT NULL CHECK (priority BETWEEN 1 AND 4),
    escalation_status  TEXT NOT NULL DEFAULT 'none'
                       CHECK (escalation_status IN ('none', 'pending', 'granted', 'declined')),
    reporter_id        BIGINT NOT NULL REFERENCES users (id),
    -- references users, not engineer_profiles: "engineers only" is enforced by the incidents service
    assignee_id        BIGINT REFERENCES users (id),
    building_id        BIGINT NOT NULL REFERENCES buildings (id),
    floor_id           BIGINT,
    seat_id            BIGINT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ,
    deleted_by         BIGINT REFERENCES users (id),

    -- the location must be real and consistent; a null floor or seat skips its check (MATCH SIMPLE)
    FOREIGN KEY (building_id, floor_id) REFERENCES floors (building_id, id),
    FOREIGN KEY (floor_id, seat_id) REFERENCES seats (floor_id, id),
    CONSTRAINT incidents_seat_needs_floor CHECK (seat_id IS NULL OR floor_id IS NOT NULL),

    -- AD-17 invariant: unassigned exactly when nobody holds the ticket
    CONSTRAINT incidents_unassigned_iff_no_assignee
        CHECK ((status = 'unassigned') = (assignee_id IS NULL)),

    CONSTRAINT incidents_deleted_pair CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);

CREATE INDEX incidents_status_idx   ON incidents (status);
CREATE INDEX incidents_assignee_idx ON incidents (assignee_id);
CREATE INDEX incidents_reporter_idx ON incidents (reporter_id);

-- status history (AD-17): the record every timing metric is computed from ------------------

CREATE TABLE incident_status_history (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    incident_id BIGINT NOT NULL REFERENCES incidents (id),
    -- null only on the creation row
    from_status TEXT CHECK (from_status IN (
                    'unassigned', 'open', 'in_progress', 'blocked', 'resolved', 'closed')),
    to_status   TEXT NOT NULL CHECK (to_status IN (
                    'unassigned', 'open', 'in_progress', 'blocked', 'resolved', 'closed')),
    actor_id    BIGINT NOT NULL REFERENCES users (id),
    -- who holds the ticket after this transition; distinct values = how many hands it passed through
    assignee_id BIGINT REFERENCES users (id),
    reason      TEXT CHECK (reason IS NULL OR btrim(reason) <> ''),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT history_no_same_status CHECK (from_status IS DISTINCT FROM to_status),
    CONSTRAINT history_blocked_needs_reason CHECK (to_status <> 'blocked' OR reason IS NOT NULL),
    -- going back to unassigned is a reassignment, which needs a reason; the creation row does not
    CONSTRAINT history_unassign_needs_reason
        CHECK (to_status <> 'unassigned' OR from_status IS NULL OR reason IS NOT NULL),
    CONSTRAINT history_unassigned_iff_no_assignee
        CHECK ((to_status = 'unassigned') = (assignee_id IS NULL))
);

CREATE INDEX incident_status_history_incident_idx
    ON incident_status_history (incident_id, created_at);

-- append-only by the database, not by convention: the metrics must not be rewritable
CREATE FUNCTION reject_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'incident_status_history is append-only (% rejected)', TG_OP;
END;
$$;

CREATE TRIGGER incident_status_history_no_update_delete
    BEFORE UPDATE OR DELETE ON incident_status_history
    FOR EACH ROW EXECUTE FUNCTION reject_history_change();

CREATE TRIGGER incident_status_history_no_truncate
    BEFORE TRUNCATE ON incident_status_history
    FOR EACH STATEMENT EXECUTE FUNCTION reject_history_change();

-- ticket notes (AD-01 note rules) ----------------------------------------------------------

CREATE TABLE ticket_notes (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    incident_id BIGINT NOT NULL REFERENCES incidents (id),
    author_id   BIGINT NOT NULL REFERENCES users (id),
    -- non-comment kinds carry a reason other records point at (blocked, escalation, reassignment)
    kind        TEXT NOT NULL DEFAULT 'comment'
                CHECK (kind IN ('comment', 'blocked', 'escalation', 'unassigned')),
    body        TEXT NOT NULL CHECK (btrim(body) <> ''),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at   TIMESTAMPTZ,
    deleted_at  TIMESTAMPTZ,
    deleted_by  BIGINT REFERENCES users (id),

    CONSTRAINT notes_deleted_pair CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);

CREATE INDEX ticket_notes_incident_idx ON ticket_notes (incident_id, created_at);
