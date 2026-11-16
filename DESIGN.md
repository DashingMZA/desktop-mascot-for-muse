# Muse Windows Gadget Design Document (v0.2 / Design Phase)

- Repository: https://github.com/mowthow-works/desktop-mascot-for-muse
- Reference implementation: https://github.com/mowthow-works/google-ai-limit-monitor (Tauri 2.0 + Rust, built as a separate app)
- Status: Design complete. Implementation has been handed off to another AI, and **all Phase 0 technical verification items passed on 2026-11-02** (see the v0.3 changes below)
- Changes in v0.2: The goals (requirements R1–R6) were finalized, so the architecture was revised from "show the web as-is" to a "**custom UI + background WebView session**" approach
- Changes in v0.2.1: Added the size-switching requirement R7 as an alternative/complement to R6 (open in browser)
- Changes in v0.3: Reflected the Phase 0 verification results (2026-11-02, by the implementing AI). Updated the feasibility column of the requirements table to final values and recorded the connection target, selectors, and bridge approach obtained from verification in §15

---

## 1. Requirements (What We Want to Achieve)

| # | Requirement | Feasibility | Approach |
|---|---|---|---|
| R1 | Display Muse's avatar (with animation) | ✅ Feasible (verified) | Get the `<video>` (blob: MP4) from the DOM and loop-play it in the local UI (§5, §15) |
| R2 | Display the latest few messages from the main chat thread | ✅ Feasible (verified) | Read the message list from the DOM of the background WebView (§4, §15) |
| R3 | Type and send messages | ✅ Feasible (verified) | Inject into the input field of the background WebView and send (§4, §15) |
| R4 | Reside as a desktop gadget, always on top | Feasible | Follow the shell of the reference app |
| R5 | View the window limit (usage limit) | ✅ Feasible (verified) | Get real values from the DOM of Settings > General > Usage (§7, §15) |
| R6 | When you want to view it in a browser, open Muse in the browser. If it is already open, activate that tab | Partially feasible | Opening the URL in the default browser is feasible. **Activating an existing tab cannot be guaranteed** (§8) |
| R7 | Switch the gadget size between small and large in one action (alternative/complement to R6) | Feasible | Toggle two sizes with a button/hotkey. In large mode, also allow showing the full UI of the session WebView (§8, §10) |

Key premise: No public API for Muse has been confirmed. R1/R2/R3/R5 all assume the approach of "keeping a logged-in web session in a background WebView and reading/writing via the DOM". This approach can break when the web-side UI changes, and the design is written with that premise stated explicitly.

## 2. Architecture

```
┌─────────────────────────────────────┐
│ Gadget window (label: main)         │  Local UI (same look as the reference app)
│  - Avatar display area (R1)         │
│  - Latest message list (R2)         │
│  - Input field + send button (R3)   │
│  - Limit gauge (R5, only if retrievable) │
│  - [Open in browser] button (R6)    │
└──────────────┬──────────────────────┘
               │ Tauri IPC (local UI ⇄ Rust)
┌──────────────┴──────────────────────┐
│ Session WebView (label: session)    │  Hidden WebView showing muse.ai
│  - Keeps the login session (dedicated data folder) │
│  - Injected JS watches the DOM and notifies Rust of changes │
│  - On send, injected JS writes to the input field and performs the send │
└─────────────────────────────────────┘
```

- The session WebView is normally hidden. It is shown only when login is needed, so the user can log in there (§6)
- Give the local UI and the session WebView separate labels, and limit capabilities to `main` as before. **Do not let remote JS on the session WebView side call Tauri commands directly** (§9)

## 3. Technology Choices

