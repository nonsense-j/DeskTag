use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

use crate::models::{
    AppData, AppStateBundle, AttachmentRef, BackupOptions, BackupResult, DeviceSettings, DockMode,
    DockState, ExportDocumentRequest, ExportDocumentResult, ImportBackupResult, NotificationItem,
    PlatformInfo, SaveAttachmentInput, StorageInfo, SyncExecutionResult, SyncPreview,
    UpdateCheckResult, UpdateInstallResult, WebDavConfigInput, WebDavConfigView, WebDavStatusView,
    WebDavTestResult,
};
use crate::AppState;

// ---------------------------------------------------------------------------
// App State & Persistence
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_app_state(state: State<'_, AppState>) -> AppStateBundle {
    let data = state.storage.load_app_data();
    let device = state.storage.load_device_settings();
    let dock = state.dock.get_state();
    let platform = PlatformInfo::current();
    AppStateBundle {
        data,
        device,
        dock,
        platform,
    }
}

#[tauri::command]
pub fn save_app_data(
    app: AppHandle,
    state: State<'_, AppState>,
    data: AppData,
) -> Result<(), String> {
    let persisted = state.storage.save_app_data_and_return(data)?;
    let _ = app.emit("desktag://data-updated", &persisted);

    let cfg = state.storage.load_webdav_config();
    if cfg.enabled && cfg.debounce_push {
        let webdav = state.webdav.clone();
        tauri::async_runtime::spawn(async move {
            let _ = webdav.trigger_debounced_sync().await;
        });
    }
    Ok(())
}

#[tauri::command]
pub fn save_device_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    device: DeviceSettings,
) -> Result<DockState, String> {
    let prev = state.storage.load_device_settings();
    state.storage.save_device_settings(&device)?;

    if prev.launch_at_login != device.launch_at_login {
        crate::apply_autostart(&app, device.launch_at_login);
    }
    if prev.global_shortcut_toggle != device.global_shortcut_toggle
        || prev.global_shortcut_quick_add != device.global_shortcut_quick_add
    {
        crate::register_global_shortcuts(&app, &device);
    }

    Ok(state.dock.sync_from_device(&app, &device))
}

// ---------------------------------------------------------------------------
// Window Docking & Multi-Window Controls
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_dock_state(state: State<'_, AppState>) -> DockState {
    state.dock.get_state()
}

#[tauri::command]
pub fn set_dock_mode(
    app: AppHandle,
    state: State<'_, AppState>,
    mode: DockMode,
) -> Result<DockState, String> {
    let mut device = state.storage.load_device_settings();
    device.dock_mode = mode;
    state.storage.save_device_settings(&device)?;
    Ok(state.dock.set_mode(&app, mode))
}

