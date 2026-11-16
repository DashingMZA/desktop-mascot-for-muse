# Desktop Mascot for Muse Feature Specification

This document defines the current feature specification of Desktop Mascot for Muse (DashingMZA/desktop-mascot-for-muse) and is the **implementation source of truth (single source of truth)**.

- The README is the entry point and summary, and the customization guide (`docs/CUSTOMIZE.md`) is strictly a user reference; this document is authoritative for detailed feature specifications. Do not duplicate the same rule across multiple documents.
- The initial design remains in `DESIGN.md`, but this document takes precedence for current specifications.
- The intended readers of this document are both human developers and the AI responsible for implementation.

---

## 1. Overview

Desktop Mascot for Muse is a resident Windows desktop mascot and chat-integration app for the personal AI agent Muse (`https://muse.ai`). It is implemented in Tauri 2.0.

It normally resides in a corner of the desktop as a circular avatar mascot, showing animations matched to Muse's state, whimsical idle actions, and new-message notifications. With one action, you can call up the official Muse chat screen (session screen) and talk with it.

This app assumes a general-purpose design that any Muse user can use in the same way. It does not depend on mechanisms specific to a particular user.

## 2. Terminology

| Term | Meaning |
| :--- | :--- |
| Mascot state | The resident form in which only the avatar and nameplate float on the desktop |
| Session screen | The window showing the official Muse chat UI (`https://muse.ai/?__pwa=1`) |
| Settings screen | The GUI window for editing behavior timers, plugin videos, lines, etc. |
| IDLE | The state in which there is no user interaction and Muse is also idle according to the mascot's monitoring. Continuing IDLE triggers idle actions |
| Idle action | A presentation that shows a plugin video and a speech-bubble line while idle |
| Plugin video | A `.mp4` added by the user for idle actions (`avatars/plugin/` folder) |
| Basic video | The 5 kinds of videos used for state linking (idle / waking / working / making_something / milestone_level_up) |
| Live remarks | An optional feature that shows, as an idle line, a one-liner generated on the spot by Muse itself |
| Wake | A creation-request message the app sends to Muse's chat to fetch live remarks |
| Live pool | The accumulation of lines fetched by wakes (`live_quotes.json`). A line is consumed when shown |
| Title Bridge | A custom bridge using `document.title` to pass sync data from the session screen to the Rust side |
| Nameplate | The plate below the mascot showing the avatar name and the remaining usage-limit % |
| Time-of-day segment | morning (05:00–10:59) / afternoon (11:00–16:59) / evening (17:00–21:59) / night (22:00–04:59) |
| Usage limit | Muse's 5-hour window usage limit (handled as remaining %) |

## 3. Overall Structure

### 3.1 Window structure

| Window | Contents | Notes |
| :--- | :--- | :--- |
| main (mascot) | `src/index.html`. Avatar, speech bubble, quick input bar | Only this window has Tauri IPC permissions |
| session (session screen) | Shows `https://muse.ai/?__pwa=1` in WebView2 | No IPC permissions |
| settings (Settings screen) | `src/settings.html`. GUI Settings | Opened from the tray, etc. |

### 3.2 Sync mechanism (Title Bridge)

