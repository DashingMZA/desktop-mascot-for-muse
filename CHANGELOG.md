# Changelog

All notable changes to this project are documented here. The format is
based on Keep a Changelog. Version entries are derived from `docs/SPEC.md`
§18 (Version and Feature Mapping), the project's single source of truth
for version history. Release dates for older versions are not recorded
in this repo, so they are omitted rather than guessed.

## Unreleased

### Added

- English-only project: full Japanese → English translation of the UI,
  docs, and code comments (avatar name "Lucky", "Free Plan"); the session
  bridge now only recognises Muse's English UI.
- Meta Accounts Center login redirects kept in-app (`facebook.com`,
  `instagram.com`, `meta.com` added to the session WebView allowlist,
  in both `lib.rs` and `session_bridge.js`).
- GitHub automation: CI, CodeQL, Labeler, Dependabot, and a Windows-only
  release workflow (NSIS installer + portable ZIP, draft release on
  `v*` tags).
- GitHub issue templates (bug report / feature request) — visible once
  Issues are enabled in repo Settings.
- Reload self-heal: reloading a blank session navigates back to the Muse
  session URL instead of reloading `about:blank`.
- Project docs set: `MEMORY.md`, `CLAUDE.md`, `release.md`,
  `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `ACCESSIBILITY.md`, `.github/pull_request_template.md`, and this
  changelog.

### Changed

- Rust edition 2024 compatibility (`gen` → `generation`,
  `unsafe extern "system"`).
- pnpm migration (`packageManager: pnpm@12.19.0`, Node ≥ 24).

## 1.1.10

- Integration of beginner-friendly "one-click shortcuts" into quick
  one-line input.

## 1.1.9

- Support for shortcut-labeled items in the two-level Settings menu
  (Settings Ctrl+,) and generic popover elements.

## 1.1.8

- App name and Git repository name changed to Desktop Mascot for Muse.

## 1.1.7

- Two-level Settings menu support for periodic and manual usage-limit
  (Limit) updates in mascot state, and fix for stop-button misdetection.

## 1.1.6

- Fix for hover display (⤢) remaining after session screen
  navigation/return.
- Fix for hover display (⤢) not returning after dragging the mascot.

## 1.1.5

- Refresh to the original mascot app icon.
- Click-through control for transparent areas in mascot mode.

## 1.1.4

- Manual session reload and guarded auto-recovery for usage-limit 409
  errors on wake from sleep / long uptime.
- Persistence of Windows auto-start settings.
- Image drag-and-drop and external links opening in the default browser.
- Debounced atomic writes of config files.
- Visual distinction for remark speech bubbles.
- Status-pill extraction improvements.

## 1.1.3

- 3-layer automated test infrastructure introduced.
- Usage-limit (weekly Limit) auto-fetch stabilization and Settings
  dialog protection.
- Long speech-bubble scroll auto-follow.

## 1.1.2

- Bug fix: auto-return to the previous chat after a wake completes in
  dedicated-chat mode.

## 1.1.1

- Live remarks feature.

## 1.1.0

- Quick one-line input, 3 display-size levels, session screen
  position/size restore, sound effects, time-of-day lines.

## 1.0.0

- Unified the name to Muse Desktop Mascot, NSIS installer, GUI Settings
  screen, auto-start, unread badge, usage-limit frame color and %
  display.

## 0.9.0

- State sync and 500ms crossfade, IDLE plugin playback, single instance,
  custom icon.

## 0.8.0

- Revamped into the 2-form integration of "mascot state ⇄ session
  screen".
