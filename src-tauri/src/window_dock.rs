use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::sync::atomic::AtomicU64;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::sync::{Arc, Mutex};
use std::sync::RwLock;
#[cfg(any(target_os = "android", target_os = "ios"))]
use std::sync::Arc;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::models::{DeviceSettings, DockMode, DockState, TabWidthMode};
pub use crate::platform_win::WorkAreaRect;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::storage::StorageManager;

pub const DEFAULT_PANEL_WIDTH: u32 = 480;
pub const DEFAULT_PANEL_HEIGHT: u32 = 680;
pub const DEFAULT_TAB_WIDTH: u32 = 64;
pub const TOP_TAB_HEIGHT: u32 = 40;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const MIN_PANEL_WIDTH: f64 = 360.0;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const MIN_PANEL_HEIGHT: f64 = 460.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PhysicalRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn is_full_hide_mode(mode: DockMode) -> bool {
    matches!(
        mode,
        DockMode::RightHide | DockMode::LeftHide | DockMode::TopHide
    )
}

pub fn is_top_mode(mode: DockMode) -> bool {
    matches!(mode, DockMode::TopTabs | DockMode::TopHide)
}

fn effective_tab_width(device: &DeviceSettings) -> u32 {
    device.uniform_tab_width.clamp(48, 120)
}

/// Compute expanded physical window rectangle for any of the 6 DeskTag edge-docking modes,
/// clamped cleanly inside `work` (the active monitor's WorkArea).
pub fn compute_expanded_rect(device: &DeviceSettings, work: &WorkAreaRect) -> PhysicalRect {
    let scale = work.scale_factor.max(0.5);
    let tab_w = effective_tab_width(device);
    let panel_w = device.panel_width.clamp(340, 1200);
    let panel_h = device.panel_height.clamp(420, 1400);

    let (logical_w, logical_h) = if is_top_mode(device.dock_mode) {
        (panel_w, panel_h + TOP_TAB_HEIGHT)
    } else {
        (panel_w + tab_w, panel_h)
    };

    let max_w = work.width().max(200);
    let max_h = work.height().max(200);
    let phys_w = ((logical_w as f64 * scale).round() as i32).clamp(200, max_w);
    let phys_h = ((logical_h as f64 * scale).round() as i32).clamp(200, max_h);

    let default_x = work.left + (work.width() - phys_w) / 2;
    let default_y = work.top + (work.height() - phys_h) / 2;

    let (x, y) = match device.dock_mode {
        DockMode::RightTabs | DockMode::RightHide => {
            let x = work.right - phys_w;
            let y = device
                .panel_y
                .unwrap_or(default_y)
                .clamp(work.top, (work.bottom - phys_h).max(work.top));
            (x, y)
        }
        DockMode::LeftTabs | DockMode::LeftHide => {
            let x = work.left;
            let y = device
                .panel_y
                .unwrap_or(default_y)
                .clamp(work.top, (work.bottom - phys_h).max(work.top));
            (x, y)
        }
        DockMode::TopTabs | DockMode::TopHide => {
            let x = device
                .panel_x
                .unwrap_or(default_x)
                .clamp(work.left, (work.right - phys_w).max(work.left));
            let y = work.top;
            (x, y)
        }
    };

    PhysicalRect {
        x,
        y,
        width: phys_w as u32,
        height: phys_h as u32,
    }
}

