// main.js - Muse Desktop Gadget production frontend controller

const invoke = window.__TAURI__ ? window.__TAURI__.core.invoke : async (cmd, args) => {
  console.log(`[Mock Invoke] ${cmd}`, args);
  if (cmd === 'get_gadget_config') return { size_mode: 'small', message_limit: 5, hotkey: 'Ctrl+Shift+M' };
  if (cmd === 'get_chat_messages') return [
    { role: 'assistant', text: "Hello! I'm Muse. Is there anything I can help you with?" },
    { role: 'user', text: "Tell me today's tasks." },
    { role: 'assistant', text: "Of course! Let me check today's schedule." }
  ];
  if (cmd === 'get_usage_limit') return { plan_name: 'Free Plan', used_percent: 17, remaining_percent: 83, reset_text: 'The weekly limit resets on November 6', updated_at: '2026-11-02 21:00' };
  return {};
};

// Get UI elements
const statusDot = document.getElementById('status-dot');
const planBadge = document.getElementById('plan-badge');

const btnOpenBrowser = document.getElementById('btn-open-browser');
const btnToggleSession = document.getElementById('btn-toggle-session');
const btnRefreshAll = document.getElementById('btn-refresh-all');
const btnToggleSize = document.getElementById('btn-toggle-size');
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');
const dragHeader = document.getElementById('drag-header');

const avatarContainer = document.getElementById('avatar-container');
const avatarVideoA = document.getElementById('avatar-video-a');
const avatarVideoB = document.getElementById('avatar-video-b');

// <video> element error detection and self-recovery listener (Issue #31)
[avatarVideoA, avatarVideoB].forEach((videoEl, idx) => {
  if (videoEl) {
    videoEl.addEventListener('error', (e) => {
      console.error(`avatarVideo${idx === 0 ? 'A' : 'B'} error:`, e);
      setTimeout(() => {
        loadAvatar(true);
      }, 500);
    });
  }
});
const avatarFallback = document.getElementById('avatar-fallback');
const btnFetchAvatar = document.getElementById('btn-fetch-avatar');
const avatarNameEl = document.getElementById('avatar-name');
const avatarNameTextEl = document.getElementById('avatar-name-text');
const avatarLimitBadgeEl = document.getElementById('avatar-limit-badge');
const avatarStatusPillEl = document.getElementById('avatar-status-pill');
const avatarStatusTextEl = document.getElementById('avatar-status-text');
const unreadBadgeEl = document.getElementById('unread-badge');
const avatarColumn = document.getElementById('avatar-column');
const mascotRestoreBtn = document.getElementById('mascot-restore-btn');

let unreadCount = 0;

// Mascot speech bubble elements
const mascotBubble = document.getElementById('mascot-bubble');
const mascotBubbleTitle = mascotBubble ? mascotBubble.querySelector('.mascot-bubble-title') : null;
const mascotBubbleText = document.getElementById('mascot-bubble-text');
const mascotBubbleCursor = document.getElementById('mascot-bubble-cursor');
const btnBubbleClose = document.getElementById('btn-bubble-close');
const mascotBubbleOptions = document.getElementById('mascot-bubble-options');

// Mascot mini input bar elements (Issue #27) + one-click shortcuts (Issue #68)
const mascotInputBar = document.getElementById('mascot-input-bar');
const mascotInputField = document.getElementById('mascot-input-field');
const btnMascotInputSend = document.getElementById('btn-mascot-input-send');
const btnMascotInputClose = document.getElementById('btn-mascot-input-close');
const btnMascotQuickInput = document.getElementById('btn-mascot-quick-input');
const mascotShortcutChips = document.getElementById('mascot-shortcut-chips');
const mascotShortcutNote = document.getElementById('mascot-shortcut-note');

const limitPercentText = document.getElementById('limit-percent-text');
const limitProgressBar = document.getElementById('limit-progress-bar');
const limitResetText = document.getElementById('limit-reset-text');
const btnRefreshLimit = document.getElementById('btn-refresh-limit');

const chatSyncIndicator = document.getElementById('chat-sync-indicator');
const msgLimitSelect = document.getElementById('msg-limit-select');
const chatMessagesContainer = document.getElementById('chat-messages');

const chatInput = document.getElementById('chat-input');
const btnSendMessage = document.getElementById('btn-send-message');
const footerSyncTime = document.getElementById('footer-sync-time');

const healthR1 = document.getElementById('health-r1');
const healthR2 = document.getElementById('health-r2');
const healthR3 = document.getElementById('health-r3');
const healthR5 = document.getElementById('health-r5');

let isSessionVisible = false;
let currentLimit = 5;
let lastSeenAssistantText = null;
let pendingAssistantText = null;
let assistantCommitTimer = null;
let lastKnownAvatarBlobUrl = null;
let typingTimer = null;
let autoHideTimer = null;

// ==========================================
// Lupin-style pat-pat typing speech bubble control
// ==========================================
function cleanMascotMessageText(text) {
  if (!text) return '';
  return text
    .replace(/^[\s\uFEFF\xA0\u3000]+/g, '')  // Completely remove leading whitespace, newlines, full-width spaces, NBSP, etc.
    .replace(/[\s\uFEFF\xA0\u3000]+$/g, '')  // Remove trailing whitespace
    .replace(/^[ \t\u3000]+/gm, '');          // Remove unnatural indentation at the start of each line
}

function applyMascotBubbleDirectionClass(onLeft) {
  const heroCard = document.getElementById('hero-card');
  if (!heroCard) return;
  if (onLeft) {
    heroCard.classList.add('bubble-on-left');
    heroCard.classList.remove('bubble-on-right');
  } else {
    heroCard.classList.add('bubble-on-right');
    heroCard.classList.remove('bubble-on-left');
  }
  scheduleSyncMascotHitRects();
}

let mascotHitSyncPending = false;

function collectMascotHitRects() {
  if (!document.body.classList.contains('mode-mascot')) return [];
  const ids = ['avatar-column', 'mascot-bubble', 'mascot-input-bar'];
  const rects = [];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('hidden')) continue;
    if (typeof window.getComputedStyle === 'function' && window.getComputedStyle(el).display === 'none') {
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) {
      rects.push({
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
      });
    }
  }
  return rects;
}

function syncMascotHitRectsNow() {
  mascotHitSyncPending = false;
  if (!document.body.classList.contains('mode-mascot')) return;
  const rects = collectMascotHitRects();
  invoke('update_mascot_hit_rects', { rects }).catch(() => {});
}

function scheduleSyncMascotHitRects() {
  if (!document.body.classList.contains('mode-mascot')) return;
  if (mascotHitSyncPending) return;
  mascotHitSyncPending = true;
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(syncMascotHitRectsNow);
  } else {
    setTimeout(syncMascotHitRectsNow, 16);
  }
}

async function updateMascotBubbleDirection() {
  if (!document.body.classList.contains('mode-mascot')) return;
  const heroCard = document.getElementById('hero-card');
  if (!heroCard) return;

  const currentOnLeft = !heroCard.classList.contains('bubble-on-right');
  try {
    const shouldBeOnLeft = await invoke('sync_mascot_bubble_direction', { currentOnLeft });
    applyMascotBubbleDirectionClass(Boolean(shouldBeOnLeft));
  } catch (_) {}
}

// ==========================================
// Web Audio API sound engine (Issue #24)
// ==========================================
let audioCtx = null;
let typingAudioBuffers = [];

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
      initTypingBuffers();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Pre-generate mechanical key-switch keystroke sound buffers (4 variations)
function initTypingBuffers() {
  if (!audioCtx || typingAudioBuffers.length > 0) return;
  const sampleRate = audioCtx.sampleRate;
  const duration = 0.035; // 35ms keystroke sound
  const length = Math.floor(sampleRate * duration);

  // 4 keystroke variations (slightly varying pitch and resonance for a realistic human feel)
  const configs = [
    { startFreq: 1400, endFreq: 480, lowFreq: 320, noiseMix: 0.08 },
    { startFreq: 1250, endFreq: 420, lowFreq: 280, noiseMix: 0.06 },
    { startFreq: 1550, endFreq: 520, lowFreq: 350, noiseMix: 0.07 },
    { startFreq: 1350, endFreq: 450, lowFreq: 300, noiseMix: 0.09 },
  ];

  for (let i = 0; i < 4; i++) {
    const buffer = audioCtx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    const cfg = configs[i];

    for (let j = 0; j < length; j++) {
      const t = j / sampleRate;
      // Sharp pitch drop (hard key-switch contact sound, "click")
      const freq1 = cfg.startFreq * Math.exp(-t * 180) + cfg.endFreq;
      const attack = Math.sin(2 * Math.PI * freq1 * t) * Math.exp(-t * 150);

      // Low bottoming-out resonance sound ("thock")
      const bottom = Math.sin(2 * Math.PI * cfg.lowFreq * t) * Math.exp(-t * 100);

      // Slight click noise (fingertip touching the keycap)
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 260) * cfg.noiseMix;

      data[j] = (attack * 0.8 + bottom * 0.45 + noise) * (1 - t / duration);
    }
    typingAudioBuffers.push(buffer);
  }
}

// Play the tap-tap typing sound (throttled to a pleasant keystroke rhythm)
let lastTypingSoundTime = 0;
function playTypingSound() {
  if (pluginSettings.sound_enabled === false) return;
  const ctx = getAudioContext();
  if (!ctx || typingAudioBuffers.length === 0) return;

  const now = ctx.currentTime;
  // Throttle playback within 60ms (keeps a pleasant "tap-tap-tap…" rhythm of about 16 keystrokes per second)
  if (now - lastTypingSoundTime < 0.060) return;
  lastTypingSoundTime = now;

  const volumeRatio = Math.max(0, Math.min(100, Number(pluginSettings.sound_volume) ?? 30)) / 100;
  if (volumeRatio <= 0) return;

  try {
    const buf = typingAudioBuffers[Math.floor(Math.random() * typingAudioBuffers.length)];
    const source = ctx.createBufferSource();
    source.buffer = buf;

    const gain = ctx.createGain();
    gain.gain.value = volumeRatio * 1.0;

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
  } catch (_) {}
}

// New-message notification sound "ping♪" (2-note arpeggio chime)
function playNotificationSound() {
  if (pluginSettings.sound_enabled === false) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const volumeRatio = Math.max(0, Math.min(100, Number(pluginSettings.sound_volume) ?? 30)) / 100;
  if (volumeRatio <= 0) return;

  try {
    const now = ctx.currentTime;
    // Note 1: C6 (1046.5Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1046.5, now);
    gain1.gain.setValueAtTime(volumeRatio * 0.45, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.12);

    // Note 2: G6 (1567.98Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1567.98, now + 0.08);
    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(volumeRatio * 0.55, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.35);
  } catch (_) {}
}

// "Pop♪" sound when the mascot is clicked
function playTouchReactionSound() {
  if (pluginSettings.sound_enabled === false) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const volumeRatio = Math.max(0, Math.min(100, Number(pluginSettings.sound_volume) ?? 30)) / 100;
  if (volumeRatio <= 0) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.05);

    gain.gain.setValueAtTime(volumeRatio * 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  } catch (_) {}
}

let currentTypingTargetText = '';
let currentTypingIdx = 0;
let currentTypingOptions = [];

// Render the option buttons (Issue #32)
function renderMascotOptions(options) {
  if (!mascotBubbleOptions) return;
  mascotBubbleOptions.innerHTML = '';

  if (!options || options.length === 0) {
    mascotBubbleOptions.classList.add('hidden');
    return;
  }

  options.forEach(optText => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mascot-option-btn';
    btn.textContent = optText;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await handleSelectOption(optText);
    });
    mascotBubbleOptions.appendChild(btn);
  });

  // Session screen guide button (fallback)
  const footer = document.createElement('div');
  footer.className = 'mascot-option-footer';
  const sessionBtn = document.createElement('button');
  sessionBtn.type = 'button';
  sessionBtn.className = 'mascot-option-session-btn';
  sessionBtn.textContent = '🖥️ Open in session';
  sessionBtn.title = 'Open the official chat screen and operate it directly';
  sessionBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideMascotBubble();
    if (liveQuotesPrevChatUrl) {
      isWakingForLiveQuotes = false;
      await restoreSessionUrlAfterWake();
    }
    await invoke('open_or_show_session');
  });
  footer.appendChild(sessionBtn);
  mascotBubbleOptions.appendChild(footer);

  mascotBubbleOptions.classList.remove('hidden');
  scrollMascotBubbleToBottom();
}

