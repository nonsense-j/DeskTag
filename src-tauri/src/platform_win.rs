//! Windows-specific Win32 window docking, WorkArea clamping, `WS_EX_NOACTIVATE`,
//! cursor position polling, and WebView2 `ICoreWebView2_19::SetMemoryUsageTargetLevel`
//! low-RAM optimizations (ported from `yetone/magpie`).

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
    use std::mem::size_of;

    use tauri::{AppHandle, Manager, WebviewWindow};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;
    use windows::Win32::Foundation::{HWND, POINT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO, MONITORINFOEXW,
        MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_NOACTIVATE,
    };

    use super::WorkAreaRect;

    const OCCLUSION_FLAG: &str = "--disable-features=CalculateNativeWinOcclusion";

    /// Merge `--disable-features=CalculateNativeWinOcclusion` into existing browser arguments
    /// without duplicating it or clobbering user-supplied flags.
    pub fn merge_webview2_browser_args(existing: &str) -> String {
        if existing.contains("CalculateNativeWinOcclusion") {
            return existing.trim().to_string();
        }
        if existing.trim().is_empty() {
            OCCLUSION_FLAG.to_string()
        } else {
            format!("{} {OCCLUSION_FLAG}", existing.trim())
        }
    }

    /// Ensure `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` disables `CalculateNativeWinOcclusion`
    /// while preserving any flags already set by the user.
    /// Must be called BEFORE Tauri initializes WebView2.
    pub fn configure_webview2_env() {
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let merged = merge_webview2_browser_args(&existing);
        if merged != existing {
            std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", merged);
        }
    }

    /// Initialize Windows-specific settings for the main docked panel.
    pub fn init_window(app: &AppHandle) {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.set_skip_taskbar(true);
            set_webview_memory_low(&win, false);
        }
    }

    /// Port of Magpie's `ICoreWebView2_19::SetMemoryUsageTargetLevel` optimization.
    /// Drops Chromium GPU tiles & renderer caches while collapsed or hidden (~100MB+ saved),
    /// keeping the DOM intact for instant expand.
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

    /// Convenience wrapper applying WebView2 memory target level to the main window.
    pub fn set_memory_target_low(app: &AppHandle, low: bool) {
        if let Some(win) = app.get_webview_window("main") {
            set_webview_memory_low(&win, low);
        }
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
    configure_webview2_env, get_cursor_pos, get_monitor_work_area,
    get_monitor_work_area_at_point, init_window, merge_webview2_browser_args,
    set_memory_target_low, set_webview_memory_low, set_window_no_activate,
};

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn test_merge_webview2_browser_args_preserves_user_flags() {
        assert_eq!(
            merge_webview2_browser_args(""),
            "--disable-features=CalculateNativeWinOcclusion"
        );
        assert_eq!(
            merge_webview2_browser_args("--disable-features=RendererCodeIntegrity"),
            "--disable-features=RendererCodeIntegrity --disable-features=CalculateNativeWinOcclusion"
        );
        assert_eq!(
            merge_webview2_browser_args("--disable-features=CalculateNativeWinOcclusion --foo"),
            "--disable-features=CalculateNativeWinOcclusion --foo"
        );
    }
}
