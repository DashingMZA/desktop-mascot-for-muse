# Release Guide — Desktop Mascot for Muse

This document covers the release process: the Windows desktop installer
(NSIS) and portable ZIP, built by GitHub Actions. This app is
Windows-only — there is no web deployment and no other platform.

## 1. Versioning

Keep these in sync before tagging a release (see `AGENTS.md` §4):

| File                        | Field                                      |
| --------------------------- | ------------------------------------------ |
| `package.json`              | `"version"`                                |
| `src-tauri/tauri.conf.json` | `"version"`                                |
| `src-tauri/Cargo.toml`      | `version` under `[package]`                |
| `README.md`                 | version badge (`vX.Y.Z`)                   |
| `docs/SPEC.md`              | a row in §18 Version and Feature Mapping   |

## 2. Desktop releases (GitHub Actions)

### How it works

`.github/workflows/release.yml` runs when you push a git tag starting with
`v` (e.g. `v1.1.11`), or manually via **Actions → Release → Run workflow**.
It builds on a single Windows runner:

- Windows (`x86_64-pc-windows-msvc`) → NSIS installer (`.exe`) + portable ZIP

The result is a **draft** GitHub Release containing the installer, the
portable ZIP, and the auto-updater artifacts (`latest.json` + signature
files).

Release asset names are **fixed** (no version in the name), so
`releases/latest/download/...` links keep working:

- Installer: `Desktop-Mascot-for-Muse_x64-setup.exe`
- Portable ZIP: `desktop-mascot-for-muse-windows-x64.zip`

The portable ZIP contains the built `.exe` plus
`avatars/setting.json`, `avatars/plugin/quotes.json`, and `README.md`
(no avatar `.mp4` files).

The in-app updater (`src-tauri/tauri.conf.json` → `plugins.updater`)
polls
`https://github.com/DashingMZA/desktop-mascot-for-muse/releases/latest/download/latest.json`,
so publishing the draft release is what ships the update to existing
desktop installs.

### One-time setup: signing keys

The updater artifacts must be signed. Generate a keypair once on your own
machine (never commit these files):

```bash
pnpm tauri signer generate -w ~/.tauri/MascotMuseAI.key
```

This prints the **public key** — it must match the `pubkey` already stored
in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). If you generate
a fresh keypair, update that field and commit it. The key files
(`MascotMuseAI.key`, `MascotMuseAI.key.pub`) are gitignored.

For local signed builds, export these as **real OS environment variables**
in the shell that runs the build (the Tauri CLI does not read `.env`
files). PowerShell example:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY="C:/path/to/your/MascotMuseAI.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""  # only if you set one
pnpm run build
```

(`TAURI_SIGNING_PRIVATE_KEY` accepts the key file path or the raw key
content.)

### One-time setup: GitHub Secrets

Repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret                               | Value                                                  |
| ------------------------------------ | ------------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`          | Contents (or path contents) of the private `.key` file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password set at generation time (empty if none)    |

`GITHUB_TOKEN` is provided automatically; the workflow already requests
`permissions: contents: write` so it can create the release.

### Triggering a release

```bash
# 1. Make sure the working tree is clean and versions are bumped (see §1)
# 2. Commit and push to main
git push origin main

# 3. Tag and push the tag — this starts the workflow
git tag v1.1.11
git push origin v1.1.11
```

Then:

1. Watch progress under **Actions → Release**.
2. When the job finishes, open **Releases** — you'll find a **draft**
   release named `Desktop Mascot for Muse v1.1.11` with the installer and
   portable ZIP attached.
3. Review the artifacts, edit the release notes if needed, and click
   **Publish release**. Publishing makes `latest.json` live, which is what
   the auto-updater reads.

> **Note:** `pnpm install --frozen-lockfile` runs in CI, so `pnpm-lock.yaml`
> must be committed and in sync with `package.json`, otherwise the workflow
> fails before building.

## 3. Local build before tagging

Build locally and smoke-test before tagging (see `AGENTS.md` §4):

1. `pnpm run build` — produces the NSIS installer.
2. Verify the installer runs and the app launches, logs in, and shows
   the mascot.
3. Confirm the session loads Muse, stays logged in, no browser tabs open
   at launch, and a mascot quick-input send works.

## 4. Checklist before tagging

- [ ] Versions bumped in all five places (§1)
- [ ] `pnpm install` clean, `pnpm-lock.yaml` committed
- [ ] `pnpm run test:unit`, `pnpm run test:rust`, `pnpm run test:e2e` all pass
- [ ] Desktop smoke test via `pnpm dev` (if a Rust toolchain is available)
- [ ] Release notes drafted (what's new / fixed)
