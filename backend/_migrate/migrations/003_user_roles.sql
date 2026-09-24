-- 003: several roles per user (version 1.1, README -> Roadmap). replaces the single users.role.
-- employee is implicit: every user holds it, so user_roles stores only the roles granted on top of it.
-- that makes "employee cannot be removed" true by construction instead of an invariant to police.

CREATE TABLE user_roles (
    user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('engineer', 'admin')),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role)
);

-- "who are the admins" (last-admin guard, seeding) and "who are the engineers" read by role
CREATE INDEX user_roles_role_idx ON user_roles (role, user_id);

INSERT INTO user_roles (user_id, role)
SELECT id, role FROM users WHERE role <> 'employee';

-- the role a session acts as, carried across refreshes; null on rows written before this migration,
-- which fall back to the highest role held
ALTER TABLE refresh_tokens
    ADD COLUMN active_role TEXT CHECK (active_role IN ('employee', 'engineer', 'admin'));

-- the note view read users.role; a note now shows its author's highest role
DROP VIEW ticket_notes_read;

ALTER TABLE users DROP COLUMN role;

CREATE VIEW ticket_notes_read AS
SELECT n.*,
       u.full_name AS author_name,
       COALESCE((SELECT r.role FROM user_roles r WHERE r.user_id = u.id
                 ORDER BY CASE r.role WHEN 'admin' THEN 2 ELSE 1 END DESC LIMIT 1), 'employee') AS author_role
FROM ticket_notes n
JOIN users u ON u.id = n.author_id;
