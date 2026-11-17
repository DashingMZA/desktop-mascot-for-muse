# Accessibility

This document describes what Desktop Mascot for Muse actually does for
accessibility, what it deliberately does not do, and how to verify it.
It is written against the code in this repo — every claim below names
the file that implements it.

## What is in place

### Keyboard operation

- **Global shortcuts.** `Ctrl + Shift + M` opens the Muse session screen
  from anywhere (see `README.md`, `docs/SPEC.md`). `Ctrl + ,` opens
  Settings.
- **Real buttons and labels.** The Settings window (`src/settings.html`)
  uses real `<button>` elements (17) and `<label>` elements (20) for its
  tabs, toggles, and fields, and the mascot window (`src/index.html`)
  uses real `<button>` elements (14) — all keyboard-operable by default.
  Form controls are real `<input>` elements (text, radio, number) with
  associated labels.
- **Focus styling.** Text and number inputs in Settings show a visible
  focus state (`src/settings.css`), and the quick-input container shows
  a focus state (`src/styles.css`, `.input-container:focus-within`).

### Display

- **Three display sizes.** The mascot can be shown at small / standard /
  large scale (Settings → mascot scale), and the session screen position
  and size are restored between launches.
- **Usage-limit status as text.** The mascot frame color reflects the
  remaining usage limit (green / orange / red), and the nameplate always
  shows the remaining % as text (e.g. `[ Lucky 85% ]`) — the status is
  not conveyed by color alone.

## Known limitations (honest list)

- **No ARIA attributes.** The app's windows use no `aria-*` attributes,
  landmarks, or `role` attributes, and no `tabindex` management.
  Screen-reader support is unmeasured.
- **No global focus-visible outline.** There is no repo-wide
  `:focus-visible` rule; only form inputs carry a focus style.
- **No reduced-motion setting.** There is no `prefers-reduced-motion`
  handling; avatar videos and animations play as configured.
- **Avatar videos have no text alternative.** The mascot is a video
  avatar; its state (idle / thinking / working / done) is conveyed
  visually and through the speech-bubble text, not through an
  accessible name.
- **The mascot window is frameless and transparent.** It has no title bar
  or standard window chrome; it is moved by dragging and controlled
  through its buttons and shortcuts.
- **No automated accessibility audit has been run.** No axe / Lighthouse /
  screen-reader pass exists. The claims above are code-verified, not
  tool-verified.

## How to verify

1. `pnpm dev`, then Tab through the Settings window with a keyboard:
   every control is reachable and operable, and text/number inputs show
   a focus state.
2. Press `Ctrl + Shift + M` to open the session screen and `Ctrl + ,` to
   open Settings without touching the mouse.
3. Change the mascot scale in Settings and confirm the mascot resizes and
   the setting persists.
4. Run a screen-reader pass (e.g. NVDA on Windows) against the built app
   before claiming screen-reader support.
