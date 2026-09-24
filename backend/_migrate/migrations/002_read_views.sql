-- 002: read views that carry names beside ids (frontend gaps E1, E2), so a list or detail needs no extra
-- round-trip to name a location or a person. writes still go to the base tables.
-- a view's column list is fixed when it is created: a later migration that adds a column to incidents or
-- ticket_notes must recreate the matching view here, or the new column will not appear in reads.

CREATE VIEW incidents_read AS
SELECT i.*,
       b.name                    AS building_name,
       b.archived_at IS NOT NULL AS building_archived,
       f.name                    AS floor_name,
       f.archived_at IS NOT NULL AS floor_archived,
       s.label                   AS seat_name,
       s.archived_at IS NOT NULL AS seat_archived,
       r.full_name               AS reporter_name,
       a.full_name               AS assignee_name
FROM incidents i
JOIN buildings b ON b.id = i.building_id
LEFT JOIN floors f ON f.id = i.floor_id
LEFT JOIN seats s ON s.id = i.seat_id
JOIN users r ON r.id = i.reporter_id
LEFT JOIN users a ON a.id = i.assignee_id;

CREATE VIEW ticket_notes_read AS
SELECT n.*,
       u.full_name AS author_name,
       u.role      AS author_role
FROM ticket_notes n
JOIN users u ON u.id = n.author_id;
