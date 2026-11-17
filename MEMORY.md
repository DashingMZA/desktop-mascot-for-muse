# MEMORY.md — Desktop Mascot for Muse

Durable project history and current state. Rules live in `AGENTS.md`;
Claude workflow in `CLAUDE.md`. This file records facts, work, decisions,
and status. Append new entries; don't silently rewrite history. Mark
uncertain items UNKNOWN / UNVERIFIED / PROPOSED.

## 1. Project Overview

Desktop Mascot for Muse is a resident Windows desktop mascot and
chat-integration app for Muse (a personal AI agent, `https://muse.ai`).
It sits in a corner of the desktop as a circular avatar mascot, shows
animations matched to Muse's state, and opens the full Muse chat screen
(session screen) on double-click or `Ctrl + Shift + M`.

- **Repo:** `github.com/DashingMZA/desktop-mascot-for-muse`, a fork of
  `mowthow-works/desktop-mascot-for-muse` (Japanese upstream). Default
  branch **`main`**. Owner: Muhammad Zaheer Ahmad (DashingMZA).
- **License:** MIT (`LICENSE`).
- **Stack:** Tauri 2 + vanilla JS (no frontend framework), Rust edition
  2024, pnpm 12.19.0, Node ≥ 24, vitest 5 (unit), Playwright (e2e,
  Edge), `cargo test` (Rust).
- **Platform:** Windows 10/11 only. Installer: NSIS. Portable ZIP.
  Auto-updater via GitHub releases (`latest.json`).
- **External data:** the Muse session, loaded in an embedded WebView
  from `https://muse.ai`. Login redirects through Meta Accounts Center
  stay in-app (allowlist). No backend, no database, no accounts of its
  own, no telemetry.
- **Avatar videos:** user-provided `.mp4` files, never committed — only
  `src-tauri/assets/avatars/setting.json` and
  `src-tauri/assets/avatars/plugin/quotes.json` are tracked.

## 2. Current Project State

