import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.resolve(__dirname, '../../src/index.html'), 'utf-8');
const mainJs = fs.readFileSync(path.resolve(__dirname, '../../src/main.js'), 'utf-8');

describe('main.js UI Logic & Regression Suite', () => {
  let invokeMock;
  let eventListeners;
  let registeredDomListeners;
  const origWindowAddEventListener = window.addEventListener.bind(window);

  beforeEach(async () => {
    registeredDomListeners = [];
    window.addEventListener = (type, fn, opts) => {
      if (type === 'DOMContentLoaded') {
        registeredDomListeners.push({ type, fn, opts });
      }
      return origWindowAddEventListener(type, fn, opts);
    };
    vi.useFakeTimers();
    eventListeners = {};
    invokeMock = vi.fn(async (cmd, args) => {
      if (cmd === 'get_gadget_config') {
        return {
          size_mode: 'mascot',
          mascot_scale: 'standard',
          mascot_bubble_on_left: true,
          message_limit: 5,
          avatar_name: 'Lucky',
        };
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false, url: 'https://muse.ai/?__pwa=1' };
      if (cmd === 'get_avatar_video_pack') {
        return {
          idle: 'data:video/mp4;base64,AAAA',
          waking: 'data:video/mp4;base64,BBBB',
          working: 'data:video/mp4;base64,CCCC',
          making_something: 'data:video/mp4;base64,DDDD',
          milestone_level_up: 'data:video/mp4;base64,EEEE',
          plugins: [],
          setting: { sound_enabled: false, bubble_display_duration_sec: 30 },
          quotes: {},
        };
      }
      if (cmd === 'get_usage_limit') {
        return { plan_name: 'Free Plan', used_percent: 25, remaining_percent: 75, reset_text: 'Resets Nov 14' };
      }
      if (cmd === 'get_chat_messages') {
        return [{ role: 'assistant', text: 'Initial message' }];
      }
      if (cmd === 'get_live_quotes') {
        return { items: [], recent_shown: [] };
      }
      if (cmd === 'check_bridge_health') {
        return {
          avatar_name: 'Lucky',
          avatar_state: 'idle',
          r1_avatar: { ok: true, selector: 'video' },
          r2_messages: { ok: true, selector: '.group/msg' },
          r3_input: { ok: true, selector: 'textarea' },
          r5_limit: { ok: true, selector: 'button' },
        };
      }
      if (cmd === 'get_avatar_state') {
        return { state: 'idle', statusText: 'Linked' };
      }
      if (cmd === 'sync_mascot_bubble_direction') return true;
      return {};
    });

    window.__TAURI__ = {
      core: { invoke: invokeMock },
      event: {
        listen: vi.fn((eventName, handler) => {
          eventListeners[eventName] = handler;
          return Promise.resolve(() => {});
        }),
      },
    };

    // Stub HTMLMediaElement.prototype.play & window.focus for jsdom
    window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    window.URL.createObjectURL = vi.fn(() => 'blob:mock-video-url');
    window.focus = vi.fn();

    // Load HTML body
    const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    document.body.className = 'mode-mascot';
    document.body.innerHTML = bodyMatch ? bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '') : '';

    // Execute main.js in current window context
    const runMain = new Function(mainJs);
    runMain();

    window.dispatchEvent(new Event('DOMContentLoaded'));
    await vi.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    for (const { type, fn, opts } of registeredDomListeners) {
      window.removeEventListener(type, fn, opts);
    }
    window.addEventListener = origWindowAddEventListener;
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('Does not send on Enter while IME is composing (isComposing: true); sends on Enter after confirmation (Issue #34)', async () => {
    const mascotInputField = document.getElementById('mascot-input-field');
    mascotInputField.value = 'Test question';

    // 1. Enter while IME is composing
    const composingEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    Object.defineProperty(composingEvent, 'isComposing', { value: true });
    mascotInputField.dispatchEvent(composingEvent);

    expect(invokeMock).not.toHaveBeenCalledWith('send_chat_message', expect.anything());

    // 2. A normal Enter after IME confirmation
    const normalEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: false,
    });
    mascotInputField.dispatchEvent(normalEnter);
    await vi.advanceTimersByTimeAsync(50);

    expect(invokeMock).toHaveBeenCalledWith('send_chat_message', { text: 'Test question' });
  });

  it('While the session screen is shown (session-visibility-changed = true), suppresses the speech bubble for new messages (Issue #29)', async () => {
    // Fire the event that the session screen came to the front
    expect(eventListeners['session-visibility-changed']).toBeDefined();
    eventListeners['session-visibility-changed']({ payload: true });

    // Update the mock so a new message arrives
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_chat_messages') {
        return [{ role: 'assistant', text: 'New message arrived while the session screen is shown' }];
      }
      return {};
    });

    // Advance the periodic polling
    await vi.advanceTimersByTimeAsync(5000);

    const mascotBubble = document.getElementById('mascot-bubble');
    expect(mascotBubble.classList.contains('hidden')).toBe(true);
  });

  it('When the usage-limit percentage is fetched, the badge and progress bar update, and a failed fetch (null) does not clear the existing valid display (Issue #43)', async () => {
    const badge = document.getElementById('avatar-limit-badge');
    expect(badge.textContent).toBe('75%');

    // Verify it does not fall back to '--%' even if the next get_usage_limit temporarily returns null
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_usage_limit') {
        return { plan_name: 'Free Plan', used_percent: null, remaining_percent: null, reset_text: '' };
      }
      return {};
    });

    const btnRefreshLimit = document.getElementById('btn-refresh-limit');
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(100);

    expect(badge.textContent).toBe('75%');
  });

  it('A reply containing a mascot-quotes code block is not shown directly in the speech bubble; it is saved to the live-remarks pool (Issue #37, #46)', async () => {
    // Complete the first sync (baseline setup) first
    await vi.advanceTimersByTimeAsync(2000);

    // Configure it to return a reply containing mascot-quotes
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'get_chat_messages') {
        return [
          {
            role: 'assistant',
            text: "```mascot-quotes\nYou're in great form today!\nFancy a coffee?\n```",
          },
        ];
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false };
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'Linked' };
      return {};
    });

    // Advance polling plus the 2-second confirmation timer
    await vi.advanceTimersByTimeAsync(6000);

    // The code block itself must not appear in the speech bubble
    const mascotBubble = document.getElementById('mascot-bubble');
    expect(mascotBubble.classList.contains('hidden')).toBe(true);

    // save_live_quotes is called and the 2 lines are saved to the pool
    const saveCall = invokeMock.mock.calls.find((c) => c[0] === 'save_live_quotes');
    expect(saveCall).toBeTruthy();
    expect(saveCall[1].payload.items).toHaveLength(2);
    expect(saveCall[1].payload.items[0].text).toBe("You're in great form today!");
    expect(saveCall[1].payload.items[1].text).toBe('Fancy a coffee?');
  });

  it('During long-text typing display, the parent container (.mascot-bubble-body) scrollTop auto-follows scrollHeight (Issue #50)', async () => {
    // Complete the first sync (baseline recording)
    await vi.advanceTimersByTimeAsync(2000);

    const mascotBubbleText = document.getElementById('mascot-bubble-text');
    const bubbleBody = mascotBubbleText.parentElement;
    expect(bubbleBody.classList.contains('mascot-bubble-body')).toBe(true);

    // Simulate the layout behavior where scrollHeight grows with the character count
    Object.defineProperty(bubbleBody, 'scrollHeight', {
      get: () => (mascotBubbleText.textContent || '').length * 8,
      configurable: true,
    });

    const longText = 'Line 1 text.\nLine 2 text.\nLine 3 text.\nLine 4 text.\nLine 5 text.';
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_chat_messages') {
        return [{ role: 'assistant', text: longText }];
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false };
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'Linked' };
      return {};
    });

    // Fire the 3-second periodic polling to start typing
    await vi.advanceTimersByTimeAsync(3100);
    expect(mascotBubbleText.textContent.length).toBeGreaterThan(0);
    expect(bubbleBody.scrollTop).toBe(bubbleBody.scrollHeight);

    // Advance time until typing completes
    await vi.advanceTimersByTimeAsync(2000);
    expect(mascotBubbleText.textContent).toBe(longText);
    expect(bubbleBody.scrollTop).toBe(longText.length * 8);
    expect(bubbleBody.scrollTop).toBeGreaterThan(200);
  });

  it('When a sleep resume is detected, reloads the session after the safety-guard check and re-fetches the usage limit once ready (Issue #52)', async () => {
    const callOrder = [];
    invokeMock.mockImplementation(async (cmd, args) => {
      callOrder.push({ cmd, args });
      if (cmd === 'get_session_status') return { exists: true, visible: false, url: 'https://muse.ai/thread/room-1' };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: false };
      if (cmd === 'reload_session') {
        return {
          executed: true,
          success: true,
          reason: args?.reason,
          before_url: 'https://muse.ai/thread/room-1',
          after_url: 'https://muse.ai/thread/room-1',
          url_matched: true,
          ready: true,
        };
      }
      if (cmd === 'get_usage_limit') {
        return { plan_name: 'Free Plan', used_percent: 40, remaining_percent: 60, reset_text: 'Resets Nov 14' };
      }
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: 'Initial message' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'Linked' };
      return {};
    });

    // Jump the system clock 5 minutes to simulate a sleep resume and fire the 3-second loop once
    const jumpedTime = Date.now() + 5 * 60 * 1000;
    vi.setSystemTime(jumpedTime);
    await vi.advanceTimersByTimeAsync(3100);

    const reloadIdx = callOrder.findIndex((c) => c.cmd === 'reload_session');
    expect(reloadIdx).toBeGreaterThanOrEqual(0);
    expect(callOrder[reloadIdx].args).toEqual({ reason: 'sleep_resume', force: false });

    // After reload_session, the usage limit is re-fetched with forceRefresh: true
    const refetchIdx = callOrder.findIndex(
      (c, i) => i > reloadIdx && c.cmd === 'get_usage_limit' && c.args?.forceRefresh === true
    );
    expect(refetchIdx).toBeGreaterThan(reloadIdx);
    expect(document.getElementById('avatar-limit-badge').textContent).toBe('60%');

    // A sleep-detection log is recorded
    expect(callOrder.some((c) => c.cmd === 'log_session_recovery_event' && c.args?.event === 'sleep_resume_detected')).toBe(true);
  });

  it('When a safety guard applies (draft present, generating, or session shown), skips the auto-reload and logs the reason (Issue #52)', async () => {
    const logs = [];
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'log_session_recovery_event') {
        logs.push(args);
        return true;
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false, url: 'https://muse.ai/thread/room-1' };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: false };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: 'Initial message' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'Linked' };
      return {};
    });

    // Case 1: an unsent draft in the mascot mini input field
    const mascotInputField = document.getElementById('mascot-input-field');
    mascotInputField.value = "Text I'm still typing";
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(3100);

    expect(invokeMock).not.toHaveBeenCalledWith('reload_session', expect.anything());
    expect(logs.some((l) => l.event === 'reload_skipped' && l.detail.includes('guard=mascot_draft_present'))).toBe(true);

    // Case 2: an unsent draft in the session-side input field
    mascotInputField.value = '';
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'log_session_recovery_event') {
        logs.push(args);
        return true;
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: true };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: 'Initial message' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'Linked' };
      return {};
    });
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(3100);

    expect(invokeMock).not.toHaveBeenCalledWith('reload_session', expect.anything());
    expect(logs.some((l) => l.event === 'reload_skipped' && l.detail.includes('guard=session_draft_present'))).toBe(true);

    // Case 3: the session side is generating
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'log_session_recovery_event') {
        logs.push(args);
        return true;
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: true, hasDraft: false };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: 'Initial message' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'Linked' };
      return {};
    });
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(3100);

    expect(invokeMock).not.toHaveBeenCalledWith('reload_session', expect.anything());
    expect(logs.some((l) => l.event === 'reload_skipped' && l.detail.includes('guard=session_generating'))).toBe(true);

    // Case 4: the session screen is shown
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'log_session_recovery_event') {
        logs.push(args);
        return true;
      }
      if (cmd === 'get_session_status') return { exists: true, visible: true };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: false };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: 'Initial message' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'Linked' };
      return {};
    });
    eventListeners['session-visibility-changed']({ payload: true });
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(3100);

    expect(invokeMock).not.toHaveBeenCalledWith('reload_session', expect.anything());
    expect(logs.some((l) => l.event === 'reload_skipped' && l.detail.includes('guard=session_visible'))).toBe(true);

    // Case 5: an unsent draft in the main chat input field (#chat-input)
    eventListeners['session-visibility-changed']({ payload: false });
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'log_session_recovery_event') {
        logs.push(args);
        return true;
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: false };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: 'Initial message' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'Linked' };
      return {};
    });
    const chatInput = document.getElementById('chat-input');
    chatInput.value = 'Draft in the main input field';
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(3100);

    expect(invokeMock).not.toHaveBeenCalledWith('reload_session', expect.anything());
    expect(logs.some((l) => l.event === 'reload_skipped' && l.detail.includes('guard=mascot_draft_present'))).toBe(true);
  });

  it('While a wake is in progress (isWakingForLiveQuotes), skips the auto-reload even when a sleep resume is detected (Issue #52)', async () => {
    const logs = [];
    let wakeResolve;
    let wakeCalled = false;

    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'log_session_recovery_event') {
        logs.push(args);
        return true;
      }
      if (cmd === 'get_live_quotes') {
        return { items: [], recent_shown: [] };
      }
      if (cmd === 'get_avatar_video_pack') {
        return {
          idle: 'data:video/mp4;base64,AAAA',
          waking: 'data:video/mp4;base64,BBBB',
          working: 'data:video/mp4;base64,CCCC',
          making_something: 'data:video/mp4;base64,DDDD',
          milestone_level_up: 'data:video/mp4;base64,EEEE',
          plugins: [{ name: 'dummy.mp4', data_url: 'data:video/mp4;base64,AAAA' }],
          setting: {},
          quotes: {},
        };
      }
      if (cmd === 'get_plugin_configs') {
        return {
          setting: {
            idle_threshold_sec: 1,
            action_interval_sec: 9999,
            default_action_duration_sec: 1,
            live_quotes: {
              enabled: true,
              target_mode: 'main',
              min_interval_min: 1,
              daily_limit: 6,
              quiet_hours_start: '03:00',
              quiet_hours_end: '03:01',
            },
          },
          quotes: {},
        };
      }
      if (cmd === 'send_live_quotes_wake') {
        wakeCalled = true;
        return new Promise((resolve) => {
          wakeResolve = resolve;
        });
      }
      if (cmd === 'get_session_status') return { exists: true, visible: false };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: false };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: 'Initial message' }];
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'Linked' };
      return {};
    });

    // 1. After the first IDLE action (1 sec) completes, trigger a live-remark wake while waiting out action_interval_sec
    await vi.advanceTimersByTimeAsync(3100);
    await vi.advanceTimersByTimeAsync(3100);
    expect(wakeCalled).toBe(true);

    // 2. While still waiting for the wake response, jump the clock 5 minutes to trigger a sleep resume
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(3100);

    expect(invokeMock).not.toHaveBeenCalledWith('reload_session', expect.anything());
    expect(logs.some((l) => l.event === 'reload_skipped' && l.detail.includes('guard=wake_in_progress'))).toBe(true);

    if (wakeResolve) wakeResolve({ sendResult: { success: true }, preWakeAssistant: '' });
  });

  it('The consecutive-failure fallback auto-reload fires at most once per episode and resets on a successful fetch (Issue #52)', async () => {
    let reloadCount = 0;
    let limitResponse = { plan_name: 'Free Plan', used_percent: null, remaining_percent: null, reset_text: '' };

    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'get_usage_limit') return limitResponse;
      if (cmd === 'get_session_status') return { exists: true, visible: false, url: 'https://muse.ai/thread/room-1' };
      if (cmd === 'inspect_session_reload_safety') return { isGenerating: false, hasDraft: false };
      if (cmd === 'reload_session') {
        reloadCount += 1;
        return {
          executed: true,
          success: true,
          reason: args?.reason,
          before_url: 'https://muse.ai/thread/room-1',
          after_url: 'https://muse.ai/thread/room-1',
          url_matched: true,
          ready: true,
        };
      }
      return {};
    });

    const btnRefreshLimit = document.getElementById('btn-refresh-limit');

    // 1st failure: no reload yet
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(reloadCount).toBe(0);

    // 2nd consecutive failure: the fallback reload fires exactly once
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(reloadCount).toBe(1);

    // 3rd and 4th failures do not reload again in the same episode
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(reloadCount).toBe(1);

    // A successful fetch resets the episode
    limitResponse = { plan_name: 'Free Plan', used_percent: 30, remaining_percent: 70, reset_text: 'Resets Nov 14' };
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.getElementById('avatar-limit-badge').textContent).toBe('70%');

    // In a new episode, two consecutive failures again trigger exactly one reload
    limitResponse = { plan_name: 'Free Plan', used_percent: null, remaining_percent: null, reset_text: '' };
    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(reloadCount).toBe(1);

    btnRefreshLimit.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(reloadCount).toBe(2);
  });

  it('On receiving a session-reloaded event, re-fetches the usage limit when the input field is ready (Issue #52)', async () => {
    expect(eventListeners['session-reloaded']).toBeDefined();
    invokeMock.mockClear();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_usage_limit') {
        return { plan_name: 'Free Plan', used_percent: 15, remaining_percent: 85, reset_text: 'Resets Nov 14' };
      }
      return {};
    });

    eventListeners['session-reloaded']({
      payload: {
        executed: true,
        success: true,
        reason: 'manual_tray',
        ready: true,
        url_matched: true,
      },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(invokeMock).toHaveBeenCalledWith('get_usage_limit', { forceRefresh: true });
    expect(document.getElementById('avatar-limit-badge').textContent).toBe('85%');
  });

  it('Regular messages and remarks (monologues) switch the speech bubble title and is-quote class (Issue #56)', async () => {
    // Complete the first sync (baseline recording)
    await vi.advanceTimersByTimeAsync(2000);

    const bubble = document.getElementById('mascot-bubble');
    const titleEl = bubble.querySelector('.mascot-bubble-title');
    const avatarContainer = document.getElementById('avatar-container');

    // 1. A single-click touch reaction (remark style) sets is-quote and 💭 Musing
    avatarContainer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, screenX: 100, screenY: 100 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, screenX: 100, screenY: 100 }));
    await vi.advanceTimersByTimeAsync(300);

    expect(bubble.classList.contains('hidden')).toBe(false);
    expect(bubble.classList.contains('is-quote')).toBe(true);
    expect(titleEl.textContent).toBe('💭 Musing');

    // 2. The close button hides the bubble and resets is-quote and the title
    document.getElementById('btn-bubble-close').click();
    expect(bubble.classList.contains('hidden')).toBe(true);
    expect(bubble.classList.contains('is-quote')).toBe(false);
    expect(titleEl.textContent).toBe('Muse');

    // 3. When a regular message arrives from Muse, there is no is-quote and the title is Muse
    if (eventListeners['session-visibility-changed']) {
      eventListeners['session-visibility-changed']({ payload: false });
    }
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_session_status') return { exists: true, visible: false, url: 'https://muse.ai/?__pwa=1' };
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'Linked' };
      if (cmd === 'get_chat_messages') {
        return [
          { role: 'assistant', text: 'Initial message' },
          { role: 'assistant', text: 'A regular new reply!' },
        ];
      }
      return {};
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect(bubble.classList.contains('hidden')).toBe(false);
    expect(bubble.classList.contains('is-quote')).toBe(false);
    expect(titleEl.textContent).toBe('Muse');
  });

  it('When the avatar name is returned in the status pill, does not misdisplay it; shows the fallback text for the state (Issue #57)', async () => {
    await vi.advanceTimersByTimeAsync(2000);

    const avatarNameEl = document.getElementById('avatar-name');
    avatarNameEl.textContent = 'Lucky';
    const statusPill = document.getElementById('avatar-status-pill');
    const statusTextEl = document.getElementById('avatar-status-text');

    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_session_status') return { exists: true, visible: false, url: 'https://muse.ai/?__pwa=1' };
      if (cmd === 'get_chat_messages') return [{ role: 'assistant', text: 'Initial message' }];
      if (cmd === 'get_avatar_state') return { state: 'working', statusText: 'Lucky' };
      return {};
    });

    await vi.advanceTimersByTimeAsync(3100);

    expect(statusPill.classList.contains('hidden')).toBe(false);
    expect(statusTextEl.textContent).toBe('🛠️ Working');
    expect(statusTextEl.textContent).not.toContain('Lucky');
  });

  it('In mascot mode, syncs only the rects of currently visible interactive elements to update_mascot_hit_rects (Issue #60)', async () => {
    const avatarCol = document.getElementById('avatar-column');
    const bubble = document.getElementById('mascot-bubble');
    const inputBar = document.getElementById('mascot-input-bar');
    const closeBtn = document.getElementById('btn-bubble-close');

    avatarCol.getBoundingClientRect = () => ({ left: 492, top: 45, width: 120, height: 170 });
    bubble.getBoundingClientRect = () => ({ left: 10, top: 60, width: 460, height: 140 });
    inputBar.getBoundingClientRect = () => ({ left: 10, top: 109, width: 460, height: 42 });

    await vi.advanceTimersByTimeAsync(2100);
    closeBtn.click();
    await vi.advanceTimersByTimeAsync(100);
    let hitCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'update_mascot_hit_rects');
    expect(hitCalls.length).toBeGreaterThan(0);
    expect(hitCalls[hitCalls.length - 1][1].rects).toEqual([
      { x: 492, y: 45, width: 120, height: 170 },
    ]);

    // When a new message shows the speech bubble, the avatar + bubble rects are synced
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_session_status') return { exists: true, visible: false, url: 'https://muse.ai/?__pwa=1' };
      if (cmd === 'get_avatar_state') return { state: 'idle', statusText: 'Linked' };
      if (cmd === 'get_chat_messages') {
        return [
          { role: 'assistant', text: 'Initial message' },
          { role: 'assistant', text: 'This is a test bubble' },
        ];
      }
      return {};
    });
    await vi.advanceTimersByTimeAsync(3200);
    expect(bubble.classList.contains('hidden')).toBe(false);
    hitCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'update_mascot_hit_rects');
    expect(hitCalls[hitCalls.length - 1][1].rects).toEqual([
      { x: 492, y: 45, width: 120, height: 170 },
      { x: 10, y: 60, width: 460, height: 140 },
    ]);

    // Closing the bubble returns to syncing only the avatar rect
    closeBtn.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(bubble.classList.contains('hidden')).toBe(true);
    hitCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'update_mascot_hit_rects');
    expect(hitCalls[hitCalls.length - 1][1].rects).toEqual([
      { x: 492, y: 45, width: 120, height: 170 },
    ]);
  });

  it('Opening the session screen from the mascot or toggling visibility clears the hover state (is-hovered) (Issue #61)', async () => {
    const avatarColumn = document.getElementById('avatar-column');
    const avatarContainer = document.getElementById('avatar-container');
    const mascotRestoreBtn = document.getElementById('mascot-restore-btn');
    const quickInputBtn = document.getElementById('btn-mascot-quick-input');

    // Hovering adds is-hovered
    avatarColumn.dispatchEvent(new Event('pointerenter'));
    avatarContainer.dispatchEvent(new Event('pointerenter'));
    mascotRestoreBtn.dispatchEvent(new Event('pointerenter'));
    quickInputBtn.dispatchEvent(new Event('pointerenter'));
    expect(avatarColumn.classList.contains('is-hovered')).toBe(true);
    expect(avatarContainer.classList.contains('is-hovered')).toBe(true);
    expect(mascotRestoreBtn.classList.contains('is-hovered')).toBe(true);
    expect(quickInputBtn.classList.contains('is-hovered')).toBe(true);

    // Clicking the ⤢ button opens the session screen and immediately clears all hover states
    mascotRestoreBtn.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(avatarColumn.classList.contains('is-hovered')).toBe(false);
    expect(avatarContainer.classList.contains('is-hovered')).toBe(false);
    expect(mascotRestoreBtn.classList.contains('is-hovered')).toBe(false);
    expect(quickInputBtn.classList.contains('is-hovered')).toBe(false);

    // session-visibility-changed(false) (minimizing the session restores the mascot) also leaves no hover state behind
    avatarContainer.classList.add('is-hovered');
    mascotRestoreBtn.classList.add('is-hovered');
    eventListeners['session-visibility-changed']?.({ payload: false });
    expect(avatarContainer.classList.contains('is-hovered')).toBe(false);
    expect(mascotRestoreBtn.classList.contains('is-hovered')).toBe(false);
  });

  it('Even if blur clears hover during a mascot drag, pointermove after the drag ends restores is-hovered (Issue #62)', async () => {
    const avatarColumn = document.getElementById('avatar-column');
    const avatarContainer = document.getElementById('avatar-container');

    document.body.classList.add('mode-mascot');
    avatarContainer.dispatchEvent(new MouseEvent('mousedown', { button: 0, screenX: 100, screenY: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { screenX: 120, screenY: 120 }));
    await vi.advanceTimersByTimeAsync(20);

    // Dragging starts, blur fires, and hover is expected to clear
    window.dispatchEvent(new Event('blur'));
    expect(avatarContainer.classList.contains('is-hovered')).toBe(false);

    // After the drag ends (mousemove/pointermove), the hover highlight returns
    avatarColumn.dispatchEvent(new Event('pointermove'));
    avatarContainer.dispatchEvent(new Event('pointermove'));
    expect(avatarColumn.classList.contains('is-hovered')).toBe(true);
    expect(avatarContainer.classList.contains('is-hovered')).toBe(true);
  });

  it('Pressing a one-click shortcut chip does not send immediately; the text is set in the input field and sent with Enter (Issue #68)', async () => {
    const quickInputBtn = document.getElementById('btn-mascot-quick-input');
    const mascotInputBar = document.getElementById('mascot-input-bar');
    const mascotInputField = document.getElementById('mascot-input-field');
    const shortcutNote = document.getElementById('mascot-shortcut-note');

    quickInputBtn.click();
    expect(mascotInputBar.classList.contains('hidden')).toBe(false);

    const chips = document.querySelectorAll('.mascot-shortcut-chip');
    expect(chips.length).toBe(4);
    expect(chips[0].textContent).toBe('I keep forgetting things — help me improve that');
    expect(chips[0].title).toBe('When what Muse remembers feels outdated or mistaken');
    expect(chips[1].title).toBe("When the conversation gets long and heavy — I'll summarize it and hand it over to a new chat");
    expect(chips[2].title).toBe("When you want to learn handy tricks you don't know yet");
    expect(chips[3].title).toBe("When you want to look back on today's conversations at the end of the day");

    // Clicking the first chip does not send immediately; it enters a preview state
    chips[0].click();
    expect(chips[0].classList.contains('active')).toBe(true);
    expect(mascotInputField.value).toContain('MEMORY.md');
    expect(shortcutNote.classList.contains('is-selected')).toBe(true);
    expect(invokeMock).not.toHaveBeenCalledWith('send_chat_message', expect.anything());

    // Enter sends it to the currently active chat
    mascotInputField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: false, bubbles: true }));
    await vi.advanceTimersByTimeAsync(20);
    expect(invokeMock).toHaveBeenCalledWith('send_chat_message', {
      text: expect.stringContaining('MEMORY.md'),
    });
    expect(mascotInputBar.classList.contains('hidden')).toBe(true);
    expect(chips[0].classList.contains('active')).toBe(false);
  });
});
