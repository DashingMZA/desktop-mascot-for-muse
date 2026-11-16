// settings.js - Desktop Mascot for Muse settings screen controller

const invoke = window.__TAURI__ ? window.__TAURI__.core.invoke : async (cmd, args) => {
  console.log(`[Mock Settings Invoke] ${cmd}`, args);
  if (cmd === 'get_plugin_configs') {
    return {
      setting: {
        idle_threshold_sec: 180,
        action_interval_sec: 180,
        default_duration_sec: 30,
        bubble_display_duration_sec: 30,
        touch_reaction_duration_sec: 8,
        avatar_name: "Lucky"
      },
      quotes: {
        touch_reactions: [
          "Yaaay! Did you call me?",
          "What is it~?",
          "I'm right here!",
          "Let's do our best!"
        ],
        default_idle_quotes: [
          "Call me anytime!",
          "Such lovely weather today!",
          "Let's have some tea and take a break!"
        ],
        videos: {
          "eating.mp4": {
            enabled: true,
            duration_sec: 20,
            weight: 2,
            quotes: [
              "Nom nom… this taiyaki is so sweet and yummy!",
              "Time for a little snack break♪"
            ]
          },
          "makeup.mp4": {
            enabled: true,
            duration_sec: 20,
            weight: 1,
            quotes: [
              "Just doing a quick appearance check…♪",
              "Alright, looking perfect today!"
            ]
          },
          "sleeping.mp4": {
            enabled: true,
            duration_sec: 40,
            weight: 1,
            quotes: [
              "Zzz… just a tiny nap…",
              "Yaaawn… I'm getting a little sleepy… zzZ"
            ]
          },
          "smartphone.mp4": {
            enabled: true,
            duration_sec: 20,
            weight: 3,
            quotes: [
              "Just checking the latest trends on my phone~",
              "Hmm, I found some interesting news!"
            ]
          }
        }
      }
    };
  }
  return true;
};

// Keep state
let currentSetting = {};
let currentQuotes = {
  touch_reactions: [],
  default_idle_quotes: [],
  videos: {}
};

// DOM elements
const tabs = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

const inputAvatarName = document.getElementById('input-avatar-name');
const inputIdleThreshold = document.getElementById('input-idle-threshold');
const inputActionInterval = document.getElementById('input-action-interval');
const inputDefaultDuration = document.getElementById('input-default-duration');
const inputBubbleDuration = document.getElementById('input-bubble-duration');
const inputTouchDuration = document.getElementById('input-touch-duration');

const toggleSoundEnabled = document.getElementById('toggle-sound-enabled');
const inputSoundVolume = document.getElementById('input-sound-volume');
const soundVolumeDisplay = document.getElementById('sound-volume-display');
const btnTestSound = document.getElementById('btn-test-sound');

const scaleRadios = document.querySelectorAll('input[name="mascot-scale"]');

const touchQuotesListEl = document.getElementById('touch-quotes-list');
const btnAddTouchQuote = document.getElementById('btn-add-touch-quote');
const idleQuotesListEl = document.getElementById('idle-quotes-list');
const btnAddIdleQuote = document.getElementById('btn-add-idle-quote');

const morningQuotesListEl = document.getElementById('morning-quotes-list');
const btnAddMorningQuote = document.getElementById('btn-add-morning-quote');
const afternoonQuotesListEl = document.getElementById('afternoon-quotes-list');
const btnAddAfternoonQuote = document.getElementById('btn-add-afternoon-quote');
const eveningQuotesListEl = document.getElementById('evening-quotes-list');
const btnAddEveningQuote = document.getElementById('btn-add-evening-quote');
const nightQuotesListEl = document.getElementById('night-quotes-list');
const btnAddNightQuote = document.getElementById('btn-add-night-quote');

// Live remark generation (wake method) elements (Issue #37)
const liveQuotesEnabled = document.getElementById('live-quotes-enabled');
const liveQuotesTargetRadios = document.querySelectorAll('input[name="live-quotes-target-mode"]');
const liveQuotesCustomUrlGroup = document.getElementById('live-quotes-custom-url-group');
const liveQuotesCustomUrl = document.getElementById('live-quotes-custom-url');
const btnFillCurrentChatUrl = document.getElementById('btn-fill-current-chat-url');
const liveQuotesBatchCount = document.getElementById('live-quotes-batch-count');
const liveQuotesMinInterval = document.getElementById('live-quotes-min-interval');
const liveQuotesDailyLimit = document.getElementById('live-quotes-daily-limit');
const liveQuotesQuietStart = document.getElementById('live-quotes-quiet-start');
const liveQuotesQuietEnd = document.getElementById('live-quotes-quiet-end');