- **Branch:** `main`, remote at `d7feb9b` (2026-11-16, "Add project
  docs: MEMORY, CLAUDE, release guide, contributing, security, conduct,
  accessibility, PR template, changelog"), tagged `v1.1.11` and
  released. Working tree CLEAN and in sync with remote (verified
  2026-11-16).
- **Version:** 1.1.11 (package.json, Cargo.toml, tauri.conf.json, README
  badge, SPEC.md §18 all in sync).
- **v1.1.11 RELEASED + PUBLISHED 2026-11-16** (tag `v1.1.11` on
  `d7feb9b`): assets = portable ZIP + installer + `.sig` +
  `latest.json`. Installer attached under the versioned name
  `Desktop.Mascot.for.Muse_1.1.11_x64-setup.exe`, not the AGENTS.md §4
  fixed name — decision still open.
- **Last verified checks (2026-11-16, sandbox):** `pnpm run test:unit`
  36/36 PASS. Rust tests and e2e NOT RUN in sandbox (no cargo, no Edge)
  — covered by CI and by the owner's Windows runs.
- **CI:** GitHub Actions — CI #5 (69d7c3d) SUCCESS; CodeQL #3/#4 SUCCESS.
  CI #3/#4 failed on the missing `glib-2.0` system library; fixed by
  installing Tauri's Linux prerequisites in `ci.yml`.
- **Desktop status (user-reported):** login confirmed working 2026-11-16
  (user: "login ho gya"); session on `https://muse.ai/?__pwa=1`. Full
  `npm test` on Windows still pending (owner to run).
- **GitHub Issues are DISABLED** in this repo — issue templates exist but
  only appear once Issues are enabled in repo Settings.
- **Labels:** all 5 created 2026-11-16 (`dependencies`, `workflows`,
  `frontend`, `backend`, `tests`).

## 3. Architecture and Directory Map

```text
src/
  index.html / main.js / styles.css   Mascot + session-screen UI
  settings.html / settings.js / settings.css   Settings window
src-tauri/
  src/main.rs                         Tauri entry point
  src/lib.rs                          Backend: session window, allowlist,
                                      session reload, usage-limit, commands
  src/session_bridge.js               Muse DOM bridge (chat input, state,
                                      usage-limit pill, send)
  tauri.conf.json                     Product/bundle metadata, updater,
                                      NSIS installer, resources
  capabilities/default.json           Permissions (core:default, opener:default)
  assets/avatars/                     setting.json + plugin/quotes.json
                                      (tracked); .mp4 videos (gitignored)
tests/
  unit/                               vitest (session_bridge, lib helpers)
  e2e/                                Playwright (Windows + Edge)
docs/
  SPEC.md                             Feature spec (single source of truth)
  CUSTOMIZE.md                        Customization guide
.github/workflows/                    ci.yml, codeql.yml, label.yml, release.yml
.github/                              dependabot.yml, labeler.yml,
                                      ISSUE_TEMPLATE/, FUNDING.yml
```

Data flow: the session WebView loads `https://muse.ai/?__pwa=1` →
`session_bridge.js` reads Muse's state and usage-limit from the DOM and
injects chat input → `lib.rs` commands drive the mascot window (avatar
video per state, speech bubbles, unread badge, quick input).

## 4. Technology Versions and Constraints

| Item                 | Version                              | Notes                                                  |
| -------------------- | ------------------------------------ | ------------------------------------------------------ |
| pnpm                 | 12.19.0 (pinned via `packageManager`) | ONLY package manager; `pnpm-lock.yaml` is the lockfile |
| node                 | >= 24 (`engines`)                    |                                                        |
| Tauri                | 2                                    | NSIS bundle, updater plugin, sidecar-free              |
| Rust                 | edition 2024                         | `gen` is a keyword; `extern "system"` needs `unsafe`  |
| vitest               | 5                                    | unit tests (`tests/unit/`)                             |
| Playwright           | —                                    | e2e, Windows + Edge only (`channel: 'msedge'`)         |

Constraints: Windows-only (NSIS installer, Edge e2e, WebView2). The
session bridge only recognises Muse's **English** UI. Avatar `.mp4`
files are never committed.

## 5. Setup and Development Commands

```bash
pnpm install            # install (CI uses pnpm install --frozen-lockfile)
pnpm dev                # Tauri dev — launches the mascot app (needs Rust + WebView2)
pnpm run build          # Tauri build — NSIS installer
pnpm run test:unit      # vitest
pnpm run test:rust      # cargo test
pnpm run test:e2e       # Playwright (Windows + Edge)
pnpm test               # all three layers
```

Release: `git tag vX.Y.Z && git push origin vX.Y.Z` (or
workflow_dispatch) triggers `.github/workflows/release.yml` → draft
GitHub release with the NSIS installer + portable ZIP + updater
artifacts (`latest.json`). Full steps in `release.md`.

## 6. Architecture Decisions and Rationale

- **Tauri 2 over Electron:** smaller binaries, native WebView2.
  Consequence: desktop builds need per-OS CI (release.yml is
  Windows-only) and a signing key for the updater.
- **Vanilla JS frontend, no framework:** the UI is plain HTML/CSS/JS.
  Consequence: no build step for the frontend (`frontendDist: ../src`),
  no lint/typecheck tooling.
- **Session bridge reads Muse's DOM:** the bridge finds the chat input
  and usage-limit pill via DOM selectors. Consequence: it only works
  with Muse's English UI (Japanese selectors were removed 2026-11-16
  by owner decision).
- **Allowlist for auth redirects:** the session WebView only allows a
  fixed host list (muse.ai, Meta Accounts Center hosts, Google/Apple/
  Microsoft login hosts); anything else opens in the external browser.
  Consequence: every new auth host needs an allowlist entry in BOTH
  `lib.rs` (`is_session_allowed_host`) and `session_bridge.js`
  (`isSessionAllowedHost`).