// Auto-follow to the bottom of the speech bubble scroll container (.mascot-bubble-body) (Issue #50)
function scrollMascotBubbleToBottom() {
  if (!mascotBubbleText) return;
  const scrollContainer = mascotBubbleText.parentElement;
  if (scrollContainer) {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }
  mascotBubbleText.scrollTop = mascotBubbleText.scrollHeight;
}

// One-click reply when an option is clicked (Issue #32)
async function handleSelectOption(optionText) {
  if (!optionText) return;
  // If the pre-answer message is still unconfirmed (waiting 2 seconds to confirm), the confirm step or periodic sync
  // would replay that message in the bubble and re-show the options, so confirm it at the moment of the click
  if (assistantCommitTimer) {
    clearTimeout(assistantCommitTimer);
    assistantCommitTimer = null;
  }
  if (pendingAssistantText) {
    lastSeenAssistantText = pendingAssistantText;
    lastCommittedAssistantText = pendingAssistantText;
    pendingAssistantText = null;
  }
  hideMascotBubble();
  recordInteraction();
  setAvatarState('working');

  try {
    playLupinTyping(`Sending "${optionText}"…`);
    if (liveQuotesPrevChatUrl) {
      isWakingForLiveQuotes = false;
      await restoreSessionUrlAfterWake();
    }
    await invoke('send_chat_message', { text: optionText });
  } catch (err) {
    console.error('Failed to send option:', err);
    playLupinTyping(`Send error: ${err?.message || err}`);
  }
}

function startTypingLoop(text) {
  const delay = Math.min(24, Math.max(10, Math.floor(1600 / Math.max(1, text.length))));

  typingTimer = setInterval(() => {
    if (currentTypingIdx < currentTypingTargetText.length) {
      const char = currentTypingTargetText[currentTypingIdx];
      mascotBubbleText.textContent += char;
      currentTypingIdx++;
      scrollMascotBubbleToBottom();
      // Play the tap-tap typing sound for anything other than spaces and newlines
      if (char !== ' ' && char !== '\n' && char !== '\r' && char !== '\t') {
        playTypingSound();
      }
    } else {
      clearInterval(typingTimer);
      typingTimer = null;
      // After typing finishes, wait a moment, then hide the cursor
      setTimeout(() => {
        if (!typingTimer) mascotBubbleCursor.classList.add('hidden');
      }, 700);

      // Show the option buttons when typing finishes (Issue #32)
      if (currentTypingOptions && currentTypingOptions.length > 0) {
        renderMascotOptions(currentTypingOptions);
      }

      // Fade out automatically after setting.json's bubble_display_duration_sec seconds
      // * If there are options, keep it shown longer so they can be answered (at least 180 seconds)
      const baseSec = Math.max(1, Number(pluginSettings.bubble_display_duration_sec) || 30);
      const bubbleDurationMs = (currentTypingOptions && currentTypingOptions.length > 0)
        ? Math.max(180, baseSec) * 1000
        : baseSec * 1000;
      autoHideTimer = setTimeout(() => {
        mascotBubble.classList.add('hidden');
      }, bubbleDurationMs);
    }
  }, delay);
}

function applyMascotBubbleAppearance(kind) {
  const isQuote = kind === 'quote';
  if (mascotBubble) {
    mascotBubble.classList.toggle('is-quote', isQuote);
  }
  if (mascotBubbleTitle) {
    mascotBubbleTitle.textContent = isQuote ? '💭 Musing' : 'Muse';
  }
}

function playLupinTyping(text, options = [], meta = {}) {
  if (!mascotBubble || !mascotBubbleText) return;
  closeMascotInput();
  const cleanedText = cleanMascotMessageText(text);
  if (!cleanedText) return;

  const kind = meta && meta.kind === 'quote' ? 'quote' : 'message';
  applyMascotBubbleAppearance(kind);
  updateMascotBubbleDirection();

  // Seamless-append check (prevents flicker and re-reading when updated mid-stream):
  // If the bubble is currently shown (or typing), and
  // the new text is a continuation (prefix match) of the current typing target or the text being shown,
  // don't clear or reset the bubble — just update the target text and keep typing on from there!
  const currentShown = mascotBubbleText.textContent || '';
  const isCurrentlyActive = !mascotBubble.classList.contains('hidden');

  if (isCurrentlyActive && (
    (currentTypingTargetText && cleanedText.startsWith(currentTypingTargetText) && cleanedText.length >= currentTypingTargetText.length) ||
    (currentShown && cleanedText.startsWith(currentShown) && cleanedText.length >= currentShown.length)
  )) {
    currentTypingTargetText = cleanedText;
    currentTypingOptions = Array.isArray(options) ? options : [];

    // If the previous typing already finished and is waiting to fade out, restart the typing timer
    if (!typingTimer && currentTypingIdx < cleanedText.length) {
      if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
      }
      mascotBubbleCursor.classList.remove('hidden');
      if (mascotBubbleOptions) mascotBubbleOptions.classList.add('hidden');
      startTypingLoop(cleanedText);
    }
    return;
  }

  // If it's a completely new, different message, initialize and start over
  if (typingTimer) {
    clearInterval(typingTimer);
    typingTimer = null;
  }
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  currentTypingTargetText = cleanedText;
  currentTypingIdx = 0;
  currentTypingOptions = Array.isArray(options) ? options : [];
  mascotBubbleText.textContent = '';
  if (mascotBubbleText.parentElement) {
    mascotBubbleText.parentElement.scrollTop = 0;
  }
  if (mascotBubbleOptions) {
    mascotBubbleOptions.innerHTML = '';
    mascotBubbleOptions.classList.add('hidden');
  }
  mascotBubbleCursor.classList.remove('hidden');
  mascotBubble.classList.remove('hidden');
  scheduleSyncMascotHitRects();

  startTypingLoop(cleanedText);
}

function hideMascotBubble() {
  if (typingTimer) {
    clearInterval(typingTimer);
    typingTimer = null;
  }
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }
  if (mascotBubble) {
    mascotBubble.classList.add('hidden');
    mascotBubble.classList.remove('is-quote');
  }
  if (mascotBubbleTitle) {
    mascotBubbleTitle.textContent = 'Muse';
  }
  if (mascotBubbleOptions) {
    mascotBubbleOptions.classList.add('hidden');
    mascotBubbleOptions.innerHTML = '';
  }
  currentTypingOptions = [];
  scheduleSyncMascotHitRects();
}

// ==========================================
// Mascot quick one-line mini input bar (Issue #27) + one-click shortcuts (Issue #68)
// ==========================================
const MASCOT_QUICK_SHORTCUTS = [
  {
    id: 'organize-memory',
    label: 'I keep forgetting things — help me improve that',
    tooltip: 'When what Muse remembers feels outdated or mistaken',
    prompt: 'Please review my memory (MEMORY.md). If there are duplicates or outdated entries, tidy them up and suggest anything that could be compressed.',
  },
  {
    id: 'reset-chat',
    label: "Let's start the conversation fresh",
    tooltip: "When the conversation gets long and heavy — I'll summarize it and hand it over to a new chat",
    prompt: "This conversation has gotten long, so please summarize what we've covered so far into a handover note I can continue from in a new chat.",
  },
  {
    id: 'how-to-use',
    label: 'Teach me some handy ways to use this',
    tooltip: "When you want to learn handy tricks you don't know yet",
    prompt: 'Teach me just 3 handy ways to use Muse, for a beginner — starting with the ones that would suit how I use it.',
  },
  {
    id: 'daily-summary',
    label: 'Sum up today for me',
    tooltip: "When you want to look back on today's conversations at the end of the day",
    prompt: 'Look back on what I did and talked about today, and sum it up briefly.',
  },
];

const DEFAULT_SHORTCUT_NOTE = 'Tap to fill the input field (sending uses 1 turn)';
let activeShortcutPrompt = '';

function resetMascotShortcutSelection() {
  activeShortcutPrompt = '';
  if (mascotShortcutChips) {
    mascotShortcutChips.querySelectorAll('.mascot-shortcut-chip.active').forEach((btn) => {
      btn.classList.remove('active');
    });
  }
  if (mascotShortcutNote) {
    mascotShortcutNote.textContent = DEFAULT_SHORTCUT_NOTE;
    mascotShortcutNote.classList.remove('is-selected');
  }
}

function applyMascotShortcut(item, chipEl) {
  if (!mascotInputField) return;
  resetMascotShortcutSelection();
  activeShortcutPrompt = item.prompt;
  if (chipEl) {
    chipEl.classList.add('active');
  }
  mascotInputField.value = item.prompt;
  if (mascotShortcutNote) {
    mascotShortcutNote.textContent = 'Check it, then press Enter to send (uses 1 turn)';
    mascotShortcutNote.classList.add('is-selected');
  }
  playTouchReactionSound();
  scheduleSyncMascotHitRects();
  mascotInputField.focus();
  try {
    const len = mascotInputField.value.length;
    mascotInputField.setSelectionRange(len, len);
  } catch (_) {}
}

function renderMascotShortcuts() {
  if (!mascotShortcutChips) return;
  mascotShortcutChips.innerHTML = '';
  MASCOT_QUICK_SHORTCUTS.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mascot-shortcut-chip';
    btn.dataset.shortcutId = item.id;
    btn.textContent = item.label;
    btn.title = item.tooltip || item.prompt;
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      applyMascotShortcut(item, btn);
    });
    mascotShortcutChips.appendChild(btn);
  });
}

function openMascotInput() {
  if (!mascotInputBar || !mascotInputField) return;
  getAudioContext();
  hideMascotBubble();
  updateMascotBubbleDirection();
  if (mascotShortcutChips && mascotShortcutChips.children.length === 0) {
    renderMascotShortcuts();
  }
  resetMascotShortcutSelection();
  mascotInputBar.classList.remove('hidden');
  mascotInputField.value = '';
  scheduleSyncMascotHitRects();
  playTouchReactionSound();
  setTimeout(() => {
    mascotInputField.focus();
  }, 60);
}

function closeMascotInput() {
  if (mascotInputField) {
    mascotInputField.blur();
    mascotInputField.value = '';
  }
  resetMascotShortcutSelection();
  if (!mascotInputBar) return;
  mascotInputBar.classList.add('hidden');
  scheduleSyncMascotHitRects();
  try {
    window.focus();
  } catch (_) {}
}

function toggleMascotInput() {
  if (!mascotInputBar) return;
  if (mascotInputBar.classList.contains('hidden')) {
    openMascotInput();
  } else {
    closeMascotInput();
  }
}

async function sendMascotQuickMessage() {
  if (isSendingMessage) return;
  if (!mascotInputField) return;
  const text = mascotInputField.value.trim();
  if (!text) return;

  isSendingMessage = true;
  closeMascotInput();
  recordInteraction();
  setAvatarState('working');

  // Issue #35: hide the "Thinking…" popup when sending (keep it hidden until a reply arrives)
  hideMascotBubble();

  try {
    if (liveQuotesPrevChatUrl) {
      isWakingForLiveQuotes = false;
      await restoreSessionUrlAfterWake();
    }
    await invoke('send_chat_message', { text });
  } catch (err) {
    console.error('sendMascotQuickMessage error:', err);
    playLupinTyping('Send error: ' + err);
    setAvatarState('idle');
  } finally {
    try {
      window.focus();
    } catch (_) {}
    setTimeout(() => { isSendingMessage = false; }, 800);
    // Re-fetch in stages to receive the reply
    setTimeout(loadChatMessages, 800);
    setTimeout(loadChatMessages, 1800);
    setTimeout(loadChatMessages, 3000);
    setTimeout(loadChatMessages, 4500);
    setTimeout(loadChatMessages, 6500);
    setTimeout(loadChatMessages, 9000);
    setTimeout(loadChatMessages, 12000);
  }
}

// Unread badge display control (Issue #20)
function updateUnreadBadge() {
  if (!unreadBadgeEl) return;
  if (unreadCount > 0) {
    unreadBadgeEl.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
    unreadBadgeEl.title = `You have ${unreadCount} unread message(s) (click to open)`;
    unreadBadgeEl.classList.remove('hidden');
    unreadBadgeEl.style.display = 'flex';
  } else {
    unreadBadgeEl.textContent = '';
    unreadBadgeEl.classList.add('hidden');
    unreadBadgeEl.style.display = 'none';
  }
}

