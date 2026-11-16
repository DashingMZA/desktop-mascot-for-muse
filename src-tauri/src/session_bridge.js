/**
 * session_bridge.js
 *
 * DOM inspection / manipulation script that runs inside the Muse
 * (https://muse.ai/?__pwa=1) session WebView.
 * Per spec §4, §16, and §17, all DOM selectors and remote handling are
 * centralized in this file.
 *
 * Transport: Document Title Bridge (instant messaging + chunked handshake Pull)
 *
 * NOTE ON LANGUAGE: this bridge is English-only. It matches Muse's web UI
 * in English only; if the Muse UI is displayed in another language (e.g.
 * Japanese), the selectors and label matches below will not recognise it.
 */

window.__MUSE_STORE__ = window.__MUSE_STORE__ || {};
window.__MUSE_CACHED_LIMIT__ = window.__MUSE_CACHED_LIMIT__ || null;
window.__MUSE_SESSION_VISIBLE__ = window.__MUSE_SESSION_VISIBLE__ || false;
window.__MUSE_FETCHING_LIMIT__ = window.__MUSE_FETCHING_LIMIT__ || false;

/**
 * §17.2 Multiplexed selector definitions
 * Accessibility attributes (aria-label, placeholder, .sr-only) take top
 * priority; volatile class names (hatch-*, group/msg) are backup candidates.
 * Selectors match Muse's English UI only.
 */
const SELECTORS = {
  avatarVideo: [
    'video[src^="blob:"]',
    'video'
  ],
  messageItems: [
    '[class*="group/msg"]',
    'main [ data-message-id ]'
  ],
  messageBubble: [
    '.prose',
    '[class*="hatch-chat-groupable-bubble"]'
  ],
  chatInput: [
    'textarea[placeholder*="Message"]',
    'textarea[aria-label*="Message"]',
    '[role="textbox"][aria-label*="Message"]',
    'main textarea',
    'textarea:not([readonly])'
  ],
  sendButton: [
    'button[aria-label="Send"]:not([disabled])',
    'button[aria-label*="Send"]:not([disabled])',
    'button[aria-label*="send" i]:not([disabled])',
    'button[type="submit"]:not([disabled])'
  ],
  settingsButton: [
    'button[aria-label*="settings" i]',
    'button[title*="settings" i]',
    'a[aria-label*="settings" i]',
    'a[title*="settings" i]',
    '[role="button"][aria-label*="settings" i]',
    '[data-testid*="settings" i]'
  ],
  chatNavButton: [
    'button[aria-label*="chat" i]',
    'a[aria-label*="chat" i]'
  ],
  modalCloseButton: [
    '[role="dialog"] button[aria-label*="close" i]',
    'button[aria-label*="close" i]'
  ]
};

function queryFirst(candidates, root = document) {
  for (const sel of candidates) {
    try {
      const el = root.querySelector(sel);
      if (el) return { el, selector: sel };
    } catch (_) {}
  }
  return { el: null, selector: null };
}

function queryAllFirst(candidates, root = document) {
  for (const sel of candidates) {
    try {
      const list = Array.from(root.querySelectorAll(sel));
      if (list.length > 0) return { list, selector: sel };
    } catch (_) {}
  }
  // Fallback: parents of elements whose sr-only text is "You:" / "Assistant message:"
  try {
    const srSpans = Array.from(root.querySelectorAll('span.sr-only')).filter(s => {
      const t = (s.textContent || '').trim();
      return t.startsWith('You:') || t.startsWith('Assistant message:');
    });
    if (srSpans.length > 0) {
      return {
        list: srSpans.map(s => s.parentElement).filter(Boolean),
        selector: 'span.sr-only->parentElement'
      };
    }
  } catch (_) {}
  return { list: [], selector: null };
}

/**
 * Detect whether an enabled stop button exists while an answer is being
 * generated (Issue #63).
 * Word boundaries are used to avoid false positives from partial "stop"
 * matches inside unrelated words such as "Desktop".
 */
function findActiveStopButton() {
  const buttons = document.querySelectorAll('button[aria-label], button[title]');
  for (const btn of buttons) {
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.hidden) continue;
    const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(btn) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
    const label = `${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('title') || ''}`.trim();
    if (!label) continue;
    if (/(?:^|[\s_-])stop(?:$|[\s_-])/i.test(label)) {
      return btn;
    }
  }
  return null;
}

function triggerReactClick(el) {
  if (!el) return;
  try { el.click(); } catch (_) {}
  const opts = { bubbles: true, cancelable: true };
  try {
    if (typeof PointerEvent === 'function') {
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
    }
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    if (typeof PointerEvent === 'function') {
      el.dispatchEvent(new PointerEvent('pointerup', opts));
    }
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  } catch (_) {}
  const reactKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  if (reactKey && typeof el[reactKey]?.onClick === 'function') {
    try {
      el[reactKey].onClick({
        preventDefault() {},
        stopPropagation() {},
        currentTarget: el,
        target: el,
        nativeEvent: new MouseEvent('click')
      });
    } catch (_) {}
  }
}