- **pnpm 12.19.0 + node ≥ 24** (2026-11-16 migration): owner's standard
  toolchain across repos.
- **Avatar videos never committed:** `.mp4` files are user-provided and
  large; only the JSON configs are tracked.

## 7. Completed Work

### 2026-11-16 — Full Japanese → English translation (`9c938f5`)

- ~20 files / ~14,000 lines audited. Glossary: ラッキー → **Lucky**
  (avatar name), 無料プラン → **Free Plan**; identifiers, keys, CSS
  classes, URLs, logic, version numbers unchanged. Verified: 21 files,
  unit tests 36/36, JSON valid. `AGENTS.md` now requires English commit
  messages; `tauri.conf.json` NSIS languages `["English"]`; HTML
  `lang="en"`.

### 2026-11-16 — English-only cleanup (`0276bc5`)

- Owner overruled keeping Japanese DOM-selector fallbacks in
  `src-tauri/src/session_bridge.js` and directed English only; owner
  accepted the consequence (**bridge now only recognises Muse's English
  UI**) and confirmed their Muse UI is English. Removed all Japanese
  selectors/regex branches (~66 lines in session_bridge.js, 2 lines in
  src/main.js, 2 in DESIGN.md) + CJK punctuation. Verified: zero
  Japanese/CJK characters repo-wide, tests 36/36.

### 2026-11-16 — Meta auth-redirect allowlist (`4c4be1d`, `d0512b7`, `f9503d9`)

- Root cause of "Send error: UNSUPPORTED_DOM (input field not found)":
  Muse's auth flow redirects through Meta Accounts Center hosts not in
  the session WebView's allowed-host list, so the `on_navigation` guard
  bounced them to the external browser and the session stayed on
  `about:blank`. The allowlist lives in **two places that must stay in
  sync**: `is_session_allowed_host` in `src-tauri/src/lib.rs` and
  `isSessionAllowedHost` in `src-tauri/src/session_bridge.js`; pattern =
  exact host + `.host` suffix. Hosts fixed one per owner rebuild, each
  with regression tests in both Rust and JS: **facebook.com**
  (`4c4be1d`), **instagram.com** (`d0512b7`), **meta.com** + suffix
  (`f9503d9`). Full family now covered plus pre-existing muse.ai,
  accounts.google.com, appleid.apple.com, login.microsoftonline.com,
  login.live.com. **Login confirmed working 2026-11-16 ~13:22** (owner:
  "login ho gya"; log showed session on `https://muse.ai/?__pwa=1`).

### 2026-11-16 — Edition 2024 build breakage (`2ebbfed`, `7c6417d`)

- From the owner's own commits bumping `edition` to `"2024"`, changing
  the app identifier to `com.csofts.muse.gadgets` (which moves the app
  data dir, so a fresh login is needed after rebuild), version 1.1.11,
  pnpm migration. `gen` keyword collision in
  `schedule_debounced_config_update` renamed to `generation`
  (`2ebbfed`); `extern "system"` → `unsafe extern "system"` in
  `src-tauri/src/main.rs:9` (`7c6417d`). Static checks: no other `gen`
  identifiers, extern blocks, or `static mut`. Noted but unchanged:
  single-instance mutex name in main.rs still uses the old string
  `Local\works.mowthow.muse.gadgets.single_instance`.

### 2026-11-16 — Version sync to 1.1.11 (`9d8930d`, `2321294`)

- Owner's bump commit touched only package.json, causing 3 `docs_sync`
  test failures (proven pre-existing via `git stash` + re-run). Owner
  fixed Cargo.toml + tauri.conf.json and the README badge (`9d8930d`).
  SPEC.md §18 v1.1.11 row shipped inside `2321294`. Result: unit tests
  36/36.

### 2026-11-16 — Reload self-heal fix (`2321294`)

