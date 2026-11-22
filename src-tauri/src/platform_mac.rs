//! macOS-specific AppKit `ActivationPolicy::Accessory`, Spaces collection behavior,
//! and `NSScreen.visibleFrame` work-area helpers using Tauri v2 safe APIs.

#[cfg(target_os = "macos")]
mod imp {
    use tauri::{ActivationPolicy, AppHandle, Manager, WebviewWindow};

    use crate::platform_win::WorkAreaRect;

    /// Configure macOS app as a menu-bar accessory so DeskTag stays out of the Dock
    /// while remaining accessible from the menu bar, edge tabs, and global shortcuts.
    pub fn configure_accessory_policy(app: &AppHandle) {
        let _ = app.set_activation_policy(ActivationPolicy::Accessory);
    }

    /// Apply macOS Spaces behavior: when pinned (`always_on_top`), allow the edge panel
    /// to follow the user across all Desktop Spaces (`CanJoinAllSpaces`).
    pub fn apply_window_spaces_behavior(window: &WebviewWindow, join_all_spaces: bool) {
        let _ = window.set_visible_on_all_workspaces(join_all_spaces);
    }

    /// Query the visible work area (`NSScreen.visibleFrame`, excluding Menu Bar, Notch,
    /// and Dock) of the monitor currently hosting `window`.
    pub fn get_monitor_work_area(window: &WebviewWindow) -> Option<WorkAreaRect> {
        let monitor = window
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| window.primary_monitor().ok().flatten())?;
        let area = monitor.work_area();
        let left = area.position.x;
        let top = area.position.y;
        let right = left + area.size.width as i32;
        let bottom = top + area.size.height as i32;
        Some(WorkAreaRect {
            left,
            top,
            right,
            bottom,
            scale_factor: monitor.scale_factor().max(0.5),
            monitor_name: monitor.name().cloned(),
        })
    }

    /// Initialize macOS accessory policy and main window Spaces behavior on startup.
    pub fn init_window(app: &AppHandle) {
        configure_accessory_policy(app);
        if let Some(win) = app.get_webview_window("main") {
            apply_window_spaces_behavior(&win, false);
        }
    }
}

#[cfg(target_os = "macos")]
pub use imp::{
    apply_window_spaces_behavior, configure_accessory_policy, get_monitor_work_area, init_window,
};
