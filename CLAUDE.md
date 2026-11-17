# CLAUDE.md — Desktop Mascot for Muse (Claude Code operating manual)

Companion to `AGENTS.md` (shared rules) and `MEMORY.md` (project history).
Read all three before acting.

## A. Startup protocol

1. Read `AGENTS.md`, then `MEMORY.md` (check "Current Project State" and
   "In-Progress Work" — another session may have left work half-done).
2. Run `git status -sb` and `git log --oneline -5`. Note the branch
   (**`main`**) and any uncommitted changes — inspect them before editing
   anything nearby.
3. Check whether `MEMORY.md` already records the requested work (completed,
   in progress, or failed). Don't redo it blind.
4. Locate the implementation, configs, and any tests touching the task
   area (see directory map in `MEMORY.md` §3).
5. Confirm the package manager state: `pnpm --version` should be 12.19.0,
   `node --version` ≥ 24, `pnpm-lock.yaml` present and in sync
   (`pnpm install --frozen-lockfile` must succeed in CI).

## B. Project knowledge

- **What it is:** a resident Windows desktop mascot and chat-integration
  app for Muse (a personal AI agent). Tauri 2 + vanilla JS (no frontend
  framework). Windows-only. No backend, no DB, no auth of its own (the
  Muse login lives in the app's WebView session).
- **Verified versions:** pnpm 12.19.0 · node ≥ 24 · Tauri 2 · Rust edition
  2024 · vitest 5 · Playwright (Edge). Don't assume other versions; check
  `package.json` when in doubt.
- **Key files:** `package.json` (scripts),
  `src-tauri/tauri.conf.json` (installer metadata + updater),
  `src-tauri/src/main.rs` / `lib.rs` (backend: session window, allowlist,
  session reload, usage-limit), `src-tauri/src/session_bridge.js` (Muse
  DOM bridge), `src/index.html` + `src/main.js` (mascot/session UI),
  `src/settings.html` + `src/settings.js` (Settings window),
  `.github/workflows/release.yml` (tag-triggered Windows release),
  `docs/SPEC.md` (feature spec, single source of truth),
  `.env.example` (placeholders only).
- **Commands:**
  - `pnpm install` / `pnpm dev` (Tauri dev — launches the mascot app) /
    `pnpm run build` (Tauri build, NSIS installer)
  - `pnpm run test:unit` (vitest) · `pnpm run test:rust` (`cargo test`) ·
    `pnpm run test:e2e` (Playwright, Windows + Edge) · `pnpm test` (all
    three layers)
  - No lint / typecheck / format scripts exist in this repo.
- **Environment:** copy `.env.example` → `.env` if needed (no app
  secrets). Tauri signing vars are local-only / GitHub Secrets, never
  committed.
- **Release:** push a `v*` tag (or `workflow_dispatch`) →
  `.github/workflows/release.yml` builds the Windows NSIS installer +
  portable ZIP + updater artifacts (`latest.json`) as a **draft** GitHub
  release. Requires `TAURI_SIGNING_PRIVATE_KEY` (+ optional password)
  secrets. See `release.md`.
- **Compatibility constraints:** pnpm strict resolution; Rust edition
  2024 (no `gen` identifiers, `unsafe extern "system"`); the session
  bridge only recognises Muse's English UI; avatar `.mp4` files are
  never committed.

## C. Task execution protocol

1. Translate the request into concrete requirements + acceptance criteria.
2. Inspect current implementation and related configs/tests.
3. Identify risks, affected modules, and whether the change touches
   installer metadata, the release workflow, or the session bridge /
   allowlist.
4. Plan proportionally to task size; for multi-step work, set milestones.
5. Implement with existing conventions (frontend in `src/`, backend in
   `src-tauri/`).
6. Review the full diff for regressions and unintended changes
   (`git diff --check` for whitespace).
7. Run relevant verification (unit tests and Rust tests at minimum for
   code changes; `pnpm run build` for release-affecting changes) and fix
   regressions you introduced. Note: Rust tests and e2e need Windows;
   this environment cannot run them — say so instead of claiming them.
8. Update `MEMORY.md`: what changed, why, verification results, remaining
   risks/pending work. Checkpoint long tasks instead of waiting until the
   end.
9. Final report: files changed, behavior changes, exact commands run with
   outcomes, what was NOT verified, next recommended step.

## D. Truthful verification policy

Label every check exactly one of:

- **NOT RUN** — no verification performed (say why).
- **PASS** — command completed successfully (give the command).
- **FAIL** — command failed (give the command + error).
- **BLOCKED** — could not proceed; name the specific blocker.
- **PARTIAL** — only part of the required verification succeeded.

Rules: a running dev server ≠ a passing production build. A passing
unit test run ≠ passing Rust tests. `pnpm run build` failing means the
installer was never produced — say so. Never mark a task "fully verified"
while required checks are missing; list them as NOT RUN/BLOCKED instead.

## E. Memory maintenance policy

`MEMORY.md` is the durable record. At every meaningful checkpoint and on
task completion, record: objective, implementation + files changed,
decisions + rationale, exact commands run and outcomes, errors with
confirmed (or unconfirmed) root causes, unresolved issues/blockers,
pending tasks + next action, and current version/status changes. Append —
don't silently rewrite history; if an old entry is wrong, mark it
corrected and explain. Never invent timestamps, hashes, or results.

## F. Skills, subagents, and tool usage

- Do not assume any MCP server, plugin, or subagent exists — verify first.
- When delegating: hand over the task requirements, the relevant
  `MEMORY.md` entries, and require the delegate to report files
  inspected/changed, evidence-backed findings, checks actually run, and
  open issues. You reconcile and write the memory update.

## G. Git safety

- Branch is `main`. Never force-push or rewrite history without explicit
  user authorization. No `reset --hard`, no `clean -fdx` on the user's
  tree.
- Don't commit or push unless the user asked. If they did: single focused
  commits, and verify `git status` is clean of unintended files first
  (never `dist/`, `node_modules/`, `src-tauri/target/`, avatar `.mp4`,
  `.env`).
- Record commit hashes only after they exist.
