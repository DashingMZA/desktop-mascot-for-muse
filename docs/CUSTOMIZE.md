# Customization Guide

A reference covering detailed customization methods for Desktop Mascot for Muse.
For basic usage, see the [README](../README.md); for internal details and the authoritative specification (Single Source of Truth), see the **[Feature Specification](SPEC.md)**.

> [!TIP]
> **Easy customization in the GUI Settings screen**
> From **"Settings..."** in the system tray right-click menu, you can adjust behavior timers (idle time, speech-bubble duration, etc.), toggle each idle video on/off, and add or edit lines (Quotes) in the GUI. The "Open folder" button takes you to the avatar placement folder in one click.
> `setting.json` and `quotes.json` are **automatically applied (hot-reloaded) within 3 seconds of saving the file, even while the app is running**.

---

## 1. Preparing and Placing Avatar Videos

You can open the placement folder in one click via "Open folder" in the Settings screen ("Folder & Data Management" tab). To prevent videos and settings from being lost when the app updates, the OS persistent data area (`%LOCALAPPDATA%\com.csofts.muse.gadgets\avatars\`) is normally used (the local `avatars/` folder is used only if a `portable` file is placed next to the executable).

### Step 1: Basic status videos (5 types)

Place the basic videos used for syncing with Muse's state and for click reactions directly under `avatars/` (even if you place none, a fallback automatically extracts the `idle` video from the logged-in Muse session screen and shows it).

1. Ask Muse in the chat box as follows and have it output download links for the videos:
   > "Please list download links for your avatar videos (idle, waking, working, making_something, milestone_level_up)"
2. Save the downloaded `.mp4` files under these filenames:

| Filename | Purpose |
| :--- | :--- |
| `idle.mp4` | Basic loop video for normal idle time (IDLE) |
| `waking.mp4` | Video for startup / returning |
| `working.mp4` | Video for when Muse is thinking / generating a reply |
| `making_something.mp4` | Video for when Muse is generating / working on images, files, etc. |
| `milestone_level_up.mp4` | Joy-reaction video for when the mascot is single-clicked |

States are matched to videos by monitoring the chat screen's avatar status and the currently playing video in real time and switching with a 500ms crossfade.

### Step 2: Random videos while idle (IDLE) (`plugin` folder)

You can add action videos that play whimsically while idle.

1. Ask Muse in the chat box as follows and have it output links for variation videos:
   > "Please list download links for variations of your avatar videos (eating, makeup, sleeping, phone use, and so on)"
2. Save the downloaded `.mp4` files in the `avatars/plugin/` folder.
   - `quotes.json` already has lines configured for these filenames:
     - `eating.mp4` (eating)
     - `makeup.mp4` (makeup)
     - `sleeping.mp4` (napping)
     - `smartphone.mp4` (phone use)
     - `waking.mp4` (stretching / refreshing)
     - `working.mp4` (keyboard typing)
   - `.mp4` files with any other names are also auto-scanned and become candidates for random playback.

---

## 2. `setting.json` Reference

Location: `avatars/setting.json`

| Key | Description |
| :--- | :--- |
| `idle_threshold_sec` | Seconds without interaction before entering IDLE (idle state) |
| `action_interval_sec` | Interval (seconds) from when one plugin video ends and playback returns to `idle` until the next plugin video plays |
| `default_action_duration_sec` | Standard playback hold time (seconds) for a plugin video |
| `touch_reaction_duration_sec` | Hold time (seconds) for the joy pose on a single click |
| `bubble_display_duration_sec` | Hold time (seconds) for a speech bubble |
| `avoid_repeat_video` | Whether to avoid picking the same video consecutively (`true` / `false`) |
| `sound_enabled` | Sound effects (new-message notification, typing keystroke, touch reaction) on/off (`true` / `false`) |
| `sound_volume` | Sound-effect volume percent (`0`–`100`, default: `30`) |

---

## 3. `quotes.json` Reference

Location: `avatars/plugin/quotes.json`

### `time_specific_quotes`

Greetings and remarks matched to the current time of day. You can also add and edit them from the "Idle Actions & Lines" tab of the GUI Settings screen.

| Key | Time of day |
| :--- | :--- |
| `morning` | Morning (05:00 - 10:59) |
| `afternoon` | Midday (11:00 - 16:59) |
| `evening` | Evening (17:00 - 21:59) |
| `night` | Night / late night (22:00 - 04:59) |

### `videos`

You can set display conditions and dedicated lines per video filename.

| Key | Description |
| :--- | :--- |
| `enabled` | On/off flag (`true` / `false`. Handy when you want to check just one video while debugging) |
| `min_idle_sec` | Lower bound on elapsed time (seconds) since entering IDLE (`0` means it is a candidate right after entering IDLE) |
| `max_idle_sec` | Upper bound on elapsed time (seconds) since entering IDLE (`null` means unlimited) |
| `time_ranges` | Array of time ranges to show in (e.g. `["00:00-23:59"]`, lunchtime `["12:00-13:30"]`, overnight `["22:00-07:00"]`, etc.) |
| `duration_sec` | Playback hold time (seconds) specific to that video |
| `weight` | Weight in the random lottery (how likely it is to appear. Default `1`) |
| `quote_probability` | Probability of showing a line speech bubble when played (`0.0`–`1.0`) |
| `quotes` | Array of dedicated lines shown randomly when played |

### How lines are picked (during an idle action)

1. **When the live pool has lines**: As a rule, lines are shown from the live pool (a shown line is consumed). However, if the currently playing video has dedicated lines (`videos[x].quotes`), the live pool and the video's dedicated lines are drawn at **50% / 50%**.
2. **When the live pool is empty** (feature OFF, used up, fetch failed, etc.): Lines are drawn from the fixed lines.
   - If the video has dedicated lines: **70%** video-dedicated lines / **30%** time-of-day lines
   - If the video has no dedicated lines: **70%** time-of-day lines / **30%** normal idle lines (`default_idle_quotes`)

Note: the reaction to single-clicking the mascot is not an idle action, so it does not consume the live pool; it shows a line from `touch_reactions` in `quotes.json` (such as "Yes! Did you call me?").

---

## 4. Live Remarks in Detail

This feature has Muse itself generate the lines shown while idle. Here are the details of how it works and how to configure it.

### How it works

1. When all trigger conditions are met, the app sends a "remark creation request" (a wake) to the source chat. The request includes the reply format (a code block, one line at a time), so any Muse can respond on the spot.
2. Lines are extracted from the code block in the reply and saved to the local live pool (`live_quotes.json`). Several lines are received together in one fetch.
3. In idle actions, the live pool is shown first, and a shown line is consumed (deleted).

### Trigger conditions (only when all are met)

- "Generate live remarks" is ON in Settings
- Muse is idle, and at least `idle_threshold_sec` (default 180 seconds) has passed since the last interaction (so it does not interrupt an ongoing conversation)
- The session screen is closed and the mascot is showing
- At least the minimum interval (default 60 minutes) has passed since the last wake
- Today's wake count is below the cap (default 6 times)
- It is not quiet hours (default 22:00–07:00)
- The live pool has 1 or fewer lines left

### Settings

| Item | Description |
| :--- | :--- |
| On / Off | Off by default (opt-in) |
| Source | Main chat / dedicated chat (URL registration required) |
| Lines per fetch | Default 4 lines |
| Minimum wake interval | Default 60 minutes |
| Daily cap | Default 6 times |
| Quiet hours | Start / end time |

### Pool management

- Lines carry a fetch timestamp, and lines older than **24 hours** are automatically discarded (to prevent mishaps such as "Good morning" appearing at night)
- Lines matching the current time-of-day segment are prioritized, and lines shown within the last 10 times are avoided
- On extraction failure, offline, not logged in, or usage limit exhausted, it quietly falls back to the fixed lines with no error shown

> [!IMPORTANT]
> One wake consumes one turn of Muse conversation usage limit. Adjust the fetch interval and daily cap with the usage limit in mind.

---

## 5. System Tray (Right-Click Menu) Items

- **Session screen ⇄ mascot (`Ctrl+Shift+M`)**: Toggle between the chat screen and the mascot
- **Open session screen (official UI)**: Show the Muse AI chat window
- **Reload session**: Reload the session screen and re-sync the usage limit once the input field is ready (for recovery after a long sleep)
- **Settings...**: Open the GUI Settings screen for behavior timers, idle-video plugins, editing lines (Quotes), and folder management
- **Open mascot developer tools**: Launch DevTools dedicated to the mascot screen
- **Open session developer tools**: Launch DevTools dedicated to the official chat screen
- **Mascot mode (avatar only)**: Show only the mascot
- **Mascot display size**: Switch between 3 levels — Large (125%) / Standard (100%) / Small (80%) (also changeable from the GUI Settings screen)
- **Auto-start at Windows startup**: Toggle whether the mascot auto-resides when the PC starts
- **Play sound effects (SE)**: Toggle new-message notification, typing keystroke, and touch-reaction sounds on/off
- **Open Muse in browser**: Open `https://muse.ai` in the default browser
- **Quit**: Fully exit the process

### Examples of using the developer tools (DevTools)

Open DevTools from "Open mascot developer tools" in the tray menu and run the following JavaScript in the `Console` tab to freely change the frame color or unread badge for screenshots or behavior checks.

- **Green frame (safe, 85%)**: `document.getElementById('avatar-container').className = 'avatar-wrapper limit-safe'; const b = document.getElementById('avatar-limit-badge'); b.className = 'avatar-limit-badge limit-safe'; b.textContent = '85%';`
- **Red frame (danger, 15% + unread badge)**: `document.getElementById('avatar-container').className = 'avatar-wrapper limit-danger'; const b = document.getElementById('avatar-limit-badge'); b.className = 'avatar-limit-badge limit-danger'; b.textContent = '15%'; const u = document.getElementById('unread-badge'); u.textContent = '1'; u.classList.remove('hidden'); u.style.display = 'flex';`
- **Show a speech bubble**: `playLupinTyping('This is a test message!');`

---

## 6. About MSIX Packaging

To package for Microsoft Store submission or as a SmartScreen-warning countermeasure, you can package a built binary into an MSIX container using `MakeAppx.exe` from the Windows 10/11 SDK and a self-signed or EV code-signing certificate (`SignTool.exe`).
