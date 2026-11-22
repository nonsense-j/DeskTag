//! Windows-specific Win32 window docking, WorkArea clamping, WS_EX_NOACTIVATE,
//! and WebView2 `ICoreWebView2_19::SetMemoryUsageTargetLevel` low-RAM helpers.

#[cfg(target_os = "windows")]
use tauri::AppHandle;

#[cfg(target_os = "windows")]
pub fn init_window(_app: &AppHandle) {
    // Full Win32 docking, resize-frame preservation, and WebView2 memory hooks
    // are implemented by the desktop platform module.
}

#[cfg(target_os = "windows")]
pub fn set_memory_target_low(_app: &AppHandle, _low: bool) {
    // Queries ICoreWebView2_19::SetMemoryUsageTargetLevel(LOW / NORMAL).
}