function updateLiveQuotesCustomUrlVisibility() {
  const checked = document.querySelector('input[name="live-quotes-target-mode"]:checked');
  const isCustom = checked && checked.value === 'custom';
  if (liveQuotesCustomUrlGroup) {
    liveQuotesCustomUrlGroup.style.display = isCustom ? 'flex' : 'none';
  }
}

liveQuotesTargetRadios.forEach(radio => {
  radio.addEventListener('change', updateLiveQuotesCustomUrlVisibility);
});

if (btnFillCurrentChatUrl) {
  btnFillCurrentChatUrl.addEventListener('click', async () => {
    try {
      btnFillCurrentChatUrl.disabled = true;
      btnFillCurrentChatUrl.textContent = 'Fetching...';
      const status = await invoke('get_session_status');
      if (status && status.url && (status.url.startsWith('http://') || status.url.startsWith('https://'))) {
        if (liveQuotesCustomUrl) {
          liveQuotesCustomUrl.value = status.url;
        }
        showStatus('Applied the URL of the currently open chat', 'success');
      } else {
        showStatus('Could not get a valid chat URL (open a chat in the session first, then try again)', 'error');
      }
    } catch (err) {
      console.error('Failed to get session status:', err);
      showStatus('Failed to get the URL: ' + (err?.message || err), 'error');
    } finally {
      btnFillCurrentChatUrl.disabled = false;
      btnFillCurrentChatUrl.textContent = "📍 Register the chat that's open now";
    }
  });
}

const videoSettingsList = document.getElementById('video-settings-list');
const btnAddVideo = document.getElementById('btn-add-video');
const btnOpenAvatarsDir = document.getElementById('btn-open-avatars-dir');
const btnOpenPluginDir = document.getElementById('btn-open-plugin-dir');
const btnResetDefaults = document.getElementById('btn-reset-defaults');

const btnCancel = document.getElementById('btn-cancel');
const btnSave = document.getElementById('btn-save');
const statusMessage = document.getElementById('status-message');

// Tab switching control
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tabPanes.forEach(p => p.classList.remove('active'));

    tab.classList.add('active');
    const targetId = tab.getAttribute('data-tab');
    const pane = document.getElementById(targetId);
    if (pane) pane.classList.add('active');
  });
});

// Show the status message
function showStatus(text, type = 'success', durationMs = 3000) {
  statusMessage.textContent = text;
  statusMessage.className = `status-message ${type}`;
  setTimeout(() => {
    if (statusMessage.textContent === text) {
      statusMessage.textContent = '';
      statusMessage.className = 'status-message';
    }
  }, durationMs);
}

// Render a generic string line list
function renderSimpleQuotesList(containerEl, quoteArray, emptyPlaceholder) {
  if (!containerEl) return;
  containerEl.innerHTML = '';

  if (!quoteArray || quoteArray.length === 0) {
    containerEl.innerHTML = `<p class="form-hint" style="padding: 6px 0;">${emptyPlaceholder}</p>`;
    return;
  }

  quoteArray.forEach((text, idx) => {
    const row = document.createElement('div');
    row.className = 'quote-row';
    row.innerHTML = `
      <input type="text" value="${(text || '').replace(/"/g, '&quot;')}" placeholder="Enter a line...">
      <button class="btn-icon-del btn-del" title="Delete">×</button>
    `;

    row.querySelector('input').addEventListener('input', (e) => {
      quoteArray[idx] = e.target.value;
    });

    row.querySelector('.btn-del').addEventListener('click', () => {
      quoteArray.splice(idx, 1);
      renderSimpleQuotesList(containerEl, quoteArray, emptyPlaceholder);
    });

    containerEl.appendChild(row);
  });
}