function scanDomForLimit() {
  let planName = '';
  let usedPercent = null;
  let remainingPercent = null;
  let resetText = '';

  const planEl = document.querySelector('span.text-body.text-text-primary, [class*="plan" i]');
  if (planEl) {
    const t = (planEl.textContent || '').trim();
    if (t.includes('Plan') || t.includes('Free') || t.includes('Pro')) {
      planName = t;
    }
  }

  // Detect the percentage from progress-bar attributes (aria-valuenow, style="width: 50%", etc.)
  const progressBars = Array.from(document.querySelectorAll('[role="progressbar"], [class*="progress" i]'));
  for (const bar of progressBars) {
    let p = null;
    const valNow = bar.getAttribute('aria-valuenow');
    if (valNow !== null && !isNaN(parseInt(valNow, 10))) {
      p = Math.max(0, Math.min(100, parseInt(valNow, 10)));
    } else {
      const wMatch = (bar.getAttribute('style') || '').match(/width\s*:\s*(\d+(?:\.\d+)?)\s*%/i);
      if (wMatch) {
        p = Math.round(parseFloat(wMatch[1]));
      }
    }

    if (p !== null) {
      const container = bar.closest('[role="dialog"], [class*="modal" i], div');
      const parentTxt = (container?.innerText || container?.textContent || '').toLowerCase();
      if (parentTxt.includes('left') || parentTxt.includes('remaining')) {
        remainingPercent = p;
        usedPercent = 100 - p;
      } else {
        usedPercent = p;
        remainingPercent = Math.max(0, 100 - p);
      }
      break;
    }
  }

  // Prefer judging from the combined text (innerText or textContent) — handles cases where React splits "56%" and "used" across separate nodes
  const allText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
  if (allText) {
    if (usedPercent === null) {
      const mUsed = allText.match(/(\d+(?:\.\d+)?)\s*%\s*(?:used|consumed)/i);
      if (mUsed) {
        usedPercent = Math.round(parseFloat(mUsed[1]));
        if (remainingPercent === null) {
          remainingPercent = Math.max(0, 100 - usedPercent);
        }
      }
    }
    if (remainingPercent === null) {
      const mRem1 = allText.match(/(?:remaining|left)\s*:?\s*(\d+(?:\.\d+)?)\s*%/i);
      const mRem2 = allText.match(/(\d+(?:\.\d+)?)\s*%\s*(?:remaining|left)/i);
      if (mRem1) {
        remainingPercent = Math.round(parseFloat(mRem1[1]));
        if (usedPercent === null) usedPercent = Math.max(0, 100 - remainingPercent);
      } else if (mRem2) {
        remainingPercent = Math.round(parseFloat(mRem2[1]));
        if (usedPercent === null) usedPercent = Math.max(0, 100 - remainingPercent);
      }
    }
    if (!resetText) {
      const mReset = allText.match(/((?:weekly limit\s+)?resets?\s+on\s+[^\n.]+|will\s+reset\s+[^\n.]+|reset\s*:?\s*[^\n.]+)/i);
      if (mReset) {
        resetText = mReset[1].trim();
      }
    }
  }

  // Backup: walk individual text nodes (TreeWalker)
  if ((usedPercent === null || remainingPercent === null || !resetText) && document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const txt = (node.textContent || '').trim();
      if (!txt) continue;
      if (usedPercent === null) {
        const matchUsed = txt.match(/(\d+(?:\.\d+)?)\s*%\s*(?:used|consumed)/i);
        if (matchUsed) {
          usedPercent = Math.round(parseFloat(matchUsed[1]));
          if (remainingPercent === null) remainingPercent = Math.max(0, 100 - usedPercent);
        }
      }
      if (remainingPercent === null) {
        const matchRem1 = txt.match(/(?:remaining|left)\s*:?\s*(\d+(?:\.\d+)?)\s*%/i);
        const matchRem2 = txt.match(/(\d+(?:\.\d+)?)\s*%\s*(?:remaining|left)/i);
        if (matchRem1) {
          remainingPercent = Math.round(parseFloat(matchRem1[1]));
          if (usedPercent === null) usedPercent = Math.max(0, 100 - remainingPercent);
        } else if (matchRem2) {
          remainingPercent = Math.round(parseFloat(matchRem2[1]));
          if (usedPercent === null) usedPercent = Math.max(0, 100 - remainingPercent);
        }
      }
      if (!resetText) {
        const matchReset = txt.match(/((?:weekly limit\s+)?resets?\s+on\s+[^\n.]+|will\s+reset\s+[^\n.]+|reset\s*:?\s*[^\n.]+)/i);
        if (matchReset) resetText = matchReset[1].trim();
      }
    }
  }

  if (remainingPercent !== null || usedPercent !== null || planName || resetText) {
    return {
      plan_name: planName || 'Free Plan',
      used_percent: usedPercent,
      remaining_percent: remainingPercent,
      reset_text: resetText || ''
    };
  }
  return null;
}

function findGeneralTab() {
  // 1. Prefer explicit tab / menu / button elements whose text is "General"
  const interactiveCandidates = Array.from(
    document.querySelectorAll('[role="tab"], [role="menuitem"], button, a, [role="button"]')
  );
  const exactInteractive = interactiveCandidates.find(t => {
    const txt = (t.textContent || '').trim();
    return /^general$/i.test(txt);
  });
  if (exactInteractive) return exactInteractive;

  // 2. Leaf elements with no children (to avoid misclicking a parent container) whose text is "General"
  const leafCandidates = Array.from(
    document.querySelectorAll('button, a, [role="tab"], [role="menuitem"], [role="button"], div, span')
  );
  const exactLeaf = leafCandidates.find(t => {
    if (t.children.length > 0) return false;
    const txt = (t.textContent || '').trim();
    return /^general$/i.test(txt);
  });
  return exactLeaf || null;
}

/**
 * Detect the "Settings" item inside the popover menu that opens after
 * clicking the first-level Settings button (Issue #63, #67).
 * Also handles shortcut notation (e.g. "SettingsCtrl+,") and
 * popovers without role="dialog".
 */
function findSettingsSubmenuItem(excludeEl) {
  const isMatch = (el) => {
    if (!el || el === excludeEl) return false;
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt) return false;
    return /^settings(?:\s*(?:ctrl|cmd|command|alt|shift|meta|⌘|⌥|⌃|⇧)[^\n]{0,12})?$/i.test(txt);
  };

  const scopes = Array.from(
    document.querySelectorAll('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]')
  );
  for (const scope of scopes) {
    const candidates = Array.from(
      scope.querySelectorAll('[role="menuitem"], button, a, [role="button"]')
    );
    const found = candidates.find(isMatch);
    if (found) return found;
  }

  // Fallback: detect from all menu items / buttons even when the popover has no role="dialog" / "menu"
  const fallbackCandidates = Array.from(
    document.querySelectorAll('[role="menuitem"], button, a, [role="button"]')
  );
  return fallbackCandidates.find(isMatch) || null;
}

// Passive watch: automatically cache the usage limit when the user or a script opens "Settings > General" (Issue #49)
if (!window.__MUSE_PASSIVE_WATCHER__) {
  window.__MUSE_PASSIVE_WATCHER__ = setInterval(() => {
    try {
      const detected = scanDomForLimit();
      if (detected && (detected.used_percent !== null || detected.remaining_percent !== null)) {
        window.__MUSE_CACHED_LIMIT__ = detected;
      }
    } catch (_) {}
  }, 1000);
}

