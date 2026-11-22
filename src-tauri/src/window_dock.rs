use std::sync::RwLock;

use tauri::AppHandle;

use crate::models::{DeviceSettings, DockMode, DockState};

pub struct DockController {
    state: RwLock<DockState>,
}

impl DockController {
    pub fn new(device: &DeviceSettings) -> Self {
        Self {
            state: RwLock::new(DockState::from_device(device)),
        }
    }

    pub fn get_state(&self) -> DockState {
        self.state
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|_| DockState::from_device(&DeviceSettings::default()))
    }

    pub fn sync_from_device(&self, _app: &AppHandle, device: &DeviceSettings) -> DockState {
        let mut next = self.get_state();
        next.mode = device.dock_mode;
        next.auto_hide = device.auto_hide;
        next.always_on_top = device.always_on_top;
        if let Ok(mut guard) = self.state.write() {
            *guard = next.clone();
        }
        next
    }

    pub fn set_mode(&self, _app: &AppHandle, mode: DockMode) -> DockState {
        let mut next = self.get_state();
        next.mode = mode;
        if let Ok(mut guard) = self.state.write() {
            *guard = next.clone();
        }
        next
    }

    pub fn set_auto_hide(&self, _app: &AppHandle, enabled: bool) -> DockState {
        let mut next = self.get_state();
        next.auto_hide = enabled;
        if let Ok(mut guard) = self.state.write() {
            *guard = next.clone();
        }
        next
    }

    pub fn set_always_on_top(&self, app: &AppHandle, enabled: bool) -> DockState {
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
            }
        }
        #[cfg(any(target_os = "android", target_os = "ios"))]
        let _ = app;
        next
    }

    pub fn expand(&self, app: &AppHandle) -> DockState {
        let mut next = self.get_state();
        next.collapsed = false;
        if let Ok(mut guard) = self.state.write() {
            *guard = next.clone();
        }
        #[cfg(target_os = "windows")]
        crate::platform_win::set_memory_target_low(app, false);
        #[cfg(not(target_os = "windows"))]
        let _ = app;
        next
    }

    pub fn collapse(&self, app: &AppHandle) -> DockState {
        let mut next = self.get_state();
        next.collapsed = true;
        if let Ok(mut guard) = self.state.write() {
            *guard = next.clone();
        }
        #[cfg(target_os = "windows")]
        crate::platform_win::set_memory_target_low(app, true);
        #[cfg(not(target_os = "windows"))]
        let _ = app;
        next
    }

    pub fn hide_to_tray(&self, app: &AppHandle) -> Result<(), String> {
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                win.hide().map_err(|e| format!("failed to hide window: {e}"))?;
            }
        }
        #[cfg(target_os = "windows")]
        crate::platform_win::set_memory_target_low(app, true);
        #[cfg(any(target_os = "android", target_os = "ios"))]
        let _ = app;
        Ok(())
    }

    pub fn reset_layout(&self, _app: &AppHandle, current: &DeviceSettings) -> DeviceSettings {
        let mut reset = current.clone();
        reset.panel_width = 480;
        reset.panel_height = 680;
        reset.panel_x = None;
        reset.panel_y = None;
        reset.uniform_tab_width = 64;
        reset.tab_width_mode = crate::models::TabWidthMode::Uniform;
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
                .inner_size(520.0, 640.0)
                .min_inner_size(340.0, 400.0)
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
}
