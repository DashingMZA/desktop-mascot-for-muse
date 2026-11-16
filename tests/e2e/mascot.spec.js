import { test, expect } from '@playwright/test';

test.describe('Desktop Mascot for Muse - Real Browser UI & Layout Regression Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Inject Tauri IPC mock before page scripts run
    await page.addInitScript(() => {
      window.__TAURI_INVOKED__ = [];
      window.__TAURI_LISTENERS__ = {};
      window.__MOCK_AVATAR_STATE__ = { state: 'idle', statusText: 'Linked' };
      window.__MOCK_MESSAGES__ = [
        { role: 'assistant', text: 'Hello! How can I help you?' },
      ];

      window.__TAURI__ = {
        core: {
          invoke: async (cmd, args) => {
            window.__TAURI_INVOKED__.push({ cmd, args });
            if (cmd === 'get_gadget_config') {
              return {
                size_mode: 'mascot',
                mascot_scale: 'standard',
                mascot_bubble_on_left: true,
                message_limit: 5,
                avatar_name: 'Lucky',
              };
            }
            if (cmd === 'get_session_status') {
              return {
                exists: true,
                visible: false,
                url: 'https://muse.ai/chat/dedicated-room-123',
              };
            }
            if (cmd === 'get_avatar_video_pack') {
              return {
                idle: 'data:video/mp4;base64,AAAA',
                waking: 'data:video/mp4;base64,BBBB',
                working: 'data:video/mp4;base64,CCCC',
                making_something: 'data:video/mp4;base64,DDDD',
                milestone_level_up: 'data:video/mp4;base64,EEEE',
                plugins: [],
                setting: {
                  sound_enabled: false,
                  bubble_display_duration_sec: 30,
                  idle_threshold_sec: 180,
                },
                quotes: {},
              };
            }
            if (cmd === 'get_usage_limit') {
              return {
                plan_name: 'Pro Plan',
                used_percent: 20,
                remaining_percent: 80,
                reset_text: 'Weekly limit resets on Nov 14',
              };
            }
            if (cmd === 'get_chat_messages') {
              return window.__MOCK_MESSAGES__;
            }
            if (cmd === 'get_avatar_state') {
              return window.__MOCK_AVATAR_STATE__;
            }
            if (cmd === 'check_bridge_health') {
              return {
                avatar_name: 'Lucky',
                avatar_state: window.__MOCK_AVATAR_STATE__.state,
                r1_avatar: { ok: true, selector: 'video' },
                r2_messages: { ok: true, selector: '.group/msg' },
                r3_input: { ok: true, selector: 'textarea' },
                r5_limit: { ok: true, selector: 'button' },
              };
            }
            if (cmd === 'get_plugin_configs') {
              return {
                setting: {
                  avatar_name: 'Lucky',
                  idle_threshold_sec: 180,
                  action_interval_sec: 180,
                  default_duration_sec: 30,
                  bubble_display_duration_sec: 30,
                  touch_reaction_duration_sec: 8,
                  sound_enabled: true,
                  sound_volume: 45,
                  live_quotes: {
                    enabled: false,
                    target_mode: 'main',
                    custom_chat_url: '',
                    batch_count: 4,
                    min_interval_min: 60,
                    daily_limit: 6,
                    quiet_hours_start: '22:00',
                    quiet_hours_end: '07:00',
                  },
                },
                quotes: {
                  touch_reactions: ['Yes, you called?'],
                  default_idle_quotes: ['The weather is nice today'],
                  videos: {},
                },
              };
            }
            if (cmd === 'sync_mascot_bubble_direction') return true;
            return true;
          },
        },
        event: {
          listen: async (eventName, cb) => {
            window.__TAURI_LISTENERS__[eventName] = cb;
            return () => {};
          },
        },
      };
    });
  });

  test('Issue #35, #36: the avatar position does not shift by even 1px when the status pill is shown/hidden', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('body')).toHaveClass(/mode-mascot/);

    const avatarContainer = page.locator('#avatar-container');
    const statusPill = page.locator('#avatar-status-pill');

    // In the initial state (idle / Linked), the status pill is hidden
    await expect(statusPill).toBeHidden();
    const rectBefore = await avatarContainer.boundingBox();
    expect(rectBefore).not.toBeNull();

    // Simulate Muse becoming active (Thinking...)
    await page.evaluate(async () => {
      window.__MOCK_AVATAR_STATE__ = { state: 'working', statusText: 'Thinking...' };
      if (typeof syncAvatarStateWithMuse === 'function') {
        await syncAvatarStateWithMuse();
      }
    });

    await expect(statusPill).toBeVisible();
    await expect(page.locator('#avatar-status-text')).toHaveText('🛠️ Thinking...');

    const rectDuringWorking = await avatarContainer.boundingBox();
    expect(rectDuringWorking).not.toBeNull();

    // Verify the avatar X, Y, Width, and Height have not shifted by even 1px
    expect(Math.round(rectDuringWorking.x)).toBe(Math.round(rectBefore.x));
    expect(Math.round(rectDuringWorking.y)).toBe(Math.round(rectBefore.y));
    expect(Math.round(rectDuringWorking.width)).toBe(Math.round(rectBefore.width));
    expect(Math.round(rectDuringWorking.height)).toBe(Math.round(rectBefore.height));

    // When it returns to idle (Linked), the pill disappears and the position stays the same
    await page.evaluate(async () => {
      window.__MOCK_AVATAR_STATE__ = { state: 'idle', statusText: 'Linked' };
      if (typeof syncAvatarStateWithMuse === 'function') {
        await syncAvatarStateWithMuse();
      }
    });
    await expect(statusPill).toBeHidden();
  });

  test('Issue #25: the actual rendered size changes accurately when switching the mascot scale (small / standard / large)', async ({ page }) => {
    await page.goto('/index.html');
    const avatarContainer = page.locator('#avatar-container');

    // standard (116px)
    const boxStd = await avatarContainer.boundingBox();
    expect(Math.round(boxStd.width)).toBe(116);

    // small (93px)
    await page.evaluate(() => {
      window.__TAURI_LISTENERS__['mascot-scale-changed']({ payload: 'small' });
    });
    const boxSmall = await avatarContainer.boundingBox();
    expect(Math.round(boxSmall.width)).toBe(93);

    // large (145px)
    await page.evaluate(() => {
      window.__TAURI_LISTENERS__['mascot-scale-changed']({ payload: 'large' });
    });
    const boxLarge = await avatarContainer.boundingBox();
    expect(Math.round(boxLarge.width)).toBe(145);
  });

  test('Issue #32: speech bubble display and one-click replies work correctly for replies with options', async ({ page }) => {
    await page.goto('/index.html');

    // First run the initial sync (baseline recording of past logs), then deliver a new message with options
    await page.evaluate(async () => {
      await loadChatMessages();
      window.__MOCK_MESSAGES__ = [
        { role: 'assistant', text: 'Hello! How can I help you?' },
        {
          role: 'assistant',
          text: 'Pick a plan to proceed with!',
          options: ['Run plan A', 'Run plan B'],
        },
      ];
      await loadChatMessages();
    });

    const bubble = page.locator('#mascot-bubble');
    await expect(bubble).toBeVisible();

    // Wait for the option buttons to appear after typing completes
    const optionBtnA = page.locator('.mascot-option-btn', { hasText: 'Run plan A' });
    await expect(optionBtnA).toBeVisible({ timeout: 5000 });

    // Click an option button to send with one click
    await optionBtnA.click();

    const sentCall = await page.evaluate(() => {
      return window.__TAURI_INVOKED__.find(
        (c) => c.cmd === 'send_chat_message' && c.args?.text === 'Run plan A'
      );
    });
    expect(sentCall).toBeTruthy();
  });

  test('Issue #37, #39: settings screen tab switching, dedicated chat URL register button, and settings saving work correctly', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 720 });
    await page.goto('/settings.html');

    // The timers tab is shown in the initial state
    await expect(page.locator('#tab-timers')).toBeVisible();
    await expect(page.locator('#input-avatar-name')).toHaveValue('Lucky');

    // Switch to the "🎬 Idle actions & lines" tab
    await page.locator('.tab-btn[data-tab="tab-quotes"]').click();
    await expect(page.locator('#tab-quotes')).toBeVisible();

    // Selecting dedicated chat URL mode shows the URL input field
    await expect(page.locator('#live-quotes-custom-url-group')).toBeHidden();
    await page.locator('input[name="live-quotes-target-mode"][value="custom"]').check();
    await expect(page.locator('#live-quotes-custom-url-group')).toBeVisible();

    // Clicking the "📍 Register the currently open chat" button fills in the session's current URL
    await page.locator('#btn-fill-current-chat-url').click();
    await expect(page.locator('#live-quotes-custom-url')).toHaveValue(
      'https://muse.ai/chat/dedicated-room-123'
    );

    // Clicking "💾 Save and apply" calls save_plugin_configs
    await page.locator('#btn-save').click();
    const savedCall = await page.evaluate(() => {
      return window.__TAURI_INVOKED__.find((c) => c.cmd === 'save_plugin_configs');
    });
    expect(savedCall).toBeTruthy();
    expect(savedCall.args.setting.live_quotes.target_mode).toBe('custom');
    expect(savedCall.args.setting.live_quotes.custom_chat_url).toBe(
      'https://muse.ai/chat/dedicated-room-123'
    );
  });

  test('Issue #50: .mascot-bubble-body scroll auto-follows to the bottom during long-message typing display', async ({ page }) => {
    await page.goto('/index.html');

    const longMessage = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}: This is a long-message scroll auto-follow verification message.`).join('\n');

    await page.evaluate(async (msg) => {
      await loadChatMessages();
      window.__MOCK_MESSAGES__ = [
        { role: 'assistant', text: 'Hello! How can I help you?' },
        { role: 'assistant', text: msg },
      ];
      await loadChatMessages();
    }, longMessage);

    const bubble = page.locator('#mascot-bubble');
    await expect(bubble).toBeVisible();

    // Wait until typing completes and the final "Line 12" appears
    await expect(page.locator('#mascot-bubble-text')).toContainText('Line 12:', { timeout: 5000 });

    const scrollMetrics = await page.evaluate(() => {
      const body = document.querySelector('.mascot-bubble-body');
      return {
        scrollTop: body.scrollTop,
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
      };
    });

    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    expect(scrollMetrics.scrollTop).toBeGreaterThan(0);
    // It has scrolled to follow near the bottom
    expect(scrollMetrics.scrollTop + scrollMetrics.clientHeight).toBeGreaterThanOrEqual(
      scrollMetrics.scrollHeight - 5
    );
  });

  test('Issue #68: expanding the quick input bar shows the one-click shortcuts, and clicking one previews it in the input field and sends it', async ({ page }) => {
    await page.goto('/index.html');

    // Right-click to expand the quick input bar
    await page.locator('#avatar-container').click({ button: 'right' });
    const inputBar = page.locator('#mascot-input-bar');
    await expect(inputBar).toBeVisible();

    const chips = page.locator('.mascot-shortcut-chip');
    await expect(chips).toHaveCount(4);

    // Clicking "Start the conversation over" sets it in the input field without sending immediately
    await page.locator('.mascot-shortcut-chip', { hasText: 'Start the conversation over' }).click();
    const inputField = page.locator('#mascot-input-field');
    await expect(inputField).toHaveValue(/handover note/i);
    await expect(page.locator('#mascot-shortcut-note')).toHaveClass(/is-selected/);

    const sentBeforeConfirm = await page.evaluate(() => {
      return window.__TAURI_INVOKED__.some((c) => c.cmd === 'send_chat_message');
    });
    expect(sentBeforeConfirm).toBe(false);

    // Clicking the send button confirms and sends it
    await page.locator('#btn-mascot-input-send').click();
    const sentAfterConfirm = await page.evaluate(() => {
      return window.__TAURI_INVOKED__.find(
        (c) => c.cmd === 'send_chat_message' && c.args?.text?.includes('handover note')
      );
    });
    expect(sentAfterConfirm).toBeTruthy();
    await expect(inputBar).toBeHidden();
  });
});