/// Compute collapsed protruding-tab-strip physical rectangle for `*_tabs` docking modes,
/// flush against the docked edge so it NEVER bleeds onto adjacent monitors.
pub fn compute_collapsed_tabs_rect(
    device: &DeviceSettings,
    work: &WorkAreaRect,
    anchor_x: Option<i32>,
    anchor_y: Option<i32>,
) -> PhysicalRect {
    let scale = work.scale_factor.max(0.5);
    let expanded = compute_expanded_rect(device, work);
    let tab_w_phys = ((effective_tab_width(device) as f64 * scale).round() as i32)
        .clamp(36, work.width().max(36));
    let top_h_phys =
        ((TOP_TAB_HEIGHT as f64 * scale).round() as i32).clamp(32, work.height().max(32));

    match device.dock_mode {
        DockMode::RightTabs | DockMode::RightHide => {
            let h = expanded.height as i32;
            let y = anchor_y
                .unwrap_or(expanded.y)
                .clamp(work.top, (work.bottom - h).max(work.top));
            PhysicalRect {
                x: work.right - tab_w_phys,
                y,
                width: tab_w_phys as u32,
                height: h as u32,
            }
        }
        DockMode::LeftTabs | DockMode::LeftHide => {
            let h = expanded.height as i32;
            let y = anchor_y
                .unwrap_or(expanded.y)
                .clamp(work.top, (work.bottom - h).max(work.top));
            PhysicalRect {
                x: work.left,
                y,
                width: tab_w_phys as u32,
                height: h as u32,
            }
        }
        DockMode::TopTabs | DockMode::TopHide => {
            let w = expanded.width as i32;
            let x = anchor_x
                .unwrap_or(expanded.x)
                .clamp(work.left, (work.right - w).max(work.left));
            PhysicalRect {
                x,
                y: work.top,
                width: w as u32,
                height: top_h_phys as u32,
            }
        }
    }
}

/// Check if physical cursor coordinates `(cx, cy)` are within `threshold_px` of the
/// docked screen edge on `work`.
pub fn cursor_at_dock_edge(
    mode: DockMode,
    work: &WorkAreaRect,
    cx: i32,
    cy: i32,
    threshold_px: i32,
) -> bool {
    let t = threshold_px.max(1);
    match mode {
        DockMode::RightTabs | DockMode::RightHide => {
            cx >= work.right - t && cx <= work.right + t && cy >= work.top && cy <= work.bottom
        }
        DockMode::LeftTabs | DockMode::LeftHide => {
            cx >= work.left - t && cx <= work.left + t && cy >= work.top && cy <= work.bottom
        }
        DockMode::TopTabs | DockMode::TopHide => {
            cy >= work.top - t && cy <= work.top + t && cx >= work.left && cx <= work.right
        }
    }
}

pub struct DockController {
    state: RwLock<DockState>,
    device_cache: RwLock<DeviceSettings>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    last_work_area: RwLock<Option<WorkAreaRect>>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    suppress_persist_until: Mutex<Instant>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    last_expand_at: Mutex<Instant>,
    auto_hide_paused: AtomicBool,
    hidden_to_tray: AtomicBool,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    geometry_gen: AtomicU64,
}

impl DockController {
    pub fn new(device: &DeviceSettings) -> Self {
        Self {
            state: RwLock::new(DockState::from_device(device)),
            device_cache: RwLock::new(device.clone()),
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            last_work_area: RwLock::new(None),
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            suppress_persist_until: Mutex::new(Instant::now()),
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            last_expand_at: Mutex::new(Instant::now()),
            auto_hide_paused: AtomicBool::new(false),
            hidden_to_tray: AtomicBool::new(false),
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            geometry_gen: AtomicU64::new(0),
        }
    }

