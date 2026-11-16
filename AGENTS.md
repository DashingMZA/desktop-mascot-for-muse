# AGENTS.md - Desktop Mascot for Muse Development and Operations Rules

This file defines the project-specific rules that AI agents must always follow when doing development, build, and release work in this repository (`desktop-mascot-for-muse`).

---

## 1. Rules to Prevent Leftover Junk Files (Unneeded Artifacts and Temporary Files)

When doing builds, packaging, documentation updates, and GitHub Release work, thoroughly follow the rules below so that **no old files or temporary junk files are ever left in the workspace**:

1. **Organizing distribution ZIP archives (root directory)**
   - When creating or placing a distribution ZIP (`desktop-mascot-for-muse-windows-x64.zip`), always delete or overwrite old versioned ZIP files (`*-v*.zip`) and any existing ZIP with the same name immediately beforehand.
2. **Keeping the `dist/` folder up to date or cleaning it up**
   - If a `dist/` folder exists, always overwrite and update `dist/desktop-mascot-for-muse.exe`, `dist/README.md`, `dist/avatars/setting.json`, and `dist/avatars/plugin/quotes.json` with the latest build artifacts when a release build completes (do not leave an old version of the `.exe` behind).
3. **Deleting unneeded files when replacing docs and images (`docs/`, etc.)**
   - When adding or replacing screenshots or assets in `README.md` or elsewhere under a new filename, promptly `git rm` / delete old image files that are no longer referenced (for example, screenshots of the old UI).
4. **Deleting temporary files (JSON payloads, etc.) immediately**
   - Create UTF-8 JSON files for sending to the GitHub REST API (`issue_payload.json`, `release_payload.json`, etc.) and temporary staging folders for packaging in a temporary directory (a scratch area or `$env:TEMP`), not in the repository root, and delete them promptly after use.

---

## 2. Rules for Handling Avatar Videos (`.mp4`)

- For copyright reasons and to keep the app usable for every user, keep `src-tauri/assets/avatars/*.mp4` and `src-tauri/assets/avatars/plugin/*.mp4` **outside Git (`.gitignore`)** and **do not bundle them in distribution ZIP archives (including `dist/`)**.
- Bundle only the configuration files `src-tauri/assets/avatars/setting.json` and `src-tauri/assets/avatars/plugin/quotes.json` in the Git repository and distribution ZIPs.
- Do not use `include_bytes!` on `.mp4` files in Rust code (so that `cargo build` still succeeds in an environment where no `.mp4` files exist right after `git clone`).

---

## 3. Git / GitHub Issue / Release Operations Rules

- Before starting work, output a message to the user explaining what you are about to do, then begin.
- When changing code or documentation in the Git repository, first create a GitHub Issue and get the user's confirmation before proceeding.
- Make Git commits only after the user has verified the behavior and approved the review, and include `(Closes #<Issue number>)` in an English commit message.
- When making a change related to a feature, screen, or setting described in `README.md`, always update `README.md` (and `dist/README.md`) in sync.
- When writing a file path in public documentation or source code, use a path relative to the repository root.

---

## 4. Build and Verification Rules (Debug vs Release)

- **During development and when verifying each Issue (on `dev/*` branches, etc.)**:
  - To shorten build time, use a **Debug build (`cargo build`)**, place the generated `src-tauri/target/debug/desktop-mascot-for-muse.exe` at `dist/desktop-mascot-for-muse.exe`, and verify behavior there (skip creating a distribution ZIP or installer).
- **At release time (just before merging into the `main` branch)**:
  - Only at the point just before the `main` merge, when all features for the version are complete and the user has instructed "Release it!", do a **Release build and create the installer (`npm run build:installer` / `npx tauri build`)**, overwrite `dist/` with the optimized `.exe`, and create the distribution ZIP archive and NSIS setup installer and attach them to the Release. Do not create an installer during normal development.
  - **Fixed-name rule for Release attachments (v1.1.9 and later)**:
    - So that fixed links on the introduction page (`releases/latest/download/...`) keep working, attach only assets with **fixed names (no version number)** to a GitHub Release, and do not attach versioned assets.
      - Installer: `Desktop-Mascot-for-Muse_x64-setup.exe` (upload the build artifact `Desktop Mascot for Muse_<version>_x64-setup.exe` under that fixed name)
      - ZIP archive: `desktop-mascot-for-muse-windows-x64.zip`
  - **Pre-release documentation sync checklist** (always check this before building and tagging):
    1. List all changes (Issues) for the target version with `git log <previous tag>..HEAD --oneline`.
    2. Update the version badge (`version-vX.Y.Z`) and contents of `README.md`, and sync them to `dist/README.md`.
    3. Add a row for the version to the relevant sections of `docs/SPEC.md` (new features and behavior changes) and to "§18 Version and Feature Mapping".
    4. If settings, tray menu items, or UI operations changed, update `docs/CUSTOMIZE.md`.


---

## 5. Regression Prevention and 3-Layer Automated Test Operations Rules

To prevent regressions (broken existing features, UI layout breakage, DOM extraction mistakes, etc.) that come with feature additions and bug fixes, the following **3-layer automated test suite** is in place.

- **Layer 1: Rust backend unit tests (`npm run test:rust`)**
  - Target: `src-tauri/src/lib.rs` (settings compatibility, AppData seeding and plugin video collection, URL normalization, abnormal-coordinate guards, etc.)
- **Layer 2: Frontend and bridge unit tests (`npm run test:unit`)**
  - Target: `tests/unit/session_bridge.test.js`, `tests/unit/main_logic.test.js`, `tests/unit/docs_sync.test.js` (Vitest + jsdom verification of Muse DOM parsing, choice extraction, usage-limit calculation, IME double-send prevention, live-remark extraction, documentation/version consistency, etc.)
- **Layer 3: Playwright real-browser UI / layout regression tests (`npm run test:e2e`)**
  - Target: `tests/e2e/mascot.spec.js` (renders `src/index.html` and `src/settings.html` in the Microsoft Edge headless engine and E2E-verifies 0px avatar position drift when the status pill is shown, scale switching, choice replies, and settings saving)

### Mandatory operations rules
1. **Running all tests before asking for verification is mandatory**
   - When you have changed code (`.rs`, `.js`, `.html`, `.css`), **always run `npm test` (all 3 layers at once) and confirm that all tests pass** before asking the user to verify behavior.
2. **Adding a regression-prevention test when fixing a bug**
   - When fixing a new defect or regression, as a rule add a test case that reproduces and verifies that defect to `tests/unit/`, `tests/e2e/`, or `src-tauri/src/lib.rs`.
