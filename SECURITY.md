# Security Policy — Desktop Mascot for Muse

## Reporting a vulnerability

If you find a security issue, **do not open a public issue**. Report it
privately via [GitHub Security Advisories](../../security/advisories/new)
for this repository. Include:

- What you found and where (file/URL/commit)
- Steps to reproduce
- What an attacker could gain

We aim to acknowledge within 72 hours and will keep you updated until the
issue is resolved.

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| < 1.1   | :x:                |

Only the latest release line receives security fixes.

## Security model

Desktop Mascot for Muse is a **Windows desktop application** — there is
no backend, no database, no user accounts, and no telemetry. What runs on
your machine is exactly what you see in this repo, plus:

- The Muse AI session, loaded in an embedded WebView from
  `https://muse.ai` (your Muse login stays in the app's own WebView;
  login redirects through Meta Accounts Center stay in-app)
- Avatar videos (`.mp4`) and settings stored locally on your machine

No personal data is collected, stored, or transmitted by the app itself.
Your Muse conversation stays between you and Muse.

## Secrets and keys

- **Tauri updater signing key.** Desktop updates are signed with minisign.
  The public key lives in `src-tauri/tauri.conf.json`
  (`plugins.updater.pubkey`). The private key must **never** enter the
  repo: for local builds it is a real OS environment variable
  (`TAURI_SIGNING_PRIVATE_KEY`, plus `_PASSWORD` if set — the Tauri CLI
  does not read `.env` files); in CI it comes from GitHub repository
  Secrets. Losing the private key means shipping a new public key with
  the next release. The key files (`MascotMuseAI.key`,
  `MascotMuseAI.key.pub`) are gitignored.
- **No other secrets.** The app has no API keys, no backend credentials,
  and no `.env` values that matter. Never commit `.env` / `.env.local` —
  both are gitignored.

## Desktop updater integrity

The in-app updater downloads `latest.json` from this repo's GitHub
Releases and verifies every artifact against the release signing key
**before** installing. A tampered or unsigned update is rejected. Keep
the `pubkey` in `tauri.conf.json` in sync with the private key used by
CI.

## Tauri capabilities (least privilege)

`src-tauri/capabilities/default.json` grants only what the app needs
(`core:default`, `opener:default`) for the main and settings windows.
When adding features, add the narrowest permission that works — never
broad `fs:allow-*` wildcards or `shell:allow-execute` without an
explicit binary allow-list.

## Supply chain

- **pnpm 12.19.0** with a committed `pnpm-lock.yaml`; CI installs with
  `--frozen-lockfile`. Do not introduce npm/yarn artifacts.
- **CodeQL** scans `javascript-typescript`, `rust`, and `actions` on
  every push to `main` (see `.github/workflows/codeql.yml`).
- Do not auto-merge dependency PRs that cross a major version boundary —
  review breaking changes first.
- Avatar videos are user-provided local files, never committed and never
  downloaded by the build.