// Render the plugin video cards
function renderVideoList() {
  if (!videoSettingsList) return;
  videoSettingsList.innerHTML = '';

  const videosObj = currentQuotes.videos || {};
  const entries = Object.entries(videosObj);
  if (entries.length === 0) {
    videoSettingsList.innerHTML = '<p class="form-hint" style="padding: 16px; text-align: center;">No idle video plugins are registered.</p>';
    return;
  }

  entries.forEach(([videoName, config]) => {
    const card = document.createElement('div');
    card.className = 'video-card';

    const isEnabled = config.enabled !== false;
    const duration = config.duration_sec ?? 30;
    const weight = config.weight ?? 10;
    if (!Array.isArray(config.quotes)) {
      config.quotes = [];
    }

    card.innerHTML = `
      <div class="video-card-header">
        <div class="video-title-area">
          <label class="toggle-switch">
            <input type="checkbox" class="video-enabled-toggle" ${isEnabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
          <span class="video-name">${videoName}</span>
        </div>
        <button class="btn-icon-del btn-del-video" title="Delete this video setting">🗑️</button>
      </div>

      <div class="video-card-meta">
        <div class="meta-field">
          <label>Playback time (sec):</label>
          <input type="number" class="video-duration-input" min="5" max="300" value="${duration}">
        </div>
        <div class="meta-field">
          <label>Appearance weight (ratio):</label>
          <input type="number" class="video-weight-input" min="1" max="100" value="${weight}">
        </div>
      </div>

      <div class="quotes-section">
        <div class="quotes-header">
          <span>Dedicated lines (${config.quotes.length}):</span>
        </div>
        <div class="quotes-list"></div>
        <button class="btn-add-quote">+ Add a dedicated line</button>
      </div>
    `;

    // Render the line list
    const quotesListEl = card.querySelector('.quotes-list');
    renderSimpleQuotesList(quotesListEl, config.quotes, 'No dedicated lines (silent, or plays a standard line)');

    // Add-line button
    card.querySelector('.btn-add-quote').addEventListener('click', () => {
      config.quotes.push('New line');
      renderVideoList();
    });

    // Enabled/disabled toggle
    card.querySelector('.video-enabled-toggle').addEventListener('change', (e) => {
      config.enabled = e.target.checked;
    });

    // Playback time
    card.querySelector('.video-duration-input').addEventListener('change', (e) => {
      config.duration_sec = parseInt(e.target.value, 10) || 30;
    });

    // Weight
    card.querySelector('.video-weight-input').addEventListener('change', (e) => {
      config.weight = parseInt(e.target.value, 10) || 10;
    });

    // Delete the video setting
    card.querySelector('.btn-del-video').addEventListener('click', () => {
      if (confirm(`Are you sure you want to delete the video setting "${videoName}"?`)) {
        delete videosObj[videoName];
        renderVideoList();
      }
    });

    videoSettingsList.appendChild(card);
  });
}

// Re-render all sections
function renderAllQuotes() {
  renderSimpleQuotesList(touchQuotesListEl, currentQuotes.touch_reactions, 'No reaction lines are registered.');
  renderSimpleQuotesList(idleQuotesListEl, currentQuotes.default_idle_quotes, 'No regular remark lines are registered.');
  if (currentQuotes.time_specific_quotes) {
    renderSimpleQuotesList(morningQuotesListEl, currentQuotes.time_specific_quotes.morning, 'No morning lines are registered.');
    renderSimpleQuotesList(afternoonQuotesListEl, currentQuotes.time_specific_quotes.afternoon, 'No afternoon lines are registered.');
    renderSimpleQuotesList(eveningQuotesListEl, currentQuotes.time_specific_quotes.evening, 'No evening lines are registered.');
    renderSimpleQuotesList(nightQuotesListEl, currentQuotes.time_specific_quotes.night, 'No late-night lines are registered.');
  }
  renderVideoList();
}

