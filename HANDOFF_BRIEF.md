# Handoff Brief (for Pasting to Another AI)

Paste the text between the "---" lines below as-is to the coding AI. Also pass along the design document (DESIGN.md).

---
You are responsible for implementing a Windows desktop gadget. The design is complete, and the design document (DESIGN.md) is authoritative. Do not change the requirements on your own; ask about anything unclear before proceeding with implementation.

## What to build
A resident Windows desktop gadget for Muse (a personal AI agent). It has its own UI and keeps a logged-in muse.ai session in a background WebView to integrate with chat.

## Repository
- Implementation target (currently empty): https://github.com/DashingMZA/desktop-mascot-for-muse
- Reference implementation (read this first, without fail): https://github.com/DashingMZA/google-ai-limit-monitor
  - Tauri 2.0 + Rust, Vanilla HTML/CSS/JS. Follow its approach for the frameless, transparent, always-on-top small window and tray residency.

## Requirements (finalized)
- R1: Display Muse's avatar with animation
- R2: Display the latest few messages from the main chat thread
- R3: Let the user type and send messages from the gadget
- R4: Resident gadget. Always on top
- R5: Show Muse's window limit (usage limit) (only when it can be retrieved. Do not show estimated values)
- R6: An "Open in browser" button opens https://muse.ai in the default browser (activating an existing tab is not part of the v1 requirements)
- R7: Switch the gadget size between small and large in one action with a button/hotkey (an alternative/complement to R6). Decide the approach in Phase 1, including the option of showing the official Web UI itself in large mode

## Architecture (design document §2 is authoritative)
- Two windows: the local UI (label: main) and a hidden session WebView that opens muse.ai (label: session)
- Assume Muse has no public API. Implement R1/R2/R3/R5 by reading and writing the DOM of the session WebView
- Consolidate DOM selectors in one file (the session-bridge equivalent); do not scatter them elsewhere
- Pin the WebView2 data folder to be app-specific and persist the login session

## Absolute security requirements
- Apply Tauri capabilities to the main window only. Never allow the session side's remote content (muse.ai's JS) to call Tauri commands (do not add a remote URL allowance to capabilities)
- Do not store passwords or other credentials in the app. Leave login to the official flow inside the WebView

## How to proceed
1. **First do only the Phase 0 technical verification and report the results** (do not proceed to the main implementation before this report):
   - ① Can you sign in to muse.ai in Tauri's WebView2, and does the session persist after restarting the app? (If Google OAuth rejects it, report that and the countermeasures you tried)
   - ② Can the avatar's animation assets (video files, etc.) be obtained from the DOM as URLs?
   - ③ Can the main chat's message list be read from the DOM, and can text be injected into the input field and sent?
   - ④ Where in the web UI is the usage limit shown, and can the numbers be read from the DOM?
2. Based on the Phase 0 results, propose degraded specifications for any items that were not feasible, get approval, then proceed to Phase 1 and beyond
3. Commit in small units and report "what works now" for each Phase

## Environment
- Windows 11, Node.js 24+, Rust (MSVC), Visual Studio C++ Build Tools (same prerequisites as the reference repository's README)
- The developer speaks English. Report and ask questions in English

## Open items (ask about these instead of deciding them yourself)
- The default value for N, the number of latest messages shown (5 is a placeholder)
- The default hotkey assignment (it may conflict with existing AutoHotkey settings)
- The app's display name
---
