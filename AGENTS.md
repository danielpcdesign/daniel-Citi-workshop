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
losing every incident's history.

## Decided

| # | Decision | Choice |
| --- | --- | --- |
| AD-00 | Database | **PostgreSQL** (Aurora in cloud). MongoDB/DocumentDB is **not used** — do not add `pymongo`, `MONGO_*` handling, or `TF_VAR_aws_mongo_enabled`. |
| AD-02 | Shared-code packaging | **Vendor `backend/_shared/` into each service directory as a prebuild step**, gitignoring the copies. Physical presence is the only thing that satisfies both the zip builder and the LocalStack hot-reload mount. Not a Lambda layer, not a second `source_path` entry. |
| AD-07 | Auth mechanism | **Self-issued JWT, implemented for real** — signed token, carried in `X-Access-Token` (AD-08c), verified in every handler, with expiry. Not OAuth, not Cognito. A sign-in that returns a user without issuing a token does not satisfy this. |
| AD-07a | Signing algorithm | **RS256.** Only the `auth` service holds the private key; all other services verify with the public key, distributed as a plain env var. |
| AD-07b | Signing key storage | **AWS Secrets Manager**, private key only, read by the `auth` service alone and cached at module scope. Local dev reads a dev key from an env var. |
| AD-07c | Password hashing | **bcrypt** — argon2id's memory-hardness is a direct cost in Lambda. |
| AD-07d | Refresh tokens | **Yes, rotated on every access-token request**, with server-side state, stored hashed, and **reuse detection** revoking the token family. |
| AD-08a | Token storage | **Refresh token in an httpOnly cookie** (`Secure; SameSite=Strict; Path=/api/auth/refresh`), same-origin via CloudFront. **Access token in memory only.** Single-flight refresh. |
| AD-08b | Origin sealing | **Function URLs move to `authorization_type = "AWS_IAM"` behind a CloudFront OAC** (`origin_type = "lambda"`), so only the distribution can invoke them. |
| AD-08c | Access-token transport | **`X-Access-Token` header, not `Authorization`.** OAC SigV4 signing claims `Authorization` for the signature, so the two cannot share it. Handlers read `X-Access-Token`; `Authorization` belongs to the infrastructure. |
| — | Auth sequencing | **Authentication and authorization are built before the CRUD they protect**, not retrofitted afterwards. Milestones M3–M4 in `README.md`. |
| — | Backend language | Python (mandated by the requirements + recommended by the guides) |
| — | Frontend | React + Material UI + React Responsive (mandated) |
| — | IaC / deploy | Terraform + shell scripts in `bin/` (provided) |