| Item | Choice | Reason |
|---|---|---|
| Framework | **Tauri 2.0** | Same stack as the reference app. Multiple WebViews, tray, and hotkeys are all available |
| Backend | Rust | Window management, WebView creation, receiving injected JS, persistence |
| Frontend (gadget itself) | Vanilla HTML/CSS/JS | Same `src/` structure as the reference app |
| Session persistence | WebView2 dedicated data folder (`data_directory`) | Keeps the logged-in state after restart |
| Sync approach | Injected JS + MutationObserver | Detects changes to the message list and sends diffs (combined with polling to prevent missed updates) |

## 4. Chat Read/Write Design (R2 / R3)

- Target is **the main chat only** (no side-chat switching in v1)
- Reading: Watch the message-list DOM inside the session WebView and send the latest N items (default 5, configurable) to the local UI, normalized as "sender (user / assistant), body text, time"
- Writing: Local UI input → Rust → set the value on the input-field element in the session WebView, fire an input event, then emulate clicking the send button
- Failure detection: After sending, treat it as a success when your own message has been added to the list. If it has not been added, show an error in the local UI
- Consolidate DOM selectors in one place (`session-bridge.js`) and fix only that place when the web side changes. If a selector is not found, state explicitly that "this screen structure is not supported" instead of silently breaking

## 5. Avatar Display Design (R1)

Check how the web app renders the avatar in Phase 0, then choose an approach in this order:

1. **Asset URL approach (preferred)**: If the avatar appears in the DOM as a video file (mp4/webm) or an image, get its URL and loop-play it in the local UI with `<video>` / `<img>`. The real animation can be used as-is
2. **Still image + CSS animation**: Fallback when assets cannot be obtained. Accept that this is not the real animation
3. Do not use the approach of cropping and showing only part of a WebView, because of how Tauri/WebView2 compositing works

- If the avatar asset source is a session-dependent URL, verify a route to obtain it under the same data folder as the session WebView

## 6. Login Operations (Biggest Technical Risk)

- First time: Show the session WebView and have the user complete the official sign-in there
- With Google OAuth, the embedded browser may be rejected as an "unsafe browser" (to be determined in Phase 0)
  - Possible countermeasure: Set the User-Agent to a normal Edge/Chrome one. If that still does not work, the gadget is designed on the premise of "a logged-in session", so reconsider the approach at that point
- When a session expiry is detected (the login screen appears in the DOM), show a "Sign in again" button in the local UI; pressing it shows the session WebView

## 7. Window Limit Display (R5)

- Muse has no local API like Antigravity, so the only candidate is "read the usage display inside the web (Settings screen, etc.) via the session WebView"
- In Phase 0, verify whether a display location for the usage limit (equivalent to the 5-hour / weekly limit) exists and whether numbers can be read from the DOM
- If they cannot be read, do not show a gauge; keep only a shortcut to open the usage page (do not show estimated values)

## 8. Browser Integration (R6)

- "Open in browser" button: Open `https://muse.ai` in the default browser (opener permission)
- **About activating an existing tab**: Windows has no standard way to "pick an existing tab of a specific browser from another app and bring it to the front"
  - Realistic v1 specification: Only up to opening the URL in the browser (whether it becomes a new tab or reuses one depends on the browser)
  - Extension ideas (not adopted in v1): Using a browser extension together, or finding tabs with UI Automation. Both depend on the browser type and break easily
- **R7 as an alternative**: The underlying need, "I want to see it bigger", can be met by switching the gadget's own size without going to the browser. Even if R6 is degraded, the practical impact is small

## 9. Security Design

- capabilities are `windows: ["main"]` only. Do not include the `session` label, and do not add a `remote` URL allowance
- However, for R2/R3, JS injection into the session WebView is done from the Rust side via `eval` / initialization scripts (do not use the approach of opening IPC to remote JS)
- Do not keep credentials in the app. Cookies remain only in the WebView2 data folder
- Store locally only the window position/size, hotkey, and displayed count N. Do not save conversation text locally (hold it in memory only, for display)

## 10. Window and Operations Design (R4)

