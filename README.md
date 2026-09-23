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
| M1 | Environment validated | VDI, `start-dev.sh`, hello-world service reachable on `:3001`, frontend on `:3000` | Not started |
| M2 | Schema and migrations | incidents, facilities, engineer profiles, notes, users — **plus the status-history table** | Not started |
| M3 | Authentication | Registration gated to `acme.inc`, password hashing, JWT issue and verify | Not started |
| M4 | Authorization | Three personas, role **and** row-level ownership, one shared enforcement point | Not started |
| M5 | Incident CRUD + workflow | The five statuses, with transitions enforced server-side | Not started |
| M6 | Facilities CRUD | Building → floor → seat | Not started |
| M7 | Engineer profiles + assignment | Profiles linked to accounts, ticket assignment | Not started |
| M8 | Ticket notes | Threaded communication on an incident | Not started |
| M9 | Search, filter, pagination | Server-side, shared across all three persona views | Not started |
| M10 | Dashboards and reporting | Per-persona; counts by status/priority/assignee, hotspots, MTTA/MTTR | Not started |
| M11 | Visual workflow | Per-incident stepper and a status-grouped board | Not started |
| M12 | Responsive and accessible UI | Mobile and desktop, consistent interaction states | Not started |
| M13 | Test suites | To the coverage targets in [Testing](#testing) | Not started |
| M14 | Cloud deployment | Verified working end to end on AWS, not only in LocalStack | Not started |

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
| **M4 — authorization** | The three personas as roles. Role checks **and** row-level ownership — an Employee reaches their own incidents, an Engineer their assigned ones, an Admin everything — both enforced in one shared place rather than per handler. Workflow transitions authorized by role. A consistent `403` shape. |

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
| `3001` | Lambda Function URLs |
| `4566` | LocalStack |
| `4556` | S3 website endpoint (LocalStack) |
| `5432` | PostgreSQL |

```sh
source ~/.bashrc
./bin/start-dev.sh          # whole local stack
./bin/deploy-backend.sh     # Lambdas + infra
./bin/deploy-frontend.sh    # S3 + CloudFront
./bin/generate-env.sh       # regenerate frontend/.env.local from Terraform outputs
```

`./bin/cleanup-environment.sh` destroys all deployed AWS resources and cannot be undone.

## Repository layout

```
coding-workshop-participant/
├── AGENTS.md                 spec, architecture facts, decision register (AD-00 … AD-22)
├── CLAUDE.md                 working conventions
├── README.md                 this file
├── backend/
│   ├── _examples/            provided templates — copied out, never edited in place
│   │   └── python-service/   function.py, postgres_service.py, requirements.txt
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

Three of the seven questions the application must answer are about *time*: how quickly incidents are acknowledged, assigned, and resolved. **None of them can be answered from a mutable `status` column**, which knows only where a ticket is now. They need an append-only record of every transition — from, to, who, when, and why — written from the first incident onward.

Adding that table in week two does not backfill it. Every incident created before it exists has no history and never will, and the dashboards in M10 would be computed over a partial record while appearing complete. That is why M2 leads the milestone order and why the history table is named explicitly in its scope rather than left to emerge.

The same table answers *"which incidents are escalated or blocked, and why"* — the blocked reason belongs on the transition, not on the incident.

## Decisions

Open architecture decisions live in **`AGENTS.md` → Pending architecture decisions**, as AD-00 through AD-22 with options, a recommendation, and what each blocks. One is settled:

| ID | Decision | Choice |
|---|---|---|
| AD-00 | Database | **PostgreSQL.** MongoDB/DocumentDB is not used; `pymongo` and every `MONGO_*` path are removed from services derived from the template. |

The rest are open. The rule is that an open decision gets settled deliberately and recorded, not resolved silently in a commit — the register is the artifact that makes trade-offs explainable afterwards, which is half of what the workshop grades.

*(This table is to be extended as decisions close.)*

## Known defects in the provided scaffold

Found by reading the repository before writing any code. Recorded because each one fails in a way that does not name its cause:

- **The Python template's PostgreSQL config has no SSL branch.** `PG_CONFIG` in `backend/_examples/python-service/function.py` builds a connection string with no `sslmode`. Local PostgreSQL accepts that; Aurora does not. A service copied unchanged works perfectly in LocalStack and fails on first cloud deploy — the environment where the failure is most expensive to diagnose.
- **The same config falls back to `test`/`test`/`test`.** A missing injected variable becomes a wrong-database connection rather than an error.
- **`frontend/.env.sample` advertises `REACT_APP_*` variables, which Vite does not expose.** Only `VITE_*` reaches `import.meta.env`. `bin/generate-env.sh` writes both prefixes, so the generated file works and the *sample* file is the trap — anyone following the sample gets `undefined` with no error.
- **`frontend/README.md` lists Material UI and React Router as prerequisites; `package.json` contains neither.** Both are required by the assignment. They must be installed.
- **`docs/validation.md` lists `docs/implementation.md`, `docs/testing.md`, and `docs/evaluation.md` in its repository tree. None of the three exist.**
- **The endpoint table and the `curl` examples disagree on the path prefix** — `/{service}` versus `/api/{service}`. (**AD-06**.)
- **The repository's root README describes a team-management application.** That is generic workshop filler and not this assignment. Where it conflicts with the problem statement, the assignment wins.

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

## Deliberately not done

Recorded so the gaps are on the record rather than implied by silence. Each is a scope decision with a reason:

- **Progressive web app capabilities.** Listed among the workshop's expected frontend capabilities. Large, and orthogonal to every graded outcome this project can reach in the time available. Revisit only if M1–M14 are complete.
- **AI-assisted features.** Same reasoning.
- **True real-time updates.** The expected-capabilities list asks for them; `infra/` contains no WebSocket API, so delivering them means writing new infrastructure rather than using the scaffold. The plan is optimistic UI with short polling on the views where staleness is visible, stated as the trade rather than presented as real-time.
- **Email verification at registration.** There is no email infrastructure in `infra/` — SES would be new infra. Domain validation is enforced server-side; deliverability is not verified. A fake verification step would *look* like a control while being none.
- **Integrations with external systems.** Explicitly out of scope per the assignment.

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