function clearUnreadBadge() {
  unreadCount = 0;
  updateUnreadBadge();
}

// Commit function that confirms the display the moment Muse's streaming reply fully completes
let lastCommittedAssistantText = null;

function commitPendingAssistantMessage() {
  if (assistantCommitTimer) {
    clearTimeout(assistantCommitTimer);
    assistantCommitTimer = null;
  }
  if (!pendingAssistantText || pendingAssistantText === lastSeenAssistantText) {
    return;
  }
  const textToPlay = pendingAssistantText;
  const isExtension = !!(lastCommittedAssistantText && textToPlay.startsWith(lastCommittedAssistantText));
  lastSeenAssistantText = textToPlay;
  lastCommittedAssistantText = textToPlay;
  if (isWakingForLiveQuotes || isLiveQuotesResponse(textToPlay)) {
    pendingAssistantText = null;
    const count = extractAndStoreLiveQuotes(textToPlay);
    isWakingForLiveQuotes = false;
    restoreSessionUrlAfterWake();
    setTimeout(() => {
      loadUsageLimit(true);
    }, 4000);
    return;
  }
  pendingAssistantText = null;

  recordInteraction();
  // Issue #36: remove the celebration pose on answer completion; return directly to the normal idle state
  setAvatarState('idle', { force: true });
  // When a conversation reply completes, auto-refetch the latest usage limit only while the session is hidden (Issue #33, #49)
  setTimeout(() => {
    if (!isSessionVisible) {
      loadUsageLimit(true);
    }
  }, 2000);
  // But suppress the tap-tap sound and bubble playback while the session screen is shown (Issue #29)
  if (document.body.classList.contains('mode-mascot') && !isSessionVisible) {
    playLupinTyping(textToPlay);
  }

  // If the session screen is not in front, count up the unread badge (don't double-count a streaming extension of the same message)
  if (!isSessionVisible && !isExtension) {
    unreadCount++;
    updateUnreadBadge();
    playNotificationSound();
  }
}

// ==========================================
// 0. §17 Startup & periodic health check & degraded-mode control
// ==========================================
function setHealthPill(el, label, ok, detail) {
  if (!el) return;
  el.textContent = ok ? `${label}✓` : `${label}⚠`;
  el.className = `health-pill ${ok ? 'ok' : 'degraded'}`;
  el.title = `${label}: ${ok ? 'OK' : 'Not detected / degraded'} (${detail || ''})`;
}

async function runHealthCheck() {
  if (isNavigatingForWake || isWakingForLiveQuotes) return;
  try {
    const h = await invoke('check_bridge_health');
    if (!h) return;
    if (h.avatar_name) {
      if (avatarNameTextEl) {
        avatarNameTextEl.textContent = h.avatar_name;
      } else if (avatarNameEl) {
        avatarNameEl.textContent = h.avatar_name;
      }
    }

    if (h.avatar_state) {
      if (h.avatar_state === 'working' || h.avatar_state === 'making_something') {
        recordInteraction();
        setAvatarState(h.avatar_state);
      } else if (h.avatar_state === 'milestone_level_up') {
        recordInteraction();
        setAvatarState('milestone_level_up', { durationMs: 4000 });
      }
    }

    const isAvatarPlaying = !!avatarVideoPack && (
      (!avatarVideoA?.classList.contains('hidden') && !!avatarVideoA?.src) ||
      (!avatarVideoB?.classList.contains('hidden') && !!avatarVideoB?.src)
    );
    const r1Ok = !!h.r1_avatar?.ok || isAvatarPlaying;
    const r1Detail = isAvatarPlaying ? 'video-pack' : (h.r1_avatar?.ok ? h.r1_avatar.selector : 'none');
    setHealthPill(healthR1, 'R1', r1Ok, r1Detail);
    setHealthPill(healthR2, 'R2', !!h.r2_messages?.ok, h.r2_messages?.selector);
    setHealthPill(healthR3, 'R3', !!h.r3_input?.ok, h.r3_input?.selector);
    setHealthPill(healthR5, 'R5', !!h.r5_limit?.ok, h.r5_limit?.selector);

    // §17.1 R3 (input field) degraded mode: if the selector is not found, prevent mistaken sends and say so explicitly
    if (h.r3_input && !h.r3_input.ok) {
      chatInput.disabled = true;
      btnSendMessage.disabled = true;
      chatInput.placeholder = '⚠ Input field not detected (please use the [🖥️] official screen)';
    } else {
      chatInput.disabled = false;
      btnSendMessage.disabled = false;
      chatInput.placeholder = 'Type a message to Muse... (Enter to send)';
    }
  } catch (err) {
    console.warn('runHealthCheck error:', err);
  }
}

// ==========================================
// 1. Avatar video engine (500ms crossfade & state machine)
// ==========================================
let avatarVideoPack = null;
let pluginItems = [];
let lastPickedPluginKey = null;
let currentAvatarState = 'idle';
let currentActiveSlot = 'a'; // 'a' or 'b'
let avatarTransitionSeq = 0; // Slot-switch race-prevention sequence (Issue #31)
let isSendingMessage = false; // Lock against repeated / double sends while sending (Issue #34)
let stateTimer = null;
let isSpecialActionLocked = false;
let specialActionTimer = null;
let lastUserInteractionTime = Date.now();
let lastPluginActionEndTime = 0;

// setting.json values (hot-reload supported)
let pluginSettings = {
  idle_threshold_sec: 180,
  action_interval_sec: 15,
  default_action_duration_sec: 30,
  touch_reaction_duration_sec: 8,
  bubble_display_duration_sec: 30,
  avoid_repeat_video: true,
  sound_enabled: true,
  sound_volume: 30,
  live_quotes: {
    enabled: false,
    target_mode: 'main',
    custom_chat_url: '',
    batch_count: 4,
    min_interval_min: 60,
    daily_limit: 6,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00'
  }
};

// quotes.json per-video settings map (hot-reload supported)
let videoQuotesConfigMap = {};

// ==========================================
// Live remark generation (wake method) pool management (Issue #37)
// ==========================================
const LIVE_QUOTES_FENCE = '\x60\x60\x60';
let liveQuotesPool = {
  items: [],
  updated_at: '',
  last_wake_at: 0,
  daily_wake_date: '',
  daily_wake_count: 0,
  recent_shown: []
};
let isWakingForLiveQuotes = false;
let isNavigatingForWake = false;
let liveQuotesPrevChatUrl = null;
let latestMuseSyncedState = 'idle';

async function restoreSessionUrlAfterWake() {
  if (!liveQuotesPrevChatUrl) return;
  const targetUrl = liveQuotesPrevChatUrl;
  liveQuotesPrevChatUrl = null;
  isNavigatingForWake = true;
  if (assistantCommitTimer) {
    clearTimeout(assistantCommitTimer);
    assistantCommitTimer = null;
  }
  pendingAssistantText = null;
  try {
    const navRes = await invoke('navigate_session', { url: targetUrl });
    if (navRes && typeof navRes === 'object' && 'latestAssistant' in navRes) {
      lastSeenAssistantText = navRes.latestAssistant || null;
      lastCommittedAssistantText = navRes.latestAssistant || null;
      pendingAssistantText = null;
    }
  } catch (e) {
    console.warn('Failed to restore session url after wake:', e);
  } finally {
    isNavigatingForWake = false;
    setTimeout(loadChatMessages, 1500);
  }
}

function getTodayDateString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function pruneExpiredLiveQuotes() {
  if (!Array.isArray(liveQuotesPool.items)) {
    liveQuotesPool.items = [];
    return;
  }
  const now = Date.now();
  const maxAgeMs = 24 * 3600 * 1000;
  liveQuotesPool.items = liveQuotesPool.items.filter(item => {
    if (!item || typeof item.text !== 'string' || !item.text.trim()) return false;
    const createdAt = Number(item.created_at) || 0;
    return createdAt > 0 && (now - createdAt) <= maxAgeMs;
  });
}

async function loadLiveQuotesPool() {
  try {
    const data = await invoke('get_live_quotes');
    if (data && typeof data === 'object') {
      liveQuotesPool.items = Array.isArray(data.items) ? data.items : [];
      liveQuotesPool.updated_at = typeof data.updated_at === 'string' ? data.updated_at : '';
      liveQuotesPool.last_wake_at = Number(data.last_wake_at) || 0;
      liveQuotesPool.daily_wake_date = typeof data.daily_wake_date === 'string' ? data.daily_wake_date : '';
      liveQuotesPool.daily_wake_count = Number(data.daily_wake_count) || 0;
      liveQuotesPool.recent_shown = Array.isArray(data.recent_shown) ? data.recent_shown.slice(-10) : [];
    }
    const today = getTodayDateString();
    if (liveQuotesPool.daily_wake_date !== today) {
      liveQuotesPool.daily_wake_date = today;
      liveQuotesPool.daily_wake_count = 0;
    }
    pruneExpiredLiveQuotes();
  } catch (err) {
    console.warn('loadLiveQuotesPool error:', err);
  }
}

async function saveLiveQuotesPool() {
  try {
    liveQuotesPool.updated_at = new Date().toISOString();
    await invoke('save_live_quotes', { payload: liveQuotesPool });
  } catch (err) {
    console.warn('saveLiveQuotesPool error:', err);
  }
}

function consumeOneLiveQuote() {
  pruneExpiredLiveQuotes();
  if (!liveQuotesPool.items || liveQuotesPool.items.length === 0) {
    return null;
  }

  const slot = getCurrentTimeSlot();
  const recentSet = new Set(Array.isArray(liveQuotesPool.recent_shown) ? liveQuotesPool.recent_shown : []);

  // 1. Prefer one matching the current time slot that was not shown recently
  let chosenIdx = liveQuotesPool.items.findIndex(item => item.time_slot === slot && !recentSet.has(item.text));
  // 2. One matching the current time slot
  if (chosenIdx === -1) {
    chosenIdx = liveQuotesPool.items.findIndex(item => item.time_slot === slot);
  }
  // 3. Any one not shown recently
  if (chosenIdx === -1) {
    chosenIdx = liveQuotesPool.items.findIndex(item => !recentSet.has(item.text));
  }
  // 4. The first element
  if (chosenIdx === -1) {
    chosenIdx = 0;
  }

  const [chosen] = liveQuotesPool.items.splice(chosenIdx, 1);
  if (!chosen || !chosen.text) return null;

  if (!Array.isArray(liveQuotesPool.recent_shown)) {
    liveQuotesPool.recent_shown = [];
  }
  liveQuotesPool.recent_shown.push(chosen.text);
  if (liveQuotesPool.recent_shown.length > 10) {
    liveQuotesPool.recent_shown = liveQuotesPool.recent_shown.slice(-10);
  }

  saveLiveQuotesPool();
  return chosen.text;
}

function isLiveQuotesResponse(text) {
  if (!text || typeof text !== 'string') return false;
  return /mascot-quotes/i.test(text);
}

function extractAndStoreLiveQuotes(text) {
  if (!text || typeof text !== 'string') return 0;
  if (!/mascot-quotes/i.test(text)) return 0;
  pruneExpiredLiveQuotes();

  let bodyText = '';
  const fenceRegex = new RegExp(LIVE_QUOTES_FENCE + 'mascot-quotes\\s*([\\s\\S]*?)' + LIVE_QUOTES_FENCE, 'i');
  const fenceMatch = text.match(fenceRegex);
  if (fenceMatch && fenceMatch[1]) {
    bodyText = fenceMatch[1];
  } else {
    bodyText = text.replace(/^[\s\S]*?mascot-quotes\s*/i, '').replace(new RegExp(LIVE_QUOTES_FENCE + '[\\s\\S]*$'), '');
  }

  const rawLines = bodyText.split(/\r?\n/);
  const existingTexts = new Set(liveQuotesPool.items.map(i => i.text));
  const recentTexts = new Set(Array.isArray(liveQuotesPool.recent_shown) ? liveQuotesPool.recent_shown : []);
  const slot = getCurrentTimeSlot();
  const now = Date.now();
  let addedCount = 0;

  for (let line of rawLines) {
    line = line
      .trim()
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+[.)]\s*/, '')
      .replace(/^"(.*)"$/, '$1')
      .trim();

    if (!line) continue;
    if (/^mascot-quotes$/i.test(line)) continue;
    if (line.includes(LIVE_QUOTES_FENCE)) continue;
    if (line.includes('one line here')) continue;
    if (line.length > 40) continue;
    if (existingTexts.has(line) || recentTexts.has(line)) continue;

    liveQuotesPool.items.push({
      text: line,
      time_slot: slot,
      created_at: now
    });
    existingTexts.add(line);
    addedCount++;
  }

  if (addedCount > 0) {
    saveLiveQuotesPool();
  }
  return addedCount;
}