#[tauri::command]
pub fn set_auto_hide(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<DockState, String> {
    let mut device = state.storage.load_device_settings();
    device.auto_hide = enabled;
    state.storage.save_device_settings(&device)?;
    Ok(state.dock.set_auto_hide(&app, enabled))
}

#[tauri::command]
pub fn set_auto_hide_paused(state: State<'_, AppState>, paused: bool) {
    state.dock.set_auto_hide_paused(paused);
}

#[tauri::command]
pub fn set_always_on_top(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<DockState, String> {
    let mut device = state.storage.load_device_settings();
    device.always_on_top = enabled;
    state.storage.save_device_settings(&device)?;
    Ok(state.dock.set_always_on_top(&app, enabled))
}

#[tauri::command]
pub fn expand_panel(app: AppHandle, state: State<'_, AppState>) -> DockState {
    state.dock.expand(&app)
}

#[tauri::command]
pub fn collapse_panel(app: AppHandle, state: State<'_, AppState>) -> DockState {
    state.dock.collapse(&app)
}

#[tauri::command]
pub fn hide_to_tray(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.dock.hide_to_tray(&app)
}

#[tauri::command]
pub fn reset_panel_layout(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DeviceSettings, String> {
    let current = state.storage.load_device_settings();
    let reset = state.dock.reset_layout(&app, &current);
    state.storage.save_device_settings(&reset)?;
    Ok(reset)
}

#[tauri::command]
pub async fn open_calendar_window(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let dock = state.dock.clone();
    tauri::async_runtime::spawn_blocking(move || dock.open_calendar_window(&app))
        .await
        .map_err(|e| format!("failed to join calendar window task: {e}"))?
}

#[tauri::command]
pub async fn open_note_window(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: String,
) -> Result<(), String> {
    let dock = state.dock.clone();
    tauri::async_runtime::spawn_blocking(move || dock.open_note_window(&app, &note_id))
        .await
        .map_err(|e| format!("failed to join note window task: {e}"))?
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_attachment(
    state: State<'_, AppState>,
    input: SaveAttachmentInput,
) -> Result<AttachmentRef, String> {
    state.storage.save_attachment(input)
}

#[tauri::command]
pub fn open_attachment(
    app: AppHandle,
    state: State<'_, AppState>,
    relative_path: String,
) -> Result<(), String> {
    let abs = state.storage.resolve_attachment_path(&relative_path)?;
    app.opener()
        .open_path(abs.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("failed to open attachment: {e}"))
}

#[tauri::command]
pub fn read_attachment_data_url(
    state: State<'_, AppState>,
    relative_path: String,
    mime: Option<String>,
) -> Result<String, String> {
    state
        .storage
        .read_attachment_data_url(&relative_path, mime.as_deref())
}

// ---------------------------------------------------------------------------
// Backup, Export & Storage
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn export_backup(
    state: State<'_, AppState>,
    options: BackupOptions,
) -> Result<BackupResult, String> {
    state.storage.export_backup(options)
}

#[tauri::command]
pub fn import_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    source_path: Option<String>,
) -> Result<ImportBackupResult, String> {
    let result = state.storage.import_backup(source_path)?;
    let _ = app.emit("desktag://data-updated", &result.data);
    if let Some(ref dev) = result.device {
        let _ = state.dock.sync_from_device(&app, dev);
        crate::apply_autostart(&app, dev.launch_at_login);
        crate::register_global_shortcuts(&app, dev);
    }
    Ok(result)
}

#[tauri::command]
pub fn export_document(
    state: State<'_, AppState>,
    request: ExportDocumentRequest,
) -> Result<ExportDocumentResult, String> {
    state.storage.export_document(request)
}

#[tauri::command]
pub fn get_storage_info(state: State<'_, AppState>) -> StorageInfo {
    state.storage.get_storage_info()
}

#[tauri::command]
pub fn change_storage_dir(
    state: State<'_, AppState>,
    new_dir: String,
) -> Result<StorageInfo, String> {
    let info = state.storage.change_storage_dir(&new_dir)?;
    state.webdav.notify_config_changed();
    Ok(info)
}

#[tauri::command]
pub fn open_storage_dir(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let dir = state.storage.active_dir();
    let _ = std::fs::create_dir_all(&dir);
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("failed to open storage dir: {e}"))
}

#[tauri::command]
pub fn open_sync_backup_dir(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let dir = state.storage.sync_backup_dir();
    let _ = std::fs::create_dir_all(&dir);
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("failed to open sync backup dir: {e}"))
}

// ---------------------------------------------------------------------------
// Notifications Center
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_notifications(state: State<'_, AppState>) -> Vec<NotificationItem> {
    state.reminders.get_notifications()
}

#[tauri::command]
pub fn mark_notifications_read(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Option<Vec<String>>,
) -> Result<Vec<NotificationItem>, String> {
    let updated = state.reminders.mark_notifications_read(ids)?;
    let _ = app.emit("desktag://notifications-updated", &updated);
    Ok(updated)
}

#[tauri::command]
pub fn clear_notifications(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.reminders.clear_notifications()?;
    let empty: Vec<NotificationItem> = Vec::new();
    let _ = app.emit("desktag://notifications-updated", &empty);
    Ok(())
}

// ---------------------------------------------------------------------------
// WebDAV E2EE Cloud Sync
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_webdav_config(state: State<'_, AppState>) -> Result<WebDavConfigView, String> {
    Ok(state.webdav.get_config_view().await)
}

#[tauri::command]
pub async fn save_webdav_config(
    state: State<'_, AppState>,
    input: WebDavConfigInput,
) -> Result<WebDavConfigView, String> {
    state.webdav.save_config(input).await
}

#[tauri::command]
pub async fn get_webdav_status(state: State<'_, AppState>) -> Result<WebDavStatusView, String> {
    Ok(state.webdav.get_status().await)
}

#[tauri::command]
pub async fn test_webdav_connection(
    state: State<'_, AppState>,
    input: Option<WebDavConfigInput>,
) -> Result<WebDavTestResult, String> {
    state.webdav.test_connection(input).await
}

#[tauri::command]
pub async fn webdav_preview(
    state: State<'_, AppState>,
    input: Option<WebDavConfigInput>,
) -> Result<SyncPreview, String> {
    state.webdav.preview(input).await
}

#[tauri::command]
pub async fn webdav_sync_now(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SyncExecutionResult, String> {
    let res = state.webdav.sync_now().await?;
    emit_sync_result(&app, &res);
    Ok(res)
}

#[tauri::command]
pub async fn webdav_sync_previewed(
    app: AppHandle,
    state: State<'_, AppState>,
    token: String,
) -> Result<SyncExecutionResult, String> {
    let res = state.webdav.sync_previewed(token).await?;
    emit_sync_result(&app, &res);
    Ok(res)
}

#[tauri::command]
pub async fn webdav_undo_sync(
    app: AppHandle,
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<SyncExecutionResult, String> {
    let res = state.webdav.undo_sync(force.unwrap_or(false)).await?;
    emit_sync_result(&app, &res);
    Ok(res)
}

#[tauri::command]
pub async fn webdav_restore_from_server(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SyncExecutionResult, String> {
    let res = state.webdav.restore_from_server().await?;
    emit_sync_result(&app, &res);
    Ok(res)
}

#[tauri::command]
pub async fn webdav_force_upload(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SyncExecutionResult, String> {
    let res = state.webdav.force_upload().await?;
    emit_sync_result(&app, &res);
    Ok(res)
}

#[tauri::command]
pub async fn webdav_export_setup_text(state: State<'_, AppState>) -> Result<String, String> {
    state.webdav.export_setup_text().await
}

#[tauri::command]
pub async fn webdav_import_setup_text(
    state: State<'_, AppState>,
    setup_text: String,
    passphrase: String,
) -> Result<WebDavConfigView, String> {
    state.webdav.import_setup_text(setup_text, passphrase).await
}

#[tauri::command]
pub async fn trigger_debounced_sync(state: State<'_, AppState>) -> Result<(), String> {
    state.webdav.trigger_debounced_sync().await
}

fn emit_sync_result(app: &AppHandle, res: &SyncExecutionResult) {
    let _ = app.emit("desktag://sync-status", &res.status);
    if res.changed_local {
        if let Some(ref data) = res.data {
            let _ = app.emit("desktag://data-synced", data);
            let _ = app.emit("desktag://data-updated", data);
        }
    }
}

// ---------------------------------------------------------------------------
// App Updater (GitHub Releases)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn check_for_update(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<UpdateCheckResult, String> {
    crate::updater::check_for_update(&state.storage, force.unwrap_or(false)).await
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    update: UpdateCheckResult,
) -> Result<UpdateInstallResult, String> {
    crate::updater::download_and_install_update(&app, update).await
}

// ---------------------------------------------------------------------------
// Platform Info
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_platform_info() -> PlatformInfo {
    PlatformInfo::current()
}