window.__MUSE_BRIDGE__ = {
  /**
   * Extract the avatar name (e.g. "Lucky")
   */
  extractAvatarName() {
    try {
      // 1. Look for the line just before "Linked" in an ancestor container of the <video>
      const { el: video } = queryFirst(SELECTORS.avatarVideo);
      let curr = video ? video.parentElement : null;
      for (let depth = 0; depth < 6 && curr; depth++) {
        const lines = (curr.innerText || '')
          .split(/\n+/)
          .map(s => s.trim())
          .filter(s => s.length > 0 && s.length <= 24);
        const linkIdx = lines.findIndex(l => l.includes('Linked'));
        if (linkIdx > 0) {
          const candidate = lines[linkIdx - 1];
          if (candidate && !candidate.includes('Invite') && !candidate.includes('Chat')) {
            window.__MUSE_CACHED_AVATAR_NAME__ = candidate;
            return candidate;
          }
        }
        curr = curr.parentElement;
      }

      // 2. Search from the parent of a "Linked" element on the page
      const allEls = Array.from(document.querySelectorAll('span, div, p'));
      const linkEl = allEls.find(e => e.children.length === 0 && (e.textContent || '').trim() === 'Linked');
      if (linkEl) {
        let p = linkEl.parentElement;
        for (let d = 0; d < 4 && p; d++) {
          const lines = (p.innerText || '')
            .split(/\n+/)
            .map(s => s.trim())
            .filter(s => s.length > 0 && s.length <= 24);
          const idx = lines.findIndex(l => l.includes('Linked'));
          if (idx > 0) {
            window.__MUSE_CACHED_AVATAR_NAME__ = lines[idx - 1];
            return lines[idx - 1];
          }
          p = p.parentElement;
        }
      }
    } catch (_) {}
    return window.__MUSE_CACHED_AVATAR_NAME__ || null;
  },

  /**
   * Real-time avatar state determination (Issue #10)
   * Matches directly against the status of Muse's own avatar component and
   * the Blob size of the video currently playing
   */
  async getAvatarState() {
    try {
      window.__MUSE_BLOB_STATE_MAP__ = window.__MUSE_BLOB_STATE_MAP__ || {};

      const v =
        document.querySelector('video[data-hatch-media-owner="avatar-layer"][data-hatch-avatar-slot="current"]') ||
        document.querySelector('video[data-hatch-media-owner="avatar-layer"]') ||
        queryFirst(SELECTORS.avatarVideo).el;

      // 1. If React Fiber / Props carry an explicit status value, use it first
      const validStates = new Set([
        'idle',
        'connecting',
        'waking',
        'working',
        'waiting_for_subagent',
        'making_something',
        'milestone_level_up'
      ]);

      const normalizeState = (raw) => {
        if (!raw || typeof raw !== 'string') return null;
        const s = raw.trim().toLowerCase();
        if (!validStates.has(s)) return null;
        if (s === 'connecting') return 'idle';
        if (s === 'waiting_for_subagent') return 'working';
        return s;
      };

      let fiberState = null;
      let curr = v;
      for (let depth = 0; depth < 8 && curr && !fiberState; depth++) {
        const keys = Object.keys(curr);
        for (const k of keys) {
          if (k.startsWith('__reactProps$') || k.startsWith('__reactFiber$')) {
            const obj = curr[k];
            const props = obj?.memoizedProps || obj?.pendingProps || obj;
            if (props && typeof props === 'object') {
              for (const pk of ['state', 'status', 'avatarState', 'avatarStatus', 'mode', 'phase', 'animation']) {
                const mapped = normalizeState(props[pk]);
                if (mapped) {
                  fiberState = mapped;
                  break;
                }
              }
            }
          }
        }
        curr = curr.parentElement;
      }

      // 2. Get the status text under the avatar (e.g. "🛠️ is working", "Linked") (Issue #35)
      let statusText = '';
      let statusEl = null;

      // Exclusion guard so text is not mistakenly picked up from chat body / input elements (Issue #42)
      const isInsideChat = (el) => {
        if (!el) return false;
        return !!el.closest('main, [class*="chat" i], [class*="prose" i], [class*="group/msg" i], [role="log"], textarea');
      };

      const STATUS_TEXT_REGEX = /working|thinking|making|creating|building|generating|searching|running|waiting|ready|idle|online|connected|linked|drawing|rendering|researching|checking|replying|offline/i;

      // Priority search: look for the status string inside the container nearest to avatar video v, or near the avatar name (fixed XPaths have all been removed)
      try {
        const rootContainer = v ? (v.closest('[class*="avatar" i], [class*="dock" i], [class*="header" i], aside') || v.parentElement) : document.body;
        const candidates = Array.from(rootContainer.querySelectorAll('span, div, p')).filter(e => {
          if (e.children.length > 0) return false;
          if (isInsideChat(e)) return false;
          const t = (e.textContent || '').trim();
          if (t.length === 0 || t.length > 20) return false;
          return STATUS_TEXT_REGEX.test(t);
        });
        if (candidates.length > 0) {
          statusEl = candidates[0];
          statusText = (statusEl.textContent || '').trim();
        }
      } catch (_) {}

      // Also search statusEl's own React Fiber / Props
      if (statusEl && !fiberState) {
        let sc = statusEl;
        for (let depth = 0; depth < 6 && sc && !fiberState; depth++) {
          const keys = Object.keys(sc);
          for (const k of keys) {
            if (k.startsWith('__reactProps$') || k.startsWith('__reactFiber$')) {
              const obj = sc[k];
              const props = obj?.memoizedProps || obj?.pendingProps || obj;
              if (props && typeof props === 'object') {
                for (const pk of ['state', 'status', 'avatarState', 'avatarStatus', 'mode', 'phase', 'animation']) {
                  const mapped = normalizeState(props[pk]);
                  if (mapped) {
                    fiberState = mapped;
                    break;
                  }
                }
              }
            }
          }
          sc = sc.parentElement;
        }
      }

      // Parent-element fallback (stop immediately on reaching an ancestor that contains the chat area, to prevent mistakenly extracting body text)
      if (!statusText && v) {
        let p = v.parentElement;
        for (let d = 0; d < 6 && p; d++) {
          if (
            isInsideChat(p) ||
            p.querySelector('main, [class*="chat" i], [class*="prose" i], [class*="group/msg" i], [role="log"], textarea')
          ) {
            break;
          }
          const lines = (p.innerText || '')
            .split(/\n+/)
            .map(s => s.trim())
            .filter(s => s.length > 0 && s.length <= 24 && STATUS_TEXT_REGEX.test(s));
          if (lines.length > 0) {
            statusText = lines[lines.length - 1];
            break;
          }
          p = p.parentElement;
        }
      }

      if (fiberState) {
        return { state: fiberState, statusText, source: 'fiber' };
      }

      // 3. If the status text clearly indicates an idle state such as "Linked", map to idle; if it indicates activity, map to the matching state
      const mapStatusTextToState = (txt) => {
        if (!txt) return null;
        const t = txt.trim();
        const lower = t.toLowerCase();
        if (validStates.has(lower)) {
          return normalizeState(lower);
        }
        if (t === 'Linked' || t === 'Online' || t === 'Waiting' || /linked|online|idle|ready|connected/i.test(t)) {
          return 'idle';
        }
        if (/waking/i.test(t)) {
          return 'waking';
        }
        if (/milestone|level.?up|celebrat|achievement/i.test(t)) {
          return 'milestone_level_up';
        }
        if (/making|creating|building|generating|code|file/i.test(t)) {
          return 'making_something';
        }
        if (/working|thinking|searching|waiting|running|replying|researching|checking|subagent/i.test(t)) {
          return 'working';
        }
        // Any other status text being shown is treated as working
        return 'working';
      };

      const textMappedState = mapStatusTextToState(statusText);

      // 4. Identify the 5 MP4 types with 100% certainty from the byte size of the currently playing <video src="blob:...">
      //    - waking.mp4:             262,753 bytes
      //    - working.mp4:            369,723 bytes
      //    - making_something.mp4:   406,030 bytes
      //    - idle.mp4:               564,061 bytes
      //    - milestone_level_up.mp4: 595,491 bytes
      const currentBlob = v ? (v.currentSrc || v.src || '') : '';
      if (currentBlob && currentBlob.startsWith('blob:')) {
        if (!window.__MUSE_BLOB_STATE_MAP__[currentBlob]) {
          try {
            const resp = await fetch(currentBlob);
            if (resp.ok) {
              const blob = await resp.blob();
              const size = blob.size;
              let detected = 'idle';
              if (size > 0 && size < 310000) {
                detected = 'waking';
              } else if (size >= 310000 && size < 390000) {
                detected = 'working';
              } else if (size >= 390000 && size < 480000) {
                detected = 'making_something';
              } else if (size >= 480000 && size < 580000) {
                detected = 'idle';
              } else if (size >= 580000) {
                detected = 'milestone_level_up';
              }
              window.__MUSE_BLOB_STATE_MAP__[currentBlob] = { state: detected, size };
            }
          } catch (_) {}
        }

        const cached = window.__MUSE_BLOB_STATE_MAP__[currentBlob];
        if (cached && cached.state) {
          // Even if the video Blob is idle, prefer the status display when the status text clearly indicates activity (anything other than "Linked")
          if (cached.state === 'idle' && textMappedState && textMappedState !== 'idle') {
            return {
              state: textMappedState,
              blobSize: cached.size,
              statusText,
              source: 'xpath_status_override'
            };
          }
          return {
            state: cached.state,
            blobSize: cached.size,
            statusText,
            source: 'blob_size'
          };
        }
      }

      if (textMappedState) {
        return { state: textMappedState, statusText, source: 'xpath_status' };
      }

      return { state: 'idle', statusText, source: 'default' };
    } catch (_) {
      return { state: 'idle', source: 'error' };
    }
  },

  /**
   * §17.3 Startup / periodic health check (selector liveness for R1 / R2 / R3 / R5 + avatar name + avatar state)
   */
  async checkHealth() {
    const vFound = queryFirst(SELECTORS.avatarVideo);
    const mFound = queryAllFirst(SELECTORS.messageItems);
    const iFound = queryFirst(SELECTORS.chatInput);
    const sFound = queryFirst(SELECTORS.settingsButton);
    const avatarName = this.extractAvatarName();
    const avatarStateInfo = await this.getAvatarState();

    return {
      avatar_name: avatarName,
      avatar_state: avatarStateInfo.state,
      avatar_src: vFound.el ? (vFound.el.currentSrc || vFound.el.src || '') : '',
      r1_avatar: {
        ok: !!(vFound.el && (vFound.el.currentSrc || vFound.el.src)),
        selector: vFound.selector || 'none'
      },
      r2_messages: {
        ok: mFound.list.length > 0 || !!iFound.el,
        count: mFound.list.length,
        selector: mFound.selector || 'none'
      },
      r3_input: {
        ok: !!iFound.el,
        selector: iFound.selector || 'none'
      },
      r5_limit: {
        ok: !!sFound.el || !!window.__MUSE_CACHED_LIMIT__,
        cached: !!window.__MUSE_CACHED_LIMIT__,
        selector: sFound.selector || 'none'
      }
    };
  },

  /**
   * 1. Get the avatar video (R1) as a Base64 Data URL
   */
  async getAvatarVideoBase64() {
    const { el: video } = queryFirst(SELECTORS.avatarVideo);
    if (!video) {
      throw new Error("UNSUPPORTED_DOM: Avatar video element not found");
    }
    const src = video.currentSrc || video.src;
    if (!src) {
      throw new Error("UNSUPPORTED_DOM: Avatar video src is empty");
    }

    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch video blob: ${response.status}`);
    }
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error("Failed to convert video blob to Data URL"));
        }
      };
      reader.onerror = () => reject(reader.error || new Error("FileReader error"));
      reader.readAsDataURL(blob);
    });
  },

  /**
   * 2. Read the main chat's message list (R2)
   */
  async getMessages(limit = 5) {
    const { list: messageEls } = queryAllFirst(SELECTORS.messageItems);
    const { el: inputEl } = queryFirst(SELECTORS.chatInput);

    // If neither messages nor the input field is found, the user is not logged in or the screen structure is unsupported
    if (messageEls.length === 0 && !inputEl) {
      throw new Error("UNSUPPORTED_OR_UNAUTH: Main chat screen structure not found");
    }

    // For extracting options (quick replies / suggestion buttons) (Issue #32)
    const systemKeywords = [
      'good', 'bad', 'copy', 'option',
      'details', 'like', 'dislike', 'rating',
      'edit', 'share', 'delete', 'retry', 'regenerate', 'feedback', 'menu', 'close'
    ];

    const extractOptions = (el) => {
      if (!el) return [];
      const btnEls = Array.from(el.querySelectorAll('button, [role="button"], [class*="suggestion" i], [class*="chip" i], [class*="choice" i]'));
      const opts = [];

      for (const b of btnEls) {
        if (b.parentElement && b.parentElement.closest('button, [role="button"]')) continue;

        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const title = (b.getAttribute('title') || '').toLowerCase();
        const srEl = b.querySelector('.sr-only');
        const sr = srEl ? (srEl.textContent || '').toLowerCase() : '';

        const isSystem = systemKeywords.some(kw => aria.includes(kw) || title.includes(kw) || sr.includes(kw));
        if (isSystem) continue;

        const clone = b.cloneNode(true);
        clone.querySelectorAll('svg, i, .sr-only, [class*="icon" i]').forEach(node => node.remove());
        const label = (clone.textContent || '').replace(/^[\s\uFEFF\xA0\u3000]+|[\s\uFEFF\xA0\u3000]+$/g, '').trim();

        if (label.length >= 1 && label.length <= 120) {
          if (systemKeywords.some(kw => label.toLowerCase() === kw)) continue;
          if (!opts.includes(label)) {
            opts.push(label);
          }
        }
      }
      return opts;
    };

    const messages = [];

    for (const el of messageEls) {
      const srEl = el.querySelector('.sr-only');
      const srText = srEl ? (srEl.textContent || '').trim() : '';
      const hasProse = !!el.querySelector('.prose');
      const rawElText = (el.innerText || '').trim();
      const isUser = srText.startsWith('You:') || (!hasProse && rawElText.startsWith('You:'));
      const role = isUser ? 'user' : 'assistant';

      const { el: bubbleEl } = queryFirst(SELECTORS.messageBubble, el);
      let rawText = bubbleEl ? (bubbleEl.innerText || '') : rawElText;
      if (!isUser) {
        const mascotCodeEl = (bubbleEl || el).querySelector('code[class*="mascot-quotes" i], pre[class*="mascot-quotes" i], [data-language="mascot-quotes" i]');
        if (mascotCodeEl && !rawText.includes('mascot-quotes')) {
          const fence = '\x60\x60\x60';
          rawText = fence + 'mascot-quotes\n' + (mascotCodeEl.innerText || mascotCodeEl.textContent || '') + '\n' + fence;
        }
      }

      let text = rawText
        .replace(/^(You:|Assistant message:)\s*/i, '')
        .replace(/^[\s\uFEFF\xA0\u3000]+/g, '')
        .replace(/[\s\uFEFF\xA0\u3000]+$/g, '')
        .replace(/^[ \t\u3000]+/gm, '')
        .trim();

      // Extract options inside an assistant reply (Issue #32)
      let options = [];
      if (!isUser) {
        options = extractOptions(el);
        // Clean up if button text leaked into the end of the body text
        for (const opt of [...options].reverse()) {
          if (text.endsWith(opt)) {
            text = text.slice(0, -opt.length).trim();
          }
        }
      }

      if (text.length > 0) {
        const msgObj = { role, text };
        if (options.length > 0) {
          msgObj.options = options;
        }
        messages.push(msgObj);
      }
    }

    const parsedLimit = Number(limit) || 5;
    return messages.slice(-parsedLimit);
  },

  /**
   * 2.1 Inspect the latest message and video / link details (Issue #10)
   */
  async inspectLatestMessage() {
    const { list: messageEls } = queryAllFirst(SELECTORS.messageItems);
    if (messageEls.length === 0) {
      return { error: "No messages found" };
    }

    // Also search across all messages for video / material-related elements
    const targetMsg = messageEls[messageEls.length - 1];
    
    // Identify any message containing material-related keywords, if one exists
    const materialMsg = messageEls.slice().reverse().find(m => {
      const t = m.innerText || '';
      return t.includes('material') || t.includes('7 patterns') || t.includes('MP4') || t.includes('idle');
    }) || targetMsg;

    function extractMedia(el) {
      if (!el) return {};
      const links = Array.from(el.querySelectorAll('a')).map(a => ({
        href: a.href,
        text: (a.textContent || '').trim(),
        download: a.getAttribute('download') || '',
        title: a.title || ''
      }));

      const videos = Array.from(el.querySelectorAll('video')).map(v => ({
        src: v.src || '',
        currentSrc: v.currentSrc || '',
        poster: v.poster || ''
      }));

      const images = Array.from(el.querySelectorAll('img')).map(img => ({
        src: img.src || '',
        alt: img.alt || ''
      }));

      const buttons = Array.from(el.querySelectorAll('button')).map(b => ({
        ariaLabel: b.getAttribute('aria-label') || '',
        text: (b.textContent || '').trim(),
        title: b.title || '',
        className: b.className || ''
      }));

      // Card / container elements
      const cards = Array.from(el.querySelectorAll('[class*="card"], [class*="media"], [class*="asset"], [data-testid]')).map(c => ({
        tag: c.tagName,
        className: c.className || '',
        dataTestId: c.getAttribute('data-testid') || '',
        text: (c.textContent || '').slice(0, 50)
      }));

      return { links, videos, images, buttons, cards };
    }

    const latestMedia = extractMedia(targetMsg);
    const materialMedia = extractMedia(materialMsg);

    // Attribute details for the avatar element and its parent containers
    const v = document.querySelector('video[data-hatch-media-owner="avatar-layer"]') || document.querySelector('video');
    const avatarDomInfo = v ? {
      src: v.src,
      currentSrc: v.currentSrc,
      attrs: Array.from(v.attributes).map(a => `${a.name}="${a.value}"`),
      parentAttrs: v.parentElement ? Array.from(v.parentElement.attributes).map(a => `${a.name}="${a.value}"`) : [],
      gpAttrs: v.parentElement?.parentElement ? Array.from(v.parentElement.parentElement.attributes).map(a => `${a.name}="${a.value}"`) : []
    } : null;

    // List of buttons on screen (for identifying the send / stop button)
    const allButtons = Array.from(document.querySelectorAll('button')).map(b => ({
      ariaLabel: b.getAttribute('aria-label') || '',
      type: b.type || '',
      text: (b.textContent || '').trim().slice(0, 30),
      disabled: b.disabled,
      cls: (b.className || '').slice(0, 40)
    })).filter(b => b.ariaLabel || b.text || b.cls.includes('send') || b.cls.includes('submit'));

    const recent = messageEls.slice(-5).map(m => {
      const sr = m.querySelector('.sr-only');
      const role = sr && (sr.textContent || '').includes('You') ? 'user' : 'assistant';
      return {
        role,
        text: (m.innerText || '').trim()
      };
    });

    return {
      avatarDomInfo,
      allButtons,
      latest: {
        text: (targetMsg.innerText || '').trim(),
        media: latestMedia
      },
      materialMessage: {
        text: (materialMsg.innerText || '').trim(),
        media: materialMedia
      },
      recent
    };
  },

  /**
   * 3. Type and send a message in the main chat (R3) + failure detection (§4)
   */
  async sendMessage(text) {
    if (!text || typeof text !== 'string') {
      throw new Error("Message text is empty");
    }

    const { el: ta } = queryFirst(SELECTORS.chatInput);
    if (!ta) {
      throw new Error("UNSUPPORTED_DOM: Unsupported screen structure (input field not found)");
    }

    const beforeCount = queryAllFirst(SELECTORS.messageItems).list.length;

    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (valueSetter) {
      valueSetter.call(ta, text);
    } else {
      ta.value = text;
    }

    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 180));

    const isStopButton = (btn) => {
      if (!btn) return false;
      const label = (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.textContent || '').toLowerCase();
      const cls = (btn.className || '').toLowerCase();
      return label.includes('stop') || label.includes('cancel') || label.includes('interrupt') || cls.includes('stop');
    };

    const { el: sendBtn } = queryFirst(SELECTORS.sendButton);
    if (sendBtn && !isStopButton(sendBtn)) {
      sendBtn.click();
    } else {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

    // §4 failure detection: after sending, check whether the input was cleared or the message count increased
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 150));
      const afterCount = queryAllFirst(SELECTORS.messageItems).list.length;
      const currentVal = (ta.value || '').trim();
      if (afterCount > beforeCount || currentVal === '') {
        return { success: true, verified: true, textSent: text };
      }
    }

    throw new Error("SEND_VERIFY_FAILED: Could not confirm the message was reflected after sending");
  },

  /**
   * 4. Get the window limit (usage limit) (R5, §16 guardrail support, Issue #49 polling-wait strengthening)
   * @param {boolean} passiveOnly if true, never navigate screens (no Settings click) (guardrail ①)
   * @param {object} options polling interval / max wait options (for tests and tuning)
   */
  scanDomForLimit,

  async fetchUsageLimit(passiveOnly = false, options = {}) {
    const isSessionVisible = () => {
      if (window.__MUSE_SESSION_VISIBLE__ === true) return true;
      if (options?.respectDocumentFocus && typeof document.hasFocus === 'function' && document.hasFocus()) {
        return true;
      }
      return false;
    };

    const isDialogOpen = () => {
      return !!document.querySelector('[role="dialog"]') || !!queryFirst(SELECTORS.modalCloseButton).el;
    };

    const setTrace = (trace) => {
      window.__MUSE_LAST_LIMIT_TRACE__ = trace;
    };

    // 1. First scan the current screen
    const immediate = scanDomForLimit();
    if (immediate && (immediate.remaining_percent !== null || immediate.used_percent !== null)) {
      window.__MUSE_CACHED_LIMIT__ = immediate;
      setTrace(`immediate_hit(used=${immediate.used_percent},rem=${immediate.remaining_percent})`);
      return immediate;
    }

    const fallbackResult = (reason = 'unknown') => {
      const base = window.__MUSE_CACHED_LIMIT__ || immediate || {
        plan_name: 'Free Plan',
        used_percent: null,
        remaining_percent: null,
        reset_text: 'Auto-fetched from the session screen under [Settings > General]'
      };
      const cacheTag = window.__MUSE_CACHED_LIMIT__ ? 'cached' : (immediate ? 'immediate_partial' : 'empty');
      setTrace(`${reason}:${cacheTag}`);
      return base;
    };

    const pollIntervalMs = Math.max(10, Number(options?.pollIntervalMs) || 100);
    const maxTabWaitMs = Math.max(pollIntervalMs, Number(options?.maxTabWaitMs) || 1000);
    const maxLimitWaitMs = Math.max(pollIntervalMs, Number(options?.maxLimitWaitMs) || 3000);
    const closeWaitMs = Math.max(10, Number(options?.closeWaitMs) || 200);
    const navWaitMs = Math.max(10, Number(options?.navWaitMs) || 250);

    // Guardrail: if a dialog is already open when starting, the user is operating it, so never close it — only read the values (Issue #49)
    if (isDialogOpen()) {
      if (!passiveOnly) {
        const passiveSteps = Math.ceil(maxTabWaitMs / pollIntervalMs);
        for (let i = 0; i < passiveSteps; i++) {
          await new Promise(r => setTimeout(r, pollIntervalMs));
          const scanned = scanDomForLimit();
          if (scanned && (scanned.used_percent !== null || scanned.remaining_percent !== null)) {
            window.__MUSE_CACHED_LIMIT__ = scanned;
            setTrace('dialog_open_scanned');
            return scanned;
          }
        }
      }
      const dlgEl = document.querySelector('[role="dialog"]');
      const dlgSnap = dlgEl ? (dlgEl.innerText || dlgEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : 'no_role_dialog';
      return fallbackResult(`dialog_open_fallback(snap=${dlgSnap})`);
    }

    // Guardrail ①: suppress automatic navigation / Escape sending while the session WebView is visible, the AI is generating an answer, or another request is running (Issue #34, #49)
    const stopBtn = findActiveStopButton();
    const isGenerating = !!stopBtn;
    if (passiveOnly || isGenerating || isSessionVisible() || window.__MUSE_FETCHING_LIMIT__) {
      const stopLabel = stopBtn ? (stopBtn.getAttribute('aria-label') || stopBtn.getAttribute('title') || '').slice(0, 32) : '';
      return fallbackResult(`guard_skip(passive=${!!passiveOnly},gen=${isGenerating},vis=${isSessionVisible()},busy=${!!window.__MUSE_FETCHING_LIMIT__}${stopLabel ? `,stop=${stopLabel}` : ''})`);
    }

    window.__MUSE_FETCHING_LIMIT__ = true;
    try {
      // 2. When hidden, open "Settings > General" to check, then explicitly return to the main chat per guardrail ③
      const { el: settingsBtn, selector: settingsSel } = queryFirst(SELECTORS.settingsButton);
      if (settingsBtn) {
        const sBtnDesc = (settingsBtn.getAttribute('aria-label') || settingsBtn.getAttribute('title') || settingsBtn.textContent || '').trim().slice(0, 30);
        triggerReactClick(settingsBtn);

        // After clicking Settings, poll up to maxTabWaitMs for the "General" tab or the usage limit to finish rendering (Issue #49, #63)
        // Also supports the two-step menu (Settings button → Settings item in the popover → settings modal)
        let afterClick = null;
        let generalTab = null;
        let clickedSubSettings = false;
        const tabMaxSteps = Math.ceil(maxTabWaitMs / pollIntervalMs);
        for (let i = 0; i < tabMaxSteps; i++) {
          await new Promise(r => setTimeout(r, pollIntervalMs));
          // If the user shows the session screen during polling, abort immediately and never close it on our own
          if (isSessionVisible()) {
            if (afterClick) {
              setTrace('aborted_visible_tab_wait');
              return afterClick;
            }
            return fallbackResult('aborted_visible_tab_wait');
          }
          afterClick = scanDomForLimit();
          if (afterClick && (afterClick.used_percent !== null || afterClick.remaining_percent !== null)) {
            break;
          }
          generalTab = findGeneralTab();
          if (generalTab) {
            triggerReactClick(generalTab);
            break;
          }
          if (!clickedSubSettings) {
            const subSettings = findSettingsSubmenuItem(settingsBtn);
            if (subSettings) {
              triggerReactClick(subSettings);
              clickedSubSettings = true;
            }
          }
        }

        // If the usage limit still has not been fetched, poll up to maxLimitWaitMs for the async API call / DOM rendering to finish (Issue #49)
        if (!afterClick || (afterClick.used_percent === null && afterClick.remaining_percent === null)) {
          const limitMaxSteps = Math.ceil(maxLimitWaitMs / pollIntervalMs);
          for (let i = 0; i < limitMaxSteps; i++) {
            await new Promise(r => setTimeout(r, pollIntervalMs));
            if (isSessionVisible()) {
              if (afterClick) {
                setTrace('aborted_visible_limit_wait');
                return afterClick;
              }
              return fallbackResult('aborted_visible_limit_wait');
            }
            afterClick = scanDomForLimit();
            if (afterClick && (afterClick.used_percent !== null || afterClick.remaining_percent !== null)) {
              break;
            }
            if (!generalTab) {
              generalTab = findGeneralTab();
              if (generalTab) {
                triggerReactClick(generalTab);
              } else if (!clickedSubSettings) {
                const subSettings = findSettingsSubmenuItem(settingsBtn);
                if (subSettings) {
                  triggerReactClick(subSettings);
                  clickedSubSettings = true;
                }
              }
            }
          }
        }

        // Re-check session visibility just before closing (never close a screen the user opened)
        if (isSessionVisible()) {
          if (afterClick && (afterClick.used_percent !== null || afterClick.remaining_percent !== null)) {
            window.__MUSE_CACHED_LIMIT__ = afterClick;
            setTrace('aborted_visible_before_close');
            return afterClick;
          }
          return fallbackResult('aborted_visible_before_close');
        }

        // Diagnostic snapshot on failure (taken before closing the modal)
        let failDiag = '';
        if (!afterClick || (afterClick.used_percent === null && afterClick.remaining_percent === null)) {
          const dlg = document.querySelector('[role="dialog"]');
          const scope = dlg || document.querySelector('[role="menu"], [role="tablist"]') || document;
          const items = Array.from(scope.querySelectorAll('[role="tab"], [role="menuitem"], button, a'))
            .map(el => (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '))
            .filter(Boolean)
            .slice(0, 12);
          failDiag = `,sel=${settingsSel},btn=${sBtnDesc},dlg=${!!dlg},items=[${items.join('|')}]`.slice(0, 220);
        }

        // §16 guardrail ③: do not rely on Escape alone — return explicitly to the main chat via the close button + Escape + chat navigation
        const { el: closeBtn } = queryFirst(SELECTORS.modalCloseButton);
        if (closeBtn) {
          triggerReactClick(closeBtn);
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
        await new Promise(r => setTimeout(r, closeWaitMs));

        // If the main chat input is not visible, explicitly click the "Chat" button in the left dock
        if (!isSessionVisible()) {
          const { el: inputAfter } = queryFirst(SELECTORS.chatInput);
          if (!inputAfter) {
            const { el: chatNav } = queryFirst(SELECTORS.chatNavButton);
            if (chatNav) {
              triggerReactClick(chatNav);
              await new Promise(r => setTimeout(r, navWaitMs));
            }
          }
        }

        if (afterClick && (afterClick.used_percent !== null || afterClick.remaining_percent !== null)) {
          window.__MUSE_CACHED_LIMIT__ = afterClick;
          setTrace(`modal_ok(general=${!!generalTab},used=${afterClick.used_percent},rem=${afterClick.remaining_percent})`);
          return afterClick;
        }
        return fallbackResult(`modal_no_limit(general=${!!generalTab}${failDiag})`);
      }

      return fallbackResult('no_settings_btn');
    } finally {
      window.__MUSE_FETCHING_LIMIT__ = false;
    }
  },

  /**
   * Chat screen readiness and URL-match check (Issue #46)
   */
  async checkChatReady(expectedUrl) {
    const getNormPath = (u) => {
      try {
        const parsed = new URL(u);
        return (parsed.origin + parsed.pathname).replace(/\/+$/, '').toLowerCase();
      } catch (_) {
        return (u || '').trim().split('?')[0].split('#')[0].replace(/\/+$/, '').toLowerCase();
      }
    };
    const currentNorm = getNormPath(window.location.href);
    const { el: ta } = queryFirst(SELECTORS.chatInput);
    const docReady = document.readyState === 'complete' || document.readyState === 'interactive';
    const ready = docReady && !!ta && !ta.disabled;

    let urlMatched = true;
    if (expectedUrl) {
      const expNorm = getNormPath(expectedUrl);
      urlMatched = currentNorm === expNorm;
    }

    return {
      ready,
      urlMatched,
      currentUrl: window.location.href
    };
  },

  /**
   * DOM safety check before running an automatic reload (Issue #52)
   * - isGenerating: is an answer being generated (stop button showing)?
   * - hasDraft: is there an unsent draft left in the session input field?
   * - isDialogOpen: is a modal such as Settings open?
   */
  inspectReloadSafety() {
    const isGenerating = !!findActiveStopButton();
    const { el: ta } = queryFirst(SELECTORS.chatInput);
    let draftText = '';
    if (ta) {
      if ('value' in ta && typeof ta.value === 'string') {
        draftText = ta.value;
      } else {
        draftText = ta.textContent || '';
      }
    }
    const trimmedDraft = draftText.trim();
    const isDialogOpen = !!document.querySelector('[role="dialog"]') || !!queryFirst(SELECTORS.modalCloseButton).el;
    return {
      isGenerating,
      hasDraft: trimmedDraft.length > 0,
      draftLength: trimmedDraft.length,
      isDialogOpen,
      currentUrl: window.location.href
    };
  },

  /**
   * Title Bridge action execution dispatcher
   */
  async executeAction(action, args, nonce) {
    let payload;
    try {
      let result;
      switch (action) {
        case 'check_health':
          result = await this.checkHealth();
          break;
        case 'get_avatar':
          result = await this.getAvatarVideoBase64();
          break;
        case 'get_avatar_state':
          result = await this.getAvatarState();
          break;
        case 'get_messages':
          result = await this.getMessages(args?.limit);
          break;
        case 'inspect_latest':
          result = await this.inspectLatestMessage();
          break;
        case 'check_chat_ready':
          result = await this.checkChatReady(args?.expectedUrl);
          break;
        case 'inspect_reload_safety':
          result = this.inspectReloadSafety();
          break;
        case 'send_message':
          result = await this.sendMessage(args?.text);
          break;
        case 'fetch_limit': {
          const limitRes = await this.fetchUsageLimit(!!args?.passiveOnly, args?.options);
          result = limitRes ? { ...limitRes, debug_trace: window.__MUSE_LAST_LIMIT_TRACE__ || 'none' } : limitRes;
          break;
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
      payload = { ok: true, data: result };
    } catch (err) {
      payload = {
        ok: false,
        error: (err && err.message) ? err.message : String(err),
        stack: (err && err.stack) ? err.stack : null
      };
    }

    const encoded = encodeURIComponent(JSON.stringify(payload));
    const CHUNK_SIZE = 2800;

    if (encoded.length <= CHUNK_SIZE) {
      document.title = `__MUSE_RES__:${nonce}:${encoded}`;
    } else {
      window.__MUSE_STORE__[nonce] = encoded;
      const total = Math.ceil(encoded.length / CHUNK_SIZE);
      document.title = `__MUSE_CHUNK_READY__:${nonce}:${total}`;
    }
  },

  serveChunk(nonce, idx) {
    const data = window.__MUSE_STORE__[nonce];
    if (!data) {
      document.title = `__MUSE_CHUNK__:${nonce}:${idx}:ERROR_NO_DATA`;
      return;
    }
    const CHUNK_SIZE = 2800;
    const start = idx * CHUNK_SIZE;
    const chunk = data.slice(start, start + CHUNK_SIZE);
    document.title = `__MUSE_CHUNK__:${nonce}:${idx}:${chunk}`;
  },

  cleanup(nonce) {
    delete window.__MUSE_STORE__[nonce];
    if (document.title.startsWith('__MUSE_')) {
      document.title = 'Muse AI - Session';
    }
  }
};

function isSessionAllowedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return (
    h === 'muse.ai' ||
    h.endsWith('.muse.ai') ||
    h === 'accounts.google.com' ||
    h === 'appleid.apple.com' ||
    h === 'login.microsoftonline.com' ||
    h === 'login.live.com' ||
    // Meta login (Accounts Center): Muse's auth flow can route through
    // facebook.com/aymh/redirect-cycle/ and instagram.com/aymh/redirect-cycle/.
    // Keep in sync with is_session_allowed_host in src-tauri/src/lib.rs.
    h === 'facebook.com' ||
    h.endsWith('.facebook.com') ||
    h === 'instagram.com' ||
    h.endsWith('.instagram.com')
  );
}

function shouldOpenExternally(rawHref, baseHref) {
  if (!rawHref || typeof rawHref !== 'string') return null;
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  let parsed;
  try {
    parsed = new URL(trimmed, baseHref || (typeof window !== 'undefined' && window.location ? window.location.href : 'https://muse.ai/'));
  } catch (_) {
    return null;
  }
  const protocol = (parsed.protocol || '').toLowerCase();
  if (protocol === 'mailto:' || protocol === 'tel:') {
    return parsed.href;
  }
  if (protocol === 'http:' || protocol === 'https:') {
    if (!isSessionAllowedHost(parsed.hostname)) {
      return parsed.href;
    }
  }
  return null;
}

function notifyOpenExternalUrl(url) {
  if (!url || typeof document === 'undefined') return;
  const prevTitle = document.title && !document.title.startsWith('__MUSE_')
    ? document.title
    : 'Muse AI - Session';
  document.title = `__MUSE_OPEN_URL__:${url}`;
  setTimeout(() => {
    if (document.title.startsWith('__MUSE_OPEN_URL__:')) {
      document.title = prevTitle;
    }
  }, 100);
}

function installExternalLinkInterceptor() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__MUSE_EXTERNAL_LINK_HOOKED__) return;
  window.__MUSE_EXTERNAL_LINK_HOOKED__ = true;

  document.addEventListener(
    'click',
    (e) => {
      if (!e || e.defaultPrevented) return;
      if (typeof e.button === 'number' && e.button !== 0 && e.button !== 1) return;
      const target = e.target;
      const anchor = target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
      if (!anchor) return;
      const rawHref = anchor.getAttribute('href');
      const extUrl = shouldOpenExternally(rawHref);
      if (!extUrl) return;
      e.preventDefault();
      e.stopPropagation();
      notifyOpenExternalUrl(extUrl);
    },
    true
  );

  if (typeof window.open === 'function') {
    const origOpen = window.open.bind(window);
    window.open = function (url, target, features) {
      if (typeof url === 'string' && url.length > 0) {
        const extUrl = shouldOpenExternally(url);
        if (extUrl) {
          notifyOpenExternalUrl(extUrl);
          return null;
        }
      }
      return origOpen(url, target, features);
    };
  }
}

installExternalLinkInterceptor();

