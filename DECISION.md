# Decisions

Every settled decision, in register order, with a one-line reason. **`AGENTS.md` is the
source of truth** — options weighed, rejected alternatives, and full reasoning live there.
This file is the index: if the two disagree, `AGENTS.md` wins and this file is the bug.

**Recorded** says when a decision entered the record: `pre-session` means it was already
in commit `af53415`; a date means it was settled in a working session on that day.

## Architecture decisions (AD register)

| ID | Decision | Choice | Why | Recorded |
|---|---|---|---|---|
| AD-00 | Database | PostgreSQL (Aurora in cloud); no MongoDB | Relational data with joins and aggregates; one engine, not two | pre-session |
| AD-01 | Service decomposition | `auth`, `incidents`, `facilities`, `engineers`; `reports` at M10 | Domain seams score on Design; notes share incidents' ownership check, so they deploy with it | 2026-09-23 |
| AD-02 | Shared-code packaging | Vendor `backend/_shared/` into each service at prebuild; copies gitignored | Only physical files satisfy both the cloud zip and LocalStack's hot-reload mount | pre-session |
| AD-03 | Schema ownership and migrations | Private `backend/_migrate/` Lambda (no Function URL) invoked by Terraform during `apply`; numbered forward-only SQL + checksums | Aurora is VPC-only, so migrations must run inside it; `_` prefix keeps it off the internet; numbered files can alter tables without data loss | 2026-09-23 |
| AD-04 | DB access layer | Raw `psycopg` 3; one module-scope connection per warm container, reopened on error; parameterized queries only; multi-row writes in one transaction | Matches the example; a Lambda container serves one request at a time, so a pool or ORM adds nothing | 2026-09-23 |
| AD-05 | Intra-Lambda routing | Hand-rolled router in `_shared/`: method + pattern table, `404`/`405`+`Allow`, optional `/api/<service>` prefix and `//` normalised | No dependency or cold-start cost; fully explainable and unit-testable; Powertools' extras belong to AD-12/AD-16 | 2026-09-23 |
| AD-06 | API path and client | Same-origin relative `/api/<service>`; single `http.js` wrapper (in-memory token, single-flight refresh, correlation id, error envelope, body hash) | The strict refresh cookie only travels same-origin; the OAC needs the body hash | 2026-09-24 |
| AD-07 | Auth mechanism | Self-issued JWT, verified in every handler, with expiry | No new infra (not Cognito/OAuth); a required deliverable, done for real | pre-session |
| AD-07a | Signing algorithm | RS256 | Only `auth` can mint tokens; other services verify with a public key | pre-session |
| AD-07b | Signing key storage | Secrets Manager (cloud); env var dev key when `IS_LOCAL` | IAM grant already exists; only `auth` needs the secret | pre-session |
| AD-07c | Password hashing | bcrypt | argon2id's memory-hardness is a direct cost at 128 MB Lambda | pre-session |
| AD-07d | Refresh tokens | Rotated on every use, stored hashed, reuse detection revokes the family | Makes a stolen refresh token detectable | pre-session |
| AD-08a | Token storage | Refresh token in httpOnly `SameSite=Strict` cookie; access token in memory | Script cannot read the long-lived credential; no CSRF surface on API calls | pre-session |
| AD-08b | Origin sealing | Function URLs `AWS_IAM` behind a CloudFront OAC | Only the distribution can invoke a Lambda; direct calls get 403 | pre-session |
| AD-08c | Access-token transport | `X-Access-Token` header, not `Authorization` | OAC's SigV4 signature occupies `Authorization` | pre-session |
| AD-09 | RBAC enforcement | Role as JWT claim; routes declare `roles`/`public` or startup fails; lists filtered in SQL, single rows checked by service `policy.py`; `404` unseen / `403` seen-but-forbidden; UI gets permitted actions from the API | Closed by default; no fetch-then-filter leaks; sequential ids not confirmable by `403`; one copy of the rules | 2026-09-23 |
| AD-10 | Frontend dependencies | Mandated libraries + MUI icons + self-hosted fonts; no React Query / form / date / DnD libraries | Fewer dependencies, code the team can explain; zod would duplicate server rules | 2026-09-24 |
| AD-11 | Test stack | pytest + `pytest-cov`; Vitest + RTL; Cypress; thresholds enforced in tool config | Vitest is native to Vite (Jest needs ESM config); enforced targets fail the run instead of being ignored | 2026-09-23 |
| AD-12 | Errors and validation | One envelope `{code, message, fields?, request_id}`; codes `bad_request`/`validation_failed` 400, `unauthenticated` 401, `forbidden` 403, `not_found` 404, `method_not_allowed` 405, `conflict` 409, `internal` 500; Pydantic v2; single `_shared/http.py` wrapper | Frontend branches on stable codes and shows field errors in place; no leaked internals; validation is where hand-rolled code breaks | 2026-09-23 |
| AD-14 | Real-time | Short polling per view, paused when hidden | No WebSocket infrastructure; staleness bounded and visible | 2026-09-24 |
| AD-15 | PWA and AI | Out of scope | AI needs an external API (brief forbids); offline conflicts with the auth design | 2026-09-24 |
| AD-13 | Search, filter, pagination | Server-side SQL filters; `page`/`limit` (20, max 100); `{items, total, page, limit}`; allow-listed `sort`, default priority desc then oldest | Every persona's view differs by filter; page numbers let the UI jump; allow-list keeps sort out of SQL injection | 2026-09-23 |
| AD-16 | Logging | JSON lines (`_shared/log.py`); one access line per request by the wrapper; UUID `X-Correlation-Id` logged and echoed; levels INFO/WARNING/ERROR, DEBUG via `LOG_LEVEL`; no secrets or bodies; no custom metrics | Queryable logs in Logs Insights; one user action traceable across calls; identical local and cloud behaviour | 2026-09-23 |
| AD-17 | Incident state machine | Admin any→any; engineer (assigned only) `Open→In Progress`, `In Progress⇄Blocked`, `In Progress→Resolved`; employee none; only admins close | No skip keeps the acknowledged timestamp; unblock avoids admin bottleneck; no review state, so admin closing is the confirmation | 2026-09-23 |
| AD-18 | Visual workflow | MUI `Stepper` per incident + status-grouped board on Admin/Engineer dashboard | Stepper answers the requester, board answers the dispatcher; drag only once AD-17 is enforced server-side | 2026-09-23 |
| AD-19 | Dashboards and reporting | `reports` service with `/summary` (visibility-scoped), `/hotspots`, `/timings`, `/attention`; SQL aggregates; `status` filter, no window; time to assign, time to acknowledge (first `open → in_progress`), time to resolve — all from history, measured from creation; "informed" left to the frontend; no caching | Counting belongs in the database; reassignment makes first-occurrence the honest rule; all three of the brief's timing questions answered on one comparable timeline (briefly redefined as assignment, reverted the same day) | 2026-09-23 |
| AD-20 | Priority and escalation | `Low…Critical` ranked 1–4; `requested_priority` (employee) + `priority` (admin); escalation = one `escalation_status` field on `incidents`, reason required and posted as a note, admin may set none/granted/declined from any value; every change (request or admin) posts a note with a reason; latest only, no automatic effect | Employees can't self-inflate priority; escalation means different things per issue, so the admin decides the response; no extra table | 2026-09-23 |
| AD-21 | Registration and roles | Register → Employee only (exact `acme.inc` match, server-side, no verification); admins promote to Engineer/Admin; first admin seeded by `_migrate` from TF vars; `users.role` + 1:1 `engineer_profiles`; demotion auto-unassigns `Open`/`In Progress`/`Blocked` tickets | No path to self-grant a role; no admin-set passwords; bootstrap has no public surface; no orphaned assignments | 2026-09-23 |
| AD-22 | Facility hierarchy | Three tables; incident `building_id` required, `floor_id`/`seat_id` optional; composite FKs; `archived_at` soft delete; no occupants | Hotspot report is a plain `GROUP BY`; the DB rejects inconsistent locations; archiving keeps history | 2026-09-23 |

