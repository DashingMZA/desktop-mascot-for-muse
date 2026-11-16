import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bridgeScriptPath = path.resolve(__dirname, '../../src-tauri/src/session_bridge.js');
const bridgeScriptContent = fs.readFileSync(bridgeScriptPath, 'utf-8');

describe('session_bridge.js DOM Scraping & Guardrails Suite', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = 'Muse AI';
    delete window.__MUSE_BRIDGE__;
    delete window.__MUSE_STORE__;
    delete window.__MUSE_CACHED_LIMIT__;
    delete window.__MUSE_CACHED_AVATAR_NAME__;
    delete window.__MUSE_BLOB_STATE_MAP__;
    delete window.__MUSE_SESSION_VISIBLE__;
    delete window.__MUSE_FETCHING_LIMIT__;
    if (window.__MUSE_PASSIVE_WATCHER__) {
      clearInterval(window.__MUSE_PASSIVE_WATCHER__);
      delete window.__MUSE_PASSIVE_WATCHER__;
    }
    // Load session_bridge.js into window
    const fn = new Function(bridgeScriptContent);
    fn();
  });

  afterEach(() => {
    if (window.__MUSE_PASSIVE_WATCHER__) {
      clearInterval(window.__MUSE_PASSIVE_WATCHER__);
      delete window.__MUSE_PASSIVE_WATCHER__;
    }
  });

  it('extractAvatarName: extracts the avatar name accurately from the line just before "Linked"', () => {
    document.body.innerHTML = `
      <aside class="avatar-dock">
        <div>
          <video src="blob:https://muse.ai/1234"></video>
          <div>
            <span>Lucky</span>
            <span>Linked</span>
          </div>
        </div>
      </aside>
    `;
    const el = document.querySelector('aside > div');
    // jsdom does not implement innerText layout line breaks automatically unless mocked or structured
    Object.defineProperty(el, 'innerText', {
      value: 'Lucky\nLinked',
      configurable: true,
    });

    const name = window.__MUSE_BRIDGE__.extractAvatarName();
    expect(name).toBe('Lucky');
  });

  it('getAvatarState (Issue #35, #42): does not misdetect keywords in the chat body; detects only the status around the avatar', async () => {
    document.body.innerHTML = `
      <div class="avatar-header">
        <video data-hatch-media-owner="avatar-layer" src=""></video>
        <span class="status-label">Linked</span>
      </div>
      <main>
        <div class="group/msg">
          <div class="prose">A batch process is currently running. Please wait a while.</div>
        </div>
      </main>
    `;

    const stateIdle = await window.__MUSE_BRIDGE__.getAvatarState();
    expect(stateIdle.state).toBe('idle');
    expect(stateIdle.statusText).toBe('Linked');

    // When the status under the avatar changes to "Thinking..."
    document.querySelector('.status-label').textContent = 'Thinking...';
    const stateWorking = await window.__MUSE_BRIDGE__.getAvatarState();
    expect(stateWorking.state).toBe('working');
    expect(stateWorking.statusText).toBe('Thinking...');

    // When it changes to "Creating code"
    document.querySelector('.status-label').textContent = 'Creating code';
    const stateMaking = await window.__MUSE_BRIDGE__.getAvatarState();
    expect(stateMaking.state).toBe('making_something');
    expect(stateMaking.statusText).toBe('Creating code');
  });

  it('getMessages (Issue #32): extracts option buttons, excludes system buttons (Copy, Like, etc.), and removes duplication at the end of the body', async () => {
    document.body.innerHTML = `
      <main>
        <div class="group/msg" id="msg-1">
          <span class="sr-only">You:</span>
          <div class="prose">Which option sounds good?</div>
        </div>
        <div class="group/msg" id="msg-2">
          <span class="sr-only">Assistant message:</span>
          <div class="prose">I've prepared two plans! Which one shall we go with? Proceed with plan AProceed with plan B</div>
          <div class="actions">
            <button aria-label="Copy">Copy</button>
            <button aria-label="Like">Good</button>
            <button class="suggestion-chip">Proceed with plan A</button>
            <button class="suggestion-chip">Proceed with plan B</button>
          </div>
        </div>
        <textarea placeholder="Type a message"></textarea>
      </main>
    `;

    // Configure innerText for jsdom
    const msg1Prose = document.querySelector('#msg-1 .prose');
    Object.defineProperty(msg1Prose, 'innerText', { value: 'Which option sounds good?', configurable: true });
    const msg2Prose = document.querySelector('#msg-2 .prose');
    Object.defineProperty(msg2Prose, 'innerText', {
      value: "I've prepared two plans! Which one shall we go with?\nProceed with plan A\nProceed with plan B",
      configurable: true,
    });

    const messages = await window.__MUSE_BRIDGE__.getMessages(5);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: 'user',
      text: 'Which option sounds good?',
    });
    expect(messages[1]).toEqual({
      role: 'assistant',
      text: "I've prepared two plans! Which one shall we go with?",
      options: ['Proceed with plan A', 'Proceed with plan B'],
    });
  });

  it('fetchUsageLimit (Issue #33, #43): calculates the remaining % accurately from the used % or the progress bar', async () => {
    document.body.innerHTML = `
      <div role="dialog">
        <span class="text-body text-text-primary">Pro Plan</span>
        <div role="progressbar" aria-valuenow="35"></div>
        <p>35% used</p>
        <p>Weekly limit resets on Nov 14</p>
      </div>
    `;
    Object.defineProperty(document.body, 'innerText', {
      value: 'Pro Plan\n35% used\nWeekly limit resets on Nov 14',
      configurable: true,
    });

    const limit = await window.__MUSE_BRIDGE__.fetchUsageLimit(true);
    expect(limit.plan_name).toBe('Pro Plan');
    expect(limit.used_percent).toBe(35);
    expect(limit.remaining_percent).toBe(65);
    expect(limit.reset_text).toBe('Weekly limit resets on Nov 14');
  });

  it('fetchUsageLimit (Issue #34): while the AI is generating an answer (stop button present), does not auto-navigate and returns a fallback or the cache', async () => {
    window.__MUSE_CACHED_LIMIT__ = {
      plan_name: 'Free Plan',
      used_percent: 20,
      remaining_percent: 80,
      reset_text: 'Cached reset date',
    };

    let settingsClicked = false;
    document.body.innerHTML = `
      <button aria-label="Settings" id="btn-settings">Settings</button>
      <button aria-label="Stop answering">Stop</button>
    `;
    Object.defineProperty(document.body, 'innerText', { value: '', configurable: true });
    document.getElementById('btn-settings').addEventListener('click', () => {
      settingsClicked = true;
    });

    // Even when called with passiveOnly = false, it must not click-navigate because the stop button is present
    const res = await window.__MUSE_BRIDGE__.fetchUsageLimit(false);
    expect(settingsClicked).toBe(false);
    expect(res.remaining_percent).toBe(80);
  });

  it('checkChatReady (Issue #46): judges URL-normalized comparison and the input field enabled state', async () => {
    document.body.innerHTML = `<textarea placeholder="Type a message"></textarea>`;
    const currentHref = window.location.href;

    const readySame = await window.__MUSE_BRIDGE__.checkChatReady(currentHref + '/?__pwa=1#hash');
    expect(readySame.ready).toBe(true);
    expect(readySame.urlMatched).toBe(true);

    const readyDiff = await window.__MUSE_BRIDGE__.checkChatReady('https://muse.ai/chat/other-thread-999');
    expect(readyDiff.ready).toBe(true);
    expect(readyDiff.urlMatched).toBe(false);
  });

  it('fetchUsageLimit (Issue #49): reliably fetches the usage limit with polling waits and closes the modal even when the modal, General tab, and usage-limit DOM render late asynchronously after clicking Settings', async () => {
    let settingsClicked = false;
    let generalTabClicked = false;
    let modalClosed = false;

    document.body.innerHTML = `
      <main>
        <button title="Settings" id="btn-settings">⚙️</button>
        <textarea placeholder="Type a message"></textarea>
      </main>
      <div id="modal-root"></div>
    `;

    const settingsBtn = document.getElementById('btn-settings');
    settingsBtn.addEventListener('click', () => {
      if (settingsClicked) return;
      settingsClicked = true;
      // The modal and "General" tab appear asynchronously after 60ms
      setTimeout(() => {
        const modalRoot = document.getElementById('modal-root');
        modalRoot.innerHTML = `
          <div role="dialog" id="settings-dialog">
            <button role="tab" id="tab-general">General</button>
            <button aria-label="Close" id="btn-close-modal">×</button>
            <div id="tab-panel">Loading...</div>
          </div>
        `;
        const tabGeneral = document.getElementById('tab-general');
        tabGeneral.addEventListener('click', () => {
          if (generalTabClicked) return;
          generalTabClicked = true;
          // The usage limit from the API response renders asynchronously 120ms after the tab click
          setTimeout(() => {
            const panel = document.getElementById('tab-panel');
            if (panel) {
              panel.innerHTML = `
                <span class="text-body text-text-primary">Free Plan</span>
                <div><span>42%</span> <span>used</span></div>
                <p>Weekly limit resets on Nov 20</p>
              `;
            }
          }, 120);
        });

        const closeBtn = document.getElementById('btn-close-modal');
        closeBtn.addEventListener('click', () => {
          modalClosed = true;
        });
      }, 60);
    });

    const res = await window.__MUSE_BRIDGE__.fetchUsageLimit(false, {
      pollIntervalMs: 30,
      maxTabWaitMs: 500,
      maxLimitWaitMs: 1000,
      closeWaitMs: 20,
      navWaitMs: 20,
    });

    expect(settingsClicked).toBe(true);
    expect(generalTabClicked).toBe(true);
    expect(modalClosed).toBe(true);
    expect(res.plan_name).toBe('Free Plan');
    expect(res.used_percent).toBe(42);
    expect(res.remaining_percent).toBe(58);
    expect(res.reset_text).toBe('Weekly limit resets on Nov 20');
    expect(window.__MUSE_CACHED_LIMIT__).toEqual(res);
  });

  it('scanDomForLimit (Issue #49): accurately extracts the usage limit from the progress bar style width or split nodes', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <span class="plan-badge">Free Plan</span>
        <div class="progress-track">
          <div class="progress-fill" style="width: 28%;"></div>
        </div>
        <div>Remaining 72%</div>
        <div>Reset: Nov 21</div>
      </div>
    `;

    const res = window.__MUSE_BRIDGE__.scanDomForLimit();
    expect(res).not.toBeNull();
    expect(res.plan_name).toBe('Free Plan');
    expect(res.remaining_percent).toBe(72);
    expect(res.used_percent).toBe(28);
    expect(res.reset_text).toBe('Reset: Nov 21');
  });

  it('fetchUsageLimit (Issue #49 guardrail): when the settings dialog is already open, only reads the values and never closes it on its own', async () => {
    let closeClicked = false;
    let escapeDispatched = false;

    document.body.innerHTML = `
      <div role="dialog" id="user-opened-dialog">
        <button aria-label="Close" id="btn-close-dialog">×</button>
        <div id="dialog-content">Settings menu open...</div>
      </div>
    `;

    document.getElementById('btn-close-dialog').addEventListener('click', () => {
      closeClicked = true;
    });
    const onKeyDown = (e) => {
      if (e.key === 'Escape') escapeDispatched = true;
    };
    document.addEventListener('keydown', onKeyDown);

    // Case where the user opens the General tab after 50ms and the usage limit renders
    setTimeout(() => {
      const content = document.getElementById('dialog-content');
      if (content) {
        content.innerHTML = `<p>25% used</p>`;
      }
    }, 50);

    const res = await window.__MUSE_BRIDGE__.fetchUsageLimit(false, {
      pollIntervalMs: 25,
      maxTabWaitMs: 300,
    });

    document.removeEventListener('keydown', onKeyDown);

    expect(res.used_percent).toBe(25);
    expect(res.remaining_percent).toBe(75);
    expect(closeClicked).toBe(false);
    expect(escapeDispatched).toBe(false);
  });

  it('fetchUsageLimit (Issue #49 guardrail): when the session screen appears during background polling, aborts immediately and does not close the modal on its own', async () => {
    let settingsClicked = false;
    let closeClicked = false;
    let escapeDispatched = false;

    document.body.innerHTML = `
      <main>
        <button aria-label="Settings" id="btn-settings">⚙️</button>
        <textarea placeholder="Type a message"></textarea>
      </main>
      <div id="modal-root"></div>
    `;

    document.getElementById('btn-settings').addEventListener('click', () => {
      settingsClicked = true;
      document.getElementById('modal-root').innerHTML = `
        <div role="dialog">
          <button aria-label="Close" id="btn-close-modal">×</button>
          <div id="tab-panel">Loading...</div>
        </div>
      `;
      document.getElementById('btn-close-modal').addEventListener('click', () => {
        closeClicked = true;
      });
      // The user opens the session screen 40ms into polling (__MUSE_SESSION_VISIBLE__ = true)
      setTimeout(() => {
        window.__MUSE_SESSION_VISIBLE__ = true;
      }, 40);
    });

    const onKeyDown = (e) => {
      if (e.key === 'Escape') escapeDispatched = true;
    };
    document.addEventListener('keydown', onKeyDown);

    await window.__MUSE_BRIDGE__.fetchUsageLimit(false, {
      pollIntervalMs: 25,
      maxTabWaitMs: 300,
      maxLimitWaitMs: 300,
    });

    document.removeEventListener('keydown', onKeyDown);

    expect(settingsClicked).toBe(true);
    expect(closeClicked).toBe(false);
    expect(escapeDispatched).toBe(false);
  });

  it('inspectReloadSafety (Issue #52): accurately judges whether generation is in progress (stop button) and whether an unsent draft exists', () => {
    document.body.innerHTML = `
      <main>
        <textarea placeholder="Type a message"></textarea>
      </main>
    `;
    const ta = document.querySelector('textarea');

    // 1. Nothing entered and no stop button
    let safety = window.__MUSE_BRIDGE__.inspectReloadSafety();
    expect(safety.isGenerating).toBe(false);
    expect(safety.hasDraft).toBe(false);
    expect(safety.draftLength).toBe(0);

    // 2. Whitespace only counts as no draft
    ta.value = '   \n  ';
    safety = window.__MUSE_BRIDGE__.inspectReloadSafety();
    expect(safety.hasDraft).toBe(false);

    // 3. An unsent draft exists
    ta.value = 'Hello Muse';
    safety = window.__MUSE_BRIDGE__.inspectReloadSafety();
    expect(safety.hasDraft).toBe(true);
    expect(safety.draftLength).toBe(10);

    // 4. The draft is cleared and the stop button appears (answer generating)
    ta.value = '';
    const stopBtn = document.createElement('button');
    stopBtn.setAttribute('aria-label', 'Stop generating answer');
    document.querySelector('main').appendChild(stopBtn);
    safety = window.__MUSE_BRIDGE__.inspectReloadSafety();
    expect(safety.isGenerating).toBe(true);
    expect(safety.hasDraft).toBe(false);
  });

  it('Detects external link clicks and window.open and issues a __MUSE_OPEN_URL__ title notification (Issue #54)', () => {
    document.title = 'Muse AI - Session';
    document.body.innerHTML = `
      <main>
        <a id="ext-link" href="https://example.com/docs" target="_blank"><span>External link</span></a>
        <a id="int-link" href="https://muse.ai/thread/abc">Internal link</a>
        <a id="oauth-link" href="https://accounts.google.com/o/oauth2/auth">Google sign-in</a>
        <a id="fb-link" href="https://www.facebook.com/aymh/redirect-cycle/?t=6">Facebook login</a>
        <a id="ig-link" href="https://www.instagram.com/aymh/redirect-cycle/?t=6">Instagram login</a>
      </main>
    `;

    // Internal links are not hooked
    const intEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    document.getElementById('int-link').dispatchEvent(intEvent);
    expect(intEvent.defaultPrevented).toBe(false);
    expect(document.title).toBe('Muse AI - Session');

    // OAuth links are not hooked either
    const oauthEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    document.getElementById('oauth-link').dispatchEvent(oauthEvent);
    expect(oauthEvent.defaultPrevented).toBe(false);
    expect(document.title).toBe('Muse AI - Session');

    // Facebook login links are not hooked either (auth flow routes through
    // facebook.com/aymh/redirect-cycle/ and must stay in the session WebView)
    const fbEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    document.getElementById('fb-link').dispatchEvent(fbEvent);
    expect(fbEvent.defaultPrevented).toBe(false);
    expect(document.title).toBe('Muse AI - Session');

    // Instagram login links are not hooked either (auth flow routes through
    // instagram.com/aymh/redirect-cycle/ and must stay in the session WebView)
    const igEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    document.getElementById('ig-link').dispatchEvent(igEvent);
    expect(igEvent.defaultPrevented).toBe(false);
    expect(document.title).toBe('Muse AI - Session');

    // External links (clicking the child <span>) are hooked and set __MUSE_OPEN_URL__
    const extSpan = document.querySelector('#ext-link span');
    const extEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    extSpan.dispatchEvent(extEvent);
    expect(extEvent.defaultPrevented).toBe(true);
    expect(document.title).toBe('__MUSE_OPEN_URL__:https://example.com/docs');

    // window.open also sets __MUSE_OPEN_URL__ for an external URL and returns null
    document.title = 'Muse AI - Session';
    const opened = window.open('https://github.com/mowthow-works', '_blank');
    expect(opened).toBeNull();
    expect(document.title).toBe('__MUSE_OPEN_URL__:https://github.com/mowthow-works');
  });

  it('getAvatarState (Issue #57): parent-element fallback does not mis-extract the avatar name (Lucky, etc.) as statusText', async () => {
    document.body.innerHTML = `
      <aside class="avatar-dock">
        <div id="avatar-box">
          <video src="blob:https://muse.ai/avatar-1"></video>
          <div>52%</div>
          <div>Lucky</div>
        </div>
      </aside>
    `;
    const box = document.getElementById('avatar-box');
    Object.defineProperty(box, 'innerText', {
      value: '52%\nLucky',
      configurable: true,
    });
    const video = document.querySelector('video');
    video.__reactProps$test = { avatarState: 'working' };

    const res = await window.__MUSE_BRIDGE__.getAvatarState();
    expect(res.state).toBe('working');
    expect(res.statusText).toBe('');
  });

  it('getAvatarState (Issue #58): parent-element fallback does not mis-extract chat body text from an ancestor containing the main chat area', async () => {
    document.body.innerHTML = `
      <div id="layout-root">
        <div id="avatar-wrap">
          <div id="avatar-box">
            <video src="blob:https://muse.ai/avatar-2"></video>
            <div>Lucky</div>
          </div>
        </div>
        <main>
          <div class="group/msg">
            <div class="prose">- No overlap with the renovation: confirmed</div>
          </div>
        </main>
      </div>
    `;
    const layoutRoot = document.getElementById('layout-root');
    Object.defineProperty(layoutRoot, 'innerText', {
      value: 'Lucky\n- No overlap with the renovation: confirmed',
      configurable: true,
    });
    const video = document.querySelector('video');
    video.__reactProps$test = { avatarState: 'working' };

    const res = await window.__MUSE_BRIDGE__.getAvatarState();
    expect(res.state).toBe('working');
    expect(res.statusText).toBe('');
  });

  it('fetchUsageLimit / inspectReloadSafety (Issue #63): does not misdetect generation from partial matches like Desktop or disabled stop buttons', async () => {
    let settingsClicked = false;
    document.body.innerHTML = `
      <button aria-label="Desktop mode">Desktop</button>
      <button aria-label="Stop generating" disabled>Stop</button>
      <button aria-label="Stop response" style="display: none">Stop</button>
      <button aria-label="Settings" id="btn-settings">Settings</button>
    `;
    Object.defineProperty(document.body, 'innerText', { value: '', configurable: true });
    document.getElementById('btn-settings').addEventListener('click', () => {
      settingsClicked = true;
      const dlg = document.createElement('div');
      dlg.setAttribute('role', 'dialog');
      dlg.innerHTML = '<div role="progressbar" aria-valuenow="25"></div><span>25% used</span>';
      document.body.appendChild(dlg);
      Object.defineProperty(document.body, 'innerText', { value: '25% used', configurable: true });
    });

    const safety = window.__MUSE_BRIDGE__.inspectReloadSafety();
    expect(safety.isGenerating).toBe(false);

    const res = await window.__MUSE_BRIDGE__.fetchUsageLimit(false, {
      pollIntervalMs: 10,
      maxTabWaitMs: 50,
      maxLimitWaitMs: 50,
      closeWaitMs: 10,
      navWaitMs: 10,
    });
    expect(settingsClicked).toBe(true);
    expect(res.used_percent).toBe(25);
    expect(res.remaining_percent).toBe(75);
  });

  it('fetchUsageLimit (Issue #63): follows the two-step menu (Settings button → "Settings" in the popover → settings modal) to fetch the usage limit', async () => {
    document.body.innerHTML = `<button aria-label="Settings" id="btn-settings">Settings</button>`;
    Object.defineProperty(document.body, 'innerText', { value: '', configurable: true });

    let subSettingsClicked = false;
    document.getElementById('btn-settings').addEventListener('click', () => {
      const popover = document.createElement('div');
      popover.setAttribute('role', 'dialog');
      popover.id = 'popover-menu';
      popover.innerHTML = `
        <button>Keyboard shortcuts</button>
        <button>Download the app</button>
        <button>Report an issue</button>
        <button id="btn-sub-settings">Settings</button>
      `;
      document.body.appendChild(popover);

      document.getElementById('btn-sub-settings').addEventListener('click', () => {
        subSettingsClicked = true;
        popover.remove();
        const modal = document.createElement('div');
        modal.setAttribute('role', 'dialog');
        modal.innerHTML = `
          <button role="tab" id="tab-general">General</button>
          <button aria-label="Close" id="btn-close">×</button>
        `;
        document.body.appendChild(modal);
        document.getElementById('tab-general').addEventListener('click', () => {
          const content = document.createElement('div');
          content.innerHTML = '<div role="progressbar" aria-valuenow="21"></div><span>21% used</span>';
          modal.appendChild(content);
          Object.defineProperty(document.body, 'innerText', { value: '21% used', configurable: true });
        });
        document.getElementById('btn-close').addEventListener('click', () => modal.remove());
      });
    });

    const res = await window.__MUSE_BRIDGE__.fetchUsageLimit(false, {
      pollIntervalMs: 10,
      maxTabWaitMs: 80,
      maxLimitWaitMs: 80,
      closeWaitMs: 10,
      navWaitMs: 10,
    });
    expect(subSettingsClicked).toBe(true);
    expect(res.used_percent).toBe(21);
    expect(res.remaining_percent).toBe(79);
  });

  it('fetchUsageLimit (Issue #67): also handles popovers without role="dialog" and two-step menus showing "SettingsCtrl+,"', async () => {
    document.body.innerHTML = `<button aria-label="Settings" id="btn-settings">Settings</button>`;
    Object.defineProperty(document.body, 'innerText', { value: '', configurable: true });

    let subSettingsClicked = false;
    document.getElementById('btn-settings').addEventListener('click', () => {
      const popover = document.createElement('div');
      popover.className = 'popover-content';
      popover.innerHTML = `
        <button>Keyboard shortcuts<span>Ctrl+/</span></button>
        <button>Download the app</button>
        <button>Report an issue</button>
        <button id="btn-sub-settings">Settings<span>Ctrl+,</span></button>
      `;
      document.body.appendChild(popover);

      document.getElementById('btn-sub-settings').addEventListener('click', () => {
        subSettingsClicked = true;
        popover.remove();
        const modal = document.createElement('div');
        modal.setAttribute('role', 'dialog');
        modal.innerHTML = `
          <button role="tab" id="tab-general">General</button>
          <button aria-label="Close" id="btn-close">×</button>
        `;
        document.body.appendChild(modal);
        document.getElementById('tab-general').addEventListener('click', () => {
          const content = document.createElement('div');
          content.innerHTML = '<div role="progressbar" aria-valuenow="29"></div><span>29% used</span>';
          modal.appendChild(content);
          Object.defineProperty(document.body, 'innerText', { value: '29% used', configurable: true });
        });
        document.getElementById('btn-close').addEventListener('click', () => modal.remove());
      });
    });

    const res = await window.__MUSE_BRIDGE__.fetchUsageLimit(false, {
      pollIntervalMs: 10,
      maxTabWaitMs: 80,
      maxLimitWaitMs: 80,
      closeWaitMs: 10,
      navWaitMs: 10,
    });
    expect(subSettingsClicked).toBe(true);
    expect(res.used_percent).toBe(29);
    expect(res.remaining_percent).toBe(71);
  });
});
