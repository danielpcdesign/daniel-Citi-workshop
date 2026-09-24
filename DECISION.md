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
| AD-07 | Auth mechanism | Self-issued JWT, verified in every handler, with expiry | No new infra (not Cognito/OAuth); a required deliverable, done for real | pre-session |
| AD-07a | Signing algorithm | RS256 | Only `auth` can mint tokens; other services verify with a public key | pre-session |
| AD-07b | Signing key storage | Secrets Manager (cloud); env var dev key when `IS_LOCAL` | IAM grant already exists; only `auth` needs the secret | pre-session |
| AD-07c | Password hashing | bcrypt | argon2id's memory-hardness is a direct cost at 128 MB Lambda | pre-session |
| AD-07d | Refresh tokens | Rotated on every use, stored hashed, reuse detection revokes the family | Makes a stolen refresh token detectable | pre-session |
| AD-08a | Token storage | Refresh token in httpOnly `SameSite=Strict` cookie; access token in memory | Script cannot read the long-lived credential; no CSRF surface on API calls | pre-session |
| AD-08b | Origin sealing | Function URLs `AWS_IAM` behind a CloudFront OAC | Only the distribution can invoke a Lambda; direct calls get 403 | pre-session |
| AD-08c | Access-token transport | `X-Access-Token` header, not `Authorization` | OAC's SigV4 signature occupies `Authorization` | pre-session |
| AD-09 | RBAC enforcement | Role as JWT claim; routes declare `roles`/`public` or startup fails; lists filtered in SQL, single rows checked by service `policy.py`; `404` unseen / `403` seen-but-forbidden; UI gets permitted actions from the API | Closed by default; no fetch-then-filter leaks; sequential ids not confirmable by `403`; one copy of the rules | 2026-09-23 |
| AD-11 | Test stack | pytest + `pytest-cov`; Vitest + RTL; Cypress; thresholds enforced in tool config | Vitest is native to Vite (Jest needs ESM config); enforced targets fail the run instead of being ignored | 2026-09-23 |
| AD-12 | Errors and validation | One envelope `{code, message, fields?, request_id}`; codes `bad_request`/`validation_failed` 400, `unauthenticated` 401, `forbidden` 403, `not_found` 404, `method_not_allowed` 405, `conflict` 409, `internal` 500; Pydantic v2; single `_shared/http.py` wrapper | Frontend branches on stable codes and shows field errors in place; no leaked internals; validation is where hand-rolled code breaks | 2026-09-23 |
| AD-13 | Search, filter, pagination | Server-side SQL filters; `page`/`limit` (20, max 100); `{items, total, page, limit}`; allow-listed `sort`, default priority desc then oldest | Every persona's view differs by filter; page numbers let the UI jump; allow-list keeps sort out of SQL injection | 2026-09-23 |
| AD-16 | Logging | JSON lines (`_shared/log.py`); one access line per request by the wrapper; UUID `X-Correlation-Id` logged and echoed; levels INFO/WARNING/ERROR, DEBUG via `LOG_LEVEL`; no secrets or bodies; no custom metrics | Queryable logs in Logs Insights; one user action traceable across calls; identical local and cloud behaviour | 2026-09-23 |
| AD-17 | Incident state machine | Admin any→any; engineer (assigned only) `Open→In Progress`, `In Progress⇄Blocked`, `In Progress→Resolved`; employee none; only admins close | No skip keeps the acknowledged timestamp; unblock avoids admin bottleneck; no review state, so admin closing is the confirmation | 2026-09-23 |
| AD-18 | Visual workflow | MUI `Stepper` per incident + status-grouped board on Admin/Engineer dashboard | Stepper answers the requester, board answers the dispatcher; drag only once AD-17 is enforced server-side | 2026-09-23 |
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
| Integration test database | Database-backed backend tests run against the **dev database**, not a separate test database; each test gets a throwaway PostgreSQL schema (`test_<random>`) created/dropped by the `isolated_schema` fixture (`backend/conftest.py`), with code under test pointed at it via `PGOPTIONS=-c search_path=<schema>` | One PostgreSQL to stand up locally, not two; the schema-per-test isolation keeps writes out of `public` without touching production connection code | 2026-09-23 |

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

## Still open

AD-06 · AD-10 · AD-14 · AD-15 ·
AD-16 · AD-19 — see `AGENTS.md` → Pending architecture
decisions.
