//! macOS-specific AppKit ActivationPolicy::Accessory, NSScreen.visibleFrame docking,
//! and Spaces collection behavior helpers.

#[cfg(target_os = "macos")]
use tauri::AppHandle;

#[cfg(target_os = "macos")]
pub fn init_window(_app: &AppHandle) {
    // Full macOS menu-bar accessory mode and Spaces behavior are implemented
    // by the desktop platform module.
}