// Load settings
async function loadConfigs() {
  try {
    const res = await invoke('get_plugin_configs');
    currentSetting = res.setting || {};
    const rawQuotes = res.quotes || {};
    const timeQuotes = rawQuotes.time_specific_quotes || {};

    // Normalize the structure
    currentQuotes = {
      touch_reactions: Array.isArray(rawQuotes.touch_reactions) ? rawQuotes.touch_reactions : [],
      default_idle_quotes: Array.isArray(rawQuotes.default_idle_quotes) ? rawQuotes.default_idle_quotes : [],
      time_specific_quotes: {
        morning: Array.isArray(timeQuotes.morning) ? timeQuotes.morning : [],
        afternoon: Array.isArray(timeQuotes.afternoon) ? timeQuotes.afternoon : [],
        evening: Array.isArray(timeQuotes.evening) ? timeQuotes.evening : [],
        night: Array.isArray(timeQuotes.night) ? timeQuotes.night : []
      },
      videos: (rawQuotes.videos && typeof rawQuotes.videos === 'object') ? rawQuotes.videos : {}
    };

    // Bind the timer & basic settings
    if (inputAvatarName) inputAvatarName.value = currentSetting.avatar_name || 'Lucky';
    if (inputIdleThreshold) inputIdleThreshold.value = currentSetting.idle_threshold_sec ?? 180;
    if (inputActionInterval) inputActionInterval.value = currentSetting.action_interval_sec ?? 180;
    if (inputDefaultDuration) inputDefaultDuration.value = currentSetting.default_duration_sec ?? 30;
    if (inputBubbleDuration) inputBubbleDuration.value = currentSetting.bubble_display_duration_sec ?? 30;
    if (inputTouchDuration) inputTouchDuration.value = currentSetting.touch_reaction_duration_sec ?? 8;

    // Bind the sound effects settings (Issue #24)
    if (toggleSoundEnabled) toggleSoundEnabled.checked = currentSetting.sound_enabled !== false;
    const vol = currentSetting.sound_volume ?? 30;
    if (inputSoundVolume) inputSoundVolume.value = vol;
    if (soundVolumeDisplay) soundVolumeDisplay.textContent = `${vol}%`;

    // Bind the live remark generation (wake method) settings (Issue #37)
    const lq = currentSetting.live_quotes || {};
    if (liveQuotesEnabled) liveQuotesEnabled.checked = lq.enabled === true;
    const targetMode = lq.target_mode === 'custom' ? 'custom' : 'main';
    const targetModeRadio = document.querySelector(`input[name="live-quotes-target-mode"][value="${targetMode}"]`);
    if (targetModeRadio) targetModeRadio.checked = true;
    updateLiveQuotesCustomUrlVisibility();
    if (liveQuotesCustomUrl) liveQuotesCustomUrl.value = lq.custom_chat_url || '';
    if (liveQuotesBatchCount) liveQuotesBatchCount.value = lq.batch_count ?? 4;
    if (liveQuotesMinInterval) liveQuotesMinInterval.value = lq.min_interval_min ?? 60;
    if (liveQuotesDailyLimit) liveQuotesDailyLimit.value = lq.daily_limit ?? 6;
    if (liveQuotesQuietStart) liveQuotesQuietStart.value = lq.quiet_hours_start || '22:00';
    if (liveQuotesQuietEnd) liveQuotesQuietEnd.value = lq.quiet_hours_end || '07:00';

    // Bind the mascot display size (scale) (Issue #25)
    try {
      const gConfig = await invoke('get_gadget_config');
      if (gConfig && gConfig.mascot_scale) {
        const targetRadio = document.querySelector(`input[name="mascot-scale"][value="${gConfig.mascot_scale}"]`);
        if (targetRadio) targetRadio.checked = true;
      }
    } catch (_) {}

    renderAllQuotes();
  } catch (err) {
    console.error('Failed to load configs:', err);
    showStatus('Failed to load settings', 'error');
  }
}

// Add-reaction-line button
if (btnAddTouchQuote) {
  btnAddTouchQuote.addEventListener('click', () => {
    currentQuotes.touch_reactions.push('Did you call?');
    renderSimpleQuotesList(touchQuotesListEl, currentQuotes.touch_reactions, 'No reaction lines are registered.');
  });
}

// Add-regular-remark button
if (btnAddIdleQuote) {
  btnAddIdleQuote.addEventListener('click', () => {
    currentQuotes.default_idle_quotes.push("Let's do our best today!");
    renderSimpleQuotesList(idleQuotesListEl, currentQuotes.default_idle_quotes, 'No regular remark lines are registered.');
  });
}

// Add time-of-day remark button
if (btnAddMorningQuote) {
  btnAddMorningQuote.addEventListener('click', () => {
    if (!currentQuotes.time_specific_quotes) currentQuotes.time_specific_quotes = { morning: [], afternoon: [], evening: [], night: [] };
    currentQuotes.time_specific_quotes.morning.push("Good morning! Let's make today a great day!");
    renderSimpleQuotesList(morningQuotesListEl, currentQuotes.time_specific_quotes.morning, 'No morning lines are registered.');
  });
}