    pub fn get_state(&self) -> DockState {
        self.state
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|_| DockState::from_device(&DeviceSettings::default()))
    }

    fn current_device(&self) -> DeviceSettings {
        self.device_cache
            .read()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    fn update_device_cache(&self, device: &DeviceSettings) {
        if let Ok(mut guard) = self.device_cache.write() {
            *guard = device.clone();
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn suppress_persist_briefly(&self) {
        if let Ok(mut guard) = self.suppress_persist_until.lock() {
            *guard = Instant::now() + Duration::from_millis(350);
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn is_persist_suppressed(&self) -> bool {
        self.suppress_persist_until
            .lock()
            .map(|t| Instant::now() < *t)
            .unwrap_or(false)
    }

    fn emit_dock_state(&self, app: &AppHandle, state: &DockState) {
        let _ = app.emit("desktag://dock-state", state);
    }

    pub fn set_auto_hide_paused(&self, paused: bool) {
        self.auto_hide_paused.store(paused, Ordering::SeqCst);
    }

    /// Apply initial docked position, size, and always-on-top state on desktop startup.
    pub fn apply_initial_layout(&self, app: &AppHandle, device: &DeviceSettings) {
        self.update_device_cache(device);
        let mut next = self.get_state();
        next.mode = device.dock_mode;
        next.auto_hide = device.auto_hide;
        next.always_on_top = device.always_on_top;
        next.collapsed = false;
        if let Ok(mut guard) = self.state.write() {
            *guard = next.clone();
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_always_on_top(device.always_on_top);
                #[cfg(target_os = "macos")]
                crate::platform_mac::apply_window_spaces_behavior(&win, device.always_on_top);

                if let Some(work) = self.resolve_work_area_for_device(&win, device) {
                    self.store_work_area(work.clone());
                    let rect = compute_expanded_rect(device, &work);
                    self.apply_window_rect(&win, rect, true);
                }
            }
        }

        self.emit_dock_state(app, &next);
    }

    pub fn sync_from_device(&self, app: &AppHandle, device: &DeviceSettings) -> DockState {
        let prev_device = self.current_device();
        self.update_device_cache(device);

        let mut next = self.get_state();
        let mode_changed = next.mode != device.dock_mode;
        let size_changed = prev_device.panel_width != device.panel_width
            || prev_device.panel_height != device.panel_height
            || prev_device.uniform_tab_width != device.uniform_tab_width;
        next.mode = device.dock_mode;
        next.auto_hide = device.auto_hide;
        next.always_on_top = device.always_on_top;
        if let Ok(mut guard) = self.state.write() {
            *guard = next.clone();
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_always_on_top(device.always_on_top);
                #[cfg(target_os = "macos")]
                crate::platform_mac::apply_window_spaces_behavior(&win, device.always_on_top);

                if mode_changed || size_changed {
                    self.reapply_geometry_for_state(&win, &next, device);
                }
            }
        }
        #[cfg(any(target_os = "android", target_os = "ios"))]
        let _ = (mode_changed, size_changed);

        self.emit_dock_state(app, &next);
        next
    }

    pub fn set_mode(&self, app: &AppHandle, mode: DockMode) -> DockState {
        let mut device = self.current_device();
        device.dock_mode = mode;
        self.update_device_cache(&device);

        let mut next = self.get_state();
        next.mode = mode;
        // Expanding when switching docking mode gives immediate visual feedback at the new edge.
        next.collapsed = false;
        self.hidden_to_tray.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = self.state.write() {
            *guard = next.clone();
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    crate::platform_win::set_window_no_activate(&win, false);
                    crate::platform_win::set_webview_memory_low(&win, false);
                }
                self.reapply_geometry_for_state(&win, &next, &device);
                let _ = win.show();
            }
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        if let Ok(mut t) = self.last_expand_at.lock() {
            *t = Instant::now();
        }
        self.emit_dock_state(app, &next);
        next
    }

    pub fn set_auto_hide(&self, app: &AppHandle, enabled: bool) -> DockState {
        let mut device = self.current_device();
        device.auto_hide = enabled;
        self.update_device_cache(&device);

        let mut next = self.get_state();
        next.auto_hide = enabled;
        if let Ok(mut guard) = self.state.write() {
            *guard = next.clone();
        }
        self.emit_dock_state(app, &next);
        next
    }

    pub fn set_always_on_top(&self, app: &AppHandle, enabled: bool) -> DockState {
        let mut device = self.current_device();
        device.always_on_top = enabled;
        self.update_device_cache(&device);

        let mut next = self.get_state();
        next.always_on_top = enabled;
        if let Ok(mut guard) = self.state.write() {
            *guard = next.clone();
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_always_on_top(enabled);
                #[cfg(target_os = "macos")]
                crate::platform_mac::apply_window_spaces_behavior(&win, enabled);
            }
        }
        self.emit_dock_state(app, &next);
        next
    }

    pub fn expand(&self, app: &AppHandle) -> DockState {
        let device = self.current_device();
        let mut next = self.get_state();
        next.collapsed = false;
        self.hidden_to_tray.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = self.state.write() {
            *guard = next.clone();
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        if let Ok(mut t) = self.last_expand_at.lock() {
            *t = Instant::now();
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    crate::platform_win::set_window_no_activate(&win, false);
                    crate::platform_win::set_webview_memory_low(&win, false);
                }

                if let Some(work) = self.resolve_work_area_for_window(&win) {
                    self.store_work_area(work.clone());
                    let rect = compute_expanded_rect(&device, &work);
                    self.apply_window_rect(&win, rect, true);
                }
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }
        #[cfg(any(target_os = "android", target_os = "ios"))]
        let _ = device;

        self.emit_dock_state(app, &next);
        next
    }

    pub fn collapse(&self, app: &AppHandle) -> DockState {
        let device = self.current_device();
        let mut next = self.get_state();
        next.collapsed = true;
        if let Ok(mut guard) = self.state.write() {
            *guard = next.clone();
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                if let Some(work) = self.resolve_work_area_for_window(&win) {
                    self.store_work_area(work.clone());
                    if is_full_hide_mode(next.mode) {
                        let _ = win.hide();
                    } else {
                        let pos = win.outer_position().ok();
                        let rect = compute_collapsed_tabs_rect(
                            &device,
                            &work,
                            pos.map(|p| p.x),
                            pos.map(|p| p.y),
                        );
                        #[cfg(target_os = "windows")]
                        crate::platform_win::set_window_no_activate(&win, true);
                        self.apply_window_rect(&win, rect, false);
                    }
                } else if is_full_hide_mode(next.mode) {
                    let _ = win.hide();
                }

                #[cfg(target_os = "windows")]
                crate::platform_win::set_webview_memory_low(&win, true);
            }
        }
        #[cfg(any(target_os = "android", target_os = "ios"))]
        let _ = device;

        self.emit_dock_state(app, &next);
        next
    }

    /// Toggle between expanded and collapsed (or reveal if hidden to tray).
    pub fn toggle_expand(&self, app: &AppHandle) -> DockState {
        let current = self.get_state();
        let hidden = self.hidden_to_tray.load(Ordering::SeqCst);
        if hidden || current.collapsed {
            self.expand(app)
        } else {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                use tauri::Manager;
                let visible = app
                    .get_webview_window("main")
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);
                if !visible {
                    return self.expand(app);
                }
            }
            self.collapse(app)
        }
    }

    pub fn hide_to_tray(&self, app: &AppHandle) -> Result<(), String> {
        self.hidden_to_tray.store(true, Ordering::SeqCst);
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                win.hide().map_err(|e| format!("failed to hide window: {e}"))?;
                #[cfg(target_os = "windows")]
                crate::platform_win::set_webview_memory_low(&win, true);
            }
        }
        #[cfg(any(target_os = "android", target_os = "ios"))]
        let _ = app;
        Ok(())
    }

    pub fn reset_layout(&self, app: &AppHandle, current: &DeviceSettings) -> DeviceSettings {
        let mut reset = current.clone();
        reset.panel_width = DEFAULT_PANEL_WIDTH;
        reset.panel_height = DEFAULT_PANEL_HEIGHT;
        reset.panel_x = None;
        reset.panel_y = None;
        reset.uniform_tab_width = DEFAULT_TAB_WIDTH;
        reset.tab_width_mode = TabWidthMode::Uniform;

        self.update_device_cache(&reset);
        self.hidden_to_tray.store(false, Ordering::SeqCst);

        let mut next = self.get_state();
        next.mode = reset.dock_mode;
        next.collapsed = false;
        next.auto_hide = reset.auto_hide;
        next.always_on_top = reset.always_on_top;
        if let Ok(mut guard) = self.state.write() {
            *guard = next.clone();
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        if let Ok(mut t) = self.last_expand_at.lock() {
            *t = Instant::now();
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    crate::platform_win::set_window_no_activate(&win, false);
                    crate::platform_win::set_webview_memory_low(&win, false);
                }
                if let Some(work) = self.resolve_work_area_for_window(&win) {
                    self.store_work_area(work.clone());
                    let rect = compute_expanded_rect(&reset, &work);
                    self.apply_window_rect(&win, rect, true);
                }
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }

        self.emit_dock_state(app, &next);
        reset
    }

    pub fn open_calendar_window(&self, app: &AppHandle) -> Result<(), String> {
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
            if let Some(existing) = app.get_webview_window("calendar") {
                let _ = existing.show();
                let _ = existing.unminimize();
                let _ = existing.set_focus();
                return Ok(());
            }
            WebviewWindowBuilder::new(
                app,
                "calendar",
                WebviewUrl::App("index.html?window=calendar".into()),
            )
            .title("DeskTag — 日历视图")
            .inner_size(960.0, 660.0)
            .min_inner_size(680.0, 520.0)
            .center()
            .decorations(false)
            .transparent(true)
            .build()
            .map_err(|e| format!("failed to open calendar window: {e}"))?;
        }
        #[cfg(any(target_os = "android", target_os = "ios"))]
        let _ = app;
        Ok(())
    }

    pub fn open_note_window(&self, app: &AppHandle, note_id: &str) -> Result<(), String> {
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
            let safe_label: String = note_id
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .take(40)
                .collect();
            let label = format!("note-{safe_label}");
            if let Some(existing) = app.get_webview_window(&label) {
                let _ = existing.show();
                let _ = existing.unminimize();
                let _ = existing.set_focus();
                return Ok(());
            }
            let url = format!("index.html?window=note&noteId={safe_label}");
            WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
                .title("DeskTag — 便签")
                .inner_size(520.0, 660.0)
                .min_inner_size(340.0, 400.0)
                .center()
                .decorations(false)
                .transparent(true)
                .build()
                .map_err(|e| format!("failed to open note window: {e}"))?;
        }
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            let _ = (app, note_id);
        }
        Ok(())
    }

    /// Persist user move/resize events debounced by 500ms (Magpie `keepAt` pattern),
    /// ignoring minimized (`-32000`), hidden, collapsed, or programmatic changes.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn handle_window_event(
        self: &Arc<Self>,
        app: &AppHandle,
        storage: &Arc<StorageManager>,
        event: &tauri::WindowEvent,
    ) {
        if !matches!(
            event,
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
        ) {
            return;
        }
        if self.is_persist_suppressed() || self.get_state().collapsed {
            return;
        }

        let gen = self.geometry_gen.fetch_add(1, Ordering::SeqCst) + 1;
        let dock = Arc::clone(self);
        let app_handle = app.clone();
        let storage_ref = Arc::clone(storage);

        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if dock.geometry_gen.load(Ordering::SeqCst) != gen {
                return;
            }
            if dock.is_persist_suppressed() || dock.get_state().collapsed {
                return;
            }
            dock.persist_current_geometry(&app_handle, &storage_ref);
        });
    }

    /// Spawn the lightweight 150ms desktop watcher handling:
    /// 1) Auto-hide collapse when cursor leaves expanded panel (+16px margin) for ~500ms
    /// 2) Full-hide (`*_hide`) screen-edge hover expand when cursor dwells within 3px for ~150ms.
    pub fn spawn_auto_hide_watcher(self: &Arc<Self>, app: AppHandle) {
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let dock = Arc::clone(self);
            tauri::async_runtime::spawn(async move {
                use tauri::Manager;
                let mut ticker = tokio::time::interval(Duration::from_millis(150));
                let mut outside_since: Option<Instant> = None;
                let mut edge_dwell_since: Option<Instant> = None;

                loop {
                    ticker.tick().await;
                    let st = dock.get_state();
                    let paused = dock.auto_hide_paused.load(Ordering::SeqCst);
                    let hidden_tray = dock.hidden_to_tray.load(Ordering::SeqCst);

                    if hidden_tray {
                        outside_since = None;
                        edge_dwell_since = None;
                        continue;
                    }

                    // Case 1: Full-hide collapsed -> detect cursor dwelling within 3px of docked edge.
                    if st.collapsed && is_full_hide_mode(st.mode) {
                        outside_since = None;
                        let Some((cx, cy)) = get_global_cursor_pos(&app) else {
                            edge_dwell_since = None;
                            continue;
                        };
                        let work = dock.get_cached_work_area().or_else(|| {
                            app.get_webview_window("main")
                                .and_then(|w| dock.resolve_work_area_for_window(&w))
                        });
                        if let Some(w) = work {
                            if cursor_at_dock_edge(st.mode, &w, cx, cy, 3) {
                                let started = edge_dwell_since.get_or_insert_with(Instant::now);
                                if started.elapsed() >= Duration::from_millis(140) {
                                    edge_dwell_since = None;
                                    dock.expand(&app);
                                }
                            } else {
                                edge_dwell_since = None;
                            }
                        }
                        continue;
                    }

                    edge_dwell_since = None;

                    // Case 2: Expanded with auto-hide enabled -> collapse if cursor stays outside for ~500ms.
                    if !st.collapsed && st.auto_hide && !paused {
                        let recently_expanded = dock
                            .last_expand_at
                            .lock()
                            .map(|t| t.elapsed() < Duration::from_millis(800))
                            .unwrap_or(false);
                        if recently_expanded {
                            outside_since = None;
                            continue;
                        }

                        let Some(win) = app.get_webview_window("main") else {
                            continue;
                        };
                        if !win.is_visible().unwrap_or(false) {
                            outside_since = None;
                            continue;
                        }
                        let Some((cx, cy)) = get_global_cursor_pos(&app) else {
                            continue;
                        };
                        let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else {
                            continue;
                        };
                        let scale = win.scale_factor().unwrap_or(1.0).max(0.5);
                        let margin = (16.0 * scale).round() as i32;
                        let inside = cx >= pos.x - margin
                            && cx <= pos.x + size.width as i32 + margin
                            && cy >= pos.y - margin
                            && cy <= pos.y + size.height as i32 + margin;

                        if inside {
                            outside_since = None;
                        } else {
                            let started = outside_since.get_or_insert_with(Instant::now);
                            if started.elapsed() >= Duration::from_millis(500) {
                                outside_since = None;
                                dock.collapse(&app);
                            }
                        }
                    } else {
                        outside_since = None;
                    }
                }
            });
        }
        #[cfg(any(target_os = "android", target_os = "ios"))]
        let _ = app;
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn persist_current_geometry(&self, app: &AppHandle, storage: &Arc<StorageManager>) {
        use tauri::Manager;
        let Some(win) = app.get_webview_window("main") else {
            return;
        };
        if !win.is_visible().unwrap_or(false) || win.is_minimized().unwrap_or(false) {
            return;
        }
        let (Ok(pos), Ok(size)) = (win.outer_position(), win.inner_size()) else {
            return;
        };
        // Ignore Windows minimized sentinel (-32000, -32000) or collapsed sliver dimensions.
        if pos.x <= -16_000 || pos.y <= -16_000 || size.width < 200 || size.height < 200 {
            return;
        }

        let scale = win.scale_factor().unwrap_or(1.0).max(0.5);
        let logical_w = (size.width as f64 / scale).round() as u32;
        let logical_h = (size.height as f64 / scale).round() as u32;

        let mut device = storage.load_device_settings();
        let tab_w = effective_tab_width(&device);
        if is_top_mode(device.dock_mode) {
            device.panel_width = logical_w.clamp(340, 1200);
            device.panel_height = logical_h.saturating_sub(TOP_TAB_HEIGHT).clamp(420, 1400);
        } else {
            device.panel_width = logical_w.saturating_sub(tab_w).clamp(340, 1200);
            device.panel_height = logical_h.clamp(420, 1400);
        }
        device.panel_x = Some(pos.x);
        device.panel_y = Some(pos.y);

        if let Some(work) = self.resolve_work_area_for_window(&win) {
            device.monitor_name = work.monitor_name.clone();
            self.store_work_area(work);
        }

        self.update_device_cache(&device);
        let _ = storage.save_device_settings(&device);
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn reapply_geometry_for_state(
        &self,
        win: &tauri::WebviewWindow,
        st: &DockState,
        device: &DeviceSettings,
    ) {
        let Some(work) = self.resolve_work_area_for_window(win) else {
            return;
        };
        self.store_work_area(work.clone());
        if st.collapsed {
            if is_full_hide_mode(st.mode) {
                let _ = win.hide();
            } else {
                let pos = win.outer_position().ok();
                let rect = compute_collapsed_tabs_rect(
                    device,
                    &work,
                    pos.map(|p| p.x),
                    pos.map(|p| p.y),
                );
                self.apply_window_rect(win, rect, false);
            }
        } else {
            let rect = compute_expanded_rect(device, &work);
            self.apply_window_rect(win, rect, true);
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn apply_window_rect(
        &self,
        win: &tauri::WebviewWindow,
        rect: PhysicalRect,
        expanded: bool,
    ) {
        use tauri::{LogicalSize, PhysicalPosition, PhysicalSize, Position, Size};
        self.suppress_persist_briefly();
        if expanded {
            let _ = win.set_min_size(Some(Size::Logical(LogicalSize::new(
                MIN_PANEL_WIDTH,
                MIN_PANEL_HEIGHT,
            ))));
        } else {
            // Remove min-size constraint so collapsed tab strip can shrink to ~64px or ~40px.
            let _ = win.set_min_size(None::<Size>);
        }
        let _ = win.set_size(Size::Physical(PhysicalSize::new(rect.width, rect.height)));
        let _ = win.set_position(Position::Physical(PhysicalPosition::new(rect.x, rect.y)));
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn store_work_area(&self, work: WorkAreaRect) {
        if let Ok(mut guard) = self.last_work_area.write() {
            *guard = Some(work);
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn get_cached_work_area(&self) -> Option<WorkAreaRect> {
        self.last_work_area.read().ok().and_then(|g| g.clone())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn resolve_work_area_for_device(
        &self,
        win: &tauri::WebviewWindow,
        device: &DeviceSettings,
    ) -> Option<WorkAreaRect> {
        // Prefer saved monitor name if still attached.
        if let Some(ref target_name) = device.monitor_name {
            if let Ok(monitors) = win.available_monitors() {
                if let Some(m) = monitors
                    .into_iter()
                    .find(|m| m.name().map(|n| n == target_name).unwrap_or(false))
                {
                    let area = m.work_area();
                    return Some(WorkAreaRect {
                        left: area.position.x,
                        top: area.position.y,
                        right: area.position.x + area.size.width as i32,
                        bottom: area.position.y + area.size.height as i32,
                        scale_factor: m.scale_factor().max(0.5),
                        monitor_name: m.name().cloned(),
                    });
                }
            }
        }
        // Else if saved coordinates exist on Windows, probe monitor at that point.
        #[cfg(target_os = "windows")]
        if let (Some(x), Some(y)) = (device.panel_x, device.panel_y) {
            if x > -16_000 && y > -16_000 {
                let scale = win.scale_factor().unwrap_or(1.0);
                if let Some(w) = crate::platform_win::get_monitor_work_area_at_point(x, y, scale) {
                    return Some(w);
                }
            }
        }
        self.resolve_work_area_for_window(win)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn resolve_work_area_for_window(&self, win: &tauri::WebviewWindow) -> Option<WorkAreaRect> {
        #[cfg(target_os = "windows")]
        if let Some(w) = crate::platform_win::get_monitor_work_area(win) {
            return Some(w);
        }

        #[cfg(target_os = "macos")]
        if let Some(w) = crate::platform_mac::get_monitor_work_area(win) {
            return Some(w);
        }

        let monitor = win
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| win.primary_monitor().ok().flatten())?;
        let area = monitor.work_area();
        Some(WorkAreaRect {
            left: area.position.x,
            top: area.position.y,
            right: area.position.x + area.size.width as i32,
            bottom: area.position.y + area.size.height as i32,
            scale_factor: monitor.scale_factor().max(0.5),
            monitor_name: monitor.name().cloned(),
        })
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn get_global_cursor_pos(app: &AppHandle) -> Option<(i32, i32)> {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        crate::platform_win::get_cursor_pos()
    }
    #[cfg(not(target_os = "windows"))]
    {
        app.cursor_position()
            .ok()
            .map(|p| (p.x.round() as i32, p.y.round() as i32))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_work_area(scale: f64) -> WorkAreaRect {
        WorkAreaRect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040, // 40px taskbar excluded
            scale_factor: scale,
            monitor_name: Some("DISPLAY1".into()),
        }
    }

    #[test]
    fn test_all_six_dock_modes_geometry_clamped() {
        let work = sample_work_area(1.0);
        let mut dev = DeviceSettings::default();
        dev.panel_width = 480;
        dev.panel_height = 680;
        dev.uniform_tab_width = 64;

        // 1. RightTabs
        dev.dock_mode = DockMode::RightTabs;
        let exp = compute_expanded_rect(&dev, &work);
        assert_eq!(exp.width, 544);
        assert_eq!(exp.height, 680);
        assert_eq!(exp.x + exp.width as i32, 1920);
        let col = compute_collapsed_tabs_rect(&dev, &work, Some(exp.x), Some(exp.y));
        assert_eq!(col.width, 64);
        assert_eq!(col.height, 680);
        assert_eq!(col.x + col.width as i32, 1920);
        assert_eq!(col.y, exp.y);

        // 2. RightHide
        dev.dock_mode = DockMode::RightHide;
        assert!(is_full_hide_mode(dev.dock_mode));
        assert!(cursor_at_dock_edge(dev.dock_mode, &work, 1919, 500, 3));
        assert!(!cursor_at_dock_edge(dev.dock_mode, &work, 1900, 500, 3));

        // 3. LeftTabs
        dev.dock_mode = DockMode::LeftTabs;
        let exp_l = compute_expanded_rect(&dev, &work);
        assert_eq!(exp_l.x, 0);
        assert_eq!(exp_l.width, 544);
        let col_l = compute_collapsed_tabs_rect(&dev, &work, Some(0), Some(100));
        assert_eq!(col_l.x, 0);
        assert_eq!(col_l.width, 64);
        assert_eq!(col_l.y, 100);

        // 4. LeftHide
        dev.dock_mode = DockMode::LeftHide;
        assert!(cursor_at_dock_edge(dev.dock_mode, &work, 2, 300, 3));
        assert!(!cursor_at_dock_edge(dev.dock_mode, &work, 20, 300, 3));

        // 5. TopTabs
        dev.dock_mode = DockMode::TopTabs;
        let exp_t = compute_expanded_rect(&dev, &work);
        assert_eq!(exp_t.y, 0);
        assert_eq!(exp_t.width, 480);
        assert_eq!(exp_t.height, 680 + TOP_TAB_HEIGHT);
        let col_t = compute_collapsed_tabs_rect(&dev, &work, Some(500), Some(0));
        assert_eq!(col_t.y, 0);
        assert_eq!(col_t.x, 500);
        assert_eq!(col_t.height, TOP_TAB_HEIGHT);

        // 6. TopHide
        dev.dock_mode = DockMode::TopHide;
        assert!(cursor_at_dock_edge(dev.dock_mode, &work, 800, 1, 3));
        assert!(!cursor_at_dock_edge(dev.dock_mode, &work, 800, 20, 3));
    }

    #[test]
    fn test_high_dpi_and_small_monitor_clamping() {
        // Small secondary monitor at 1.5x DPI
        let work = WorkAreaRect {
            left: 1920,
            top: 0,
            right: 2920, // 1000px wide
            bottom: 700, // 700px tall
            scale_factor: 1.5,
            monitor_name: Some("DISPLAY2".into()),
        };
        let mut dev = DeviceSettings::default();
        dev.dock_mode = DockMode::RightTabs;
        dev.panel_y = Some(9999);
        let exp = compute_expanded_rect(&dev, &work);
        assert!(exp.x >= work.left);
        assert_eq!(exp.x + exp.width as i32, work.right);
        assert!(exp.y >= work.top);
        assert!(exp.y + exp.height as i32 <= work.bottom);
    }
}