### Incident workflow (AD-17)

Engineer moves shown, on assigned tickets only. Only admins assign, which moves a ticket
`Unassigned → Open`. Admins may otherwise move between any two statuses, but nothing leaves
`Unassigned` without an assignee. Only admins close; employees change no status.

```
Unassigned ──(admin assigns)──▶ Open → In Progress → Resolved
                                             ⇅
                                          Blocked
```

## Decided without an AD number

| Decision | Choice | Why | Recorded |
|---|---|---|---|
| Auth sequencing | Authentication (M3) and authorization (M4) before any CRUD | Retrofitting identity into existing endpoints is the costliest reordering | pre-session |
| Backend language | Python | Mandated | pre-session |
| Frontend stack | React + Material UI + React Responsive | Mandated | pre-session |
| IaC / deploy | Terraform + provided `bin/` scripts | Provided scaffold | pre-session |
| Product type | Incident ticketing (service desk), not a planning board | Requesters report, admins dispatch, engineers resolve; metrics are MTTA/MTTR | 2026-09-23 |
| First service (M1) | `auth` as the hello-world service | Exists under any AD-01 outcome, so nothing is built to be thrown away | 2026-09-22 |
| Dev proxy headers | `bin/proxy-server.js` forwards `x-access-token`, `cookie` (2026-09-22), and `x-correlation-id` (2026-09-23) | It dropped all three by default, making every local request anonymous and untraceable | 2026-09-22 |
| `_migrate` carries pydantic | `pydantic==2.10.4` added to `_migrate/requirements.txt` alongside `_shared/` and `auth/`, though `_migrate` never imports it | `bin/sync-shared.sh` checks declared dependency lines against every target including `_migrate`, not per-module imports; ~5 MB accepted rather than building a per-module dependency list in a timeboxed workshop | 2026-09-23 |
| Local dependency build | `start-dev.sh` pip targets Python 3.13 / `manylinux2014_x86_64` | Host `pip` belongs to 3.14; compiled wheels failed to import in Lambda | 2026-09-22 |
| DB credentials | Read with `os.environ[...]`, no fallbacks; `sslmode=require` when not local | Terraform always injects them, so a missing one is a deploy bug, not a default | 2026-09-22 |
| Incident categories | Fixed DB-checked list of 10 (`electrical` … `software`, `other`) | Answers the categories question with no extra table; one-line migration to change | 2026-09-23 |
| Incident deletion | Admin-only soft delete (`deleted_at`, `deleted_by`) | CRUD `DELETE` without erasing the history reports depend on | 2026-09-23 |
| Engineer availability | `engineer_profiles.is_available`, toggled by engineer or admin | Answers "which engineers are available" directly | 2026-09-23 |
| Note kinds | `ticket_notes.kind` ∈ comment/blocked/escalation/unassigned | Reason-bearing notes are identifiable by query | 2026-09-23 |
| Schema conventions | Codes not labels; `TEXT`+`CHECK` not `ENUM`; `BIGINT` identity keys; refresh tokens as sha256 | Simple migrations, readable ids, deterministic token lookup | 2026-09-23 |
| Service-dir gitignore | Allow-list: only `*.py`, `requirements.txt`, `tests/` tracked | pip installs into the service dir; package names cannot be enumerated | 2026-09-22 |
| Admin seed input | Terraform receives a bcrypt hash, never the password, via the `_migrate` Lambda's invocation input (not env vars); deploy fails when no admin exists and the `TF_VAR_...` vars are unset | Terraform state stores variable values in plain text; a deploy that could silently ship with no admin would leave nobody able to ever promote anyone | 2026-09-23 |
| Token lifetimes | Access 15 min; refresh 7 days, sliding | Short access window bounds a stolen token and stale roles; a week of inactivity ends the session | 2026-09-23 |
| JWT key generation | Terraform `tls_private_key`; public key as env var to all Lambdas; private key in Secrets Manager (cloud) or `auth` env var (local) | Reproducible, no manual step on an ephemeral VDI; key in state accepted (same bucket as the DB password) | 2026-09-23 |
| Password policy | 12 chars minimum, no composition rules, 72-byte maximum | NIST SP 800-63B; bcrypt ignores bytes past 72, so reject rather than truncate | 2026-09-23 |
| Brute-force protection | Scope cut, no lockout | No rate-limiting infrastructure; lockout enables denial of service; bcrypt cost is the brake | 2026-09-23 |
| bcrypt cost | 10 now; re-decide from a cloud measurement | LocalStack runs Lambdas without CPU limits, so local timing is meaningless; cost is stored per hash, so it can rise safely | 2026-09-23 |
| Sign-out endpoint | `DELETE /api/auth/refresh` | The refresh cookie's path means the browser sends it nowhere else; sign-out must revoke server-side | 2026-09-23 |
| M4 scope | Role administration + persona access matrix now; ownership and transitions with M5 | Ownership needs incidents to exist | 2026-09-23 |
| Role administration | One admin endpoint in `auth` (`PUT /users/{id}/role`), one transaction; unassign operation in `_shared/incident_ops.py`; last admin cannot be removed | Atomic role changes; incident rules exist once; no lockout | 2026-09-23 |
| Role inheritance | Employee is the base role; engineers and admins have every employee capability (report, see own reports, edit own while unassigned, request escalation); engineers see reported **or** assigned | The user's model; an engineer's own broken monitor must stay visible to them | 2026-09-23 |
| M5 scope | Any signed-in user reports; reporter edits own while `unassigned`, admin any time, priority admin-only, engineers status only; assignment and escalation included | Assignment is the only path to `open`; escalation's field is on `incidents` | 2026-09-23 |
| M6 facilities details | Archived locations hidden everywhere (lists and `GET` by id); no restore; no moving floors/seats (rename only); duplicate names a friendly `409` backed by the unique index | Simplest consistent model; moving would fight the incidents' composite FKs; restore would fight name uniqueness | 2026-09-23 |
| M7 engineers | Workload computed by join; assigning an unavailable engineer refused (`400`); going unavailable keeps current tickets; engineer list admin-only (engineers see `/me`); no specialties | Answers "which engineers are available, how is work distributed" without stored counts that drift; unavailable means no new work, not lost work | 2026-09-23 |
| M8 notes | Edits visible (`edited_at`); admins may soft-delete notes on closed incidents (moderation), authors may not edit or delete there; API creates only `comment`; 5,000-char limit; deleted notes stay as placeholders | A silently rewritten note undermines the thread as a record; moderation needs outlive the ticket | 2026-09-23 |
| M9 search gaps | Ticket-number search in `q` added; date ranges and `reporter_id` skipped; unindexed `ILIKE` a stated scope cut (`pg_trgm` later) | Help-desk users often have only the number; the rest is not asked for | 2026-09-23 |
| Read views for names | `incidents_read` / `ticket_notes_read` (migration 002); reads from views, writes and locks on base tables | Names without extra round-trips or ambiguous joins in every query | 2026-09-23 |
| Reporter filter (E5) | `reporter_id` added to the incidents list, reversing the M9 skip | "My reports" for engineers and admins, who see more than their own | 2026-09-23 |
| Auth Lambda memory | 256 MB for `auth` only (others 128) | bcrypt login took 1.7 s warm at 128 MB; doubled rather than quadrupled | 2026-09-23 |
| Cookie delivery | Keep both the `cookies` field and `Set-Cookie` header | One code path for AWS and LocalStack, so LocalStack stays a working demo fallback; AWS's duplicate header is harmless | 2026-09-23 |
| Aurora pausing | Keep `min_capacity = 0`; first request after idle waits ~15–20 s | No charge for idle capacity in a workshop; `connect_timeout=25` absorbs the resume | 2026-09-23 |
| Integration test database | Database-backed backend tests run against the **dev database**, not a separate test database; each test gets a throwaway PostgreSQL schema (`test_<random>`) created/dropped by the `isolated_schema` fixture (`backend/conftest.py`), with code under test pointed at it via `PGOPTIONS=-c search_path=<schema>` | One PostgreSQL to stand up locally, not two; the schema-per-test isolation keeps writes out of `public` without touching production connection code | 2026-09-23 |
| Frontend install reproducibility | `frontend/package-lock.json` tracked (`.gitignore` un-ignores only that file); `bin/start-dev.sh` runs `npm ci` when the lock exists, `npm install` otherwise | The lock was previously gitignored and deleted, so every fresh machine re-resolved dependency versions | 2026-09-24 |
| CloudFront SPA/API routing fix | Removed the distribution-wide `custom_error_response` (404 → 200 `/index.html`); added `aws_cloudfront_function.spa_rewrite` as a viewer-request function on the S3 behavior only, rewriting extension-less non-`/api/*` paths to `/index.html` | The old rule turned API 404s into `200` HTML (broke the AD-12 envelope) and never fired for deep links anyway, since S3 behind the OAC answers a missing key with `403`; rejected: a 403→HTML rule (also breaks API 403s) and granting `ListBucket` (leaves API 404s as HTML) | 2026-09-24 |
| M11 dashboard (`/dashboard`) | Admin and engineer only, gated by `DASHBOARD_ROLES`; `/` redirects by role, an employee visiting `/dashboard` is bounced to `/tickets`; UI gating is presentation only, the server (AD-09) is the real enforcement | Staff land where they act, employees where they report; no client-side control is trusted for access | 2026-09-24 |
| M11 board data shape | `getBoard()` issues one `GET /api/incidents?status=<s>&limit=6` per status (six calls, one shared correlation id) instead of one paged list split client-side | A single page could be entirely one status, leaving no true per-column total for "+N more not shown" | 2026-09-24 |
| Demo data seeding | `tools/seed_demo.py` (stdlib-only, outside every Lambda bundle) seeds through the public API as an admin, not SQL | Exercises the same business rules real traffic does; a backdated SQL seed would bypass `workflow.py`/`policy.py` and could only reach private Aurora through `_migrate`, mixing fake data into schema history | 2026-09-24 |
| History timeline (`HistoryTimeline.jsx`) | Every status change on the incident page, newest first, read from the existing `GET /api/incidents/{id}` `history` field; phones show the latest 3 with a "Show all" toggle | No new request — rides the existing 20 s poll; newest-first matches how a reader scans a log, opposite of the stepper's oldest-to-newest | 2026-09-24 |
| Dashboard section nav and ticket lookup (`b16fe04`) | Left sticky nav (desktop) / sideways-scrolling top row (phone), section highlighted via `IntersectionObserver`; Lookup runs `GET /api/incidents` server-side (`q` debounced 300 ms, multi-status/priority/category/building/engineer/escalation filters, 20/page, filter change resets to page 1); History nested under Lookup, pending until a result is picked | Closes the MVP "Search and filter" capability in the UI; status sort omitted because it would be alphabetical | 2026-09-24 |
| `srOnly` width bug (`theme.js`) | `width: 1` (MUI reads as `100%`) changed to `'1px'`; board/table scroll wrappers set `position: relative` | Dashboard rendered 2602 px wide in a 1280 px window; now 1320 px | 2026-09-24 |
| Admin "Who's available" (`bc87575`) | Engineer table from `GET /api/engineers?sort=workload` (least loaded first, workload bar, polled 30 s); availability via `PUT /api/engineers/{id}/availability`; promote via employee search (`GET /api/auth/users?role=employee`) + `PUT /api/auth/users/{id}/role`; demote behind a confirmation dialog (Cancel focused by default) stating how many active tickets return to `Unassigned` | Answers the AD-19 "which engineers are available, how is work distributed" question and covers "create engineer profiles" in the UI; demote included, with a small confirmation pop-up, by the user's call | 2026-09-24 |
| Engineers page relocated (`d9907d6`) | "Who's available" moved off `/dashboard` (section and side-nav entry removed) onto a standalone admin-only `/engineers` page, linked from the **top** `AppShell` nav as "Engineers"; table, availability switch, Make engineer, and Demote unchanged; non-admins redirected | Keeps `/dashboard`'s side nav to the reporting sections it was built for; engineer administration reads as its own destination, not a dashboard panel | 2026-09-24 |
| Read-only `/engineers/:id` profile (`d9907d6`) | Admin-only view of one engineer: banner, `GET /api/engineers/{id}` header with the shared `AvailabilitySwitch`, a board of their **assigned** tickets by status (no `Unassigned` column), counts derived from the column totals (Active = open + in progress + blocked), and a separate "Reported by them" list (latest 5); unknown/non-engineer `id` → 404 | Read-only over impersonation: the admin stays the admin, the audit trail stays intact, and every action happens on the incident page as the admin | 2026-09-24 |
| No `GET /api/engineers/{id}/dashboard` endpoint | A backend endpoint computing the engineer's exact visibility (assigned **or** reported, matching their own dashboard board) was proposed and declined; the profile stays frontend-only, combining two separate list calls (`assignee_id`, `reporter_id`) instead of one OR'd query | The user's call, the day before the demo; stated consequence on the page: the profile is not an exact copy of the engineer's own dashboard, since the list API can filter by assignee or by reporter but not both at once | 2026-09-24 |

