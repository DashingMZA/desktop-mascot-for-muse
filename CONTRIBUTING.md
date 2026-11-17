# Contributing to Desktop Mascot for Muse

Thanks for helping improve Desktop Mascot for Muse — a resident Windows
desktop mascot and chat-integration app for Muse (a personal AI agent).
Please read this guide before opening a pull request.

## Ground rules

- **One app, one repo.** Do not touch other projects. No changes to Quran
  Studio, Astroplate, or any other repo — this repo only.
- **No deploys.** Do not deploy to production, and do not add workflows
  that deploy on push. Releases are created only by pushing a `v*` tag
  (see `release.md`); PRs are checked by `ci.yml` and never deploy.
- **Follow the Code of Conduct** (`CODE_OF_CONDUCT.md`).
- **English only.** This project is English-only — code, comments, docs,
  commit messages, and PRs in English. (See `AGENTS.md`.)

## Setup

Requirements:

- **Windows 10 / 11** (the app is Windows-only; the installer and e2e
  tests target Windows)
- **Node.js 24+** (`node --version`)
- **pnpm 12.19.0** (`pnpm --version`) — the repo pins `pnpm@12.19.0` in
  `package.json` (`packageManager`); use Corepack (`corepack enable`) or
  install pnpm 12 directly. Do not use npm or yarn for installs.
- **Rust toolchain** (stable) + **WebView2** (for `pnpm dev`,
  `pnpm run test:rust`, and `pnpm run build`)

```bash
git clone https://github.com/DashingMZA/desktop-mascot-for-muse.git
cd desktop-mascot-for-muse
pnpm install --frozen-lockfile
pnpm dev        # Tauri dev — launches the mascot app
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Tauri dev — launches the mascot app |
| `pnpm run build` | Production build (Tauri build, NSIS installer) |
| `pnpm run test:unit` | JS unit tests (vitest) |
| `pnpm run test:rust` | Rust tests (`cargo test`) |
| `pnpm run test:e2e` | End-to-end tests (Playwright, Edge) |
| `pnpm test` | All three test layers |

All checks must pass before a PR is ready: install, unit tests, Rust
tests, and build. E2E needs Windows + Edge.

## Branch and PR flow

1. Fork the repo and create a branch from `main`:
   `git checkout -b fix/short-description` (or `feature/...`, `docs/...`).
2. Make focused changes — one concern per PR.
3. Fill in the pull request template: summary, type of change, testing done
   (the commands above), and screenshots for any UI change.
4. Keep commits logical and reviewable; write clear commit messages in
   English.
5. CI (`.github/workflows/ci.yml`) runs on pull requests. A green CI run
   is required before merge.

## Code and docs conventions

- **Frontend** lives in `src/` (vanilla JS + HTML/CSS, no framework).
  **Backend** lives in `src-tauri/` (Rust + Tauri 2). Keep the split clean.
- **Avatar videos** (`.mp4`) are never committed — only
  `src-tauri/assets/avatars/setting.json` and
  `src-tauri/assets/avatars/plugin/quotes.json` are tracked (see
  `.gitignore` and `AGENTS.md`).
- **Docs:** if your change affects behavior, config, or the release
  process, update the matching doc: `README.md`, `docs/SPEC.md`,
  `docs/CUSTOMIZE.md`, `release.md`, or `CHANGELOG.md`.
- **Versioning:** every release needs the version in sync across
  `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`,
  the README badge, and a row in `docs/SPEC.md` §18 (see `AGENTS.md` §4).
- **Styling:** keep the design consistent with the existing mascot and
  session UI; avoid unnecessary animations and oversized UI.

## What not to do

- Don't commit `node_modules/`, `dist/`, `src-tauri/target/`, avatar
  `.mp4` files, or `.env` (all gitignored).
- Don't change the Rust edition, Tauri version, or workflow Node versions
  without noting it — the project requires Node 24+ and Rust edition 2024.
- Don't add dependencies without justification; prefer the smallest change
  that solves the problem.
- Don't report a security issue as a public issue — see `SECURITY.md`.

## Questions

GitHub Issues are disabled in this repo. For questions, open a pull
request with your change, or contact the maintainer through their GitHub
profile.
