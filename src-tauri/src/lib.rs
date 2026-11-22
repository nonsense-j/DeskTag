pub mod commands;
pub mod models;
pub mod platform_mac;
pub mod platform_win;
pub mod reminders;
pub mod storage;
pub mod webdav;
pub mod window_dock;

use std::sync::Arc;
use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }))
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))
            .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
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
                storage: storage_mgr,
                dock: dock_ctrl,
                reminders: reminder_sched,
                webdav: webdav_mgr,
            });

            #[cfg(target_os = "windows")]
            platform_win::init_window(app.handle());

            #[cfg(target_os = "macos")]
            platform_mac::init_window(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_app_state,
            commands::save_app_data,
            commands::save_device_settings,
            commands::get_dock_state,
            commands::set_dock_mode,
            commands::set_auto_hide,
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