if (btnAddAfternoonQuote) {
  btnAddAfternoonQuote.addEventListener('click', () => {
    if (!currentQuotes.time_specific_quotes) currentQuotes.time_specific_quotes = { morning: [], afternoon: [], evening: [], night: [] };
    currentQuotes.time_specific_quotes.afternoon.push("Good afternoon! Let's keep going strong!");
    renderSimpleQuotesList(afternoonQuotesListEl, currentQuotes.time_specific_quotes.afternoon, 'No afternoon lines are registered.');
  });
}

if (btnAddEveningQuote) {
  btnAddEveningQuote.addEventListener('click', () => {
    if (!currentQuotes.time_specific_quotes) currentQuotes.time_specific_quotes = { morning: [], afternoon: [], evening: [], night: [] };
    currentQuotes.time_specific_quotes.evening.push('Great work today! You did so well!');
    renderSimpleQuotesList(eveningQuotesListEl, currentQuotes.time_specific_quotes.evening, 'No evening lines are registered.');
  });
}

if (btnAddNightQuote) {
  btnAddNightQuote.addEventListener('click', () => {
    if (!currentQuotes.time_specific_quotes) currentQuotes.time_specific_quotes = { morning: [], afternoon: [], evening: [], night: [] };
    currentQuotes.time_specific_quotes.night.push('Try not to stay up too late!');
    renderSimpleQuotesList(nightQuotesListEl, currentQuotes.time_specific_quotes.night, 'No late-night lines are registered.');
  });
}

// Add a new video setting
if (btnAddVideo) {
  btnAddVideo.addEventListener('click', () => {
    const fileName = prompt('Enter the video file name to add (e.g. dance.mp4):');
    if (!fileName || !fileName.trim()) return;

    const cleanName = fileName.trim().toLowerCase();
    const validName = cleanName.endsWith('.mp4') ? cleanName : `${cleanName}.mp4`;

    if (!currentQuotes.videos) currentQuotes.videos = {};

    if (currentQuotes.videos[validName]) {
      alert(`"${validName}" is already registered.`);
      return;
    }

    currentQuotes.videos[validName] = {
      enabled: true,
      min_idle_sec: 0,
      max_idle_sec: null,
      time_ranges: ["00:00-23:59"],
      duration_sec: 25,
      weight: 2,
      quote_probability: 1.0,
      quotes: ['This is a new video action!']
    };

    renderVideoList();
  });
}

// When the volume slider changes
if (inputSoundVolume) {
  inputSoundVolume.addEventListener('input', (e) => {
    if (soundVolumeDisplay) soundVolumeDisplay.textContent = `${e.target.value}%`;
  });
}

// Test playback (Web Audio API)
let settingsAudioCtx = null;
function playTestPreviewSound() {
  if (!settingsAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) settingsAudioCtx = new AudioContextClass();
  }
  if (settingsAudioCtx && settingsAudioCtx.state === 'suspended') {
    settingsAudioCtx.resume().catch(() => {});
  }
  if (!settingsAudioCtx) return;

  const isEnabled = toggleSoundEnabled ? toggleSoundEnabled.checked : true;
  if (!isEnabled) {
    showStatus('Sound effects are disabled (turn the toggle ON to hear sound)', 'error');
    return;
  }

  const volumeRatio = (inputSoundVolume ? parseInt(inputSoundVolume.value, 10) : 30) / 100;
  const ctx = settingsAudioCtx;
  const now = ctx.currentTime;

  // 1. Ping♪ notification sound
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

  // 2. Tap-tap-tap… keystroke sounds (right after the notification sound, 7 keystrokes previewed at 70ms intervals starting 0.38s later)
  const configs = [
    { startFreq: 1400, endFreq: 480, lowFreq: 320, noiseMix: 0.08 },
    { startFreq: 1250, endFreq: 420, lowFreq: 280, noiseMix: 0.06 },
    { startFreq: 1550, endFreq: 520, lowFreq: 350, noiseMix: 0.07 },
    { startFreq: 1350, endFreq: 450, lowFreq: 300, noiseMix: 0.09 },
  ];

  for (let k = 0; k < 7; k++) {
    const keyTime = now + 0.38 + (k * 0.07);
    const duration = 0.035;
    const length = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const cfg = configs[k % configs.length];

    for (let j = 0; j < length; j++) {
      const t = j / ctx.sampleRate;
      const freq1 = cfg.startFreq * Math.exp(-t * 180) + cfg.endFreq;
      const attack = Math.sin(2 * Math.PI * freq1 * t) * Math.exp(-t * 150);
      const bottom = Math.sin(2 * Math.PI * cfg.lowFreq * t) * Math.exp(-t * 100);
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 260) * cfg.noiseMix;
      d[j] = (attack * 0.7 + bottom * 0.3 + noise) * (1 - t / duration);
    }
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = volumeRatio * 0.45;
    s.connect(g);
    g.connect(ctx.destination);
    s.start(keyTime);
  }
}

