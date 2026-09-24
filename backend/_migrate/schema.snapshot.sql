-- GENERATED, read-only: pg_dump --schema-only after the latest migration. Never applied; edit migrations/ instead.

CREATE FUNCTION public.reject_history_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'incident_status_history is append-only (% rejected)', TG_OP;
END;
$$;

CREATE TABLE public.buildings (
    id bigint NOT NULL,
    name text NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT buildings_name_check CHECK ((btrim(name) <> ''::text))
);

ALTER TABLE public.buildings ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.buildings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.engineer_profiles (
    user_id bigint NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    created_by bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.floors (
    id bigint NOT NULL,
    building_id bigint NOT NULL,
    name text NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT floors_name_check CHECK ((btrim(name) <> ''::text))
);

ALTER TABLE public.floors ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.floors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.incident_status_history (
    id bigint NOT NULL,
    incident_id bigint NOT NULL,
    from_status text,
    to_status text NOT NULL,
    actor_id bigint NOT NULL,
    assignee_id bigint,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT history_blocked_needs_reason CHECK (((to_status <> 'blocked'::text) OR (reason IS NOT NULL))),
    CONSTRAINT history_no_same_status CHECK ((from_status IS DISTINCT FROM to_status)),
    CONSTRAINT history_unassign_needs_reason CHECK (((to_status <> 'unassigned'::text) OR (from_status IS NULL) OR (reason IS NOT NULL))),
    CONSTRAINT history_unassigned_iff_no_assignee CHECK (((to_status = 'unassigned'::text) = (assignee_id IS NULL))),
    CONSTRAINT incident_status_history_from_status_check CHECK ((from_status = ANY (ARRAY['unassigned'::text, 'open'::text, 'in_progress'::text, 'blocked'::text, 'resolved'::text, 'closed'::text]))),
    CONSTRAINT incident_status_history_reason_check CHECK (((reason IS NULL) OR (btrim(reason) <> ''::text))),
    CONSTRAINT incident_status_history_to_status_check CHECK ((to_status = ANY (ARRAY['unassigned'::text, 'open'::text, 'in_progress'::text, 'blocked'::text, 'resolved'::text, 'closed'::text])))
);

ALTER TABLE public.incident_status_history ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.incident_status_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.incidents (
    id bigint NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    category text NOT NULL,
    status text DEFAULT 'unassigned'::text NOT NULL,
    requested_priority smallint NOT NULL,
    priority smallint NOT NULL,
    escalation_status text DEFAULT 'none'::text NOT NULL,
    reporter_id bigint NOT NULL,
    assignee_id bigint,
    building_id bigint NOT NULL,
    floor_id bigint,
    seat_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by bigint,
    CONSTRAINT incidents_category_check CHECK ((category = ANY (ARRAY['electrical'::text, 'plumbing'::text, 'hvac'::text, 'cleaning'::text, 'furniture'::text, 'access_security'::text, 'network'::text, 'hardware'::text, 'software'::text, 'other'::text]))),
    CONSTRAINT incidents_deleted_pair CHECK (((deleted_at IS NULL) = (deleted_by IS NULL))),
    CONSTRAINT incidents_description_check CHECK ((btrim(description) <> ''::text)),
    CONSTRAINT incidents_escalation_status_check CHECK ((escalation_status = ANY (ARRAY['none'::text, 'pending'::text, 'granted'::text, 'declined'::text]))),
    CONSTRAINT incidents_priority_check CHECK (((priority >= 1) AND (priority <= 4))),
    CONSTRAINT incidents_requested_priority_check CHECK (((requested_priority >= 1) AND (requested_priority <= 4))),
    CONSTRAINT incidents_seat_needs_floor CHECK (((seat_id IS NULL) OR (floor_id IS NOT NULL))),
    CONSTRAINT incidents_status_check CHECK ((status = ANY (ARRAY['unassigned'::text, 'open'::text, 'in_progress'::text, 'blocked'::text, 'resolved'::text, 'closed'::text]))),
    CONSTRAINT incidents_title_check CHECK (((btrim(title) <> ''::text) AND (length(title) <= 200))),
    CONSTRAINT incidents_unassigned_iff_no_assignee CHECK (((status = 'unassigned'::text) = (assignee_id IS NULL)))
);

ALTER TABLE public.incidents ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.incidents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.seats (
    id bigint NOT NULL,
    floor_id bigint NOT NULL,
    label text NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seats_label_check CHECK ((btrim(label) <> ''::text))
);

CREATE TABLE public.users (
    id bigint NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    full_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_email_acme_inc CHECK (((email = lower(btrim(email))) AND (email ~ '^[^@[:space:]]+@acme\.inc$'::text))),
    CONSTRAINT users_full_name_check CHECK ((btrim(full_name) <> ''::text))
);

CREATE VIEW public.incidents_read AS
 SELECT i.id,
    i.title,
    i.description,
    i.category,
    i.status,
    i.requested_priority,
    i.priority,
    i.escalation_status,
    i.reporter_id,
    i.assignee_id,
    i.building_id,
    i.floor_id,
    i.seat_id,
    i.created_at,
    i.updated_at,
    i.deleted_at,
    i.deleted_by,
    b.name AS building_name,
    (b.archived_at IS NOT NULL) AS building_archived,
    f.name AS floor_name,
    (f.archived_at IS NOT NULL) AS floor_archived,
    s.label AS seat_name,
    (s.archived_at IS NOT NULL) AS seat_archived,
    r.full_name AS reporter_name,
    a.full_name AS assignee_name
   FROM (((((public.incidents i
     JOIN public.buildings b ON ((b.id = i.building_id)))
     LEFT JOIN public.floors f ON ((f.id = i.floor_id)))
     LEFT JOIN public.seats s ON ((s.id = i.seat_id)))
     JOIN public.users r ON ((r.id = i.reporter_id)))
     LEFT JOIN public.users a ON ((a.id = i.assignee_id)));

CREATE TABLE public.refresh_tokens (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    token_hash text NOT NULL,
    family_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    active_role text,
    CONSTRAINT refresh_tokens_active_role_check CHECK ((active_role = ANY (ARRAY['employee'::text, 'engineer'::text, 'admin'::text])))
);

ALTER TABLE public.refresh_tokens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE public.seats ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.seats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.ticket_notes (
    id bigint NOT NULL,
    incident_id bigint NOT NULL,
    author_id bigint NOT NULL,
    kind text DEFAULT 'comment'::text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    deleted_by bigint,
    CONSTRAINT notes_deleted_pair CHECK (((deleted_at IS NULL) = (deleted_by IS NULL))),
    CONSTRAINT ticket_notes_body_check CHECK ((btrim(body) <> ''::text)),
    CONSTRAINT ticket_notes_kind_check CHECK ((kind = ANY (ARRAY['comment'::text, 'blocked'::text, 'escalation'::text, 'unassigned'::text])))
);

ALTER TABLE public.ticket_notes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ticket_notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.user_roles (
    user_id bigint NOT NULL,
    role text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_roles_role_check CHECK ((role = ANY (ARRAY['engineer'::text, 'admin'::text])))
);

CREATE VIEW public.ticket_notes_read AS
 SELECT n.id,
    n.incident_id,
    n.author_id,
    n.kind,
    n.body,
    n.created_at,
    n.edited_at,
    n.deleted_at,
    n.deleted_by,
    u.full_name AS author_name,
    COALESCE(( SELECT r.role
           FROM public.user_roles r
          WHERE (r.user_id = u.id)
          ORDER BY
                CASE r.role
                    WHEN 'admin'::text THEN 2
                    ELSE 1
                END DESC
         LIMIT 1), 'employee'::text) AS author_role
   FROM (public.ticket_notes n
     JOIN public.users u ON ((u.id = n.author_id)));

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT buildings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.engineer_profiles
    ADD CONSTRAINT engineer_profiles_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.floors
    ADD CONSTRAINT floors_building_id_id_key UNIQUE (building_id, id);

ALTER TABLE ONLY public.floors
    ADD CONSTRAINT floors_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.incident_status_history
    ADD CONSTRAINT incident_status_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.seats
    ADD CONSTRAINT seats_floor_id_id_key UNIQUE (floor_id, id);

ALTER TABLE ONLY public.seats
    ADD CONSTRAINT seats_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ticket_notes
    ADD CONSTRAINT ticket_notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX buildings_name_active_uq ON public.buildings USING btree (lower(name)) WHERE (archived_at IS NULL);

CREATE UNIQUE INDEX floors_name_active_uq ON public.floors USING btree (building_id, lower(name)) WHERE (archived_at IS NULL);

CREATE INDEX incident_status_history_incident_idx ON public.incident_status_history USING btree (incident_id, created_at);

CREATE INDEX incidents_assignee_idx ON public.incidents USING btree (assignee_id);

CREATE INDEX incidents_reporter_idx ON public.incidents USING btree (reporter_id);

CREATE INDEX incidents_status_idx ON public.incidents USING btree (status);

CREATE INDEX refresh_tokens_family_idx ON public.refresh_tokens USING btree (family_id);

CREATE UNIQUE INDEX seats_label_active_uq ON public.seats USING btree (floor_id, lower(label)) WHERE (archived_at IS NULL);

CREATE INDEX ticket_notes_incident_idx ON public.ticket_notes USING btree (incident_id, created_at);

CREATE INDEX user_roles_role_idx ON public.user_roles USING btree (role, user_id);

CREATE TRIGGER incident_status_history_no_truncate BEFORE TRUNCATE ON public.incident_status_history FOR EACH STATEMENT EXECUTE FUNCTION public.reject_history_change();

CREATE TRIGGER incident_status_history_no_update_delete BEFORE DELETE OR UPDATE ON public.incident_status_history FOR EACH ROW EXECUTE FUNCTION public.reject_history_change();

ALTER TABLE ONLY public.engineer_profiles
    ADD CONSTRAINT engineer_profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.engineer_profiles
    ADD CONSTRAINT engineer_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.floors
    ADD CONSTRAINT floors_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id);

ALTER TABLE ONLY public.incident_status_history
    ADD CONSTRAINT incident_status_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.incident_status_history
    ADD CONSTRAINT incident_status_history_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.incident_status_history
    ADD CONSTRAINT incident_status_history_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id);

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_building_id_floor_id_fkey FOREIGN KEY (building_id, floor_id) REFERENCES public.floors(building_id, id);

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_floor_id_seat_id_fkey FOREIGN KEY (floor_id, seat_id) REFERENCES public.seats(floor_id, id);

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.seats
    ADD CONSTRAINT seats_floor_id_fkey FOREIGN KEY (floor_id) REFERENCES public.floors(id);

ALTER TABLE ONLY public.ticket_notes
    ADD CONSTRAINT ticket_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.ticket_notes
    ADD CONSTRAINT ticket_notes_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.ticket_notes
    ADD CONSTRAINT ticket_notes_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