- `reload_session` only called `session.reload()`, so reloading
  `about:blank` returned `about:blank` and logs showed misleading
  `reload_incomplete … url_matched=true`. New pure helper
  `session_reload_target_url(before_url)` returns `SESSION_URL` when
  `before_url` is `about:blank`/empty, else `before_url`; blank case
  navigates (new log event `reload_navigate_blank`) instead of
  reloading, skips the restore branch; real pages (incl. mid-login auth
  pages) still reload in place. Regression test
  `test_session_reload_target_url` added.

### 2026-11-16 — GitHub issue templates (`069589b`)

- Created `.github/ISSUE_TEMPLATE/bug_report.md` (labels: bug, prefix
  `[Bug]`, sections incl. environment and session log at
  `%LOCALAPPDATA%\com.csofts.muse.gadgets\session_recovery.log`),
  `feature_request.md` (labels: enhancement, prefix `[Feature]`),
  `config.yml` (`blank_issues_enabled: false` only — no contact links,
  to avoid 404s). Both templates carry a "Please write your issue in
  English" note. Verified: remote HEAD = `069589b`, all 3 blobs match.
  Templates only appear once Issues are enabled (repo Settings →
  General → Features → Issues checkbox).

### 2026-11-16 — Screenshots (owner)

- The 4 mascot screenshots in `docs/` were re-taken by the owner from
  the live app and pushed as `b2540ae` (all show "Lucky" now). The
  session screenshot was re-taken by the owner as `064e3a9` (real
  capture: panel shows "Muse" / "Connected"). Agent-translated versions
  of both were superseded and discarded (push-files is text-only, so
  PNGs go via the GitHub web UI).

### 2026-11-16 — GitHub automation (`52ed5c2` + owner uploads)

- Created `.github/workflows/ci.yml` (push/PR to main + dispatch;
  pnpm install, `test:unit`, `test:rust`; e2e and `tauri build` skipped
  — Windows/Edge-only), `codeql.yml` (actions + javascript-typescript +
  rust, `build-mode: none`, weekly cron), `label.yml`
  (actions/labeler@v7), `.github/labeler.yml` (frontend/backend/
  documentation/workflows/tests), `.github/dependabot.yml` (weekly,
  npm + cargo + github-actions), `.github/workflows/release.yml`
  (Windows-only, `v*` tags + dispatch; NSIS installer + portable ZIP
  under fixed names; draft release; signing via repo Secrets).
- Skipped with reasons: content-dates.yml (no content system),
  deploy-to-github-pages.yml (no website), greetings.yml and summary.yml
  (Issues disabled).
- Push: the 6-file push failed (GitHub App lacks workflows permission,
  403 on git/trees). `.github/labeler.yml` + `.github/dependabot.yml`
  pushed as `52ed5c2`. Owner uploaded the 4 workflow files via web UI
  (`12ec25b`, `60cce10`, `7660c9d`, `6a1cf39`), VERIFIED byte-identical.

### 2026-11-16 — CI glib-2.0 fix (`69d7c3d`)