- The script on the session-screen side (`src-tauri/src/session_bridge.js`) writes sync data such as Muse's status, avatar name, new messages, and usage limit to `document.title`, and the Rust side polls and reads it.
- This is based on a zero-capability design that exposes no Tauri IPC at all to the remote origin (`https://muse.ai`).
- **Communication protocol specification**:
  - **Immediate response (<= 2,800 characters)**:
    - `document.title = "__MUSE_RES__:<nonce>:<url_encoded_json>"`
    - When the encoded data is 2,800 characters or fewer, the title is updated in one shot and the Rust side detects and decodes it.
  - **Chunk-split handshake (> 2,800 characters)**:
    - When it exceeds 2,800 characters, the session side moves the data to temporary memory (`window.__MUSE_STORE__[nonce]`) and sets `document.title = "__MUSE_CHUNK_READY__:<nonce>:<total_chunks>"`.
    - After recognizing `total_chunks`, the Rust side calls the session side's `window.MuseBridge.serveChunk(nonce, idx)` for each index.
    - The session side updates `document.title = "__MUSE_CHUNK__:<nonce>:<idx>:<chunk_slice>"`, and the Rust side pulls and joins all chunks.
    - After retrieval completes, the Rust side runs `window.MuseBridge.cleanup(nonce)`, freeing memory and restoring the title to the normal title (`Muse AI - Session`).
  - **Supported actions**:
    - `check_health`: Liveness check for the session screen
    - `get_avatar`: Base64 extraction of the logged-in avatar video
    - `get_avatar_state`: Get the avatar's current status (idle, thinking, tool running, done/celebrating, etc.) and avatar name
    - `get_messages`: Get chat history (latest messages)
    - `inspect_latest`: Get the detailed structure and body of the latest message
    - `send_message`: Send a message to the chat for quick input or a wake
    - `fetch_limit`: Get Muse's 5-hour usage limit (remaining %, reset time, etc.)
    - `inspect_reload_safety`: Safety check before running an automatic reload (whether a reply is being generated, whether there is an unsent draft)

### 3.3 File placement

| Target | During development | Distributed version (normal) | Distributed version (portable) |
| :--- | :--- | :--- | :--- |
| Avatar videos, settings, lines | `src-tauri/assets/avatars/` | `%LOCALAPPDATA%\com.csofts.muse.gadgets\avatars\` (persistent area) | `avatars/` in the same folder as the `.exe` |
| Session cookie | — | App-specific local folder `webview2_session` | Same as left |
| Live pool | `avatars/plugin/live_quotes.json` | `%LOCALAPPDATA%\com.csofts.muse.gadgets\avatars\plugin\live_quotes.json` | `avatars/plugin/live_quotes.json` |

- To prevent user settings and video files from disappearing entirely when updating via the installer (NSIS) (during the old-version uninstallation), the top-priority read/write location in normal mode is the OS persistent user-data area (`%LOCALAPPDATA%\com.csofts.muse.gadgets\avatars\`).
- Only when a `portable` file or folder exists next to the executable is the local `avatars/` folder used with top priority, as portable mode.
- Only `setting.json` and `quotes.json` are initially bundled in the distribution package; avatar videos (`.mp4`) are not included (for copyright and general-purpose reasons). If no config files exist in the user-data area, the initial templates are automatically seeded on first launch.
- `setting.json` and `quotes.json` are automatically applied within 3 seconds of saving, even while the app is running (hot reload).

## 4. Startup and Lifecycle

- **Single instance**: Multiple launches are prevented with a Windows named mutex.
- **Auto-start**: Auto-residency at Windows startup can be toggled (by default, it follows the setting).
- **Quit**: "Quit" in the tray menu fully exits the process.
- **Restoring position and size**:
  - The mascot's display position is saved automatically and restored at the next launch.
  - The session screen's position and size are restored to the state at the last exit.
  - The mascot's display size switches in 3 levels — Large (125%) / Standard (100%) / Small (80%) — while keeping the center position.

## 5. Mascot Display

### 5.1 State-linked animation

- Monitor the chat screen's avatar status and the currently playing video in real time, and switch the basic video with a **500ms crossfade** according to Muse's state.

| Muse's state | Video shown |
| :--- | :--- |
| Normal idle | `idle.mp4` |
| Startup / returning | `waking.mp4` |
| Thinking / generating a reply | `working.mp4` |
| Tool / creation running | `making_something.mp4` |
| Done / celebrating | `milestone_level_up.mp4` |

- If no basic videos are placed, a fallback automatically extracts the `idle` video from the logged-in session screen and shows it.

### 5.2 Usage-limit visualization

- The color and glow of the mascot's outer frame follow the remaining usage limit.

| Remaining | State | Frame color |
| :--- | :--- | :--- |
| 80% or more | Safe | Emerald green `#10b981` |
| 50–79% | Caution | Amber orange `#f59e0b` |
| Under 50% | Danger | Rose red `#ef4444` |

