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
| AD-07 | Auth mechanism | Self-issued JWT, verified in every handler, with expiry | No new infra (not Cognito/OAuth); a required deliverable, done for real | pre-session |
| AD-07a | Signing algorithm | RS256 | Only `auth` can mint tokens; other services verify with a public key | pre-session |
| AD-07b | Signing key storage | Secrets Manager (cloud); env var dev key when `IS_LOCAL` | IAM grant already exists; only `auth` needs the secret | pre-session |
| AD-07c | Password hashing | bcrypt | argon2id's memory-hardness is a direct cost at 128 MB Lambda | pre-session |
| AD-07d | Refresh tokens | Rotated on every use, stored hashed, reuse detection revokes the family | Makes a stolen refresh token detectable | pre-session |
| AD-08a | Token storage | Refresh token in httpOnly `SameSite=Strict` cookie; access token in memory | Script cannot read the long-lived credential; no CSRF surface on API calls | pre-session |
| AD-08b | Origin sealing | Function URLs `AWS_IAM` behind a CloudFront OAC | Only the distribution can invoke a Lambda; direct calls get 403 | pre-session |
| AD-08c | Access-token transport | `X-Access-Token` header, not `Authorization` | OAC's SigV4 signature occupies `Authorization` | pre-session |
| AD-17 | Incident state machine | Admin any→any; engineer (assigned only) `Open→In Progress`, `In Progress⇄Blocked`, `In Progress→Resolved`; employee none; only admins close | No skip keeps the acknowledged timestamp; unblock avoids admin bottleneck; no review state, so admin closing is the confirmation | 2026-09-23 |
| AD-18 | Visual workflow | MUI `Stepper` per incident + status-grouped board on Admin/Engineer dashboard | Stepper answers the requester, board answers the dispatcher; drag only once AD-17 is enforced server-side | 2026-09-23 |

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
| Dev proxy headers | `bin/proxy-server.js` forwards `x-access-token` and `cookie` | It dropped both, making every local request anonymous | 2026-09-22 |
| Local dependency build | `start-dev.sh` pip targets Python 3.13 / `manylinux2014_x86_64` | Host `pip` belongs to 3.14; compiled wheels failed to import in Lambda | 2026-09-22 |
| DB credentials | Read with `os.environ[...]`, no fallbacks; `sslmode=require` when not local | Terraform always injects them, so a missing one is a deploy bug, not a default | 2026-09-22 |
| Service-dir gitignore | Allow-list: only `*.py`, `requirements.txt`, `tests/` tracked | pip installs into the service dir; package names cannot be enumerated | 2026-09-22 |

## Rules settled beneath a parent decision

Fixed rules recorded under a parent. AD-17 has since closed; AD-09 and M8 are still open.

| Parent | Rule | Why | Recorded |
|---|---|---|---|
| AD-17 | Notes writable on every status except `Closed` | "Open incidents" means not yet closed; otherwise the requester is locked out once work starts | 2026-09-23 |
| M8 | One chronological conversation per incident, no reply nesting | The personas describe a two-way conversation, not a forum | 2026-09-23 |
| AD-09 | Notes are soft-deleted, never hard-deleted | Keeps the record behind "how effectively are employees informed" | 2026-09-23 |
| AD-17 | `Blocked` reason stored on the status-history row **and** posted as a note | History is the undeletable record the report reads; the note tells the requester | 2026-09-23 |
| AD-17 | Incident responses include `allowed_transitions`, computed server-side by the `incidents` workflow module; the UI shows only those | The rules exist once; the UI cannot offer a move the server would refuse | 2026-09-23 |
| AD-17 | Added `Unassigned` status before `Open`; only admins assign, which moves `Unassigned → Open`; status is `Unassigned` iff no assignee (code + DB `CHECK`) | Triage queue is a status filter; time-to-assign is an ordinary transition. Deliberate deviation from the brief's five statuses | 2026-09-23 |
| AD-17 | Only admins reassign; reassignment is not recorded | Current distribution comes from the incident's assignee; history of who held a ticket is a stated scope cut | 2026-09-23 |
| AD-09 | Only the author edits a note; author or Facility Admin soft-deletes | Admins moderate but never rewrite someone else's words | 2026-09-23 |

## Still open

AD-05 · AD-06 · AD-09 · AD-10 · AD-11 · AD-12 · AD-13 · AD-14 · AD-15 ·
AD-16 · AD-19 · AD-20 · AD-21 · AD-22 — see `AGENTS.md` → Pending architecture
decisions.