function buildLiveQuotesWakePrompt(batchCount, timeSlot) {
  const n = Math.max(1, Math.min(10, Number(batchCount) || 4));
  const slot = timeSlot || getCurrentTimeSlot();
  return [
    `In your usual tone, come up with ${n} short one-liners for the desktop mascot's speech bubble,`,
    'Reply with one per line inside a code block in the following format. Do not write anything else in the body.',
    `Rules: no more than 40 characters per line, matching the time of day (${slot}); you may mention recent conversations or plans.`,
    '',
    LIVE_QUOTES_FENCE + 'mascot-quotes',
    '(one line here)',
    LIVE_QUOTES_FENCE
  ].join('\n');
}

async function maybeTriggerLiveQuotesWake() {
  const lq = pluginSettings.live_quotes;
  // 1. The feature is enabled
  if (!lq || lq.enabled !== true) return;

  // 2. When target_mode === "custom", a valid URL is set
  const targetMode = lq.target_mode === 'custom' ? 'custom' : 'main';
  const customUrl = (lq.custom_chat_url || '').trim();
  if (targetMode === 'custom' && !customUrl.startsWith('https://')) {
    return;
  }

  // 3. Muse's state is IDLE, and the idle time has lasted at least idle_threshold_sec
  if (
    currentAvatarState !== 'idle' ||
    isSpecialActionLocked ||
    isSendingMessage ||
    isWakingForLiveQuotes ||
    latestMuseSyncedState !== 'idle'
  ) {
    return;
  }
  const now = Date.now();
  const idleSec = (now - lastUserInteractionTime) / 1000;
  const thresholdSec = Math.max(1, Number(pluginSettings.idle_threshold_sec) || 180);
  if (idleSec < thresholdSec) return;

  // 4. The session window is hidden and mascot mode is shown
  if (isSessionVisible || !document.body.classList.contains('mode-mascot')) {
    return;
  }

  // 5. At least min_interval_min minutes have passed since the last wake
  const minIntervalMs = Math.max(1, Number(lq.min_interval_min) || 60) * 60 * 1000;
  const lastWakeAt = Number(liveQuotesPool.last_wake_at) || 0;
  if (now - lastWakeAt < minIntervalMs) {
    return;
  }

  // 6. Today's wake count is below daily_limit
  const today = getTodayDateString();
  if (liveQuotesPool.daily_wake_date !== today) {
    liveQuotesPool.daily_wake_date = today;
    liveQuotesPool.daily_wake_count = 0;
  }
  const dailyLimit = Math.max(1, Number(lq.daily_limit) || 6);
  if (liveQuotesPool.daily_wake_count >= dailyLimit) {
    return;
  }

  // 7. The current time is not within quiet hours (quiet_hours_start – quiet_hours_end)
  const qStart = (lq.quiet_hours_start || '22:00').trim() || '22:00';
  const qEnd = (lq.quiet_hours_end || '07:00').trim() || '07:00';
  if (isWithinTimeRanges([`${qStart}-${qEnd}`])) {
    return;
  }

  // 8. At most 1 valid item remains in the live pool
  pruneExpiredLiveQuotes();
  if (liveQuotesPool.items.length > 1) {
    return;
  }

  // All guard conditions met -> run a background wake
  isWakingForLiveQuotes = true;
  isNavigatingForWake = true;
  liveQuotesPool.last_wake_at = now;
  liveQuotesPool.daily_wake_count += 1;
  await saveLiveQuotesPool();

  const prompt = buildLiveQuotesWakePrompt(lq.batch_count, getCurrentTimeSlot());
  const chatUrl = targetMode === 'custom' ? customUrl : null;

  if (chatUrl) {
    try {
      const status = await invoke('get_session_status');
      if (status && status.url && typeof status.url === 'string' && status.url.startsWith('https://')) {
        const normStatus = status.url.trim().split('?')[0].split('#')[0].replace(/\/+$/, '').toLowerCase();
        const normChat = chatUrl.trim().split('?')[0].split('#')[0].replace(/\/+$/, '').toLowerCase();
        if (normStatus !== normChat) {
          liveQuotesPrevChatUrl = status.url.trim();
        } else {
          liveQuotesPrevChatUrl = 'https://muse.ai/?__pwa=1';
        }
      } else {
        liveQuotesPrevChatUrl = 'https://muse.ai/?__pwa=1';
      }
    } catch (e) {
      console.warn('Failed to record prev session url:', e);
      liveQuotesPrevChatUrl = 'https://muse.ai/?__pwa=1';
    }
  }

  try {
    const wakeRes = await invoke('send_live_quotes_wake', { text: prompt, chatUrl });
    if (wakeRes && typeof wakeRes === 'object' && 'preWakeAssistant' in wakeRes) {
      lastSeenAssistantText = wakeRes.preWakeAssistant || '';
      lastCommittedAssistantText = wakeRes.preWakeAssistant || '';
      pendingAssistantText = null;
    }
    isNavigatingForWake = false;
    setTimeout(loadChatMessages, 2500);
    setTimeout(loadChatMessages, 5000);
    setTimeout(loadChatMessages, 8500);
    setTimeout(loadChatMessages, 12500);
  } catch (err) {
    console.warn('maybeTriggerLiveQuotesWake error:', err);
    isNavigatingForWake = false;
    isWakingForLiveQuotes = false;
    await restoreSessionUrlAfterWake();
  }

  setTimeout(() => {
    if (isWakingForLiveQuotes) {
      isWakingForLiveQuotes = false;
      restoreSessionUrlAfterWake();
    }
  }, 45000);
}

// Default whimsical remarks while idle (can be overridden in quotes.json)
let defaultIdleQuotesList = [
  "Call me anytime!",
  "Such lovely weather today!",
  "Let's have some tea and take a break!",
  "Let me know if there's anything I can help with!"
];

// Reaction remarks on touch (click) (can be overridden in quotes.json)
let touchReactionsList = [
  "Yaaay! Did you call me?",
  "What is it~?",
  "I'm right here!",
  "Let's do our best!",
  "Got something you want to ask?",
  "Hehe, nice to meet you!"
];

// Remarks by time of day (morning / afternoon / evening / late night) (can be overridden in quotes.json)
let timeSpecificQuotesMap = {
  morning: [
    "Good morning! Let's make today a great day!",
    "The morning air feels so fresh! Take a deep breath!",
    "Did you eat breakfast? Let's fuel up properly!"
  ],
  afternoon: [
    "Good afternoon! Let's keep going strong!",
    "How about a little break and some tea?",
    "You're focusing so hard — amazing! But remember to relax your shoulders sometimes."
  ],
  evening: [
    "Great work today! You did so well!",
    "It's getting to sunset~. Are you about done with today's plans?",
    "It's getting dark. Let's keep going while giving your eyes a rest!"
  ],
  night: [
    "Try not to stay up too late!",
    "It's already late, so take it easy and get some rest.",
    "You got so much done today! Good night… zzz"
  ]
};

function getCurrentTimeSlot() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

function pickRandomIdleQuote(candidateQuotes = null) {
  const hasSpecificVideoQuotes = candidateQuotes && candidateQuotes.length > 0 && candidateQuotes !== defaultIdleQuotesList;
  const slot = getCurrentTimeSlot();
  const timeQuotes = timeSpecificQuotesMap[slot] || [];

  // A. When the playing video has dedicated lines (Issue #38): draw live 50% / video-dedicated 50%
  if (hasSpecificVideoQuotes) {
    if (Math.random() < 0.5) {
      const liveQuote = consumeOneLiveQuote();
      if (liveQuote) {
        return liveQuote;
      }
    }
    // For the other 50%, or when the live pool is empty, use video-dedicated lines (some time-of-day lines)
    if (timeQuotes.length > 0 && Math.random() < 0.3) {
      return timeQuotes[Math.floor(Math.random() * timeQuotes.length)];
    }
    return candidateQuotes[Math.floor(Math.random() * candidateQuotes.length)];
  }

  // B. Videos without dedicated lines, or regular actions: live lines first, as before (Issue #37)
  const liveQuote = consumeOneLiveQuote();
  if (liveQuote) {
    return liveQuote;
  }

  // If default, or there are no candidates:
  // If there are time-of-day lines, pick a time-of-day line with 70% probability and a regular idle line with 30% probability
  if (timeQuotes.length > 0 && (defaultIdleQuotesList.length === 0 || Math.random() < 0.7)) {
    return timeQuotes[Math.floor(Math.random() * timeQuotes.length)];
  }
  if (defaultIdleQuotesList.length > 0) {
    return defaultIdleQuotesList[Math.floor(Math.random() * defaultIdleQuotesList.length)];
  }
  if (timeQuotes.length > 0) {
    return timeQuotes[Math.floor(Math.random() * timeQuotes.length)];
  }
  return '';
}

function applyPluginConfigs(setting, quotes) {
  if (setting && typeof setting === 'object') {
    if (setting.idle_threshold_sec !== undefined) {
      pluginSettings.idle_threshold_sec = Math.max(1, Number(setting.idle_threshold_sec) || 180);
    }
    if (setting.action_interval_sec !== undefined) {
      pluginSettings.action_interval_sec = Math.max(1, Number(setting.action_interval_sec) || 15);
    }
    if (setting.default_action_duration_sec !== undefined) {
      pluginSettings.default_action_duration_sec = Math.max(1, Number(setting.default_action_duration_sec) || 30);
    }
    if (setting.touch_reaction_duration_sec !== undefined) {
      pluginSettings.touch_reaction_duration_sec = Math.max(1, Number(setting.touch_reaction_duration_sec) || 8);
    }
    if (setting.bubble_display_duration_sec !== undefined) {
      pluginSettings.bubble_display_duration_sec = Math.max(1, Number(setting.bubble_display_duration_sec) || 30);
    }
    if (setting.avoid_repeat_video !== undefined) {
      pluginSettings.avoid_repeat_video = Boolean(setting.avoid_repeat_video);
    }
    if (setting.sound_enabled !== undefined) {
      pluginSettings.sound_enabled = Boolean(setting.sound_enabled);
    }
    if (setting.sound_volume !== undefined) {
      pluginSettings.sound_volume = Math.max(0, Math.min(100, Number(setting.sound_volume) || 30));
    }
    if (setting.live_quotes && typeof setting.live_quotes === 'object') {
      const lq = setting.live_quotes;
      pluginSettings.live_quotes = {
        enabled: lq.enabled === true,
        target_mode: lq.target_mode === 'custom' ? 'custom' : 'main',
        custom_chat_url: typeof lq.custom_chat_url === 'string' ? lq.custom_chat_url.trim() : '',
        batch_count: Math.max(1, Math.min(10, Number(lq.batch_count) || 4)),
        min_interval_min: Math.max(1, Number(lq.min_interval_min) || 60),
        daily_limit: Math.max(1, Number(lq.daily_limit) || 6),
        quiet_hours_start: typeof lq.quiet_hours_start === 'string' && lq.quiet_hours_start.trim() ? lq.quiet_hours_start.trim() : '22:00',
        quiet_hours_end: typeof lq.quiet_hours_end === 'string' && lq.quiet_hours_end.trim() ? lq.quiet_hours_end.trim() : '07:00'
      };
    }
  }

  if (quotes && typeof quotes === 'object') {
    if (Array.isArray(quotes.touch_reactions) && quotes.touch_reactions.length > 0) {
      touchReactionsList = quotes.touch_reactions;
    }
    if (Array.isArray(quotes.default_idle_quotes) && quotes.default_idle_quotes.length > 0) {
      defaultIdleQuotesList = quotes.default_idle_quotes;
    }
    if (quotes.time_specific_quotes && typeof quotes.time_specific_quotes === 'object') {
      timeSpecificQuotesMap = {
        morning: Array.isArray(quotes.time_specific_quotes.morning) ? quotes.time_specific_quotes.morning : [],
        afternoon: Array.isArray(quotes.time_specific_quotes.afternoon) ? quotes.time_specific_quotes.afternoon : [],
        evening: Array.isArray(quotes.time_specific_quotes.evening) ? quotes.time_specific_quotes.evening : [],
        night: Array.isArray(quotes.time_specific_quotes.night) ? quotes.time_specific_quotes.night : []
      };
    }
    if (quotes.videos && typeof quotes.videos === 'object') {
      videoQuotesConfigMap = quotes.videos;
    }
  }
}