- The nameplate always shows the remaining amount in the form `[ Avatar name 85% ]`.
- **Session auto-recovery (Issue #52)**: When a return from a long sleep is detected, or when usage-limit fetches fail repeatedly (only once per episode), the session WebView is auto-reloaded only if all conditions are met — session hidden, not generating, not processing a wake, and no unsent draft — then, after waiting for the input field to be ready and confirming the URL matches before and after reload, the usage limit is fetched again. The detection reason and success/failure are recorded in the local log (`session_recovery.log`).

### 5.3 Unread badge

- When a new message arrives while the session screen is behind or hidden, a red circle badge (🔴 1–9+) is shown on the avatar's right shoulder.
- Opening the session screen (by clicking the mascot / speech bubble / badge, `Ctrl + Shift + M`, etc.) automatically clears it as read.

### 5.4 Movement and focus linking

- The mascot can be freely moved by dragging, and its position is saved automatically. When placed at the right edge of the screen, the speech bubble automatically flips to expand to the left.
- **Click-through control for transparent areas (Issue #60)**: In mascot state, only the rectangles of the UI elements currently shown (avatar, speech bubble, input bar, etc.) accept mouse input; other transparent areas let clicks pass through to the window behind.
- **Full focus sync**: When the session screen is in front, the mascot automatically hides; when the session screen goes behind, the mascot appears in front. When the session screen returns to the front, the mascot automatically steps back.

## 6. Session Screen Integration

### 6.1 Open/close toggle

Any of the following switches between "mascot state ⇄ session screen".

- Double-clicking the mascot
- Left-clicking the system tray icon
- Global hotkey `Ctrl + Shift + M`
- Clicking a speech bubble / unread badge (open direction only)

Minimizing (`−`) or closing (`×`) the session screen, or `Win + M`, also returns to the mascot state.

### 6.2 Login and authentication

- Sign in on the official session screen (Google OAuth, email, etc.), and the session cookie is persisted only in the app-specific local folder (`webview2_session`).
- Passwords and other credentials are never stored in the app (see §15).

### 6.3 Sync data

The main data received from the session screen via the Title Bridge is the avatar's status, avatar name, new messages (body), and remaining usage limit. These are used for the mascot display (§5), new-message notifications (§7), and the quick-input reply display (§8).

## 7. New-Message Notifications and Speech Bubbles

- New messages are detected in the background even while the session screen is hidden, and notified beside the mascot with a **Lupin-style pattering typing speech bubble** (shown one character at a time, at a good tempo).
- A sound effect (notification sound) plays on arrival (§13). The unread count is reflected in the unread badge (§5.3).
- The speech bubble's display hold time follows `bubble_display_duration_sec`.

## 8. Quick One-Line Input

- Hovering over the avatar shows a "💬" button, or right-click the avatar itself or a speech bubble, to expand a mini input bar beside the avatar.
- Send with the `Enter` key (or the `➤` button) and ask a question right there without opening the session screen. Put the input bar away with the `Esc` key (or the `×` button).
- Keystroke sound effects play while typing, including while typing with a Japanese IME (§13).
- After sending, "Thinking…" appears in the speech bubble, followed by Muse's reply appended in real time as it streams.
- Long text, file attachments, and voice input are done in the session screen (outside the scope of quick input).
- **One-click shortcuts (Issue #68)**: When the input bar expands, 4 beginner-friendly preset prompts ("I forget things a lot, help me improve that", "Let's start the conversation over", "Tell me handy ways to use this", "Summarize what happened today") are listed as chips. Each chip shows a tooltip on hover explaining when to use it, and pressing a chip does not send immediately — it sets the text into the input field as a preview (noting that it will consume one turn of usage limit), so the user can check and edit it before sending to the currently active chat.

## 9. IDLE Actions

### 9.1 Trigger conditions

- When a state with no interaction continues for `idle_threshold_sec` (default 180 seconds), the app enters IDLE.
- While idle, an idle action fires every `action_interval_sec` (default 180 seconds), playing one plugin video and returning to `idle`. The playback hold time is `default_action_duration_sec` or the video-specific `duration_sec`.

### 9.2 Video lottery

The candidates are the `.mp4` files in the `avatars/plugin/` folder (auto-scanned). They are drawn under these conditions.

- Each video's `enabled` (disabled ones are excluded)
- `min_idle_sec` / `max_idle_sec` (the range of elapsed IDLE time)
- `time_ranges` (time ranges in which it can be shown)
- `weight` (lottery weight)
- When `avoid_repeat_video` is enabled, the video played just before is not picked consecutively
- Whether a speech-bubble line is shown follows each video's `quote_probability`

### 9.3 Touch reaction

- Single-clicking the mascot holds the joy pose (`milestone_level_up`) for `touch_reaction_duration_sec` (default 8 seconds) and shows one line from `touch_reactions` in `quotes.json`.
- A touch reaction is not an idle action, so it does not consume the live pool (§11).

## 10. Line Selection Specification

This chapter is the sole authority for line selection during idle actions.

### 10.1 Selection priority

1. **When the live pool has valid lines**:
   - As a rule, show a line from the live pool.
   - However, if the currently playing video has dedicated lines (`videos[x].quotes`), draw between the live pool and the video's dedicated lines at **50% / 50%**.
2. **When the live pool is empty** (feature OFF, used up, fetch failed, etc.): Draw from the fixed lines.
   - If the video has dedicated lines: **70%** video-dedicated lines / **30%** time-of-day lines (`time_specific_quotes`)
   - If the video has no dedicated lines: **70%** time-of-day lines / **30%** normal idle lines (`default_idle_quotes`)

### 10.2 Priority within the live pool

1. A line matching the current time-of-day segment that has not been shown within the last 10 times
2. A line matching the current time-of-day segment
3. A line, regardless of time of day, that has not been shown within the last 10 times
4. The first line in the pool

A shown live line is deleted from the pool (consumed).

## 11. Live Remarks

### 11.1 Overview

An optional feature that makes idle lines not just the fixed lines in `quotes.json`, but a one-liner generated on the spot by Muse itself. It is **disabled by default (opt-in)**.

One wake consumes one turn of Muse conversation usage limit (Limit). State this consumption in the Settings screen.

### 11.2 Wake protocol

- The protocol is embedded in the wake text itself (self-contained). It does not depend on prior arrangements or a dedicated file, so it works with any user's Muse.
- The wake text asks Muse to come up with several short one-liners (default 4 lines) in its usual tone and return them one per line in a code block with the fence name `mascot-quotes`. The conditions are: no more than 40 characters per line, and content matching the current time-of-day segment.
- Lines are extracted from the code block in the response and saved to the live pool. A response from which lines cannot be extracted is discarded.

### 11.3 Trigger conditions

Wake only when all of the following are met.

1. Live-remark generation is ON in Settings
2. For the dedicated-chat method, the chat URL is set
3. Muse is idle, and at least `idle_threshold_sec` has passed since the last interaction (so it does not interrupt an ongoing conversation)
4. The session screen is closed and the mascot is showing
5. At least the minimum interval (default 60 minutes) has passed since the last wake
6. Today's wake count is below the cap (default 6 times)
7. It is not quiet hours (default 22:00–07:00)
8. The live pool has 1 or fewer lines left

### 11.4 Sources

- **Main-chat method**: Send the wake to the everyday chat currently open. No extra preparation is needed, and the one-liners tend to be context-rich, but the wake and reply remain in the everyday thread.
- **Dedicated-chat method**: Register the URL of a dedicated chat created by the user in Settings and send it there. It keeps the everyday thread clean. If this method is selected with no URL registered, do not send and treat the feature as disabled (to prevent accidental sends).
  - Note: In the dedicated-chat method, wait for the URL navigation and for the input field to finish rendering before safely sending the wake, and when line extraction completes (or the wait times out), automatically navigate back to the chat URL that was open before the wake ran, so that everyday chat operation/display does not get stuck on the dedicated chat (Issue #46).

### 11.5 Pool management

- Lines are saved in `live_quotes.json` together with their fetch timestamp.
- Lines older than **24 hours** since fetching are automatically discarded (to prevent stale-content mishaps).
- The same sentence is not registered twice.

### 11.6 Fallback

On extraction failure, no response from Muse, offline, not logged in, or usage limit exhausted, quietly return to the normal fixed-line behavior. Do not notify the user of an error.

## 12. Settings

### 12.1 GUI Settings screen

Open it from "Settings..." in the tray menu. You can adjust behavior timers, toggle each idle video on/off, add/edit lines, open the placement folder, and configure live remarks (§11). Mascot display size, auto-start, and sound-effect toggling can also be done from the tray menu.

### 12.2 `setting.json`

Location: `avatars/setting.json`. Hot-reload target (§3.3).

| Key | Description |
| :--- | :--- |
| `idle_threshold_sec` | Seconds without interaction before entering IDLE |
| `action_interval_sec` | Interval between idle actions (seconds) |
| `default_action_duration_sec` | Standard playback hold time (seconds) for a plugin video |
| `touch_reaction_duration_sec` | Hold time (seconds) for a touch reaction |
| `bubble_display_duration_sec` | Hold time (seconds) for a speech bubble |
| `avoid_repeat_video` | Avoid playing the same video consecutively (`true` / `false`) |
| `sound_enabled` | Sound effects on/off |
| `sound_volume` | Sound-effect volume (`0`–`100`, default `30`) |

### 12.3 `quotes.json`

Location: `avatars/plugin/quotes.json`. Hot-reload target.

| Key | Description |
| :--- | :--- |
| `time_specific_quotes` | Array of lines per time-of-day segment (morning / afternoon / evening / night) |
| `default_idle_quotes` | Array of normal idle lines |
| `touch_reactions` | Array of lines for touch reactions |
| `videos` | Settings per video filename (table below) |

Items in `videos[x]`: `enabled`, `min_idle_sec`, `max_idle_sec`, `time_ranges`, `duration_sec`, `weight`, `quote_probability`, `quotes` (array of dedicated lines). Their meanings are as in §9.2.

### 12.4 Live-remark settings

| Item | Default |
| :--- | :--- |
| On / Off | Off |
| Source (main chat / dedicated chat + URL) | Main chat |
| Lines per fetch | 4 lines |
| Minimum wake interval | 60 minutes |
| Daily cap | 6 times |
| Quiet hours | 22:00–07:00 |

## 13. Sound Effects

| Type | When it plays |
| :--- | :--- |
| Notification sound (ding) | When a new message arrives |
| Keystroke sound (clatter) | When a speech bubble is typing, when typing in quick input |
| Touch-reaction sound | During a touch reaction |

On/off is controlled by `sound_enabled`, volume by `sound_volume` (§12.2).

## 14. Tray and Hotkey

### 14.1 Tray menu (right-click)

- Session screen ⇄ mascot (`Ctrl+Shift+M`)
- Open session screen (official UI)
- Reload session
- Settings...
- Open mascot developer tools
- Open session developer tools
- Mascot mode (avatar only)
- Mascot display size (Large / Standard / Small)
- Auto-start at Windows startup
- Play sound effects (SE)
- Open Muse in browser
- (Old) medium/small screen switching (legacy, §17)
- Quit

Left-click toggles between the session screen ⇄ mascot.

### 14.2 Hotkey

| Key | Action |
| :--- | :--- |
| `Ctrl + Shift + M` | Toggle between the session screen ⇄ mascot state |

## 15. Security

1. **Zero-capability design**: The scope of `src-tauri/capabilities/default.json` is limited to `windows: ["main"]` only. Grant no Tauri IPC permissions at all to the session screen (remote origin).
2. **Title Bridge**: Pass sync data only via `document.title`, without exposing IPC to remote-side JS. See §3.2 for the internal protocol details.
3. **Credential protection**: Do not store passwords or Google OAuth information in the app. Persist the session cookie only in the app-specific local folder.

## 16. Distribution

- **NSIS installer**: Per-user installation (no UAC elevation needed). Automatically sets up the desktop shortcut, Start menu, and uninstaller, and bundles and extracts the initial config files (`setting.json` / `quotes.json`). When attaching to a GitHub Release, use the fixed filename `Desktop-Mascot-for-Muse_x64-setup.exe`.
- **Portable version**: Works as a standalone `.exe`. Use the fixed name `desktop-mascot-for-muse-windows-x64.zip` for the ZIP archive attached to a GitHub Release.
- **MSIX**: Positioned as a future option with Microsoft Store submission and SmartScreen countermeasures in mind (not a current distribution form).

## 17. Known Limitations and Legacy

- **(Old) medium/small screen switching**: The "small mode ⇄ large mode" switching from the v0.7 series has been removed and remains only as a legacy feature in the tray menu.
- **Old UI kept in code**: The gadget's own thread-display UI from early development and DOM-injection sending from its own input field remain in the code but are not used currently.
- **Video fallback**: If no basic videos are placed, only `idle` is auto-extracted from the session screen. Other state videos do not switch if they are not placed.

## 18. Version and Feature Mapping

| Version | Main features |
| :--- | :--- |
| v0.8.0 | Revamped into the 2-form integration of "mascot state ⇄ session screen" |
| v0.9.0 | State sync and 500ms crossfade, IDLE plugin playback, single instance, custom icon |
| v1.0.0 | Unified the name to Muse Desktop Mascot, NSIS installer, GUI Settings screen, auto-start, unread badge, usage-limit frame color and % display |
| v1.1.0 | Quick one-line input, 3 display-size levels, session screen position/size restore, sound effects, time-of-day lines |
| v1.1.1 | Live remarks feature |
| v1.1.2 | Bug fix: auto-return to the previous chat after a wake completes in dedicated-chat mode (Issue #46) |
| v1.1.3 | 3-layer automated test infrastructure introduced (Issue #48), usage-limit (weekly Limit) auto-fetch stabilization and Settings dialog protection (Issue #49), long speech-bubble scroll auto-follow (Issue #50) |
| v1.1.4 | Manual session reload and guarded auto-recovery for usage-limit 409 errors on wake from sleep / long uptime (Issue #52), persistence of Windows auto-start settings (Issue #53), image drag-and-drop and external links opening in the default browser (Issue #54), debounced atomic writes of config files (Issue #55), visual distinction for remark speech bubbles (Issue #56), status-pill extraction improvements (Issue #57, #58) |
| v1.1.5 | Refresh to the original mascot app icon (Issue #59), click-through control for transparent areas in mascot mode (Issue #60) |
| v1.1.6 | Fix for hover display (⤢) remaining after session screen navigation/return (Issue #61), fix for hover display (⤢) not returning after dragging the mascot (Issue #62) |
| v1.1.7 | Two-level Settings menu support for periodic and manual usage-limit (Limit) updates in mascot state, and fix for stop-button misdetection (Issue #63) |
| v1.1.8 | App name and Git repository name changed to Desktop Mascot for Muse (Issue #64) |
| v1.1.9 | Support for shortcut-labeled items in the two-level Settings menu (Settings Ctrl+,) and generic popover elements (Issue #67) |
| v1.1.10 | Integration of beginner-friendly "one-click shortcuts" into quick one-line input (Issue #68) |

---

*This document is the authoritative Feature Specification (Single Source of Truth). If a discrepancy with the implementation arises, either update this document with the implementation as authoritative, or sync both after agreeing on it as a specification change.*
