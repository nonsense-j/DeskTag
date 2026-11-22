pub mod commands;
pub mod models;
pub mod platform_mac;
pub mod platform_win;
pub mod reminders;
pub mod storage;
pub mod webdav;
pub mod window_dock;

use std::sync::Arc;
use tauri::{AppHandle, Manager};

use crate::models::DeviceSettings;
use crate::reminders::ReminderScheduler;
use crate::storage::StorageManager;
use crate::webdav::WebDavManager;
use crate::window_dock::DockController;

/// Shared application state managed by Tauri across all commands and background tasks.
pub struct AppState {
    pub storage: Arc<StorageManager>,
    pub dock: Arc<DockController>,
    pub reminders: Arc<ReminderScheduler>,
    pub webdav: Arc<WebDavManager>,
}

/// Configure OS-level environment flags before Tauri initializes the WebView runtime.
pub fn prepare_runtime_env() {
    #[cfg(target_os = "windows")]
    platform_win::configure_webview2_env();
}

/// Apply the launch-at-login preference via `tauri-plugin-autostart` on desktop platforms.
pub fn apply_autostart(app: &AppHandle, enabled: bool) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let autolaunch = app.autolaunch();
        let res = if enabled {
            autolaunch.enable()
        } else {
            autolaunch.disable()
        };
        if let Err(err) = res {
            eprintln!("[desktag] autostart update ({enabled}) skipped: {err}");
        }
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = (app, enabled);
}