async function refreshPluginConfigs() {
  try {
    const res = await invoke('get_plugin_configs');
    if (res) {
      applyPluginConfigs(res.setting, res.quotes);
    }
  } catch (_) {}
}

function getVideoConfig(fileName) {
  const stem = fileName.replace(/\.mp4$/i, '');
  const raw = videoQuotesConfigMap[fileName] || videoQuotesConfigMap[stem];
  const defaultDuration = pluginSettings.default_action_duration_sec || 30;

  if (!raw) {
    return {
      enabled: true,
      min_idle_sec: 0,
      max_idle_sec: null,
      time_ranges: ['00:00-23:59'],
      duration_sec: defaultDuration,
      weight: 1,
      quote_probability: 1.0,
      quotes: defaultIdleQuotesList
    };
  }

  // Backward compatibility for when only a line list is written directly in array form
  if (Array.isArray(raw)) {
    return {
      enabled: true,
      min_idle_sec: 0,
      max_idle_sec: null,
      time_ranges: ['00:00-23:59'],
      duration_sec: defaultDuration,
      weight: 1,
      quote_probability: 1.0,
      quotes: raw.length > 0 ? raw : defaultIdleQuotesList
    };
  }

  return {
    enabled: raw.enabled !== false,
    min_idle_sec: Number(raw.min_idle_sec) || 0,
    max_idle_sec: raw.max_idle_sec != null ? Number(raw.max_idle_sec) : null,
    time_ranges: Array.isArray(raw.time_ranges) && raw.time_ranges.length > 0 ? raw.time_ranges : ['00:00-23:59'],
    duration_sec: Number(raw.duration_sec) || defaultDuration,
    weight: Math.max(0, Number(raw.weight !== undefined ? raw.weight : 1)),
    quote_probability: raw.quote_probability !== undefined ? Number(raw.quote_probability) : 1.0,
    quotes: Array.isArray(raw.quotes) && raw.quotes.length > 0 ? raw.quotes : defaultIdleQuotesList
  };
}

function isWithinTimeRanges(timeRanges) {
  if (!Array.isArray(timeRanges) || timeRanges.length === 0) return true;
  const now = new Date();
  const curMin = now.getHours() * 60 + now.getMinutes();

  for (const rangeStr of timeRanges) {
    if (typeof rangeStr !== 'string') continue;
    const m = rangeStr.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const startMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const endMin = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
    if (startMin <= endMin) {
      if (curMin >= startMin && curMin <= endMin) return true;
    } else {
      // Overnight span (e.g. "22:00-07:00")
      if (curMin >= startMin || curMin <= endMin) return true;
    }
  }
  return false;
}

function recordInteraction() {
  lastUserInteractionTime = Date.now();
  lastPluginActionEndTime = 0;
}

function dataUrlToBlobUrl(dataUrl) {
  try {
    if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
    const parts = dataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'video/mp4';
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    const blob = new Blob([u8arr], { type: mime });
    return URL.createObjectURL(blob);
  } catch (_) {
    return dataUrl;
  }
}

async function loadAvatar(forceRefresh = false) {
  if (avatarVideoPack && !forceRefresh) {
    return true;
  }
  try {
    const pack = await invoke('get_avatar_video_pack');
    if (pack) {
      applyPluginConfigs(pack.setting, pack.quotes);
    }

    let idleDataUrl = pack && pack.idle ? pack.idle : '';
    // If avatars/idle.mp4 is not placed yet (e.g. right after git clone), auto-fetch it from the session WebView as a fallback
    if (!idleDataUrl) {
      try {
        idleDataUrl = await invoke('get_avatar_data_url', { forceRefresh });
      } catch (_) {}
    }

    if (idleDataUrl) {
      const idleBlobUrl = dataUrlToBlobUrl(idleDataUrl);
      const nextPack = {
        idle: idleBlobUrl,
        waking: pack && pack.waking ? dataUrlToBlobUrl(pack.waking) : idleBlobUrl,
        working: pack && pack.working ? dataUrlToBlobUrl(pack.working) : idleBlobUrl,
        making_something: pack && pack.making_something ? dataUrlToBlobUrl(pack.making_something) : idleBlobUrl,
        milestone_level_up: pack && pack.milestone_level_up ? dataUrlToBlobUrl(pack.milestone_level_up) : idleBlobUrl
      };

      const loadedPlugins = [];
      if (Array.isArray(pack.plugins)) {
        for (const item of pack.plugins) {
          if (item && item.name && item.data_url) {
            const stateKey = `plugin:${item.name}`;
            nextPack[stateKey] = dataUrlToBlobUrl(item.data_url);
            loadedPlugins.push({
              stateKey,
              name: item.name
            });
          }
        }
      }

      avatarVideoPack = nextPack;
      pluginItems = loadedPlugins;
      currentAvatarState = 'idle';
      currentActiveSlot = 'a';
      if (avatarVideoA) {
        avatarVideoA.src = avatarVideoPack.idle;
        avatarVideoA.classList.add('active');
        avatarVideoA.classList.remove('hidden');
        avatarVideoA.play().catch(() => {});
      }
      if (avatarVideoB) {
        avatarVideoB.classList.remove('active');
      }
      if (avatarFallback) avatarFallback.style.display = 'none';
      return true;
    }
  } catch (err) {
    console.warn('loadAvatar error:', err);
  }
  if (avatarFallback) avatarFallback.style.display = 'flex';
  return false;
}

function setAvatarState(targetState, options = {}) {
  const { durationMs = 0, force = false, lockDuration = false } = options;
  if (!avatarVideoPack) return;
  const newSrc = avatarVideoPack[targetState];
  if (!newSrc) return;

  // While a special action (touch or 3-minute idle action) is locked, suppress overwrites other than forced ones
  if (isSpecialActionLocked && !force) {
    return;
  }

  // Update the lock duration
  if (lockDuration && durationMs > 0) {
    isSpecialActionLocked = true;
    if (specialActionTimer) clearTimeout(specialActionTimer);
    specialActionTimer = setTimeout(() => {
      isSpecialActionLocked = false;
      specialActionTimer = null;
    }, durationMs);
  } else if (force && !lockDuration) {
    isSpecialActionLocked = false;
    if (specialActionTimer) {
      clearTimeout(specialActionTimer);
      specialActionTimer = null;
    }
  }

  // Update the auto-return timer
  if (stateTimer) {
    clearTimeout(stateTimer);
    stateTimer = null;
  }
  if (durationMs > 0 && targetState !== 'idle') {
    stateTimer = setTimeout(() => {
      isSpecialActionLocked = false;
      if (specialActionTimer) {
        clearTimeout(specialActionTimer);
        specialActionTimer = null;
      }
      lastPluginActionEndTime = Date.now();
      setAvatarState('idle', { force: true });
    }, durationMs);
  }

  // If the same state's video is already playing, never switch <video> slots or reload (prevents flicker)
  if (currentAvatarState === targetState) {
    return;
  }

  currentAvatarState = targetState;

  // Slot switching (A <-> B) 500ms crossfade (Issue #31 race / black-screen fix)
  const nextSlotId = currentActiveSlot === 'a' ? 'b' : 'a';
  const incomingSlot = nextSlotId === 'b' ? avatarVideoB : avatarVideoA;
  const outgoingSlot = nextSlotId === 'b' ? avatarVideoA : avatarVideoB;

  currentActiveSlot = nextSlotId;
  const thisSeq = ++avatarTransitionSeq;

  if (incomingSlot) {
    if (incomingSlot.src !== newSrc) {
      incomingSlot.src = newSrc;
      incomingSlot.currentTime = 0;
    }
    incomingSlot.classList.remove('hidden');

    const finalizeCrossFade = () => {
      // If this is not the latest switch request, do nothing (prevents stale completion callbacks from wrongly clearing it)
      if (thisSeq !== avatarTransitionSeq) return;

      incomingSlot.classList.add('active');
      if (outgoingSlot && outgoingSlot !== incomingSlot) {
        outgoingSlot.classList.remove('active');
      }
      ensureActiveAvatarSlot();
    };

    incomingSlot.play()
      .then(() => {
        // Once playback starts, run the fade in/out
        finalizeCrossFade();
      })
      .catch((err) => {
        console.warn('incomingSlot.play error:', err);
        // On playback failure, run the failsafe if this is the latest request
        if (thisSeq === avatarTransitionSeq) {
          finalizeCrossFade();
        }
      });
  } else {
    ensureActiveAvatarSlot();
  }
}

// Self-repair guard that prevents a black screen if .active is removed from both slots A and B (Issue #31)
function ensureActiveAvatarSlot() {
  if (!avatarVideoA || !avatarVideoB) return;
  const aActive = avatarVideoA.classList.contains('active');
  const bActive = avatarVideoB.classList.contains('active');

  // If both have lost .active (the screen has gone black)
  if (!aActive && !bActive) {
    console.warn('ensureActiveAvatarSlot: Both slots inactive! Restoring active slot...');
    const targetSlot = currentActiveSlot === 'b' ? avatarVideoB : avatarVideoA;
    targetSlot.classList.add('active');
    targetSlot.classList.remove('hidden');
    targetSlot.play().catch(() => {});
  } else if (aActive && bActive) {
    // If both remain active, safely fade out the older one
    const staleSlot = currentActiveSlot === 'a' ? avatarVideoB : avatarVideoA;
    staleSlot.classList.remove('active');
  }
}

// Whimsical actions based on idle time and time of day (conditional random pick from videos in the plugin folder)
function checkIdleAction() {
  if (isSessionVisible || currentAvatarState !== 'idle' || isSpecialActionLocked) {
    return;
  }

  const now = Date.now();
  const totalInactiveSec = (now - lastUserInteractionTime) / 1000;
  const thresholdSec = Math.max(1, Number(pluginSettings.idle_threshold_sec) || 15);

  // If the IDLE start time (idle_threshold_sec) has not been reached yet, do nothing
  if (totalInactiveSec < thresholdSec) {
    return;
  }

  // Check whether action_interval_sec seconds have passed since the last plugin video finished playing
  if (lastPluginActionEndTime > 0) {
    const sinceLastEndSec = (now - lastPluginActionEndTime) / 1000;
    const intervalSec = Math.max(1, Number(pluginSettings.action_interval_sec) || thresholdSec);
    if (sinceLastEndSec < intervalSec) {
      return;
    }
  }

  // Elapsed time (seconds) since entering IDLE
  const idleElapsedSec = Math.max(0, totalInactiveSec - thresholdSec);

  if (pluginItems.length > 0) {
    // 1. Filter by the per-video conditions in quotes.json (enabled, min_idle_sec, max_idle_sec, time_ranges, weight)
    let eligible = pluginItems
      .map(item => ({ item, cfg: getVideoConfig(item.name) }))
      .filter(({ cfg }) => {
        if (!cfg.enabled || cfg.weight <= 0) return false;
        if (idleElapsedSec < cfg.min_idle_sec) return false;
        if (cfg.max_idle_sec !== null && idleElapsedSec > cfg.max_idle_sec) return false;
        if (!isWithinTimeRanges(cfg.time_ranges)) return false;
        return true;
      });

    if (eligible.length === 0) {
      return;
    }

    // 2. If the avoid-repeat setting (avoid_repeat_video) is true and there are 2+ candidates, exclude the previous video
    if (pluginSettings.avoid_repeat_video && eligible.length > 1 && lastPickedPluginKey) {
      eligible = eligible.filter(e => e.item.stateKey !== lastPickedPluginKey);
    }

    // 3. Random draw based on weight
    const totalWeight = eligible.reduce((sum, e) => sum + e.cfg.weight, 0);
    let r = Math.random() * totalWeight;
    let selected = eligible[eligible.length - 1];
    for (const entry of eligible) {
      r -= entry.cfg.weight;
      if (r <= 0) {
        selected = entry;
        break;
      }
    }

    lastPickedPluginKey = selected.item.stateKey;
    const durationMs = Math.max(1, selected.cfg.duration_sec) * 1000;

    setAvatarState(selected.item.stateKey, { durationMs, lockDuration: true, force: true });

    // 4. Show a line (according to quote_probability)
    if (document.body.classList.contains('mode-mascot') && Math.random() <= selected.cfg.quote_probability) {
      const quote = pickRandomIdleQuote(selected.cfg.quotes);
      if (quote) {
        playLupinTyping(quote, [], { kind: 'quote' });
      }
    }
  } else {
    const durationMs = Math.max(1, pluginSettings.default_action_duration_sec || 30) * 1000;
    const randomAction = Math.random() < 0.5 ? 'waking' : 'working';
    setAvatarState(randomAction, { durationMs, lockDuration: true, force: true });
    if (document.body.classList.contains('mode-mascot')) {
      const quote = pickRandomIdleQuote();
      if (quote) {
        playLupinTyping(quote, [], { kind: 'quote' });
      }
    }
  }
}

