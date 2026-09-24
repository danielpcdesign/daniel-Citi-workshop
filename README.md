# ACME Facility Incident Management

A centralized platform for reporting and resolving facility and workplace-technology issues across ACME Inc. buildings, built for the **Citi Coding Workshop** on the provided AWS serverless scaffold.

Today issue reporting is fragmented across email, chat, and manual trackers: employees cannot track progress, facility admins have no end-to-end visibility, and engineers cannot manage assignments consistently. The result is delayed resolutions, duplicate tickets, and poor communication. This application replaces that with one self-service workflow and three clearly separated roles.

> **This document describes a project that has not been built yet.** Every milestone below is `Not started`. It exists now, before the first line of code, so that scope, architecture, and known traps are on the record while they are still cheap to change — and so that progress is recorded as it lands rather than reconstructed afterwards. Sections marked *(to be filled)* are deliberate placeholders, not omissions.
>
> Companion documents: **`AGENTS.md`** holds the full spec and the open architecture decisions (AD-00 … AD-22). **`CLAUDE.md`** holds working conventions. This file is the human-readable view of *where the project is*.

## What this project is not

This document's structure is borrowed from an earlier banking project. The structure transfers; **nothing about the domain or the security posture does.** Three distinctions, stated here because they are the ones that would otherwise get blurred:

- **This is a task-tracking application, not a banking application.** The domain is incidents, facilities, engineers, and notes. There are no accounts, balances, deposits, withdrawals, overdrafts, or monetary amounts anywhere in it, and no rule from that domain applies here. If a design argument starts sounding like money movement, it has come from the wrong project.
- **Security is an early milestone, not a deferred phase.** The earlier project deliberately shipped without authorization and documented the gap. **That trade is not available here and is not being made.** Authentication lands at **M3** and authorization at **M4**, ahead of the CRUD they protect.
- **JWT is a required deliverable, implemented for real.** Not "planned", not a stretch goal, not a stub that returns a user object and issues nothing. Tokens are issued, carried, verified in every handler, and expire.

## Status

