-- verifies the database-level guarantees of the current schema (README -> "Where each rule is enforced").
-- runs entirely inside one transaction and rolls back: safe against any database, leaves no rows.
-- run: psql -h 172.17.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -f backend/_migrate/tests/constraints.sql
-- exits non-zero on the first case that does not behave as expected.

\set QUIET on
BEGIN;

-- runs a statement that must fail, and fails loudly if it succeeds or fails for a different reason.
-- expected matches the violated constraint's name, or a fragment of the error message (triggers have no constraint).
CREATE FUNCTION pg_temp.expect_fail(label text, stmt text, expected text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    violated text;
BEGIN
    BEGIN
        EXECUTE stmt;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
        IF violated = expected OR SQLERRM LIKE '%' || expected || '%' THEN
            RETURN 'PASS  ' || label;
        END IF;
        RAISE EXCEPTION 'FAIL  % -- rejected for the wrong reason: % (constraint %)', label, SQLERRM, violated;
    END;
    RAISE EXCEPTION 'FAIL  % -- was accepted, expected rejection by %', label, expected;
END;
$$;

-- fixtures; ids captured, never hard-coded, because sequences do not roll back
INSERT INTO users (email, password_hash, full_name, role) VALUES ('emp@acme.inc', 'x', 'Emp', 'employee') RETURNING id AS emp \gset
INSERT INTO users (email, password_hash, full_name, role) VALUES ('eng@acme.inc', 'x', 'Eng', 'engineer') RETURNING id AS eng \gset
INSERT INTO users (email, password_hash, full_name, role) VALUES ('adm@acme.inc', 'x', 'Adm', 'admin') RETURNING id AS adm \gset
INSERT INTO buildings (name) VALUES ('HQ') RETURNING id AS hq \gset
INSERT INTO buildings (name) VALUES ('Annex') RETURNING id AS annex \gset
INSERT INTO floors (building_id, name) VALUES (:hq, 'F1') RETURNING id AS f1 \gset
INSERT INTO floors (building_id, name) VALUES (:annex, 'A1') RETURNING id AS a1 \gset
INSERT INTO seats (floor_id, label) VALUES (:f1, 'S1') RETURNING id AS s1 \gset

\pset tuples_only on
\pset format unaligned
\set QUIET off

-- users
SELECT pg_temp.expect_fail('1  email on a lookalike domain',
    $q$INSERT INTO users (email, password_hash, full_name) VALUES ('x@acme.inc.evil.com', 'x', 'X')$q$,
    'users_email_acme_inc');
SELECT pg_temp.expect_fail('2  email not lowercase',
    $q$INSERT INTO users (email, password_hash, full_name) VALUES ('X@acme.inc', 'x', 'X')$q$,
    'users_email_acme_inc');

-- incident location (AD-22)
SELECT pg_temp.expect_fail('3  nonexistent floor',
    format($q$INSERT INTO incidents (title, description, category, requested_priority, priority, reporter_id, building_id, floor_id)
              VALUES ('t', 'd', 'plumbing', 2, 2, %s, %s, 999999999)$q$, :emp, :hq),
    'incidents_building_id_floor_id_fkey');
SELECT pg_temp.expect_fail('4  floor from another building',
    format($q$INSERT INTO incidents (title, description, category, requested_priority, priority, reporter_id, building_id, floor_id)
              VALUES ('t', 'd', 'plumbing', 2, 2, %s, %s, %s)$q$, :emp, :hq, :a1),
    'incidents_building_id_floor_id_fkey');
SELECT pg_temp.expect_fail('5  seat from another floor',
    format($q$INSERT INTO incidents (title, description, category, requested_priority, priority, reporter_id, building_id, floor_id, seat_id)
              VALUES ('t', 'd', 'plumbing', 2, 2, %s, %s, %s, %s)$q$, :emp, :annex, :a1, :s1),
    'incidents_floor_id_seat_id_fkey');
SELECT pg_temp.expect_fail('6  seat without a floor',
    format($q$INSERT INTO incidents (title, description, category, requested_priority, priority, reporter_id, building_id, seat_id)
              VALUES ('t', 'd', 'plumbing', 2, 2, %s, %s, %s)$q$, :emp, :hq, :s1),
    'incidents_seat_needs_floor');

-- incident values (AD-17, schema decisions)
SELECT pg_temp.expect_fail('7  open with no assignee',
    format($q$INSERT INTO incidents (title, description, category, status, requested_priority, priority, reporter_id, building_id)
              VALUES ('t', 'd', 'plumbing', 'open', 2, 2, %s, %s)$q$, :emp, :hq),
    'incidents_unassigned_iff_no_assignee');
SELECT pg_temp.expect_fail('8  unknown category',
    format($q$INSERT INTO incidents (title, description, category, requested_priority, priority, reporter_id, building_id)
              VALUES ('t', 'd', 'magic', 2, 2, %s, %s)$q$, :emp, :hq),
    'incidents_category_check');

-- facility names (AD-22)
SELECT pg_temp.expect_fail('9  duplicate active floor name, other case',
    format($q$INSERT INTO floors (building_id, name) VALUES (%s, 'f1')$q$, :hq),
    'floors_name_active_uq');

-- valid path: create, record creation, assign, and reuse an archived floor's name
\set QUIET on
INSERT INTO incidents (title, description, category, requested_priority, priority, reporter_id, building_id, floor_id, seat_id)
    VALUES ('Leak', 'Water on the floor', 'plumbing', 3, 3, :emp, :hq, :f1, :s1) RETURNING id AS inc \gset
INSERT INTO incident_status_history (incident_id, from_status, to_status, actor_id)
    VALUES (:inc, NULL, 'unassigned', :emp);
UPDATE incidents SET status = 'open', assignee_id = :eng WHERE id = :inc;
INSERT INTO incident_status_history (incident_id, from_status, to_status, actor_id, assignee_id)
    VALUES (:inc, 'unassigned', 'open', :adm, :eng);
UPDATE floors SET archived_at = now() WHERE id = :a1;
INSERT INTO floors (building_id, name) VALUES (:annex, 'A1');
\set QUIET off
SELECT 'PASS  10 valid create, assign, and archived-name reuse accepted';

-- status history (AD-17)
SELECT pg_temp.expect_fail('11 blocked without a reason',
    format($q$INSERT INTO incident_status_history (incident_id, from_status, to_status, actor_id, assignee_id)
              VALUES (%s, 'open', 'blocked', %s, %s)$q$, :inc, :eng, :eng),
    'history_blocked_needs_reason');
SELECT pg_temp.expect_fail('12 reassignment without a reason',
    format($q$INSERT INTO incident_status_history (incident_id, from_status, to_status, actor_id)
              VALUES (%s, 'open', 'unassigned', %s)$q$, :inc, :adm),
    'history_unassign_needs_reason');
SELECT pg_temp.expect_fail('13 same-status transition',
    format($q$INSERT INTO incident_status_history (incident_id, from_status, to_status, actor_id, assignee_id)
              VALUES (%s, 'open', 'open', %s, %s)$q$, :inc, :adm, :eng),
    'history_no_same_status');
SELECT pg_temp.expect_fail('14 update history',
    format($q$UPDATE incident_status_history SET reason = 'x' WHERE incident_id = %s$q$, :inc),
    'append-only (UPDATE rejected)');
SELECT pg_temp.expect_fail('15 delete history',
    format($q$DELETE FROM incident_status_history WHERE incident_id = %s$q$, :inc),
    'append-only (DELETE rejected)');
SELECT pg_temp.expect_fail('16 truncate history',
    $q$TRUNCATE incident_status_history$q$,
    'append-only (TRUNCATE rejected)');

-- referenced rows are never hard-deleted
SELECT pg_temp.expect_fail('17 hard-delete a seat an incident uses',
    format($q$DELETE FROM seats WHERE id = %s$q$, :s1),
    'incidents_floor_id_seat_id_fkey');
SELECT pg_temp.expect_fail('18 hard-delete an incident with history',
    format($q$DELETE FROM incidents WHERE id = %s$q$, :inc),
    'incident_status_history_incident_id_fkey');

SELECT 'ALL 18 CASES PASSED';
ROLLBACK;