// Real-time sync of Muse's working state (Issue #35)
async function syncAvatarStateWithMuse() {
  if (isNavigatingForWake) return;
  try {
    const res = await invoke('get_avatar_state');
    if (res) {
      const state = res.state || 'idle';
      const statusText = (res.statusText || '').trim();

      // Status pill update: don't show idle text like "linked" or "waiting", or the avatar name itself (Issue #35, #57)
      if (avatarStatusPillEl && avatarStatusTextEl) {
        const currentAvatarName = (avatarNameEl?.textContent || '').trim().toLowerCase();
        const normalizedStatus = statusText.replace(/^(\p{Emoji}|[\u2600-\u27BF]|\s)+/gu, '').trim().toLowerCase();
        const isAvatarNameOnly = Boolean(currentAvatarName) && normalizedStatus === currentAvatarName;
        const effectiveStatusText = isAvatarNameOnly ? '' : statusText;
        const isIdleText = effectiveStatusText && /ready|idle|online|connected/i.test(effectiveStatusText);
        if (state === 'idle' || isIdleText) {
          avatarStatusPillEl.classList.add('hidden');
        } else {
          const fallbackByState = {
            working: 'Working',
            making_something: 'Creating',
            waking: 'Starting up',
            milestone_level_up: 'Level up!',
          };
          let formattedText = effectiveStatusText || fallbackByState[state] || '';
          if (!formattedText) {
            avatarStatusPillEl.classList.add('hidden');
          } else {
            // Muse's icon (SVG) and text are separate, so if there's no emoji, add 🛠️
            const hasEmoji = /^(\p{Emoji}|[\u2600-\u27BF])/u.test(formattedText);
            if (!hasEmoji) {
              formattedText = `🛠️ ${formattedText}`;
            }
            avatarStatusTextEl.textContent = formattedText;
            avatarStatusPillEl.classList.remove('hidden');
          }
        }
      }

      latestMuseSyncedState = state;
      if (isWakingForLiveQuotes && state !== 'idle') {
        return;
      }
      if (state === 'working' || state === 'making_something' || state === 'waking') {
        recordInteraction();
        setAvatarState(state, { force: true });
      } else if (state === 'milestone_level_up') {
        recordInteraction();
        setAvatarState('milestone_level_up', { durationMs: 6000, lockDuration: true, force: true });
      } else if (state === 'idle') {
        // When Muse finishes working and returns to idle, immediately show the full text if a reply message is pending
        if (pendingAssistantText && pendingAssistantText !== lastSeenAssistantText) {
          commitPendingAssistantMessage();
        }
        // Don't overwrite with idle during a touch reaction or a 3-minute idle action
        if (!isSpecialActionLocked) {
          // Issue #36: remove the celebration pose when work completes; return directly to the normal idle state
          if (currentAvatarState !== 'idle') {
            setAvatarState('idle');
          }
        }
      }
    }
  } catch (_) {}
}

// ==========================================
// 2. Chat thread (R2)
// ==========================================
async function loadChatMessages() {
  if (isNavigatingForWake) return;
  chatSyncIndicator.classList.add('syncing');
  try {
    const messages = await invoke('get_chat_messages', { limit: currentLimit });
    if (isNavigatingForWake) return;
    if (!isWakingForLiveQuotes) {
      renderMessages(messages);
    }

    // Detect new assistant messages & sync the avatar state with the conversation
    if (messages && messages.length > 0) {
      const assistantMsgs = messages.filter(m => m.role === 'assistant');
      const latestAssistantObj = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1] : null;
      const latestAssistant = latestAssistantObj ? latestAssistantObj.text : null;
      const latestOptions = latestAssistantObj ? (latestAssistantObj.options || []) : [];
      if (latestAssistant) {
        if (lastSeenAssistantText === null) {
          // On first launch: only record the latest past message (don't suddenly type out the past log on first launch)
          lastSeenAssistantText = latestAssistant;
        } else if (latestAssistant !== lastSeenAssistantText) {
          // Received a new message, or one mid-stream!
          pendingAssistantText = latestAssistant;
          const isWakeMsg = isWakingForLiveQuotes || isLiveQuotesResponse(latestAssistant);
          if (!isWakeMsg) recordInteraction();

          // In mascot mode, immediately show the latest reply text in the bubble (update instantly from "Thinking…" to the latest answer, with seamless appending)
          // But suppress the tap-tap sound and bubble playback while the session screen is shown or during a wake (Issue #29, #46)
          if (document.body.classList.contains('mode-mascot') && !isSessionVisible) {
            if (!isWakeMsg) playLupinTyping(latestAssistant, latestOptions);
          }

          if (assistantCommitTimer) {
            clearTimeout(assistantCommitTimer);
            assistantCommitTimer = null;
          }

          // When text stops growing/updating for 2.0 seconds, treat it as generation complete and run the completion reaction
          assistantCommitTimer = setTimeout(() => {
            commitPendingAssistantMessage();
          }, 2000);
        } else if (latestOptions.length > 0 && (!currentTypingOptions || currentTypingOptions.length === 0)) {
          // Extra handling for when the option buttons render late, after the body text (Issue #32)
          // Only apply this when the bubble is showing "this message itself".
          // (Prevents the pre-answer message's options from reappearing while "Sending…" is shown after an option click)
          const isShowingThisMessage = currentTypingTargetText === cleanMascotMessageText(latestAssistant);
          if (isShowingThisMessage && !mascotBubble.classList.contains('hidden') && !typingTimer) {
            currentTypingOptions = latestOptions;
            renderMascotOptions(latestOptions);
          }
        }
      }
    }

    const now = new Date();
    footerSyncTime.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} synced`;
    statusDot.className = 'status-dot active';
  } catch (err) {
    console.warn('loadChatMessages error:', err);
    // No messages yet, or not signed in
    if (chatMessagesContainer.children.length === 0 || chatMessagesContainer.querySelector('.chat-placeholder')) {
      showEmptyPlaceholder('No Muse messages found. Please sign in on the session screen.');
      statusDot.className = 'status-dot warning';
    }
  } finally {
    chatSyncIndicator.classList.remove('syncing');
  }
}

function renderMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    showEmptyPlaceholder('No messages yet.');
    return;
  }

  chatMessagesContainer.innerHTML = '';
  messages.forEach(msg => {
    const row = document.createElement('div');
    row.className = `chat-bubble-row ${msg.role === 'user' ? 'user' : 'assistant'}`;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`;
    bubble.textContent = msg.text;

    row.appendChild(bubble);
    chatMessagesContainer.appendChild(row);
  });

  // Scroll to the bottom
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

function showEmptyPlaceholder(msg) {
  chatMessagesContainer.innerHTML = `
    <div class="chat-placeholder">
      <p class="placeholder-main">${msg}</p>
      <p class="placeholder-sub">* Press [↻] after signing in to sync</p>
      <button class="btn-login-open" id="btn-open-session-placeholder">🖥️ Open the session screen</button>
    </div>
  `;
  const pBtn = document.getElementById('btn-open-session-placeholder');
  if (pBtn) {
    pBtn.addEventListener('click', toggleSessionWindow);
  }
}

// ==========================================
// 3. Sending messages (R3)
// ==========================================
async function handleSendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.disabled = true;
  btnSendMessage.disabled = true;
  recordInteraction();
  setAvatarState('working');

  // If a dedicated chat was opened while waiting for a wake, return to the previous chat first
  if (liveQuotesPrevChatUrl) {
    isWakingForLiveQuotes = false;
    await restoreSessionUrlAfterWake();
  }

  try {
    // Immediately reflect your own previous message (optimistic UI)
    const row = document.createElement('div');
    row.className = 'chat-bubble-row user';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble user';
    bubble.textContent = text;
    row.appendChild(bubble);
    chatMessagesContainer.appendChild(row);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;

    chatInput.value = '';
    adjustTextareaHeight();

    await invoke('send_chat_message', { text });

    // Re-fetch after 1.5s and 4s to reflect Muse's reply
    setTimeout(loadChatMessages, 1500);
    setTimeout(loadChatMessages, 4000);
  } catch (err) {
    console.error('handleSendMessage error:', err);
    alert('Failed to send message: ' + err);
  } finally {
    chatInput.disabled = false;
    btnSendMessage.disabled = false;
    chatInput.focus();
  }
}

function adjustTextareaHeight() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px';
}

// ==========================================
// 4. Usage limit (window limit) & session auto-recovery (R5, Issue #52)
// ==========================================
const SLEEP_RESUME_THRESHOLD_MS = 3 * 60 * 1000;
const USAGE_LIMIT_FAILURE_THRESHOLD = 2;

let lastHeartbeatAt = Date.now();
let consecutiveUsageLimitFailures = 0;
let hasAttemptedFallbackReloadInEpisode = false;
let isReloadingSession = false;

async function checkAutoReloadGuards() {
  if (isReloadingSession) {
    return { allowed: false, reason: 'already_reloading' };
  }
  if (isSessionVisible) {
    return { allowed: false, reason: 'session_visible' };
  }
  if (isWakingForLiveQuotes || isNavigatingForWake) {
    return { allowed: false, reason: 'wake_in_progress' };
  }
  if (
    isSendingMessage ||
    latestMuseSyncedState === 'working' ||
    latestMuseSyncedState === 'making_something'
  ) {
    return { allowed: false, reason: 'generating_or_sending' };
  }

  const mainDraft = (chatInput?.value || '').trim();
  const miniDraft = (mascotInputField?.value || '').trim();
  if (mainDraft.length > 0 || miniDraft.length > 0) {
    return { allowed: false, reason: 'mascot_draft_present' };
  }

  try {
    const status = await invoke('get_session_status');
    if (status && status.visible) {
      return { allowed: false, reason: 'session_visible' };
    }
    const safety = await invoke('inspect_session_reload_safety');
    if (safety && safety.isGenerating) {
      return { allowed: false, reason: 'session_generating' };
    }
    if (safety && safety.hasDraft) {
      return { allowed: false, reason: 'session_draft_present' };
    }
  } catch (err) {
    console.warn('[SessionRecovery] safety inspection error:', err);
    return { allowed: false, reason: 'safety_check_error' };
  }

  return { allowed: true, reason: null };
}

async function recoverSessionAndRefetchLimit(triggerReason, options = {}) {
  const isForce = options.force === true;
  if (isReloadingSession) {
    console.info('[SessionRecovery] skipped (already_reloading)', { triggerReason });
    invoke('log_session_recovery_event', {
      event: 'reload_skipped',
      detail: `reason=${triggerReason}, guard=already_reloading`
    }).catch(() => {});
    return { executed: false, skippedReason: 'already_reloading' };
  }

  if (!isForce && triggerReason === 'usage_limit_consecutive_failure' && hasAttemptedFallbackReloadInEpisode) {
    console.info('[SessionRecovery] skipped (episode_limit_reached)', { triggerReason });
    invoke('log_session_recovery_event', {
      event: 'reload_skipped',
      detail: `reason=${triggerReason}, guard=episode_limit_reached`
    }).catch(() => {});
    return { executed: false, skippedReason: 'episode_limit_reached' };
  }

  if (!isForce) {
    const guard = await checkAutoReloadGuards();
    if (!guard.allowed) {
      console.info('[SessionRecovery] skipped by guard', { triggerReason, guardReason: guard.reason });
      invoke('log_session_recovery_event', {
        event: 'reload_skipped',
        detail: `reason=${triggerReason}, guard=${guard.reason}`
      }).catch(() => {});
      return { executed: false, skippedReason: guard.reason };
    }
  }

  if (!isForce && triggerReason === 'usage_limit_consecutive_failure') {
    hasAttemptedFallbackReloadInEpisode = true;
  }

  isReloadingSession = true;
  try {
    console.info('[SessionRecovery] starting session reload', { triggerReason, force: isForce });
    const res = await invoke('reload_session', { reason: triggerReason, force: isForce });
    if (!res || !res.executed) {
      console.info('[SessionRecovery] reload skipped by backend', { triggerReason, res });
      return res || { executed: false, skippedReason: 'backend_skipped' };
    }

    if (!res.url_matched) {
      console.warn('[SessionRecovery] chat URL changed across reload', {
        triggerReason,
        beforeUrl: res.before_url,
        afterUrl: res.after_url
      });
    }

    if (res.ready) {
      console.info('[SessionRecovery] reload ready; refetching usage limit', {
        triggerReason,
        urlMatched: res.url_matched,
        afterUrl: res.after_url
      });
      await loadUsageLimit(true, { skipFallbackReload: true, allowDuringReload: true });
    } else {
      console.warn('[SessionRecovery] reload finished without chat ready', { triggerReason, res });
    }
    return res;
  } catch (err) {
    console.warn('[SessionRecovery] reload error:', err);
    invoke('log_session_recovery_event', {
      event: 'reload_error',
      detail: `reason=${triggerReason}, error=${err?.message || String(err)}`
    }).catch(() => {});
    return { executed: false, success: false, error: String(err) };
  } finally {
    isReloadingSession = false;
  }
}