/// Register (or re-register) the configured desktop global hotkeys safely, ignoring
/// conflicts gracefully if another application already owns a key combination.
pub fn register_global_shortcuts(app: &AppHandle, device: &DeviceSettings) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri::Emitter;
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

        let gs = app.global_shortcut();
        let _ = gs.unregister_all();

        let toggle_key = device.global_shortcut_toggle.trim().to_string();
        if !toggle_key.is_empty() {
            if let Err(err) = gs.on_shortcut(toggle_key.as_str(), |app_handle, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let state = app_handle.state::<AppState>();
                    let _ = state.dock.toggle_expand(app_handle);
                }
            }) {
                eprintln!("[desktag] failed to register toggle hotkey '{toggle_key}': {err}");
            }
        }

        let quick_add_key = device.global_shortcut_quick_add.trim().to_string();
        if !quick_add_key.is_empty() && !quick_add_key.eq_ignore_ascii_case(&toggle_key) {
            if let Err(err) =
                gs.on_shortcut(quick_add_key.as_str(), |app_handle, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let state = app_handle.state::<AppState>();
                        let _ = state.dock.expand(app_handle);
                        let _ = app_handle.emit("desktag://focus-quick-add", ());
                    }
                })
            {
                eprintln!(
                    "[desktag] failed to register quick-add hotkey '{quick_add_key}': {err}"
                );
            }
        }
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = (app, device);
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn setup_system_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::image::Image;
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Emitter;

    let item_expand = MenuItem::with_id(app, "tray_expand", "展开面板", true, None::<&str>)?;
    let item_calendar = MenuItem::with_id(app, "tray_calendar", "日历视图", true, None::<&str>)?;
    let item_sync = MenuItem::with_id(app, "tray_sync", "立即同步", true, None::<&str>)?;
    let item_reset = MenuItem::with_id(app, "tray_reset", "恢复默认位置", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let item_quit = MenuItem::with_id(app, "tray_quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &item_expand,
            &item_calendar,
            &item_sync,
            &item_reset,
            &sep,
            &item_quit,
        ],
    )?;

    let mut tray_builder = TrayIconBuilder::with_id("desktag-tray")
        .tooltip("DeskTag — 桌面贴边待办与便签")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| {
            let state = app_handle.state::<AppState>();
            match event.id.as_ref() {
                "tray_expand" => {
                    let _ = state.dock.expand(app_handle);
                }
                "tray_calendar" => {
                    let _ = state.dock.open_calendar_window(app_handle);
                }
                "tray_sync" => {
                    let webdav = state.webdav.clone();
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Ok(res) = webdav.sync_now().await {
                            let _ = handle.emit("desktag://sync-status", &res.status);
                            if res.changed_local {
                                if let Some(ref data) = res.data {
                                    let _ = handle.emit("desktag://data-synced", data);
                                    let _ = handle.emit("desktag://data-updated", data);
                                }
                            }
                        }
                    });
                }
                "tray_reset" => {
                    let current = state.storage.load_device_settings();
                    let reset = state.dock.reset_layout(app_handle, &current);
                    let _ = state.storage.save_device_settings(&reset);
                }
                "tray_quit" => {
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app_handle = tray.app_handle();
                let state = app_handle.state::<AppState>();
                let _ = state.dock.toggle_expand(app_handle);
            }
        });

    if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/tray.png")) {
        tray_builder = tray_builder.icon(icon);
    } else if let Some(default_icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(default_icon);
    }

    tray_builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    prepare_runtime_env();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                let state = app.state::<AppState>();
                let _ = state.dock.expand(app);
            }))
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))
            .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
        .on_window_event(|window, event| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if window.label() == "main" {
                let app_handle = window.app_handle();
                let state = app_handle.state::<AppState>();
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        let device = state.storage.load_device_settings();
                        if device.close_to_tray {
                            api.prevent_close();
                            let _ = state.dock.hide_to_tray(app_handle);
                        }
                    }
                    _ => {
                        state
                            .dock
                            .handle_window_event(app_handle, &state.storage, event);
                    }
                }
            }
            #[cfg(any(target_os = "android", target_os = "ios"))]
            let _ = (window, event);
        })
        .setup(|app| {
            let default_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| storage::fallback_data_dir());

            let storage_mgr = Arc::new(StorageManager::new(default_dir));
            let device = storage_mgr.load_device_settings();
            let dock_ctrl = Arc::new(DockController::new(&device));
            let reminder_sched = Arc::new(ReminderScheduler::new(storage_mgr.clone()));
            let webdav_mgr = Arc::new(WebDavManager::new(storage_mgr.clone()));

            app.manage(AppState {
                storage: storage_mgr.clone(),
                dock: dock_ctrl.clone(),
                reminders: reminder_sched.clone(),
                webdav: webdav_mgr.clone(),
            });

            #[cfg(target_os = "windows")]
            platform_win::init_window(app.handle());

            #[cfg(target_os = "macos")]
            platform_mac::init_window(app.handle());

            dock_ctrl.apply_initial_layout(app.handle(), &device);

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                if let Err(err) = setup_system_tray(app.handle()) {
                    eprintln!("[desktag] failed to initialize system tray: {err}");
                }
                apply_autostart(app.handle(), device.launch_at_login);
                register_global_shortcuts(app.handle(), &device);
                dock_ctrl.spawn_auto_hide_watcher(app.handle().clone());
            }

            reminder_sched.spawn_reminder_daemon(app.handle().clone());
            webdav_mgr.spawn_background_sync(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_app_state,
            commands::save_app_data,
            commands::save_device_settings,
            commands::get_dock_state,
            commands::set_dock_mode,
            commands::set_auto_hide,
            commands::set_auto_hide_paused,
            commands::set_always_on_top,
            commands::expand_panel,
            commands::collapse_panel,
            commands::hide_to_tray,
            commands::reset_panel_layout,
            commands::open_calendar_window,
            commands::open_note_window,
            commands::save_attachment,
            commands::open_attachment,
            commands::read_attachment_data_url,
            commands::export_backup,
            commands::import_backup,
            commands::export_document,
            commands::get_storage_info,
            commands::change_storage_dir,
            commands::open_storage_dir,
            commands::open_sync_backup_dir,
            commands::get_notifications,
            commands::mark_notifications_read,
            commands::clear_notifications,
            commands::get_webdav_config,
            commands::save_webdav_config,
            commands::get_webdav_status,
            commands::test_webdav_connection,
            commands::webdav_preview,
            commands::webdav_sync_now,
            commands::webdav_sync_previewed,
            commands::webdav_undo_sync,
            commands::webdav_restore_from_server,
            commands::webdav_force_upload,
            commands::webdav_export_setup_text,
            commands::webdav_import_setup_text,
            commands::trigger_debounced_sync,
            commands::get_platform_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeskTag");
}
