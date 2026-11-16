use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_autostart::ManagerExt;
use base64::prelude::*;

const EMBEDDED_SETTING_JSON: &str = include_str!("../assets/avatars/setting.json");
const EMBEDDED_QUOTES_JSON: &str = include_str!("../assets/avatars/plugin/quotes.json");

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginVideoItem {
    pub name: String,
    pub data_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginConfigsPayload {
    pub setting: serde_json::Value,
    pub quotes: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AvatarVideoPack {
    pub idle: String,
    pub waking: String,
    pub working: String,
    pub making_something: String,
    pub milestone_level_up: String,
    pub plugins: Vec<PluginVideoItem>,
    pub setting: serde_json::Value,
    pub quotes: serde_json::Value,
}

static NONCE_COUNTER: AtomicU64 = AtomicU64::new(1);
static CURRENT_DOC_TITLE: OnceLock<Mutex<String>> = OnceLock::new();
static BRIDGE_BUSY: AtomicBool = AtomicBool::new(false);
static SESSION_RELOADING: AtomicBool = AtomicBool::new(false);

struct SessionReloadGuard;
impl Drop for SessionReloadGuard {
    fn drop(&mut self) {
        SESSION_RELOADING.store(false, Ordering::Release);
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SessionReloadResult {
    pub executed: bool,
    pub success: bool,
    pub reason: String,
    pub skipped_reason: Option<String>,
    pub before_url: String,
    pub after_url: String,
    pub url_matched: bool,
    pub ready: bool,
}

pub fn format_recovery_log_line(timestamp: &str, event: &str, detail: &str) -> String {
    format!("[{}] [{}] {}\n", timestamp, event, detail)
}

pub fn append_recovery_log_to_path(log_path: &std::path::Path, event: &str, detail: &str) {
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(meta) = fs::metadata(log_path) {
        if meta.len() > 1_048_576 {
            let old_path = log_path.with_extension("log.old");
            let _ = fs::remove_file(&old_path);
            let _ = fs::rename(log_path, &old_path);
        }
    }
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let line = format_recovery_log_line(&ts, event, detail);
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(log_path) {
        use std::io::Write;
        let _ = file.write_all(line.as_bytes());
    }
}

fn append_recovery_log(app: &AppHandle, event: &str, detail: &str) {
    if let Ok(data_dir) = app.path().app_local_data_dir() {
        let log_path = data_dir.join("session_recovery.log");
        append_recovery_log_to_path(&log_path, event, detail);
    }
}

fn doc_title_store() -> &'static Mutex<String> {
    CURRENT_DOC_TITLE.get_or_init(|| Mutex::new(String::new()))
}

fn get_latest_doc_title() -> Option<String> {
    doc_title_store().lock().ok().map(|s| s.clone())
}

struct BridgeLockGuard;
impl Drop for BridgeLockGuard {
    fn drop(&mut self) {
        BRIDGE_BUSY.store(false, Ordering::Release);
    }
}

async fn acquire_bridge_lock() -> BridgeLockGuard {
    while BRIDGE_BUSY
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_err()
    {
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    BridgeLockGuard
}

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const SESSION_URL: &str = "https://muse.ai/?__pwa=1";
const BROWSER_URL: &str = "https://muse.ai";

const SMALL_WIDTH: f64 = 360.0;
const SMALL_HEIGHT: f64 = 580.0;
const LARGE_WIDTH: f64 = 1024.0;
const LARGE_HEIGHT: f64 = 768.0;

static SESSION_BRIDGE_JS: &str = include_str!("session_bridge.js");

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatMessage {
    pub role: String, // "user" or "assistant"
    pub text: String,
    #[serde(default)]
    pub options: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct UsageLimitInfo {
    pub plan_name: String,
    pub used_percent: Option<u32>,
    pub remaining_percent: Option<u32>,
    pub reset_text: String,
    pub updated_at: String,
}

fn default_avatar_name() -> String {
    "Lucky".to_string()
}

fn default_last_normal_mode() -> String {
    "small".to_string()
}

fn default_mascot_scale() -> String {
    "standard".to_string()
}

fn default_mascot_bubble_on_left() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GadgetConfig {
    pub size_mode: String, // "small", "large", or "mascot"
    #[serde(default = "default_last_normal_mode")]
    pub last_normal_mode: String, // "small" or "large"
    pub message_limit: usize,
    pub hotkey: String,
    #[serde(default = "default_avatar_name")]
    pub avatar_name: String,
    #[serde(default = "default_mascot_scale")]
    pub mascot_scale: String, // "small", "standard", or "large"
    #[serde(default = "default_mascot_bubble_on_left")]
    pub mascot_bubble_on_left: bool,
    pub last_limit_info: Option<UsageLimitInfo>,
    #[serde(default)]
    pub small_pos: Option<(i32, i32)>,
    #[serde(default)]
    pub large_pos: Option<(i32, i32)>,
    #[serde(default)]
    pub mascot_pos: Option<(i32, i32)>,
    #[serde(default)]
    pub session_pos: Option<(i32, i32)>,
    #[serde(default)]
    pub session_size: Option<(f64, f64)>,
    #[serde(default)]
    pub autostart_enabled: Option<bool>,
}

impl Default for GadgetConfig {
    fn default() -> Self {
        Self {
            size_mode: "mascot".to_string(),
            last_normal_mode: "small".to_string(),
            message_limit: 5,
            hotkey: "Ctrl+Shift+M".to_string(),
            avatar_name: default_avatar_name(),
            mascot_scale: default_mascot_scale(),
            mascot_bubble_on_left: default_mascot_bubble_on_left(),
            last_limit_info: None,
            small_pos: None,
            large_pos: None,
            mascot_pos: None,
            session_pos: None,
            session_size: None,
            autostart_enabled: None,
        }
    }
}

static CONFIG_STORE: OnceLock<Mutex<Option<GadgetConfig>>> = OnceLock::new();
static LAST_MASCOT_POS: OnceLock<Mutex<Option<(i32, i32)>>> = OnceLock::new();
static IS_RESTORING_MASCOT: AtomicBool = AtomicBool::new(false);
static CONFIG_SAVE_GENERATION: AtomicU64 = AtomicU64::new(0);
static CONFIG_DIRTY: AtomicBool = AtomicBool::new(false);

const MASCOT_HIT_PADDING: f64 = 4.0;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Default)]
struct MascotHitState {
    is_mascot_mode: bool,
    rects: Vec<HitRect>,
    last_ignored: Option<bool>,
}

static MASCOT_HIT_STATE: OnceLock<Mutex<MascotHitState>> = OnceLock::new();

fn mascot_hit_state_mutex() -> &'static Mutex<MascotHitState> {
    MASCOT_HIT_STATE.get_or_init(|| Mutex::new(MascotHitState::default()))
}

fn is_cursor_in_hit_rects(
    cursor_physical: (f64, f64),
    win_physical: (i32, i32),
    scale_factor: f64,
    rects: &[HitRect],
) -> bool {
    if rects.is_empty() || scale_factor <= 0.0 {
        return true;
    }
    let local_x = (cursor_physical.0 - (win_physical.0 as f64)) / scale_factor;
    let local_y = (cursor_physical.1 - (win_physical.1 as f64)) / scale_factor;
    rects.iter().any(|r| {
        r.width > 0.0
            && r.height > 0.0
            && local_x >= (r.x - MASCOT_HIT_PADDING)
            && local_x <= (r.x + r.width + MASCOT_HIT_PADDING)
            && local_y >= (r.y - MASCOT_HIT_PADDING)
            && local_y <= (r.y + r.height + MASCOT_HIT_PADDING)
    })
}

fn set_mascot_mode_hit_state(app: &AppHandle, is_mascot: bool) {
    if let Ok(mut guard) = mascot_hit_state_mutex().lock() {
        guard.is_mascot_mode = is_mascot;
        if !is_mascot {
            guard.last_ignored = Some(false);
        }
    }
    if !is_mascot {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.set_ignore_cursor_events(false);
        }
    }
}

fn sync_mascot_cursor_passthrough(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    if !win.is_visible().unwrap_or(false) || win.is_minimized().unwrap_or(false) {
        return;
    }

    let (is_mascot, rects, last_ignored) = match mascot_hit_state_mutex().lock() {
        Ok(guard) => (guard.is_mascot_mode, guard.rects.clone(), guard.last_ignored),
        Err(_) => return,
    };

    if !is_mascot {
        if last_ignored != Some(false) {
            if win.set_ignore_cursor_events(false).is_ok() {
                if let Ok(mut guard) = mascot_hit_state_mutex().lock() {
                    guard.last_ignored = Some(false);
                }
            }
        }
        return;
    }

    let Ok(cursor_pos) = win.cursor_position() else {
        return;
    };
    let Ok(win_pos) = win.inner_position().or_else(|_| win.outer_position()) else {
        return;
    };
    let scale_factor = win.scale_factor().unwrap_or(1.0);
    let in_rect = is_cursor_in_hit_rects(
        (cursor_pos.x, cursor_pos.y),
        (win_pos.x, win_pos.y),
        scale_factor,
        &rects,
    );
    let should_ignore = !in_rect;

    if last_ignored != Some(should_ignore) {
        if win.set_ignore_cursor_events(should_ignore).is_ok() {
            if let Ok(mut guard) = mascot_hit_state_mutex().lock() {
                guard.last_ignored = Some(should_ignore);
            }
        }
    }
}

#[tauri::command]
fn update_mascot_hit_rects(app: AppHandle, rects: Vec<HitRect>) -> Result<(), String> {
    if let Ok(mut guard) = mascot_hit_state_mutex().lock() {
        guard.rects = rects;
    }
    sync_mascot_cursor_passthrough(&app);
    Ok(())
}

fn config_mutex() -> &'static Mutex<Option<GadgetConfig>> {
    CONFIG_STORE.get_or_init(|| Mutex::new(None))
}

fn last_mascot_pos_mutex() -> &'static Mutex<Option<(i32, i32)>> {
    LAST_MASCOT_POS.get_or_init(|| Mutex::new(None))
}

fn set_last_mascot_pos(pos: (i32, i32)) {
    if pos.0 > -10000 && pos.1 > -10000 {
        if let Ok(mut guard) = last_mascot_pos_mutex().lock() {
            *guard = Some(pos);
        }
    }
}

fn get_last_mascot_pos() -> Option<(i32, i32)> {
    last_mascot_pos_mutex().lock().ok().and_then(|g| *g)
}

fn get_mascot_dimensions(scale_str: &str) -> (f64, f64, f64) {
    match scale_str {
        "large" => (775.0, 325.0, 1.25),
        "small" => (496.0, 208.0, 0.8),
        _ => (620.0, 260.0, 1.0), // "standard"
    }
}

fn get_mascot_avatar_size(scale_str: &str) -> f64 {
    match scale_str {
        "large" => 145.0,
        "small" => 93.0,
        _ => 116.0,
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionStatus {
    pub exists: bool,
    pub visible: bool,
    pub title: Option<String>,
    pub url: Option<String>,
}

fn get_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Path error: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Create dir error: {}", e))?;
    Ok(dir.join("gadget_config.json"))
}

fn get_avatar_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Path error: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Create dir error: {}", e))?;
    Ok(dir.join("avatar_cache.txt"))
}

fn load_config_internal(app: &AppHandle) -> GadgetConfig {
    if let Ok(mut guard) = config_mutex().lock() {
        if let Some(cfg) = guard.as_ref() {
            return cfg.clone();
        }
        if let Ok(path) = get_config_path(app) {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(cfg) = serde_json::from_str::<GadgetConfig>(&content) {
                    if let Some(pos) = cfg.mascot_pos {
                        set_last_mascot_pos(pos);
                    }
                    *guard = Some(cfg.clone());
                    return cfg;
                }
            }
        }
        let default_cfg = GadgetConfig::default();
        *guard = Some(default_cfg.clone());
        return default_cfg;
    }
    GadgetConfig::default()
}

fn normalize_config_for_save(config: &GadgetConfig) -> GadgetConfig {
    let mut to_save = config.clone();
    if let Some(pos) = to_save.mascot_pos {
        if pos.0 > -10000 && pos.1 > -10000 {
            set_last_mascot_pos(pos);
        } else if let Some(last_pos) = get_last_mascot_pos() {
            to_save.mascot_pos = Some(last_pos);
        }
    } else if let Some(last_pos) = get_last_mascot_pos() {
        to_save.mascot_pos = Some(last_pos);
    }
    to_save
}

fn write_config_to_path_if_changed(
    path: &std::path::Path,
    prev: Option<&GadgetConfig>,
    next: &GadgetConfig,
) -> Result<bool, String> {
    if let Some(prev_cfg) = prev {
        if prev_cfg == next && path.exists() {
            return Ok(false);
        }
    }
    let content = serde_json::to_string_pretty(next).map_err(|e| e.to_string())?;
    let tmp_path = path.with_extension("json.tmp");
    if fs::write(&tmp_path, &content).is_ok() {
        if fs::rename(&tmp_path, path).is_ok() {
            return Ok(true);
        }
        let _ = fs::remove_file(&tmp_path);
    }
    fs::write(path, content).map_err(|e| format!("Save config error: {}", e))?;
    Ok(true)
}

fn save_config_internal(app: &AppHandle, config: &GadgetConfig) -> Result<(), String> {
    let to_save = normalize_config_for_save(config);
    if let Ok(mut guard) = config_mutex().lock() {
        let path = get_config_path(app)?;
        let prev = guard.as_ref();
        let _ = write_config_to_path_if_changed(&path, prev, &to_save)?;
        *guard = Some(to_save);
        CONFIG_DIRTY.store(false, Ordering::SeqCst);
    }
    Ok(())
}

fn update_config_internal<F>(app: &AppHandle, updater: F) -> GadgetConfig
where
    F: FnOnce(&mut GadgetConfig),
{
    let mut cfg = load_config_internal(app);
    updater(&mut cfg);
    let _ = save_config_internal(app, &cfg);
    cfg
}