- Main body: Follow the reference app (frameless, transparent, always on top, drag to move, frosted-glass dark style). Size is a tall shape that fits the avatar + a few messages + the input field (e.g. starting at 360 × 560, to be adjusted)
- **Size switching (R7)**: Toggle "small (resident mode) ⇄ large (browsing mode)" in one action with a dedicated button and hotkey
  - Two options for the large-mode display: (a) keep the custom UI and widen the message display, (b) switch to the full UI of the session WebView (the official screen itself). Option (b) has the advantage that features not reproduced in the custom UI, such as attachments and side chats, can be used as-is. Decide the approach in Phase 1
  - When switching, adjust the position so it does not stick out past the screen edge. Persist the size and position of small and large separately
- Tray residency, global hotkey display toggle, position/size persistence, and auto-start are optional settings
- Coexistence with Google AI Limit Monitor (avoiding placement conflicts, etc.) is not part of the requirements (the owner explicitly said it is out of scope, 2026-11-02)

## 11. Repository Structure (Same Shape as the Reference App)

```
desktop-mascot-for-muse/
├─ README.md
├─ package.json
├─ src/                    # Local UI (index.html / main.js / styles.css)
└─ src-tauri/
   ├─ Cargo.toml
   ├─ tauri.conf.json
   ├─ capabilities/default.json
   ├─ icons/
   └─ src/
      ├─ main.rs / lib.rs          # Window, tray, hotkey
      └─ session-bridge.js (equivalent)  # Consolidation point for DOM selectors and injection logic
```

- identifier proposal: `works.mowthow.muse.gadgets`
- productName proposal: `Muse Gadget` (the Store sales name is to be considered separately, as in §12)

## 12. Implementation Phase Plan

| Phase | Contents | Completion criteria |
|---|---|---|
| 0 | Technical verification: ① Sign in to muse.ai in WebView2 + session persistence ② Whether avatar assets can be obtained ③ Whether message DOM can be read/written ④ Where the usage limit is displayed and whether it can be read | ✅ **Completed 2026-11-02. All items passed** (details in §15) |
| 1 | Shell: main window, tray, hotkey, persistence, open-in-browser button (R4/R6) | Resident behavior equivalent to the reference app |
| 2 | Session WebView + bridge: latest N messages display and sending (R2/R3) | Display matches the real chat, and sending reaches it |
| 3 | Avatar playback (R1), limit display (R5, if possible) | Matches the real thing |
| 4 | Finishing: icon, MSIX, Store assets | Pass WACK |

## 13. Notes for Store Distribution

- The approach of integrating with a third-party service by reading/writing its DOM needs to be checked against both that service's terms of use and Store policy. **The judgment may differ between personal use and selling** (when selling, removing the integration feature is also an option)
- Use of another company's trademark in the app name/logo must avoid implying it is official
- Developer registration is free for individuals (with identity verification). Charging for it requires a payment/tax profile (W-8BEN)

## 14. Open Items

1. The default value for N, the number of latest messages shown (5 assumed), and whether they are ordered oldest-first or newest-first
2. Whether the default hotkey (e.g. Ctrl+Shift+M) conflicts with an existing environment such as AutoHotkey
3. The display name (Muse Gadget, or a mowthow-works-style original name)
4. For R6, whether the browser opens the main screen or a deep link to the relevant thread (the URL specification needs checking)

## 15. Phase 0 Verification Results (2026-11-02, Verified by the Implementing AI)

All items passed. It was proven that the design premise (the DOM read/write approach) holds.

1. **Sign-in & session persistence: ✅**
   - The connection URL is the same as Edge PWA: `https://muse.ai/?__pwa=1`
   - Confirmed that sign-in works with a standard Edge/Chrome User-Agent plus a pinned dedicated data_directory (`webview2_session`), and that the session persists after restarting the process