## Rules settled beneath a parent decision

Fixed rules recorded under a parent. AD-09, AD-12, and AD-17 have since closed; M8 is still open.

| Parent | Rule | Why | Recorded |
|---|---|---|---|
| AD-17 | Notes writable on every status except `Closed` | "Open incidents" means not yet closed; otherwise the requester is locked out once work starts | 2026-09-23 |
| M8 | One chronological conversation per incident, no reply nesting | The personas describe a two-way conversation, not a forum | 2026-09-23 |
| AD-09 | Notes are soft-deleted, never hard-deleted | Keeps the record behind "how effectively are employees informed" | 2026-09-23 |
| AD-17 | `Blocked` reason stored on the status-history row **and** posted as a note | History is the undeletable record the report reads; the note tells the requester | 2026-09-23 |
| AD-17 | Incident responses include `allowed_transitions`, computed server-side by the `incidents` workflow module; the UI shows only those | The rules exist once; the UI cannot offer a move the server would refuse | 2026-09-23 |
| AD-17 | Added `Unassigned` status before `Open`; only admins assign, which moves `Unassigned → Open`; status is `Unassigned` iff no assignee (code + DB `CHECK`) | Triage queue is a status filter; time-to-assign is an ordinary transition. Deliberate deviation from the brief's five statuses | 2026-09-23 |
| AD-17 | Only admins reassign, and only via `Unassigned` with a required reason (history + note, like `Blocked`) | Every hand-off becomes a recorded transition, so a ticket that has passed through many engineers is visible | 2026-09-23 |
| AD-17 | Status history carries `assignee_id` (assignee after each transition) | Counts engineers per ticket from the existing history — no separate assignment table | 2026-09-23 |
| AD-17 | `incident_status_history` is append-only, enforced by a trigger rejecting `UPDATE`/`DELETE` | The timing metrics are computed from it; convention alone can be broken by any query | 2026-09-23 |
| AD-21 | Engineers-only assignment is enforced in the `incidents` service, not the DB (`assignee_id` → `users`) | An FK to `engineer_profiles` would block demotion while closed tickets reference the engineer | 2026-09-23 |
| AD-22 | "Not archived" is enforced in the services, not the DB; name uniqueness is DB-enforced among non-archived rows | FKs prove existence, not state; partial unique indexes let an archived name be reused | 2026-09-23 |
| AD-09 | Only the author edits a note; author or Facility Admin soft-deletes | Admins moderate but never rewrite someone else's words | 2026-09-23 |
| AD-12 | A PostgreSQL FK violation (`23503`) reaching the error handler maps to `400`, not `500` | The service validates locations first for a precise message; the FK is only the backstop, so reaching it means a caller error the service missed | 2026-09-23 |
| AD-05 | `router.resolve()` prefers the most specific matching pattern (fewest captured params), independent of registration order; `405` only when no matching pattern has the method, `Allow` lists methods from every matching pattern | Bug found: a `{param}` route registered before a literal route shadowed it, so a later literal route answered `405` instead of reaching its handler | 2026-09-23 |
| AD-12 | `auth`'s public health route runs `SELECT 1` and returns only `{"service", "database"}` | The M1 handler ran `SELECT version()` and returned the full PostgreSQL version plus a `headers_received` echo on a public route — server fingerprinting | 2026-09-23 |
| AD-18 | Admin/engineer dashboard board issues six list calls (`status=<s>&limit=6`, one shared correlation id), not one paged list | A single page could land entirely on one status, leaving no true per-column count for "+N more not shown" | 2026-09-24 |
| AD-14 | Dashboard summary/attention/board poll every 30 s, paused when hidden; timings/hotspots load once plus a Refresh button (`usePolling` on-demand mode, `intervalMs = null`) | Timings and hotspots scan the full status history and change slowly; polling them every 30 s buys nothing | 2026-09-24 |
| AD-19 | Engineer dashboard board shows the engineer's full visibility: tickets assigned to them **or** reported by them (no `assignee_id` filter) | Same scope as the server's visibility rule and the summary counts beside it, so board and counts always agree; an engineer's own reports stay in view | 2026-09-24 |

## Still open

None. Every AD in the register is decided, and so is the one sub-question raised since (engineer board scope, below).