fn update_config_memory_only<F>(app: &AppHandle, updater: F) -> GadgetConfig
where
    F: FnOnce(&mut GadgetConfig),
{
    let mut cfg = load_config_internal(app);
    updater(&mut cfg);
    let normalized = normalize_config_for_save(&cfg);
    if let Ok(mut guard) = config_mutex().lock() {
        *guard = Some(normalized.clone());
    }
    normalized
}

fn flush_config_to_disk(app: &AppHandle) {
    if !CONFIG_DIRTY.load(Ordering::SeqCst) {
        return;
    }
    let snapshot = if let Ok(guard) = config_mutex().lock() {
        guard.clone()
    } else {
        None
    };
    if let Some(cfg) = snapshot {
        if let Ok(path) = get_config_path(app) {
            if write_config_to_path_if_changed(&path, None, &cfg).is_ok() {
                CONFIG_DIRTY.store(false, Ordering::SeqCst);
            }
        }
    }
}

fn schedule_debounced_config_update<F>(app: &AppHandle, updater: F)
where
    F: FnOnce(&mut GadgetConfig),
{
    let mut cfg = load_config_internal(app);
    let before = cfg.clone();
    updater(&mut cfg);
    let normalized = normalize_config_for_save(&cfg);
    if before == normalized {
        return;
    }
    if let Ok(mut guard) = config_mutex().lock() {
        *guard = Some(normalized);
    }
    CONFIG_DIRTY.store(true, Ordering::SeqCst);
    let gen = CONFIG_SAVE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if CONFIG_SAVE_GENERATION.load(Ordering::SeqCst) == gen {
            flush_config_to_disk(&app_clone);
        }
    });
}

fn has_usage_limit_changed(prev: Option<&UsageLimitInfo>, next: &UsageLimitInfo) -> bool {
    match prev {
        None => true,
        Some(p) => {
            p.used_percent != next.used_percent
                || p.remaining_percent != next.remaining_percent
                || p.reset_text != next.reset_text
                || p.plan_name != next.plan_name
        }
    }
}

fn is_session_allowed_host(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    h == "muse.ai"
        || h.ends_with(".muse.ai")
        || h == "accounts.google.com"
        || h == "appleid.apple.com"
        || h == "login.microsoftonline.com"
        || h == "login.live.com"
        // Facebook login: Muse's auth flow can route through
        // facebook.com/aymh/redirect-cycle/. Without this the redirect is
        // bounced out to the external browser and the session window stays
        // on about:blank (see session_recovery.log, 2026-11-16).
        || h == "facebook.com"
        || h.ends_with(".facebook.com")
}

fn should_open_session_url_externally(url: &tauri::Url) -> bool {
    match url.scheme() {
        "http" | "https" => match url.host_str() {
            Some(host) => !is_session_allowed_host(host),
            None => false,
        },
        "mailto" | "tel" => true,
        _ => false,
    }
}

fn spawn_open_external_url(app: &AppHandle, event_name: &str, url_str: &str) {
    let h = app.clone();
    let ev = event_name.to_string();
    let u = url_str.to_string();
    tauri::async_runtime::spawn(async move {
        let res = h.opener().open_url(&u, None::<&str>);
        append_recovery_log(&h, &ev, &format!("url={}, open_res={:?}", u, res));
    });
}

fn ensure_session_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(win) = app.get_webview_window("session") {
        return Ok(win);
    }

    let url = SESSION_URL
        .parse::<tauri::Url>()
        .map_err(|e| format!("URL parse error: {}", e))?;

    let config = load_config_internal(app);
    let (init_w, init_h) = config.session_size.unwrap_or((1024.0, 768.0));

    let app_for_nav = app.clone();
    let app_for_new_window = app.clone();
    let app_for_title = app.clone();

    let mut builder = WebviewWindowBuilder::new(app, "session", WebviewUrl::External(url))
        .title("Muse AI - Session")
        .inner_size(init_w, init_h)
        .visible(false)
        // Enable WebView2's standard HTML5 drag & drop (e.g. dropping images into the chat input)
        // by disabling Tauri's native D&D hook
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            if should_open_session_url_externally(&url) {
                spawn_open_external_url(&app_for_nav, "session_on_navigation", url.as_str());
                return false;
            }
            true
        })
        .on_new_window(move |url, _features| {
            if should_open_session_url_externally(&url) {
                spawn_open_external_url(
                    &app_for_new_window,
                    "session_on_new_window",
                    url.as_str(),
                );
                return tauri::webview::NewWindowResponse::Deny;
            }
            tauri::webview::NewWindowResponse::Allow
        })
        .on_document_title_changed(move |_win, title| {
            if let Some(raw_url) = title.strip_prefix("__MUSE_OPEN_URL__:") {
                if let Ok(parsed) = tauri::Url::parse(raw_url) {
                    if should_open_session_url_externally(&parsed) {
                        spawn_open_external_url(
                            &app_for_title,
                            "session_title_open_url",
                            parsed.as_str(),
                        );
                    }
                }
                return;
            }
            if let Ok(mut t) = doc_title_store().lock() {
                *t = title;
            }
        });

    // Persist cookies / the login session in the app-specific data directory
    if let Ok(data_dir) = app.path().app_local_data_dir() {
        let session_data_dir = data_dir.join("webview2_session");
        builder = builder.data_directory(session_data_dir);
    }

    // Latest Chrome / Edge User-Agent, to avoid Google OAuth issues
    builder = builder.user_agent(USER_AGENT);

    // Inject session_bridge.js as an initialization script on every page load
    builder = builder.initialization_script(SESSION_BRIDGE_JS);

    let window = builder
        .build()
        .map_err(|e| format!("Failed to build session window: {}", e))?;

    let _ = window.set_icon(tauri::include_image!("icons/128x128.png"));

    // Restore the saved position if there is one (clamped so it cannot end up off-monitor)
    if let Some(pos) = config.session_pos {
        clamp_window_to_monitor(&window, Some(pos), None);
    }

    // Keep the mascot fully in sync with the session screen's focus / visibility state:
    // "Show the mascot when the session screen is not in front; hide it when the session screen is in front"
    let handle_for_session = app.clone();
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let h = handle_for_session.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = hide_session(h).await;
                });
            }
            tauri::WindowEvent::Moved(pos) => {
                let h = handle_for_session.clone();
                let x = pos.x;
                let y = pos.y;
                if x < -10000 || y < -10000 {
                    return;
                }
                tauri::async_runtime::spawn(async move {
                    if let Some(s) = h.get_webview_window("session") {
                        if !s.is_minimized().unwrap_or(false) && s.is_visible().unwrap_or(false) {
                            schedule_debounced_config_update(&h, |config| {
                                config.session_pos = Some((x, y));
                            });
                        }
                    }
                });
            }
            tauri::WindowEvent::Resized(size) => {
                // On Windows, minimizing makes the inner size 0x0
                if size.width == 0 && size.height == 0 {
                    let h = handle_for_session.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = hide_session(h).await;
                    });
                } else {
                    let h = handle_for_session.clone();
                    let w_raw = size.width;
                    let h_raw = size.height;
                    tauri::async_runtime::spawn(async move {
                        if let Some(s) = h.get_webview_window("session") {
                            if !s.is_minimized().unwrap_or(false) && s.is_visible().unwrap_or(false) {
                                let scale = s.scale_factor().unwrap_or(1.0);
                                let w = w_raw as f64 / scale;
                                let h_val = h_raw as f64 / scale;
                                if w >= 250.0 && h_val >= 250.0 {
                                    schedule_debounced_config_update(&h, |config| {
                                        config.session_size = Some((w, h_val));
                                    });
                                }
                            }
                        }
                    });
                }
            }
            tauri::WindowEvent::Focused(true) => {
                // The session screen came to the front (gained focus): notify the mascot only when it is actually visible
                let h = handle_for_session.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(s) = h.get_webview_window("session") {
                        if !s.is_visible().unwrap_or(false) || s.is_minimized().unwrap_or(false) {
                            return;
                        }
                        let _ = s.eval("window.__MUSE_SESSION_VISIBLE__ = true;");
                    }
                    if let Some(main_win) = h.get_webview_window("main") {
                        let _ = main_win.emit("clear-unread", ());
                        let _ = main_win.emit("session-visibility-changed", true);
                        if main_win.is_visible().unwrap_or(false) && !main_win.is_minimized().unwrap_or(false) {
                            if let Ok(pos) = main_win.outer_position() {
                                if pos.x > -10000 && pos.y > -10000 {
                                    set_last_mascot_pos((pos.x, pos.y));
                                    update_config_internal(&h, |cfg| {
                                        if cfg.size_mode == "mascot" {
                                            cfg.mascot_pos = Some((pos.x, pos.y));
                                        }
                                    });
                                }
                            }
                        }
                        let _ = main_win.hide();
                    }
                });
            }
            tauri::WindowEvent::Focused(false) => {
                // The session screen went to the back / was minimized / focus moved to another app.
                // Allow for temporary focus changes (e.g. a dialog appearing) and settle the state after 100ms before showing the mascot
                let h = handle_for_session.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                    if let Some(s) = h.get_webview_window("session") {
                        let is_focused = s.is_focused().unwrap_or(false);
                        let is_minimized = s.is_minimized().unwrap_or(false);
                        let is_visible = s.is_visible().unwrap_or(false);
                        if !is_focused || is_minimized || !is_visible {
                            if let Some(main_win) = h.get_webview_window("main") {
                                if !main_win.is_visible().unwrap_or(false) {
                                    restore_mascot_window(&h, false).await;
                                }
                            }
                        }
                    }
                });
            }
            _ => {}
        }
    });

    Ok(window)
}

fn parse_bridge_payload(val: serde_json::Value) -> Result<serde_json::Value, String> {
    if val.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        Ok(val.get("data").cloned().unwrap_or(serde_json::Value::Null))
    } else {
        let err_msg = val
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown script error");
        Err(err_msg.to_string())
    }
}

async fn run_bridge_action(
    session: &WebviewWindow,
    action: &str,
    args: &serde_json::Value,
    timeout_ms: u64,
) -> Result<serde_json::Value, String> {
    let _lock = acquire_bridge_lock().await;

    // Inject the bridge script just in case it has not loaded yet
    let ensure_js = format!(
        "if (!window.__MUSE_BRIDGE__) {{ {} }}",
        SESSION_BRIDGE_JS
    );
    let _ = session.eval(&ensure_js);

    let nonce = format!(
        "{}_{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        NONCE_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let exec_js = format!(
        "window.__MUSE_BRIDGE__.executeAction('{}', {}, '{}');",
        action,
        args.to_string(),
        nonce
    );

    session
        .eval(&exec_js)
        .map_err(|e| format!("Session eval failed: {}", e))?;

    let timeout = Duration::from_millis(timeout_ms);
    let interval = Duration::from_millis(25);
    let start = Instant::now();

    let res_prefix = format!("__MUSE_RES__:{}:", nonce);
    let ready_prefix = format!("__MUSE_CHUNK_READY__:{}:", nonce);

    while start.elapsed() < timeout {
        tokio::time::sleep(interval).await;
        if let Some(title) = get_latest_doc_title() {
            // Case 1: completed immediately in a single chunk
            if let Some(encoded) = title.strip_prefix(&res_prefix) {
                let decoded = urlencoding::decode(encoded)
                    .map_err(|e| format!("Decode error: {}", e))?;
                let val: serde_json::Value = serde_json::from_str(&decoded)
                    .map_err(|e| format!("JSON parse error: {}", e))?;
                let _ = session.eval(&format!("window.__MUSE_BRIDGE__.cleanup('{}');", nonce));
                return parse_bridge_payload(val);
            }

            // Case 2: chunked handshake Pull (large payloads such as avatar video Base64)
            if let Some(total_str) = title.strip_prefix(&ready_prefix) {
                let total_chunks: usize = total_str
                    .trim()
                    .parse()
                    .map_err(|e| format!("Parse total chunks error: {}", e))?;
                let mut full_encoded = String::new();

                for idx in 0..total_chunks {
                    let req_js = format!("window.__MUSE_BRIDGE__.serveChunk('{}', {});", nonce, idx);
                    session
                        .eval(&req_js)
                        .map_err(|e| format!("Eval chunk request failed: {}", e))?;

                    let chunk_prefix = format!("__MUSE_CHUNK__:{}:{}:", nonce, idx);
                    let chunk_start = Instant::now();
                    let mut got_chunk = false;

                    while chunk_start.elapsed() < Duration::from_millis(4000) {
                        tokio::time::sleep(Duration::from_millis(12)).await;
                        if let Some(t) = get_latest_doc_title() {
                            if let Some(chunk_data) = t.strip_prefix(&chunk_prefix) {
                                if chunk_data == "ERROR_NO_DATA" {
                                    return Err("Chunk server error: no data".to_string());
                                }
                                full_encoded.push_str(chunk_data);
                                got_chunk = true;
                                break;
                            }
                        }
                    }

                    if !got_chunk {
                        return Err(format!(
                            "Timed out waiting for chunk {} of {}",
                            idx + 1,
                            total_chunks
                        ));
                    }
                }

                let decoded = urlencoding::decode(&full_encoded)
                    .map_err(|e| format!("Full decode error: {}", e))?;
                let val: serde_json::Value = serde_json::from_str(&decoded)
                    .map_err(|e| format!("Full JSON parse error: {}", e))?;
                let _ = session.eval(&format!("window.__MUSE_BRIDGE__.cleanup('{}');", nonce));
                return parse_bridge_payload(val);
            }
        }
    }

    Err(format!(
        "Action '{}' timed out after {}ms waiting for bridge response",
        action, timeout_ms
    ))
}

// ==========================================
// Tauri commands
// ==========================================

fn is_portable_mode() -> bool {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            if exe_dir.join("portable").exists()
                || exe_dir.join("portable.txt").exists()
                || exe_dir.join(".portable").exists()
            {
                return true;
            }
        }
    }
    false
}