> **Domain guard.** This is a **task-tracking** application — incidents, facilities, engineers, notes. It is not a banking application. No accounts, balances, deposits, withdrawals, or monetary rules belong anywhere in it. Reference material from that domain may be borrowed for document *structure* only, never for domain logic or security posture.

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
| `POSTGRES_HOST` | `localhost` | Aurora endpoint |
| `POSTGRES_PORT` | `5432` | `5432` |
| `POSTGRES_NAME` / `_USER` / `_PASS` | *(empty)* | Aurora values |

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
VITE_API_URL          # api_base_url, or http://localhost:3001 locally
VITE_API_ENDPOINTS    # JSON map from Terraform output api_endpoints
VITE_LAMBDA_URLS      # JSON map service -> Lambda Function URL
```

- Responsive and accessible across common screen sizes; consistent typography, spacing,
  color, and interaction states.
- Explicit loading / success / failure states for every async action.
- Validate before submit; errors beside the relevant field; block submit until valid;
  disable the form while in flight.
- Hide or disable actions the current role cannot perform.

## API contract

| Method | Endpoint | Success status |
| --- | --- | --- |
| POST | `/<service-name>` | 201 Created |
| GET | `/<service-name>` | 200 OK |
| GET | `/<service-name>/{id}` | 200 OK |
| PUT | `/<service-name>/{id}` | 200 OK |
| DELETE | `/<service-name>/{id}` | 204 No Content |

Errors: `400` validation/malformed, `404` not found, `500` server or database error.

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
| AD-01 | Service decomposition | OPEN |
| AD-02 | Shared-code packaging | **DECIDED — vendor `_shared/` into each service** |
| AD-03 | Schema ownership and migrations | OPEN |
| AD-04 | DB access layer and connection reuse | OPEN |
| AD-05 | Intra-Lambda routing | OPEN |
| AD-06 | URL/base-path convention and frontend API client | OPEN |
| AD-07 | Auth mechanism and placement | **DECIDED — RS256 JWT + rotating refresh tokens** |
| AD-08 | Browser token storage, origin sealing, token transport | **DECIDED** |
| AD-09 | RBAC enforcement model | OPEN |
| AD-10 | Frontend dependency set | OPEN |
| AD-11 | Test stack | OPEN |
| AD-12 | Error envelope and validation approach | OPEN |
| AD-13 | Search, filter, and pagination design | OPEN |
| AD-14 | Real-time and async scope | OPEN |
| AD-15 | PWA and AI-integration scope | OPEN |
| AD-16 | Observability and structured logging | OPEN |

Domain-specific, from the facility-incident problem statement:

| ID | Decision | Status |
| --- | --- | --- |
| AD-17 | Incident state machine and transition authority | OPEN |
| AD-18 | Visual workflow representation | OPEN |
| AD-19 | Dashboard and reporting strategy | OPEN |
| AD-20 | Priority and escalation model | OPEN |
| AD-21 | Registration, `acme.inc` email restriction, and persona assignment | OPEN |
| AD-22 | Facility hierarchy modelling | OPEN |

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
- **Gitignore the vendored copies.** `backend/_shared/` stays the single source of truth in
  version control. Committing N identical copies would recreate, in the diff a grader reads,
  exactly the duplication this exists to avoid.
- Vendored `__pycache__` will not ship — the Python `patterns` are
  `["!__pycache__/.*", "!\\..*"]`.

The Lambda-layer option is not wrong, but it costs new Terraform, a second artifact to
version, and it has the *same* local-dev blind spot, so it buys nothing here.

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
- **Recommendation:** a single `schema.sql` owned by one place and applied by a deploy step.
  Do not let each service create its own tables.
- **Two tables are fixed by decisions already taken and must be in the first schema, not
  added later:** the incident status-history table (AD-17 — it cannot be backfilled) and
  `refresh_tokens` (AD-07d — rotation needs server-side state from the first sign-in).
- **Depends on:** AD-01.

### AD-04 · DB access layer and connection reuse

The example opens a fresh connection per invocation with raw `psycopg` 3 and no pooling.

- **Options:** raw psycopg3 with a module-scope connection reused across warm invocations
  (plus stale-connection recovery) · `psycopg_pool` · SQLAlchemy Core · SQLAlchemy ORM.
- **Also decide:** whether Aurora connection limits need RDS Proxy under load testing.
- **Recommendation:** raw psycopg3, module-scope lazy connection, reconnect on failure.
  SQLAlchemy Core if the query surface grows past simple CRUD.
- **Must fix regardless:** add the `sslmode=require` branch on `IS_LOCAL`, and remove the
  `test/test/test` credential fallbacks.

### AD-05 · Intra-Lambda routing

Function URLs hand the whole path and method to one handler; there are no gateway routes.

- **Options:** hand-rolled dispatch on `event["requestContext"]["http"]["method"]` and
  `rawPath` · AWS Lambda Powertools resolver · FastAPI + Mangum · Flask + aws-wsgi.
- **Recommendation:** AWS Lambda Powertools for Python — routing, request validation, and
  structured logging in one dependency, which also answers part of AD-12 and AD-16.
  Hand-rolled is defensible if bundle size or cold start matters more.

### AD-06 · URL/base-path convention and frontend API client

The docs contradict themselves: the endpoint table says `/<service-name>`, the curl examples
say `/api/<service-name>`. Separately, the frontend can address services two ways.

- **Decide:** the path prefix; and whether the client uses `VITE_API_URL` + path or looks
  the service up in `VITE_LAMBDA_URLS`.
- **Recommendation:** accept both prefixes in the handler router (cheap insurance), and have
  `src/services/` resolve `VITE_LAMBDA_URLS[service]` first, falling back to `VITE_API_URL`.
  Confirm the intended prefix with the organizers.

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
| **Access** | minutes | JavaScript memory, sent as `Authorization: Bearer` | Never persisted, so a reload drops it and the refresh flow re-mints it. Not in a cookie, which keeps every mutating endpoint free of CSRF surface. |
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
  the guide's table as illustrative only. Decide whether a fourth super-admin role is needed
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

### AD-10 · Frontend dependency set

`frontend/package.json` currently has only `react`, `react-dom`, Vite, and ESLint. **Material
UI, React Router, and React Responsive are required by the requirements but are not installed.**

- **Install:** `@mui/material @emotion/react @emotion/styled react-router-dom react-responsive`.
- **Still open:** data fetching (thin `fetch` wrapper in `src/services/` vs React Query) ·
  forms and validation (React Hook Form + zod vs hand-rolled) · MUI theming and whether to
  customize the palette.
- **Recommendation:** thin fetch wrapper first — it satisfies the prescribed `src/services/`
  structure. Add React Query only if caching and refetch behavior start costing real time.

### AD-11 · Test stack

`docs/full-stack.md` says Jest + React Testing Library, but this is a Vite project where
Vitest is the native fit and Jest needs extra ESM configuration.

- **Decide:** Vitest vs Jest · pytest setup and coverage tooling for Python (nothing is
  configured) · Cypress vs Selenium for E2E · whether coverage thresholds are enforced in CI
  or just reported.
- **Recommendation:** Vitest + RTL, pytest + `pytest-cov`, Cypress. If you deviate from the
  guide's Jest suggestion, say why in the README — a stated, reasoned deviation reads as
  judgment, an unexplained one reads as an oversight.

### AD-12 · Error envelope and validation approach

The guide demands a "consistent format" and never specifies one.

- **Decide:** the exact JSON error shape (e.g. `{"error": {"code", "message", "fields": {}}}`),
  and whether validation is hand-rolled or schema-driven.
- **Recommendation:** Pydantic v2 models as the single source of truth for request shapes,
  mapped to 400 responses by one shared error handler. The frontend renders `fields` beside
  the offending inputs.

### AD-13 · Search, filter, and pagination design

A required feature with no specified design.

- **Decide:** query-param grammar (`?q=&status=&priority=&assignee=&building=&floor=&page=&limit=&sort=`)
  · server-side SQL filtering vs client-side · pagination envelope and whether totals are
  returned · default sort for an incident list (most likely priority then age).
- **Recommendation:** server-side filtering with documented params. Incident volume plus
  per-persona list views makes client-side filtering untenable, and filtering is what the
  Employee, Admin, and Engineer views all differ by.

### AD-14 · Real-time and async scope

`docs/full-stack.md` lists "deliver real-time capabilities" and "handle async tasks" as
expected backend capabilities, but `infra/` has **no WebSocket API**. Each Lambda does have
an SQS dead-letter queue.

- **Options:** scope real-time out and justify it · short polling or optimistic UI ·
  add SQS/EventBridge to Terraform for genuine async work.
- **Recommendation:** optimistic UI plus short polling on the achievements view; state the
  trade-off in the README. Pragmatic decisions are explicitly rewarded.

### AD-15 · PWA and AI-integration scope

Both are listed as expected frontend capabilities; both are large relative to a workshop.

- **Recommendation:** declare both out of scope in the README with reasoning, and revisit
  only if the core CRUD, auth, RBAC, search, and tests are all complete.

### AD-16 · Observability and structured logging

CloudWatch retention is 7 days and the example uses plain `logging` with no structure.

- **Decide:** JSON structured logs vs plain · a correlation ID generated by the frontend and
  propagated through every service · what gets logged at INFO vs DEBUG · whether to surface
  any metrics.
- **Recommendation:** JSON logs with a request-scoped correlation ID. Cheap, and it is the
  most direct evidence for the "Observant" soft-skill score.

### AD-17 · Incident state machine and transition authority

`Open → In Progress → Blocked → Resolved → Closed` is given; the rules around it are not.

- **Decide:** which transitions are legal (is `Blocked → Open` allowed? can `Closed` reopen?
  can an incident skip `In Progress`?) · which persona may perform each (likely: Engineer
  drives In Progress/Blocked/Resolved, Admin can force any, Employee may only close or
  confirm their own) · whether `Blocked` requires a mandatory reason (the problem statement
  asks "which incidents are escalated or blocked, **and why**" — so yes) · whether an
  unassigned incident can leave `Open`.
- **Where enforced:** a single transition table in shared code, rejecting illegal moves with
  400 — not scattered `if status ==` checks across handlers.
- **Recommendation:** explicit transition map plus an append-only
  `incident_status_history(incident_id, from, to, actor_id, reason, created_at)` table. That
  one table answers the acknowledge/assign/resolve timing questions and the blocked-reason
  question at once.
- **Depends on:** AD-09 (the same decorator should carry transition authority).

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

---

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
   `~/.bashrc`; JWT signing secrets come from Lambda environment variables.
7. When adding a service, update the README with its purpose, endpoints, and test commands
   in the same change.
8. `./bin/cleanup-environment.sh` is irreversible — never run it without being asked.