if (btnTestSound) {
  btnTestSound.addEventListener('click', playTestPreviewSound);
}

// Real-time mascot display size (scale) switching (Issue #25)
scaleRadios.forEach(radio => {
  radio.addEventListener('change', async (e) => {
    if (e.target.checked) {
      try {
        await invoke('set_mascot_scale', { scale: e.target.value });
      } catch (err) {
        console.warn('Failed to set mascot scale:', err);
      }
    }
  });
});

// Open-folder buttons
btnOpenAvatarsDir.addEventListener('click', async () => {
  try {
    await invoke('open_avatar_dir', { target: 'avatars' });
  } catch (err) {
    console.error(err);
    showStatus('Could not open the folder', 'error');
  }
});

btnOpenPluginDir.addEventListener('click', async () => {
  try {
    await invoke('open_avatar_dir', { target: 'plugin' });
  } catch (err) {
    console.error(err);
    showStatus('Could not open the folder', 'error');
  }
});

// Reset to default settings
btnResetDefaults.addEventListener('click', () => {
  if (!confirm('Reset the timer and line settings to their initial state?')) return;

  if (inputIdleThreshold) inputIdleThreshold.value = 180;
  if (inputActionInterval) inputActionInterval.value = 180;
  if (inputDefaultDuration) inputDefaultDuration.value = 30;
  if (inputBubbleDuration) inputBubbleDuration.value = 30;
  if (inputTouchDuration) inputTouchDuration.value = 8;
  if (toggleSoundEnabled) toggleSoundEnabled.checked = true;
  if (inputSoundVolume) inputSoundVolume.value = 30;
  if (soundVolumeDisplay) soundVolumeDisplay.textContent = '30%';

  if (liveQuotesEnabled) liveQuotesEnabled.checked = false;
  const mainTargetRadio = document.querySelector('input[name="live-quotes-target-mode"][value="main"]');
  if (mainTargetRadio) mainTargetRadio.checked = true;
  updateLiveQuotesCustomUrlVisibility();
  if (liveQuotesCustomUrl) liveQuotesCustomUrl.value = '';
  if (liveQuotesBatchCount) liveQuotesBatchCount.value = 4;
  if (liveQuotesMinInterval) liveQuotesMinInterval.value = 60;
  if (liveQuotesDailyLimit) liveQuotesDailyLimit.value = 6;
  if (liveQuotesQuietStart) liveQuotesQuietStart.value = '22:00';
  if (liveQuotesQuietEnd) liveQuotesQuietEnd.value = '07:00';

  const stdRadio = document.querySelector('input[name="mascot-scale"][value="standard"]');
  if (stdRadio) {
    stdRadio.checked = true;
    invoke('set_mascot_scale', { scale: 'standard' }).catch(() => {});
  }

  currentQuotes = {
    touch_reactions: [
      "Yaaay! Did you call me?",
      "What is it~?",
      "I'm right here!",
      "Let's do our best!",
      "Got something you want to ask?",
      "Hehe, nice to meet you!"
    ],
    default_idle_quotes: [
      "Call me anytime!",
      "Such lovely weather today!",
      "Let's have some tea and take a break!",
      "Let me know if there's anything I can help with!"
    ],
    time_specific_quotes: {
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
    },
    videos: {
      "eating.mp4": {
        enabled: true,
        min_idle_sec: 0,
        max_idle_sec: null,
        time_ranges: ["00:00-23:59"],
        duration_sec: 20,
        weight: 2,
        quote_probability: 1.0,
        quotes: [
          "Nom nom… this taiyaki is so sweet and yummy!",
          "Time for a little snack break♪",
          "After using your brain, nothing beats something sweet!"
        ]
      },
      "makeup.mp4": {
        enabled: true,
        min_idle_sec: 0,
        max_idle_sec: null,
        time_ranges: ["00:00-23:59"],
        duration_sec: 20,
        weight: 1,
        quote_probability: 1.0,
        quotes: [
          "Just doing a quick appearance check…♪",
          "Alright, looking perfect today!",
          "Pat pat… how do I look?"
        ]
      },
      "sleeping.mp4": {
        enabled: true,
        min_idle_sec: 0,
        max_idle_sec: null,
        time_ranges: ["00:00-23:59"],
        duration_sec: 40,
        weight: 1,
        quote_probability: 1.0,
        quotes: [
          "Zzz… just a tiny nap…",
          "Yaaawn… I'm getting a little sleepy… zzZ",
          "Mumble mumble… wake me up anytime…"
        ]
      },
      "smartphone.mp4": {
        enabled: true,
        min_idle_sec: 0,
        max_idle_sec: null,
        time_ranges: ["00:00-23:59"],
        duration_sec: 20,
        weight: 3,
        quote_probability: 1.0,
        quotes: [
          "Just checking the latest trends on my phone~",
          "Hmm, I found some interesting news!",
          "I wonder if there's any new message~"
        ]
      },
      "waking.mp4": {
        enabled: true,
        min_idle_sec: 0,
        max_idle_sec: null,
        time_ranges: ["00:00-23:59"],
        duration_sec: 30,
        weight: 3,
        quote_probability: 1.0,
        quotes: [
          "Yaaawn, big stretch! Feeling refreshed!",
          "I've been sitting so long — time for a little stretch♪",
          "All ready to jump into action anytime!"
        ]
      },
      "working.mp4": {
        enabled: true,
        min_idle_sec: 0,
        max_idle_sec: null,
        time_ranges: ["00:00-23:59"],
        duration_sec: 30,
        weight: 4,
        quote_probability: 1.0,
        quotes: [
          "Tap tap… let me prep for the next task!",
          "Tidying up my notes while I have a moment…",
          "Getting ready so I can support you anytime!"
        ]
      }
    }
  };

  renderAllQuotes();
  showStatus('Loaded the default values into the form. Press "Save and Apply" to apply them.');
});