- CI #3/#4 FAILED at the "Rust tests" step (cargo test, exit code 101);
  unit tests passed. Root cause (from the owner's pasted log):
  `glib-sys` build failed — `pkg-config` could not find the system
  library `glib-2.0` ("Package glib-2.0 was not found"). The Ubuntu
  runner lacks Tauri's Linux system dev packages. Fix: install the
  Tauri Linux prerequisites (libwebkit2gtk-4.1-dev,
  libayatana-appindicator3-dev, librsvg2-dev, patchelf,
  build-essential, curl, wget, file, libssl-dev, libgtk-3-dev,
  libxdo-dev) in ci.yml before the Rust tests step. Owner uploaded the
  fixed ci.yml as `69d7c3d`, VERIFIED byte-identical. CI #5 (69d7c3d)
  SUCCESS — fix confirmed. CodeQL #3 and #4 also SUCCESS. No separate
  `rust.yml` needed: Rust tests already run in ci.yml (cargo test step);
  a separate file would duplicate it.

### 2026-11-16 — Project docs set (this change)

- `MEMORY.md`, `CLAUDE.md`, `release.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, `CODE_OF_CONDUCT.md`, `ACCESSIBILITY.md`,
  `.github/pull_request_template.md`, `CHANGELOG.md` added, adapted from
  the owner's Quran Studio / Astroplate doc templates. `AGENTS.md`
  NOT touched — the repo already has its own mascot-specific
  `AGENTS.md`.

### 2026-11-16 — v1.1.11 release (published)

- Tag `v1.1.11` created on `d7feb9b`; `release.yml` built the Windows
  NSIS installer + portable ZIP + updater artifacts; owner published
  the release ("Desktop Mascot for Muse v1.1.11") with the drafted
  What's new / Fixed / Notes text (English-only app, in-app Meta login,
  blank-session self-heal, Rust edition 2024 + pnpm, fresh login needed
  once after updating, SmartScreen note).
- Assets: `desktop-mascot-for-muse-windows-x64.zip`,
  `Desktop.Mascot.for.Muse_1.1.11_x64-setup.exe`,
  `Desktop.Mascot.for.Muse_1.1.11_x64-setup.exe.sig`, `latest.json`.
- NOTE: installer attached under the versioned name, not the AGENTS.md
  §4 fixed name (`Desktop-Mascot-for-Muse_x64-setup.exe`) — the
  fixed-name decision is still open; the direct fixed-name download
  link does not resolve for this release.

## 8. In-Progress Work

- Fixed-name installer vs tauri-action versioned name (AGENTS.md §4) —
  undecided: tauri-action uploads the versioned installer name, not the
  fixed `Desktop-Mascot-for-Muse_x64-setup.exe`; fixing it needs care
  because the updater's `latest.json` points at the artifact name.
- Owner to run full `npm test` on Windows and confirm the rebuilt app.

## 9. Bugs and Troubleshooting

- **`UNSUPPORTED_DOM` (input field not found) (FIXED, 2026-11-16).**
  Auth redirects bounced to the external browser; session stayed on
  `about:blank`. Fixed by allowlist entries (facebook.com, instagram.com,
  meta.com). If a fresh `session_recovery.log` tail shows the auth flow
  bouncing through yet another host, apply the same allowlist fix (both
  lists + regression tests) and push only after the owner's go-ahead.
- **Edition 2024 build breakage (FIXED, 2026-11-16).** `gen` keyword
  collision + `extern "system"` needing `unsafe`. Fixed by renaming to
  `generation` and `unsafe extern "system"`.
- **Reloading `about:blank` (FIXED, 2026-11-16).** `reload_session`
  only reloaded; blank case now navigates to `SESSION_URL`.
- **CI `glib-2.0` not found (FIXED, 2026-11-16).** Linux runner lacks
  Tauri system libraries. Fixed by installing them in `ci.yml`.
- **Version-sync `docs_sync` failures (PRE-EXISTING, 2026-11-16).**
  Owner's package.json-only bump left Cargo/tauri.conf/README/SPEC
  behind; proven pre-existing via `git stash` + re-run, not a
  regression from the fix.

## 10. Failed Attempts and Lessons Learned

- **GitHub App cannot push workflow files.** A push containing
  `.github/workflows/*.yml` fails with 403 on git/trees (App lacks
  workflows permission). Workflow files go via the owner's web-UI
  upload; verify byte-identical afterwards.
- **GitHub push-files is UTF-8 TEXT ONLY.** Binary files (PNG
  screenshots) cannot be pushed via the connector — binary assets go
  via the GitHub web UI upload (owner drags files into the folder); do
  NOT work around with PATs.
- **CI runs #1/#2 cancelled (superseded).** Rapid successive pushes
  cancel earlier runs via the concurrency group — expected, not a
  failure.
- **`glib-2.0` is a system library, not an npm package.** It cannot be
  added to `package.json`; it is installed on the runner via `apt`
  (see §7, CI fix).
- **Never claim a Rust fix is compile-verified in the sandbox.** No
  cargo/rustc and no Edge here — Rust tests and e2e are verified by CI
  and by the owner's Windows runs only.

## 11. Testing and Quality Status

| Check                                       | Status (2026-11-16) | Notes                                       |
| ------------------------------------------- | ------------------- | ------------------------------------------- |
| `pnpm run test:unit`                        | PASS                | 36/36, sandbox                              |
| `pnpm run test:rust`                        | NOT RUN (sandbox)   | No Rust toolchain; CI #5 green              |
| `pnpm run test:e2e`                         | NOT RUN (sandbox)   | Windows + Edge only                         |
| CI (GitHub Actions)                         | PASS                | #5 (69d7c3d) SUCCESS                        |
| CodeQL                                      | PASS                | #3, #4 SUCCESS                              |
| `pnpm run build` (NSIS installer)           | NOT RUN             | Owner builds on Windows                     |

## 12. Security and Operational Considerations

- Signing key: lives in GitHub repo Secrets, never in the repo. Key
  files (`MascotMuseAI.key`, `MascotMuseAI.key.pub`) are gitignored.
  No secret values are recorded in this file.
- Updater trust: `tauri.conf.json` embeds a minisign public key and the
  releases endpoint — rotating the key requires coordinated config +
  secret updates.
- Capabilities: `src-tauri/capabilities/default.json` grants only
  `core:default` + `opener:default` for the main and settings windows —
  keep grants minimal when touching them.
- No backend, no accounts, no telemetry. The Muse login stays in the
  app's own WebView.
- Avatar videos are user files, never committed, never downloaded by
  the build.

## 13. Known Limitations and Technical Debt

- Rust tests and e2e never run in sandbox — Windows verification
  depends on the owner + CI.
- Session bridge is English-UI-only (owner decision 2026-11-16).
- GitHub Issues disabled — no issue-driven workflow; templates exist
  but are hidden.
- Single-instance mutex name in main.rs still uses the old upstream
  identifier string (`Local\works.mowthow.muse.gadgets.single_instance`)
  — noted, unchanged.
- Updater endpoint / fixed-name installer interplay UNVERIFIED (see §8).
- No accessibility audit has been run (see `ACCESSIBILITY.md`).

## 14. Pending Tasks and Priorities

- **P0:** Owner runs full `npm test` on Windows; confirms rebuilt app
  (login, session, mascot send, blank-session self-heal).
- **P1 (DONE 2026-11-16):** 5 labels created in repo Settings.
- **P1:** Decide the fixed-name installer approach for release.yml.
- **P2:** Enable GitHub Issues (optional) so the templates show.
- **P2 (DONE 2026-11-16):** First `v*` tag release end-to-end — v1.1.11
  published (installer + ZIP + `.sig` + `latest.json`; see §7).

## 15. Important References

- `package.json` — scripts, deps, pnpm pin
- `src-tauri/tauri.conf.json` — installer/updater metadata
- `src-tauri/Cargo.toml` — Rust deps, edition 2024
- `src-tauri/src/lib.rs` — session window, allowlist, reload, commands
- `src-tauri/src/session_bridge.js` — Muse DOM bridge
- `docs/SPEC.md` §18 — version history (source for `CHANGELOG.md`)
- `.github/workflows/release.yml` — desktop release pipeline
- `release.md` — release process
- `AGENTS.md` — repo house rules (§4 pre-release checklist)

## 16. Memory Maintenance Log

- **2026-11-16:** Created `MEMORY.md`, `CLAUDE.md`, `release.md`,
  `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `ACCESSIBILITY.md`, `.github/pull_request_template.md`, and
  `CHANGELOG.md` from the owner's Quran Studio / Astroplate doc
  templates, adapted to this project from direct repo inspection
  (package.json, tauri.conf.json, Cargo.toml, SPEC.md §18, capabilities,
  README, git log/status, GitHub API for CI/CodeQL runs). `AGENTS.md`
  was NOT touched — the repo already has its own mascot-specific
  version.