| # | Milestone | Scope | State |
|---|---|---|---|
| M1 | Environment validated | VDI, `start-dev.sh`, hello-world service reachable on `:3001`, frontend on `:3000` | Done locally — `auth` answers through `:3001`, `X-Access-Token` reaches the handler. Cloud header check under OAC pending (M14) |
| M2 | Schema and migrations | incidents, facilities, engineer profiles, notes, users — **plus the status-history table** | In progress — `001_init` applied locally through Terraform; 18 database-constraint cases pass (`backend/_migrate/tests/constraints.sql`). First-admin seeding built and verified locally (real deploys: no-vars fails, plaintext fails, valid hash seeds, redeploy is a no-op, taken email fails); remaining = cloud apply |
| M3 | Authentication | Registration gated to `acme.inc`, password hashing, JWT issue and verify | Done locally — register (Employees only, exact `acme.inc`), login, refresh with rotation and reuse detection, sign-out, `/me`; RS256 verification in every service. Verified by 119 tests (100%) and live through `:3001` with a cookie jar. Cloud: bcrypt timing and the cookie field still to check |
| M4 | Authorization | Three personas, role **and** row-level ownership; a shared enforcement *mechanism* with per-service *policy* (AD-09) | Role administration done — admins list users and change roles (promotion creates the engineer profile; demotion unassigns active tickets; the last admin cannot be removed). Persona access matrix tested for every route. Row-level ownership and transition authority land with M5 |
| M5 | Incident CRUD + workflow | The five statuses, with transitions enforced server-side | Done locally — report, list (filters, paging, triage sort), detail with per-caller actions, edit, soft delete; status changes enforced by the AD-17 table with full history; assignment; escalation requests and admin decisions. 289 tests (100%), verified live on LocalStack |
| M6 | Facilities CRUD | Building → floor → seat | Done locally — admins create, rename, and archive at every level (archive cascades; archived locations are hidden); everyone reads; duplicate names are a friendly 409. 323 tests (100%), verified live |
| M7 | Engineer profiles + assignment | Profiles linked to accounts, ticket assignment | Done locally — admins see every engineer's availability and live workload (sortable by capacity); engineers toggle their own availability; unavailable engineers get no new work. Assignment itself shipped in M5. 346 tests (100%), verified live |
| M8 | Ticket notes | Threaded communication on an incident | Done locally — one chronological conversation per incident; blocked, reassignment, and escalation reasons appear in it; authors edit (marked edited) and delete their own; admins moderate, even on closed tickets. 367 tests (100%), verified live |
| M9 | Search, filter, pagination | Server-side, shared across all three persona views | Done locally — every list shares one paging / sort / envelope implementation; incidents filter by status, priority, category, location, assignee, escalation, and text or ticket number, with each persona seeing only their slice. 372 tests (100%) |
| M10 | Dashboards and reporting | Per-persona; counts by status/priority/assignee, hotspots, MTTA/MTTR | Done locally — per-persona summary, location hotspots, time to assign, acknowledge, and resolve from history, blocked and escalated with reasons. How reporters are kept informed is left to the frontend (M12). 400 tests (100%), verified live |
| M11 | Visual workflow | Per-incident stepper and a status-grouped board | Done locally — per-incident `WorkflowStepper` shipped with the core demo flow (commit `25632ac`); the Admin/Engineer `/dashboard` board (six status columns, workflow order, `blocked` as an error state, no drag-and-drop, cards link to `/incidents/:id`) shipped 2026-09-24 (commit `163d29e`); a `HistoryTimeline` (newest-first status changes, actor/holder/reason/time, phones collapsed to the latest 3) shipped 2026-09-24 (commit `4b35e0d`), reading `history` from the existing detail response; a dashboard section nav plus ticket lookup and history (sticky on desktop, sideways-scrolling on phones, `IntersectionObserver`-highlighted) shipped 2026-09-24 (commit `b16fe04`) — closes the MVP Search-and-filter capability in the UI, and fixed a `srOnly` CSS bug that made the dashboard 2602 px wide; the admin "Who's available" engineer table (workload sort, availability switch, promote/demote with a confirmation dialog) shipped 2026-09-24 (commit `bc87575`) — closes the "create engineer profiles" capability in the UI; **moved off `/dashboard`** the same day (commit `d9907d6`) onto a standalone admin-only `/engineers` page linked from the **top** `AppShell` nav as "Engineers" — the dashboard side nav no longer carries a "Who's available" entry — and a new **read-only** `/engineers/:id` engineer profile shipped alongside it (banner, `GET /api/engineers/{id}` header with the shared `AvailabilitySwitch`, a board of the engineer's assigned tickets by status with counts derived from the columns, and a separate "Reported by them" list); non-admins are redirected. The profile is frontend-only by the user's call (a proposed `GET /api/engineers/{id}/dashboard` endpoint was declined), so it is not an exact copy of the engineer's own dashboard — the list API can filter by assignee or by reporter but not both at once. See M13 for the current test count. 121 Vitest tests pass at the board commit, coverage 99.7% statements / 96.2% branches, lint and build clean, local Cypress core journey passes; deployed to CloudFront, a cloud Cypress check confirmed the employee `/dashboard` → `/tickets` redirect and the hidden nav link. The admin dashboard itself has **not** yet been checked by a person in the cloud — unverified there |
| M12 | Responsive and accessible UI | Mobile and desktop, consistent interaction states | In progress — the dashboard and its components (summary plate, breakdown bars, attention list, status board, timings, hotspots) ship with the same responsive/loading/error conventions as the rest of the app; the lookup, the standalone `/engineers` ("Who's available") page, and the read-only `/engineers/:id` profile were browser-checked at 1280 and 375 px with no sideways overflow (2026-09-24); no full cross-device pass recorded yet |
| M13 | Test suites | To the coverage targets in [Testing](#testing) | In progress — backend: 409 tests pass, 100% coverage, 80% gate passes (`.venv/bin/pytest`, 2026-09-24); mutation spot-check confirms tests fail when the code they cover is broken. Frontend: 173 Vitest/RTL tests pass, 99.5% statements / 95.77% branches, thresholds enforced (`npm run test:coverage`, 2026-09-24, at the Engineers page / read-only profile commit `d9907d6`). E2E: Cypress core journey passes against the local stack; in the cloud only smoke checks run (sign-in, deep-link reload, dashboard gate) |
| M14 | Cloud deployment | Verified working end to end on AWS, not only in LocalStack | Backend and frontend both deployed and verified through CloudFront, same domain. Backend: origin sealed, auth round trip, token header, cookie, migrations, admin seed. Frontend (`./bin/deploy-frontend.sh`, 2026-09-24): `/` and deep links (`/tickets`, `/incidents/1`, `/report`) 200 HTML, assets 200, API 404/403 JSON (AD-12 envelope), refresh cookie 200, Cypress smoke test against the cloud URL passed. The full core-journey Cypress spec was **not** run in the cloud — its fixture users exist only locally. Details: AGENTS.md → First cloud deploy / Frontend cloud deploy — verification |

**Ordering note.** M2 precedes everything because of one schema decision that cannot be retrofitted — see [The one irreversible decision](#the-one-irreversible-decision). M3 and M4 precede M5–M8 because retrofitting an identity into endpoints written without one is the single most expensive reordering available here, and the reasoning is in [Security](#security--what-is-and-is-not-enforced).

## Security — what is and is not enforced

**Authentication and authorization are required deliverables, and they land before the endpoints they protect** — M3 and M4, ahead of every CRUD milestone. Nothing is built yet, so nothing is protected yet; that is a statement about the calendar, not about scope.

The mechanism is decided: **JWT**, self-issued, verified in every handler, with expiry. Passwords are hashed. A sign-in that compares credentials and returns a user without issuing a token is not an implementation of this — the next request would be anonymous again, which is the failure mode this milestone exists to prevent.

The ordering is deliberate, and the reason is that the alternative is uniquely expensive. Writing CRUD first means every handler, every test, and every frontend call is authored against an anonymous world, and each one becomes a site that must be revisited. Worse, **the tests keep passing the whole time** — a suite written without identity cannot see an authorization that was never written, so the gap is invisible to exactly the instrument that would normally catch it. A control is hardest to notice as missing when it is missing everywhere.

### The design

| | |
|---|---|
| **Tokens** | RS256 JWT. The `auth` service holds the private key in **AWS Secrets Manager** and is the only thing that can mint; every other service verifies with a public key shipped as a plain environment variable. Under HS256 each service would have needed the ability to forge, and a single over-permissive service would have been a full compromise. |
| **Access token** | Short-lived, kept in **memory only**, sent in the **`X-Access-Token`** header. |
| **Refresh token** | Long-lived and revocable, in an **httpOnly cookie** — `Secure; SameSite=Strict; Path=/api/auth/refresh`. Injected script cannot read it, which is the point: it is the credential worth protecting. Rotated on every use, stored server-side as a hash, with **reuse detection** that revokes the whole token family if an already-rotated token reappears. |
| **Passwords** | bcrypt. argon2id is memory-hard by design, which is a direct tax in Lambda where memory is provisioned and cold starts are already the weak point. |
| **The origin** | Function URLs move from `authorization_type = "NONE"` to **`"AWS_IAM"` behind a CloudFront Origin Access Control**, so a direct call to a Function URL is rejected by Lambda before our code runs. |

### Four scaffold facts that made those choices possible, or forced them

| Fact | Where | Consequence |
|---|---|---|
| **`/api/<service>*` is already routed through CloudFront** | `infra/cloudfront.tf` | One `ordered_cache_behavior` per service, `Managed-CachingDisabled`, and `Managed-AllViewerExceptHostHeader` — which forwards cookies. **The SPA and the API are one origin**, so browser traffic never triggers CORS and `SameSite=Strict` cookies simply work. No workshop guide mentions this; an early reading of this project assumed the opposite and concluded cookies were unavailable. |
| **OAC signing claims the `Authorization` header** | consequence of the above decision | SigV4 puts its signature there, so an access token cannot also live there. **This is why the token travels in `X-Access-Token`** — a deliberate deviation from the Bearer convention, caused by the infrastructure rather than chosen for its own sake. Verify the header behaviour empirically at M1; it is easier to test than to reason about. |
| **Per-service Function URLs** | `infra/lambda.tf` | Every service verifies tokens independently, which makes verification shared code — and shared code is [structurally awkward here](#the-shared-code-problem). The failure mode is one service verifying slightly differently from the rest, invisible until exploited. |
| **`test`/`test`/`test` credential fallback** | `backend/_examples/python-service/function.py` | The template falls back to hardcoded credentials when the injected environment variables are absent. Copied unchanged into a real service, it turns a missing-config error into a silent connection to the wrong database. |

**OAC seals the origin; it does not identify the caller.** Only CloudFront can invoke a function, but CloudFront will happily forward a request from anyone. The two controls answer different questions, and the perimeter one is never a reason to skip verifying a token in the handler.

**What M3 and M4 must actually deliver**, so that "auth is done" means something checkable:

| | Requirement |
|---|---|
| **M3 — authentication** | Registration restricted to `acme.inc`, validated server-side. Passwords hashed, never stored or returned in plaintext. Sign-in issues a signed JWT with an expiry. Every handler verifies the token before doing anything else, and rejects missing, malformed, expired, and wrongly-signed tokens distinctly enough to debug but not distinctly enough to probe. |
| **M4 — authorization** | The three personas as roles. Role checks **and** row-level ownership — an Employee reaches their own incidents, an Engineer their assigned ones, an Admin everything — enforced by one shared mechanism (the router's declared roles and the entry wrapper) with each service's own policy module, never ad-hoc checks per handler (AD-09). Workflow transitions authorized by role. A consistent `403` shape. |

The remaining open sub-decisions are signing algorithm, where the signing secret lives, the hashing library, and refresh-token handling — **AD-07** and **AD-08** in `AGENTS.md`. The mechanism itself is not open.

**What will be enforced versus what merely shapes the UI.** Keeping these apart is the discipline this section exists to hold:

- **Enforced** — anything that holds against `curl`: token verification in the handler, role checks, row-level ownership, workflow transition legality, server-side validation of the `acme.inc` domain.
- **Product boundary** — the React app hiding actions a role cannot perform. Required by the spec, worth points, and **worth nothing to any client that is not a browser.** Hiding a delete button is not access control.
- **Not protected** — everything, until M3 lands. This row is expected to be empty by the end, and any entry remaining in it at delivery is a defect, not a documented trade.

> **The habit worth carrying:** ask *"who may do this?"* as a question separate from *"does this do the right thing?"*. The second is easy to ask and easy to answer well, and answering it well is precisely what makes the first easy to skip.

*(To be filled as controls land: what is enforced, what was found broken during testing, and what remains open.)*

## Prerequisites

- **Amazon WorkSpaces VDI**, provisioned by the workshop organizers. The repository is cloned inside it at `~/coding-workshop-participant`; Docker, LocalStack, `awscli`, and `terraform` are local to that machine. See [Environment](#environment).
- **Participant variables in `~/.bashrc`** — `AWS_REGION`, `EVENT_ID`, `PARTICIPANT_ID`, `PARTICIPANT_CODE`, and `LOCALSTACK_AUTH_TOKEN`. Nothing runs without them; `source ~/.bashrc` in every fresh shell.
- **LocalStack account** for the auth token.
- Python 3 and Node.js are installed by `./bin/setup-environment.sh -d`, along with VS Code, PyCharm, and IntelliJ.

The VDI is **destroyed shortly after the workshop** and stored credentials are erased with it. Anything worth keeping must be pushed to GitHub before then.

## Environment

The repository lives inside the VDI, not on any local machine. Work happens there because everything the application needs — Docker, LocalStack on `:4566`, the service ports, the AWS tooling — is there, and editing in one place while running in another is how confident and wrong claims about "it works" get made.

| Port | Serves |
|---|---|
| `3000` | Frontend (Vite dev server / CloudFront locally) |
| `3001` | Dev proxy (`bin/proxy-server.js`) → per-service Lambda Function URLs on LocalStack |
| `4566` | LocalStack |
| `4556` | S3 website endpoint (LocalStack) |
| `5432` | PostgreSQL |

```sh
source ~/.bashrc
./bin/start-dev.sh          # whole local stack
./bin/deploy-backend.sh     # Lambdas + infra
./bin/deploy-frontend.sh    # S3 + CloudFront (aws mode: build, sync --delete, invalidate /*)
./bin/deploy-frontend.sh local  # LocalStack — skip the build, use start-dev.sh instead
./bin/generate-env.sh       # regenerate frontend/.env.local from Terraform outputs
```

Deploy order: `./bin/deploy-backend.sh` first (Terraform outputs the API base URL the frontend build needs), then `./bin/deploy-frontend.sh`.

`./bin/cleanup-environment.sh` destroys all deployed AWS resources and cannot be undone.

### Demo data

`tools/seed_demo.py` — stdlib-only Python, outside every Lambda bundle — builds a full demo
dataset **through the public API**, so every row obeys the same business rules a real user
would trip. It signs in as an admin (`SEED_ADMIN_EMAIL`, default `you@acme.inc`;
`SEED_ADMIN_PASSWORD` and `SEED_PASSWORD` — the password given to every demo person — are
prompted when unset and never stored) and creates 3 engineers and 4 employees
(`demo.*@acme.inc`), 3 buildings with floors and seats, and 18 incidents spanning every
status: two blocks with reasons, a reassignment through `Unassigned`, and escalations
pending, granted, and declined. Re-running is idempotent — people, places, and incident
titles are reused.

```sh
python3 tools/seed_demo.py                                         # local (:3001)
python3 tools/seed_demo.py https://d2bwm7q2v18xxo.cloudfront.net   # cloud
```

Verified locally (2026-09-24): 18 incidents created; a re-run created 0; `#59`'s history
showed the full reassignment path. **Not yet run in the cloud** — the user runs it there with
their own admin password. All moves happen within seconds of each other, so seeded timings
read in seconds, not the spread a manual demo would show.

**One-time PostgreSQL rebind, per VDI.** The Lambdas run in Docker and reach PostgreSQL at `172.17.0.1`, so it must listen beyond loopback. `start-dev.sh` tries this itself but cannot find the config file on a stock install (see Known defects). Run once in a VDI terminal — `trust` is acceptable only because the VDI is disposable:

```sh
sudo sed -i "s/#\?listen_addresses\s*=\s*'[^']*'/listen_addresses = '*'/" /etc/postgresql/18/main/postgresql.conf
echo "host all all 0.0.0.0/0 trust" | sudo tee -a /etc/postgresql/18/main/pg_hba.conf
sudo systemctl restart postgresql
ss -ltn | grep 5432         # expect 0.0.0.0:5432
```

**First admin (one-time).** Any deploy — local or cloud — against a database with no admin **fails** until these are set. Deliberate: no admin means nobody could ever promote anyone, so `_migrate` refuses to proceed silently instead of shipping an unrecoverable database (AD-21). Generate the hash on the VDI (`python3.13` carries `bcrypt` 3.2.0):

```sh
HASH=$(python3.13 -c 'import bcrypt, getpass; print(bcrypt.hashpw(getpass.getpass("Admin password: ").encode(), bcrypt.gensalt(10)).decode())')
```

Cost 10 matches the `auth` service (`passwords.ROUNDS`); a higher cost still verifies — bcrypt stores it in the hash — but makes this admin's login slower on a 128 MB Lambda.

Add both lines to `~/.bashrc` — not `ENVIRONMENT.config`, which `setup-participant.sh` regenerates — **above** Ubuntu's `case $- in … *) return;; esac` guard near the top: anything below it is skipped by non-interactive shells, so scripts and tools would never see the variables. `printf` with `'%s'` writes the hash in single quotes, which stops the shell expanding its `$` characters:

```sh
printf "export TF_VAR_bootstrap_admin_email='%s'\n" "admin@acme.inc"
printf "export TF_VAR_bootstrap_admin_password_hash='%s'\n" "$HASH"
```

Paste those two printed lines above the guard (or append and move them), then check from a non-interactive shell: `bash -c 'source ~/.bashrc; echo ${TF_VAR_bootstrap_admin_password_hash:0:7}'` must print `$2b$10$`.

Required before the first cloud deploy.

**Apply a new migration locally.** `start-dev.sh` skips Terraform when the backend is already deployed, so run the deploy directly — the `source` is not optional (see Known defects):

```sh
source ENVIRONMENT.config && ./bin/deploy-backend.sh local
```

A failing migration fails the deploy with the PostgreSQL error in Terraform's output.

**Verify the backend** — through the proxy, and tail the Lambda log:

```sh
curl -s http://localhost:3001/api/auth -H "X-Access-Token: dummy"
AWS_ENDPOINT_URL=http://localhost.localstack.cloud:4566 AWS_REGION=us-east-1 \
  aws logs tail /aws/lambda/coding-workshop-auth-$PARTICIPANT_ID --since 5m --format short
```

## Repository layout

```
coding-workshop-participant/
├── AGENTS.md                 spec, architecture facts, decision register (AD-00 … AD-22)
├── CLAUDE.md                 working conventions
├── README.md                 this file
├── pytest.ini                 pytest config — path, testpaths, coverage addopts (AD-11)
├── .coveragerc                coverage.py config — source, omit, namespace packages, 80% gate (AD-11)
├── requirements-dev.txt       dev-only test tooling; never enters a Lambda bundle (AD-11)
├── backend/
│   ├── _examples/            provided templates — copied out, never edited in place
│   │   └── python-service/   function.py, postgres_service.py, requirements.txt
│   ├── _shared/              code used by several Lambdas; vendored as <service>/shared/ (AD-02)
│   │   ├── router.py         hand-rolled method+path router (AD-05)
│   │   ├── authz.py          User/ROLES + authenticate() — closed-by-default stub until M3 (AD-09)
│   │   ├── errors.py         ApiError + the fixed AD-12 code table (400/401/403/404/405/409)
│   │   ├── http.py           dispatch(): the one entry wrapper every handler calls (AD-12)
│   │   ├── log.py            JsonFormatter + setup(); request/correlation id ContextVars (AD-16)
│   │   ├── db.py              AD-04 helper: conn_str, get_conn, reset_conn (built earlier)
│   │   └── tests/            tests beside code; excluded from every Lambda zip (AD-11)
│   ├── _migrate/             private schema-migration Lambda, no URL (AD-03); migrations/NNN_*.sql
│   ├── auth/                 sign-in and token issue (AD-07); at M1 a DB-reachability check
│   └── <service>/            our services — see the discovery rules below
├── bin/                      provided scripts — setup, start-dev, deploy, generate-env, cleanup
├── frontend/
│   ├── src/services/         the only code that knows the API is HTTP
│   ├── src/components/       reusable pieces
│   ├── src/pages/            route destinations
│   ├── eslint.config.js      correctness rules only, no formatting rules
│   └── vite.config.js        dev server on :3000
└── infra/                    Terraform — lambda.tf, rds.tf, s3.tf, cloudfront.tf, variable.tf, output.tf
```

`data/`, `infra/eks.tf`, and `infra/helm/` belong to the data-engineer and system-engineer tracks and are not used here.

### Service discovery rules

These are enforced by `infra/lambda.tf` and are easy to violate by accident:

- A service is a folder **exactly one level** under `backend/` containing **`requirements.txt`** (Python), `package.json` (Node), or `pom.xml` (Java).
- **Discovery is by `requirements.txt`, not `function.py`.** `backend/README.md` says `function.py`; `infra/locals.tf` disagrees, and the Terraform is what runs. A folder with a handler and no `requirements.txt` is **silently skipped** — no error, no warning, it simply never deploys. An *empty* `requirements.txt` is sufficient, and `cp -R` from the template carries one, so this only bites a hand-created service or one whose dependency list was deleted as unnecessary.
- Folders prefixed with `_` or `.` are **ignored**, which is why `_examples/` never deploys.
- `backend/group/my-service/` is **too deep** and will not deploy. It also will not warn.
- Packaging zips one service directory and nothing else.

### The shared-code problem

The workshop wants two things that pull against each other: **reuse over copy-paste is a scored criterion, and the packaging boundary is the service folder.** A sibling `backend/_shared/` is in no service's bundle.

The obvious fix is a Terraform one. The scaffold uses `terraform-aws-modules/lambda/aws`, whose `source_path` accepts a *list*, so adding `_shared` to every bundle is about three lines. **It works in the cloud and fails locally**, and the reason is worth knowing before losing an afternoon to it: local development never uses the built zip. `null_resource.hot_reload` calls `update-function-code --s3-bucket hot-reload --s3-key <absolute path>`, where `hot-reload` is LocalStack's magic bucket and the key is a **directory on disk** that LocalStack mounts as the function's code. Anything Terraform adds to a zip is invisible there. The symptom is `ModuleNotFoundError` in LocalStack only, against infrastructure that is provably correct in AWS.

**So the shared code gets vendored** — physically copied into each service directory by a prebuild step, because physical presence is the only thing that satisfies both the zip builder and the hot-reload mount. The copies are gitignored, so `_shared/` remains the single source of truth in version control; committing N identical directories would recreate, in the diff a grader actually reads, the exact duplication the whole exercise exists to avoid.

There is a second duplication axis that is easy to miss. `pip_requirements = true` means each service's **own** `requirements.txt` drives its pip install, so shared code's dependencies must be listed in every service that imports it. Vendoring the code without reconciling the requirements produces a runtime import error rather than a build failure.

The four things that must not be duplicated are token verification, the database connection helper, the error envelope, and the validation models — the four most likely to drift apart silently if they are. Full reasoning is **AD-02** in `AGENTS.md`.

**How it works (built 2026-09-23).** `bin/sync-shared.sh` copies `backend/_shared/*.py` into `backend/<service>/shared/` for every Python service and for `_migrate`, so code imports `from shared.db import get_conn`. It runs from `start-dev.sh` (hot reload reads the directories directly) and from `deploy-backend.sh` before `terraform apply`, in both local and cloud modes. The copies land in a `shared/` subfolder rather than beside `function.py` because the service-dir allow-list tracks every top-level `*.py`; `/backend/*/shared/` is gitignored. The script also checks every line of `_shared/requirements.txt` against each service's `requirements.txt` and **fails the sync** if one is missing — a missing dependency is caught at deploy time, not as an import error in production.

After editing anything in `_shared/`, re-run `./bin/sync-shared.sh`; hot reload picks up the new copies immediately. Never edit a `shared/` folder inside a service — the next sync overwrites it.

## Architecture

```
Browser
  ├── UI          →  CloudFront  →  S3 static site
  └── API calls   →  Lambda Function URL, one per service
                        │
                        └──→  Aurora PostgreSQL
```

**There is no API Gateway.** Each backend service is a separate Lambda with its own Function URL; Terraform emits the URL map as `lambda_urls`, which `bin/generate-env.sh` writes into `frontend/.env.local` as `VITE_LAMBDA_URLS`. Two things follow that shape the code:

- **Every handler is its own router.** A Function URL delivers the entire path and method to one entry point, so path-and-method dispatch is application code, not infrastructure configuration. (**AD-05**.)
- **Every handler is its own security perimeter.** Covered above.

Intended layering inside each service — *(to be confirmed as M5 lands)*:

```
handler / router  →  service (business rules)  →  repository (SQL)  →  PostgreSQL
```

Each layer talks only to the one below it. The router never writes SQL; the repository never formats an HTTP response. The point is not ceremony — it is that the transition rules in M5 need to be testable without an HTTP event, and the reporting queries in M10 need to live somewhere that is not a request handler.

On the frontend, every URL the application can call lives in `src/services/`. That is the same rule as the repository layer, mirrored: one place knows how the thing behind it is reached, and everything above it is written in the application's own vocabulary. It also makes the contract auditable — the complete set of requests the UI can make is one short file, so a missing capability shows up as an absence you can see.

### The one irreversible decision

Most decisions here can be revisited. One cannot.

Three of the seven questions the application must answer are about *time*: how quickly incidents are acknowledged, assigned, and resolved. **None of them can be answered from a mutable `status` column**, which knows only where a ticket is now. They need an append-only record of every transition — from, to, who, when, and why — written from the first incident onward. Because incidents start in an added `Unassigned` status (AD-17), first assignment is itself a transition, so time-to-assign comes from the same record.

Adding that table in week two does not backfill it. Every incident created before it exists has no history and never will, and the dashboards in M10 would be computed over a partial record while appearing complete. That is why M2 leads the milestone order and why the history table is named explicitly in its scope rather than left to emerge.

The same table answers *"which incidents are escalated or blocked, and why"* — the blocked reason belongs on the transition, not on the incident.

## Where each rule is enforced

The database enforces what it can express; everything else has exactly one owner in a service. Graders and reviewers should be able to find every guarantee here.

| Rule | Enforced by |
|---|---|
| Email is lowercase and `@acme.inc` | Database `CHECK` (backstop) + `auth` service (user-facing message) |
| An incident's floor belongs to its building; its seat to its floor | Database composite foreign keys |
| A seat needs a floor | Database `CHECK` |
| `unassigned` exactly when there is no assignee | Database `CHECK`, on `incidents` and on history rows |
| `Blocked`, and reassignment back to `unassigned`, need a reason | Database `CHECK` on history rows |
| Status history is never updated, deleted, or truncated | Database trigger |
| Referenced rows (locations, users, incidents) are never hard-deleted | Database foreign keys |
| Location and category values are from the allowed set | Database `CHECK` |
| Names unique within their parent, among non-archived rows | Database partial unique indexes |
| **Only engineers are assignees** | **`incidents` service** — `assignee_id` references `users`, so the database cannot tell an engineer from an employee |
| **No incident on an archived building, floor, or seat; no floor or seat under an archived parent** | **`incidents` / `facilities` services** — a foreign key proves a row exists, not that it is active |
| Who may make which status change (AD-17) | `incidents` service (`workflow.py`) |
| Role and ownership checks (AD-09) | Shared mechanism in `_shared/`, per-service policy |

Every database row in this table is exercised by `backend/_migrate/tests/constraints.sql` — 18 cases, run inside one transaction and rolled back, exiting non-zero on the first case that misbehaves:

```sh
psql -h 172.17.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -f backend/_migrate/tests/constraints.sql
```

The schema itself is in `backend/_migrate/migrations/`; a read-only snapshot for reading is `backend/_migrate/schema.snapshot.sql`, regenerated after each migration with `pg_dump --schema-only`.

## Decisions

Open architecture decisions live in **`AGENTS.md` → Pending architecture decisions**, as AD-00 through AD-22 with options, a recommendation, and what each blocks. Settled so far:

| ID | Decision | Choice |
|---|---|---|
| AD-00 | Database | **PostgreSQL.** MongoDB/DocumentDB is not used; `pymongo` and every `MONGO_*` path are removed from services derived from the template. |
| AD-01 | Service decomposition | **Split by domain:** `auth`, `incidents`, `facilities`, `engineers`, and `reports` from M10. Ticket notes are their own entity but are deployed in `incidents` at `/api/incidents/{id}/notes`, because every notes permission check is the parent incident's check. All services share one database. |
| AD-03 | Schema and migrations | **A private `_migrate` Lambda with no Function URL, run by Terraform during `apply`**, applying numbered forward-only SQL files tracked with checksums. Cloud Aurora is not publicly reachable, so only something inside the VPC can apply the schema — and keeping it out of service discovery means nothing on the internet can trigger it. |
| AD-04 | Database access | **Raw `psycopg` 3, the example's pattern:** one module-scope connection per warm Lambda container, reopened on error. No pool (a container serves one request at a time) and no ORM. All queries parameterized; any write touching more than one row runs in one transaction. |
| AD-05 | Routing inside a Lambda | **A ~50-line router of our own in `_shared/`**, not a framework: a table of method + path pattern, `404`/`405` for anything not listed, and path normalisation so the same routes work behind CloudFront and the local proxy. Zero dependencies at 128 MB, and every line is explainable. |
| AD-06 | Frontend ↔ API | **Same-origin `/api/...` calls through one wrapper** — the page and the API share an origin (Vite proxy locally, CloudFront in the cloud), which is what lets the strict refresh cookie work. The wrapper also hashes every POST/PUT body, which CloudFront's signing to Lambda requires. |
| AD-09 | Permissions | **Closed by default:** every route must declare which roles may call it, or the service refuses to start. The role travels in the signed token. Lists are filtered in SQL, so an employee's query can only return their own tickets. A ticket you cannot see returns `404`, not `403`, so its existence is not confirmed. The UI hides actions based on what the API says the caller may do, never a second copy of the rules. |
| AD-10 | Frontend libraries | **Only what is mandated plus the minimum:** no data-fetching, form, date, or drag-and-drop libraries. The server's validation errors are the form rules, so none are duplicated in JavaScript. |
| AD-11 | Test stack | **pytest (backend), Vitest + React Testing Library (frontend), Cypress (end to end).** Vitest instead of the guide's Jest because this is a Vite project and Vitest runs its config natively, where Jest needs extra ESM setup. Coverage targets are enforced: a run below target fails. |
| AD-12 | Errors and validation | **Every error has one shape:** `{"error": {"code", "message", "fields", "request_id"}}`, with a stable `code` the UI branches on and per-field messages shown beside inputs. Beyond the workshop contract's `400/404/500` we also return `401` and `403` (auth), `405` (wrong method) and `409` (duplicates). A `500` never exposes internals — the `request_id` finds the log line instead. Request bodies are validated with Pydantic v2; RFC 9457 Problem Details was considered and judged unnecessary ceremony for one first-party frontend. |
| AD-14 | Live updates | **Short polling**, paused when the tab is hidden: a conversation refreshes every 20 s, dashboards every 30 s. |
| AD-15 | PWA / AI | **Out of scope** — see Deliberately not done. |
| AD-13 | Lists | **Filtered, paged and sorted on the server:** every list takes filters, `page` and `limit` (20, max 100), and returns `{items, total, page, limit}`. Incidents default to highest priority first, then oldest — the triage order. |
| AD-16 | Logging | **One JSON line per request** (route pattern, status, duration, user and request ids) plus lines for domain events, so CloudWatch Logs Insights can query by field. The frontend tags each user action with an `X-Correlation-Id`, which links every log line it caused. Tokens, passwords, cookies and request bodies are never logged. |
| AD-17 | Incident workflow | **Admin: any status to any other. Engineer (assigned tickets only): one step forward, plus unblocking. Employee: none.** Only admins close. New incidents start `Unassigned`; only admins assign, which moves them to `Open`. Reassignment goes back through `Unassigned` with a required reason, so every hand-off is in the history. See diagram below. |
| AD-18 | Visual workflow | **MUI `Stepper` on each incident** (the requester's "where is my ticket?") **plus a status-grouped board** on the Admin/Engineer dashboard (the dispatcher's "what is stuck?"). Drag-to-transition only after the workflow is enforced server-side. |
| AD-19 | Dashboards | **A read-only `reports` service counts in SQL:** a per-persona summary, location hotspots, timings, and an attention list of blocked and escalated tickets with their reasons. **Timings report time to assign, time to acknowledge, and time to resolve**, reconstructed from the status history and all measured from when the ticket was reported. A ticket counts as acknowledged when its engineer first moves it to `in_progress`. |
| AD-20 | Priority and escalation | **Employees request a priority; admins set the working one.** Escalation is a request an employee makes and an admin grants or declines — granting changes nothing automatically, because what escalation means depends on the issue. Only its current status is stored on the incident; the employee's reason is posted into the ticket conversation. Pending requests appear on the admin dashboard. |
| AD-21 | Registration and roles | **Anyone with an `acme.inc` address registers as an Employee — nothing else.** Admins promote users to Engineer or Admin, so every password is set by its owner. The first admin is seeded at deploy time by the private migration Lambda, from credentials held outside git. Demoting an engineer sends their active tickets back to `Unassigned` with a recorded reason. |
| AD-22 | Facility hierarchy | **Three tables — buildings, floors, seats.** An incident names its building and optionally a floor and seat; composite foreign keys make the database reject a seat on the wrong floor. Locations are archived, never deleted, so hotspot history survives. Seat occupants are out of scope. |

The rest are open. The rule is that an open decision gets settled deliberately and recorded, not resolved silently in a commit — the register is the artifact that makes trade-offs explainable afterwards, which is half of what the workshop grades.

*(This table is to be extended as decisions close.)*

**Incident workflow** (AD-17). Engineer moves shown. Only admins assign, which moves a ticket `Unassigned → Open`; admins may otherwise move a ticket between any two statuses, except that nothing leaves `Unassigned` without an assignee; only admins close; employees change no status.

```
Unassigned ──(admin assigns)──▶ Open → In Progress → Resolved
                                             ⇅
                                          Blocked
```

**Deliberate deviation from the problem statement.** The brief's workflow is `Open → In Progress → Blocked → Resolved → Closed`. We prepend a sixth status, `Unassigned`, and keep the five unchanged. Reason: the admin's triage queue becomes a plain status filter, and time-to-assign — one of the questions the app must answer — becomes an ordinary transition in the status history instead of needing a second tracking mechanism.


## Known defects in the provided scaffold

Found by reading the repository before writing any code. Recorded because each one fails in a way that does not name its cause:

- **The Python template's PostgreSQL config has no SSL branch.** `PG_CONFIG` in `backend/_examples/python-service/function.py` builds a connection string with no `sslmode`. Local PostgreSQL accepts that; Aurora does not. A service copied unchanged works perfectly in LocalStack and fails on first cloud deploy — the environment where the failure is most expensive to diagnose.
- **The same config falls back to `test`/`test`/`test`.** A missing injected variable becomes a wrong-database connection rather than an error.
- **`frontend/.env.sample` advertises `REACT_APP_*` variables, which Vite does not expose.** Only `VITE_*` reaches `import.meta.env`. `bin/generate-env.sh` writes both prefixes, so the generated file works and the *sample* file is the trap — anyone following the sample gets `undefined` with no error.
- **`frontend/README.md` lists Material UI and React Router as prerequisites; `package.json` contains neither.** Both are required by the assignment. They must be installed.
- **`docs/validation.md` lists `docs/implementation.md`, `docs/testing.md`, and `docs/evaluation.md` in its repository tree. None of the three exist.**
- **The endpoint table and the `curl` examples disagree on the path prefix** — `/{service}` versus `/api/{service}`. (**AD-06**.)
- **`bin/proxy-server.js` (the `:3001` dev proxy) forwards only four request headers** — `accept`, `content-type`, `user-agent`, `host`. It silently dropped `X-Access-Token` and `Cookie`, so every authenticated request would have arrived anonymous, locally only. Fixed: `X-Access-Token`, `Cookie`, and (added 2026-09-23, for AD-16) `X-Correlation-Id` are now forwarded when present.
- **`bin/proxy-server.js` answered an unknown service with `502`, never `404`.** It built the target URL *before* checking the service existed, so a missing name became the string `"undefined/..."` — always truthy — and the "Unknown endpoint" branch was unreachable. A typo in a service name looked like a dead backend. Fixed: the lookup is checked first, with `Object.hasOwn` so names like `constructor` do not resolve to `Object.prototype` members.
- **`bin/start-dev.sh` built service dependencies for the wrong Python.** It called bare `pip`, which on the VDI belongs to Python 3.14, while Lambda runs 3.13; compiled wheels (`psycopg-binary`) then failed to import. The failure was hidden by `2>/dev/null || true`, and the success marker was written anyway, so re-running never retried. Fixed: pip now targets `--python-version 3.13 --platform manylinux2014_x86_64`, and the marker is written only on success.
- **`bin/deploy-backend.sh local` does not load `ENVIRONMENT.config`**, which is where `TF_VAR_aws_app_code` (the participant ID) lives. `start-dev.sh` sources it first; running `deploy-backend.sh local` on its own falls back to the default app ID `abcd1234`, and Terraform renames — destroys and recreates — every local resource. Workaround: always `source ENVIRONMENT.config` before a manual local deploy. The cloud branch of the script does source it.
- **`bin/start-dev.sh` locates `postgresql.conf` with an unprivileged `find`**, which cannot read `/etc/postgresql/<ver>/main/`, so its rebind-to-`0.0.0.0` step fails on a stock install. Done by hand once per VDI; see Environment.
- **`frontend/eslint.config.js` imports `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh`, but `package.json` installed neither**, so `npm run lint` crashed with a module-resolution error before linting anything. Fixed: both added as dev dependencies; lint passes.
- **The repository's root README describes a team-management application.** That is generic workshop filler and not this assignment. Where it conflicts with the problem statement, the assignment wins.
- **Frontend installs were not reproducible.** `frontend/package-lock.json` was gitignored, so every fresh machine re-resolved dependency versions instead of installing the ones last verified. **Fixed (2026-09-24):** the lock file is now tracked (`.gitignore` un-ignores only it), and `bin/start-dev.sh` runs `npm ci` when it is present, `npm install` otherwise.
- **`GET /api/reports/hotspots` floor and seat rows carry only `parent_id`, not the parent's name.** The frontend's `HotspotList.jsx` prefixes a floor or seat with its parent's name only when that parent happens to be in the same response (`withParent()`), so a floor whose building fell outside the top-5 buildings shows unprefixed. Backend fix, not yet done: return `building_name` / `floor_name` alongside `parent_id`. Found 2026-09-24, building the M11 dashboard.
- **No admin all-incidents list page exists.** The dashboard's status board caps each column at 6 tickets and shows "+N more not shown" as plain text — there is nowhere for it to link to. Found 2026-09-24; out of MVP scope for now.
- **The dashboard nav and the hotspots heading disagreed on wording** ("Where problems occur" vs "Where problems recur"). **Fixed (2026-09-24, user's call):** both read "Where problems occur".
- **The incident page shows the Grant/Decline escalation buttons even when no escalation is pending.** `IncidentActions.jsx`'s `decisions` list is filtered only by `actions.set_escalation` and the current `escalation_status`, not by whether a request is actually `pending` — an admin can see Grant/Decline on a ticket with nothing to decide. A fix was offered when found; not yet accepted. Found 2026-09-24.
- **`infra/cloudfront.tf`'s distribution-wide `custom_error_response` broke both API errors and SPA deep links.** It rewrote every `404` to `200 /index.html`, including `/api/*` — so an API `404` came back as `200 text/html`, breaking the AD-12 error envelope — and it never actually fixed a deep link (`/tickets`, `/incidents/1`), because S3 behind the CloudFront OAC has no `ListBucket` permission and answers a missing key with `403`, not `404`. **Fixed (2026-09-24, commit `7de3cb3`):** the rule was removed and replaced with `aws_cloudfront_function.spa_rewrite` (`infra/spa-rewrite.js`, CloudFront Functions JS 2.0), a viewer-request function on the default S3 behavior only — it rewrites extension-less, non-`/api/*` paths to `/index.html`, so an unknown `/api/*` path still errors correctly. Cloud only (count-gated with the distribution); LocalStack is unaffected. Rejected alternatives: a `403 → index.html` rule (would also turn API `403`s into `200` HTML) and granting S3 `ListBucket` so the `404` rule fires (leaves API `404`s coming back as HTML).

## Testing

Targets, from the workshop's full-stack guide:

| Layer | Coverage |
|---|---|
| Backend | 80%+ |
| Frontend | 80%+ |
| API endpoints (CRUD) | 90%+ |
| Validation and error paths | 90%+ |
| Critical user paths (E2E) | 100% |

Planned shape — *(to be filled as suites land)*:

- **Backend** — handler units without an HTTP event; integration tests against a real database; explicit error-path tests per operation. The workflow transition table in M5 is the highest-value unit-test target in the project: it is pure logic, it has a large illegal-input surface, and every bug in it is a data-integrity bug.
- **Frontend** — React Testing Library on components; `src/services/` against mocked responses; E2E over the three persona journeys.
- **Performance** — load-testing the incident list and dashboard endpoints, which are the two that will actually degrade.

Two things that will **not** be covered, recorded now so the absences read as decisions rather than oversights: **CORS preflight**, which is browser-enforced and would assert nothing from a headless runner, and **concurrent workflow transitions**, unless M5 lands early enough to make it honest.

> **A test suite that has not been run lately is not a passing suite, it is an unknown one** — and for any suite containing writes, *"does it still pass?"* and *"what does it do while failing?"* are different questions. Only the first usually gets asked.

### Backend test stack (built 2026-09-23, AD-11)

**Setup**, once per clone:

```sh
python3.13 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

`requirements-dev.txt` pulls `backend/_shared/requirements.txt` via `-r` so shared pins exist once, plus `pytest==8.3.4` and `pytest-cov==6.0.0`. `.venv` is gitignored; nothing in it reaches a Lambda bundle.

**Run:**

```sh
.venv/bin/pytest
```

`pytest.ini` (repo root) sets `pythonpath = backend`, `testpaths = backend`, and turns on coverage by default via `.coveragerc`, which enforces `fail_under = 80` (AD-11) — a run under 80% total backend coverage **fails the run**, it does not just report.

- **Layout:** tests sit beside the code they cover — `backend/_shared/tests/`, `backend/<service>/tests/` — never in a parallel tree. Terraform's packaging patterns exclude `tests/.*` from every Lambda zip (`infra/locals.tf`, `infra/migrate.tf`), verified by a real local deploy: the `_migrate` zip carries no `tests/constraints.sql`.
- **Namespace-package gotcha:** service directories have no `__init__.py`, so `.coveragerc` sets `include_namespace_packages = true` — without it, coverage.py silently dropped `auth/function.py` and `_migrate/function.py` from the total (75% reported vs. the true 34%).
- **SQL constraint suite** (separate from pytest, `psql` against a live database) is documented in [Where each rule is enforced](#where-each-rule-is-enforced).

**Current status (2026-09-23, uncommitted):** `.venv/bin/pytest` runs **80 tests, all passing** — `backend/_shared/tests/test_router.py` (AD-05 router, now including 3 tests pinning the specificity fix below), `backend/_shared/tests/test_db.py`, the new `backend/_shared/tests/test_http.py` (the AD-12 `dispatch` entry wrapper: routing/access, body parsing and validation, database-error backstops, correlation id and access-log behaviour) and `backend/_shared/tests/test_log.py` (the AD-16 JSON formatter), `backend/auth/tests/test_function.py` (updated for the `dispatch`-based handler and the no-fingerprinting health response), `backend/_migrate/tests/test_function.py` (real `001_init` applied from scratch and re-applied idempotently, edited-file detection, failing-migration rollback, misnamed file, admin seeding, email normalisation, missing-credentials variants, plaintext-hash refusal, registered-email-not-promoted, HTTP-shaped event refusal, handler passthrough). Total backend coverage is **100%**, so the 80% gate passes; the run exits `0`.

**Router bug found and fixed (2026-09-23).** `resolve()` originally tried registered patterns in order and returned on the first match, so a `{param}` route registered before a literal route (e.g. `/{incident_id}` before `/summary`) shadowed the literal one. Fixed to collect every matching pattern, prefer the most specific (fewest captured params), and only then check the method — `405` (with `Allow` from every matching pattern) is raised only when no matching pattern has the requested method. Three tests pin this.

**Auth health response no longer fingerprints the server (2026-09-23).** The M1 handler ran `SELECT version()` and returned the full PostgreSQL version string on a **public** route, plus a `headers_received` diagnostic. Both removed: `GET /api/auth` now runs `SELECT 1` and returns `{"service": "auth", "database": "ok"}`.

**Database-backed tests run against the dev database, not a separate test database** — a deliberate choice, so there is only ever one PostgreSQL to stand up locally. Safety comes from the `isolated_schema` fixture in `backend/conftest.py`: each DB test gets its own throwaway schema (`test_<random>`), created before the test and dropped (`CASCADE`) after, and code under test is pointed at it via the libpq `PGOPTIONS=-c search_path=<schema>` environment variable — production connection code (`_shared/db.py`) is never touched or branched for tests. Verified: 0 leftover `test_*` schemas and 0 rows touched in `public` after a run. Needs the local PostgreSQL reachable at `172.17.0.1` (the same Docker-bridge address Lambdas use); override with `TEST_POSTGRES_HOST` if that address doesn't apply.

`backend/conftest.py` also aliases the vendored import name `shared` to the `_shared` source package, so tests exercise the coverage-counted code and don't depend on `bin/sync-shared.sh` having run, and provides `load_service`, which loads each Lambda's `function.py` under a unique module name (every service's test file is `test_function.py`, so `pytest.ini` sets `--import-mode=importlib`). `.coveragerc` omits `backend/conftest.py` itself from coverage.

**Mutation spot-check (2026-09-23):** removing the plaintext-hash guard in `_migrate` makes `test_plaintext_password_is_refused` fail; making the router decode the whole path before matching makes 2 router tests fail. Both changes were reverted after confirming the failure — evidence the suite catches real breakage, not just that it runs.

**No CI pipeline exists yet.** Thresholds are enforced wherever the tests are run (locally, in `.coveragerc` / Vitest config), not by a separate CI check.

### Auth endpoints (M3)

| Method | Path | Access | Result |
|---|---|---|---|
| `POST` | `/api/auth/register` | public | `201` new Employee; `409` if the email exists; `400` with `fields` for domain, password, or name problems |
| `POST` | `/api/auth/login` | public | `200` `{access_token, expires_in, user}` plus the `refresh_token` cookie; `401` "invalid email or password" |
| `POST` | `/api/auth/refresh` | cookie | `200` new access token and a rotated cookie; `401` if missing, forged, expired, or reused (reuse ends the whole session family) |
| `DELETE` | `/api/auth/refresh` | cookie | `204`, revokes the session server-side and clears the cookie (sign-out lives here because the cookie is only ever sent to this path) |
| `GET` | `/api/auth/me` | any role | `200` the caller; `401` without a valid `X-Access-Token` |
| `GET` | `/api/auth/users?q=&role=` | admin | `200` users matching the search (at most 50 until pagination, AD-13) |
| `PUT` | `/api/auth/users/{id}/role` | admin | `200` `{user, unassigned_incidents}`; one transaction — promotion creates the engineer profile, demotion returns active tickets to `Unassigned` with a reason; `409` for the last admin |

### Incident endpoints (M5)

| Method | Path | Access | Result |
|---|---|---|---|
| `POST` | `/api/incidents` | any role | `201`; starts `unassigned`; the reporter is always the caller |
| `GET` | `/api/incidents?status=&priority=&category=&building_id=&floor_id=&seat_id=&assignee_id=&reporter_id=&escalation_status=&q=&sort=&page=&limit=` | any role | `200` `{items, total, page, limit}` of what the caller may see; default order highest priority, then oldest. Each item carries `reporter_name`, `assignee_name`, and a named `location` (archived places flagged) |
| `GET` | `/api/incidents/{id}` | any role | `200` with `actions` (what the caller may do) and `history` (every status change: when, who, holder, reason — the stepper's timestamps); `404` if not visible |
| `PUT` | `/api/incidents/{id}` | per field | reporter while `unassigned`; admin any time; `priority` admin only |
| `DELETE` | `/api/incidents/{id}` | admin | `204` soft delete |
| `POST` | `/api/incidents/{id}/transitions` | per AD-17 | `{to, reason?}`; `403` if not permitted, `400` if invalid for anyone |
| `POST` | `/api/incidents/{id}/assignment` | admin | `{engineer_id}`; only from `unassigned`; target must be an engineer |
| `POST` | `/api/incidents/{id}/escalation` | reporter | `{reason}` → `pending` |
| `PUT` | `/api/incidents/{id}/escalation` | admin | `{status, reason}` — `none` / `granted` / `declined` |

**Reading history outside the UI.** `GET /api/incidents/{id}` returns the full `history`
array — this is what the frontend `HistoryTimeline` (M11/M12) renders, and it needs no
endpoint of its own. Locally the raw rows are also queryable directly via `psql` against
`incident_status_history`. CloudWatch logs are request logs (AD-16), not ticket movement —
they show a call was made, not what changed.

### Facility endpoints (M6)

Everyone signed in reads; only admins write. `{id}` is the building, floor, or seat being addressed; every list takes `q`, `sort` (`name`, `created_at`), `page`, `limit`.

| Method | Path | Result |
|---|---|---|
| `GET` / `POST` | `/api/facilities/buildings` | list / create `{name}` |
| `GET` / `PUT` / `DELETE` | `/api/facilities/buildings/{id}` | read / rename `{name}` / archive (cascades to floors and seats) |
| `GET` / `POST` | `/api/facilities/buildings/{id}/floors` | list / create `{name}` |
| `GET` / `PUT` / `DELETE` | `/api/facilities/floors/{id}` | read / rename / archive (cascades to seats) |
| `GET` / `POST` | `/api/facilities/floors/{id}/seats` | list / create `{name}` |
| `GET` / `PUT` / `DELETE` | `/api/facilities/seats/{id}` | read / rename / archive |

Archived locations are hidden everywhere (`404`) and cannot be restored; floors and seats cannot move to another parent — `PUT` accepts only the name.

### Engineer endpoints (M7)

| Method | Path | Access | Result |
|---|---|---|---|
| `GET` | `/api/engineers?available=&q=&sort=&page=&limit=` | admin | engineers with `is_available` and `workload` (active tickets); `sort=workload` shows who has capacity |
| `GET` | `/api/engineers/me` | engineer | own profile and workload |
| `GET` | `/api/engineers/{id}` | admin | one engineer |
| `PUT` | `/api/engineers/{id}/availability` | admin, or that engineer | `{is_available}`; current tickets stay; unavailable engineers cannot be assigned new ones |

### Note endpoints (M8)

Everyone who can see the incident can read and write its conversation (a `404` otherwise). A `closed` incident is read-only, except that an admin may still remove a note.

| Method | Path | Who | Result |
|---|---|---|---|
| `GET` | `/api/incidents/{id}/notes?page=&limit=` | can see the incident | oldest first; removed notes stay as placeholders with `body: null` |
| `POST` | `/api/incidents/{id}/notes` | can see it, not closed | `{body}` (≤ 5,000 chars) → `201` comment |
| `PUT` | `/api/incidents/{id}/notes/{note_id}` | the author, not closed | `{body}`; sets `edited_at` |
| `DELETE` | `/api/incidents/{id}/notes/{note_id}` | the author, or an admin (even when closed) | `204` soft delete |

### Report endpoints (M10)

| Method | Path | Access | Result |
|---|---|---|---|
| `GET` | `/api/reports/summary` | any role | counts by status, priority, category, escalation, and the oldest active ticket — over what the caller can see |
| `GET` | `/api/reports/hotspots?status=&limit=` | admin | top buildings, floors, and seats by incident count (archived ones included and flagged) |
| `GET` | `/api/reports/timings?status=` | admin | time to assign, to acknowledge (first move to `in_progress`), and to resolve, each from creation: count, median, average in seconds |
| `GET` | `/api/reports/attention?limit=` | admin | blocked incidents with the reason from history; pending and granted escalations with the reporter's reason |

Engineer availability and workload come from `GET /api/engineers?sort=workload` (M7).

### Live checks leave permanent rows

Live checks go through the deployed Lambdas, which always use the `public` schema, so they cannot use the throwaway schemas the test suite uses. Anything they create that reaches `incident_status_history` can never be deleted — the append-only trigger refuses, which is the point of it. Live checks therefore use `live.*` email addresses and `Live …` names, and those rows are left in the dev database deliberately.

### Local gotcha: deploys fail until the first admin is configured

Until `TF_VAR_bootstrap_admin_email` and `TF_VAR_bootstrap_admin_password_hash` are set (see First admin above), any deploy against a database with no admin fails at the seeding step — by design. `start-dev.sh` treats a failed deploy as a LocalStack problem and **restarts LocalStack before retrying**, which fails the same way. Set the two variables once and this never occurs.

## Deliberately not done

Recorded so the gaps are on the record rather than implied by silence. Each is a scope decision with a reason:

- **Progressive web app capabilities.** Listed among the workshop's expected frontend capabilities. Large, and orthogonal to every graded outcome this project can reach in the time available. Revisit only if M1–M14 are complete.
- **AI-assisted features.** Same reasoning.
- **True real-time updates.** The expected-capabilities list asks for them; `infra/` contains no WebSocket API, so delivering them means writing new infrastructure rather than using the scaffold. The plan is optimistic UI with short polling on the views where staleness is visible, stated as the trade rather than presented as real-time.
- **Email verification at registration.** There is no email infrastructure in `infra/` — SES would be new infra. Domain validation is enforced server-side; deliverability is not verified. A fake verification step would *look* like a control while being none.
- **Integrations with external systems.** Explicitly out of scope per the assignment.
- **Automatic escalation by age or SLA.** Needs a scheduled job; `infra/` has none, so it would be new infrastructure. Ticket age is shown on the admin dashboard instead, and escalation stays a human request and decision (AD-20).
- **Escalation history.** The incident stores only the current escalation status; reasons, earlier requests, and decisions survive only as notes. Simpler data navigation was preferred over request history, which no required question asks for (AD-20).
- **Brute-force protection (rate limiting, account lockout).** There is no API Gateway or WAF in `infra/` to rate-limit requests, and a per-account lockout would let an attacker lock any employee out on purpose. bcrypt's deliberate slowness is the brake; login failures never reveal whether the email exists.
- **Custom CloudWatch metrics.** Lambda's built-in metrics (invocations, errors, duration, throttles) plus Logs Insights queries over the JSON logs answer every operational question the app has. Embedded Metric Format would add metrics without new infrastructure, but nothing requires it yet (AD-16).
- **Restoring archived locations.** Archiving is final in the MVP: a restored building could collide with a newer one of the same name, and resolving that needs rules nobody asked for. An admin can create the location again (M6).
- **Engineer specialties.** Engineers carry availability but not the categories they handle. No required question depends on it, and matching engineers to categories would need its own rules and a second migration (M7).
- **Indexed text search.** `q` searches with `ILIKE`, which scans the table. At workshop scale that is instant; at real volume a `pg_trgm` trigram index is the upgrade path (M9).
- **Dashboard caching.** Reports are computed live from the database on every request; at this scale that is fast, and precomputed tables would add a staleness problem for no gain (AD-19).
- **An always-warm database.** Aurora Serverless v2 is left to pause at zero capacity when idle, so the **first request after a quiet spell takes roughly 15–20 seconds** while it resumes; later requests are fast. Keeping a minimum capacity would remove the wait but bill for idle time around the clock. The connection timeout (25 s) is sized to wait out a resume while staying under CloudFront's 30-second origin timeout. **Demo tip:** make one request a minute beforehand to wake it.
- **A single cookie mechanism.** The refresh cookie is sent both as the Lambda `cookies` field (which AWS honours) and as a `Set-Cookie` header (the only form LocalStack honours), so AWS responses carry the same cookie twice. It is harmless and deliberate: one code path runs in both environments, keeping LocalStack a working fallback for demos.
- **Seat occupants.** Seats are places an incident happens, not places people are assigned to — the brief never maps people to seats, and users carry no `seat_id`. Modelling occupancy would add a second meaning to every seat for no question the app must answer (AD-22).

## Roadmap

Beyond the MVP, and not started:

| Area | Focus |
|---|---|
| SLA and escalation automation | Age-triggered escalation rather than manual only (**AD-20** governs the manual model first) |
| Notifications | Requires the email infrastructure noted above |
| Observability | Structured JSON logs with a correlation ID propagated from the browser (**AD-16**) |
| Attachments on incidents | Photographs of the actual fault; S3 already exists in the stack |
| Recurring-issue detection | Beyond counting — clustering repeat faults per seat |

---

## Upstream

This repository is a fork of [Citi/coding-workshop-participant](https://github.com/Citi/coding-workshop-participant). The scaffold in `bin/`, `infra/`, `backend/_examples/`, `docs/`, and `data/` is the workshop organizers' work, licensed MIT-0 — see `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `DCO.md`, and `SECURITY.md`, all unchanged from upstream. Everything under `backend/<service>/` and `frontend/src/`, plus `AGENTS.md` and `CLAUDE.md`, is this submission.

This file replaces the upstream README, whose content remains in git history. Credit for the workshop scaffold belongs to its authors:

* Colin Heilman — [@heilmancs](https://github.com/heilmancs)
* Eugene Istrati — [@eistrati](https://github.com/eistrati)
* Isaiah Cornelius Smith — [@corneliusmith](https://github.com/corneliusmith)
* Juan Arevalo — [@jparevalo27](https://github.com/jparevalo27)
* Michael Annucci — [@michael-annucci](https://github.com/michael-annucci)

Security issues in the scaffold itself should follow the upstream [Security Issue Notifications](./CONTRIBUTING.md#security-issue-notifications) process.
