# CLAUDE.md

## 0. First action, every session
**Read `AGENTS.md` in this directory before responding.** It holds the product spec, architecture facts, conventions, and the pending decision register (AD-00 … AD-22). Re-read it before any architecture or scope decision. Do not summarize it back to the user.

`AGENTS.md` is the source of truth. This file only covers *how to work*, not *what to build*.

## 1. Mode: delivery with high user decision agency
The user needs to understand the underlying infrastructure, architecture, and workflows. This is a graded workshop — the user must be able to defend every choice in their own words, so a correct answer they cannot explain is a failed answer.

- **Name the concept.** Each addition states what it demonstrates and which evaluation dimension it serves (Implementation, Design, Code, Testing, Experience).
- **Justify design choices.** Which principle or pattern, and what the alternative would have cost.
- **Prefer the clear implementation** over the clever one. If a shortcut exists, mention it but don't use it.
- **Request explanation.** Once a response is provided, ask the user to respond with their understanding of the current state.
- **Verify user understanding.** Go back and forth until understanding is ensured and all decisions can be justified by the user.

## 2. Scope discipline
- The MVP list in `AGENTS.md` → Product context is the boundary. Stay in it.
- **Never silently settle an `OPEN` decision in the register.** Hitting one mid-task means: stop, state the options and the recommendation, get a call, record it in `AGENTS.md` with status `DECIDED`, then continue.
- Decisions marked `DECIDED` are closed. Don't relitigate them; don't reintroduce what they ruled out (e.g. MongoDB under AD-00).
- No post-MVP concepts leaking backward. AD-15 (PWA, AI integration) is out until the core is done.
- Don't add libraries, config, or abstraction the current task doesn't need. Every new dependency ships in a Lambda bundle.

## 3. Environment (VDI, not this machine)
The repo is cloned inside an **Amazon WorkSpaces VDI** — a Linux desktop, separate from the Windows machine this session may be running on.

- **Project root (VDI):** `~/coding-workshop-participant`
- **Shell:** bash on Linux. Not PowerShell. Unix paths, `sudo`, `~/.bashrc`.
- **Always `source ~/.bashrc` first in a fresh shell** — `AWS_REGION`, `EVENT_ID`, `PARTICIPANT_ID`, `PARTICIPANT_CODE`, and `LOCALSTACK_AUTH_TOKEN` live there and nothing works without them.
- **Local stack runs in the VDI:** LocalStack `:4566`, frontend `:3000`, Lambda Function URLs `:3001`, PostgreSQL `:5432`. Docker is local to the VDI.
- **The VDI is ephemeral.** It is destroyed shortly after the workshop, and stored credentials are erased with it. Anything worth keeping must be pushed to GitHub before the end.

### How to connect and read the repo

**Preferred: run Claude Code inside the VDI.** Everything the work needs — the repo, Docker, LocalStack, `awscli`, `terraform`, the running ports — is in there. Any other arrangement means editing code in one place and running it in another.

```sh
# in a VDI terminal
npm install -g @anthropic-ai/claude-code    # or: curl -fsSL https://claude.ai/install.sh | bash
cd ~/coding-workshop-participant
source ~/.bashrc
claude
```

Then `AGENTS.md` and `CLAUDE.md` sit at the repo root and load automatically, file edits and `./bin/start-dev.sh` happen in the same place, and `curl localhost:3001` actually reaches the service being edited.

**Fallback, if Claude Code can't be installed in the VDI: use GitHub as the bridge.**

- VDI is authoritative for anything that runs. This machine is for design, documentation, review, and drafting only.
- Loop: commit and push from the VDI → `git pull` on this side → edit → push → `git pull` in the VDI → run and verify there.
- Under this mode, never claim something works — nothing here can execute the stack. Say "untested, verify in the VDI" and give the exact command to run.
- Clone target on this machine: `C:\Users\daniel\coding-workshop-participant`.

**Rejected approaches, so they don't get retried:** SSH into WorkSpaces (not exposed by default; needs security-group and key changes that are almost certainly not yours to make), and clipboard or file-copy sync through the WorkSpaces client (fine for a token, unworkable for a repo).

**Confirm tooling is permitted.** `docs/validation.md` names GitHub Copilot as allowed and is silent on everything else. Check with the organizers before relying on Claude Code for graded work — this is the user's call to make, not an assumption to build on.

## 4. Response shape
- No bullet walls. Short.
- For explanations, prose is fine but keep it short.
- Code blocks contain code; explanation goes around them, not as comment spam inside.
- Comments explain *why*, not *what*.
- No unrequested refactors of code the user already accepted.
- When correcting the user's code, say what was wrong before showing the fix.

## 5. Coding style

**JavaScript / JSX (frontend) — Allman braces.** **Every** opening brace goes on its own line beneath the line it opens: functions, components, control flow (`if`/`else`/`for`/`while`/`switch`/`try`). `else`, `catch`, and `finally` start a new line after the closing brace, never trailing it.

```jsx
function IncidentRow({ incident, onAssign })
{
    if (incident.status === "Blocked")
    {
        return <BlockedRow incident={incident} reason={incident.blockedReason} />;
    }
    else
    {
        return <OpenRow incident={incident} onAssign={onAssign} />;
    }
}
```

Two mechanical notes, since JS is not Java:

- **Never add Prettier.** It has no brace-style option and will silently reformat every file to K&R. The provided `frontend/eslint.config.js` carries no formatting rules, so nothing currently fights this style. To enforce it rather than rely on discipline, add `@stylistic/eslint-plugin` and `'@stylistic/brace-style': ['error', 'allman']` — ESLint 10 dropped formatting rules from core, so the plugin is required.
- **Watch automatic semicolon insertion.** Allman applies to *blocks*, not object literals. A returned object keeps its brace on the same line — `return {` — or ASI inserts a semicolon after `return` and the function silently returns `undefined`. Same for arrow bodies: `() => ({ ... })`.

**Python (backend)** — Allman is not expressible in Python; it is indentation-based. PEP 8, 4-space indent, `snake_case`. Type hints on anything crossing a module boundary. Let `ruff` settle formatting arguments rather than debating them.

**Frontend structure** — `PascalCase` components, `camelCase` everything else. One component per file under `src/components/`; pages under `src/pages/`; all network calls in `src/services/`, never inline in a component.

Carried over from the previous convention:

- **Function/method names**: short and technical. Abbreviations are fine — `calcMttr`, `fmtStatus`, `nextTicketId`.
- **Variable names**: descriptive. Short loop counters (`i`, `j`) are fine, but anything carrying meaning gets a real name — `assignedEngineer`, not `ae`. Legibility beats brevity every time.
- **Comments**: short, lowercase, one line, above the thing they describe. Say *why*, not *what*. A fragment is enough. No docstring blocks on obvious functions.

**Structure:** organized by feature/domain, not by monolithic file — it is scored directly. Shared logic (auth verification, DB connection, error envelope, validation models) is written once; see AD-02 for how it gets into each bundle.

## 6. Before finishing a turn
- Does it run? Run it. Backend: `curl` the Function URL on `:3001` and tail the Lambda log. Frontend: load `:3000`.
- Did I stay inside the MVP scope?
- Did I settle an `OPEN` decision without asking? If so, back it out or get the call now.
- Did I explain the *why*, and ask the user to play it back?
- Did this turn resolve or change anything in the `AGENTS.md` decision register? Update it in the same turn.
- Tests still passing, and is the new code covered? Targets are in `AGENTS.md` → Testing.
- If working in fallback mode (§3), did I label unrun code as unverified?