fn get_writable_avatar_dir(app: &AppHandle) -> PathBuf {
    // 1. Portable mode (a portable marker exists next to the exe)
    if is_portable_mode() {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                return exe_dir.join("avatars");
            }
        }
    }

    // 2. Normal operation: the OS user's persistent data area (%LOCALAPPDATA%\works.mowthow.muse.gadgets\avatars)
    //    This survives uninstalls and updates via the installer
    if let Ok(local_dir) = app.path().app_local_data_dir() {
        return local_dir.join("avatars");
    }

    // 3. Dev environment fallback: src-tauri/assets/avatars
    let manifest_avatars = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("assets")
        .join("avatars");
    if manifest_avatars.exists() {
        return manifest_avatars;
    }

    PathBuf::from("avatars")
}

// Auto-seed the initial config files (setting.json / quotes.json) into the install / distribution location
fn ensure_avatar_seeds(app: &AppHandle) {
    let base_dir = get_writable_avatar_dir(app);
    let _ = fs::create_dir_all(&base_dir);

    // avatars/setting.json
    let setting_path = base_dir.join("setting.json");
    if !setting_path.exists() {
        let _ = fs::write(&setting_path, EMBEDDED_SETTING_JSON);
    }

    // avatars/plugin/quotes.json
    let plugin_dir = base_dir.join("plugin");
    let _ = fs::create_dir_all(&plugin_dir);
    let quotes_path = plugin_dir.join("quotes.json");
    if !quotes_path.exists() {
        let _ = fs::write(&quotes_path, EMBEDDED_QUOTES_JSON);
    }
}

fn collect_avatar_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut avatar_dirs: Vec<PathBuf> = Vec::new();

    // 1. Highest priority: the writable avatar directory (%LOCALAPPDATA%, or next to the exe in portable mode)
    let writable = get_writable_avatar_dir(app);
    if writable.exists() && !avatar_dirs.contains(&writable) {
        avatar_dirs.push(writable.clone());
    }

    // 2. The avatars folder next to the executable (searched even in normal mode, in case videos etc. sit beside the exe)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let exe_avatars = exe_dir.join("avatars");
            if exe_avatars.exists() && !avatar_dirs.contains(&exe_avatars) {
                avatar_dirs.push(exe_avatars);
            }
        }
    }

    // 3. resource_dir (resources bundled with the NSIS installer)
    if let Ok(res_dir) = app.path().resource_dir() {
        let r1 = res_dir.join("assets").join("avatars");
        if r1.exists() && !avatar_dirs.contains(&r1) {
            avatar_dirs.push(r1);
        }
        let r2 = res_dir.join("avatars");
        if r2.exists() && !avatar_dirs.contains(&r2) {
            avatar_dirs.push(r2);
        }
    }

    // 4. src-tauri/assets/avatars inside the project (dev fallback)
    let manifest_avatars = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("assets")
        .join("avatars");
    if manifest_avatars.exists() && !avatar_dirs.contains(&manifest_avatars) {
        avatar_dirs.push(manifest_avatars);
    }

    if !avatar_dirs.contains(&writable) {
        avatar_dirs.insert(0, writable);
    }

    avatar_dirs
}

fn load_plugin_configs_internal(app: &AppHandle) -> PluginConfigsPayload {
    let avatar_dirs = collect_avatar_dirs(app);
    let mut setting_val: serde_json::Value =
        serde_json::from_str(EMBEDDED_SETTING_JSON).unwrap_or_else(|_| serde_json::json!({}));
    let mut quotes_val: serde_json::Value =
        serde_json::from_str(EMBEDDED_QUOTES_JSON).unwrap_or_else(|_| serde_json::json!({}));

    let plugin_dir_opt = avatar_dirs
        .iter()
        .map(|d| d.join("plugin"))
        .find(|p| p.exists() && p.is_dir());

    // Search for setting.json (avatars/setting.json -> plugin/setting.json -> project-root/setting.json)
    let mut setting_candidates: Vec<PathBuf> = Vec::new();
    for d in &avatar_dirs {
        setting_candidates.push(d.join("setting.json"));
    }
    if let Some(ref pdir) = plugin_dir_opt {
        setting_candidates.push(pdir.join("setting.json"));
    }
    if let Some(proj_root) = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent() {
        setting_candidates.push(proj_root.join("setting.json"));
    }

    for sp in setting_candidates {
        if sp.exists() {
            if let Ok(txt) = fs::read_to_string(&sp) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&txt) {
                    setting_val = parsed;
                    break;
                }
            }
        }
    }

    // Search for quotes.json
    if let Some(ref pdir) = plugin_dir_opt {
        let quotes_path = pdir.join("quotes.json");
        if quotes_path.exists() {
            if let Ok(txt) = fs::read_to_string(&quotes_path) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&txt) {
                    quotes_val = parsed;
                }
            }
        }
    }

    PluginConfigsPayload {
        setting: setting_val,
        quotes: quotes_val,
    }
}

#[tauri::command]
fn get_plugin_configs(app: AppHandle) -> Result<PluginConfigsPayload, String> {
    Ok(load_plugin_configs_internal(&app))
}

#[tauri::command]
fn save_plugin_configs(
    app: AppHandle,
    setting: serde_json::Value,
    quotes: serde_json::Value,
) -> Result<bool, String> {
    let target_dir = get_writable_avatar_dir(&app);
    let _ = fs::create_dir_all(&target_dir);
    let setting_path = target_dir.join("setting.json");
    let setting_str = serde_json::to_string_pretty(&setting)
        .map_err(|e| format!("Failed to serialize setting: {}", e))?;
    fs::write(&setting_path, setting_str)
        .map_err(|e| format!("Failed to write setting.json: {}", e))?;

    let plugin_dir = target_dir.join("plugin");
    let _ = fs::create_dir_all(&plugin_dir);
    let quotes_path = plugin_dir.join("quotes.json");
    let quotes_str = serde_json::to_string_pretty(&quotes)
        .map_err(|e| format!("Failed to serialize quotes: {}", e))?;
    fs::write(&quotes_path, quotes_str)
        .map_err(|e| format!("Failed to write quotes.json: {}", e))?;

    // Emit a settings-updated event to the main window
    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.emit("settings-updated", ());
    }

    Ok(true)
}

#[tauri::command]
fn get_live_quotes(app: AppHandle) -> Result<serde_json::Value, String> {
    let default_val = serde_json::json!({
        "items": [],
        "updated_at": "",
        "last_wake_at": 0,
        "daily_wake_date": "",
        "daily_wake_count": 0,
        "recent_shown": []
    });

    let writable_path = get_writable_avatar_dir(&app).join("plugin").join("live_quotes.json");
    if writable_path.exists() {
        if let Ok(txt) = fs::read_to_string(&writable_path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&txt) {
                return Ok(parsed);
            }
        }
    }

    for dir in collect_avatar_dirs(&app) {
        let candidate = dir.join("plugin").join("live_quotes.json");
        if candidate.exists() {
            if let Ok(txt) = fs::read_to_string(&candidate) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&txt) {
                    return Ok(parsed);
                }
            }
        }
    }

    Ok(default_val)
}

#[tauri::command]
fn save_live_quotes(app: AppHandle, payload: serde_json::Value) -> Result<bool, String> {
    let plugin_dir = get_writable_avatar_dir(&app).join("plugin");
    let _ = fs::create_dir_all(&plugin_dir);
    let live_quotes_path = plugin_dir.join("live_quotes.json");
    let content = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("Failed to serialize live_quotes: {}", e))?;
    fs::write(&live_quotes_path, content)
        .map_err(|e| format!("Failed to write live_quotes.json: {}", e))?;
    Ok(true)
}

fn extract_latest_assistant_text(messages_val: &serde_json::Value) -> Option<String> {
    let arr = messages_val.as_array()?;
    for item in arr.iter().rev() {
        if item.get("role").and_then(|v| v.as_str()) == Some("assistant") {
            if let Some(txt) = item.get("text").and_then(|v| v.as_str()) {
                return Some(txt.to_string());
            }
        }
    }
    None
}

fn normalize_url_for_compare(u: &str) -> String {
    let base = u.trim().split('?').next().unwrap_or("").split('#').next().unwrap_or("");
    base.trim_end_matches('/').to_lowercase()
}

pub fn is_same_chat_url(before_url: &str, after_url: &str) -> bool {
    let b = normalize_url_for_compare(before_url);
    let a = normalize_url_for_compare(after_url);
    !b.is_empty() && b == a
}

async fn wait_for_chat_ready(
    session: &WebviewWindow,
    expected_url: Option<&str>,
    timeout_ms: u64,
    did_navigate: bool,
) -> Result<bool, String> {
    let start = Instant::now();
    let timeout = Duration::from_millis(timeout_ms);

    if did_navigate {
        tokio::time::sleep(Duration::from_millis(2200)).await;
    } else {
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    while start.elapsed() < timeout {
        let check_res = run_bridge_action(
            session,
            "check_chat_ready",
            &serde_json::json!({ "expectedUrl": expected_url }),
            1500,
        )
        .await;

        match check_res {
            Ok(val) => {
                let ready = val.get("ready").and_then(|v| v.as_bool()).unwrap_or(false);
                let url_matched = val.get("urlMatched").and_then(|v| v.as_bool()).unwrap_or(false);
                
                if ready && url_matched {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    return Ok(true);
                }
            }
            Err(_) => {}
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    let err_msg = format!("Timed out waiting for chat ready (expected: {:?})", expected_url);
    Err(err_msg)
}

#[tauri::command]
async fn send_live_quotes_wake(
    app: AppHandle,
    text: String,
    chat_url: Option<String>,
) -> Result<serde_json::Value, String> {
    let session = ensure_session_window(&app)?;
    if let Some(ref url_str) = chat_url {
        let trimmed = url_str.trim();
        if trimmed.starts_with("https://") {
            let current_url = session.url().ok().map(|u| u.to_string()).unwrap_or_default();
            let norm_cur = normalize_url_for_compare(&current_url);
            let norm_target = normalize_url_for_compare(trimmed);
            if norm_cur != norm_target {
                if let Ok(parsed_url) = trimmed.parse::<tauri::Url>() {
                    let _ = session.navigate(parsed_url);
                    wait_for_chat_ready(&session, Some(trimmed), 15000, true).await?;
                } else {
                    return Err(format!("Invalid custom_chat_url: {}", trimmed));
                }
            } else {
                wait_for_chat_ready(&session, Some(trimmed), 5000, false).await?;
            }
        }
    } else {
    }

    // Get the latest assistant message just before sending (past-log baseline)
    let pre_msgs = run_bridge_action(
        &session,
        "get_messages",
        &serde_json::json!({ "limit": 5 }),
        3000,
    )
    .await
    .ok();
    let pre_wake_assistant = pre_msgs.as_ref().and_then(extract_latest_assistant_text);

    let send_res = run_bridge_action(
        &session,
        "send_message",
        &serde_json::json!({ "text": text }),
        8000,
    )
    .await?;

    Ok(serde_json::json!({
        "sendResult": send_res,
        "preWakeAssistant": pre_wake_assistant
    }))
}

#[tauri::command]
async fn navigate_session(app: AppHandle, url: String) -> Result<serde_json::Value, String> {
    let session = ensure_session_window(&app)?;
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Ok(serde_json::json!({ "ok": false }));
    }
    let current_url = session.url().ok().map(|u| u.to_string()).unwrap_or_default();
    let norm_cur = normalize_url_for_compare(&current_url);
    let norm_target = normalize_url_for_compare(trimmed);
    if norm_cur != norm_target {
        if let Ok(parsed_url) = trimmed.parse::<tauri::Url>() {
            let _ = session.navigate(parsed_url);
            let _ = wait_for_chat_ready(&session, Some(trimmed), 15000, true).await;
        } else {
            return Err(format!("Invalid URL: {}", trimmed));
        }
    } else {
        let _ = wait_for_chat_ready(&session, Some(trimmed), 5000, false).await;
    }

    let post_msgs = run_bridge_action(
        &session,
        "get_messages",
        &serde_json::json!({ "limit": 5 }),
        3000,
    )
    .await
    .ok();
    let latest_assistant = post_msgs.as_ref().and_then(extract_latest_assistant_text);

    Ok(serde_json::json!({
        "ok": true,
        "latestAssistant": latest_assistant
    }))
}

#[tauri::command]
fn open_avatar_dir(app: AppHandle, target: String) -> Result<bool, String> {
    ensure_avatar_seeds(&app);
    let base_dir = get_writable_avatar_dir(&app);
    let dir_to_open = if target == "plugin" {
        base_dir.join("plugin")
    } else {
        base_dir
    };

    let _ = fs::create_dir_all(&dir_to_open);

    #[cfg(target_os = "windows")]
    {
        let path_str = dir_to_open.to_string_lossy().to_string();
        std::process::Command::new("explorer")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }

    Ok(true)
}

#[tauri::command]
async fn open_settings_window(app: AppHandle) -> Result<bool, String> {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(true);
    }

    let win = WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App("settings.html".into()),
    )
    .title("Desktop Mascot for Muse - Settings")
    .inner_size(640.0, 720.0)
    .min_inner_size(480.0, 540.0)
    .resizable(true)
    .visible(true)
    .center()
    .build()
    .map_err(|e| format!("Failed to create settings window: {}", e))?;

    let _ = win.set_icon(tauri::include_image!("icons/128x128.png"));
    let _ = win.set_focus();
    Ok(true)
}

#[tauri::command]
async fn close_settings_window(app: AppHandle) -> Result<bool, String> {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.destroy();
    }
    Ok(true)
}

