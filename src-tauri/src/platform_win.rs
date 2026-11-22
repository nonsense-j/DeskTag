//! Windows-specific Win32 window docking, WorkArea clamping, `WS_EX_NOACTIVATE`,
//! DWM rounded corners, cursor position polling, and WebView2 low-RAM / suspend /
//! working-set optimizations.

/// Physical screen work-area rectangle (excluding taskbar / menu bar / dock)
/// paired with the monitor's DPI scale factor and optional OS monitor name.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkAreaRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub scale_factor: f64,
    pub monitor_name: Option<String>,
}

impl WorkAreaRect {
    pub fn width(&self) -> i32 {
        (self.right - self.left).max(1)
    }

    pub fn height(&self) -> i32 {
        (self.bottom - self.top).max(1)
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use std::collections::HashSet;
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    use tauri::{AppHandle, Manager, WebviewWindow};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment8, ICoreWebView2Settings4, ICoreWebView2Settings6,
        ICoreWebView2_19, ICoreWebView2_3, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use webview2_com::TrySuspendCompletedHandler;
    use windows::core::Interface;
    use windows::Win32::Foundation::{CloseHandle, HWND, POINT};
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        DWM_WINDOW_CORNER_PREFERENCE,
    };
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO, MONITORINFOEXW,
        MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::System::ProcessStatus::EmptyWorkingSet;
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_NOACTIVATE,
    };

    use super::WorkAreaRect;

    /// Features disabled in WebView2 across all DeskTag windows:
    /// - Restores `wry`'s built-in defaults (`msWebOOUI`, `msPdfOOUI`, `msSmartScreenProtection`)
    /// - Disables unused Edge/Chromium background services (translation, hints, media router,
    ///   autofill server communication, heavy-ad intervention, BFCache)
    /// - Keeps `CalculateNativeWinOcclusion` enabled so covered windows release GPU surfaces.
    const DEFAULT_DISABLED_FEATURES: &[&str] = &[
        "msWebOOUI",
        "msPdfOOUI",
        "msSmartScreenProtection",
        "Translate",
        "OptimizationHints",
        "MediaRouter",
        "DialMediaRouteProvider",
        "AutofillServerCommunication",
        "HeavyAdIntervention",
        "BackForwardCache",
    ];

    const EXTRA_BROWSER_FLAGS: &[&str] = &[
        "--disable-background-networking",
        "--disable-component-update",
        "--renderer-process-limit=1",
    ];

    const HIDDEN_TRIM_DELAY: Duration = Duration::from_secs(2);

    /// Merge DeskTag's lightweight WebView2 browser arguments into any user-supplied
    /// `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` value without duplicating flags or clobbering
    /// custom `--disable-features=...` entries (Chromium only honors a single
    /// `--disable-features=` flag if repeated, so all disabled features are merged into one).
    pub fn merge_webview2_browser_args(existing: &str) -> String {
        let mut disabled_features: Vec<String> = Vec::new();
        let mut other_tokens: Vec<String> = Vec::new();

        for token in existing.split_whitespace() {
            if let Some(rest) = token.strip_prefix("--disable-features=") {
                for feat in rest.split(',').map(str::trim).filter(|s| !s.is_empty()) {
                    if !disabled_features.iter().any(|f| f == feat) {
                        disabled_features.push(feat.to_string());
                    }
                }
            } else {
                other_tokens.push(token.to_string());
            }
        }

        for &feat in DEFAULT_DISABLED_FEATURES {
            if !disabled_features.iter().any(|f| f == feat) {
                disabled_features.push(feat.to_string());
            }
        }

        let mut merged: Vec<String> = Vec::with_capacity(other_tokens.len() + EXTRA_BROWSER_FLAGS.len() + 1);
        merged.push(format!("--disable-features={}", disabled_features.join(",")));
        merged.extend(other_tokens);

        for &flag in EXTRA_BROWSER_FLAGS {
            let prefix = flag.split('=').next().unwrap_or(flag);
            let already_present = merged
                .iter()
                .any(|t| t == flag || t.starts_with(&format!("{prefix}=")));
            if !already_present {
                merged.push(flag.to_string());
            }
        }

        merged.join(" ")
    }

    /// Single source of truth for `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` shared identically
    /// across `main`, `calendar`, and `note-*` windows (avoiding `0x8007139F` UDF mismatch).
    /// Must be called BEFORE Tauri initializes WebView2.
    pub fn configure_webview2_env() {
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let merged = merge_webview2_browser_args(&existing);
        if merged != existing {
            std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", merged);
        }
    }

    /// Disable unused WebView2 UI/browser features (status bar, zoom, swipe navigation,
    /// password autosave, general autofill) on any DeskTag WebView window.
    pub fn configure_webview_settings(window: &WebviewWindow) {
        let _ = window.with_webview(move |wv| unsafe {
            if let Ok(core_wv) = wv.controller().CoreWebView2() {
                if let Ok(settings) = core_wv.Settings() {
                    let _ = settings.SetIsStatusBarEnabled(false);
                    let _ = settings.SetIsZoomControlEnabled(false);
                    if let Ok(s4) = settings.cast::<ICoreWebView2Settings4>() {
                        let _ = s4.SetIsPasswordAutosaveEnabled(false);
                        let _ = s4.SetIsGeneralAutofillEnabled(false);
                    }
                    if let Ok(s6) = settings.cast::<ICoreWebView2Settings6>() {
                        let _ = s6.SetIsSwipeNavigationEnabled(false);
                    }
                }
            }
        });
    }

    /// Initialize Windows-specific settings for the main docked panel.
    pub fn init_window(app: &AppHandle) {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.set_skip_taskbar(true);
            configure_webview_settings(&win);
            set_webview_memory_low(&win, false);
        }
    }

    /// Request Windows 11 native DWM rounded corners (`DWMWCP_ROUND`) on opaque frameless
    /// secondary windows (`calendar`, `note-*`). Graceful no-op on Windows 10.
    pub fn apply_rounded_corners(window: &WebviewWindow) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let pref: DWM_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND;
        unsafe {
            let _ = DwmSetWindowAttribute(
                HWND(hwnd.0),
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &pref as *const DWM_WINDOW_CORNER_PREFERENCE as *const c_void,
                size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
            );
        }
    }

    /// Set WebView2 `ICoreWebView2_19::SetMemoryUsageTargetLevel` (`LOW` vs `NORMAL`).
    /// Drops Chromium GPU tiles & renderer caches while collapsed or unfocused,
    /// keeping the DOM intact for instant interaction.
    pub fn set_webview_memory_low(window: &WebviewWindow, low: bool) {
        let _ = window.with_webview(move |wv| unsafe {
            if let Ok(core_wv) = wv.controller().CoreWebView2() {
                if let Ok(wv19) = core_wv.cast::<ICoreWebView2_19>() {
                    let level = if low {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    };
                    let _ = wv19.SetMemoryUsageTargetLevel(level);
                }
            }
        });
    }

    /// Switch a WebView window into `COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW`.
    pub fn set_memory_usage_low(window: &WebviewWindow) {
        set_webview_memory_low(window, true);
    }

    /// Switch a WebView window back to `COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL`.
    pub fn set_memory_usage_normal(window: &WebviewWindow) {
        set_webview_memory_low(window, false);
    }

    /// Convenience wrapper applying WebView2 memory target level to the main window.
    pub fn set_memory_target_low(app: &AppHandle, low: bool) {
        if let Some(win) = app.get_webview_window("main") {
            set_webview_memory_low(&win, low);
        }
    }

    /// Truly hide and suspend a hidden WebView2 window (tray / full-hide modes):
    /// 1. `ICoreWebView2Controller::SetIsVisible(false)` releases the DirectComposition swapchain
    ///    and fires `document.visibilitychange`.
    /// 2. `ICoreWebView2_19::SetMemoryUsageTargetLevel(LOW)` shrinks Blink/GPU caches.
    /// 3. `ICoreWebView2_3::TrySuspend()` suspends the renderer while Rust background daemons
    ///    (reminders, WebDAV sync, tray, global hotkeys) keep running.
    pub fn suspend_webview(window: &WebviewWindow) {
        let _ = window.with_webview(move |wv| unsafe {
            let controller = wv.controller();
            let _ = controller.SetIsVisible(false);
            if let Ok(core_wv) = controller.CoreWebView2() {
                if let Ok(wv19) = core_wv.cast::<ICoreWebView2_19>() {
                    let _ = wv19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
                }
                if let Ok(wv3) = core_wv.cast::<ICoreWebView2_3>() {
                    let handler = TrySuspendCompletedHandler::create(Box::new(|_, _| Ok(())));
                    let _ = wv3.TrySuspend(&handler);
                }
            }
        });
    }

    /// Wake a suspended/hidden WebView2 window prior to showing it:
    /// 1. `ICoreWebView2_3::Resume()` unpauses the Blink renderer (safe no-op if not suspended).
    /// 2. `ICoreWebView2_19::SetMemoryUsageTargetLevel(NORMAL)` restores normal cache budget.
    /// 3. `ICoreWebView2Controller::SetIsVisible(true)` re-enables painting and triggers
    ///    `document.visibilitychange`.
    pub fn resume_webview(window: &WebviewWindow) {
        let _ = window.with_webview(move |wv| unsafe {
            let controller = wv.controller();
            if let Ok(core_wv) = controller.CoreWebView2() {
                if let Ok(wv3) = core_wv.cast::<ICoreWebView2_3>() {
                    let _ = wv3.Resume();
                }
                if let Ok(wv19) = core_wv.cast::<ICoreWebView2_19>() {
                    let _ =
                        wv19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
                }
            }
            let _ = controller.SetIsVisible(true);
        });
    }

    /// One-shot working-set trim for the DeskTag Rust host process and its own WebView2 child
    /// processes (enumerated via `ICoreWebView2Environment8::GetProcessInfos`).
    /// Never called in a loop — only triggered once after hiding to tray/full-hide.
    pub fn trim_process_working_sets(window: &WebviewWindow) {
        let _ = window.with_webview(move |wv| unsafe {
            let mut pids = HashSet::<u32>::new();

            if let Ok(core_wv) = wv.controller().CoreWebView2() {
                let mut browser_pid: u32 = 0;
                if core_wv.BrowserProcessId(&mut browser_pid).is_ok() && browser_pid != 0 {
                    pids.insert(browser_pid);
                }
            }

            if let Ok(env8) = wv.environment().cast::<ICoreWebView2Environment8>() {
                if let Ok(collection) = env8.GetProcessInfos() {
                    let mut count: u32 = 0;
                    if collection.Count(&mut count).is_ok() {
                        for idx in 0..count {
                            if let Ok(info) = collection.GetValueAtIndex(idx) {
                                let mut pid: i32 = 0;
                                if info.ProcessId(&mut pid).is_ok() && pid > 0 {
                                    pids.insert(pid as u32);
                                }
                            }
                        }
                    }
                }
            }

            // Trim DeskTag Rust host working set.
            let _ = EmptyWorkingSet(GetCurrentProcess());

            // Trim each owned WebView2 process (Browser, GPU, Renderer, Utility).
            let current_pid = std::process::id();
            for pid in pids {
                if pid == 0 || pid == current_pid {
                    continue;
                }
                if let Ok(handle) =
                    OpenProcess(PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION, false, pid)
                {
                    let _ = EmptyWorkingSet(handle);
                    let _ = CloseHandle(handle);
                }
            }
        });
    }

    /// Schedule a 2-second delayed one-shot working-set trim after hiding `main` to tray or
    /// full-hide edge collapse. Automatically aborts if `gen_counter` changed (window reopened)
    /// or if any DeskTag window (`main`, `calendar`, `note-*`) is still visible.
    pub fn schedule_hidden_trim(app: AppHandle, expected_gen: u64, gen_counter: Arc<AtomicU64>) {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(HIDDEN_TRIM_DELAY).await;
            if gen_counter.load(Ordering::SeqCst) != expected_gen {
                return;
            }
            let any_visible = app
                .webview_windows()
                .values()
                .any(|w| w.is_visible().unwrap_or(false));
            if any_visible {
                return;
            }
            if let Some(main_win) = app.get_webview_window("main") {
                trim_process_working_sets(&main_win);
            }
        });
    }

    /// Toggle `WS_EX_NOACTIVATE` on a Win32 window so collapsed edge tabs never steal
    /// keyboard focus from active apps or trigger an orange taskbar flash.
    pub fn set_window_no_activate(window: &WebviewWindow, enable: bool) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let hwnd = HWND(hwnd.0);
        unsafe {
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let flag = WS_EX_NOACTIVATE.0 as isize;
            let next_style = if enable {
                ex_style | flag
            } else {
                ex_style & !flag
            };
            if next_style != ex_style {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_style);
                let _ = SetWindowPos(
                    hwnd,
                    None,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                );
            }
        }
    }

    /// Query the exact physical `WorkArea` (excluding the Windows taskbar) of the monitor
    /// currently hosting `window`, together with its DPI scale factor and device name.
    pub fn get_monitor_work_area(window: &WebviewWindow) -> Option<WorkAreaRect> {
        let hwnd = window.hwnd().ok()?;
        let scale = window.scale_factor().unwrap_or(1.0).max(0.5);
        unsafe {
            let hmon = MonitorFromWindow(HWND(hwnd.0), MONITOR_DEFAULTTONEAREST);
            monitor_info_to_work_area(hmon, scale)
        }
    }

    /// Query the `WorkArea` of the monitor nearest to physical screen coordinate `(x, y)`.
    pub fn get_monitor_work_area_at_point(
        x: i32,
        y: i32,
        fallback_scale: f64,
    ) -> Option<WorkAreaRect> {
        unsafe {
            let hmon = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
            monitor_info_to_work_area(hmon, fallback_scale.max(0.5))
        }
    }

    unsafe fn monitor_info_to_work_area(
        hmon: windows::Win32::Graphics::Gdi::HMONITOR,
        scale_factor: f64,
    ) -> Option<WorkAreaRect> {
        if hmon.0.is_null() {
            return None;
        }
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
        let ok = GetMonitorInfoW(hmon, &mut info.monitorInfo as *mut MONITORINFO);
        if !ok.as_bool() {
            return None;
        }
        let rc = info.monitorInfo.rcWork;
        let name_len = info
            .szDevice
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(info.szDevice.len());
        let monitor_name = String::from_utf16_lossy(&info.szDevice[..name_len]);
        Some(WorkAreaRect {
            left: rc.left,
            top: rc.top,
            right: rc.right,
            bottom: rc.bottom,
            scale_factor,
            monitor_name: if monitor_name.is_empty() {
                None
            } else {
                Some(monitor_name)
            },
        })
    }

    /// Query the current global cursor position in physical screen pixels via Win32 `GetCursorPos`.
    pub fn get_cursor_pos() -> Option<(i32, i32)> {
        let mut pt = POINT::default();
        unsafe {
            if GetCursorPos(&mut pt).is_ok() {
                Some((pt.x, pt.y))
            } else {
                None
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{
    apply_rounded_corners, configure_webview2_env, configure_webview_settings, get_cursor_pos,
    get_monitor_work_area, get_monitor_work_area_at_point, init_window,
    merge_webview2_browser_args, resume_webview, schedule_hidden_trim, set_memory_target_low,
    set_memory_usage_low, set_memory_usage_normal, set_webview_memory_low, set_window_no_activate,
    suspend_webview, trim_process_working_sets,
};

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn test_merge_webview2_browser_args_merges_features_and_preserves_user_flags() {
        let default_merged = merge_webview2_browser_args("");
        assert!(default_merged.contains("--disable-features="));
        assert!(default_merged.contains("msWebOOUI"));
        assert!(default_merged.contains("msPdfOOUI"));
        assert!(default_merged.contains("msSmartScreenProtection"));
        assert!(default_merged.contains("Translate"));
        assert!(default_merged.contains("BackForwardCache"));
        assert!(!default_merged.contains("CalculateNativeWinOcclusion"));
        assert!(default_merged.contains("--disable-background-networking"));
        assert!(default_merged.contains("--disable-component-update"));
        assert!(default_merged.contains("--renderer-process-limit=1"));
        // Idempotent on second merge
        assert_eq!(merge_webview2_browser_args(&default_merged), default_merged);

        // User-supplied --disable-features gets merged into a single flag
        let with_user = merge_webview2_browser_args(
            "--disable-features=RendererCodeIntegrity --foo=bar --renderer-process-limit=2",
        );
        assert_eq!(with_user.matches("--disable-features=").count(), 1);
        assert!(with_user.contains("RendererCodeIntegrity,msWebOOUI"));
        assert!(with_user.contains("--foo=bar"));
        assert!(with_user.contains("--renderer-process-limit=2"));
        assert!(!with_user.contains("--renderer-process-limit=1"));
    }
}