// Save
btnSave.addEventListener('click', async () => {
  try {
    currentSetting.idle_threshold_sec = parseInt(inputIdleThreshold.value, 10) || 180;
    currentSetting.action_interval_sec = parseInt(inputActionInterval.value, 10) || 180;
    currentSetting.default_duration_sec = parseInt(inputDefaultDuration.value, 10) || 30;
    currentSetting.bubble_display_duration_sec = parseInt(inputBubbleDuration.value, 10) || 30;
    currentSetting.touch_reaction_duration_sec = parseInt(inputTouchDuration.value, 10) || 8;
    currentSetting.sound_enabled = toggleSoundEnabled ? toggleSoundEnabled.checked : true;
    currentSetting.sound_volume = inputSoundVolume ? parseInt(inputSoundVolume.value, 10) : 30;

    const checkedTargetMode = document.querySelector('input[name="live-quotes-target-mode"]:checked');
    currentSetting.live_quotes = {
      enabled: liveQuotesEnabled ? liveQuotesEnabled.checked : false,
      target_mode: checkedTargetMode ? checkedTargetMode.value : 'main',
      custom_chat_url: liveQuotesCustomUrl ? liveQuotesCustomUrl.value.trim() : '',
      batch_count: Math.max(1, Math.min(10, parseInt(liveQuotesBatchCount?.value, 10) || 4)),
      min_interval_min: Math.max(10, parseInt(liveQuotesMinInterval?.value, 10) || 60),
      daily_limit: Math.max(1, parseInt(liveQuotesDailyLimit?.value, 10) || 6),
      quiet_hours_start: (liveQuotesQuietStart?.value || '22:00').trim() || '22:00',
      quiet_hours_end: (liveQuotesQuietEnd?.value || '07:00').trim() || '07:00'
    };

    await invoke('save_plugin_configs', {
      setting: currentSetting,
      quotes: currentQuotes
    });

    const checkedScale = document.querySelector('input[name="mascot-scale"]:checked');
    if (checkedScale) {
      await invoke('set_mascot_scale', { scale: checkedScale.value });
    }

    showStatus('Settings saved and applied to the mascot!', 'success');
  } catch (err) {
    console.error('Failed to save configs:', err);
    showStatus(`Save error: ${err}`, 'error');
  }
});

// Cancel / close
btnCancel.addEventListener('click', async () => {
  try {
    await invoke('close_settings_window');
  } catch (err) {
    console.warn(err);
    window.close();
  }
});

// Initial load
document.addEventListener('DOMContentLoaded', loadConfigs);