#[tauri::command]
fn get_avatar_video_pack(app: AppHandle) -> Result<AvatarVideoPack, String> {
    let avatar_dirs = collect_avatar_dirs(&app);

    let load_one_opt = |name: &str| -> Option<String> {
        for dir in &avatar_dirs {
            let file_path = dir.join(name);
            if file_path.exists() {
                if let Ok(bytes) = fs::read(&file_path) {
                    if !bytes.is_empty() {
                        return Some(format!("data:video/mp4;base64,{}", BASE64_STANDARD.encode(&bytes)));
                    }
                }
            }
        }
        None
    };

    let idle = load_one_opt("idle.mp4").unwrap_or_default();
    let waking = load_one_opt("waking.mp4").unwrap_or_else(|| idle.clone());
    let working = load_one_opt("working.mp4").unwrap_or_else(|| idle.clone());
    let making_something = load_one_opt("making_something.mp4").unwrap_or_else(|| working.clone());
    let milestone_level_up = load_one_opt("milestone_level_up.mp4").unwrap_or_else(|| idle.clone());

    let configs = load_plugin_configs_internal(&app);
    let mut plugins: Vec<PluginVideoItem> = Vec::new();

    // Collect and merge plugin/*.mp4 exhaustively from every candidate directory (Issue #38)
    let mut loaded_plugin_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    for d in &avatar_dirs {
        let pdir = d.join("plugin");
        if pdir.exists() && pdir.is_dir() {
            if let Ok(entries) = fs::read_dir(&pdir) {
                let mut mp4_paths: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok().map(|de| de.path()))
                    .filter(|p| {
                        p.is_file()
                            && p.extension()
                                .and_then(|ext| ext.to_str())
                                .map(|ext| ext.eq_ignore_ascii_case("mp4"))
                                .unwrap_or(false)
                    })
                    .collect();
                mp4_paths.sort();

                for path in mp4_paths {
                    let Some(file_name) = path.file_name().and_then(|n| n.to_str()).map(|s| s.to_string()) else {
                        continue;
                    };

                    if loaded_plugin_names.contains(&file_name) {
                        continue;
                    }

                    if let Ok(bytes) = fs::read(&path) {
                        if !bytes.is_empty() {
                            let data_url =
                                format!("data:video/mp4;base64,{}", BASE64_STANDARD.encode(&bytes));
                            loaded_plugin_names.insert(file_name.clone());
                            plugins.push(PluginVideoItem {
                                name: file_name,
                                data_url,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(AvatarVideoPack {
        idle,
        waking,
        working,
        making_something,
        milestone_level_up,
        plugins,
        setting: configs.setting,
        quotes: configs.quotes,
    })
}

#[tauri::command]
async fn get_avatar_data_url(
    app: AppHandle,
    force_refresh: Option<bool>,
) -> Result<String, String> {
    let cache_path = get_avatar_cache_path(&app)?;
    let force = force_refresh.unwrap_or(false);

    if !force && cache_path.exists() {
        if let Ok(content) = fs::read_to_string(&cache_path) {
            let trimmed = content.trim();
            if trimmed.starts_with("data:video/") {
                return Ok(trimmed.to_string());
            }
        }
    }

    // Fetch the avatar video Base64 from the session
    let session = ensure_session_window(&app)?;
    let res = run_bridge_action(&session, "get_avatar", &serde_json::json!({}), 30000).await?;

    let data_url = res
        .as_str()
        .ok_or_else(|| "Avatar result is not a string".to_string())?;

    if data_url.starts_with("data:video/") {
        let _ = fs::write(&cache_path, data_url);
        Ok(data_url.to_string())
    } else {
        Err("Invalid avatar data URL received".to_string())
    }
}

#[tauri::command]
async fn get_chat_messages(
    app: AppHandle,
    limit: Option<usize>,
) -> Result<Vec<ChatMessage>, String> {
    let session = ensure_session_window(&app)?;
    let msg_limit = limit.unwrap_or(5);
    let res = run_bridge_action(
        &session,
        "get_messages",
        &serde_json::json!({ "limit": msg_limit }),
        8000,
    )
    .await?;

    let messages: Vec<ChatMessage> = serde_json::from_value(res)
        .map_err(|e| format!("Failed to parse chat messages: {}", e))?;
    Ok(messages)
}

#[tauri::command]
async fn inspect_latest_message(app: AppHandle) -> Result<serde_json::Value, String> {
    let session = ensure_session_window(&app)?;
    let res = run_bridge_action(&session, "inspect_latest", &serde_json::json!({}), 20000).await;
    match res {
        Ok(val) => {
            if let Ok(dir) = app.path().app_local_data_dir() {
                let dump_path = dir.join("latest_inspect.json");
                let _ = fs::write(&dump_path, serde_json::to_string_pretty(&val).unwrap_or_default());
            }
            Ok(val)
        }
        Err(e) => {
            if let Ok(dir) = app.path().app_local_data_dir() {
                let dump_path = dir.join("latest_inspect_error.txt");
                let _ = fs::write(&dump_path, format!("inspect_latest error: {}", e));
            }
            Err(e)
        }
    }
}

#[tauri::command]
async fn send_chat_message(
    app: AppHandle,
    text: String,
) -> Result<serde_json::Value, String> {
    let session = ensure_session_window(&app)?;
    run_bridge_action(
        &session,
        "send_message",
        &serde_json::json!({ "text": text }),
        8000,
    )
    .await
}

#[tauri::command]
async fn get_usage_limit(
    app: AppHandle,
    force_refresh: Option<bool>,
) -> Result<UsageLimitInfo, String> {
    let force = force_refresh.unwrap_or(false);
    if !force {
        let config = load_config_internal(&app);
        if let Some(mut info) = config.last_limit_info {
            if info.used_percent.is_some() || info.remaining_percent.is_some() {
                // Cache TTL check (valid within 2 minutes; re-fetch automatically once older)
                let is_fresh = chrono::NaiveDateTime::parse_from_str(&format!("{}:00", info.updated_at), "%Y-%m-%d %H:%M:%S")
                    .map(|dt| {
                        let now = Local::now().naive_local();
                        now.signed_duration_since(dt).num_seconds() < 120
                    })
                    .unwrap_or(false);

                if is_fresh {
                    if info.reset_text.contains("mp4") || info.reset_text.contains("KB") {
                        info.reset_text = "Your weekly limit resets on November 6".to_string();
                        let fixed = info.clone();
                        update_config_internal(&app, |cfg| {
                            cfg.last_limit_info = Some(fixed);
                        });
                    }
                    return Ok(info);
                }
            }
        }
    }

    let session = ensure_session_window(&app)?;
    // §16 guardrail ①: suppress automatic screen navigation while the session WebView is visible (full UI shown) or during a non-forced fetch (periodic polling) (Issue #49)
    let is_session_visible = session.is_visible().unwrap_or(false) && !session.is_minimized().unwrap_or(false);
    let passive_only = is_session_visible || !force;
    let res = match run_bridge_action(
        &session,
        "fetch_limit",
        &serde_json::json!({ "passiveOnly": passive_only }),
        15000,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            if force {
                append_recovery_log(
                    &app,
                    "usage_limit_trace",
                    &format!("force={}, visible={}, bridge_err={}", force, is_session_visible, e),
                );
            }
            return Err(e);
        }
    };

    let debug_trace = res
        .get("debug_trace")
        .and_then(|v| v.as_str())
        .unwrap_or("none");

    let plan_name = res
        .get("plan_name")
        .and_then(|v| v.as_str())
        .unwrap_or("Free Plan")
        .to_string();

    let mut used_percent = res
        .get("used_percent")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    let mut remaining_percent = res
        .get("remaining_percent")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    // Auto-fill used_percent and remaining_percent from each other (Issue #33)
    if remaining_percent.is_none() && used_percent.is_some() {
        remaining_percent = Some(100u32.saturating_sub(used_percent.unwrap()));
    } else if used_percent.is_none() && remaining_percent.is_some() {
        used_percent = Some(100u32.saturating_sub(remaining_percent.unwrap()));
    }

    let reset_text = res
        .get("reset_text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let now_str = Local::now().format("%Y-%m-%d %H:%M").to_string();

    let info = UsageLimitInfo {
        plan_name,
        used_percent,
        remaining_percent,
        reset_text,
        updated_at: now_str.clone(),
    };

    if info.used_percent.is_some() || info.remaining_percent.is_some() {
        let prev_cfg = load_config_internal(&app);
        let changed = has_usage_limit_changed(prev_cfg.last_limit_info.as_ref(), &info);
        if force {
            append_recovery_log(
                &app,
                "usage_limit_trace",
                &format!(
                    "force={}, visible={}, passive={}, trace={}, rem={:?}, used={:?}, changed={}",
                    force, is_session_visible, passive_only, debug_trace, info.remaining_percent, info.used_percent, changed
                ),
            );
        }
        let saved = info.clone();
        if changed {
            update_config_internal(&app, |cfg| {
                cfg.last_limit_info = Some(saved);
            });
        } else {
            update_config_memory_only(&app, |cfg| {
                cfg.last_limit_info = Some(saved);
            });
        }
        return Ok(info);
    }

    if force {
        append_recovery_log(
            &app,
            "usage_limit_trace",
            &format!(
                "force={}, visible={}, passive={}, trace={}, result=no_percent_fallback_to_prev",
                force, is_session_visible, passive_only, debug_trace
            ),
        );
    }

    let latest_cfg = load_config_internal(&app);
    if let Some(mut prev) = latest_cfg.last_limit_info {
        if prev.used_percent.is_some() || prev.remaining_percent.is_some() {
            if prev.reset_text.contains("mp4") || prev.reset_text.contains("KB") {
                prev.reset_text = "".to_string();
                let fixed = prev.clone();
                update_config_internal(&app, |cfg| {
                    cfg.last_limit_info = Some(fixed);
                });
            }
            return Ok(prev);
        }
    }

    // If there is no cache and no fresh fetch has completed yet, return a not-yet-fetched UsageLimitInfo (do not invent percentage values)
    let fallback = UsageLimitInfo {
        plan_name: "Free Plan".to_string(),
        used_percent: None,
        remaining_percent: None,
        reset_text: "Sync from the session screen under [Settings > General]".to_string(),
        updated_at: now_str,
    };
    Ok(fallback)
}

#[tauri::command]
async fn get_avatar_state(app: AppHandle) -> Result<serde_json::Value, String> {
    let session = ensure_session_window(&app)?;
    run_bridge_action(&session, "get_avatar_state", &serde_json::json!({}), 4000).await
}

#[tauri::command]
async fn check_bridge_health(app: AppHandle) -> Result<serde_json::Value, String> {
    let session = ensure_session_window(&app)?;
    let res = run_bridge_action(&session, "check_health", &serde_json::json!({}), 6000).await?;
    if let Some(name) = res.get("avatar_name").and_then(|v| v.as_str()) {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            let trimmed_owned = trimmed.to_string();
            update_config_internal(&app, |config| {
                if config.avatar_name != trimmed_owned {
                    config.avatar_name = trimmed_owned;
                }
            });
        }
    }
    Ok(res)
}

#[tauri::command]
fn get_gadget_config(app: AppHandle) -> Result<GadgetConfig, String> {
    Ok(load_config_internal(&app))
}

#[tauri::command]
fn save_gadget_config(app: AppHandle, config: GadgetConfig) -> Result<(), String> {
    save_config_internal(&app, &config)
}

fn get_nearest_monitor(win: &WebviewWindow, target_x: i32, target_y: i32) -> Option<tauri::Monitor> {
    if let Ok(monitors) = win.available_monitors() {
        if monitors.is_empty() {
            return None;
        }
        // 1. Find the monitor containing the target coordinates
        for mon in &monitors {
            let pos = mon.position();
            let size = mon.size();
            if target_x >= pos.x
                && target_x < pos.x + size.width as i32
                && target_y >= pos.y
                && target_y < pos.y + size.height as i32
            {
                return Some(mon.clone());
            }
        }
        // 2. Find the monitor nearest to the target coordinates (smallest squared distance between center points)
        let mut best: Option<(i64, tauri::Monitor)> = None;
        for mon in monitors {
            let pos = mon.position();
            let size = mon.size();
            let cx = pos.x as i64 + (size.width as i64) / 2;
            let cy = pos.y as i64 + (size.height as i64) / 2;
            let dx = cx - (target_x as i64);
            let dy = cy - (target_y as i64);
            let dist_sq = dx * dx + dy * dy;
            match best {
                Some((d, _)) if dist_sq < d => best = Some((dist_sq, mon)),
                None => best = Some((dist_sq, mon)),
                _ => {}
            }
        }
        if let Some((_, mon)) = best {
            return Some(mon);
        }
    }
    win.current_monitor().ok().flatten().or_else(|| win.primary_monitor().ok().flatten())
}

fn get_mascot_default_position(win: &WebviewWindow, scale_str: &str) -> (i32, i32) {
    let (mw, mh, _) = get_mascot_dimensions(scale_str);
    let monitor = win.current_monitor().ok().flatten().or_else(|| win.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let mon_pos = monitor.position();
        let mon_size = monitor.size();
        let scale = monitor.scale_factor();
        let win_w = (mw * scale) as i32;
        let win_h = (mh * scale) as i32;
        // Bottom-right corner of the desktop (about 56px margin above the taskbar, about 20px from the right edge)
        let x = mon_pos.x + (mon_size.width as i32) - win_w - 20;
        let y = mon_pos.y + (mon_size.height as i32) - win_h - 56;
        (x, y)
    } else {
        (100, 100)
    }
}

fn clamp_window_to_monitor(
    win: &WebviewWindow,
    target_pos: Option<(i32, i32)>,
    target_size: Option<tauri::PhysicalSize<u32>>,
) {
    let cur_pos = win.outer_position().unwrap_or(tauri::PhysicalPosition::new(100, 100));
    let (tx, ty) = target_pos.unwrap_or((cur_pos.x, cur_pos.y));

    // Always prefer the monitor nearest to the target coordinates
    let monitor = get_nearest_monitor(win, tx, ty)
        .or_else(|| win.current_monitor().ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        let _ = win.set_position(tauri::PhysicalPosition::new(tx, ty));
        return;
    };
    let mon_pos = monitor.position();
    let mon_size = monitor.size();
    let win_size = target_size.unwrap_or_else(|| {
        win.outer_size().unwrap_or(tauri::PhysicalSize::new(360, 580))
    });

    let mut x = tx;
    let mut y = ty;

    let max_x = mon_pos.x + (mon_size.width as i32) - (win_size.width as i32) - 12;
    let max_y = mon_pos.y + (mon_size.height as i32) - (win_size.height as i32) - 48;
    let min_x = mon_pos.x + 12;
    let min_y = mon_pos.y + 12;

    if x > max_x { x = max_x; }
    if x < min_x { x = min_x; }
    if y > max_y { y = max_y; }
    if y < min_y { y = min_y; }

    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}

#[tauri::command]
async fn toggle_size_mode(app: AppHandle) -> Result<String, String> {
    let mut config = load_config_internal(&app);
    let prev_mode = config.size_mode.clone();
    
    // If currently in mascot mode, restore the previous normal mode
    if prev_mode == "mascot" {
        return restore_from_mascot(app).await;
    }

    let next_mode = if prev_mode == "small" {
        "large".to_string()
    } else {
        "small".to_string()
    };

    if let Some(win) = app.get_webview_window("main") {
        if let Ok(cur_pos) = win.outer_position() {
            if prev_mode == "small" {
                config.small_pos = Some((cur_pos.x, cur_pos.y));
            } else if prev_mode == "large" {
                config.large_pos = Some((cur_pos.x, cur_pos.y));
            }
        }

        let (w, h) = if next_mode == "large" {
            (LARGE_WIDTH, LARGE_HEIGHT)
        } else {
            (SMALL_WIDTH, SMALL_HEIGHT)
        };
        let scale_factor = win.scale_factor().unwrap_or(1.0);
        let target_size = tauri::PhysicalSize::new((w * scale_factor).round() as u32, (h * scale_factor).round() as u32);
        let _ = win.set_size(LogicalSize::new(w, h));

        let saved_target = if next_mode == "large" {
            config.large_pos
        } else {
            config.small_pos
        };
        clamp_window_to_monitor(&win, saved_target, Some(target_size));
    }

    config.size_mode = next_mode.clone();
    config.last_normal_mode = next_mode.clone();
    let _ = save_config_internal(&app, &config);
    set_mascot_mode_hit_state(&app, next_mode == "mascot");

    Ok(next_mode)
}

#[tauri::command]
async fn enter_mascot_mode(app: AppHandle) -> Result<String, String> {
    let mut config = load_config_internal(&app);
    let prev_mode = config.size_mode.clone();

    if prev_mode != "mascot" {
        config.last_normal_mode = prev_mode.clone();
    }

    IS_RESTORING_MASCOT.store(true, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) && !win.is_minimized().unwrap_or(false) {
            if let Ok(cur_pos) = win.outer_position() {
                if cur_pos.x > -10000 && cur_pos.y > -10000 {
                    if prev_mode == "small" {
                        config.small_pos = Some((cur_pos.x, cur_pos.y));
                    } else if prev_mode == "large" {
                        config.large_pos = Some((cur_pos.x, cur_pos.y));
                    }
                }
            }
        }

        let (mw, mh, _) = get_mascot_dimensions(&config.mascot_scale);
        let scale_factor = win.scale_factor().unwrap_or(1.0);
        let target_size = tauri::PhysicalSize::new((mw * scale_factor).round() as u32, (mh * scale_factor).round() as u32);
        let _ = win.set_size(LogicalSize::new(mw, mh));
        let saved_pos = get_last_mascot_pos().or(config.mascot_pos);
        let target_pos = saved_pos.unwrap_or_else(|| get_mascot_default_position(&win, &config.mascot_scale));
        clamp_window_to_monitor(&win, Some(target_pos), Some(target_size));
        if let Ok(new_pos) = win.outer_position() {
            if new_pos.x > -10000 && new_pos.y > -10000 {
                set_last_mascot_pos((new_pos.x, new_pos.y));
                config.mascot_pos = Some((new_pos.x, new_pos.y));
            }
        }
    }
    IS_RESTORING_MASCOT.store(false, Ordering::SeqCst);

    config.size_mode = "mascot".to_string();
    let _ = save_config_internal(&app, &config);
    set_mascot_mode_hit_state(&app, true);

    Ok("mascot".to_string())
}

#[tauri::command]
async fn set_mascot_scale(app: AppHandle, scale: String) -> Result<String, String> {
    let mut config = load_config_internal(&app);
    let old_scale = config.mascot_scale.clone();
    let scale_str = match scale.as_str() {
        "large" => "large",
        "small" => "small",
        _ => "standard",
    };
    config.mascot_scale = scale_str.to_string();

    IS_RESTORING_MASCOT.store(true, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window("main") {
        if config.size_mode == "mascot" {
            let (old_lw, old_lh, _) = get_mascot_dimensions(&old_scale);
            let (new_lw, new_lh, _) = get_mascot_dimensions(scale_str);

            let cur_pos = win.outer_position().unwrap_or(tauri::PhysicalPosition::new(100, 100));
            let scale_factor = win.scale_factor().unwrap_or(1.0);

            let old_pw = (old_lw * scale_factor).round() as i32;
            let old_ph = (old_lh * scale_factor).round() as i32;
            let new_pw = (new_lw * scale_factor).round() as i32;
            let new_ph = (new_lh * scale_factor).round() as i32;

            let old_avatar_lw = get_mascot_avatar_size(&old_scale);
            let new_avatar_lw = get_mascot_avatar_size(scale_str);

            let old_avatar_pw = old_avatar_lw * scale_factor;
            let new_avatar_pw = new_avatar_lw * scale_factor;
            let pad_p = 6.0 * scale_factor;

            // Compute the avatar's absolute center coordinates exactly, based on the current bubble-on-left state
            let is_on_right = config.mascot_bubble_on_left;

            let cur_avatar_cx = if is_on_right {
                (cur_pos.x as f64) + (old_pw as f64) - (pad_p + old_avatar_pw / 2.0)
            } else {
                (cur_pos.x as f64) + (pad_p + old_avatar_pw / 2.0)
            };
            let cur_avatar_cy = (cur_pos.y as f64) + (old_ph as f64) / 2.0;

            // New window position: work backwards so the avatar's on-screen center coordinates match exactly
            let target_x = if is_on_right {
                cur_avatar_cx - ((new_pw as f64) - (pad_p + new_avatar_pw / 2.0))
            } else {
                cur_avatar_cx - (pad_p + new_avatar_pw / 2.0)
            }.round() as i32;

            let target_y = (cur_avatar_cy - (new_ph as f64) / 2.0).round() as i32;

            let _ = win.set_size(LogicalSize::new(new_lw, new_lh));
            let _ = win.set_position(tauri::PhysicalPosition::new(target_x, target_y));

            set_last_mascot_pos((target_x, target_y));
            config.mascot_pos = Some((target_x, target_y));
        }
        let _ = win.emit("mascot-scale-changed", scale_str);
    }
    IS_RESTORING_MASCOT.store(false, Ordering::SeqCst);

    let _ = save_config_internal(&app, &config);
    Ok(scale_str.to_string())
}

#[tauri::command]
async fn sync_mascot_bubble_direction(app: AppHandle, current_on_left: bool) -> Result<bool, String> {
    let mut config = load_config_internal(&app);
    if config.size_mode != "mascot" {
        return Ok(config.mascot_bubble_on_left);
    }
    if let Some(win) = app.get_webview_window("main") {
        if !win.is_visible().unwrap_or(false) || win.is_minimized().unwrap_or(false) {
            return Ok(config.mascot_bubble_on_left);
        }
        if let Ok(cur_pos) = win.outer_position() {
            if cur_pos.x <= -10000 || cur_pos.y <= -10000 {
                return Ok(config.mascot_bubble_on_left);
            }
            let scale_factor = win.scale_factor().unwrap_or(1.0);
            let (mw, mh, _) = get_mascot_dimensions(&config.mascot_scale);
            let avatar_lw = get_mascot_avatar_size(&config.mascot_scale);

            let win_pw = (mw * scale_factor).round() as f64;
            let win_ph = (mh * scale_factor).round() as f64;
            let avatar_pw = avatar_lw * scale_factor;
            let pad_p = 6.0 * scale_factor;

            // The avatar's center coordinates under the current CSS state (current_on_left)
            let avatar_cx = if current_on_left {
                (cur_pos.x as f64) + win_pw - (pad_p + avatar_pw / 2.0)
            } else {
                (cur_pos.x as f64) + (pad_p + avatar_pw / 2.0)
            };
            let avatar_cy = (cur_pos.y as f64) + win_ph / 2.0;

            let best_mon = get_nearest_monitor(&win, avatar_cx.round() as i32, avatar_cy.round() as i32);
            let mon_center_x = best_mon
                .as_ref()
                .map(|m| m.position().x as f64 + (m.size().width as f64) / 2.0)
                .unwrap_or(960.0);

            let new_on_left = avatar_cx > mon_center_x;

            let final_x = if new_on_left != current_on_left {
                let tx = if new_on_left {
                    avatar_cx - (win_pw - (pad_p + avatar_pw / 2.0))
                } else {
                    avatar_cx - (pad_p + avatar_pw / 2.0)
                }.round() as i32;
                IS_RESTORING_MASCOT.store(true, Ordering::SeqCst);
                let _ = win.set_position(tauri::PhysicalPosition::new(tx, cur_pos.y));
                IS_RESTORING_MASCOT.store(false, Ordering::SeqCst);
                tx
            } else {
                cur_pos.x
            };

            set_last_mascot_pos((final_x, cur_pos.y));
            config.mascot_pos = Some((final_x, cur_pos.y));
            config.mascot_bubble_on_left = new_on_left;
            let _ = save_config_internal(&app, &config);
            return Ok(new_on_left);
        }
    }
    Ok(config.mascot_bubble_on_left)
}

#[tauri::command]
async fn save_current_window_position(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        if !win.is_visible().unwrap_or(false) || win.is_minimized().unwrap_or(false) {
            return Ok(());
        }
        if let Ok(pos) = win.outer_position() {
            if pos.x > -10000 && pos.y > -10000 {
                update_config_internal(&app, |config| {
                    if config.size_mode == "mascot" {
                        set_last_mascot_pos((pos.x, pos.y));
                        config.mascot_pos = Some((pos.x, pos.y));
                    } else if config.size_mode == "large" {
                        config.large_pos = Some((pos.x, pos.y));
                    } else {
                        config.small_pos = Some((pos.x, pos.y));
                    }
                });
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn restore_from_mascot(app: AppHandle) -> Result<String, String> {
    let mut config = load_config_internal(&app);
    let target_mode = if config.last_normal_mode == "large" {
        "large"
    } else {
        "small"
    };

    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) && !win.is_minimized().unwrap_or(false) {
            if let Ok(cur_pos) = win.outer_position() {
                if cur_pos.x > -10000 && cur_pos.y > -10000 && config.size_mode == "mascot" {
                    set_last_mascot_pos((cur_pos.x, cur_pos.y));
                    config.mascot_pos = Some((cur_pos.x, cur_pos.y));
                }
            }
        }

        let (w, h) = if target_mode == "large" {
            (LARGE_WIDTH, LARGE_HEIGHT)
        } else {
            (SMALL_WIDTH, SMALL_HEIGHT)
        };
        let scale_factor = win.scale_factor().unwrap_or(1.0);
        let target_size = tauri::PhysicalSize::new((w * scale_factor).round() as u32, (h * scale_factor).round() as u32);
        let _ = win.set_size(LogicalSize::new(w, h));

        let saved_target = if target_mode == "large" {
            config.large_pos
        } else {
            config.small_pos
        };
        clamp_window_to_monitor(&win, saved_target, Some(target_size));
    }

    config.size_mode = target_mode.to_string();
    let _ = save_config_internal(&app, &config);
    set_mascot_mode_hit_state(&app, false);

    Ok(target_mode.to_string())
}

#[tauri::command]
async fn open_in_browser(app: AppHandle) -> Result<(), String> {
    let _ = app.opener().open_url(BROWSER_URL, None::<&str>);
    Ok(())
}

async fn restore_mascot_window(app: &AppHandle, focus: bool) {
    if let Some(main_win) = app.get_webview_window("main") {
        let mut cfg = load_config_internal(app);
        if cfg.size_mode != "mascot" {
            let _ = enter_mascot_mode(app.clone()).await;
            cfg = load_config_internal(app);
        }
        let (mw, mh, _) = get_mascot_dimensions(&cfg.mascot_scale);
        let scale_factor = main_win.scale_factor().unwrap_or(1.0);
        let target_size = tauri::PhysicalSize::new((mw * scale_factor).round() as u32, (mh * scale_factor).round() as u32);
        let _ = main_win.set_size(LogicalSize::new(mw, mh));

        let target_pos = get_last_mascot_pos()
            .or(cfg.mascot_pos)
            .unwrap_or_else(|| get_mascot_default_position(&main_win, &cfg.mascot_scale));

        IS_RESTORING_MASCOT.store(true, Ordering::SeqCst);
        clamp_window_to_monitor(&main_win, Some(target_pos), Some(target_size));
        let _ = main_win.show();
        let _ = main_win.unminimize();
        let _ = main_win.set_always_on_top(true);
        clamp_window_to_monitor(&main_win, Some(target_pos), Some(target_size));
        if let Ok(new_pos) = main_win.outer_position() {
            if new_pos.x > -10000 && new_pos.y > -10000 {
                set_last_mascot_pos((new_pos.x, new_pos.y));
                update_config_internal(app, |c| {
                    if c.size_mode == "mascot" {
                        c.mascot_pos = Some((new_pos.x, new_pos.y));
                    }
                });
            }
        }
        IS_RESTORING_MASCOT.store(false, Ordering::SeqCst);
        set_mascot_mode_hit_state(app, true);
        let _ = main_win.emit("session-visibility-changed", false);
        if focus {
            let _ = main_win.set_focus();
        }
    }
}

#[tauri::command]
async fn reset_mascot_position(app: AppHandle) -> Result<(), String> {
    if let Some(main_win) = app.get_webview_window("main") {
        let cfg = load_config_internal(&app);
        let def_pos = get_mascot_default_position(&main_win, &cfg.mascot_scale);
        let (mw, mh, _) = get_mascot_dimensions(&cfg.mascot_scale);
        let scale_factor = main_win.scale_factor().unwrap_or(1.0);
        let target_size = tauri::PhysicalSize::new((mw * scale_factor).round() as u32, (mh * scale_factor).round() as u32);
        
        IS_RESTORING_MASCOT.store(true, Ordering::SeqCst);
        clamp_window_to_monitor(&main_win, Some(def_pos), Some(target_size));
        let _ = main_win.show();
        let _ = main_win.unminimize();
        let _ = main_win.set_always_on_top(true);
        if let Ok(new_pos) = main_win.outer_position() {
            set_last_mascot_pos((new_pos.x, new_pos.y));
            update_config_internal(&app, |c| {
                c.mascot_pos = Some((new_pos.x, new_pos.y));
            });
        }
        IS_RESTORING_MASCOT.store(false, Ordering::SeqCst);
        let _ = main_win.set_focus();
    }
    Ok(())
}

#[tauri::command]
async fn open_or_show_session(app: AppHandle) -> Result<SessionStatus, String> {
    let session = ensure_session_window(&app)?;
    
    // When showing the session, notify the mascot to clear unread messages, save the current position, and hide it
    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.emit("clear-unread", ());
        let _ = main_win.emit("session-visibility-changed", true);
        if main_win.is_visible().unwrap_or(false) && !main_win.is_minimized().unwrap_or(false) {
            if let Ok(pos) = main_win.outer_position() {
                if pos.x > -10000 && pos.y > -10000 {
                    set_last_mascot_pos((pos.x, pos.y));
                    update_config_internal(&app, |cfg| {
                        if cfg.size_mode == "mascot" {
                            cfg.mascot_pos = Some((pos.x, pos.y));
                        }
                    });
                }
            }
        }
        let _ = main_win.hide();
    }

    let _ = session.eval("window.__MUSE_SESSION_VISIBLE__ = true;");
    let _ = session.show();
    let _ = session.unminimize();
    let _ = session.set_focus();

    let title = session.title().ok();
    let url = session.url().ok().map(|u| u.to_string());
    Ok(SessionStatus {
        exists: true,
        visible: true,
        title,
        url,
    })
}

#[tauri::command]
async fn hide_session(app: AppHandle) -> Result<SessionStatus, String> {
    if let Some(session) = app.get_webview_window("session") {
        if !session.is_minimized().unwrap_or(false) && session.is_visible().unwrap_or(false) {
            let pos_opt = session
                .outer_position()
                .ok()
                .filter(|p| p.x > -10000 && p.y > -10000)
                .map(|p| (p.x, p.y));
            let size_opt = session.inner_size().ok().and_then(|p_size| {
                let scale = session.scale_factor().unwrap_or(1.0);
                let w = p_size.width as f64 / scale;
                let h = p_size.height as f64 / scale;
                if w >= 250.0 && h >= 250.0 {
                    Some((w, h))
                } else {
                    None
                }
            });
            update_config_internal(&app, |config| {
                if let Some(p) = pos_opt {
                    config.session_pos = Some(p);
                }
                if let Some(s) = size_opt {
                    config.session_size = Some(s);
                }
            });
        }

        let _ = session.eval("window.__MUSE_SESSION_VISIBLE__ = false;");
        let _ = session.hide();

        // When the session is hidden, show mascot mode (restore at the existing position without resetting it)
        restore_mascot_window(&app, true).await;

        let title = session.title().ok();
        let url = session.url().ok().map(|u| u.to_string());
        Ok(SessionStatus {
            exists: true,
            visible: false,
            title,
            url,
        })
    } else {
        Ok(SessionStatus {
            exists: false,
            visible: false,
            title: None,
            url: None,
        })
    }
}

#[tauri::command]
async fn toggle_minimize_restore(app: AppHandle) -> Result<String, String> {
    let session = ensure_session_window(&app)?;
    let is_visible = session.is_visible().unwrap_or(false);
    let is_focused = session.is_focused().unwrap_or(false);
    let is_minimized = session.is_minimized().unwrap_or(false);

    if is_visible && is_focused && !is_minimized {
        let _ = hide_session(app).await;
        Ok("mascot".to_string())
    } else if !is_visible {
        // When the session is hidden: if the mascot was minimized or hidden, restore the mascot first
        if let Some(main_win) = app.get_webview_window("main") {
            let main_visible = main_win.is_visible().unwrap_or(false);
            let main_minimized = main_win.is_minimized().unwrap_or(false);
            if !main_visible || main_minimized {
                restore_mascot_window(&app, true).await;
                return Ok("mascot".to_string());
            }
        }
        let _ = open_or_show_session(app).await;
        Ok("session".to_string())
    } else {
        let _ = open_or_show_session(app).await;
        Ok("session".to_string())
    }
}

#[tauri::command]
async fn open_mascot_devtools(app: AppHandle) -> Result<bool, String> {
    if let Some(main_win) = app.get_webview_window("main") {
        main_win.open_devtools();
        Ok(true)
    } else {
        Err("main window not found".to_string())
    }
}

#[tauri::command]
async fn open_session_devtools(app: AppHandle) -> Result<bool, String> {
    let session = ensure_session_window(&app)?;
    session.open_devtools();
    Ok(true)
}

#[tauri::command]
async fn get_session_status(app: AppHandle) -> Result<SessionStatus, String> {
    let session = ensure_session_window(&app)?;
    let visible = session.is_visible().unwrap_or(false);
    let title = session.title().ok();
    let url = session.url().ok().map(|u| u.to_string());
    Ok(SessionStatus {
        exists: true,
        visible,
        title,
        url,
    })
}

#[tauri::command]
fn log_session_recovery_event(app: AppHandle, event: String, detail: String) -> bool {
    append_recovery_log(&app, &event, &detail);
    true
}

#[tauri::command]
async fn inspect_session_reload_safety(app: AppHandle) -> Result<serde_json::Value, String> {
    let session = ensure_session_window(&app)?;
    run_bridge_action(&session, "inspect_reload_safety", &serde_json::json!({}), 3000).await
}

#[tauri::command]
async fn reload_session(
    app: AppHandle,
    reason: Option<String>,
    force: Option<bool>,
) -> Result<SessionReloadResult, String> {
    let reason_str = reason.unwrap_or_else(|| "manual".to_string());
    let is_force = force.unwrap_or(false);

    if SESSION_RELOADING
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_err()
    {
        append_recovery_log(
            &app,
            "reload_skipped",
            &format!("reason={}, guard=already_reloading", reason_str),
        );
        return Ok(SessionReloadResult {
            executed: false,
            success: false,
            reason: reason_str,
            skipped_reason: Some("already_reloading".to_string()),
            before_url: String::new(),
            after_url: String::new(),
            url_matched: false,
            ready: false,
        });
    }
    let _reload_guard = SessionReloadGuard;

    let session = ensure_session_window(&app)?;
    let before_url = session.url().ok().map(|u| u.to_string()).unwrap_or_default();

    if !is_force {
        let is_visible = session.is_visible().unwrap_or(false) && !session.is_minimized().unwrap_or(false);
        if is_visible {
            append_recovery_log(
                &app,
                "reload_skipped",
                &format!("reason={}, guard=session_visible, url={}", reason_str, before_url),
            );
            return Ok(SessionReloadResult {
                executed: false,
                success: false,
                reason: reason_str,
                skipped_reason: Some("session_visible".to_string()),
                before_url: before_url.clone(),
                after_url: before_url,
                url_matched: true,
                ready: false,
            });
        }

        match run_bridge_action(&session, "inspect_reload_safety", &serde_json::json!({}), 3000).await {
            Ok(val) => {
                if val.get("isGenerating").and_then(|v| v.as_bool()).unwrap_or(false) {
                    append_recovery_log(
                        &app,
                        "reload_skipped",
                        &format!("reason={}, guard=session_generating, url={}", reason_str, before_url),
                    );
                    return Ok(SessionReloadResult {
                        executed: false,
                        success: false,
                        reason: reason_str,
                        skipped_reason: Some("session_generating".to_string()),
                        before_url: before_url.clone(),
                        after_url: before_url,
                        url_matched: true,
                        ready: false,
                    });
                }
                if val.get("hasDraft").and_then(|v| v.as_bool()).unwrap_or(false) {
                    append_recovery_log(
                        &app,
                        "reload_skipped",
                        &format!("reason={}, guard=session_draft_present, url={}", reason_str, before_url),
                    );
                    return Ok(SessionReloadResult {
                        executed: false,
                        success: false,
                        reason: reason_str,
                        skipped_reason: Some("session_draft_present".to_string()),
                        before_url: before_url.clone(),
                        after_url: before_url,
                        url_matched: true,
                        ready: false,
                    });
                }
            }
            Err(err) => {
                append_recovery_log(
                    &app,
                    "reload_skipped",
                    &format!("reason={}, guard=safety_check_unavailable ({}), url={}", reason_str, err, before_url),
                );
                return Ok(SessionReloadResult {
                    executed: false,
                    success: false,
                    reason: reason_str,
                    skipped_reason: Some("safety_check_unavailable".to_string()),
                    before_url: before_url.clone(),
                    after_url: before_url,
                    url_matched: true,
                    ready: false,
                });
            }
        }
    }

    append_recovery_log(
        &app,
        "reload_start",
        &format!("reason={}, force={}, before_url={}", reason_str, is_force, before_url),
    );

    if let Err(e) = session.reload() {
        let msg = format!("Session reload failed: {}", e);
        append_recovery_log(
            &app,
            "reload_failed",
            &format!("reason={}, error={}, before_url={}", reason_str, msg, before_url),
        );
        return Err(msg);
    }

    let mut final_ready = wait_for_chat_ready(&session, None, 15000, true)
        .await
        .unwrap_or(false);
    let mut after_url = session.url().ok().map(|u| u.to_string()).unwrap_or_default();
    let mut url_matched = is_same_chat_url(&before_url, &after_url);

    if !url_matched && before_url.starts_with("https://") {
        append_recovery_log(
            &app,
            "reload_url_mismatch",
            &format!(
                "reason={}, before_url={}, after_url={} (attempting restore)",
                reason_str, before_url, after_url
            ),
        );
        if let Ok(parsed_url) = before_url.parse::<tauri::Url>() {
            if session.navigate(parsed_url).is_ok() {
                final_ready = wait_for_chat_ready(&session, Some(&before_url), 15000, true)
                    .await
                    .unwrap_or(false);
                after_url = session.url().ok().map(|u| u.to_string()).unwrap_or_default();
                url_matched = is_same_chat_url(&before_url, &after_url);
            }
        }
    }

    let success = final_ready && url_matched;
    append_recovery_log(
        &app,
        if success { "reload_success" } else { "reload_incomplete" },
        &format!(
            "reason={}, ready={}, url_matched={}, before_url={}, after_url={}",
            reason_str, final_ready, url_matched, before_url, after_url
        ),
    );

    let res = SessionReloadResult {
        executed: true,
        success,
        reason: reason_str,
        skipped_reason: None,
        before_url,
        after_url,
        url_matched,
        ready: final_ready,
    };

    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.emit("session-reloaded", &res);
    }

    Ok(res)
}

#[tauri::command]
fn drag_window(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn minimize_window(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn close_window(app: AppHandle) {
    app.exit(0);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AutostartReconcilePlan {
    desired_enabled: bool,
    should_save_config: bool,
    should_apply_os: bool,
}

fn plan_autostart_reconciliation(saved: Option<bool>, os_enabled: bool) -> AutostartReconcilePlan {
    match saved {
        None => AutostartReconcilePlan {
            desired_enabled: os_enabled,
            should_save_config: true,
            should_apply_os: false,
        },
        Some(desired) => AutostartReconcilePlan {
            desired_enabled: desired,
            should_save_config: false,
            should_apply_os: desired != os_enabled,
        },
    }
}

fn sync_autostart_on_startup(app: &AppHandle) -> bool {
    let config = load_config_internal(app);
    let autolaunch = app.autolaunch();
    let os_enabled = autolaunch.is_enabled().unwrap_or(false);
    let plan = plan_autostart_reconciliation(config.autostart_enabled, os_enabled);

    if plan.should_save_config {
        update_config_internal(app, |cfg| {
            cfg.autostart_enabled = Some(plan.desired_enabled);
        });
    }

    if plan.should_apply_os {
        let apply_res = if plan.desired_enabled {
            autolaunch.enable()
        } else {
            autolaunch.disable()
        };
        append_recovery_log(
            app,
            "autostart_reconcile",
            &format!(
                "saved={:?}, os_enabled={}, desired={}, ok={}",
                config.autostart_enabled,
                os_enabled,
                plan.desired_enabled,
                apply_res.is_ok()
            ),
        );
        if apply_res.is_ok() {
            return plan.desired_enabled;
        }
        return os_enabled;
    }

    plan.desired_enabled
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .setup(|app| {
            let handle = app.handle();

            // Auto-seed the initial config files (setting.json / quotes.json)
            ensure_avatar_seeds(handle);

            // Initialize the system tray
            let toggle_app = MenuItem::with_id(handle, "toggle_app", "Session Screen ⇄ Mascot (Ctrl+Shift+M)", true, None::<&str>)?;
            let open_session = MenuItem::with_id(handle, "open_session", "Open Session Screen (Official UI)", true, None::<&str>)?;
            let reload_session_item = MenuItem::with_id(handle, "reload_session", "Reload Session", true, None::<&str>)?;
            let item_settings = MenuItem::with_id(handle, "open_settings", "Settings...", true, None::<&str>)?;
            let item_open_mascot_devtools = MenuItem::with_id(handle, "open_mascot_devtools", "Open Mascot Developer Tools", true, None::<&str>)?;
            let item_open_session_devtools = MenuItem::with_id(handle, "open_devtools", "Open Session Developer Tools", true, None::<&str>)?;
            let toggle_mascot = MenuItem::with_id(handle, "toggle_mascot", "Mascot Mode (Avatar Only)", true, None::<&str>)?;
            let item_reset_pos = MenuItem::with_id(handle, "reset_mascot_pos", "Reset Mascot Position to Initial Position", true, None::<&str>)?;

            // Initialize and persist-sync autostart on startup (Issue #22, #53)
            let is_autostart = sync_autostart_on_startup(handle);
            let item_autostart = CheckMenuItem::with_id(
                handle,
                "toggle_autostart",
                "Launch automatically on Windows startup",
                true,
                is_autostart,
                None::<&str>,
            )?;
            let item_autostart_clone = item_autostart.clone();

            // Initialize sound effects (SE) (Issue #24)
            let initial_sound_enabled = load_plugin_configs_internal(handle)
                .setting
                .get("sound_enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let item_sound = CheckMenuItem::with_id(
                handle,
                "toggle_sound",
                "Play sound effects (SE)",
                true,
                initial_sound_enabled,
                None::<&str>,
            )?;
            let item_sound_clone = item_sound.clone();

            // Mascot display size setting (Issue #25)
            let cur_scale = load_config_internal(handle).mascot_scale;
            let item_scale_large = CheckMenuItem::with_id(
                handle,
                "scale_large",
                "Large (125%)",
                true,
                cur_scale == "large",
                None::<&str>,
            )?;
            let item_scale_standard = CheckMenuItem::with_id(
                handle,
                "scale_standard",
                "Standard (100%)",
                true,
                cur_scale == "standard" || (cur_scale != "large" && cur_scale != "small"),
                None::<&str>,
            )?;
            let item_scale_small = CheckMenuItem::with_id(
                handle,
                "scale_small",
                "Small (80%)",
                true,
                cur_scale == "small",
                None::<&str>,
            )?;

            let item_scale_large_clone = item_scale_large.clone();
            let item_scale_standard_clone = item_scale_standard.clone();
            let item_scale_small_clone = item_scale_small.clone();

            let sub_mascot_size = Submenu::with_items(
                handle,
                "Mascot Display Size",
                true,
                &[&item_scale_large, &item_scale_standard, &item_scale_small],
            )?;

            let open_browser = MenuItem::with_id(handle, "open_browser", "Open Muse in Browser", true, None::<&str>)?;
            let quit = MenuItem::with_id(handle, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(
                handle,
                &[
                    &toggle_app,
                    &open_session,
                    &reload_session_item,
                    &item_settings,
                    &item_open_mascot_devtools,
                    &item_open_session_devtools,
                    &toggle_mascot,
                    &item_reset_pos,
                    &sub_mascot_size,
                    &item_autostart,
                    &item_sound,
                    &open_browser,
                    &quit,
                ],
            )?;

            let _tray = TrayIconBuilder::new()
                .icon(tauri::include_image!("icons/128x128.png"))
                .menu(&menu)
                .tooltip("Desktop Mascot for Muse")
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "toggle_app" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = toggle_minimize_restore(app_clone).await;
                        });
                    }
                    "open_session" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = open_or_show_session(app_clone).await;
                        });
                    }
                    "reload_session" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = reload_session(app_clone, Some("manual_tray".to_string()), Some(true)).await;
                        });
                    }
                    "open_settings" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = open_settings_window(app_clone).await;
                        });
                    }
                    "open_mascot_devtools" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = open_mascot_devtools(app_clone).await;
                        });
                    }
                    "open_devtools" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = open_session_devtools(app_clone).await;
                        });
                    }
                    "toggle_mascot" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = hide_session(app_clone.clone()).await;
                            restore_mascot_window(&app_clone, true).await;
                        });
                    }
                    "reset_mascot_pos" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = reset_mascot_position(app_clone).await;
                        });
                    }
                    "toggle_autostart" => {
                        let autolaunch = app.autolaunch();
                        let currently_enabled = autolaunch.is_enabled().unwrap_or(false);
                        if currently_enabled {
                            if autolaunch.disable().is_ok() {
                                let _ = item_autostart_clone.set_checked(false);
                                update_config_internal(app, |cfg| {
                                    cfg.autostart_enabled = Some(false);
                                });
                            }
                        } else {
                            if autolaunch.enable().is_ok() {
                                let _ = item_autostart_clone.set_checked(true);
                                update_config_internal(app, |cfg| {
                                    cfg.autostart_enabled = Some(true);
                                });
                            }
                        }
                    }
                    "toggle_sound" => {
                        let mut configs = load_plugin_configs_internal(app);
                        let current = configs.setting.get("sound_enabled").and_then(|v| v.as_bool()).unwrap_or(true);
                        let next = !current;
                        if let Some(map) = configs.setting.as_object_mut() {
                            map.insert("sound_enabled".to_string(), serde_json::Value::Bool(next));
                        }
                        let _ = save_plugin_configs(app.clone(), configs.setting, configs.quotes);
                        let _ = item_sound_clone.set_checked(next);
                    }
                    "scale_large" => {
                        let _ = item_scale_large_clone.set_checked(true);
                        let _ = item_scale_standard_clone.set_checked(false);
                        let _ = item_scale_small_clone.set_checked(false);
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = set_mascot_scale(app_clone, "large".to_string()).await;
                        });
                    }
                    "scale_standard" => {
                        let _ = item_scale_large_clone.set_checked(false);
                        let _ = item_scale_standard_clone.set_checked(true);
                        let _ = item_scale_small_clone.set_checked(false);
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = set_mascot_scale(app_clone, "standard".to_string()).await;
                        });
                    }
                    "scale_small" => {
                        let _ = item_scale_large_clone.set_checked(false);
                        let _ = item_scale_standard_clone.set_checked(false);
                        let _ = item_scale_small_clone.set_checked(true);
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = set_mascot_scale(app_clone, "small".to_string()).await;
                        });
                    }
                    "toggle_size" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = toggle_size_mode(app_clone).await;
                        });
                    }
                    "open_browser" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = open_in_browser(app_clone).await;
                        });
                    }
                    "quit" => {
                        flush_config_to_disk(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle().clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = toggle_minimize_restore(app).await;
                        });
                    }
                })
                .build(handle)?;

            // Register the global hotkey (Ctrl+Shift+M): minimize / restore
            if let Ok(shortcut) = "Ctrl+Shift+M".parse::<Shortcut>() {
                let _ = app.global_shortcut().on_shortcut(shortcut, |app, _sc, event| {
                    if event.state() == ShortcutState::Pressed {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = toggle_minimize_restore(app_clone).await;
                        });
                    }
                });
            }

            // Apply the config's initial size, position, and icon to the main window
            let config = load_config_internal(handle);
            set_mascot_mode_hit_state(handle, config.size_mode == "mascot");
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.set_icon(tauri::include_image!("icons/128x128.png"));
                let (w, h) = if config.size_mode == "large" {
                    (LARGE_WIDTH, LARGE_HEIGHT)
                } else if config.size_mode == "mascot" {
                    let (mw, mh, _) = get_mascot_dimensions(&config.mascot_scale);
                    (mw, mh)
                } else {
                    (SMALL_WIDTH, SMALL_HEIGHT)
                };
                let scale_factor = main_win.scale_factor().unwrap_or(1.0);
                let target_size = tauri::PhysicalSize::new((w * scale_factor).round() as u32, (h * scale_factor).round() as u32);
                let _ = main_win.set_size(LogicalSize::new(w, h));

                if config.size_mode == "mascot" {
                    if let Some(pos) = config.mascot_pos.filter(|p| p.0 > -10000 && p.1 > -10000) {
                        set_last_mascot_pos(pos);
                        let _ = main_win.set_position(tauri::PhysicalPosition::new(pos.0, pos.1));
                    } else {
                        let def_pos = get_mascot_default_position(&main_win, &config.mascot_scale);
                        clamp_window_to_monitor(&main_win, Some(def_pos), Some(target_size));
                        if let Ok(actual) = main_win.outer_position() {
                            if actual.x > -10000 && actual.y > -10000 {
                                set_last_mascot_pos((actual.x, actual.y));
                                update_config_internal(handle, |cfg| {
                                    cfg.mascot_pos = Some((actual.x, actual.y));
                                });
                            }
                        }
                    }
                } else if config.size_mode == "large" {
                    clamp_window_to_monitor(&main_win, config.large_pos, Some(target_size));
                } else {
                    clamp_window_to_monitor(&main_win, config.small_pos, Some(target_size));
                }

                // Window close / move events
                let app_handle_for_events = handle.clone();
                main_win.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                            // If the main window is closed, exit completely without leaving the process behind
                            flush_config_to_disk(&app_handle_for_events);
                            app_handle_for_events.exit(0);
                        }
                        tauri::WindowEvent::Moved(pos) => {
                            if IS_RESTORING_MASCOT.load(Ordering::SeqCst) {
                                return;
                            }
                            // Never save abnormal coordinates from minimized / hidden states (e.g. Windows -32000)
                            if pos.x < -10000 || pos.y < -10000 {
                                return;
                            }
                            if let Some(win) = app_handle_for_events.get_webview_window("main") {
                                if win.is_minimized().unwrap_or(false) || !win.is_visible().unwrap_or(true) {
                                    return;
                                }
                            }
                            schedule_debounced_config_update(&app_handle_for_events, |cfg| {
                                if cfg.size_mode == "mascot" {
                                    set_last_mascot_pos((pos.x, pos.y));
                                    cfg.mascot_pos = Some((pos.x, pos.y));
                                } else if cfg.size_mode == "large" {
                                    cfg.large_pos = Some((pos.x, pos.y));
                                } else if cfg.size_mode == "small" {
                                    cfg.small_pos = Some((pos.x, pos.y));
                                }
                            });
                        }
                        _ => {}
                    }
                });
            }

            // Pre-initialize the session window in the background
            let _ = ensure_session_window(handle);

            // Polling for click-through on transparent areas in mascot mode (Issue #60)
            let app_handle_for_hit = handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(50));
                loop {
                    interval.tick().await;
                    sync_mascot_cursor_passthrough(&app_handle_for_hit);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_bridge_health,
            get_avatar_data_url,
            get_avatar_video_pack,
            get_plugin_configs,
            save_plugin_configs,
            get_live_quotes,
            save_live_quotes,
            send_live_quotes_wake,
            navigate_session,
            open_avatar_dir,
            open_settings_window,
            close_settings_window,
            get_avatar_state,
            get_chat_messages,
            inspect_latest_message,
            send_chat_message,
            get_usage_limit,
            get_gadget_config,
            save_gadget_config,
            toggle_size_mode,
            enter_mascot_mode,
            restore_from_mascot,
            reset_mascot_position,
            set_mascot_scale,
            sync_mascot_bubble_direction,
            update_mascot_hit_rects,
            toggle_minimize_restore,
            save_current_window_position,
            open_in_browser,
            open_or_show_session,
            hide_session,
            reload_session,
            inspect_session_reload_safety,
            log_session_recovery_event,
            open_mascot_devtools,
            open_session_devtools,
            get_session_status,
            drag_window,
            minimize_window,
            close_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


pub fn ensure_avatar_seeds_in_dir(base_dir: &std::path::Path) {
    let _ = fs::create_dir_all(base_dir);

    let setting_path = base_dir.join("setting.json");
    if !setting_path.exists() {
        let _ = fs::write(&setting_path, EMBEDDED_SETTING_JSON);
    }

    let plugin_dir = base_dir.join("plugin");
    let _ = fs::create_dir_all(&plugin_dir);
    let quotes_path = plugin_dir.join("quotes.json");
    if !quotes_path.exists() {
        let _ = fs::write(&quotes_path, EMBEDDED_QUOTES_JSON);
    }
}

pub fn collect_plugins_from_dirs(avatar_dirs: &[PathBuf]) -> Vec<PluginVideoItem> {
    let mut plugins: Vec<PluginVideoItem> = Vec::new();
    let mut loaded_plugin_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    for d in avatar_dirs {
        let pdir = d.join("plugin");
        if pdir.exists() && pdir.is_dir() {
            if let Ok(entries) = fs::read_dir(&pdir) {
                let mut mp4_paths: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok().map(|de| de.path()))
                    .filter(|p| {
                        p.is_file()
                            && p.extension()
                                .and_then(|ext| ext.to_str())
                                .map(|ext| ext.eq_ignore_ascii_case("mp4"))
                                .unwrap_or(false)
                    })
                    .collect();
                mp4_paths.sort();

                for path in mp4_paths {
                    let Some(file_name) = path.file_name().and_then(|n| n.to_str()).map(|s| s.to_string()) else {
                        continue;
                    };

                    if loaded_plugin_names.contains(&file_name) {
                        continue;
                    }

                    if let Ok(bytes) = fs::read(&path) {
                        if !bytes.is_empty() {
                            let data_url =
                                format!("data:video/mp4;base64,{}", BASE64_STANDARD.encode(&bytes));
                            loaded_plugin_names.insert(file_name.clone());
                            plugins.push(PluginVideoItem {
                                name: file_name,
                                data_url,
                            });
                        }
                    }
                }
            }
        }
    }
    plugins
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gadget_config_default_and_legacy_deserialization() {
        let def = GadgetConfig::default();
        assert_eq!(def.size_mode, "mascot");
        assert_eq!(def.last_normal_mode, "small");
        assert_eq!(def.message_limit, 5);
        assert_eq!(def.avatar_name, "Lucky");
        assert_eq!(def.mascot_scale, "standard");
        assert!(def.mascot_bubble_on_left);

        // Verify deserialization compatibility with an older version's config JSON (new fields missing)
        let legacy_json = r#"{
            "size_mode": "small",
            "message_limit": 10,
            "hotkey": "Ctrl+Shift+M",
            "last_limit_info": null
        }"#;
        let parsed: GadgetConfig = serde_json::from_str(legacy_json).expect("legacy json should parse");
        assert_eq!(parsed.size_mode, "small");
        assert_eq!(parsed.last_normal_mode, "small");
        assert_eq!(parsed.message_limit, 10);
        assert_eq!(parsed.avatar_name, "Lucky");
        assert_eq!(parsed.mascot_scale, "standard");
        assert!(parsed.mascot_bubble_on_left);
        assert!(parsed.mascot_pos.is_none());
    }

    #[test]
    fn test_mascot_dimensions_and_avatar_size() {
        assert_eq!(get_mascot_dimensions("small"), (496.0, 208.0, 0.8));
        assert_eq!(get_mascot_dimensions("standard"), (620.0, 260.0, 1.0));
        assert_eq!(get_mascot_dimensions("large"), (775.0, 325.0, 1.25));
        assert_eq!(get_mascot_dimensions("unknown"), (620.0, 260.0, 1.0));

        assert_eq!(get_mascot_avatar_size("small"), 93.0);
        assert_eq!(get_mascot_avatar_size("standard"), 116.0);
        assert_eq!(get_mascot_avatar_size("large"), 145.0);
    }

    #[test]
    fn test_last_mascot_pos_ignores_invalid_minimized_coordinates() {
        // Issue #30: verify that abnormal coordinates like Windows -32000 on minimize do not overwrite the saved position
        set_last_mascot_pos((450, 620));
        assert_eq!(get_last_mascot_pos(), Some((450, 620)));

        set_last_mascot_pos((-32000, -32000));
        assert_eq!(get_last_mascot_pos(), Some((450, 620)));
    }

    #[test]
    fn test_normalize_url_for_compare() {
        // Issue #46: verify query / hash / trailing-slash normalization when comparing dedicated chat URLs
        assert_eq!(
            normalize_url_for_compare("https://muse.ai/chat/abc-123/?__pwa=1#bottom"),
            "https://muse.ai/chat/abc-123"
        );
        assert_eq!(
            normalize_url_for_compare("  HTTPS://MUSE.AI/Chat/Abc-123/// "),
            "https://muse.ai/chat/abc-123"
        );
    }

    #[test]
    fn test_extract_latest_assistant_text() {
        let msgs = serde_json::json!([
            { "role": "user", "text": "Hello" },
            { "role": "assistant", "text": "First reply" },
            { "role": "user", "text": "Next question" },
            { "role": "assistant", "text": "This is the latest reply!" }
        ]);
        assert_eq!(
            extract_latest_assistant_text(&msgs),
            Some("This is the latest reply!".to_string())
        );

        let user_only = serde_json::json!([
            { "role": "user", "text": "No reply yet" }
        ]);
        assert_eq!(extract_latest_assistant_text(&user_only), None);
    }

    #[test]
    fn test_parse_bridge_payload() {
        let ok_val = serde_json::json!({
            "ok": true,
            "data": { "state": "working" }
        });
        let res = parse_bridge_payload(ok_val).expect("should succeed");
        assert_eq!(res.get("state").and_then(|v| v.as_str()), Some("working"));

        let err_val = serde_json::json!({
            "ok": false,
            "error": "UNSUPPORTED_DOM: element not found"
        });
        let err = parse_bridge_payload(err_val).expect_err("should fail");
        assert!(err.contains("UNSUPPORTED_DOM"));
    }

    #[test]
    fn test_embedded_json_validity() {
        let setting: serde_json::Value =
            serde_json::from_str(EMBEDDED_SETTING_JSON).expect("EMBEDDED_SETTING_JSON must be valid JSON");
        assert!(setting.get("idle_threshold_sec").is_some());

        let quotes: serde_json::Value =
            serde_json::from_str(EMBEDDED_QUOTES_JSON).expect("EMBEDDED_QUOTES_JSON must be valid JSON");
        assert!(quotes.get("touch_reactions").is_some());
        assert!(quotes.get("default_idle_quotes").is_some());
        assert!(quotes.get("videos").is_some());
    }

    #[test]
    fn test_seed_and_multi_dir_plugin_collection() {
        // Issue #38, #47: verify AppData-priority seed generation and merging plugin videos from multiple folders (deduplicating same names)
        let tmp_base = std::env::temp_dir().join(format!("muse_mascot_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp_base);

        let dir_appdata = tmp_base.join("appdata_avatars");
        let dir_fallback = tmp_base.join("fallback_avatars");

        ensure_avatar_seeds_in_dir(&dir_appdata);
        assert!(dir_appdata.join("setting.json").exists());
        assert!(dir_appdata.join("plugin").join("quotes.json").exists());

        let p1 = dir_appdata.join("plugin");
        let p2 = dir_fallback.join("plugin");
        fs::create_dir_all(&p1).unwrap();
        fs::create_dir_all(&p2).unwrap();

        // eating.mp4 ("custom_eating") in dir_appdata
        fs::write(p1.join("eating.mp4"), b"custom_eating").unwrap();
        // eating.mp4 ("default_eating") and sleeping.mp4 ("default_sleeping") in dir_fallback
        fs::write(p2.join("eating.mp4"), b"default_eating").unwrap();
        fs::write(p2.join("sleeping.mp4"), b"default_sleeping").unwrap();
        // Empty files should be ignored
        fs::write(p2.join("empty.mp4"), b"").unwrap();

        let collected = collect_plugins_from_dirs(&[dir_appdata.clone(), dir_fallback.clone()]);
        assert_eq!(collected.len(), 2);

        let eating = collected.iter().find(|i| i.name == "eating.mp4").expect("eating.mp4 should exist");
        let sleeping = collected.iter().find(|i| i.name == "sleeping.mp4").expect("sleeping.mp4 should exist");

        // The eating.mp4 from the priority directory (dir_appdata) should be the one adopted
        let expected_eating = format!("data:video/mp4;base64,{}", BASE64_STANDARD.encode(b"custom_eating"));
        assert_eq!(eating.data_url, expected_eating);

        // The sleeping.mp4 from the second directory (dir_fallback) should also be merged in
        let expected_sleeping = format!("data:video/mp4;base64,{}", BASE64_STANDARD.encode(b"default_sleeping"));
        assert_eq!(sleeping.data_url, expected_sleeping);

        let _ = fs::remove_dir_all(&tmp_base);
    }

    #[test]
    fn test_is_same_chat_url() {
        assert!(is_same_chat_url(
            "https://muse.ai/thread/76e0499a-0c43-4644-87db-95b14cf2bdac",
            "https://muse.ai/thread/76e0499a-0c43-4644-87db-95b14cf2bdac/?__pwa=1"
        ));
        assert!(is_same_chat_url(
            "https://muse.ai/?__pwa=1",
            "https://muse.ai/"
        ));
        assert!(!is_same_chat_url(
            "https://muse.ai/thread/76e0499a-0c43-4644-87db-95b14cf2bdac",
            "https://muse.ai/"
        ));
        assert!(!is_same_chat_url("", "https://muse.ai/"));
    }

    #[test]
    fn test_append_recovery_log_to_path_and_rotation() {
        let tmp_base = std::env::temp_dir().join(format!("muse_recovery_log_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp_base);
        let log_path = tmp_base.join("session_recovery.log");

        append_recovery_log_to_path(&log_path, "sleep_resume", "reason=sleep_resume, ready=true");
        append_recovery_log_to_path(&log_path, "reload_success", "url_matched=true");

        let body = fs::read_to_string(&log_path).expect("log file should exist");
        assert!(body.contains("[sleep_resume] reason=sleep_resume, ready=true"));
        assert!(body.contains("[reload_success] url_matched=true"));

        // Verify rotation once the file exceeds 1MB
        let oversized = vec![b'x'; 1_048_600];
        fs::write(&log_path, oversized).unwrap();
        append_recovery_log_to_path(&log_path, "post_rotate", "ok=true");

        let old_path = log_path.with_extension("log.old");
        assert!(old_path.exists());
        let rotated_body = fs::read_to_string(&log_path).unwrap();
        assert!(rotated_body.contains("[post_rotate] ok=true"));
        assert!(rotated_body.len() < 1024);

        let _ = fs::remove_dir_all(&tmp_base);
    }

    #[test]
    fn test_session_external_url_detection() {
        let muse_root = tauri::Url::parse("https://muse.ai/?__pwa=1").unwrap();
        let muse_sub = tauri::Url::parse("https://app.muse.ai/thread/123").unwrap();
        let google_auth = tauri::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
        let apple_auth = tauri::Url::parse("https://appleid.apple.com/auth/authorize").unwrap();
        // Facebook login: Muse's auth flow can route through
        // facebook.com/aymh/redirect-cycle/ (2026-11-16: without this the
        // redirect is bounced out to the external browser and the session
        // window stays on about:blank).
        let facebook_redirect =
            tauri::Url::parse("https://www.facebook.com/aymh/redirect-cycle/?t=6").unwrap();
        let facebook_login = tauri::Url::parse("https://www.facebook.com/login").unwrap();
        let external_site = tauri::Url::parse("https://github.com/mowthow-works/desktop-mascot-for-muse").unwrap();
        let google_search = tauri::Url::parse("https://www.google.com/search?q=muse").unwrap();
        let mailto_url = tauri::Url::parse("mailto:support@example.com").unwrap();
        let about_blank = tauri::Url::parse("about:blank").unwrap();

        assert!(!should_open_session_url_externally(&muse_root));
        assert!(!should_open_session_url_externally(&muse_sub));
        assert!(!should_open_session_url_externally(&google_auth));
        assert!(!should_open_session_url_externally(&apple_auth));
        assert!(!should_open_session_url_externally(&facebook_redirect));
        assert!(!should_open_session_url_externally(&facebook_login));
        assert!(should_open_session_url_externally(&external_site));
        assert!(should_open_session_url_externally(&google_search));
        assert!(should_open_session_url_externally(&mailto_url));
        assert!(!should_open_session_url_externally(&about_blank));
    }

    #[test]
    fn test_plan_autostart_reconciliation() {
        // On first migration (no config saved yet), adopt the OS's current state and save it to config
        assert_eq!(
            plan_autostart_reconciliation(None, true),
            AutostartReconcilePlan {
                desired_enabled: true,
                should_save_config: true,
                should_apply_os: false,
            }
        );
        assert_eq!(
            plan_autostart_reconciliation(None, false),
            AutostartReconcilePlan {
                desired_enabled: false,
                should_save_config: true,
                should_apply_os: false,
            }
        );

        // If config is true but the OS-side setting has been removed, restore it automatically
        assert_eq!(
            plan_autostart_reconciliation(Some(true), false),
            AutostartReconcilePlan {
                desired_enabled: true,
                should_save_config: false,
                should_apply_os: true,
            }
        );

        // If config and the OS side agree, do nothing
        assert_eq!(
            plan_autostart_reconciliation(Some(true), true),
            AutostartReconcilePlan {
                desired_enabled: true,
                should_save_config: false,
                should_apply_os: false,
            }
        );
        assert_eq!(
            plan_autostart_reconciliation(Some(false), false),
            AutostartReconcilePlan {
                desired_enabled: false,
                should_save_config: false,
                should_apply_os: false,
            }
        );

        // If config is false but the OS side is enabled, disable it to sync
        assert_eq!(
            plan_autostart_reconciliation(Some(false), true),
            AutostartReconcilePlan {
                desired_enabled: false,
                should_save_config: false,
                should_apply_os: true,
            }
        );
    }

    #[test]
    fn test_write_config_to_path_if_changed_and_usage_limit_diff() {
        let tmp_base = std::env::temp_dir().join(format!("muse_cfg_perf_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp_base);
        fs::create_dir_all(&tmp_base).unwrap();
        let cfg_path = tmp_base.join("gadget_config.json");

        let cfg1 = GadgetConfig::default();
        // First time: no file exists, so it is written out
        assert!(write_config_to_path_if_changed(&cfg_path, None, &cfg1).unwrap());
        assert!(cfg_path.exists());
        assert!(!cfg_path.with_extension("json.tmp").exists());

        // Identical content is skipped (false)
        assert!(!write_config_to_path_if_changed(&cfg_path, Some(&cfg1), &cfg1).unwrap());

        // Changed content is written out (true)
        let mut cfg2 = cfg1.clone();
        cfg2.autostart_enabled = Some(true);
        assert!(write_config_to_path_if_changed(&cfg_path, Some(&cfg1), &cfg2).unwrap());

        // A UsageLimitInfo that differs only in updated_at counts as unchanged
        let lim1 = UsageLimitInfo {
            plan_name: "Pro".to_string(),
            used_percent: Some(42),
            remaining_percent: Some(58),
            reset_text: "Weekly limit".to_string(),
            updated_at: "2026-11-12 22:00:00".to_string(),
        };
        let mut lim2 = lim1.clone();
        lim2.updated_at = "2026-11-12 22:02:00".to_string();
        assert!(!has_usage_limit_changed(Some(&lim1), &lim2));

        lim2.used_percent = Some(43);
        lim2.remaining_percent = Some(57);
        assert!(has_usage_limit_changed(Some(&lim1), &lim2));
        assert!(has_usage_limit_changed(None, &lim1));

        let _ = fs::remove_dir_all(&tmp_base);
    }

    #[test]
    fn test_is_cursor_in_hit_rects_handles_dpi_and_padding() {
        let rects = vec![HitRect {
            x: 492.0,
            y: 45.0,
            width: 120.0,
            height: 170.0,
        }];

        // Empty: do not pass through, to stay safe (true)
        assert!(is_cursor_in_hit_rects((10.0, 10.0), (100, 100), 1.0, &[]));

        // Scale 1.0: window top-left (100, 100), local coords (500, 100) are inside the avatar rect
        assert!(is_cursor_in_hit_rects((600.0, 200.0), (100, 100), 1.0, &rects));

        // Scale 1.0: the transparent speech-bubble area on the left (local x=200, y=100) is outside the rect -> pass through (false)
        assert!(!is_cursor_in_hit_rects((300.0, 200.0), (100, 100), 1.0, &rects));

        // Inside the padding (4px) boundary counts as a hit (x = 492 - 3 = 489)
        assert!(is_cursor_in_hit_rects((589.0, 200.0), (100, 100), 1.0, &rects));

        // High DPI (1.5x): physical (100 + 500*1.5, 100 + 100*1.5) = (850, 250) -> local (500, 100)
        assert!(is_cursor_in_hit_rects((850.0, 250.0), (100, 100), 1.5, &rects));
        // High DPI (1.5x): physical (100 + 200*1.5, 100 + 100*1.5) = (400, 250) -> local (200, 100) passes through
        assert!(!is_cursor_in_hit_rects((400.0, 250.0), (100, 100), 1.5, &rects));
    }
}