async function loadUsageLimit(forceRefresh = false, options = {}) {
  if (isReloadingSession && !options.allowDuringReload) return;

  let fetchedValid = false;
  try {
    const limit = await invoke('get_usage_limit', { forceRefresh });
    if (limit) {
      planBadge.textContent = limit.plan_name || 'Free Plan';

      if (limit.remaining_percent !== null && limit.remaining_percent !== undefined) {
        fetchedValid = true;
        const pct = limit.remaining_percent;
        limitPercentText.textContent = `${pct}% left`;
        limitProgressBar.style.width = `${pct}%`;

        limitProgressBar.className = 'progress-bar';
        let limitLevel = 'safe';
        if (pct >= 80) {
          limitLevel = 'safe';
          limitPercentText.style.color = 'var(--color-safe)';
        } else if (pct >= 30) {
          limitLevel = 'warn';
          limitProgressBar.classList.add('warn');
          limitPercentText.style.color = 'var(--color-warn)';
        } else {
          limitLevel = 'danger';
          limitProgressBar.classList.add('danger');
          limitPercentText.style.color = 'var(--color-danger)';
        }

        // Link the mascot avatar's outer border color and glow effect (Issue #19)
        if (avatarContainer) {
          avatarContainer.classList.remove('limit-safe', 'limit-warn', 'limit-danger');
          avatarContainer.classList.add(`limit-${limitLevel}`);
        }

        // Update the % badge inside the nameplate (Issue #19)
        if (avatarLimitBadgeEl) {
          avatarLimitBadgeEl.textContent = `${pct}%`;
          avatarLimitBadgeEl.className = `avatar-limit-badge limit-${limitLevel}`;
          avatarLimitBadgeEl.title = `Available usage: ${pct}% remaining (${limit.reset_text || ''})`;
        }
      } else {
        if (limit.used_percent !== null && limit.used_percent !== undefined) {
          fetchedValid = true;
        }
        // If a valid percentage is already shown, keep it instead of clearing it to '--%'
        const curBadge = avatarLimitBadgeEl ? avatarLimitBadgeEl.textContent.trim() : '';
        if (!curBadge || curBadge === '--%') {
          limitPercentText.textContent = '--%';
          limitProgressBar.style.width = '0%';
          if (avatarContainer) {
            avatarContainer.classList.remove('limit-safe', 'limit-warn', 'limit-danger');
          }
          if (avatarLimitBadgeEl) {
            avatarLimitBadgeEl.textContent = '--%';
            avatarLimitBadgeEl.className = 'avatar-limit-badge';
          }
        }
      }

      limitResetText.textContent = limit.reset_text || 'Usage limit info not fetched';
    }
  } catch (err) {
    console.warn('loadUsageLimit error:', err);
  }

  if (fetchedValid) {
    if (consecutiveUsageLimitFailures > 0 || options.allowDuringReload) {
      invoke('log_session_recovery_event', {
        event: 'usage_limit_refetch_ok',
        detail: `after_failures=${consecutiveUsageLimitFailures}`
      }).catch(() => {});
    }
    consecutiveUsageLimitFailures = 0;
    hasAttemptedFallbackReloadInEpisode = false;
  } else if (forceRefresh && !isSessionVisible) {
    consecutiveUsageLimitFailures += 1;
    console.warn('[SessionRecovery] forced usage limit fetch failed', {
      consecutiveUsageLimitFailures,
      hasAttemptedFallbackReloadInEpisode
    });
    invoke('log_session_recovery_event', {
      event: 'usage_limit_fetch_failed',
      detail: `consecutive=${consecutiveUsageLimitFailures}, fallback_used=${hasAttemptedFallbackReloadInEpisode}`
    }).catch(() => {});

    if (
      !options.skipFallbackReload &&
      !hasAttemptedFallbackReloadInEpisode &&
      consecutiveUsageLimitFailures >= USAGE_LIMIT_FAILURE_THRESHOLD
    ) {
      await recoverSessionAndRefetchLimit('usage_limit_consecutive_failure');
    }
  }
}

// ==========================================
// 5. Window / session / size control (R4, R6, R7)
// ==========================================
async function toggleSessionWindow() {
  try {
    if (isSessionVisible) {
      await invoke('hide_session');
      isSessionVisible = false;
      setTimeout(() => loadUsageLimit(true), 300);
    } else {
      if (liveQuotesPrevChatUrl) {
        isWakingForLiveQuotes = false;
        await restoreSessionUrlAfterWake();
      }
      hideMascotBubble();
      await invoke('open_or_show_session');
      isSessionVisible = true;
    setTimeout(() => loadUsageLimit(false), 800);
    }
    updateSessionStatus();
  } catch (err) {
    console.error('toggleSessionWindow error:', err);
  }
}

async function updateSessionStatus() {
  try {
    const status = await invoke('get_session_status');
    isSessionVisible = status.visible;
    if (isSessionVisible) {
      clearUnreadBadge();
    }
  } catch (err) {
    console.warn('updateSessionStatus error:', err);
  }
}

async function toggleSizeMode() {
  try {
    const newMode = await invoke('toggle_size_mode');
    applySizeMode(newMode);
  } catch (err) {
    console.error('toggleSizeMode error:', err);
  }
}

async function enterMascotMode() {
  try {
    const newMode = await invoke('enter_mascot_mode');
    applySizeMode(newMode);
    recordInteraction();
    setAvatarState('waking', { durationMs: 3500 });
  } catch (err) {
    console.error('enterMascotMode error:', err);
  }
}

/**
 * To prevent a :hover-equivalent state from lingering in WebView2 when the window is hidden,
 * explicitly reset the JS-managed hover class (.is-hovered) (Issue #61)
 */
function clearMascotHoverState() {
  [avatarColumn, avatarContainer, mascotRestoreBtn, btnMascotQuickInput].forEach((el) => {
    if (el) el.classList.remove('is-hovered');
  });
}

async function restoreFromMascot() {
  try {
    clearMascotHoverState();
    hideMascotBubble();
    clearUnreadBadge();
    if (liveQuotesPrevChatUrl) {
      isWakingForLiveQuotes = false;
      await restoreSessionUrlAfterWake();
    }
    isSessionVisible = true;
    // Show the session window (official screen) in front instead of the medium/small screens
    await invoke('open_or_show_session');
  } catch (err) {
    console.error('restoreFromMascot to session error:', err);
  }
}

// (Kept) Restore to the old gadget medium/small screens
async function restoreToLegacyGadget() {
  try {
    const newMode = await invoke('restore_from_mascot');
    applySizeMode(newMode);
  } catch (err) {
    console.error('restoreToLegacyGadget error:', err);
  }
}

function applySizeMode(mode) {
  document.body.classList.remove('mode-small', 'mode-large', 'mode-mascot');
  if (mode === 'mascot') {
    document.body.classList.add('mode-mascot');
    scheduleSyncMascotHitRects();
  } else if (mode === 'large') {
    document.body.classList.add('mode-large');
    hideMascotBubble();
    closeMascotInput();
  } else {
    document.body.classList.add('mode-small');
    hideMascotBubble();
    closeMascotInput();
  }
}

function applyMascotScale(scale) {
  document.body.classList.remove('scale-small', 'scale-standard', 'scale-large');
  const validScale = (scale === 'large' || scale === 'small') ? scale : 'standard';
  document.body.classList.add(`scale-${validScale}`);
  scheduleSyncMascotHitRects();
}