2. **Avatar assets: ✅ (real video)**
   - A `<video>` element (128×128 / 56×56) exists in the DOM, playing a 564 KB video/mp4 in `blob:https://muse.ai/...` form
   - Inside the session WebView, `fetch(video.src)` → get the blob and pass it to the local UI side, allowing the real animation to loop-play
3. **Message read/write: ✅**
   - Reading: The latest N items can be obtained with senders distinguished from `[class*="group/msg"]` (the inner `span.sr-only.whitespace-pre` / `.hatch-chat-groupable-bubble`)
   - Writing: Setting a React native value setter + firing an input event on `<textarea placeholder="メッセージ">` enables `button[aria-label="送信"]`, and `.click()` sends it
4. **Usage limit: ✅ (real values)**
   - Location: Settings (`button.hatch-dock-reveal-item`) > General > Usage
   - Elements obtained: plan name `span.text-body.text-text-primary` / usage rate `span.text-subheadline` (e.g. "17% used" → can be turned into a remaining-amount gauge) / reset date `p.text-footnote`
5. **Bridge approach: ✅ (established in a form that satisfies the security conditions)**
   - capabilities are limited to `windows: ["main"]` only, with no Tauri IPC exposed on the session side (maintaining the condition in design §9)
   - Data retrieval uses the `WebviewWindowBuilder::on_document_title_changed` hook (via document.title, with chunk splitting for over 4096 characters)

## 16. Phase 1 Design Decisions (2026-11-02, Implementing AI's Proposal + Design Review)

### R7 large mode: Adopt a hybrid approach
- In addition to switching the gadget UI itself between "small (360×560) ⇄ large (e.g. 520×780)", also provide a button to toggle showing/hiding the background session WebView (the official full UI)
- This way, features not reproduced in the custom UI (file attachments, side chats, etc.) can be used by opening the official UI as-is. Confirmed as the combined use of the two options (a) and (b) in design document §10

### R5 automatic usage-limit retrieval: Adopt the approach (with guardrails)
- At startup + periodically (roughly every 10 minutes) + via a refresh button, open "Settings > General > Usage" inside the hidden session WebView, read the numbers, and return to the chat screen after reading
- Guardrails (added in the design review):
  1. **Do not auto-fetch while the session WebView is visible (showing the R7 full UI)** (because the screen would change on its own while the user is operating it)
  2. **Make it mutually exclusive with message sending/reading** (if the fetch's screen transition competes with sending, sending may fail or be misread)
  3. Do not leave the return to Escape; **explicitly return to the main chat screen after fetching** (if the session's display position drifts, the R2 read target drifts too)

## 17. Countermeasures for Selector Breakage (2026-11-02, Added in Design Review)

The biggest remaining risk is "Muse's web UI changes break the DOM selectors". Since there is no public API, this risk itself cannot be eliminated, so instead of "make it harder to break", the policy is to "**break safely, visibly, and in a way that is easy to fix**".

1. **Fallback (degraded operation)**: A feature whose selector is not found is not left silently misbehaving; disable only that feature and show "Integration is temporarily unavailable". Since the R7 full-UI toggle always works, at worst it still functions as a "launcher to open the official screen"
2. **Multiple selectors**: Hold several candidates per element. Prioritize high-stability attributes (`aria-label="送信"`, `placeholder`, and other accessibility attributes, which tend to survive screen revisions) and keep class names (`hatch-*` ones may change in revisions) as backups
3. **Startup health check**: At startup, check that each selector is alive and show the state of R1/R2/R3/R5 in the UI in a small form. Make breakage noticeable right away and eliminate silent failures
4. **Minimizing fix cost**: Selectors are already consolidated in the one session-bridge file (design §4). Keep the structure so that, in principle, a web-side change can be fixed by replacing that file
5. **Stating the premise explicitly**: This approach has the same structure as google-ai-limit-monitor depending on Antigravity's internal specification. For personal use, the "fix it when it breaks" cost is acceptable, but for Store sales it needs to be reconsidered as in §13
