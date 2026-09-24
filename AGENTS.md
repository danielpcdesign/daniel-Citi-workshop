# AGENTS.md

Guidance for AI coding agents working in the **Citi Coding Workshop — Full Stack** submission.
Sources: repo root `README.md`, `docs/README.md`, `docs/validation.md`, `docs/full-stack.md`,
`backend/README.md`, `frontend/README.md`, `infra/lambda.tf`, `bin/generate-env.sh`.
Place this file at the repo root.

## Product context

**ACME Inc. facility incident management platform** — a centralized, stand-alone web app
replacing issue reporting fragmented across email, chat, and manual trackers. Today
employees cannot easily report problems or track progress, facility admins lack end-to-end
visibility, and engineers cannot manage assignments consistently. Result: delayed
resolutions, duplicate tickets, poor communication.

**Initial scope requires no integrations with external systems.** Self-service only, with
clear role-based responsibilities and transparent communication.

> This supersedes the team-management example in the repo's root `README.md`. That example
> is generic workshop filler; **the statement above is the actual assignment.** Ignore
> individuals/teams/achievements wherever the repo docs use them.

### Personas

| Persona | Can do |
| --- | --- |
| **Employee** | Register with an `acme.inc` email address; create and track incidents; add notes to open incidents; request or manage priority/escalation (exact model is ours to design — see AD-20) |
| **Facility Admin** | Define facilities (buildings, floors, seats); create engineer profiles; assign tickets; oversee the full ticket lifecycle |
| **Engineer** | Manage assigned tickets; keep status updated; communicate with ticket creators via incident notes |

### Entities

`incidents` · `facilities` (building → floor → seat hierarchy) · `engineer profiles` ·
`ticket notes` · `users`/roles

### Incident workflow

`Open` → `In Progress` → `Blocked` → `Resolved` → `Closed`

> **Deliberate deviation (AD-17):** we add an `Unassigned` status before `Open`, making six.
> The mandated five are unchanged and in the same order; `Unassigned` makes the admin's
> triage queue and time-to-assign directly visible in the status history.

Legal transitions, who may perform each, and whether `Blocked` requires a reason are design
decisions — see AD-17.

### MVP capabilities

- Authentication and authorization; RBAC over the three personas
- CRUD for incidents, facilities (building/floor/seat), engineer profiles, and ticket notes
- The incident workflow above, enforced
- **Visual representation of the ticket workflow** (see AD-18)
- **Per-persona dashboard/reporting** — e.g. ticket counts by status, priority, assignee
  (see AD-19)
- Search and filter
- Responsive design, mobile and desktop

### Questions the app must answer

These are acceptance criteria in disguise — drive the schema, the indexes, and the
dashboard queries from them:

- What incidents are currently open, and what is their status?
- Which buildings, floors, and seats have the highest number of recurring issues?
- How quickly are incidents acknowledged, assigned, and resolved?
- Which engineers are available, and how is work distributed across them?
- What are the most common facility and technology issue categories?
- Which incidents are escalated or blocked, and why?
- How effectively are employees informed about ticket progress and outcomes?