// ==========================================
// Initialization & event listeners
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  // Window drag (normal header)
  dragHeader.addEventListener('mousedown', (e) => {
    if (e.target.closest('.header-controls') || e.target.closest('.avatar-wrapper')) return;
    invoke('drag_window').catch(console.error);
  });

  // Avatar drag & click separation control in mascot mode
  let isPointerDownOnAvatar = false;
  let isDraggingAvatar = false;
  let avatarDownX = 0;
  let avatarDownY = 0;

  // Nameplate (Lucky 50%): separate drag and click so a manual instant refresh reliably fires
  if (avatarNameEl) {
    let nameMouseDownPos = null;
    avatarNameEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      nameMouseDownPos = { x: e.screenX, y: e.screenY, time: Date.now() };
    });

    avatarNameEl.addEventListener('pointermove', (e) => {
      if (!nameMouseDownPos) return;
      const dist = Math.hypot(e.screenX - nameMouseDownPos.x, e.screenY - nameMouseDownPos.y);
      if (dist > 5) {
        nameMouseDownPos = null;
        if (document.body.classList.contains('mode-mascot')) {
          invoke('drag_window').then(() => {
            setTimeout(updateMascotBubbleDirection, 40);
          }).catch(console.error);
        }
      }
    });

    avatarNameEl.addEventListener('pointerup', (e) => {
      if (!nameMouseDownPos) return;
      const dist = Math.hypot(e.screenX - nameMouseDownPos.x, e.screenY - nameMouseDownPos.y);
      const elapsed = Date.now() - nameMouseDownPos.time;
      nameMouseDownPos = null;
      // If the move is within 5px and the press is within 500ms, treat it as a "click" and run a manual instant refresh!
      if (dist <= 5 && elapsed < 500) {
        avatarNameEl.classList.remove('refreshing');
        void avatarNameEl.offsetWidth; // Reflow
        avatarNameEl.classList.add('refreshing');
        setTimeout(() => avatarNameEl.classList.remove('refreshing'), 600);
        loadUsageLimit(true);
      }
    });
  }

  // Avatar body (avatarContainer): press started
  avatarContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('#mascot-restore-btn') || e.target.closest('#btn-fetch-avatar')) return;
    isPointerDownOnAvatar = true;
    isDraggingAvatar = false;
    avatarDownX = e.screenX;
    avatarDownY = e.screenY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPointerDownOnAvatar || isDraggingAvatar) return;
    const dx = e.screenX - avatarDownX;
    const dy = e.screenY - avatarDownY;
    if (Math.hypot(dx, dy) > 6) {
      isDraggingAvatar = true;
      if (document.body.classList.contains('mode-mascot')) {
        invoke('drag_window').then(() => {
          isPointerDownOnAvatar = false;
          isDraggingAvatar = false;
          // When the drag ends, restore the hover display if the cursor is still over the avatar (Issue #62)
          [avatarColumn, avatarContainer, mascotRestoreBtn, btnMascotQuickInput].forEach((el) => {
            if (el && typeof el.matches === 'function' && el.matches(':hover')) {
              el.classList.add('is-hovered');
            }
          });
          setTimeout(updateMascotBubbleDirection, 40);
        }).catch(console.error);
      }
    }
  });

  // Drag end or click detection
  window.addEventListener('mouseup', () => {
    if (isPointerDownOnAvatar) {
      const wasDragging = isDraggingAvatar;
      isPointerDownOnAvatar = false;
      isDraggingAvatar = false;

      // If released after moving less than 6px, run it as a click
      if (!wasDragging) {
        handleAvatarClickAction();
      } else if (document.body.classList.contains('mode-mascot')) {
        setTimeout(updateMascotBubbleDirection, 40);
      }
    }
  });

  // Fully reset the drag state when focus is lost or the mouse leaves
  window.addEventListener('blur', () => {
    isPointerDownOnAvatar = false;
    isDraggingAvatar = false;
  });

  // F12 shortcut to open the developer tools
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F12') {
      invoke('open_mascot_devtools').catch(() => {});
    }
  });

  // Minimize button (switch to mascot mode)
  btnMinimize.addEventListener('click', enterMascotMode);

  // Mascot restore button
  if (mascotRestoreBtn) {
    mascotRestoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      restoreFromMascot();
    });
  }

  // Hover state management (Issue #61: prevent :hover lingering when the window is hidden / Issue #62: restore after dragging)
  [avatarColumn, avatarContainer, mascotRestoreBtn, btnMascotQuickInput].forEach((el) => {
    if (!el) return;
    el.addEventListener('pointerenter', () => {
      if (!isDraggingAvatar) el.classList.add('is-hovered');
    });
    el.addEventListener('pointermove', () => {
      if (!isDraggingAvatar && !el.classList.contains('is-hovered')) {
        el.classList.add('is-hovered');
      }
    });
    el.addEventListener('pointerleave', () => el.classList.remove('is-hovered'));
  });
  window.addEventListener('blur', clearMascotHoverState);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearMascotHoverState();
  });

  // Bubble click (return to the normal screen)
  if (mascotBubble) {
    mascotBubble.addEventListener('click', (e) => {
      if (e.target.closest('#btn-bubble-close')) return;
      restoreFromMascot();
    });
  }

  // Bubble close button
  if (btnBubbleClose) {
    btnBubbleClose.addEventListener('click', (e) => {
      e.stopPropagation();
      hideMascotBubble();
    });
  }

  // Close
  btnClose.addEventListener('click', () => invoke('close_window'));

  // Open in browser (R6)
  btnOpenBrowser.addEventListener('click', () => invoke('open_in_browser'));

  // Session show / hide toggle
  btnToggleSession.addEventListener('click', toggleSessionWindow);

  // Toggle size (R7)
  btnToggleSize.addEventListener('click', toggleSizeMode);

  // Sync everything now (run serially to fetch reliably)
  btnRefreshAll.addEventListener('click', async () => {
    btnRefreshAll.style.transform = 'rotate(180deg)';
    setTimeout(() => { btnRefreshAll.style.transform = ''; }, 300);
    await runHealthCheck();
    await loadChatMessages();
    await loadAvatar(false);
    await loadUsageLimit(true);
  });

  // Avatar click control (single click: poke for a happy reaction / double click: restore the screen)
  let avatarClickTimer = null;
  let avatarClickCount = 0;

  function handleAvatarClickAction() {
    recordInteraction();
    avatarClickCount++;
    if (avatarClickCount === 1) {
      avatarClickTimer = setTimeout(() => {
        avatarClickCount = 0;
        // Single click: poke to react (hold for setting.json's touch_reaction_duration_sec seconds + a remark)
        const touchDurationMs = Math.max(1, Number(pluginSettings.touch_reaction_duration_sec) || 8) * 1000;
        setAvatarState('milestone_level_up', { durationMs: touchDurationMs, lockDuration: true, force: true });
        playTouchReactionSound();
        if (document.body.classList.contains('mode-mascot') && touchReactionsList.length > 0) {
          const reaction = touchReactionsList[Math.floor(Math.random() * touchReactionsList.length)];
          playLupinTyping(reaction, [], { kind: 'quote' });
        }
      }, 260);
    } else if (avatarClickCount >= 2) {
      clearTimeout(avatarClickTimer);
      avatarClickCount = 0;
      // Double click: restore to the normal screen (or session)
      if (document.body.classList.contains('mode-mascot')) {
        restoreFromMascot();
      } else {
        openOrShowSession();
      }
    }
  }

  // Suppress the standard browser context menu (reload, etc.) across the whole screen
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // Right-click in mascot mode: toggle the quick input bar (Issue #27)
  const handleMascotContextMenu = (e) => {
    recordInteraction();
    if (document.body.classList.contains('mode-mascot')) {
      e.preventDefault();
      e.stopPropagation();
      toggleMascotInput();
    }
  };
  avatarContainer.addEventListener('contextmenu', handleMascotContextMenu);
  if (mascotBubble) {
    mascotBubble.addEventListener('contextmenu', handleMascotContextMenu);
  }

  // Quick mini input bar event registration (Issue #27)
  if (btnMascotQuickInput) {
    btnMascotQuickInput.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    btnMascotQuickInput.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleMascotInput();
    });
  }
  if (btnMascotInputSend) {
    btnMascotInputSend.addEventListener('click', (e) => {
      e.stopPropagation();
      sendMascotQuickMessage();
    });
  }
  if (btnMascotInputClose) {
    btnMascotInputClose.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMascotInput();
    });
  }
  if (mascotInputField) {
    // Reliably play the tap-tap keystroke sound for Japanese IME input and regular character input
    mascotInputField.addEventListener('input', () => {
      playTypingSound();
      if (activeShortcutPrompt && mascotInputField.value !== activeShortcutPrompt) {
        resetMascotShortcutSelection();
      }
    });
    mascotInputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.isComposing) return;
        e.preventDefault();
        sendMascotQuickMessage();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeMascotInput();
      } else if (e.key === 'Backspace' || e.key === 'Delete' || (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey)) {
        playTypingSound();
      }
    });
  }
  if (btnFetchAvatar) {
    btnFetchAvatar.addEventListener('click', (e) => {
      e.stopPropagation();
      loadAvatar(true);
    });
  }

  // When the unread badge is clicked: clear the unread state and open the session screen (Issue #20)
  if (unreadBadgeEl) {
    unreadBadgeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      clearUnreadBadge();
      restoreFromMascot();
    });
  }

  // Receive the unread-clear event when the session screen is brought to front / opened (Issue #20, Issue #29)
  if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === 'function') {
    window.__TAURI__.event.listen('clear-unread', () => {
      isSessionVisible = true;
      clearMascotHoverState();
      hideMascotBubble();
      clearUnreadBadge();
    });
    window.__TAURI__.event.listen('session-visibility-changed', (event) => {
      isSessionVisible = !!event.payload;
      clearMascotHoverState();
      if (isSessionVisible) {
        hideMascotBubble();
        clearUnreadBadge();
      } else {
        // The moment you return from the session screen to the mascot screen, auto-fetch the latest usage limit (Issue #33)
        loadUsageLimit(true);
      }
    });
    // Instant hot-reload reflection when settings are saved on the GUI settings screen (Issue #13)
    window.__TAURI__.event.listen('settings-updated', () => {
      refreshPluginConfigs();
    });
    // Receive the mascot scale-change event (Issue #25)
    window.__TAURI__.event.listen('mascot-scale-changed', (event) => {
      applyMascotScale(event.payload);
    });
    // Receive the session screen reload-complete event (manual tray actions, etc.) (Issue #52)
    window.__TAURI__.event.listen('session-reloaded', (event) => {
      const payload = event?.payload || {};
      console.info('[SessionRecovery] session-reloaded event', payload);
      if (!isReloadingSession && payload.executed && payload.ready) {
        loadUsageLimit(true, { skipFallbackReload: true });
      }
    });
  }

  // On initial launch, reliably hide the unread badge (Issue #20)
  clearUnreadBadge();

  // Re-fetch the usage limit
  btnRefreshLimit.addEventListener('click', () => loadUsageLimit(true));

  // Change the number of messages shown
  msgLimitSelect.addEventListener('change', () => {
    currentLimit = parseInt(msgLimitSelect.value, 10) || 5;
    loadChatMessages();
  });

  // Send a message
  btnSendMessage.addEventListener('click', handleSendMessage);

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.isComposing) return;
      e.preventDefault();
      handleSendMessage();
    }
  });

  chatInput.addEventListener('input', adjustTextareaHeight);

  // Load the initial settings
  try {
    const config = await invoke('get_gadget_config');
    if (config) {
      applyMascotBubbleDirectionClass(config.mascot_bubble_on_left !== false);
      applySizeMode(config.size_mode || 'small');
      applyMascotScale(config.mascot_scale || 'standard');
      if (config.message_limit) {
        currentLimit = config.message_limit;
        msgLimitSelect.value = String(currentLimit);
      }
      if (config.avatar_name) {
        if (avatarNameTextEl) {
          avatarNameTextEl.textContent = config.avatar_name;
        } else if (avatarNameEl) {
          avatarNameEl.textContent = config.avatar_name;
        }
      }
    }
  } catch (e) {
    console.warn('Config load error:', e);
  }

  // Initial data fetch (serial execution + retry while waiting for the session WebView to load)
  const syncAllSequential = async (forceLimit = false) => {
    await updateSessionStatus();
    await loadAvatar(false);
    await loadUsageLimit(forceLimit);
    await loadChatMessages();
    await runHealthCheck();
  };

  // Immediately show the cached avatar and usage limit
  loadLiveQuotesPool();
  loadAvatar(false);
  loadUsageLimit(false);

  // Clicking the nameplate manually re-fetches and refreshes the usage limit
  if (avatarNameEl) {
    avatarNameEl.addEventListener('click', (e) => {
      e.stopPropagation();
      loadUsageLimit(true);
    });
  }

  // Sync chat, health check, and usage limit in stages as the session WebView finishes loading
  setTimeout(() => syncAllSequential(false), 1800);
  setTimeout(async () => {
    await syncAllSequential(false);
    if (!isSessionVisible) {
      loadUsageLimit(true);
    }
  }, 4500);
  setTimeout(async () => {
    await syncAllSequential(false);
    const curBadge = avatarLimitBadgeEl ? avatarLimitBadgeEl.textContent.trim() : '';
    if (!isSessionVisible && (!curBadge || curBadge === '--%')) {
      loadUsageLimit(true);
    }
  }, 9000);
  setTimeout(async () => {
    await syncAllSequential(false);
    const curBadge = avatarLimitBadgeEl ? avatarLimitBadgeEl.textContent.trim() : '';
    if (!isSessionVisible && (!curBadge || curBadge === '--%')) {
      loadUsageLimit(true);
    }
  }, 16000);

  // Every 3 seconds: real-time working-state & chat sync, settings hot-reload, idle monitoring, and sleep-resume detection
  setInterval(async () => {
    const nowTick = Date.now();
    const tickElapsedMs = nowTick - lastHeartbeatAt;
    lastHeartbeatAt = nowTick;

    if (tickElapsedMs >= SLEEP_RESUME_THRESHOLD_MS) {
      console.info('[SessionRecovery] sleep resume detected', { tickElapsedMs });
      invoke('log_session_recovery_event', {
        event: 'sleep_resume_detected',
        detail: `elapsed_ms=${tickElapsedMs}`
      }).catch(() => {});
      await recoverSessionAndRefetchLimit('sleep_resume');
    }

    if (!isReloadingSession) {
      await refreshPluginConfigs();
      await updateSessionStatus(); // Sync the session open/closed state
      await loadChatMessages();
      await syncAvatarStateWithMuse();
      checkIdleAction();
      maybeTriggerLiveQuotesWake();
      loadUsageLimit(false);
      ensureActiveAvatarSlot(); // Periodic self-repair check (Issue #31)
    }
  }, 3000);

  // Automatic background sync every 12 seconds (chat & health check)
  setInterval(async () => {
    await updateSessionStatus();
    await runHealthCheck();
    await loadChatMessages();
  }, 12000);

  // §16 Automatic usage-limit fetch every 5 minutes (guardrail 1: only while the session screen is hidden, Issue #49)
  setInterval(async () => {
    await updateSessionStatus();
    invoke('log_session_recovery_event', {
      event: 'usage_limit_timer_5m',
      detail: `isSessionVisible=${isSessionVisible}`
    }).catch(() => {});
    if (!isSessionVisible) {
      await loadUsageLimit(true);
    }
  }, 300000);

  // One-click shortcut initialization (Issue #68)
  renderMascotShortcuts();

  // Interactive rectangle monitoring in mascot mode (Issue #60)
  const hitTargets = ['avatar-column', 'mascot-bubble', 'mascot-input-bar']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (typeof ResizeObserver === 'function' && hitTargets.length > 0) {
    const ro = new ResizeObserver(() => scheduleSyncMascotHitRects());
    hitTargets.forEach((el) => ro.observe(el));
  }
  if (typeof MutationObserver === 'function' && hitTargets.length > 0) {
    const mo = new MutationObserver(() => scheduleSyncMascotHitRects());
    hitTargets.forEach((el) => mo.observe(el, { attributes: true, attributeFilter: ['class', 'style'] }));
  }
  scheduleSyncMascotHitRects();
});