**Schema implication:** the timing questions ("how quickly … acknowledged, assigned,
resolved") cannot be answered from a single mutable `status` column. Persist a status
transition history with timestamps and actor from the start — retrofitting it later means
losing every incident's history. With the `Unassigned` status (AD-17), first assignment
*is* a transition (`Unassigned → Open`), so time-to-assign comes from the same history.

## Decided

| # | Decision | Choice |
| --- | --- | --- |
| AD-00 | Database | **PostgreSQL** (Aurora in cloud). MongoDB/DocumentDB is **not used** — do not add `pymongo`, `MONGO_*` handling, or `TF_VAR_aws_mongo_enabled`. |
| AD-01 | Service decomposition | **Domain split: `auth`, `incidents` (incl. notes, transitions, history, assignment), `facilities`, `engineers`; `reports` added at M10.** Notes are their own entity and table, deployed inside `incidents` with nested routes. |
| AD-02 | Shared-code packaging | **Vendor `backend/_shared/` into each service directory as a prebuild step**, gitignoring the copies. Physical presence is the only thing that satisfies both the zip builder and the LocalStack hot-reload mount. Not a Lambda layer, not a second `source_path` entry. |
| AD-03 | Schema ownership and migrations | **A private `backend/_migrate/` Lambda, declared in its own `infra/migrate.tf` with no Function URL, invoked by Terraform (`aws_lambda_invocation`) during `apply`.** Format: numbered forward-only SQL files with checksums in a `schema_migrations` table. |
| AD-04 | DB access layer | **Raw `psycopg` 3, as in the example: one module-scope connection per warm Lambda container, opened lazily, dropped and reopened on error.** No pool, no SQLAlchemy. Lives in `_shared/` (AD-02). Multi-row writes in `with conn.transaction():`. |
| AD-05 | Intra-Lambda routing | **Hand-rolled router in `_shared/`:** method + path-pattern table, `404` unknown path, `405` + `Allow` wrong method, optional `/api/<service>` prefix and duplicate slashes normalised. No framework. |
| AD-06 | API path and client | **Same-origin `/api/<service>` (Vite proxy locally, CloudFront in cloud); one wrapper: in-memory `X-Access-Token`, single-flight refresh, correlation id, error envelope, SHA-256 body hash for POST/PUT.** |
| AD-07 | Auth mechanism | **Self-issued JWT, implemented for real** — signed token, carried in `X-Access-Token` (AD-08c), verified in every handler, with expiry. Not OAuth, not Cognito. A sign-in that returns a user without issuing a token does not satisfy this. |
| AD-07a | Signing algorithm | **RS256.** Only the `auth` service holds the private key; all other services verify with the public key, distributed as a plain env var. |
| AD-07b | Signing key storage | **AWS Secrets Manager**, private key only, read by the `auth` service alone and cached at module scope. Local dev reads a dev key from an env var. |
| AD-07c | Password hashing | **bcrypt** — argon2id's memory-hardness is a direct cost in Lambda. |
| AD-07d | Refresh tokens | **Yes, rotated on every access-token request**, with server-side state, stored hashed, and **reuse detection** revoking the token family. |
| AD-08a | Token storage | **Refresh token in an httpOnly cookie** (`Secure; SameSite=Strict; Path=/api/auth/refresh`), same-origin via CloudFront. **Access token in memory only.** Single-flight refresh. |
| AD-08b | Origin sealing | **Function URLs move to `authorization_type = "AWS_IAM"` behind a CloudFront OAC** (`origin_type = "lambda"`), so only the distribution can invoke them. |
| AD-08c | Access-token transport | **`X-Access-Token` header, not `Authorization`.** OAC SigV4 signing claims `Authorization` for the signature, so the two cannot share it. Handlers read `X-Access-Token`; `Authorization` belongs to the infrastructure. |
| AD-09 | RBAC enforcement | **Role as a JWT claim; every route declares `roles` or `public` at registration or the service fails to start; ownership filtered in SQL for lists and checked by per-service policy for single rows; `404` for unseen, `403` for seen-but-forbidden; frontend takes permitted actions from the API.** |
| AD-10 | Frontend dependencies | **MUI, React Router, React Responsive, MUI icons, self-hosted fonts; no React Query, form, date, or drag-and-drop libraries; Vitest/RTL/Cypress; Allman enforced by `@stylistic`.** |
| AD-11 | Test stack | **pytest + `pytest-cov` (backend), Vitest + React Testing Library (frontend), Cypress (E2E).** Coverage thresholds enforced in tool config, so a run below target fails. |
| AD-12 | Errors and validation | **Envelope `{error: {code, message, fields?, request_id}}` everywhere; fixed code table (400/401/403/404/405/409/500); `500` never leaks detail; Pydantic v2 for bodies; one `_shared/http.py` entry wrapper maps every exception.** |
| AD-14 | Real-time | **Short polling (detail 20 s, dashboards 30 s, my tickets 60 s), paused when hidden.** |
| AD-15 | PWA / AI | **Out of scope.** |
| AD-13 | Lists | **Server-side SQL filters (incidents: status, priority, category, location, assignee, escalation, `q`); `page`/`limit` (20, max 100) with `{items, total, page, limit}`; allow-listed `sort`, default priority desc then oldest first.** |
| AD-16 | Logging | **JSON lines from a stdlib formatter in `_shared/log.py`; one access line per request (route pattern, status, duration, ids); UUID-validated `X-Correlation-Id` echoed and logged, falling back to `request_id`; never log tokens, cookies, secrets, or bodies; no custom metrics.** |
| AD-17 | Incident state machine | **Admin: any status → any other. Engineer, on assigned tickets only: `Open→In Progress`, `In Progress⇄Blocked`, `In Progress→Resolved`. Employee: none.** Only admins close. Entering `Blocked` requires a reason. Same-status moves rejected. New incidents start in an added `Unassigned` status; only admins assign, which moves `Unassigned → Open`; status is `Unassigned` iff no assignee. Reassignment only via `Unassigned`, reason required. |
| AD-18 | Visual workflow representation | **MUI `Stepper` on the incident detail view plus a status-grouped board on the Admin/Engineer dashboard.** Drag-to-transition only once AD-17 is enforced server-side. |
| AD-19 | Dashboards | **`reports` service: `/summary` (any role, visibility-scoped), `/hotspots`, `/timings`, `/attention` (admin); SQL aggregates; `status` filter instead of a time window; time to assign, time to acknowledge (first `open → in_progress`), and time to resolve, all from history and measured from creation; "informed" pinned for the frontend; no caching.** |
| AD-20 | Priority and escalation | **`Low/Medium/High/Critical`; `requested_priority` (employee, immutable) + `priority` (admin-set). Escalation = employee request an admin grants or declines, held in one `escalation_status` field on `incidents`; reason required and posted as a note; latest request only; no automatic effect; pending requests shown on the admin dashboard via polling.** |
| AD-21 | Registration and roles | **Self-registration creates Employees only** (exact `acme.inc` domain match, server-side; no email verification). Admins promote users to Engineer (by creating the profile) or Admin. First admin seeded by `_migrate` from Terraform variables. `users.role` + one-to-one `engineer_profiles`. Demotion auto-unassigns active tickets. |
| AD-22 | Facility hierarchy | **Three tables** (`buildings`, `floors`, `seats`); incident has required `building_id`, optional `floor_id`, optional `seat_id` (needs a floor), kept consistent by composite FKs. Soft delete via `archived_at`. No seat occupants. |
| — | Auth sequencing | **Authentication and authorization are built before the CRUD they protect**, not retrofitted afterwards. Milestones M3–M4 in `README.md`. |
| — | Backend language | Python (mandated by the requirements + recommended by the guides) |
| — | Frontend | React + Material UI + React Responsive (mandated) |
| — | IaC / deploy | Terraform + shell scripts in `bin/` (provided) |

> **Domain guard.** This is an **incident ticketing (service-desk)** application — employees report facility and technology issues, admins dispatch them, engineers resolve them. It is not a project-planning tool (no backlogs, sprints, or story points) and not a banking application. No accounts, balances, deposits, withdrawals, or monetary rules belong anywhere in it. Reference material from that domain may be borrowed for document *structure* only, never for domain logic or security posture.

Everything else of consequence is still open — see
[Pending architecture decisions](#pending-architecture-decisions).

## Architecture

```
Client Browser
  |- UI requests  -> CloudFront (local :3000) -> S3 static site (local :4556, LocalStack)
  \- API requests -> Lambda Function URL, one per backend service (local :3001)
                       \- Aurora PostgreSQL (local :5432)
```

Facts that shape every backend decision, from `infra/lambda.tf`:

- **There is no API Gateway.** Each service gets its own **Lambda Function URL**
  (`create_lambda_function_url = true`). Terraform outputs `api_base_url`, `api_endpoints`,
  and `lambda_urls`.
- **`cloudfront.tf` already routes `/api/<service>*` to each Function URL** — one
  `ordered_cache_behavior` per service, `Managed-CachingDisabled`, and
  `Managed-AllViewerExceptHostHeader` (which forwards cookies). **The SPA and the API are
  one origin in the browser**, so browser traffic never triggers CORS. This is the most
  useful thing in the provided infrastructure and no workshop guide mentions it.
- **`authorization_type` ships as `"NONE"` — we change it to `"AWS_IAM"`** and add a
  CloudFront OAC so only the distribution can invoke a Function URL (AD-08b).
- **`Authorization` is reserved for the OAC SigV4 signature.** The access token travels in
  **`X-Access-Token`** (AD-08c). Handlers must never look for a Bearer token in
  `Authorization`.
- **The Function URL `cors` block is vestigial** once traffic is same-origin. It reads
  `allow_origins = ["*"]`, `allow_credentials = false`, which would have foreclosed cookies
  had anything actually talked to the origin cross-origin. Nothing does.
- Each service has an **SQS dead-letter queue** (`dead_letter_target_arn`).
- CloudWatch log retention is **7 days**.
- The distribution is created only outside LocalStack
  (`data.aws_caller_identity.this.id != "000000000000"`), so local dev needs a Vite proxy to
  reproduce the same-origin shape.
- **SPA deep links and API 404s are handled separately (fixed 2026-09-24).** The scaffold's
  distribution-wide `custom_error_response` (404 → 200 `/index.html`) applied to `/api/*` too,
  so an API 404 came back `200 text/html` — breaking the AD-12 envelope — and never fired for
  deep links anyway, since S3 behind the OAC answers a missing key with `403`, not `404`.
  Replaced with `aws_cloudfront_function.spa_rewrite` (`infra/spa-rewrite.js`), a viewer-request
  function on the default S3 behavior only: it rewrites extension-less, non-`/api/*` paths to
  `/index.html`. Cloud only (count-gated with the distribution); LocalStack unaffected. See
  README → Known defects.

## Repository layout

```
backend/
  _examples/{python,java,nodejs}-service/   # templates - copy, never edit in place
  <service-name>/                           # your services live here (see discovery rules)
bin/                                        # setup-*, start-dev, deploy-*, generate-env, cleanup-environment
data/_examples/python-job/                  # data-engineer track, not used here
docs/                                       # README, validation, full-stack + other role guides
frontend/
  src/{pages,components,services}/          # prescribed structure (currently .gitkeep only)
  .env.sample  eslint.config.js  vite.config.js  package.json
infra/                                      # lambda.tf, rds.tf, s3.tf, cloudfront.tf, documentdb.tf,
                                            # eks.tf + helm/ (other tracks), variable.tf, output.tf
```

### Backend service discovery rules (Terraform)

- A service is a folder **exactly one level** under `backend/` containing
  **`requirements.txt`** (Python), `package.json` (Node), or `pom.xml` (Java).
- **Discovery is by `requirements.txt`, not `function.py`** — `backend/README.md` says
  `function.py` and is wrong (`infra/locals.tf`, `backend_dirs_python`). A folder with
  `function.py` and no `requirements.txt` is **silently skipped**: no error, no warning, it
  just never deploys. `function.py` still has to exist, because the handler is
  `function.handler`.
- Folders prefixed with `_` or `.` are **ignored** — that is why `_examples/` never deploys,
  and why `backend/_shared/` is a safe home for shared code.
- `backend/group/my-service/` is **too deep** and will not deploy.
- Packaging zips one service directory only. **A sibling `backend/_shared/` is not in any
  bundle, and local hot-reload does not use the bundle at all.** See AD-02 — this is subtler
  than it looks.

## Commands

```sh
source ~/.bashrc            # always, in a fresh shell

./bin/start-dev.sh          # start/restart the whole local stack
./bin/deploy-backend.sh     # deploy Lambdas + infra
./bin/deploy-frontend.sh    # deploy S3/CloudFront
./bin/generate-env.sh       # regenerate frontend/.env.local from Terraform outputs
./bin/cleanup-environment.sh  # DESTRUCTIVE - tears down all AWS resources

./bin/sync-shared.sh        # after editing backend/_shared (also run by start-dev/deploy-backend)

# New service
cp -R backend/_examples/python-service backend/<service-name>
./bin/start-dev.sh          # REQUIRED after adding a service
```

Docs sometimes write `../bin/...` because they assume you are in a subdirectory. Adjust to cwd.

### Manual verification

```sh
curl -X GET https://localhost:3001/api/<service-name> -H "Content-Type: application/json"

AWS_ENDPOINT_URL="http://localhost.localstack.cloud:4566" \
  aws logs tail /aws/lambda/<function-name> --follow --format short --color on

# Cloud; function name looks like coding-workshop-<service>-abcd1234
curl -X GET https://{API_BASE_URL}/api/<service-name> -H "Content-Type: application/json"
aws logs tail /aws/lambda/<function-name> --follow --format short --color on
```

## Backend conventions

**Never edit `backend/_examples/`** — copy it out first.

**Do not copy-paste across services.** Reuse is graded directly. Shared code lives in
`backend/_shared/` and is **vendored into each service directory by a prebuild step**
(AD-02, decided) — the vendored copies are gitignored, so `_shared/` stays the only copy in
git. Never hand-edit a vendored copy; edit `_shared/` and re-run the sync. Remember to
reconcile each service's `requirements.txt` with what the shared code imports.

### Environment variables (injected automatically — never hardcode)

| Variable | Local | Cloud |
| --- | --- | --- |
| `IS_LOCAL` | `true` | `false` |
| `POSTGRES_HOST` | `172.17.0.1` (Docker bridge; Linux) | Aurora endpoint |
| `POSTGRES_PORT` | `5432` | `5432` |
| `POSTGRES_NAME` / `_USER` / `_PASS` | `postgres` / `postgres` / `postgres123` | Aurora values |

Source: `infra/locals.tf` `env_vars`. All are always injected, so read them with
`os.environ[...]` and let a missing one fail loudly — never supply a fallback.

Branch on `IS_LOCAL`: local PostgreSQL runs **without SSL**; when `IS_LOCAL` is `false`,
add `sslmode=require` for Aurora.

> **The example's `PG_CONFIG` in `backend/_examples/python-service/function.py` does not do
> this**, and it falls back to `test/test/test` credentials. Both must be fixed in any
> service you derive from it, or cloud deploys will fail.

DB driver in the example is `psycopg[binary]==3.2.3` (psycopg **3**). Drop `pymongo` from
`requirements.txt` in every service you create.

## Frontend conventions

React 19 + Vite. `src/{pages,components,services}` is the prescribed structure.
ESLint config at `frontend/eslint.config.js` — keep it clean.

**Read env vars as `import.meta.env.VITE_*`.** `frontend/.env.sample` only lists
`REACT_APP_*` names, which Vite does not expose. `bin/generate-env.sh` writes **both**
prefixes into `.env.local`:

```
VITE_API_URL          # api_base_url in the cloud; "" under LocalStack (infra/output.tf) — corrected 2026-09-23
VITE_API_ENDPOINTS    # JSON map from Terraform output api_endpoints
VITE_LAMBDA_URLS      # JSON map service -> Lambda Function URL
```

- Responsive and accessible across common screen sizes; consistent typography, spacing,
  color, and interaction states.
- Explicit loading / success / failure states for every async action.
- Validate before submit; errors beside the relevant field; block submit until valid;
  disable the form while in flight.
- Hide or disable actions the current role cannot perform.

**Reproducible installs (fixed 2026-09-24).** `frontend/package-lock.json` is now tracked
(`.gitignore` un-ignores only that one lock file); `bin/start-dev.sh` runs `npm ci` when the
lock exists, `npm install` otherwise. Previously the lock was gitignored outright and
re-resolved on every fresh machine — different dependency versions on every clone.

## API contract

| Method | Endpoint | Success status |
| --- | --- | --- |
| POST | `/<service-name>` | 201 Created |
| GET | `/<service-name>` | 200 OK |
| GET | `/<service-name>/{id}` | 200 OK |
| PUT | `/<service-name>/{id}` | 200 OK |
| DELETE | `/<service-name>/{id}` | 204 No Content |

Errors: `400` validation/malformed, `404` not found, `500` server or database error.
Extended by AD-12 with `401`, `403`, `405`, `409` — see AD-12 for the envelope and code table.

- RESTful methods, JSON responses, one consistent error envelope everywhere.
- Query-parameter filtering where it makes sense (required — search and filter is a feature).
- Validate before persistence: required fields present and non-empty, types and formats
  correct, referenced entities exist, duplicate constraints enforced.
- Error messages must say *what* failed.
- A failed operation must not leave data inconsistent.

## Auth & RBAC

Authentication first, authorization second. Centralize permission checks — do not scatter
role conditionals through handlers. Function URLs are unauthenticated at the edge, so the
handler is the **only** enforcement point.

- **RS256 JWT.** The access token arrives in **`X-Access-Token`** — never `Authorization`,
  which CloudFront's OAC SigV4 signature occupies. A handler reading `Authorization` for a
  Bearer token will find a signature and reject every request.
- **The refresh token arrives as an httpOnly cookie**, only on `/api/auth/refresh`. No other
  endpoint should read cookies.
- bcrypt password hashes, access-token expiry in minutes, rotating refresh tokens with reuse
  detection.
- Middleware/decorator enforces authentication before any CRUD operation.
- **Roles are the three personas** — Employee, Facility Admin, Engineer. The
  Admin/Manager/Contributor/Viewer table in `docs/full-stack.md` is a generic example, not
  this app's model; do not implement it. See AD-09 and AD-21.
- Authorization is role **and** ownership: an Employee sees their own incidents, an Engineer
  their assigned ones, an Admin everything.
- Block privilege escalation; return a consistent "access denied" shape.

## Testing

| Layer | Coverage target |
| --- | --- |
| Backend code | 80%+ |
| Frontend code | 80%+ |
| API endpoints (CRUD) | 90%+ |
| Validation / error paths | 90%+ |
| Critical user paths (E2E) | 100% |

- **Backend:** unit tests for handlers in isolation; integration tests against a real
  database; explicit error-handling tests per CRUD operation.
- **Frontend:** component tests with React Testing Library; API service tests with mocked
  responses; E2E for core journeys.
- **Performance:** load-test endpoints (Artillery or JMeter); watch response times.
- Document test commands, results, and known gaps — graders read these.

## Evaluation — what graders look for

Five technical competencies (Implementation, Design, Code, Testing, Experience) and three
soft skills (Curious, Observant, Driven), each 1–10; final score averages the two halves.
9+ Excellent · 7+ Good · 5+ Satisfactory · below 5 Incomplete.

- **Modular code organized by feature/domain**, not monolithic files.
- **Reuse over copy-paste.**
- Consistent naming, formatting, linting.
- Works in **both** local and cloud; deployment reproducible with verifiable output.
- **README explains architecture, trade-offs, and assumptions** — this is where stated
  scope cuts earn points instead of losing them. Keep it current as you go.
- Edge cases and error handling in **both** layers.

---

## Pending architecture decisions

Open decisions, ordered by how much downstream work they block. Each has a recommendation,
but **none is settled until confirmed** — record the outcome here and in the README.

**Status key:** `OPEN` · `DECIDED` · `DEFERRED`

| ID | Decision | Status |
| --- | --- | --- |
| AD-00 | Database engine | **DECIDED — PostgreSQL** |
| AD-01 | Service decomposition | **DECIDED — domain split, five services** |
| AD-02 | Shared-code packaging | **DECIDED — vendor `_shared/` into each service** |
| AD-03 | Schema ownership and migrations | **DECIDED — private migrate Lambda, numbered SQL** |
| AD-04 | DB access layer and connection reuse | **DECIDED — raw psycopg 3, module-scope connection** |
| AD-05 | Intra-Lambda routing | **DECIDED — hand-rolled router in `_shared/`** |
| AD-06 | URL/base-path convention and frontend API client | **DECIDED — same-origin `/api`, one fetch wrapper** |
| AD-07 | Auth mechanism and placement | **DECIDED — RS256 JWT + rotating refresh tokens** |
| AD-08 | Browser token storage, origin sealing, token transport | **DECIDED** |
| AD-09 | RBAC enforcement model | **DECIDED — JWT role claim, closed-by-default routes, SQL-filtered ownership** |
| AD-10 | Frontend dependency set | **DECIDED — mandated libraries plus the minimum** |
| AD-11 | Test stack | **DECIDED — pytest, Vitest + RTL, Cypress; enforced thresholds** |
| AD-12 | Error envelope and validation approach | **DECIDED — one envelope, fixed codes, Pydantic v2, single wrapper** |
| AD-13 | Search, filter, and pagination design | **DECIDED — server-side filters, page/limit, allow-listed sort** |
| AD-14 | Real-time and async scope | **DECIDED — short polling** |
| AD-15 | PWA and AI-integration scope | **DECIDED — out of scope** |
| AD-16 | Observability and structured logging | **DECIDED — JSON lines, access log, correlation id** |

Domain-specific, from the facility-incident problem statement:

| ID | Decision | Status |
| --- | --- | --- |
| AD-17 | Incident state machine and transition authority | **DECIDED — admin any, engineer forward + unblock, employee none** |
| AD-18 | Visual workflow representation | **DECIDED — stepper + status board** |
| AD-19 | Dashboard and reporting strategy | **DECIDED — `reports` service, SQL aggregates, two history timings** |
| AD-20 | Priority and escalation model | **DECIDED — requested + working priority; escalation request fields** |
| AD-21 | Registration, `acme.inc` email restriction, and persona assignment | **DECIDED — Employee-only registration, promotion, seeded admin** |
| AD-22 | Facility hierarchy modelling | **DECIDED — three tables, composite FKs, soft delete** |

### AD-01 · Service decomposition

How many Lambdas, and along what seams? Candidates: one per entity (`incidents`,
`facilities`, `engineers`, `notes`, `auth`) · a single `api` service · a hybrid (`auth` and
`incidents` split out, the rest together).

Note that `notes` are always accessed in the context of an incident, and `engineers` are
closely tied to assignment — those two are the most defensible merge candidates.

- **Constraint:** Terraform discovers only folders one level under `backend/`, packages each
  separately, and gives each its own Function URL. More services means more bundles, more
  cold starts, and more concurrent connection paths into Aurora.
- **Recommendation:** four or five services along entity lines plus `auth`. The README
  names microservices as a learning objective and Design is a scored dimension; a single
  monolithic handler forfeits that.
- **Blocks:** AD-02, AD-03, AD-06.

#### DECIDED — split by domain (option C)

| Service | Owns | Lands |
| --- | --- | --- |
| `auth` | registration, sign-in, refresh, sign-out, users | M1 (skeleton), M3 |
| `incidents` | incidents, **ticket notes**, status transitions + history, assignment | M5, M7, M8 |
| `facilities` | buildings, floors, seats | M6 |
| `engineers` | engineer profiles | M7 |
| `reports` | read-only per-persona aggregates | M10 — not created before then |

- **Notes live in `incidents`.** Every notes permission check reduces to "can this user
  see the parent incident?", so a separate service would duplicate the ownership check
  AGENTS.md identifies as the likeliest privilege-escalation leak. Notes keep their own
  table (`ticket_notes`, FK to `incidents`), validation model, and tests — separate
  entity, not separate deployment.
- **Nested routes:** `/api/incidents/{id}/notes[/{noteId}]`. Same status codes as the API
  contract; the path shape is a stated deviation from its flat `/<service>/{id}`, to be
  documented in the README.
- **Assignment lives in `incidents`** — it mutates an incident and is a workflow transition
  under AD-17; engineer existence is enforced by FK, not a service call.
- **One shared database.** These are separately deployed modules over a shared schema, not
  database-per-service microservices. Cross-entity reads are SQL joins, never
  service-to-service calls.
- **Naming rule:** CloudFront behaviours are `/api/<service>*` with no trailing slash, so no
  service name may be a prefix of another.
- **Rejected:** one-service-per-entity (duplicated ownership checks for `notes`); a single
  `api` service (forfeits the domain-modularity Design is scored on).

#### Ticket notes — settled rules

Resolves the ambiguities AD-01 left open. Recorded here because notes live in `incidents`;
AD-09 and AD-17 point back to this list.

- **Writable on every status except `Closed`.** "Add notes to open incidents" reads as
  *not yet closed*, not *status = `Open`* — otherwise the requester is locked out of the
  conversation the moment an engineer picks the ticket up. `Closed` is read-only.
- **One chronological conversation per incident.** No reply nesting, no `parent_note_id`.
  The M8 word "threaded" means *a thread*, ordered by `created_at`.
- **Soft delete.** A deleted note keeps its row with `deleted_at` / `deleted_by` set and
  its body hidden; the conversation shows that a note was removed. Hard deletion would
  erase the record behind "how effectively are employees informed".
- **The `Blocked` reason is stored twice, with different jobs.** The status-history row's
  `reason` column is the **record** — append-only, never edited or deleted, and what the
  "blocked, and why?" report reads. The transition also posts the reason as a note, which
  is the **notification** — an ordinary note, authored by whoever blocked the ticket.
  Editing or deleting that note never touches the history row, so the two may diverge;
  history wins.
- **Edit and delete authority:**

  | Action | Note author | Facility Admin (not author) | Anyone else |
  | --- | --- | --- | --- |
  | Edit | ✓ own notes only | ✗ | ✗ |
  | Soft-delete | ✓ own notes only | ✓ any note | ✗ |

  Admin deletion is moderation; admins never edit someone else's words. Enforced by the
  shared authorization helper (AD-09), not inline in the handler.
- **Decided at M8 (2026-09-23):** edits are **visible** — `edited_at` is set and returned so
  the UI can mark a note "edited"; a silently rewritten note could change the meaning of a
  thread after it was answered. **Admins may soft-delete notes on `closed` incidents** — the
  one exception to "closed is read-only", because moderation (personal data, abuse) does not
  stop mattering when a ticket closes; authors cannot edit or delete on a closed incident.
- **M8 details:** notes are created only as `comment` through the API (the other kinds come
  from transitions and escalation); 5,000-character limit; a deleted note stays in the
  list as a placeholder (`body: null`, `deleted_at`, `deleted_by`); history-backed kinds are
  edited and deleted like any note (AD-17: the history row keeps the reason).
- **Built 2026-09-23 (M8).** `backend/incidents/notes.py`, registered by `function.py` with
  `register(router, load)` — the loader returns a typed `Incident` (or `404`), so notes reuse
  the incident's visibility check and never depend on the incidents row layout or import
  `function.py` (no circular import). Adding a note locks the incident, so a note cannot
  slip in while another request closes it. 367 tests, 100% (`notes.py` included). Live:
  reporter and engineer post 201, engineer editing the reporter's note 403, reporter edit
  200 (marked edited), admin moderation delete 204, thread shows the placeholder.

### AD-02 · Shared-code packaging

Reuse is a scored criterion. The packaging boundary is the service folder. Those two pull
against each other, and the reason is worth understanding precisely, because the obvious fix
works in the cloud and breaks locally.

#### What the Terraform actually does

`infra/locals.tf` discovers services and `infra/lambda.tf` packages them:

```hcl
backend_dirs_python = [
  for file in fileset(".../backend", "*/requirements.txt") :
  dirname(file) if !startswith(dirname(file), "_") && !startswith(dirname(file), ".")
]
```

Three consequences, each load-bearing:

1. **Discovery is by `requirements.txt`, not `function.py`.** `backend/README.md` claims
   `function.py` and is wrong for Python; its Node (`package.json`) and Java (`pom.xml`)
   rows are correct. A folder with `function.py` and no `requirements.txt` never enters
   `function_names`, so no Lambda is created — **silently, with no error or warning.**
   `function.py` must still exist, since `handler = "function.handler"`; it just has no
   role in discovery.

   Two qualifiers, so this is not overstated: **an empty `requirements.txt` is enough**
   (`fileset` tests existence, not content, so `touch requirements.txt` is the fix), and
   `cp -R` from `_examples/python-service` carries one already. The trap springs only when
   a service directory is hand-created, or when someone deletes `requirements.txt` because
   the service genuinely has no third-party dependencies — which is a reasonable thing to
   believe you can do.
2. **`_`-prefixed directories are excluded from discovery.** So `backend/_shared/` will
   never be mistaken for a service. That is what makes it a usable home for shared code —
   the underscore is a feature here, not the obstacle.
3. **`source_path` is a single-element list** built from `each.value.path`, which points at
   one service directory. Nothing else is in the zip.

#### The option that looks right and isn't

The module is `terraform-aws-modules/lambda/aws ~> 8.0`, whose `source_path` accepts a
**list** of objects with `path`, `prefix_in_zip`, `patterns`, and more. So adding shared
code to every bundle looks like a three-line change:

```hcl
source_path = [
  { path = each.value.path, pip_requirements = true, patterns = ... },
  { path = abspath("${path.module}/../backend/_shared"), prefix_in_zip = "shared" },
]
```

**That works in the cloud and fails locally**, because local development does not use the
built zip at all. `null_resource.hot_reload` in `lambda.tf` does this:

```
aws lambda update-function-code --s3-bucket hot-reload --s3-key ${each.value.path}
```

`hot-reload` is LocalStack's magic bucket: the S3 key is an **absolute path on disk**, and
LocalStack mounts that directory as the function's code. So locally the Lambda runs
`backend/<service>/` straight from the filesystem, and anything Terraform would have added
to a zip is simply not there. The symptom is `ModuleNotFoundError: No module named 'shared'`
in LocalStack only, against infrastructure that is demonstrably correct in AWS — which is a
genuinely nasty afternoon.

#### DECIDED — vendor it

**Copy `backend/_shared/` into each service directory as a prebuild step.** Physical
presence is the only thing that satisfies both paths — the zip builder sees the files, and
the hot-reload mount sees them too, because they are really on disk inside the mounted
directory.

- Hook it into `bin/start-dev.sh` and `bin/deploy-backend.sh`, or a small `bin/sync-shared.sh`
  the two call. Verify the hook point before writing it.
- **Built 2026-09-23:** `bin/sync-shared.sh` copies `_shared/*.py` into
  `backend/<svc>/shared/` for each discovered Python service **and `_migrate`** (a Lambda
  outside discovery). Called by `start-dev.sh` every start and by `deploy-backend.sh`
  before `terraform apply` in both `local` and `aws` modes. Vendored into a `shared/`
  subfolder, not the service root, because the service-dir `.gitignore` allow-list tracks
  top-level `*.py`; `/backend/*/shared/` is ignored. The script **fails** if any line of
  `_shared/requirements.txt` is absent from a target's `requirements.txt` — it checks,
  never edits tracked files. Contents so far: `db.py` (AD-04 helper: `conn_str`,
  `get_conn`, `reset_conn`). Verified locally: hot-reload import in `auth`, Terraform-zipped
  import in `_migrate`, the missing-dependency guard.
- **Gitignore the vendored copies.** `backend/_shared/` stays the single source of truth in
  version control. Committing N identical copies would recreate, in the diff a grader reads,
  exactly the duplication this exists to avoid.
- Vendored `__pycache__` will not ship — the Python `patterns` are
  `["!__pycache__/.*", "!\\..*"]`.

The Lambda-layer option is not wrong, but it costs new Terraform, a second artifact to
version, and it has the *same* local-dev blind spot, so it buys nothing here.

#### Single-module dependencies break the service-dir allow-list (found 2026-09-23)

`start-dev.sh` pip-installs each service's dependencies into the service dir for
hot-reload. Most land as package *directories*, which the allow-list ignores. But some
install as a single top-level module — `typing_extensions.py`, pulled in by `pydantic` —
and the allow-list (`!/backend/[!_]*/*.py`) tracks every top-level `.py`, and coverage
counts it. Result: the file was committed in `154b817` and the coverage gate fell to 15%.
Fixed in `6d1c9cd` by listing it explicitly in `.gitignore` and `.coveragerc`.

**Automated (2026-09-23).** `bin/pip-ignore.sh <svc>` reads every `*.dist-info/RECORD`
pip wrote into the service dir and generates `backend/<svc>/.gitignore` listing each
top-level installed name (itself ignored by the root rule, never committed).
`start-dev.sh` runs it after every install *and* on the skip path. Git reads it
natively; coverage reads it through a configurer plugin in
`tools/coverage-pip-omit/`, installed into `.venv` by `requirements-dev.txt` — it has to
be an installed package because pytest-cov starts coverage before pytest adds `backend/`
to the import path (a plugin under `backend/` failed with `ModuleNotFoundError`). The
manual `typing_extensions.py` entries were removed. Proven both ways: without the
generated file, git shows the module untracked and coverage drops to 15.45%; with it,
nothing untracked and 100%.

#### The second duplication axis, which is easy to miss

`pip_requirements = true` means each service's **own** `requirements.txt` drives its pip
install. Shared code's dependencies therefore have to be listed in every service that
imports it — `PyJWT`, `cryptography`, `psycopg`, and so on. Vendoring the code without
syncing the requirements produces an import error at runtime rather than at build time. If
the sync script copies the code, it should reconcile the requirements too.

#### Budget note

`memory_size = 128` and `timeout = 300` are set in `lambda.tf`. 128 MB is tight once
`psycopg`, `bcrypt`, and `cryptography` (which RS256 verification needs) are in the bundle.
This is independent evidence for AD-07c: argon2id at 128 MB would be actively painful, since
its whole design is to consume memory.

**The four things that must not be duplicated**, whatever mechanism carries them: token
verification, the DB connection helper, the error envelope, and the validation models.

### AD-03 · Schema ownership and migrations

Nothing in the repo creates tables. Terraform provisions Aurora; the schema is on you.

- **Options:** idempotent `CREATE TABLE IF NOT EXISTS` on cold start (simple, but races
  across N Lambdas and scatters DDL) · one owning migration service or `bin/` step invoked
  at deploy · Alembic · SQL executed from Terraform.
- **Recommendation (superseded, see below):** a single `schema.sql` owned by one place and
  applied by a deploy step. Do not let each service create its own tables.
- **Two tables are fixed by decisions already taken and must be in the first schema, not
  added later:** the incident status-history table (AD-17 — it cannot be backfilled) and
  `refresh_tokens` (AD-07d — rotation needs server-side state from the first sign-in).
- **Depends on:** AD-01.

#### DECIDED — private migrate Lambda, invoked by Terraform; numbered SQL files

**The constraint that decided it:** the Aurora instance in `infra/rds.tf` does not set
`publicly_accessible` (default `false`), and every Lambda sits in the VPC
(`infra/lambda.tf:27-28`). So `psql` from the VDI almost certainly cannot reach cloud
Aurora — inferred from Terraform, **unverified until the first cloud deploy**. Only
something inside the VPC can apply the schema.

**What runs migrations**

- **`backend/_migrate/`** — the `_` prefix keeps it out of service discovery, so it gets
  **no Function URL and no CloudFront behaviour**. It is unreachable from the internet;
  only an IAM-authenticated invoke can run it.
- **`infra/migrate.tf`** declares it explicitly: same VPC subnets, security groups, and
  `POSTGRES_*` / `IS_LOCAL` env vars as the services, **no `create_lambda_function_url`**.
- **`aws_lambda_invocation`** in the same file runs it during `terraform apply`, with a
  trigger on a hash of `_migrate/migrations/` so any new or changed file re-invokes it. A
  failed migration fails the apply — a deploy never completes against a schema it does
  not match.
- **One place:** SQL, runner, and trigger live in `_migrate/` + `migrate.tf`. No service
  creates, alters, or drops tables.

**Format**

- `backend/_migrate/migrations/NNN_description.sql`, applied in numeric order.
- A `schema_migrations(version, checksum, applied_at)` table records what has run.
- Each file runs in its own transaction; the runner holds `pg_advisory_lock` for the whole
  run so two applies cannot interleave.
- **Never edit an applied file.** A changed checksum on an applied version stops the run
  with an error rather than silently skipping.
- **Forward only.** No down migrations; a reversal is a new forward file.
- A read-only `schema.snapshot.sql` (`pg_dump --schema-only`) is regenerated after each
  migration for reading. It is never applied.

**Rejected:** cold-start `CREATE TABLE IF NOT EXISTS` (DDL scattered across services, races
on concurrent cold starts); `bin/` + `psql` (works locally, cannot reach cloud Aurora);
a discoverable `backend/migrate/` service (gets a public Function URL and CloudFront
route, guarded only by handler logic); one idempotent `schema.sql` (`IF NOT EXISTS` skips
existing tables, so it can never alter one without data loss — fatal for the status-history
table); Alembic (its value is autogeneration from SQLAlchemy models, which AD-04 is not
expected to use).

**Consequences to absorb at M2**

- **Local:** `start-dev.sh` skips `terraform apply` when the backend is already deployed,
  so a new migration applies locally only after
  `source ENVIRONMENT.config && ./bin/deploy-backend.sh local` — the `source` is required
  (see `README.md` → Known defects).
- **`start-dev.sh`'s pip loop now skips `_`-prefixed dirs** (resolved 2026-09-23).
  `_migrate` is not hot-reloaded; Terraform's module packages it with its own pip install.
- **AD-02:** the shared DB helper must be vendored into `_migrate/` too; the sync step
  must include it explicitly, since `_` dirs are not services.
- **AD-01 is unchanged:** `_migrate` is infrastructure, not a sixth service.
- **Verified locally (2026-09-23)**, with throwaway migrations since removed:
  - `aws_lambda_invocation` runs the Lambda during `apply` on LocalStack; a good migration
    applied once and was recorded with its checksum; a re-run applied nothing.
  - A failing migration **fails `terraform apply`** (deploy exit `1`) with PostgreSQL's
    error in the Terraform output; its row is not recorded, and a table it created earlier
    in the same file was rolled back.
  - Editing an applied file fails the deploy: `… was edited after being applied`.
  - No Function URL (`GetFunctionUrlConfig` → `ResourceNotFoundException`), absent from
    the proxy's endpoint map, same `POSTGRES_*` env as the services.
- **Still unverified — cloud only:** that `_migrate` reaches Aurora through the VPC
  (LocalStack returns no subnets for any function, services included), and that
  `psql` from the VDI really cannot reach Aurora.
- **Seeding the first Facility Admin (AD-21) is built (2026-09-23).** `_seed_admin` runs
  here, inside the same advisory lock and transaction as the migrations above, after they
  apply — table designs for it were decided below, in `001_init`. See AD-21's implementation
  note for behaviour and local verification.

**Demo data is seeded through the public API, not SQL (decided 2026-09-24, user's call).**
`tools/seed_demo.py` — stdlib-only Python, outside every Lambda bundle — signs in as an admin
and drives the same `auth`/`incidents`/`facilities`/`engineers` endpoints a real user would,
so every demo row obeys the business rules the API enforces rather than bypassing them.
**Rejected: a backdated SQL seed.** It would skip `workflow.py`/`policy.py` validation and,
being outside `_migrate`, could only reach cloud Aurora by adding a second private Lambda for
one-off data — and any direct write would appear in `schema_migrations`' history as
production data rather than what it is. Creates 3 engineers + 4 employees (`demo.*@acme.inc`),
3 buildings with floors and seats, and 18 incidents across every status — two blocks with
reasons, a reassignment through `Unassigned`, and escalations pending, granted, and declined.
Idempotent: people, places, and incident titles are reused on re-run. Verified locally
(2026-09-24): 18 created, a re-run created 0, `#59`'s history showed the full reassignment
path. **Not yet run in the cloud** — the user runs it there with their own admin password.
Caveat: every move happens within seconds, so seeded timings read in seconds, not the spread
a manual demo would show.

#### Schema decisions for `001_init` (2026-09-23)

- **Categories: fixed list, DB-checked** — `electrical`, `plumbing`, `hvac`, `cleaning`,
  `furniture`, `access_security`, `network`, `hardware`, `software`, `other`. No
  categories table; changing the list is a one-line migration. Answers "most common
  facility and technology issue categories".
- **Incidents are soft-deleted, admin only** — `deleted_at` + `deleted_by`; hidden from
  every list, history and notes kept. Satisfies CRUD `DELETE` without destroying report
  data.
- **Engineer availability is an explicit flag** — `engineer_profiles.is_available`,
  toggled by the engineer or an admin (leave, absence). Answers "which engineers are
  available"; workload is reported separately from open assignments.
- **Notes carry a `kind`** — `comment`, `blocked`, `escalation`, `unassigned`. Makes the
  notes AD-17 and AD-20 treat as records (blocked reason, escalation reason, reassignment
  reason) identifiable by query.
- **Codes, not labels, in the DB** — statuses `unassigned`, `open`, `in_progress`,
  `blocked`, `resolved`, `closed`; priority `1..4` = Low..Critical. Labels belong to the API
  and UI.
- **`TEXT` + `CHECK`, not PostgreSQL `ENUM`** — extending a `CHECK` is an ordinary
  migration; `ALTER TYPE … ADD VALUE` has transaction restrictions.
- **`BIGINT` identity keys** — readable (`INC-42`); enumeration is harmless because every
  read is ownership-checked (AD-09).
- **Refresh tokens stored as sha256** — high-entropy random values cannot be brute-forced
  like passwords, and lookup needs a deterministic hash, which bcrypt's salt prevents.
- **FK violations must map to `400`, not `500`** (for AD-12): the service validates
  locations first for a precise message; the composite FKs are the backstop, and PostgreSQL
  `23503` reaching the error handler means a caller error the service missed.

### AD-04 · DB access layer and connection reuse

The example (`postgres_service.py`) uses raw `psycopg` 3 with a module-scope `PG_CONN`,
reused across warm invocations and reset to `None` on error. No pool library.

- **Options:** raw psycopg3 with a module-scope connection reused across warm invocations
  (plus stale-connection recovery) · `psycopg_pool` · SQLAlchemy Core · SQLAlchemy ORM.
- **Also decide:** whether Aurora connection limits need RDS Proxy under load testing.
- **Recommendation:** raw psycopg3, module-scope lazy connection, reconnect on failure.
  SQLAlchemy Core if the query surface grows past simple CRUD.
- **Must fix regardless:** add the `sslmode=require` branch on `IS_LOCAL`, and remove the
  `test/test/test` credential fallbacks. *(Done in `backend/auth/db.py` at M1.)*

#### DECIDED — raw psycopg 3, the example's connection pattern

- **Driver:** `psycopg[binary]==3.2.3`, the example's pin, built for `cp313` (see
  Known defects in `README.md`).
- **Connection:** one module-scope connection per warm container, opened on first use,
  reused while open, set to `None` on any error so the next invocation reconnects. A
  Lambda container handles one request at a time, so a pool buys nothing — each
  container would only ever check out one connection.
- **Credentials:** `os.environ[...]`, no fallbacks; `sslmode=require` unless `IS_LOCAL`.
- **Location:** the helper moves from `backend/auth/db.py` into `backend/_shared/` and is
  vendored per AD-02, including into `_migrate/` (AD-03). One copy in git.
- **Queries are always parameterized** (`cur.execute("... WHERE id = %s", (incident_id,))`),
  never built with f-strings or `%` formatting. With no ORM, this rule is the whole
  SQL-injection defence.
- **Rejected:** `psycopg_pool` (no concurrency inside a container to pool for);
  SQLAlchemy Core/ORM (a second abstraction to learn and defend, for a CRUD surface plain
  SQL handles; it would also have been the only reason to prefer Alembic in AD-03).
- **Deferred to load testing (M13):** RDS Proxy. Connections scale with warm containers ×
  services; only a load test shows whether Aurora's limit is near.
- **Verify in cloud:** Aurora Serverless v2 is configured with `min_capacity = 0.0`
  (`infra/rds.tf`), so it can pause when idle; resuming takes seconds, and the first
  connection may hit `connect_timeout=15`. Watch for it on the first cloud request.
- **Multi-row writes run in one transaction** (`with conn.transaction():`) — a status
  change + its history row, a block + its note, any write touching more than one row.
  The connection stays `autocommit=True`, so single statements commit alone and a
  forgotten transaction never holds a lock open across invocations; the explicit block is
  what makes a group all-or-nothing. Without it, a failure between the two writes leaves
  an incident with no history row and the dashboards silently wrong. This is what the API
  contract's "a failed operation must not leave data inconsistent" requires in practice.

### AD-05 · Intra-Lambda routing

Function URLs hand the whole path and method to one handler; there are no gateway routes.

- **Options:** hand-rolled dispatch on `event["requestContext"]["http"]["method"]` and
  `rawPath` · AWS Lambda Powertools resolver · FastAPI + Mangum · Flask + aws-wsgi.
- **Recommendation:** AWS Lambda Powertools for Python — routing, request validation, and
  structured logging in one dependency, which also answers part of AD-12 and AD-16.
  Hand-rolled is defensible if bundle size or cold start matters more.
  *(Superseded below.)*

#### DECIDED — hand-rolled router in `_shared/` (2026-09-23)

- **A small router of our own**, vendored per AD-02: a route table of
  `(method, pattern like /incidents/{id}/notes) → handler`, path parameters extracted by
  the pattern, pure function `route(method, path) → (handler, params)` testable without an
  event or AWS.
- **Contract:** unknown path → `404`; known path, wrong method → `405` with an `Allow`
  header; an optional leading `/api/<service>` prefix and duplicate slashes are normalised
  before matching, so the same table works behind CloudFront (full path) and behind the
  local dev proxy (prefix stripped). Unknown routes fall through to `404`, never to a
  partial match.
- **Why not Powertools:** no library the task does not need (CLAUDE.md §2), nothing to
  learn and defend beyond ~50 lines, zero cold-start or bundle cost at 128 MB. Its extra
  value — validation and structured logging — belongs to AD-12 and AD-16, still open; if
  those favour it later, swapping the router is a contained change.
- **Rejected:** FastAPI + Mangum (a full web framework per Lambda, heaviest cold start);
  Flask + adapter (thinly maintained adapters).
- **We own the edge cases:** trailing slashes, URL-decoding of path segments, base64
  request bodies (`isBase64Encoded`). Each gets a unit test.
- **Path shape, confirmed locally (2026-09-23)** with a temporary `rawPath` log in `auth`:
  through the dev proxy the Lambda receives the path **without** `/api/<service>`
  (`/api/auth/refresh` → `/refresh`; `/api/auth` and `/api/auth/` → `/`); called directly,
  as CloudFront does, it receives the **full** path (`/api/auth/refresh`). The query string
  arrives separately in `rawQueryString`. The predicted `//` from the proxy's URL join does
  not reach the handler — LocalStack collapses it — but the router normalises repeated
  slashes anyway rather than depend on that.
- **Decoding:** LocalStack delivers `rawPath` already percent-decoded (`/a%20b` → `/a b`).
  Whether AWS does is **unverified — check on the first cloud deploy.** The router matches
  on segments first and decodes only captured parameters, once, so a literal `%` is never
  double-decoded.
- **Built 2026-09-23:** `backend/_shared/router.py` (`Router`, `NotFound`,
  `MethodNotAllowed`), with `backend/_shared/tests/test_router.py` — 17 test cases, router at
  100% coverage.
- **Bug found and fixed (2026-09-23): specificity, not registration order.** The first
  implementation tried patterns in registration order and returned on the first match, so a
  param route like `/{incident_id}` registered before a literal route like `/summary` shadowed
  it — `POST /boom` (a later literal route) came back `405` instead of reaching its handler.
  `resolve()` now collects every pattern that matches the path, sorts by specificity (fewest
  captured params first, so a literal segment always beats a `{param}` regardless of
  registration order), and only then checks the method; `405` is raised only once no matching
  pattern has the method, with `Allow` listing the union of methods across every matching
  pattern. Three tests pin this: `test_literal_segment_beats_a_param_regardless_of_registration_order`,
  `test_method_on_a_less_specific_pattern_still_matches`,
  `test_405_lists_methods_from_every_matching_pattern`.

### AD-06 · URL/base-path convention and frontend API client

The docs contradict themselves: the endpoint table says `/<service-name>`, the curl examples
say `/api/<service-name>`. Separately, the frontend can address services two ways.

- **Decide:** the path prefix; and whether the client uses `VITE_API_URL` + path or looks
  the service up in `VITE_LAMBDA_URLS`.
- **Recommendation:** accept both prefixes in the handler router (cheap insurance), and have
  `src/services/` resolve `VITE_LAMBDA_URLS[service]` first, falling back to `VITE_API_URL`.
  Confirm the intended prefix with the organizers.

#### DECIDED — same-origin `/api`, one fetch wrapper (2026-09-24)

- **Relative same-origin URLs** (`/api/<service>/...`), no hostname and no `VITE_*` for the
  API: CloudFront routes `/api/<service>*` in the cloud; locally Vite proxies `/api` →
  `http://localhost:3001` (AD-08 work item 1). The `SameSite=Strict` refresh cookie is sent
  only to the page's own origin, which is why. **Retires** the earlier recommendation to
  resolve `VITE_LAMBDA_URLS` first: those calls are cross-origin (no cookie) and, since
  AD-08b, a direct Function URL call is a `403`.
- **`src/services/http.js` is the only network code:** access token in memory, sent as
  `X-Access-Token`; single-flight refresh (one shared promise — also guards React 19
  StrictMode's double effect at boot); `X-Correlation-Id` per user action; errors parsed into
  `{status, code, message, fields, requestId}`; **`x-amz-content-sha256` = SHA-256 of every
  `POST`/`PUT` body** (proven required through the OAC on the first cloud deploy).

### AD-07 · Auth mechanism and placement

The Function URL ships as `authorization_type = "NONE"`. AD-08b changes that to `"AWS_IAM"`
behind an OAC, but that seals the *origin*, not the *caller* — the handler is still the only
thing that knows who the viewer is.

**DECIDED — self-issued JWT, implemented fully.** A dedicated `auth` service issues signed
tokens on sign-in; every other service verifies them through a shared helper before doing
anything else. Users, roles, and password hashes live in PostgreSQL. Not OAuth, not
Cognito — neither is in the Terraform and both would mean new infrastructure.

This is a required deliverable and is built **before** the CRUD it protects. Specifically,
none of the following counts as satisfying it: a sign-in that compares credentials and
returns a user without a token · a token that is issued but not verified on subsequent
requests · verification in some handlers but not others · a token with no expiry ·
plaintext password storage.

### Settled beneath the decision

**Algorithm — RS256.** The `auth` service holds the private key and is the only thing that
can mint a token; every other service verifies with the public key. This is the right fit
for the topology: with N independently deployed services, HS256 would mean handing every
one of them the ability to forge tokens, so a single over-permissive service becomes a
full compromise. It also collapses the key-distribution problem — **the public key is
public**, so it ships as a plain Lambda environment variable with no protection needed.

**Signing key — AWS Secrets Manager**, holding the private key only.

*Verdict on the "not much setup" condition: it qualifies, and two things make it qualify.*

First, **the IAM grant already exists.** `infra/policy.tftpl` carries:

```json
{ "Effect": "Allow", "Action": ["secretsmanager:*"],
  "Resource": "arn:${partition}:secretsmanager:*:*:secret:${app_name}*${app_id}*" }
```

No policy edit is needed — but the resource pattern is a **naming constraint**: the secret
must be named to match `<app_name>*<app_id>*`, i.e. `coding-workshop-jwt-signing-<app_id>`
or similar. A secret named anything else is denied, and the error will point at
`GetSecretValue` rather than at the name. *Verify in the VDI that this policy is attached to
the Lambda execution role and not only to the deploying principal* — the role is
pre-provisioned outside this Terraform (`create_role = false`), so that is the one part
that cannot be confirmed by reading the repo.

Second, **only the `auth` service needs any of it.** The verifiers read a public key from an
environment variable and never call Secrets Manager. Under HS256 every service would have
needed the secret, the grant, and the fetch, and the answer here would have been no.

The remaining work is two Terraform resources (`aws_secretsmanager_secret`,
`..._secret_version`) and a boto3 fetch cached at module scope.

- Cache the fetched key in a module-level variable. A `GetSecretValue` call on every
  invocation is a latency and cost bug that will not show up in local testing.
- Branch on `IS_LOCAL` the way the rest of the scaffold does: local reads a development
  key from an environment variable, cloud reads Secrets Manager. Do not make local
  development depend on LocalStack's Secrets Manager emulation.
- **Bail-out trigger, so the conditional is falsifiable:** if wiring the IAM grant through
  `policy.tftpl` turns into a fight, fall back to the private key as a Terraform-injected
  environment variable on the `auth` service alone, and record it here as a stated trade.
  Do not spend a day of a timeboxed workshop on secret storage.

**Password hashing — bcrypt**, reading "lighter" as the smaller runtime cost. argon2id is
deliberately *memory-hard* — tens of megabytes per hash by design — which is a direct
tax in Lambda, where memory is provisioned and paid for and cold starts are already the
weak point. bcrypt with a tuned cost factor is the pragmatic pick. Packaging note: the
`bcrypt` wheel is compiled, so it must be installed for the Lambda runtime's platform, the
same constraint that already applies to `psycopg[binary]`.

**Refresh tokens — yes, with rotation on every access-token request.** Each refresh
returns a new access token *and* a new refresh token; the presented one is immediately
invalidated.

- Rotation requires refresh tokens to be **server-side state** — a `refresh_tokens` table
  with a hash of the token, the owning user, an expiry, a revoked flag, and a family id.
  This is a schema consequence: it belongs in M2, not bolted on at M3.
- Store a **hash** of the refresh token, not the token. The table is otherwise a list of
  live credentials.
- **Implement reuse detection.** Rotation's whole value is that a stolen refresh token
  becomes detectable: if an already-rotated token is presented, the legitimate holder and
  the thief now both have one, so revoke the entire family rather than just that token.
  Rotation without reuse detection is bookkeeping, not a security control.
- Access tokens stay short-lived (minutes). Refresh tokens are long-lived and revocable —
  that split is the reason for having two.

**Depends on:** AD-02 (the verify helper is shared code — the failure mode is one service
verifying slightly differently from the rest, invisible until exploited), AD-03 (the
`refresh_tokens` table), AD-08 (where the browser keeps them).

#### M3 build decisions (2026-09-23)

- **Lifetimes:** access token **15 minutes**; refresh token **7 days** (sliding — each
  rotation issues a fresh 7-day token, so a week of inactivity requires signing in).
- **Keys: Terraform `tls_private_key` (RSA 2048).** The public key reaches every Lambda as
  an environment variable; in the cloud the private key goes into a Secrets Manager
  secret named to match the existing grant (`coding-workshop-*<app_id>*`) and only `auth`
  reads it; locally `auth` receives the private key as an env var (AD-07b: no dependency on
  LocalStack's Secrets Manager). Accepted costs: a new provider (`hashicorp/tls`), and the
  private key also lives in Terraform state — the participant-only S3 state bucket, which
  already holds the database password. Rejected: hand-generated keys uploaded manually,
  a step easily lost on an ephemeral VDI.
- **Passwords (NIST SP 800-63B):** minimum 12 characters, no composition rules, maximum
  **72 bytes** — bcrypt silently ignores bytes beyond 72, so longer inputs are rejected
  rather than truncated.
- **Brute force: stated scope cut.** No API Gateway or WAF exists to rate-limit; a
  per-account lockout lets an attacker lock victims out. bcrypt's cost is the brake;
  recorded in the README as deliberately not done.
- **bcrypt cost: 10 for now (OWASP floor), re-decided on the first cloud deploy.**
  LocalStack cannot answer this: its Lambda containers run with no CPU or memory limit
  (`NanoCpus=0`, `Memory=0`, checked 2026-09-23), while AWS scales CPU with memory (a full
  vCPU at 1,769 MB, ~7% of one at 128 MB) — estimated ~1 s per login at cost 10, ~4 s at
  12. If cloud login is too slow, raise `auth`'s memory only. Raising the cost later is
  safe: bcrypt stores it inside each hash, so existing passwords keep verifying.
- **Endpoints (`auth`):** `POST /register` (public, Employee only), `POST /login`
  (public), `POST /refresh` (public, cookie), **`DELETE /refresh` for sign-out** (public,
  cookie), `GET /me` (any role). Sign-out lives on `/refresh` because the cookie's
  `Path=/api/auth/refresh` (AD-08a) means the browser sends it nowhere else — a separate
  `/logout` could never revoke server-side.
- **Phase A built (2026-09-23): keys and verification.** `infra/jwt.tf` (`tls_private_key`,
  cloud-only Secrets Manager secret + version, `auth_env_vars`); `JWT_PUBLIC_KEY` in the shared
  env map; `lambda.tf` merges signing material into `auth` only. `_shared/authz.py`
  `authenticate()` is real: `X-Access-Token` only, `RS256` only, issuer
  `acme-incidents-auth`, required claims `exp iat iss sub role`, `sub` must be numeric,
  role must be known; "expired" vs "invalid" to the caller, the exception class to the log.
  Dependencies: `PyJWT==2.10.1`, `cryptography==44.0.0` in `_shared` (every service
  verifies), `bcrypt==4.2.1` in `auth` only. Verified: 15 authz tests including hand-built
  `alg: none` and RS256→HS256 key-confusion tokens; widening the algorithm allow-list
  makes both fail (uncaught `InvalidKeyError`, i.e. a 500) — the pin is load-bearing.
  Local deploy: only `auth` has `JWT_PRIVATE_KEY`, `_migrate` only the public key, no
  secret name locally; health 200 proves the crypto wheels load in the Lambda runtime.
  The generated pip ignore list grew 14 → 26 names with no manual step.
- **Phase B built (2026-09-23): the endpoints.** `auth/passwords.py` (bcrypt cost 10, NIST
  policy, dummy-hash timing equaliser), `auth/tokens.py` (RS256 access tokens; refresh tokens
  as 256-bit random values stored as sha256; rotation with `SELECT … FOR UPDATE`; reuse
  revokes the family; signing key cached per container, Secrets Manager in the cloud),
  `auth/function.py` (register, login, refresh, `DELETE /refresh`, `/me`).
  **Trap avoided and tested:** reuse detection ends in a `401`, and raising inside
  `with conn.transaction()` rolls back — so the family revocation happens *after* the
  transaction. A mutation moving it inside makes the legitimate holder's newer token keep
  working (`200` where `401` is required); the test catches it.
  **Cookies on Function URLs, probed on LocalStack (2026-09-23):** incoming cookies arrive
  in `headers["cookie"]` with `event["cookies"]` null (AWS documents the list); the response
  `cookies` field is silently ignored and only a `Set-Cookie` header works (AWS documents
  the field). The wrapper reads both shapes and sets our single cookie both ways — verify
  on the first cloud deploy that AWS does not mind the duplicate.
  Verified: 24 auth tests (119 total, 100%); live through `:3001` with a cookie jar —
  register 201 / duplicate 409 / wrong password 401 / login 200 with the locked-down cookie /
  `/me` 200 and 401 / rotate 200 / reuse of the old token 401 and the current token then
  401 (0 live tokens) / sign-out 204 with `Max-Age=0`, refresh afterwards 401.
- **Security behaviour, not separate decisions:** login failure is always "invalid email
  or password", with a dummy bcrypt check for unknown emails so timing reveals nothing;
  token failures return `unauthenticated` with only "expired" or "invalid" as the message,
  the precise reason logged; only `RS256` is accepted (blocks `alg: none` and
  algorithm-confusion attacks).

### AD-08 · Browser token storage

**DECIDED — refresh token in an httpOnly cookie, guarded by `SameSite`, served same-origin
through CloudFront. Access token in memory. Single-flight refresh.**

> **Correction to an earlier reading of this file.** A previous revision said cookies were
> foreclosed by the Function URL CORS config (`allow_origins = ["*"]`,
> `allow_credentials = false`). That is true only for a browser talking *directly* to a
> Function URL. It does not apply here, because `infra/cloudfront.tf` already routes the
> API through the same distribution as the SPA — so browser traffic is **same-origin and
> never triggers CORS at all.** The cookie approach is available, and it is better.

### What the scaffold already provides

`infra/cloudfront.tf` creates one `ordered_cache_behavior` per service:

- `path_pattern = "/api/<service>*"` → that service's Function URL origin.
- Cache policy `4135ea2d-6df8-44a3-9df3-4b5a84be39ad` = **Managed-CachingDisabled**. API
  responses are not cached.
- Origin request policy `b689b0a8-53d0-40ab-baf2-68738e2966ac` =
  **Managed-AllViewerExceptHostHeader**, which forwards all viewer headers except `Host`,
  **including cookies** and query strings.

So the SPA and the API are one origin in the browser's eyes, cookies reach the Lambda, and
no new Terraform is needed for the routing. This is the single most useful thing in the
provided infrastructure and it is documented nowhere in the workshop guides.

### The shape

| Token | Lifetime | Where | Why |
|---|---|---|---|
| **Access** | minutes | JavaScript memory, sent as `X-Access-Token` (AD-08c) | Never persisted, so a reload drops it and the refresh flow re-mints it. Not in a cookie, which keeps every mutating endpoint free of CSRF surface. |
| **Refresh** | long, revocable | **httpOnly cookie** | `httpOnly` means injected script cannot read it — the point of the decision. This is the credential worth protecting, because it is the long-lived one. |

Cookie attributes: `HttpOnly; Secure; SameSite=Strict; Path=/api/auth/refresh`.

- **`SameSite=Strict`** is viable precisely because everything is same-origin. The refresh
  cookie is only ever sent by the app's own XHR to its own refresh endpoint, so nothing
  legitimate is lost, and cross-site POSTs cannot carry it.
- **Scope `Path` to the refresh endpoint.** A cookie scoped to `/` rides along on every
  single API call for no reason, which widens exposure and wastes bytes. The refresh token
  should only be presented when it is actually being redeemed.
- `Secure` is satisfied — `viewer_protocol_policy = "redirect-to-https"` on every behavior.

**Single-flight refresh.** One in-flight refresh promise shared by all callers. Without it,
two concurrent 401s trigger two refreshes, the second presents an already-rotated token,
and AD-07d's reuse detection correctly reads that as theft and revokes the whole family —
logging the user out for doing nothing wrong. Rotation and concurrency interact badly by
default; this is the fix, and it is a dozen lines.

### Work this actually requires

1. **A Vite dev proxy.** Locally the frontend is `:3000` and the Lambdas are `:3001` —
   *different origins*, so httpOnly/SameSite cookies will not work the way they do in
   cloud. Add `server.proxy` to `frontend/vite.config.js` mapping `/api` → `http://localhost:3001`
   so local development is same-origin too and matches the deployed path shape. Without
   this, auth works in cloud and mysteriously fails locally.
2. **The `auth` service must set and clear the cookie** via `Set-Cookie` on sign-in,
   refresh, and sign-out. Lambda Function URL responses support multi-value headers through
   the `cookies` response field.
3. **Sign-out must revoke server-side**, not merely clear the cookie. Clearing a cookie the
   client already lost control of protects nobody.

### Sealing the origin — IAM auth + CloudFront OAC

**DECIDED — Function URLs move to `authorization_type = "AWS_IAM"` and are fronted by a
CloudFront Origin Access Control, so CloudFront is the only caller that can invoke them.**

As shipped, the Function URLs are `authorization_type = "NONE"` and reachable directly from
the internet. CloudFront is then a *path*, not a perimeter — every handler is its own
outer wall, and a single service that forgets to verify is publicly exploitable. OAC closes
that: a direct call to the Function URL gets a `403` from Lambda before any of our code runs.

Terraform changes, all in `infra/`:

1. A second `aws_cloudfront_origin_access_control` with
   `origin_access_control_origin_type = "lambda"`, `signing_behavior = "always"`,
   `signing_protocol = "sigv4"`. The existing one is `"s3"` and cannot be reused.
2. `origin_access_control_id` on each function origin inside the `dynamic "origin"` block
   in `cloudfront.tf`.
3. `authorization_type = "AWS_IAM"` in `lambda.tf`.
4. An `aws_lambda_permission` per service: action `lambda:InvokeFunctionUrl`, principal
   `cloudfront.amazonaws.com`, `function_url_auth_type = "AWS_IAM"`, and `source_arn`
   pinned to the distribution ARN. **Pin the ARN** — without the condition, any CloudFront
   distribution in any account can invoke the function.

No dependency cycle: Lambda → distribution → permission is a clean DAG.

**Built 2026-09-23 (before the first cloud deploy):** `aws_cloudfront_origin_access_control.lambda`
(type `lambda`, SigV4, always sign) attached to every function origin;
`authorization_type = local.is_cloud ? "AWS_IAM" : "NONE"` — locally it stays `NONE`
explicitly, because there is no CloudFront to sign and local behaviour must not hinge on how
LocalStack emulates IAM; `aws_lambda_permission` per function for `lambda:InvokeFunctionUrl`
(`function_url_auth_type = "AWS_IAM"`) **and** `lambda:InvokeFunction`, both pinned to the
distribution ARN. `terraform validate` passes; a local plan shows no URL/OAC/permission changes.
**To verify on the first cloud deploy:** (1) a direct call to a Function URL returns `403`;
(2) whether `lambda:InvokeFunction` is actually required alongside `InvokeFunctionUrl`
(included because current AWS guidance for OAC mentions it; scoped to the distribution either
way); (3) **`POST`/`PUT` through an OAC need an `x-amz-content-sha256` header carrying the
SHA-256 of the body** (AWS's documented constraint for Lambda OAC; Lambda does not accept
unsigned payloads) — the frontend's fetch wrapper must compute it with `crypto.subtle.digest`,
and manual `curl` tests of write endpoints must send it; (4) `X-Access-Token` reaches the
handler through the signing (the M1 check).

### The collision this creates, and how it is resolved

**SigV4 signing puts the signature in the `Authorization` header. Our access token was
going to live there too.** They cannot both occupy it — with OAC enabled, CloudFront sets
`Authorization` to the signature, and a viewer-supplied Bearer token in that header does
not survive to the handler. The scaffold's `Managed-AllViewerExceptHostHeader` origin
request policy forwards `Authorization`, which makes the conflict immediate rather than
theoretical.

**Resolution: send the access token in `X-Access-Token`, not `Authorization`.** The handler
reads that header; `Authorization` belongs to the infrastructure. Cost: one deviation from
the Bearer convention, documented in the README so it reads as a consequence rather than
sloppiness. The alternatives are worse — moving the access token into a cookie reopens CSRF
surface on every mutating endpoint that `SameSite` then has to carry alone, and a CloudFront
Function rewriting the header before signing is an extra deployed artifact to maintain for
no gain.

> **Verify this empirically in the VDI before building on it.** Header handling under OAC
> signing is exactly the kind of behaviour that is easier to test than to reason about, and
> it is cheap to check: one signed request, one log line showing which headers arrived.
> Do it at M1, not at M3.

### Consequences to absorb now

- **`curl` against a raw Function URL stops working** — it returns `403`, correctly. All
  manual testing goes through the CloudFront domain. The workshop docs' own `curl` examples
  target the service directly and will need adjusting.
- **Local development is unaffected.** `cloudfront.tf` is guarded by
  `data.aws_caller_identity.this.id != "000000000000"`, so no distribution exists under
  LocalStack; locally the Vite proxy fronts `:3001` directly. The `X-Access-Token` header
  works identically in both, which is a further argument for it over any CloudFront-side
  rewrite.
- **The Function URL `cors` block becomes vestigial.** Nothing reaches the origin
  cross-origin any more. Leave it; deleting it is churn with no effect.
- **Keep verifying tokens in every handler anyway.** OAC means only CloudFront can invoke
  the function — it says nothing about *who* the viewer behind CloudFront is. The two
  controls answer different questions, and the perimeter one must never be an excuse to
  skip the identity one.

> **Diagnostic trap worth pre-loading.** When cookie auth misbehaves, the instinct is to
> test the Function URL or `:3001` directly. Those are a different origin, so the browser
> will not send the cookie and the request fails in a way that looks like a server bug.
> **Test through the CloudFront domain, or through the dev proxy — never against the origin
> directly.** This is the mirror image of "curl works but the browser doesn't": here the
> browser is right and the shortcut is wrong.

### AD-09 · RBAC enforcement model

- **First, reconcile the role sets.** The problem statement mandates three personas
  (Employee, Facility Admin, Engineer). `docs/full-stack.md` offers a different generic
  table (Admin / Manager / Contributor / Viewer) as an *example*. The personas win; treat
  the guide's table as illustrative only. *(Answered by AD-21: no fourth role — the first
  admin is seeded.)* Decide whether a fourth super-admin role is needed
  to bootstrap the first Facility Admin.
- **Decide:** role carried as a JWT claim vs looked up per request; a single shared
  `@requires(role)` decorator vs inline checks; and where the role-to-permission matrix
  lives so the frontend hides exactly what the backend blocks.
- **Ownership rules are as important as roles here:** an Employee may read and note *their
  own* incidents, an Engineer *assigned* ones. Row-level ownership checks need the same
  centralization as role checks, or they will be forgotten on one endpoint.
- **Recommendation:** roles as claims, one shared decorator handling role *and* ownership,
  and a single matrix definition the frontend reads — duplicated permission logic across
  layers is the most likely place to leak a privilege-escalation bug.
- **Settled beneath this decision** (AD-01 → Ticket notes): notes are soft-deleted, never
  hard-deleted; only the author edits a note; the author or a Facility Admin may
  soft-delete it. The rest of the decision stays `OPEN`.

#### DECIDED — role claim, closed-by-default routes, SQL-filtered ownership (2026-09-23)

- **Role travels as a JWT claim**, read from the verified access token; no per-request
  database lookup. The refresh endpoint re-reads the role from `users`, so a role change
  takes effect within one access-token lifetime. *Proposed lifetime: 15 minutes — to be
  fixed at M3 with AD-07.*
- **Every route declares its access at registration, or the service refuses to start.**
  `router.on(method, pattern, roles={...})` or `public=True`; a route with neither raises
  at import time. Closed by default — a forgotten check is a startup failure, not a
  silent hole (the "verified in some handlers but not others" failure AD-07 rules out).
- **Ownership is service policy, never generic.** Lists filter in SQL by role (employee
  `WHERE reporter_id = me`, engineer `WHERE reporter_id = me OR assignee_id = me` — *amended
  2026-09-23, see "Roles inherit employee capabilities"* — admin unfiltered) — never
  fetch-all-then-filter. A single row is loaded, then checked by the service's own policy
  module (e.g. `incidents/policy.py: can_view(user, incident)`). Notes inherit the parent
  incident's check (AD-01).
- **`404` for what the caller cannot see; `403` for what they can see but not do.**
  Incident ids are sequential, so a `403` on someone else's ticket would confirm it
  exists. An engineer closing their own assigned ticket sees it, so gets `403`.
- **The frontend never holds its own copy of the rules.** Responses carry the caller's
  permitted actions per resource (the `allowed_transitions` pattern from AD-17, applied
  generally); `/me` returns the role for navigation. The server re-checks every request.
- **Where the code lives:** `_shared/authz.py` — current user from the verified token
  (token verification itself is M3), `Forbidden` / `NotFound`, the route-level role
  check wired into the router. Each service — its `policy.py`: ownership and per-action
  rules.
- **Already settled elsewhere:** three roles, no fourth (AD-21); mechanism shared, policy
  per service (AD-17); note edit/delete authority (AD-01 → Ticket notes).
- **Built 2026-09-23:** `backend/_shared/authz.py` — `User(id, role)`, `ROLES`, and
  `authenticate(event)`. Until M3 implements RS256 verification, `authenticate` is a stub that
  unconditionally raises `Unauthenticated` — **closed by default in practice, not just in
  principle:** every non-public route currently returns `401` to every caller, because there is
  no way yet to become an authenticated user. `backend/_shared/router.py`'s `add()` still
  enforces the registration-time rule (`roles={...}` xor `public=True`, roles must be a known
  member of `ROLES` or `ValueError` at import time).

#### Roles inherit employee capabilities (2026-09-23)

The user's model: **employee is the base role; engineer and admin are employees too.**
The data model is unchanged (one `users.role` value), but every capability an employee
has, the other roles have as well — anyone signed in can report an incident, sees the
incidents they reported, may edit their own report while it is `unassigned`, and may
request escalation of it. Consequences: an engineer sees incidents **reported by or
assigned to** them (a union, not assigned-only); employee-level routes declare all three
roles. Admins see everything regardless.

### AD-10 · Frontend dependency set

`frontend/package.json` currently has only `react`, `react-dom`, Vite, and ESLint. **Material
UI, React Router, and React Responsive are required by the requirements but are not installed.**

- **Install:** `@mui/material @emotion/react @emotion/styled react-router-dom react-responsive`.
- **Still open:** data fetching (thin `fetch` wrapper in `src/services/` vs React Query) ·
  forms and validation (React Hook Form + zod vs hand-rolled) · MUI theming and whether to
  customize the palette.
- **Recommendation:** thin fetch wrapper first — it satisfies the prescribed `src/services/`
  structure. Add React Query only if caching and refetch behavior start costing real time.

#### DECIDED — mandated libraries plus the minimum (2026-09-24)

Mandated: Material UI (+ Emotion), React Router, React Responsive; `@mui/icons-material`
(named imports). **No** React Query (own wrapper + small polling hook), **no** form library
(controlled inputs; the server's `fields` are the authority — zod would duplicate the
Pydantic rules), **no** date library (`Intl`), **no** drag-and-drop in the MVP (the board uses
`actions.transitions` buttons). Self-hosted fonts (`@fontsource`: Overpass for display,
Atkinson Hyperlegible for text). Dev: Vitest, `@vitest/coverage-v8`, jsdom, React Testing
Library (+ user-event, jest-dom), Cypress, `@stylistic/eslint-plugin` enforcing Allman braces.

### AD-11 · Test stack

`docs/full-stack.md` says Jest + React Testing Library, but this is a Vite project where
Vitest is the native fit and Jest needs extra ESM configuration.

- **Decide:** Vitest vs Jest · pytest setup and coverage tooling for Python (nothing is
  configured) · Cypress vs Selenium for E2E · whether coverage thresholds are enforced in CI
  or just reported.
- **Recommendation:** Vitest + RTL, pytest + `pytest-cov`, Cypress. If you deviate from the
  guide's Jest suggestion, say why in the README — a stated, reasoned deviation reads as
  judgment, an unexplained one reads as an oversight.
#### DECIDED — pytest, Vitest, Cypress; thresholds enforced (2026-09-23)

- **Backend:** pytest + `pytest-cov`, in a repo-root `.venv` on Python 3.13 (the Lambda
  runtime) from `requirements-dev.txt`. Dev-only packages never enter a Lambda bundle.
- **Frontend:** Vitest + React Testing Library — Vitest is native to Vite; Jest (named in
  `docs/full-stack.md`) needs extra ESM configuration. A stated, reasoned deviation from
  the guide; say so in the README.
- **E2E:** Cypress.
- **Coverage targets are enforced, not reported:** thresholds live in each tool's own
  config (`fail_under` for coverage.py, `thresholds` for Vitest), so any run below target
  fails — locally now, and unchanged in CI if one is added. There is no CI pipeline yet.
- **Layout:** tests sit beside the code — `backend/_shared/tests/`,
  `backend/<service>/tests/`. `sync-shared.sh` copies only top-level `.py`, so `_shared`
  tests are never vendored. Terraform patterns exclude `tests/` from every Lambda zip.
- **To build when the test stack lands (recorded 2026-09-23):** a `_shared` dependency
  test. Install *only* `backend/_shared/requirements.txt` into a clean environment, then
  import every module in `_shared/`; any import that fails means an undeclared dependency.
  Closes the gap `bin/sync-shared.sh` cannot: it compares declared lines exactly, so a
  dependency nobody declared passes the sync and fails at runtime. Not an import scanner —
  import names do not map to package names (`import jwt` is `PyJWT`).
- **Setup built 2026-09-23:** `.venv` at repo root (Python 3.13, gitignored) from
  `requirements-dev.txt`; `pytest.ini` (`pythonpath = backend`, `testpaths = backend`,
  coverage on by default); `.coveragerc` (`source = backend`, `fail_under = 80`).
- **Namespace-package finding:** service directories under `backend/` have no
  `__init__.py`. Without `include_namespace_packages = true` in `.coveragerc`, coverage.py
  silently left `auth/function.py` and `_migrate/function.py` out of the total — it reported
  75% instead of the true 34%. A gate that silently excludes untested files is worse than
  no gate; `include_namespace_packages` is required, not optional, for this layout.
- **Integration test database — decided 2026-09-23: the dev database, not a separate test
  database.** One PostgreSQL to stand up locally, not two. Made safe by the
  `isolated_schema` fixture in `backend/conftest.py`: each DB test runs inside its own
  throwaway schema (`test_<random>`), created before the test and dropped `CASCADE` after,
  with code under test pointed at it via the libpq `PGOPTIONS=-c search_path=<schema>`
  env var — production connection code in `_shared/db.py` is unchanged and untouched by a
  test-only branch. Verified: 0 leftover `test_*` schemas and 0 rows touched in `public`
  after a run. `backend/conftest.py` also aliases the vendored import name `shared` to the
  `_shared` source package (tests exercise the coverage-counted code, independent of
  `sync-shared.sh`) and provides `load_service`, loading each Lambda's `function.py` under
  a unique module name; `pytest.ini` uses `--import-mode=importlib` because every service's
  test file is named `test_function.py`. `.coveragerc` omits `backend/conftest.py`.
- **Current status (2026-09-23, uncommitted):** 80 tests pass — router
  (`backend/_shared/tests/test_router.py`, now including the 3 specificity-bug tests under
  AD-05), DB helper (`backend/_shared/tests/test_db.py`), the new `backend/_shared/tests/test_http.py`
  (the AD-12 `dispatch` wrapper: routing/access, request-body parsing and validation, database
  backstops, correlation id and access-log behaviour) and `backend/_shared/tests/test_log.py`
  (the AD-16 `JsonFormatter`/`setup`), `auth` (`backend/auth/tests/test_function.py`, updated for
  the `dispatch`-based handler and the no-fingerprinting health response), and `_migrate`
  (`backend/_migrate/tests/test_function.py`: real `001_init` from scratch + idempotent
  rerun, edited-file detection, failing-migration rollback, misnamed file, admin seeding —
  once, normalised email, missing credentials x3, plaintext refused, registered email not
  promoted — HTTP-shaped event refused, handler passthrough). Total backend coverage is
  **100%**, the 80% gate passes, and the run exits `0`. Mutation spot-check: removing the
  plaintext-hash guard fails `test_plaintext_password_is_refused`; decoding the whole path
  before matching in the router fails 2 router tests. Both reverted after confirming.

### AD-12 · Error envelope and validation approach

The guide demands a "consistent format" and never specifies one.

- **Decide:** the exact JSON error shape (e.g. `{"error": {"code", "message", "fields": {}}}`),
  and whether validation is hand-rolled or schema-driven.
- **Recommendation:** Pydantic v2 models as the single source of truth for request shapes,
  mapped to 400 responses by one shared error handler. The frontend renders `fields` beside
  the offending inputs.

- **Settled beneath this decision (2026-09-23):** a PostgreSQL foreign-key violation
  (`23503`) reaching the shared error handler maps to `400`, not `500` — it is a caller
  error the service's own validation missed. The envelope shape and validation approach
  stay `OPEN`.

#### DECIDED — one envelope, fixed codes, Pydantic v2, one entry wrapper (2026-09-23)

- **Envelope, every error, every service:**
  `{"error": {"code", "message", "fields"?, "request_id"}}`. `code` is stable and
  machine-readable (the frontend branches on it, never on text); `message` is for humans;
  `fields` appears only on validation errors, keyed by input name, rendered beside the
  input; `request_id` is Lambda's `aws_request_id`, so a user-quoted id finds the log line.
- **Codes:**

  | `code` | HTTP | Raised by |
  | --- | --- | --- |
  | `bad_request` | 400 | body is not valid JSON |
  | `validation_failed` | 400 | Pydantic model failure; FK violation `23503` |
  | `unauthenticated` | 401 | missing / expired / invalid token (M3) |
  | `forbidden` | 403 | AD-09: visible but not permitted |
  | `not_found` | 404 | router; AD-09 cannot-see |
  | `method_not_allowed` | 405 | router, with an `Allow` header |
  | `conflict` | 409 | unique violation `23505` (duplicate email, duplicate floor name) |
  | `internal` | 500 | anything unexpected — generic message only; details go to the log |

  `401`, `403`, `405`, `409` extend the API contract's `400/404/500`; each is required by
  a decided design (auth, AD-09, AD-05, duplicate handling). State them in the README.
- **A `500` never carries internal detail.** Exception text can hold hostnames, SQL, or
  data; it is logged with the `request_id`, never returned. *Fixed 2026-09-23:* the M1 `auth`
  handler returned `str(e)` in its `500` body; it now logs the detail with the request id
  and returns the generic envelope, and a test plants a hostname and username in the
  exception to prove neither reaches the response.
- **Validation: Pydantic v2.** Request bodies are Pydantic models; their error locations
  map onto `fields`. Contrast with AD-05: routing a few paths is a table lookup and was
  hand-rolled, but validation across every endpoint is where hand-written code grows bugs,
  and the model doubles as documentation of the request. Cost accepted: a compiled
  dependency (~5 MB) and import time at 128 MB. Added to `_shared/requirements.txt` when
  first used, so the sync check (AD-02) forces it into every service.
- **One entry wrapper, `_shared/http.py`,** called by every Lambda's `handler`: normalise
  and resolve the route (AD-05), apply the route's access rule (AD-09), parse the body
  (including `isBase64Encoded`), call the handler, and map every exception to the
  envelope. No handler builds an error response itself.
- **Considered alternative:** RFC 9457 Problem Details (`application/problem+json`) — the
  recognised standard, but its `type` URIs and extra members are ceremony a single
  first-party frontend does not need. Named in the README as the considered alternative.

#### Built 2026-09-23: `errors.py` + `http.py`

- **`_shared/errors.py`:** `ApiError(message, fields=None)` base (`status=500`, `code="internal"`)
  and the fixed subclasses from the code table above — `BadRequest`/`ValidationFailed` (400),
  `Unauthenticated` (401), `Forbidden` (403), `NotFound` (404), `MethodNotAllowed(allowed)` (405,
  carries the `Allow` list), `Conflict` (409).
- **`_shared/http.py`:** `dispatch(router, event, context)` is the one entry point every
  `function.py` calls. In order: resolve the correlation id (UUID-validated against the incoming
  `X-Correlation-Id`, falling back to `aws_request_id`/a generated UUID, with a warning on a
  malformed value — AD-16); resolve the route (AD-05); if not `public`, `authz.authenticate` then
  a role check (`403` if the role isn't in `route.roles` — AD-09); parse the body (`isBase64Encoded`
  → base64 decode → JSON, any failure → `400 bad_request`); call the handler; map every exception
  to the envelope (`ApiError` subclasses → their own status/code; `pydantic.ValidationError` → 400
  `validation_failed` with per-field messages; `psycopg.errors.ForeignKeyViolation` → 400;
  `UniqueViolation` → 409; `OperationalError`/`InterfaceError` → `reset_conn()` then 500; anything
  else → logged with a traceback, generic 500). Every response carries `X-Correlation-Id`; a `405`
  also carries `Allow`. One JSON access line is written per request regardless of outcome (AD-16).
- **`auth/function.py` now goes through `dispatch`.** The M1 skeleton's `GET /` handler ran
  `SELECT version()` and returned the full PostgreSQL version string to any caller, plus a
  `headers_received` diagnostic echoing the request's headers — both are server-fingerprinting /
  information-disclosure smells on a **public** route. Fixed: the handler now runs `SELECT 1` and
  returns only `{"service": "auth", "database": "ok"}`. `test_health_does_not_fingerprint_the_server`
  pins the absence of `"PostgreSQL"` from the response.
- **`pydantic==2.10.4` added to all three `requirements.txt`** — `_shared/`, `auth/`, and
  `_migrate/` — because `bin/sync-shared.sh` checks every line of `_shared/requirements.txt`
  against every target's own file, `_migrate` included, and fails the sync otherwise (AD-02).
  **Accepted trade-off:** `_migrate` now carries pydantic's ~5 MB in its bundle despite never
  importing it, because the sync script compares declared dependency lines, not actual per-module
  imports, and giving it a per-module dependency list is more machinery than a workshop-timeboxed
  fix justifies.
- **Verified locally:** 80 tests pass, 100% backend coverage, the 80% gate passes. Live through
  `:3001` — health returns 200 with no version string; a sent `X-Correlation-Id` is echoed back;
  `GET /api/auth/nope` → 404 envelope; `POST /api/auth` → 405 with `Allow: GET`; CloudWatch access
  lines are JSON carrying route pattern, status, duration, and a caller-supplied correlation id
  distinct from the Lambda request id.

### AD-13 · Search, filter, and pagination design

A required feature with no specified design.

- **Decide:** query-param grammar (`?q=&status=&priority=&assignee=&building=&floor=&page=&limit=&sort=`)
  · server-side SQL filtering vs client-side · pagination envelope and whether totals are
  returned · default sort for an incident list (most likely priority then age).
- **Recommendation:** server-side filtering with documented params. Incident volume plus
  per-persona list views makes client-side filtering untenable, and filtering is what the
  Employee, Admin, and Engineer views all differ by.

#### DECIDED — filtered, paged, sorted lists on the server (2026-09-23)

- **Server-side filtering in SQL**, on top of the AD-09 visibility filter. Incident
  params: `status` (repeatable), `priority`, `category`, `building_id`, `floor_id`,
  `seat_id`, `assignee_id`, `escalation_status`, `q` (case-insensitive substring of title
  or description). Unknown params are ignored; invalid values are `400` with `fields`.
- **Page-number pagination:** `page` (from 1) and `limit` (default 20, maximum 100).
  Response envelope for every list: `{items, total, page, limit}`, so the UI can show
  "page 2 of 7". Rejected: cursor pagination — it only pays off at data volumes this app
  will not reach, and it cannot jump to a page.
- **Sorting:** `sort` from an allow-list (never interpolated from the request). Default
  for incidents: **priority descending, then oldest first** — the most urgent,
  longest-waiting ticket tops a triage list.
- **Applies to every list endpoint**, including `GET /api/auth/users`, which drops its
  provisional 50-row cap.
- **M9 audit (2026-09-23):** every list endpoint (incidents, notes, the three facility
  lists, engineers, users) runs on `_shared/listing.py`; "shared across all three persona
  views" is the one incidents list, with personas as filter presets over SQL visibility.
  **Added:** a purely numeric `q` (optionally `#42`) also matches the incident id, on top
  of the text search, under the same visibility. **Reopened 2026-09-23:** a `reporter_id`
  filter was added after all (frontend gap E5) — roles inherit employee capabilities, so an
  engineer's or admin's "My reports" page needs it. **Skipped by decision:** date-range
  filters (not deferred — a new decision if AD-19 needs them) and a `reporter_id` filter
  (nothing asks for it). **Scope cut:** `q` uses `ILIKE` without an index — a full scan,
  fine at workshop scale; `pg_trgm` trigram indexes are the upgrade path.

### AD-14 · Real-time and async scope

`docs/full-stack.md` lists "deliver real-time capabilities" and "handle async tasks" as
expected backend capabilities, but `infra/` has **no WebSocket API**. Each Lambda does have
an SQS dead-letter queue.

- **Options:** scope real-time out and justify it · short polling or optimistic UI ·
  add SQS/EventBridge to Terraform for genuine async work.
- **Recommendation:** optimistic UI plus short polling on incident views; state the
  trade-off in the README. Pragmatic decisions are explicitly rewarded.

#### DECIDED — short polling, paused when hidden (2026-09-24)

No WebSockets (no infra for them). Polling: incident detail 20 s, dashboards 30 s, "my
tickets" 60 s, timings and hotspots on demand only. Paused while the tab is hidden; refetch
immediately after the user's own action. Side effect: a visible tab keeps the sliding 7-day
session alive.

### AD-15 · PWA and AI-integration scope

Both are listed as expected frontend capabilities; both are large relative to a workshop.

- **Recommendation:** declare both out of scope in the README with reasoning, and revisit
  only if the core CRUD, auth, RBAC, search, and tests are all complete.

#### DECIDED — both out of scope (2026-09-24)

AI needs an external model API, which the brief rules out ("no integrations with external
systems"); an offline PWA conflicts with the in-memory token and server-held data. Already
listed in README → Deliberately not done. A web manifest alone could be added later at no cost.

### AD-16 · Observability and structured logging

CloudWatch retention is 7 days and the example uses plain `logging` with no structure.

- **Decide:** JSON structured logs vs plain · a correlation ID generated by the frontend and
  propagated through every service · what gets logged at INFO vs DEBUG · whether to surface
  any metrics.
- **Recommendation:** JSON logs with a request-scoped correlation ID. Cheap, and it is the
  most direct evidence for the "Observant" soft-skill score.

#### DECIDED — JSON lines, access log per request, correlation id, no custom metrics (2026-09-23)

- **Format: JSON, one object per line,** from a ~20-line stdlib formatter in
  `_shared/log.py`. Logs Insights can filter and aggregate on fields. Lambda's native
  `log_format = "JSON"` was considered but its LocalStack support is unverified; our own
  formatter behaves identically in both environments.
- **One access line per request, written by the AD-12 wrapper:** `level`, `service`,
  `request_id`, `correlation_id`, `method`, `route` (the *pattern*, e.g.
  `/{incident_id}/notes`, so requests group across ids), `status`, `duration_ms`,
  `user_id`. Handlers add lines only for domain events: status transition, assignment,
  admin seeded, refresh-token reuse detected.
- **Correlation id:** the frontend generates a UUID per user action and sends
  `X-Correlation-Id`; the wrapper accepts it only if it parses as a UUID (no log
  injection), logs it on every line, echoes it in the response, and falls back to
  `request_id` when absent. **Consequence, done 2026-09-23:** `bin/proxy-server.js` now
  forwards `x-correlation-id` alongside `x-access-token` and `cookie` — it previously forwarded
  none of the three (the M1 header bug again); without the fix the id would be silently
  dropped locally only.
- **Levels:** `INFO` access line and domain events; `WARNING` suspicious activity
  (refresh-token reuse, malformed correlation id); `ERROR` every `500`, with traceback;
  `DEBUG` only when the `LOG_LEVEL` env var asks.
- **Never logged:** tokens, cookies, passwords or hashes, request bodies. Ids and header
  *names* only.
- **No custom metrics for the MVP.** Lambda already publishes invocations, errors,
  duration, throttles; JSON logs answer the rest through Logs Insights. CloudWatch
  Embedded Metric Format is the no-new-infra upgrade path, recorded in the README as
  deliberately not done.

#### Built 2026-09-23: `_shared/log.py`

- `request_id` and `correlation_id` are held in `contextvars.ContextVar`s, set once per
  request by `http.dispatch`, so every log line emitted anywhere during that request — not
  just the access line — carries both without threading them through every call.
  `JsonFormatter` reads them at format time and merges in a `fields` dict when the caller logs
  with `extra={"fields": {...}}`. `LOG_LEVEL` env var controls the root logger's level
  (default `INFO`).
- **`setup(service)` reformats the Lambda runtime's existing root handler rather than adding a
  second one.** The Lambda runtime installs its own root `StreamHandler` before user code runs;
  adding another would double every line in CloudWatch. `setup` only adds a handler if none
  exist (e.g. under pytest), and always replaces the formatter on whatever handlers are there.
- **Verified locally:** JSON lines in CloudWatch via `aws logs tail`, with `route`, `status`,
  `duration_ms`, and a client-supplied correlation id distinct from the Lambda request id.
- **Unresolved, believed to be a display artifact:** LocalStack's `aws logs tail --follow`
  appends its own `END RequestId: ...` marker onto the same output line as our JSON log entry,
  rather than a separate line. This has not been reproduced against real CloudWatch —
  **verify on the first cloud deploy (M14)** before treating it as anything more than a
  LocalStack CLI quirk.

### AD-17 · Incident state machine and transition authority

`Open → In Progress → Blocked → Resolved → Closed` is given; the rules around it are not.

- **Decide:** which transitions are legal (is `Blocked → Open` allowed? can `Closed` reopen?
  can an incident skip `In Progress`?) · which persona may perform each (likely: Engineer
  drives In Progress/Blocked/Resolved, Admin can force any, Employee may only close or
  confirm their own) · whether `Blocked` requires a mandatory reason (the problem statement
  asks "which incidents are escalated or blocked, **and why**" — so yes) · whether an
  unassigned incident can leave `Open`.
- **Where enforced:** a single transition table, rejecting illegal moves — not scattered
  `if status ==` checks across handlers. *(Location corrected under the decision below:
  the `incidents` service, not shared code.)*
- **Recommendation:** explicit transition map plus an append-only
  `incident_status_history(incident_id, from, to, actor_id, reason, created_at)` table. That
  one table answers the acknowledge/assign/resolve timing questions and the blocked-reason
  question at once.
- **Depends on:** AD-09 (the shared authorization mechanism; the transition policy itself
  stays in `incidents`).
- **Settled beneath this decision** (AD-01 → Ticket notes): `Blocked` requires a reason,
  stored on the status-history row (the record) **and** posted as a note (the
  notification); notes are writable on every status except `Closed`.

#### DECIDED — transition authority by persona

**Workflow** — engineer moves shown; only an admin assigns, and assigning performs
`Unassigned → Open` automatically:

```
Unassigned ──(admin assigns)──▶ Open → In Progress → Resolved
                                             ⇅
                                          Blocked
```

| From → To | Employee | Engineer (assigned) | Facility Admin |
| --- | --- | --- | --- |
| `Unassigned` → `Open` (by assigning) | ✗ | ✗ | ✓ (only via assignment) |
| `Open` → `In Progress` | ✗ | ✓ | ✓ |
| `In Progress` → `Blocked` | ✗ | ✓ (reason required) | ✓ (reason required) |
| `Blocked` → `In Progress` | ✗ | ✓ | ✓ |
| `In Progress` → `Resolved` | ✗ | ✓ | ✓ |
| `Resolved` → `Closed` | ✗ | ✗ | ✓ |
| any other move, incl. reopening `Closed` | ✗ | ✗ | ✓ (entering `Blocked` still needs a reason) |
| same status → same status | ✗ | ✗ | ✗ (`400`) |

- **Admin: any status to any other.** The escape hatch for corrections and reopening. Every
  admin move still writes a history row, so overrides are visible, not silent.
- **Engineer: one step forward at a time, plus unblocking.** No skipping `In Progress` —
  its timestamp is the "how quickly acknowledged" metric, and a skip leaves it empty.
  *(Acknowledgement was briefly redefined as assignment on 2026-09-23 and reverted the same day — see AD-19.)*
  `Blocked → In Progress` is allowed because `Blocked` is a detour, not a stage (AD-18);
  without it every unblock would route through an admin. No `Blocked → Resolved`: the
  ticket returns to `In Progress` first.
- **Only admins close.** There is no "under review" state, so `Resolved` means "the
  engineer says it is fixed" and `Closed` means "an admin confirms it is done". An
  engineer cannot reopen their own `Resolved` ticket; that is an admin move.
- **Employee: no status changes.** Employees take part through notes only.
- **Ownership:** an engineer may transition only incidents assigned to them.
- **Every transition** writes one `incident_status_history` row (from, to, actor, reason,
  timestamp) in the same transaction as the status update (AD-04).
- **History is append-only, enforced by the database** (2026-09-23): a trigger rejects
  every `UPDATE` and `DELETE` on `incident_status_history`, so no code path — or manual
  query — can rewrite the record the timing metrics are computed from.
- **Enforcement — recommended, pending AD-09:** the transition table lives **in the
  `incidents` service** (e.g. `backend/incidents/workflow.py`), not in `_shared/`. AD-01
  makes `incidents` its only consumer, and `_shared/` is for code more than one service
  needs — vendoring single-service business rules into every bundle would misstate the
  dependency. Split: `_shared/` holds the *mechanism* (token verification, role from
  claims, the `403` envelope); each service holds its *policy* (which role may make which
  move, what "owns this ticket" means). `workflow.py` is pure — no HTTP, no DB — and is the
  primary unit-test target. Same-status → `400`; outside the caller's permissions → `403`.
  The frontend learns which moves to offer from the API (allowed transitions computed by
  the same module), never from a copy of the table.
- **DECIDED — frontend shows server-computed moves (2026-09-23).** The incident response
  carries `allowed_transitions`: the target statuses *this caller* may move *this incident*
  to, computed by `workflow.py` from role, ownership, and current status. The UI renders
  exactly that list as actions and hides the rest. One copy of the rules; the UI can never
  offer a move the server would refuse, and the server still re-checks every request.
- **DECIDED — a sixth status, `Unassigned`, before `Open` (2026-09-23).** New incidents
  start `Unassigned`. **Only admins assign**, and assigning moves the incident
  `Unassigned → Open` automatically, writing a history row like any transition.
- **Invariant: status is `Unassigned` if and only if there is no assignee.** Enforced in
  `workflow.py` *and* by a database `CHECK` constraint, so no code path can produce an
  assigned `Unassigned` incident or an unassigned `Open` one. Consequences: nothing leaves
  `Unassigned` except by assignment (this narrows the admin's any-to-any rule); an admin
  moving an incident back to `Unassigned` clears its assignee in the same transaction.
- **Timing metrics, all from the status history:** created → *assigned*
  (`Unassigned → Open`) → *acknowledged* (`Open → In Progress`) → *resolved*; all three
  are reported (AD-19). *(Acknowledgement was briefly redefined as assignment on 2026-09-23 and reverted the same day — see AD-19.)*
- **This deviates from the problem statement's five-status workflow.** The five keep their
  names and order; `Unassigned` is prepended. Documented in `README.md` as a deliberate
  deviation: it makes the admin's triage queue a plain status filter and time-to-assign a
  plain transition.
- **Rejected:** unassigned as a condition on `Open` (works, but the queue and the
  time-to-assign metric need a second mechanism beside the status history); assignment
  auto-moving to `In Progress` (merges "assigned" and "acknowledged").
- **Reassignment: admins only, routed through `Unassigned` (2026-09-23).** No direct
  engineer-to-engineer reassignment. The admin moves the incident to `Unassigned` —
  **a reason is required**, stored on the history row and posted as a note, exactly like
  `Blocked` — which clears the assignee; then assigns the new engineer, which moves it
  `Unassigned → Open`. Both steps are ordinary transitions with history rows. An engineer
  cannot hand a ticket to someone else.
- **Status history carries `assignee_id`** — the assignee *after* each transition (null
  in `Unassigned`). This is what lets history answer "how many engineers has this ticket
  been through?" (distinct `assignee_id`s) without a separate assignment table; the
  `actor_id` alone only names the admin who acted.
- **Consequences:** reassignment restarts the incident at `Open`, so the new engineer
  acknowledges it again (`Open → In Progress`); a `Blocked` incident leaves `Blocked` on the way,
  its reason surviving in history and notes. An incident can be assigned more than once,
  so each timing uses the **first** occurrence (settled under AD-19).

### AD-18 · Visual workflow representation

An explicit MVP capability, and the most under-specified one.

- **Decide:** what "visual" means — a per-incident progress stepper showing where this
  ticket sits · a static diagram of the whole lifecycle · a Kanban board grouped by status,
  optionally drag-to-transition.
- **Options:** MUI `Stepper` (cheapest, reads as intentional) · a Kanban with
  `@dnd-kit` or `react-beautiful-dnd` · a rendered state diagram.
- **Recommendation:** MUI `Stepper` on the incident detail view *plus* a status-grouped
  board on the Admin/Engineer dashboard. The stepper satisfies the literal requirement for a
  low cost; the board is where it earns Design points. Drag-to-transition only if AD-17 is
  already enforced server-side.

#### DECIDED — stepper per incident, status board per dashboard

- **Stepper** on the incident detail view, for every persona, starting at `Unassigned`
  (AD-17). It answers the requester's
  question — "where is my ticket?" — which is the service-desk half of the product.
- **Status-grouped board** on the Admin/Engineer dashboard. It answers the dispatcher's
  question — "what is open, and what is stuck?" It is a triage view, not a planning board
  (see the Domain guard).
- **Drag-to-transition is conditional**, not promised: only after AD-17's transition table
  is enforced server-side, and every drop goes through the same transition endpoint as a
  button would. The server stays the only authority; the board never decides legality.
- **`Blocked` is a detour, not a step.** The stepper renders the linear path and shows
  `Blocked` as an error state on the current step (MUI `Step` `error`), with the reason
  from the status history — not as a fourth box between `In Progress` and `Resolved`.
- **Not settled here:** the drag-and-drop library (AD-10, and only if drag is built); which
  columns or filters the Engineer's board shows versus the Admin's (AD-19) — since decided: the
  engineer's full visibility, assigned or reported (2026-09-24).
- **Lands at:** M11.

#### Built 2026-09-24 (M11) — dashboard frontend

- **`/dashboard` route**, gated to `admin` and `engineer` (`DASHBOARD_ROLES`,
  `frontend/src/utils/roles.js`). `/` redirects by role (`homePath`); staff land on
  `/dashboard`, employees on `/tickets`; an employee who navigates to `/dashboard` directly
  is redirected to `/tickets`. **This gating is presentation only** — the nav link and the
  route redirect are UI convenience; the server still returns `403` on admin-only report
  endpoints for an engineer or employee (AD-09 is what actually enforces it).
- **Admin view:** summary plate + category/priority breakdown bars (`/summary`); "Needs
  attention" — blocked and escalated (`/attention`); a status board with six columns in
  workflow order (`unassigned…closed`), `blocked` shown as an error state, no
  drag-and-drop (per this decision's condition — AD-17 enforcement alone doesn't buy drag,
  nobody built it), cards link to `/incidents/:id`; timings (median time to assign /
  acknowledge / resolve, with count and average, `/timings`); hotspots — top 5 buildings,
  floors, seats (`/hotspots`).
- **Engineer view:** summary, breakdowns, and board only — **visibility-scoped server-side**
  (assigned to them or reported by them, the AD-19/Role-inheritance rule), not a separate
  query. Admin-only report endpoints (`/attention`, `/timings`, `/hotspots`) are never
  requested for an engineer, so the UI doesn't rely on the `403` it would get.
- **Board is six list calls, not one.** `getBoard()` (`frontend/src/services/reportService.js`)
  calls `GET /api/incidents?status=<s>&limit=6` once per status, sharing one
  `X-Correlation-Id` (AD-16) across the six requests. Each column keeps the server's own
  `total`, so "+N more not shown" is accurate even though only 6 cards render. **Rejected:**
  one paged list split client-side — a single page could be entirely one status (e.g. all
  `closed`), leaving no way to show the other five columns' true counts. `resolved` and
  `closed` sort `-updated_at`; the other four keep the incidents list's default triage sort.
- **Polling split (refines AD-14's "dashboards 30 s"):** summary, attention, and the board
  poll every 30 s, paused when the tab is hidden. **Timings and hotspots are on demand
  only** — load once, plus a Refresh button — because they scan the full status history and
  change slowly. `usePolling` (`frontend/src/hooks/usePolling.js`) gained an on-demand mode:
  passing `intervalMs = null` loads once and only reloads when `reload()` is called.
- **Verified 2026-09-24:** 121 Vitest tests pass, coverage 99.7% statements / 96.2%
  branches; lint and build clean (the pre-existing >500 kB chunk warning is unchanged); the
  local Cypress core-journey spec passes; deployed to CloudFront, where a cloud Cypress
  check confirmed the employee `/dashboard → /tickets` redirect and the hidden nav link.
  **The admin dashboard itself has not yet been checked by a person in the cloud** — the
  user is verifying it; treat that view as unverified in the cloud until confirmed.
- **Known gaps, recorded not fixed:**
  1. `/api/reports/hotspots` floor and seat rows carry only `parent_id`, not the parent's
     name, so `HotspotList.jsx` prefixes the parent name only when that parent is in the
     same response (`withParent()`). Backend fix, not yet done: return `building_name` /
     `floor_name` from the query.
  2. No admin all-incidents list page exists, so a board column's "+N more not shown" is
     text, not a link.
  3. The incident page shows the Grant/Decline escalation buttons even when no escalation
     is pending — `IncidentActions.jsx`'s `decisions` list is filtered only by
     `actions.set_escalation` and the current `escalation_status`, not by whether a request
     is actually `pending`. A fix was offered when found; not yet accepted.
- **Engineer board scope — DECIDED 2026-09-24 (user):** assigned-or-reported, the engineer's full
  server visibility; no `assignee_id` filter. The board and the summary counts beside it cover the same tickets.

#### Built 2026-09-24 — history timeline

`HistoryTimeline.jsx` on the incident detail view, beside the stepper: every status change,
newest first (the stepper above reads oldest to newest, so the two are deliberately opposite
directions). Each row shows the move, the actor, the holder when it changed, the reason, and
absolute plus relative time. It reads `history` from the existing `GET /api/incidents/{id}`
response (AD-19's E3 gap-closure), so it refreshes on the same 20 s poll (AD-14) and makes no
request of its own. Phones show the latest 3 plus a "Show all" toggle. Verified: 129 Vitest
tests pass, 99.73% statements / 96.27% branches, lint clean, a local Cypress check on a real
incident, deployed to CloudFront.

**Reading history outside the UI:** `GET /api/incidents/{id}` returns the full `history`
array; locally the raw rows are also queryable via `psql` against
`incident_status_history`; CloudWatch logs are request logs (AD-16), not ticket movement —
they show a call was made, not what changed.

#### Built 2026-09-24 (M11) — dashboard section nav and ticket lookup (commit `b16fe04`)

Left sticky nav on desktop; a sideways-scrolling row pinned to the top on phones. Highlights
the section in view via `IntersectionObserver`. Entries: Needs attention / Right now, Tickets
by status, How fast tickets move, Where problems occur, Who's available (admin), and Lookup
tool with History nested under it. Engineers see only Right now, Tickets by status, and
Lookup > History.

- **Lookup:** collapsed by default and not polled. Runs `GET /api/incidents` server-side with
  `q` (300 ms debounce), multi-status, priority, category, building, engineer (admin only),
  and escalation filters. Sorts: most urgent first (the server default), newest, oldest,
  recently changed — status sort omitted because it would be alphabetical. 20 per page; any
  filter change returns to page 1. **Closes the MVP "Search and filter" capability in the
  UI.**
- **History:** a collapsed child of Lookup; stays pending until a result is picked, then shows
  that ticket's `HistoryTimeline`.
- **Fixed bug:** `srOnly` in `theme.js` used `width: 1`, which MUI reads as `100%`, so the
  dashboard was 2602 px wide in a 1280 px window. Changed to `'1px'`; the board and table
  scroll wrappers are now `position: relative`. The dashboard page is 1320 px wide (dashboard
  only).

**Wording — decided 2026-09-24 (user):** the nav entry and the hotspots heading both read "Where problems occur".

#### Built 2026-09-24 (M11) — admin "Who's available" (commit `bc87575`)

Answers the AD-19 question "Which engineers are available, and how is work distributed
across them?" and **covers "create engineer profiles" in the UI.**

- **Table:** `GET /api/engineers?sort=workload`, least loaded first, with a workload bar per
  engineer; polled at 30 s and re-read after each action.
- **Availability switch:** `PUT /api/engineers/{id}/availability`.
- **Make engineer:** search employees via `GET /api/auth/users?role=employee`, then
  `PUT /api/auth/users/{id}/role {role: engineer}`.
- **Demote:** a confirmation dialog stating how many active tickets return to `Unassigned`,
  Cancel focused by default; sends `{role: employee}`, lists the returned tickets from
  `unassigned_incidents`, and reloads the summary, board, and attention list. Including
  demote, with this confirmation shape, was the user's call. **Caveat for the demo:**
  promoting back does not return the tickets; they must be reassigned by hand.
- **Verified 2026-09-24:** 156 Vitest tests pass, 99.48% statements / 95.82% branches; lint
  and build clean; browser-checked locally at 1280 px and 375 px; deployed to CloudFront.

### AD-19 · Dashboard and reporting strategy

"Basic dashboard/reporting per persona" — three different dashboards, plus the seven
analytical questions.

- **Decide:** per-persona dashboard content (Employee: my tickets by status · Engineer: my
  queue, workload, aging · Admin: org-wide counts, recurring-issue hotspots, MTTA/MTTR,
  engineer distribution) · aggregation in SQL vs in the client · whether dashboards get
  dedicated endpoints or reuse filtered list endpoints with counts · caching/materialization
  if queries get slow.
- **Recommendation:** dedicated read endpoints returning pre-aggregated rows — `GROUP BY`
  in PostgreSQL is far cheaper than shipping every incident to the browser to count, and the
  recurring-issue and MTTA/MTTR questions are genuinely SQL problems.
- **Depends on:** AD-17 (timing metrics need the history table).

#### Frontend gaps closed before the first cloud deploy (2026-09-23)

Found by the frontend agent's phase-1 plan; each closed with the smallest backend change.
- **E1 / E2 — names:** migration `002_read_views.sql` adds `incidents_read` (location names
  with archived flags, reporter and assignee names) and `ticket_notes_read` (author name and
  role). Reads use the views; writes stay on the base tables; row locks are taken on the base
  row first, because PostgreSQL refuses `FOR UPDATE` through the view's outer joins. A view's
  columns are fixed at creation — a migration that adds a column to `incidents` or
  `ticket_notes` must recreate the view. Incident JSON: `reporter_name`, `assignee_name`,
  `location: {building, floor, seat}` each `{id, name, archived}` or `null`. Reports:
  `assignee_name` in `/attention`.
- **E3 — history:** `GET /api/incidents/{id}` embeds `history` (from, to, at, actor and
  holder ids and names, reason). Detail only — lists stay light.
- **E4 — activity:** adding a note bumps the incident's `updated_at` in the same transaction.
- **E5 — `reporter_id` filter:** added (reopens part of AD-13's M9 audit, by the user's
  instruction to fix the flagged issues).
- **E6:** `/summary.oldest_active` carries `title`.
- **E7 — ISO 8601:** the wrapper serialises datetimes with `.isoformat()` (a `T`, not a
  space), which every browser parses; other non-JSON values fall back to `str`.
- **E8, E9:** doc and scaffold fixes (VITE_API_URL is empty locally; the two ESLint plugins).
408 tests, 100%. The migrate tests now derive the real migration list instead of
hard-coding `001_init`.

#### DECIDED — a read-only `reports` service, aggregated in SQL (2026-09-23)

- **Architecture:** a `reports` service (planned in AD-01) with dedicated read-only
  endpoints aggregating in PostgreSQL (`GROUP BY`, `percentile_cont`), never shipping rows
  to the browser to count. The incident visibility filter moves from `incidents/policy.py`
  to `_shared/visibility.py`, because two services now need exactly the same rule (the
  `incident_ops` precedent).
- **Endpoints:** `GET /summary` (any role, scoped by visibility — counts by status,
  priority, category, escalation, and the oldest active ticket; the employee and engineer
  dashboards are this endpoint seen through their own visibility); `GET /hotspots` (admin
  — top buildings, floors, seats by incident count); `GET /timings` (admin); `GET
  /attention` (admin — blocked incidents with the reason from history, pending or granted
  escalations with the reporter's reason from the note). Engineer distribution reuses
  `GET /api/engineers?sort=workload` (M7).
- **No time window.** `hotspots` and `timings` take the same repeatable `status` filter as
  the incidents list, so old closed tickets can be excluded by status.
- **Three timings, all reconstructed from `incident_status_history` and all measured from
  the creation row,** so they read as one timeline from the reporter's side: **time to
  assign** (→ first `unassigned → open`), **time to acknowledge** (→ first
  `open → in_progress`, the engineer's acknowledgement gate from AD-17), **time to resolve**
  (→ first move to `resolved`). Each as count, median, and average; first occurrence,
  because reassignment can repeat a step. Measuring acknowledgement from creation rather
  than from assignment keeps the three comparable (medians cannot be subtracted).
  *History of this decision, 2026-09-23:* first proposed with acknowledgement omitted, then
  redefined as assignment ("an admin must review a ticket to assign it"), then **reverted by
  the user to the `open → in_progress` gate** — this entry is the settled version.
- **"How effectively are employees informed"** is pinned as a **frontend (M12)** concern —
  it reads as a UX question (how progress reaches the reporter) rather than a metric; no
  endpoint.
- **No caching or materialisation:** live queries at this scale; README scope cut.
- **Built 2026-09-23 (M10).** `backend/reports` (`/summary`, `/hotspots`, `/timings`,
  `/attention`) and `_shared/visibility.py` (incidents' `policy.visibility` now imports it,
  so one rule serves both services). Timings: one pass over the history with `FILTER`
  clauses finds each incident's creation, first assignment, first acknowledgement, first resolution;
  `percentile_cont(0.5)` gives the median. Hotspots include archived locations (flagged),
  because history is the point. Attention takes the blocked reason from **history** and the
  escalation reason from the **reporter's** latest escalation note (the admin's decision
  note is not the "why"). Tests use explicit history timestamps so medians are computed by
  hand (60 / 100 / 180 s → median 100); counting the *last* assignment instead of the
  first moves it to 180 and fails the test. 400 tests, 100%. Live: employee summary 3 vs
  admin 4 (visibility), escalation reason shown, employee `/timings` 403; live timings read
  0 s because scripted live checks act within the same second.

### AD-20 · Priority and escalation model

The statement explicitly delegates this: "request or manage incident priority/escalation
**based on the product design**."

- **Decide:** the priority scale (P1–P4 vs Low/Medium/High/Critical) · who sets it at
  creation (employee self-select vs system default vs admin triage) · whether an Employee
  *requests* an escalation that an Admin approves, or sets priority directly · what
  "escalated" is — a boolean flag, a priority bump, or its own state orthogonal to status ·
  whether escalation is auto-triggered by age/SLA.
- **Recommendation:** employee proposes a priority at creation, Admin can override;
  escalation as a separate flag with a reason and timestamp, orthogonal to workflow status.
  Keeping escalation out of the status enum avoids a combinatorial state machine in AD-17.

#### DECIDED — two priority fields; escalation as a request an admin decides (2026-09-23)

**Priority**

- **Scale: `Low` / `Medium` / `High` / `Critical`**, stored as a ranked value (1–4) so
  sorting by priority is numeric, with labels in the API. Unambiguous to employees, unlike
  P1–P4.
- **Two fields.** `requested_priority` — the employee's pick at creation, never changed.
  `priority` — the working value, initialised to the request and set by an admin at
  triage (naturally while `Unassigned`, AD-17). The gap between them shows how often
  requests are corrected.
- **Only admins change `priority`.** Engineers and employees cannot.

**Escalation**

- **A request the employee makes and an admin decides.** Granting triggers nothing
  automatically: escalation means different things for different issues, so the admin
  chooses the response (raise priority, reassign, act outside the system).
- **One field on `incidents`:** `escalation_status` ∈ {`none`, `pending`, `granted`,
  `declined`}. No separate table, no reason or timestamp columns. A new request overwrites
  the previous status — past requests and decisions are **not** kept. Accepted trade: the
  navigation is simpler, and request history is not a question the app must answer.
- **The reason lives in the conversation.** A request requires a reason, posted as a note
  in the same transaction that sets `pending` (like `Blocked`). "Why is it escalated" and
  "when was it requested" are read from that note. Trade: notes are soft-deletable by
  their author (AD-01 → Ticket notes), so the reason can be hidden, and the report joins
  to notes rather than reading a column.
- **Employee:** may request on their own incident, any status except `Closed`, with a
  required reason, whenever `escalation_status` is not `pending`.
- **Admin:** may set `escalation_status` to `none`, `granted`, or `declined` from any
  value, at any time — deciding a pending request, withdrawing a grant, reversing a
  decline, or switching between them. `pending` is reachable only through an employee
  request.
- **Every escalation change posts a note with a required reason** — the employee's
  request and every admin change alike, in the same transaction as the status update.
  The employee is always informed, and the conversation shows reversals; the notes are
  the only record.
- **"Escalated"** = `escalation_status = 'granted'` on a non-`Closed` incident — the answer
  to "which incidents are escalated, and why".
- **Engineers take no part.** They raise problems through `Blocked`.
- **Admin dashboard:** a pending-requests panel with a count badge, refreshed by polling.
  No push — `infra/` has no WebSocket/push path (AD-14). Lives in the `incidents` service.
- **No automatic escalation by age/SLA** — it needs a scheduled job and `infra/` has none.
  Ticket age is shown on the dashboard instead (AD-19). Stated scope cut.

### AD-21 · Registration, email restriction, and persona assignment

- **Decide:** how the `acme.inc` email restriction is enforced (validate the domain at
  registration — server-side, not just in the form) · whether email verification is required
  (**note: there is no email infrastructure in `infra/`** — SES would be new infra; a
  verification flow is probably out of scope, and should be stated as such) · how someone
  becomes a Facility Admin or Engineer, given that self-registration yields Employees ·
  whether Admin-created "engineer profiles" are the same record as a login account or a
  separate entity linked to one.
- **Recommendation:** self-registration creates Employees only, with server-side domain
  validation and no email verification (documented as a scope cut). Seed one Facility Admin
  via the schema/migration step. Treat an engineer profile as a row linked to a user account
  rather than a duplicate identity — otherwise assignment and login drift apart.
- **Depends on:** AD-03 (seeding), AD-07.

#### DECIDED — Employee-only registration, promotion for other roles, seeded first admin (2026-09-23)

- **Domain check, server-side, exact match.** Email is trimmed and lowercased; the part
  after the single `@` must equal `acme.inc`. Rejects `x@acme.inc.evil.com`,
  `x@notacme.inc` (why not a suffix check), and `x@mail.acme.inc` (no subdomains). Unique
  index on the lowercased email. The frontend check is convenience only.
- **No email verification.** No email infrastructure in `infra/`; already a stated cut in
  `README.md` → Deliberately not done.
- **Registration produces Employees only.** Any `role` field in the request is ignored.
- **Engineer:** a Facility Admin promotes an existing user by creating their engineer
  profile; role change and profile insert in one transaction (AD-04). Admins never set
  another user's password, so no forced-reset flow is needed.
- **Facility Admin:** the first is **seeded by the private `_migrate` Lambda** (AD-03),
  only if no admin exists, from an email and bcrypt hash supplied as Terraform variables
  from the environment — never committed. Nothing public can trigger it. Further admins
  are promoted by an existing admin. **No fourth super-admin role** (answers AD-09's
  bootstrap question).
- **Data model:** `users.role` ∈ {`employee`, `engineer`, `admin`}, one role per user.
  `engineer_profiles.user_id` is a unique FK — one-to-one — holding engineer-only fields
  (M7). **Assignment references the user**, so login identity and assignee cannot drift.
- **"Only engineers are assignees" is NOT enforced by the database** (2026-09-23).
  `incidents.assignee_id` references `users`, not `engineer_profiles`: an FK to the profile
  would make the profile undeletable while `Resolved`/`Closed` tickets still reference a
  demoted engineer. The `incidents` service must check `role = 'engineer'` on every
  assignment, in the same transaction as the write — it is the only guard.
- **Role changes take effect at the next access-token refresh** (minutes), since the role
  travels as a claim (pending AD-09).
- **Demoting an engineer auto-unassigns their active tickets**, in the same transaction as
  the role change: every `Open`, `In Progress`, or `Blocked` incident assigned to them moves
  to `Unassigned` (AD-17), with a system-supplied reason ("assignee removed from the
  engineer role") stored on the history row and posted as a note; the actor is the admin
  who demoted them. `Resolved` and `Closed` incidents keep their assignee — the work is
  done, and moving a `Resolved` ticket back would undo the resolution. *(Confirmed
  2026-09-23.)*
- **First-admin seeding built (2026-09-23).** `backend/_migrate/function.py:_seed_admin`
  runs after `001_init`'s migrations apply, inside the same advisory lock and transaction
  (AD-03). `infra/migrate.tf` passes `bootstrap_admin_email` / `_name` / `_password_hash`
  (`infra/variable.tf`) in the Lambda's **invocation input**, not its environment
  variables, so the values are not left visible in the function's configuration.
  Terraform receives a **bcrypt hash, never the plaintext password** — Terraform state
  stores variable values in plain text, and this also means `_migrate` carries no bcrypt
  dependency. `bootstrap_admin_password_hash` is `sensitive = true`; a plaintext test
  value did not appear in `terraform output` (`(sensitive value)`). If an admin already
  exists, seeding is a no-op ("exists"). Otherwise it **fails the deploy** rather than
  proceeding silently: email or hash unset → error naming the missing `TF_VAR_...`; a
  value not matching the bcrypt pattern (`$2[aby]$NN$...`, 53 chars) → refuses plaintext;
  the email already registered under another role → no silent promotion. Verified with
  real local deploys, throwaway values since removed: no vars → deploy exit `1` with the
  message; plaintext value → exit `1` "not a bcrypt hash"; valid hash → seeded, `$2b$12$`
  hash, `bcrypt.checkpw` verifies; redeploy with a changed name → "exists", unchanged;
  email already an employee → exit `1` "already registered as employee". Local DB has 0
  users after cleanup. **Cloud apply not yet run.**

#### M4 scope and role administration (2026-09-23)

- **M4 = role administration + a persona access matrix.** Roles, closed-by-default route
  checks, and the `403`/`404` shape already exist (M3, AD-09, AD-12). Row-level ownership
  and transition authority need incidents, so they land with M5 on the AD-09 pattern.
- **Option A — one role endpoint in `auth`:** `PUT /api/auth/users/{id}/role`, admin only,
  handles every change in one transaction: promotion to engineer creates the
  `engineer_profiles` row; leaving the engineer role deletes it and auto-unassigns the
  user's `open`/`in_progress`/`blocked` incidents. `GET /api/auth/users` lets admins find
  people (provisional `q` / `role` filters and a 50-row cap until AD-13 settles
  pagination).
- **The unassign operation lives once, in `_shared/incident_ops.py`** — both `auth`
  (demotion) and `incidents` (admin reassignment, AD-17) need it, which is exactly what
  `_shared` is for. It moves the incident to `unassigned`, writes the history row with
  the reason, and posts an `unassigned` note, inside the caller's transaction.
  Rejected: splitting role changes between `auth` and `engineers` (B); demotion writing
  its own incident SQL (C, the rules would exist twice).
- **The last admin cannot be removed** (`409`): with no admin nobody can ever promote
  anyone, and seeding only runs when no admin exists, so it could not recover.
- **Built 2026-09-23.** `_shared/incident_ops.py` (`unassign`, `unassign_all_for`; locks the
  incident row, skips `resolved`/`closed`/deleted, writes status + history + note in the
  caller's transaction); `auth` `GET /users` and `PUT /users/{id}/role`. **Deadlock avoided
  by lock ordering:** every role change first locks all admin rows `ORDER BY id`, then the
  target — two admins demoting each other queue on the same locks and the second gets a
  clean `409`, instead of each holding one lock and waiting on the other. *This is argued,
  not tested:* a real test needs two concurrent requests on separate connections, which
  the single-connection test harness cannot produce. Verified: 140 tests (100%) including
  9 `incident_ops` tests (all three writes roll back together) and a persona access matrix
  over every `auth` route × {anonymous, employee, engineer, admin}; live through `:3001` —
  employee `403` on `/users`, admin search `200`, promotion `200` creates the profile,
  sole-admin self-demotion `409`.

#### M5 scope (2026-09-23)

- **Reporting:** any signed-in user (roles inherit employee capabilities); the reporter is
  always the caller, never taken from the body.
- **Editing fields (`PUT /incidents/{id}`):** the reporter may edit title, description,
  category, and location only while `unassigned`; admins may edit them any time;
  `priority` is admin-only (AD-20); engineers change status, never fields.
- **M5 includes assignment and escalation.** `unassigned → open` happens only through
  assignment, so the workflow cannot be tested without it; escalation's field lives on
  `incidents`. M7 keeps engineer profiles and availability.
- **Phase A built (2026-09-23): the rules as pure code.** `backend/incidents/workflow.py`
  (AD-17 transition table, `allowed_transitions`, `check_transition` with a distinct
  error per refusal: unknown status / same status / unassigned leaves only by assignment
  → `400`; not permitted → `403`; missing reason → `400` with `fields`) and
  `backend/incidents/policy.py` (AD-09 SQL visibility with the reported-or-assigned union,
  `can_view`, `editable_fields`, `can_request_escalation`, `actions`). `_shared/incident_ops`
  refactored so `apply_transition` is the single writer of a status change and `unassign`
  is built on it — legality stays in `workflow.py`, recording is shared. Tests: expected
  engineer moves written out by hand from AD-17 (not derived from the code), an exhaustive
  role × ownership × status-pair sweep, policy matrices; 206 total, both modules 100%.
- **Phase B built (2026-09-23): CRUD and lists.** `_shared/listing.py` (AD-13: `paging`,
  allow-listed `order_by` with an `id` tie-breaker for stable pages, `envelope`), used by
  incidents and now `/users` (the 50-row cap is gone). Incidents: `POST /` (any role;
  reporter is the caller; `extra="forbid"`, so a body naming `reporter_id` is a `400`;
  location validated by the service, including archived), `GET /` (visibility + filters +
  paging + triage default sort; `LIKE` wildcards in `q` escaped), `GET /{id}` (with
  `actions`), `PUT /{id}` (per-field `editable_fields`, location edited as a unit, a new
  building resets floor and seat), `DELETE /{id}` (admin soft delete). Health moved to
  `/health` because `/` is the list. 258 tests, 100%. Live on LocalStack: report 201,
  filtered list, other employee 404, reporter edit 200, reporter priority 403, no token
  401. **Live-test residue:** the append-only history trigger rightly refused cleanup, so
  live checks leave permanent rows in the dev database (see README → Testing). Left in
  place by decision (2026-09-23). Live checks cannot use a throwaway schema — the deployed
  Lambdas always connect to `public` — so they use distinct `live.*` names instead.
- **Phase C built (2026-09-23): transitions and assignment.** `POST /{id}/transitions`
  `{to, reason?}` (row locked; `workflow.check_transition`; `apply_transition`; moving to
  `unassigned` releases the engineer; `blocked` / `unassigned` post a note of that kind) and
  `POST /{id}/assignment` `{engineer_id}` (admin; only from `unassigned`; the target must
  have `role = 'engineer'` — the rule the database does not enforce, AD-21). Assigning an
  engineer with `is_available = false` is **allowed for now**; whether to refuse or warn is
  an open question for M7. 275 tests, 100%, incl. a full-lifecycle test asserting the whole
  history timeline row by row. Live: assign / acknowledge / engineer close 403 / blocked
  without reason 400 / resolve / admin close, with `actions.transitions` differing per caller.
- **Phase D built (2026-09-23): escalation (AD-20).** `POST /{id}/escalation` `{reason}`
  (reporter only, via `policy.can_request_escalation`: not `closed`, not already `pending`)
  and `PUT /{id}/escalation` `{status, reason}` (admin; `none` / `granted` / `declined` from
  any value; `pending` only by request; setting the current value is a `400`, since its note
  would announce a change that did not happen). Every change posts an `escalation` note.
  Granting changes nothing else — tested: priority and status untouched. **No dedicated
  count endpoint:** the admin panel's pending count is the AD-13 list with
  `escalation_status=pending&limit=1`, whose `total` is the count. 289 tests, 100%. Live:
  request 200, second request 403, admin count 1, admin grant 200, reporter grant 403.
- **M5 complete locally (2026-09-23).**


#### M7 — engineers service (2026-09-23)

- **`backend/engineers`:** `GET /` (admin: engineers with `is_available` and active workload —
  count of `open` / `in_progress` / `blocked` tickets, computed by join at read time so it
  cannot drift; filters `available`, `q`; sort `name`, `email`, `workload`; AD-13 paging),
  `GET /me` (engineer: own profile), `GET /{user_id}` (admin), `PUT /{user_id}/availability`
  (admin, or that engineer).
- **Assigning an unavailable engineer is refused** (`400`). An admin who needs that person
  switches availability on first — a deliberate act, not an accident.
- **Going unavailable keeps current tickets.** Unavailable means "no new work", not "take
  my work"; an admin reassigns through `unassigned` if needed.
- **Only admins see the engineer list;** engineers see only themselves via `/me`.
- **No specialties** (categories an engineer handles): no required question needs them;
  README scope cut.
- **Built 2026-09-23.** The workload aggregate sits in a named subquery (`WITH engineers AS
  …`) so every column has one unambiguous name — the shared sort builder's `id` tie-breaker
  would be ambiguous across `users` / `engineer_profiles` / `incidents` in a plain join.
  `GET /me` beside `GET /{user_id}` relies on the AD-05 specificity fix (literal wins).
  `incidents` assignment now refuses an unavailable engineer, and an engineer role with no
  profile row (inconsistent data) is refused too; incidents test fixtures now create
  profiles the way M4 promotion does. 346 tests, 100%. Live: admin list by workload 200,
  employee 403, engineer `/me` 200, self-unavailable 200, assign refused 400, admin
  re-enable 200, assign 200.

### AD-22 · Facility hierarchy modelling

Buildings → floors → seats, with "recurring issues per building/floor/seat" as a required
report.

- **Decide:** three tables with FKs vs one self-referential `locations` table with a type
  column · whether an incident references a seat, or any level of the hierarchy (a lobby
  issue has no seat) · whether deleting a building with incidents is blocked, cascades, or
  soft-deletes · whether seats map to occupants.
- **Recommendation:** three explicit tables, with the incident holding a nullable
  `seat_id` plus a required `floor_id`/`building_id` so non-seat incidents are still
  locatable and the rollup report stays a simple join. Soft-delete facilities — hard
  deletion destroys incident history the reports depend on.

#### DECIDED — three tables, composite FKs, soft delete, no occupants (2026-09-23)

- **Three tables:** `buildings`, `floors(building_id → buildings)`,
  `seats(floor_id → floors)`. The spec names exactly three levels; a self-referential
  `locations` table would need recursive CTEs for rollups and cannot enforce "a seat's
  parent is a floor" by FK.
- **Incident location:** `building_id` required, `floor_id` nullable, `seat_id` nullable
  and only allowed when `floor_id` is set (`CHECK (seat_id IS NULL OR floor_id IS NOT NULL)`).
  A lobby leak has no seat; a broken elevator has no floor. *(Supersedes the earlier
  recommendation's required `floor_id`.)* The hotspot report is a plain `GROUP BY` at each
  level on `incidents`, no joins.
- **Composite foreign keys keep the three columns consistent.** `floors` gets
  `UNIQUE (building_id, id)` and `seats` gets `UNIQUE (floor_id, id)`; `incidents` references
  `(building_id, floor_id) → floors (building_id, id)` and
  `(floor_id, seat_id) → seats (floor_id, id)`. The database itself rejects a seat on the
  wrong floor or a floor in the wrong building. PostgreSQL's default `MATCH SIMPLE` skips
  the check when any column is null, which is exactly the "building only" / "no seat" case.
- **Soft delete:** `archived_at` on all three tables. Archived locations cannot be chosen
  for new incidents; existing incidents keep pointing at them, so hotspot history stays
  whole. Archiving a building archives its floors and seats in one transaction (AD-04).
  Hard delete is blocked by the FKs (`ON DELETE RESTRICT`).
- **Names unique within their parent:** building name globally, floor name per building,
  seat label per floor — case-insensitive, via partial unique indexes over non-archived
  rows only, so an archived "HQ" does not block a new "HQ".
- **"Not archived" is NOT enforced by the database** (2026-09-23). An FK proves a row
  exists, not that `archived_at` is null. The `facilities` service must refuse a floor on an
  archived building or a seat on an archived floor; the `incidents` service must refuse an
  incident on an archived building, floor, or seat.
- **No seat occupants.** The spec never maps people to seats; users carry no `seat_id`.
  Stated scope cut.
- **Ownership:** the `facilities` service (AD-01). Facility Admin writes; every
  authenticated persona reads, since employees pick a location when reporting.
- **M6 details (2026-09-23):** archived locations are **hidden everywhere** — lists and
  direct `GET` (`404`), no `include_archived` option. **No restore** (scope cut: restoring
  collides with name uniqueness). **No moving** a floor between buildings or a seat between
  floors — `PUT` accepts only the name/label; renaming is allowed. **Duplicate names** get a
  friendly `409` from a service check, with the partial unique index as the backstop.
  `DELETE` means archive (`204`), cascading building → floors → seats in one transaction.
  **Consequence to handle at M11/M12:** a UI showing an old incident cannot fetch an
  archived location's name from `facilities`; the planned approach is for incident
  responses to carry location names via a join in `incidents` (not decided).
- **Built 2026-09-23 (M6).** `backend/facilities`: one `Level` table (buildings → floors →
  seats) drives list / create / read / rename / archive, so the three levels share one
  implementation; SQL identifiers come only from that fixed table. The API uses `name` at
  every level (stored as `label` for seats). Create re-checks the parent **under
  `FOR SHARE` inside the transaction** — the same check-then-act race as transitions: a
  parent archived between the first check and the insert would otherwise gain a child.
  A test reproduces the race deterministically (the first check archives the floor as a
  side effect); removing the re-check makes it fail with a `201`. Also: `testing_support.py`
  (test-only signing helpers, shared by service tests instead of copied), and the test
  loader now registers each module in `sys.modules` before executing it (dataclasses
  resolve forward references through it). 323 tests, 100%. Live: create at all three
  levels 201, duplicate 409, employee write 403 / read 200, archive cascade 204 then 404.

---

## First cloud deploy — verification (2026-09-23)

Deployed to AWS (`us-east-2`), CloudFront `https://d2bwm7q2v18xxo.cloudfront.net`. The Aurora
cluster and CloudFront distribution were pre-provisioned by the workshop (cluster created
2026-09-22); the first plan was `61 to add, 1 to change, 0 to destroy`.

| Check (source) | Result |
|---|---|
| Aurora not publicly reachable (AD-03) | Confirmed: `PubliclyAccessible = false` |
| `_migrate` reaches Aurora via the VPC (AD-03) | Confirmed: same VPC, subnets, and self-referencing SG; `001_init`, `002_read_views` applied |
| First admin seeded (AD-21) | Confirmed: `seeded first admin you@acme.inc` |
| Aurora resume vs `connect_timeout` (AD-04) | **Pausing kept** (`min_capacity = 0`, the user's call): the first request after idle waits ~15–20 s instead of paying for idle capacity. **Failed first deploy:** capacity 0 until the first connection, then 2 ACU — after the 15 s timeout. Fixed: `connect_timeout=25` (under CloudFront's 30 s origin timeout); redeploy passed |
| Direct Function URL (AD-08b) | `403` — origin sealed |
| `POST`/`PUT` body hash through OAC (AD-08b) | **Confirmed required:** without `x-amz-content-sha256` → `403` signature mismatch; with it → `201`. The frontend fetch wrapper must hash every body |
| `X-Access-Token` survives OAC signing (AD-08c, M1) | Confirmed: `/me` → `200` |
| Refresh cookie through CloudFront (AD-08a) | Confirmed: refresh `200` |
| `cookies` field vs `Set-Cookie` header (M3) | AWS honours **both** → two identical `Set-Cookie` headers. **Kept deliberately:** the same code must run on LocalStack (header only) as a demo fallback if the cloud fails; the duplicate is harmless (same name, path, value) |
| `lambda:InvokeFunction` needed beside `InvokeFunctionUrl` (AD-08b) | Not isolated — both are granted and invocation works |
| bcrypt cost 10 at 128 MB (M3) | Login: 6.5 s cold, **1.73 s warm**. **Decided:** `auth` alone doubled to 256 MB (not 512 — the user's call); cost stays 10. **Measured after:** warm login **0.87 s** (halved, as CPU scales with memory); first login after idle 18.7 s = cold start plus Aurora resume, absorbed by the 25 s timeout |
| CloudWatch JSON lines (AD-16) | Clean, parseable; LocalStack's `END RequestId` concatenation is LocalStack-only |
| `rawPath` decoding in AWS (AD-05) | Not observed; low impact (all path ids are numeric) |

## Frontend cloud deploy — verification (2026-09-24)

Deployed with `./bin/deploy-frontend.sh` (aws mode: refresh credentials, `npm run build`,
`aws s3 sync --delete`, CloudFront invalidation of `/*`). Live on the same CloudFront domain
as the API, `https://d2bwm7q2v18xxo.cloudfront.net`.

| Check | Result |
|---|---|
| `/` and deep links (`/tickets`, `/incidents/1`, `/report`) | `200` HTML (AD-06/spa_rewrite fix above) |
| Static assets | `200` |
| API `404` | `404` JSON, AD-12 envelope (was `200` HTML before the CloudFront fix) |
| API `403` | `403` JSON |
| Refresh cookie | `200` |
| Cypress smoke test (sign in as `live.cloud@acme.inc`, hard reload, deep-link visit, sign out) against the cloud URL | Passed |

**Not run in the cloud:** the full core-journey Cypress spec — its admin/engineer/employee
fixture users exist only in the local database. Cloud coverage is the smoke test above only.

## Known documentation discrepancies

Do not treat the docs as internally consistent. Confirmed mismatches:

- **The repo root `README.md` describes a team-management app** (individuals, teams,
  achievements). That is workshop filler. The real assignment is the facility incident
  management platform in [Product context](#product-context). Where they conflict, the
  assignment wins.
- **`docs/full-stack.md`'s role table** (Admin/Manager/Contributor/Viewer) is an example and
  does not match the three mandated personas. See AD-09.
- `docs/validation.md` lists `docs/implementation.md`, `docs/testing.md`, and
  `docs/evaluation.md` in the repo tree. **None of them exist** (404). The role guides plus
  the root README are the real specification.
- Endpoint paths: `/<service-name>` (table) vs `/api/<service-name>` (curl examples). See AD-06.
- `frontend/.env.sample` advertises `REACT_APP_*` only; Vite requires `VITE_*`, which
  `bin/generate-env.sh` does emit.
- `frontend/README.md` lists MUI and React Router as prerequisites; neither is in
  `package.json`. See AD-10.
- `MONGO_HOST` differs between `docs/full-stack.md` and `backend/README.md`. Moot under AD-00.
- `infra/eks.tf` and `infra/helm/` belong to other tracks — ignore them.

## Agent working rules

1. [Product context](#product-context) in this file is the spec, and it overrides the root
   `README.md` example. `docs/full-stack.md` governs *how* to build, not *what*.
2. **Check this file's decision register before choosing an approach in an open area.** If a
   decision is still `OPEN`, either surface it or make it explicitly and record the outcome
   here — do not settle it silently in code.
3. Re-run `./bin/start-dev.sh` after adding a service or changing infra wiring.
4. Verify with a real `curl` against `:3001` and by tailing Lambda logs, not just by passing
   tests.
5. PostgreSQL only. Do not reintroduce MongoDB paths from the example code.
6. Never commit secrets. Participant IDs, AWS region, and the LocalStack token live in
   `~/.bashrc`; the JWT private key comes from Secrets Manager (AD-07b), with a dev key in an env var
   only when `IS_LOCAL` is true.
7. When adding a service, update the README with its purpose, endpoints, and test commands
   in the same change.
8. `./bin/cleanup-environment.sh` is irreversible — never run it without being asked.
