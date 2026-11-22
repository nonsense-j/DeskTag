use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};

use base64::Engine;
use chrono::{Datelike, Local, NaiveDate, Utc};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::models::{
    now_iso, AppData, AttachmentKind, AttachmentRef, BackupOptions, BackupResult, DeviceSettings,
    ExportDocFormat, ExportDocumentRequest, ExportDocumentResult, ImportBackupResult, NoteItem,
    NoteKind, NotificationItem, SaveAttachmentInput, StorageInfo, TodoItem, TodoPriority,
    WebDavConfig, CURRENT_SCHEMA_VERSION,
};

pub const DATA_FILE_NAME: &str = "data.json";
pub const DEVICE_FILE_NAME: &str = "device.json";
pub const SYNC_CONFIG_FILE_NAME: &str = "sync.json";
pub const SYNC_STATE_FILE_NAME: &str = "sync-state.json";
pub const SYNC_SERVER_CACHE_NAME: &str = "sync-server.desktag-backup";
pub const NOTIFICATIONS_FILE_NAME: &str = "notifications.json";
pub const ATTACHMENTS_DIR_NAME: &str = "attachments";
pub const SYNC_BACKUP_DIR_NAME: &str = "sync";
pub const BACKUPS_DIR_NAME: &str = "backups";
pub const EXPORTS_DIR_NAME: &str = "exports";
const MAX_STORED_NOTIFICATIONS: usize = 200;

pub fn fallback_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("DeskTag")
}

/// Write bytes atomically via temp file + rename in the same directory.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_atomic_inner(path, bytes, false)
}

/// Write sensitive bytes atomically, enforcing `0600` POSIX permissions on Unix.
pub fn write_atomic_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_atomic_inner(path, bytes, true)
}

fn write_atomic_inner(path: &Path, bytes: &[u8], private: bool) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create dir: {e}"))?;
    }
    let tmp_name = format!(
        ".{}.tmp.{}",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("desktag"),
        Uuid::new_v4()
    );
    let tmp_path = path.with_file_name(tmp_name);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create_new(true);
        if private {
            opts.mode(0o600);
        }
        let mut file = opts
            .open(&tmp_path)
            .map_err(|e| format!("failed to create temp file: {e}"))?;
        file.write_all(bytes)
            .map_err(|e| format!("failed to write temp file: {e}"))?;
        let _ = file.sync_all();
    }

    #[cfg(not(unix))]
    {
        let _ = private;
        fs::write(&tmp_path, bytes).map_err(|e| format!("failed to write temp file: {e}"))?;
    }

    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("failed to replace target file: {e}")
    })?;

    #[cfg(unix)]
    if private {
        set_unix_permissions(path, 0o600);
    }

    Ok(())
}

#[cfg(unix)]
fn set_unix_permissions(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
}

fn ensure_private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("failed to create private dir: {e}"))?;
    #[cfg(unix)]
    set_unix_permissions(path, 0o700);
    Ok(())
}

pub struct StorageManager {
    default_dir: PathBuf,
    active_dir: RwLock<PathBuf>,
    io_lock: Mutex<()>,
}

impl StorageManager {
    pub fn new(default_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&default_dir);
        let pointer_device = Self::read_device_from(&default_dir);
        let initial_dir = pointer_device
            .custom_data_dir
            .as_deref()
            .map(PathBuf::from)
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| default_dir.clone());
        let _ = fs::create_dir_all(&initial_dir);
        let _ = ensure_private_dir(&initial_dir.join(SYNC_BACKUP_DIR_NAME));
        #[cfg(unix)]
        {
            let sync_cfg = initial_dir.join(SYNC_CONFIG_FILE_NAME);
            if sync_cfg.exists() {
                set_unix_permissions(&sync_cfg, 0o600);
            }
        }
        Self {
            default_dir,
            active_dir: RwLock::new(initial_dir),
            io_lock: Mutex::new(()),
        }
    }

    pub fn active_dir(&self) -> PathBuf {
        self.active_dir
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|_| self.default_dir.clone())
    }

    pub fn default_dir(&self) -> &Path {
        &self.default_dir
    }

    pub fn data_file_path(&self) -> PathBuf {
        self.active_dir().join(DATA_FILE_NAME)
    }

    pub fn device_file_path(&self) -> PathBuf {
        self.default_dir.join(DEVICE_FILE_NAME)
    }

    pub fn sync_config_path(&self) -> PathBuf {
        self.active_dir().join(SYNC_CONFIG_FILE_NAME)
    }

    pub fn notifications_file_path(&self) -> PathBuf {
        self.active_dir().join(NOTIFICATIONS_FILE_NAME)
    }

    pub fn attachments_dir(&self) -> PathBuf {
        self.active_dir().join(ATTACHMENTS_DIR_NAME)
    }

    pub fn sync_backup_dir(&self) -> PathBuf {
        let dir = self.active_dir().join(SYNC_BACKUP_DIR_NAME);
        let _ = ensure_private_dir(&dir);
        dir
    }

    fn read_device_from(dir: &Path) -> DeviceSettings {
        let path = dir.join(DEVICE_FILE_NAME);
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<DeviceSettings>(strip_utf8_bom(&raw)).ok())
            .unwrap_or_default()
    }

    pub fn load_app_data(&self) -> AppData {
        let path = self.data_file_path();
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<AppData>(strip_utf8_bom(&raw)).ok())
            .unwrap_or_default()
    }

    pub fn save_app_data(&self, mut data: AppData) -> Result<(), String> {
        let _guard = self.io_lock.lock().unwrap_or_else(|e| e.into_inner());
        data.updated_at = now_iso();
        let bytes = serde_json::to_vec_pretty(&data)
            .map_err(|e| format!("failed to serialize app data: {e}"))?;
        write_atomic(&self.data_file_path(), &bytes)
    }

    pub fn load_device_settings(&self) -> DeviceSettings {
        Self::read_device_from(&self.default_dir)
    }

    pub fn save_device_settings(&self, device: &DeviceSettings) -> Result<(), String> {
        let _guard = self.io_lock.lock().unwrap_or_else(|e| e.into_inner());
        let bytes = serde_json::to_vec_pretty(device)
            .map_err(|e| format!("failed to serialize device settings: {e}"))?;
        write_atomic(&self.device_file_path(), &bytes)
    }

    pub fn load_webdav_config(&self) -> WebDavConfig {
        let path = self.sync_config_path();
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<WebDavConfig>(strip_utf8_bom(&raw)).ok())
            .unwrap_or_default()
    }

    pub fn save_webdav_config(&self, cfg: &WebDavConfig) -> Result<(), String> {
        let _guard = self.io_lock.lock().unwrap_or_else(|e| e.into_inner());
        let _ = ensure_private_dir(&self.active_dir().join(SYNC_BACKUP_DIR_NAME));
        let bytes = serde_json::to_vec_pretty(cfg)
            .map_err(|e| format!("failed to serialize webdav config: {e}"))?;
        write_atomic_private(&self.sync_config_path(), &bytes)
    }

    pub fn load_notifications(&self) -> Vec<NotificationItem> {
        let path = self.notifications_file_path();
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| {
                serde_json::from_str::<Vec<NotificationItem>>(strip_utf8_bom(&raw)).ok()
            })
            .unwrap_or_default()
    }

    pub fn save_notifications(&self, items: &[NotificationItem]) -> Result<(), String> {
        let _guard = self.io_lock.lock().unwrap_or_else(|e| e.into_inner());
        let bytes = serde_json::to_vec_pretty(items)
            .map_err(|e| format!("failed to serialize notifications: {e}"))?;
        write_atomic(&self.notifications_file_path(), &bytes)
    }

    /// Prepend a notification item (newest first), trimming to a bounded history.
    pub fn append_notification(
        &self,
        item: NotificationItem,
    ) -> Result<Vec<NotificationItem>, String> {
        let _guard = self.io_lock.lock().unwrap_or_else(|e| e.into_inner());
        let path = self.notifications_file_path();
        let mut items: Vec<NotificationItem> = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| {
                serde_json::from_str::<Vec<NotificationItem>>(strip_utf8_bom(&raw)).ok()
            })
            .unwrap_or_default();
        items.insert(0, item);
        if items.len() > MAX_STORED_NOTIFICATIONS {
            items.truncate(MAX_STORED_NOTIFICATIONS);
        }
        let bytes = serde_json::to_vec_pretty(&items)
            .map_err(|e| format!("failed to serialize notifications: {e}"))?;
        write_atomic(&path, &bytes)?;
        Ok(items)
    }

    pub fn save_attachment(&self, input: SaveAttachmentInput) -> Result<AttachmentRef, String> {
        let raw_b64 = input
            .base64_data
            .split_once(',')
            .map(|(_, rhs)| rhs)
            .unwrap_or(input.base64_data.as_str());
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(raw_b64.trim())
            .map_err(|e| format!("invalid base64 attachment payload: {e}"))?;

        let id = Uuid::new_v4().to_string();
        let safe_name: String = input
            .name
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let file_name = format!("{id}_{safe_name}");
        let rel_path = format!("{ATTACHMENTS_DIR_NAME}/{file_name}");
        let abs_path = self.attachments_dir().join(&file_name);
        write_atomic(&abs_path, &bytes)?;

        Ok(AttachmentRef {
            id,
            name: input.name,
            mime: input.mime,
            size: bytes.len() as u64,
            relative_path: rel_path,
            kind: input.kind,
        })
    }

    pub fn resolve_attachment_path(&self, relative_path: &str) -> Result<PathBuf, String> {
        let normalized = relative_path.replace('\\', "/");
        if normalized.is_empty()
            || normalized.contains("..")
            || normalized.starts_with('/')
            || normalized.contains(':')
        {
            return Err("invalid attachment path".to_string());
        }
        Ok(self.active_dir().join(normalized))
    }

    pub fn read_attachment_data_url(
        &self,
        relative_path: &str,
        mime: Option<&str>,
    ) -> Result<String, String> {
        let abs = self.resolve_attachment_path(relative_path)?;
        let bytes = fs::read(&abs).map_err(|e| format!("failed to read attachment: {e}"))?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        let content_type = mime.unwrap_or("application/octet-stream");
        Ok(format!("data:{content_type};base64,{encoded}"))
    }

    pub fn get_storage_info(&self) -> StorageInfo {
        let active = self.active_dir();
        let total_bytes = dir_size(&active);
        StorageInfo {
            data_dir: active.to_string_lossy().to_string(),
            data_file_path: self.data_file_path().to_string_lossy().to_string(),
            attachments_dir: self.attachments_dir().to_string_lossy().to_string(),
            sync_backup_dir: active
                .join(SYNC_BACKUP_DIR_NAME)
                .to_string_lossy()
                .to_string(),
            total_bytes,
            is_custom_dir: active != self.default_dir,
        }
    }

    pub fn change_storage_dir(&self, new_dir: &str) -> Result<StorageInfo, String> {
        let _guard = self.io_lock.lock().unwrap_or_else(|e| e.into_inner());
        let trimmed = new_dir.trim();
        if trimmed.is_empty() {
            return Err("storage directory path cannot be empty".to_string());
        }
        let target = PathBuf::from(trimmed);
        fs::create_dir_all(&target)
            .map_err(|e| format!("failed to create storage directory: {e}"))?;

        let old_dir = self.active_dir();
        let same_dir = match (fs::canonicalize(&old_dir), fs::canonicalize(&target)) {
            (Ok(a), Ok(b)) => a == b,
            _ => old_dir == target,
        };

        if !same_dir {
            // Migrate individual data & sync files safely (atomically into target).
            for (name, is_private) in [
                (DATA_FILE_NAME, false),
                (SYNC_CONFIG_FILE_NAME, true),
                (SYNC_STATE_FILE_NAME, false),
                (SYNC_SERVER_CACHE_NAME, true),
                (NOTIFICATIONS_FILE_NAME, false),
            ] {
                let src = old_dir.join(name);
                if src.is_file() {
                    let bytes = fs::read(&src)
                        .map_err(|e| format!("failed to read {name} during migration: {e}"))?;
                    let dst = target.join(name);
                    if is_private {
                        write_atomic_private(&dst, &bytes)?;
                    } else {
                        write_atomic(&dst, &bytes)?;
                    }
                }
            }

            // Migrate attachments/ directory if present.
            let old_att = old_dir.join(ATTACHMENTS_DIR_NAME);
            if old_att.is_dir() {
                copy_dir_recursive(&old_att, &target.join(ATTACHMENTS_DIR_NAME), false)?;
            }

            // Migrate sync/ backup directory if present (preserving 0700/0600 on Unix).
            let old_sync = old_dir.join(SYNC_BACKUP_DIR_NAME);
            let new_sync = target.join(SYNC_BACKUP_DIR_NAME);
            ensure_private_dir(&new_sync)?;
            if old_sync.is_dir() {
                copy_dir_recursive(&old_sync, &new_sync, true)?;
            }
        }

        // Persist device pointer first, then swap active_dir atomically.
        let mut device = Self::read_device_from(&self.default_dir);
        let is_default = match (fs::canonicalize(&self.default_dir), fs::canonicalize(&target)) {
            (Ok(a), Ok(b)) => a == b,
            _ => self.default_dir == target,
        };
        device.custom_data_dir = if is_default {
            None
        } else {
            Some(target.to_string_lossy().to_string())
        };
        let device_bytes = serde_json::to_vec_pretty(&device)
            .map_err(|e| format!("failed to serialize device settings: {e}"))?;
        write_atomic(&self.device_file_path(), &device_bytes)?;

        if let Ok(mut guard) = self.active_dir.write() {
            *guard = target;
        }
        Ok(self.get_storage_info())
    }

    pub fn export_backup(&self, options: BackupOptions) -> Result<BackupResult, String> {
        if !options.include_data && !options.include_settings {
            return Err("at least one of data or settings must be selected for backup".to_string());
        }

        let exported_at = now_iso();
        let data = if options.include_data {
            Some(self.load_app_data())
        } else {
            None
        };
        let device = if options.include_settings {
            Some(self.load_device_settings())
        } else {
            None
        };

        // Collect all attachments (referenced + files in attachments/) when include_data is true.
        let attachment_bytes = if let Some(ref app_data) = data {
            self.collect_backup_attachments(app_data)
        } else {
            BTreeMap::new()
        };

        let target = options
            .target_path
            .filter(|p| !p.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                self.active_dir().join(BACKUPS_DIR_NAME).join(format!(
                    "desktag-backup-{}.json",
                    Utc::now().format("%Y%m%d-%H%M%S")
                ))
            });

        let is_zip = target
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("zip"))
            .unwrap_or(false);

        let bytes = if is_zip {
            let manifest = serde_json::json!({
                "format": "desktag-backup",
                "schemaVersion": CURRENT_SCHEMA_VERSION,
                "exportedAt": exported_at,
                "data": data,
                "device": device,
            });
            let manifest_bytes = serde_json::to_vec_pretty(&manifest)
                .map_err(|e| format!("failed to serialize backup manifest: {e}"))?;

            let mut buf = Cursor::new(Vec::<u8>::new());
            {
                let mut zip = ZipWriter::new(&mut buf);
                let opts =
                    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
                zip.start_file("backup.json", opts)
                    .map_err(|e| format!("failed to add backup.json to zip: {e}"))?;
                zip.write_all(&manifest_bytes)
                    .map_err(|e| format!("failed to write backup.json: {e}"))?;

                for (rel_path, raw) in &attachment_bytes {
                    zip.start_file(rel_path, opts)
                        .map_err(|e| format!("failed to add attachment {rel_path}: {e}"))?;
                    zip.write_all(raw)
                        .map_err(|e| format!("failed to write attachment {rel_path}: {e}"))?;
                }
                zip.finish()
                    .map_err(|e| format!("failed to finalize backup zip: {e}"))?;
            }
            buf.into_inner()
        } else {
            let mut b64_attachments = BTreeMap::<String, String>::new();
            for (rel_path, raw) in &attachment_bytes {
                b64_attachments.insert(
                    rel_path.clone(),
                    base64::engine::general_purpose::STANDARD.encode(raw),
                );
            }
            let payload = serde_json::json!({
                "format": "desktag-backup",
                "schemaVersion": CURRENT_SCHEMA_VERSION,
                "exportedAt": exported_at,
                "data": data,
                "device": device,
                "attachments": b64_attachments,
            });
            serde_json::to_vec_pretty(&payload)
                .map_err(|e| format!("failed to serialize backup: {e}"))?
        };

        write_atomic(&target, &bytes)?;
        Ok(BackupResult {
            path: target.to_string_lossy().to_string(),
            bytes: bytes.len() as u64,
            exported_at,
        })
    }

    pub fn import_backup(&self, source_path: Option<String>) -> Result<ImportBackupResult, String> {
        let path = source_path
            .filter(|p| !p.trim().is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| "source backup path is required".to_string())?;
        let raw_bytes = fs::read(&path).map_err(|e| format!("failed to read backup: {e}"))?;

        let is_zip = raw_bytes.starts_with(b"PK\x03\x04")
            || path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("zip"))
                .unwrap_or(false);

        let (value, zip_attachments): (serde_json::Value, BTreeMap<String, Vec<u8>>) = if is_zip {
            let cursor = Cursor::new(&raw_bytes);
            let mut archive =
                ZipArchive::new(cursor).map_err(|e| format!("invalid ZIP backup archive: {e}"))?;
            let mut manifest_json: Option<String> = None;
            let mut attachments = BTreeMap::new();

            for i in 0..archive.len() {
                let mut entry = archive
                    .by_index(i)
                    .map_err(|e| format!("failed to read ZIP entry: {e}"))?;
                if entry.is_dir() {
                    continue;
                }
                let name = entry.name().replace('\\', "/");
                if name == "backup.json" || name == "data.json" {
                    let mut text = String::new();
                    entry
                        .read_to_string(&mut text)
                        .map_err(|e| format!("failed to read {name} from ZIP: {e}"))?;
                    if manifest_json.is_none() || name == "backup.json" {
                        manifest_json = Some(text);
                    }
                } else if name.starts_with(&format!("{ATTACHMENTS_DIR_NAME}/"))
                    && !name.contains("..")
                    && !name.contains(':')
                {
                    let mut buf = Vec::new();
                    entry
                        .read_to_end(&mut buf)
                        .map_err(|e| format!("failed to read attachment {name}: {e}"))?;
                    attachments.insert(name, buf);
                }
            }

            let raw = manifest_json
                .ok_or_else(|| "ZIP backup is missing backup.json / data.json".to_string())?;
            let parsed = serde_json::from_str::<serde_json::Value>(strip_utf8_bom(&raw))
                .map_err(|e| format!("invalid backup JSON in ZIP: {e}"))?;
            (parsed, attachments)
        } else {
            let raw = String::from_utf8(raw_bytes)
                .map_err(|e| format!("backup file is not valid UTF-8 JSON: {e}"))?;
            let parsed = serde_json::from_str::<serde_json::Value>(strip_utf8_bom(&raw))
                .map_err(|e| format!("invalid backup JSON: {e}"))?;
            (parsed, BTreeMap::new())
        };

        // Determine whether data section is present.
        let imported_data_opt: Option<AppData> =
            if let Some(d) = value.get("data").filter(|v| !v.is_null()) {
                Some(
                    serde_json::from_value(d.clone())
                        .map_err(|e| format!("invalid data section: {e}"))?,
                )
            } else if value.get("todos").is_some() || value.get("notes").is_some() {
                Some(
                    serde_json::from_value(value.clone())
                        .map_err(|e| format!("invalid backup format: {e}"))?,
                )
            } else {
                None
            };

        // Extract optional device settings while preserving this machine's custom_data_dir.
        let imported_device_opt: Option<DeviceSettings> = value
            .get("device")
            .filter(|v| !v.is_null())
            .or_else(|| value.get("settings").filter(|v| v.is_object() && v.get("dockMode").is_some()))
            .and_then(|v| serde_json::from_value::<DeviceSettings>(v.clone()).ok())
            .map(|mut dev| {
                let current_local = self.load_device_settings();
                dev.custom_data_dir = current_local.custom_data_dir;
                dev
            });

        if imported_data_opt.is_none() && imported_device_opt.is_none() {
            return Err("backup file contains neither data nor settings".to_string());
        }

        // Restore embedded attachments from ZIP or JSON map.
        for (rel_path, raw) in zip_attachments {
            if let Ok(abs) = self.resolve_attachment_path(&rel_path) {
                write_atomic(&abs, &raw)?;
            }
        }
        if let Some(att_map) = value.get("attachments").and_then(|v| v.as_object()) {
            for (rel_path, b64_val) in att_map {
                let norm = rel_path.replace('\\', "/");
                if !norm.starts_with(&format!("{ATTACHMENTS_DIR_NAME}/"))
                    || norm.contains("..")
                    || norm.contains(':')
                {
                    continue;
                }
                if let Some(b64_str) = b64_val.as_str() {
                    if let Ok(decoded) =
                        base64::engine::general_purpose::STANDARD.decode(b64_str.trim())
                    {
                        if let Ok(abs) = self.resolve_attachment_path(&norm) {
                            write_atomic(&abs, &decoded)?;
                        }
                    }
                }
            }
        }

        let final_data = if let Some(data) = imported_data_opt {
            self.save_app_data(data.clone())?;
            data
        } else {
            self.load_app_data()
        };

        if let Some(ref dev) = imported_device_opt {
            self.save_device_settings(dev)?;
        }

        let imported_todos = final_data
            .todos
            .iter()
            .filter(|t| t.deleted_at.is_none())
            .count();
        let imported_notes = final_data
            .notes
            .iter()
            .filter(|n| n.deleted_at.is_none())
            .count();

        Ok(ImportBackupResult {
            data: final_data,
            device: imported_device_opt,
            imported_todos,
            imported_notes,
        })
    }

    pub fn export_document(
        &self,
        request: ExportDocumentRequest,
    ) -> Result<ExportDocumentResult, String> {
        let data = self.load_app_data();
        let (todos, notes, title) = filter_export_items(&data, &request.scope, request.note_id.as_deref());

        let ext = match request.format {
            ExportDocFormat::Markdown => "md",
            ExportDocFormat::Html => "html",
            ExportDocFormat::Docx => "docx",
            ExportDocFormat::Pdf => "pdf",
        };
        let target = request
            .target_path
            .filter(|p| !p.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                self.active_dir().join(EXPORTS_DIR_NAME).join(format!(
                    "desktag-export-{}.{ext}",
                    Utc::now().format("%Y%m%d-%H%M%S")
                ))
            });

        let bytes = match request.format {
            ExportDocFormat::Markdown => {
                build_markdown_export(&title, &data, &todos, &notes).into_bytes()
            }
            ExportDocFormat::Html => {
                self.build_html_export(&title, &data, &todos, &notes).into_bytes()
            }
            ExportDocFormat::Docx => self.build_docx_export(&title, &data, &todos, &notes)?,
            ExportDocFormat::Pdf => build_pdf_export(&title, &data, &todos, &notes),
        };

        write_atomic(&target, &bytes)?;
        Ok(ExportDocumentResult {
            path: target.to_string_lossy().to_string(),
            format: request.format,
            bytes: bytes.len() as u64,
        })
    }

    /// Build a UTF-8 CSV export string (with Excel-friendly BOM) for todos in a scope.
    pub fn export_csv_string(&self, scope: &str) -> String {
        let data = self.load_app_data();
        let (todos, _, _) = filter_export_items(&data, scope, None);
        let list_map: BTreeMap<&str, &str> = data
            .lists
            .iter()
            .filter(|l| l.deleted_at.is_none())
            .map(|l| (l.id.as_str(), l.name.as_str()))
            .collect();

        let mut out = String::from("\u{feff}ID,标题,状态,优先级,截止日期,时间,清单,标签,子任务完成,备注\r\n");
        for todo in todos {
            let status = if todo.completed { "已完成" } else { "未完成" };
            let priority = priority_label(todo.priority);
            let list_name = todo
                .list_id
                .as_deref()
                .and_then(|id| list_map.get(id).copied())
                .unwrap_or("");
            let tags = todo.tags.join(";");
            let sub_done = todo.subtasks.iter().filter(|s| s.completed).count();
            let sub_summary = if todo.subtasks.is_empty() {
                String::new()
            } else {
                format!("{sub_done}/{}", todo.subtasks.len())
            };
            let row = [
                csv_escape(&todo.id),
                csv_escape(&todo.title),
                csv_escape(status),
                csv_escape(priority),
                csv_escape(todo.due_date.as_deref().unwrap_or("")),
                csv_escape(todo.due_time.as_deref().unwrap_or("")),
                csv_escape(list_name),
                csv_escape(&tags),
                csv_escape(&sub_summary),
                csv_escape(&todo.notes),
            ];
            out.push_str(&row.join(","));
            out.push_str("\r\n");
        }
        out
    }

    fn collect_backup_attachments(&self, data: &AppData) -> BTreeMap<String, Vec<u8>> {
        let mut seen = HashSet::<String>::new();
        let mut out = BTreeMap::<String, Vec<u8>>::new();

        let mut try_add = |rel: &str| {
            let norm = rel.replace('\\', "/");
            if !seen.insert(norm.clone()) {
                return;
            }
            if let Ok(abs) = self.resolve_attachment_path(&norm) {
                if let Ok(bytes) = fs::read(&abs) {
                    out.insert(norm, bytes);
                }
            }
        };

        for todo in &data.todos {
            for att in &todo.note_images {
                try_add(&att.relative_path);
            }
            for sub in &todo.subtasks {
                for att in &sub.note_images {
                    try_add(&att.relative_path);
                }
            }
        }
        for note in &data.notes {
            for att in &note.attachments {
                try_add(&att.relative_path);
            }
            for entry in &note.timeline_entries {
                for att in &entry.attachments {
                    try_add(&att.relative_path);
                }
            }
        }

        // Also include any files present inside attachments/ directory so nothing is orphaned.
        let att_dir = self.attachments_dir();
        if let Ok(entries) = fs::read_dir(&att_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    if let Some(fname) = p.file_name().and_then(|n| n.to_str()) {
                        let rel = format!("{ATTACHMENTS_DIR_NAME}/{fname}");
                        try_add(&rel);
                    }
                }
            }
        }

        out
    }

    fn build_html_export(
        &self,
        title: &str,
        data: &AppData,
        todos: &[&TodoItem],
        notes: &[&NoteItem],
    ) -> String {
        let list_map: BTreeMap<&str, &str> = data
            .lists
            .iter()
            .filter(|l| l.deleted_at.is_none())
            .map(|l| (l.id.as_str(), l.name.as_str()))
            .collect();

        let mut html = String::with_capacity(8192);
        html.push_str("<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\" />\n");
        html.push_str("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n");
        html.push_str(&format!("<title>{}</title>\n", html_escape(title)));
        html.push_str(
            r#"<style>
:root { --paper:#fbfaf7; --card:#ffffff; --header:#f6f5ee; --border:#e3e3d8; --accent:#e8734a; --ink:#332f2c; --muted:#7c756c; }
* { box-sizing:border-box; }
body { margin:0; padding:32px 20px; background:var(--paper); color:var(--ink); font-family:'Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif; line-height:1.65; }
.wrap { max-width:820px; margin:0 auto; background:var(--card); border:1px solid var(--border); border-radius:14px; overflow:hidden; box-shadow:0 8px 28px rgba(58,46,35,.06); }
header { background:var(--header); border-bottom:1px solid var(--border); padding:22px 28px; display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px; }
header h1 { margin:0; font-size:20px; color:var(--ink); }
header .meta { font-size:12px; color:var(--muted); }
main { padding:24px 28px 32px; }
h2 { margin:24px 0 12px; font-size:16px; color:var(--accent); border-bottom:1px solid var(--border); padding-bottom:6px; }
h2:first-child { margin-top:0; }
.todo { padding:10px 12px; border:1px solid var(--border); border-radius:10px; margin-bottom:10px; background:#fffdfa; }
.todo.done { opacity:0.65; }
.todo-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.chk { display:inline-flex; width:17px; height:17px; border-radius:50%; border:1.5px solid #b8afa3; align-items:center; justify-content:center; font-size:11px; flex:none; }
.todo.done .chk { background:var(--accent); border-color:var(--accent); color:#fff; }
.dot { width:8px; height:8px; border-radius:50%; display:inline-block; flex:none; }
.dot.high { background:#e05552; } .dot.medium { background:#d4a741; } .dot.low { background:#699863; }
.title { font-weight:600; font-size:14.5px; }
.due { margin-left:auto; font-size:12px; color:var(--muted); }
.chips { margin:6px 0 0 26px; display:flex; gap:6px; flex-wrap:wrap; }
.chip { font-size:11.5px; padding:1px 8px; border-radius:999px; background:#f7e4dd; color:#8b4228; }
.notes { margin:8px 0 0 26px; font-size:13.5px; color:#524b44; white-space:pre-wrap; }
.subtasks { margin:8px 0 0 26px; padding-left:12px; border-left:2px solid var(--border); }
.sub { margin:6px 0; font-size:13.5px; }
.imgs { margin:8px 0 0 26px; display:flex; flex-wrap:wrap; gap:8px; }
.imgs img { max-width:100%; max-height:360px; border-radius:8px; border:1px solid var(--border); }
.note-card { padding:16px 18px; border:1px solid var(--border); border-radius:10px; margin-bottom:14px; background:#fffdfa; }
.note-title { font-size:16px; font-weight:700; margin:0 0 8px; }
.note-body { font-size:14px; white-space:pre-wrap; }
.tl-entry { padding:8px 0 8px 12px; border-left:2px solid var(--accent); margin:8px 0; }
.tl-time { font-size:11.5px; color:var(--muted); margin-bottom:2px; }
@media print { body { background:#fff; padding:0; } .wrap { border:none; box-shadow:none; max-width:none; } }
</style>
</head>
<body>
<div class="wrap">
"#,
        );

        let now_str = Local::now().format("%Y-%m-%d %H:%M").to_string();
        html.push_str(&format!(
            "<header><h1>{}</h1><span class=\"meta\">DeskTag 待办贴 · 导出于 {}</span></header>\n<main>\n",
            html_escape(title),
            html_escape(&now_str)
        ));

        if !todos.is_empty() {
            html.push_str(&format!("<h2>待办事项 ({})</h2>\n", todos.len()));
            for todo in todos {
                let done_cls = if todo.completed { " done" } else { "" };
                html.push_str(&format!("<div class=\"todo{done_cls}\">\n<div class=\"todo-head\">"));
                html.push_str(&format!(
                    "<span class=\"chk\">{}</span>",
                    if todo.completed { "✓" } else { "" }
                ));
                match todo.priority {
                    TodoPriority::High => html.push_str("<span class=\"dot high\"></span>"),
                    TodoPriority::Medium => html.push_str("<span class=\"dot medium\"></span>"),
                    TodoPriority::Low => html.push_str("<span class=\"dot low\"></span>"),
                    TodoPriority::None => {}
                }
                html.push_str(&format!("<span class=\"title\">{}</span>", html_escape(&todo.title)));
                if let Some(due_label) = format_todo_due(todo) {
                    html.push_str(&format!("<span class=\"due\">{}</span>", html_escape(&due_label)));
                }
                html.push_str("</div>\n");

                let list_name = todo
                    .list_id
                    .as_deref()
                    .and_then(|id| list_map.get(id).copied());
                if list_name.is_some() || !todo.tags.is_empty() {
                    html.push_str("<div class=\"chips\">");
                    if let Some(ln) = list_name {
                        html.push_str(&format!("<span class=\"chip\">{}</span>", html_escape(ln)));
                    }
                    for tag in &todo.tags {
                        html.push_str(&format!("<span class=\"chip\">#{}</span>", html_escape(tag)));
                    }
                    html.push_str("</div>\n");
                }

                if !todo.notes.trim().is_empty() {
                    html.push_str(&format!("<div class=\"notes\">{}</div>\n", html_escape(&todo.notes)));
                }

                self.append_html_images(&mut html, &todo.note_images);

                if !todo.subtasks.is_empty() {
                    html.push_str("<div class=\"subtasks\">\n");
                    for sub in &todo.subtasks {
                        let mark = if sub.completed { "✓" } else { "○" };
                        html.push_str(&format!(
                            "<div class=\"sub\">{mark} {}",
                            html_escape(&sub.title)
                        ));
                        if !sub.notes.trim().is_empty() {
                            html.push_str(&format!(
                                "<div class=\"notes\" style=\"margin-left:16px;\">{}</div>",
                                html_escape(&sub.notes)
                            ));
                        }
                        self.append_html_images(&mut html, &sub.note_images);
                        html.push_str("</div>\n");
                    }
                    html.push_str("</div>\n");
                }
                html.push_str("</div>\n");
            }
        }

        if !notes.is_empty() {
            html.push_str(&format!("<h2>便签 ({})</h2>\n", notes.len()));
            for note in notes {
                html.push_str("<div class=\"note-card\">\n");
                let kind_badge = match note.kind {
                    NoteKind::Normal => "普通便签",
                    NoteKind::Timeline => "时间轴便签",
                };
                html.push_str(&format!(
                    "<div class=\"note-title\">{} <span class=\"chip\" style=\"font-weight:400;\">{kind_badge}</span></div>\n",
                    html_escape(&note.title)
                ));
                match note.kind {
                    NoteKind::Normal => {
                        if !note.content.trim().is_empty() {
                            html.push_str(&format!(
                                "<div class=\"note-body\">{}</div>\n",
                                html_escape(&note.content)
                            ));
                        }
                        self.append_html_images(&mut html, &note.attachments);
                    }
                    NoteKind::Timeline => {
                        for entry in &note.timeline_entries {
                            html.push_str("<div class=\"tl-entry\">");
                            html.push_str(&format!(
                                "<div class=\"tl-time\">{}</div>",
                                html_escape(&entry.created_at)
                            ));
                            html.push_str(&format!(
                                "<div class=\"note-body\">{}</div>",
                                html_escape(&entry.content)
                            ));
                            self.append_html_images(&mut html, &entry.attachments);
                            html.push_str("</div>\n");
                        }
                    }
                }
                html.push_str("</div>\n");
            }
        }

        if todos.is_empty() && notes.is_empty() {
            html.push_str("<p style=\"color:var(--muted);\">当前导出范围内暂无待办或便签。</p>\n");
        }

        html.push_str("</main>\n</div>\n</body>\n</html>\n");
        html
    }

    fn append_html_images(&self, html: &mut String, attachments: &[AttachmentRef]) {
        let mut imgs = Vec::new();
        for att in attachments {
            if att.kind == AttachmentKind::Image || att.mime.starts_with("image/") {
                if let Ok(data_url) =
                    self.read_attachment_data_url(&att.relative_path, Some(&att.mime))
                {
                    imgs.push((att.name.as_str(), data_url));
                }
            }
        }
        if !imgs.is_empty() {
            html.push_str("<div class=\"imgs\">");
            for (name, url) in imgs {
                html.push_str(&format!(
                    "<img src=\"{url}\" alt=\"{}\" />",
                    html_escape(name)
                ));
            }
            html.push_str("</div>\n");
        }
    }

    fn build_docx_export(
        &self,
        title: &str,
        data: &AppData,
        todos: &[&TodoItem],
        notes: &[&NoteItem],
    ) -> Result<Vec<u8>, String> {
        let list_map: BTreeMap<&str, &str> = data
            .lists
            .iter()
            .filter(|l| l.deleted_at.is_none())
            .map(|l| (l.id.as_str(), l.name.as_str()))
            .collect();

        // Track embedded media for inline images.
        struct MediaEntry {
            rel_id: String,
            file_name: String,
            bytes: Vec<u8>,
        }
        let mut media: Vec<MediaEntry> = Vec::new();
        let mut ext_set: HashSet<String> = HashSet::new();

        let mut try_embed_image = |att: &AttachmentRef| -> Option<(String, u32, String)> {
            if att.kind != AttachmentKind::Image && !att.mime.starts_with("image/") {
                return None;
            }
            let abs = self.resolve_attachment_path(&att.relative_path).ok()?;
            let bytes = fs::read(&abs).ok()?;
            let ext = image_ext_from_mime(&att.mime, &att.name);
            let idx = media.len() + 1;
            let rel_id = format!("rIdImg{idx}");
            let file_name = format!("image{idx}.{ext}");
            let doc_pr_id = (idx + 10) as u32;
            ext_set.insert(ext);
            media.push(MediaEntry {
                rel_id: rel_id.clone(),
                file_name,
                bytes,
            });
            Some((rel_id, doc_pr_id, att.name.clone()))
        };

        let mut body = String::with_capacity(8192);
        body.push_str(&docx_paragraph(title, Some("Heading1"), false));
        body.push_str(&docx_paragraph(
            &format!(
                "DeskTag 待办贴 · 导出于 {}",
                Local::now().format("%Y-%m-%d %H:%M")
            ),
            None,
            true,
        ));

        if !todos.is_empty() {
            body.push_str(&docx_paragraph(
                &format!("待办事项 ({})", todos.len()),
                Some("Heading2"),
                false,
            ));
            for (idx, todo) in todos.iter().enumerate() {
                let chk = if todo.completed { "☑" } else { "☐" };
                let pri = priority_badge(todo.priority);
                let due = format_todo_due(todo)
                    .map(|d| format!("  [{d}]"))
                    .unwrap_or_default();
                let list_tag = todo
                    .list_id
                    .as_deref()
                    .and_then(|id| list_map.get(id).copied())
                    .map(|l| format!("  ({l})"))
                    .unwrap_or_default();
                let tags = if todo.tags.is_empty() {
                    String::new()
                } else {
                    format!(
                        "  {}",
                        todo.tags
                            .iter()
                            .map(|t| format!("#{t}"))
                            .collect::<Vec<_>>()
                            .join(" ")
                    )
                };
                let line = format!("{chk} {}. {pri}{}{due}{list_tag}{tags}", idx + 1, todo.title);
                body.push_str(&docx_paragraph(&line, None, false));

                if !todo.notes.trim().is_empty() {
                    for nl in todo.notes.lines() {
                        body.push_str(&docx_paragraph(&format!("    {nl}"), None, true));
                    }
                }
                for att in &todo.note_images {
                    if let Some((rid, pid, name)) = try_embed_image(att) {
                        body.push_str(&docx_image_paragraph(&rid, pid, &name));
                    }
                }
                for (sidx, sub) in todo.subtasks.iter().enumerate() {
                    let schk = if sub.completed { "☑" } else { "☐" };
                    body.push_str(&docx_paragraph(
                        &format!("    {schk} {}.{} {}", idx + 1, sidx + 1, sub.title),
                        None,
                        false,
                    ));
                    if !sub.notes.trim().is_empty() {
                        for nl in sub.notes.lines() {
                            body.push_str(&docx_paragraph(&format!("        {nl}"), None, true));
                        }
                    }
                    for att in &sub.note_images {
                        if let Some((rid, pid, name)) = try_embed_image(att) {
                            body.push_str(&docx_image_paragraph(&rid, pid, &name));
                        }
                    }
                }
            }
        }

        if !notes.is_empty() {
            body.push_str(&docx_paragraph(
                &format!("便签 ({})", notes.len()),
                Some("Heading2"),
                false,
            ));
            for note in notes {
                let kind_lbl = match note.kind {
                    NoteKind::Normal => "普通便签",
                    NoteKind::Timeline => "时间轴便签",
                };
                body.push_str(&docx_paragraph(
                    &format!("{} ({kind_lbl})", note.title),
                    Some("Heading2"),
                    false,
                ));
                match note.kind {
                    NoteKind::Normal => {
                        for line in note.content.lines() {
                            body.push_str(&docx_paragraph(line, None, false));
                        }
                        for att in &note.attachments {
                            if let Some((rid, pid, name)) = try_embed_image(att) {
                                body.push_str(&docx_image_paragraph(&rid, pid, &name));
                            } else {
                                body.push_str(&docx_paragraph(
                                    &format!("[附件: {} ({} B)]", att.name, att.size),
                                    None,
                                    true,
                                ));
                            }
                        }
                    }
                    NoteKind::Timeline => {
                        for entry in &note.timeline_entries {
                            body.push_str(&docx_paragraph(
                                &format!("[{}]", entry.created_at),
                                None,
                                true,
                            ));
                            for line in entry.content.lines() {
                                body.push_str(&docx_paragraph(line, None, false));
                            }
                            for att in &entry.attachments {
                                if let Some((rid, pid, name)) = try_embed_image(att) {
                                    body.push_str(&docx_image_paragraph(&rid, pid, &name));
                                }
                            }
                        }
                    }
                }
            }
        }

        if todos.is_empty() && notes.is_empty() {
            body.push_str(&docx_paragraph("当前导出范围内暂无待办或便签。", None, true));
        }

        let document_xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>
{body}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body>
</w:document>"#
        );

        let mut img_content_types = String::new();
        for ext in &ext_set {
            let mime = match ext.as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                _ => "application/octet-stream",
            };
            img_content_types.push_str(&format!(
                "<Default Extension=\"{ext}\" ContentType=\"{mime}\"/>\n"
            ));
        }

        let content_types_xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
{img_content_types}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"#
        );

        let root_rels_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;

        let mut doc_rels = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
"#,
        );
        for m in &media {
            doc_rels.push_str(&format!(
                "<Relationship Id=\"{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/{}\"/>\n",
                m.rel_id, m.file_name
            ));
        }
        doc_rels.push_str("</Relationships>");

        let styles_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/><w:color w:val="332F2C"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="120" w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/><w:color w:val="E8734A"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:before="220" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="5B4A3F"/></w:rPr></w:style>
</w:styles>"#;

        let mut buf = Cursor::new(Vec::<u8>::new());
        {
            let mut zip = ZipWriter::new(&mut buf);
            let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            for (name, content) in [
                ("[Content_Types].xml", content_types_xml.as_bytes()),
                ("_rels/.rels", root_rels_xml.as_bytes()),
                ("word/_rels/document.xml.rels", doc_rels.as_bytes()),
                ("word/styles.xml", styles_xml.as_bytes()),
                ("word/document.xml", document_xml.as_bytes()),
            ] {
                zip.start_file(name, opts)
                    .map_err(|e| format!("failed to write docx entry {name}: {e}"))?;
                zip.write_all(content)
                    .map_err(|e| format!("failed to write docx data {name}: {e}"))?;
            }
            for m in &media {
                let path = format!("word/media/{}", m.file_name);
                zip.start_file(&path, opts)
                    .map_err(|e| format!("failed to add docx media {path}: {e}"))?;
                zip.write_all(&m.bytes)
                    .map_err(|e| format!("failed to write docx media {path}: {e}"))?;
            }
            zip.finish()
                .map_err(|e| format!("failed to finalize docx archive: {e}"))?;
        }
        Ok(buf.into_inner())
    }
}

fn strip_utf8_bom(s: &str) -> &str {
    s.strip_prefix('\u{feff}').unwrap_or(s)
}

fn copy_dir_recursive(src: &Path, dst: &Path, private: bool) -> Result<(), String> {
    if private {
        ensure_private_dir(dst)?;
    } else {
        fs::create_dir_all(dst).map_err(|e| format!("failed to create directory: {e}"))?;
    }
    let entries = fs::read_dir(src).map_err(|e| format!("failed to read directory: {e}"))?;
    for entry in entries.flatten() {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to, private)?;
        } else if from.is_file() {
            let bytes = fs::read(&from).map_err(|e| format!("failed to read file: {e}"))?;
            if private {
                write_atomic_private(&to, &bytes)?;
            } else {
                write_atomic(&to, &bytes)?;
            }
        }
    }
    Ok(())
}

fn filter_export_items<'a>(
    data: &'a AppData,
    scope: &str,
    note_id: Option<&str>,
) -> (Vec<&'a TodoItem>, Vec<&'a NoteItem>, String) {
    if let Some(nid) = note_id.filter(|s| !s.trim().is_empty()) {
        let notes: Vec<&NoteItem> = data
            .notes
            .iter()
            .filter(|n| n.deleted_at.is_none() && n.id == nid)
            .collect();
        let title = notes
            .first()
            .map(|n| n.title.clone())
            .unwrap_or_else(|| "DeskTag 便签导出".to_string());
        return (Vec::new(), notes, title);
    }

    let today = Local::now().date_naive();
    let active_todos: Vec<&TodoItem> = data
        .todos
        .iter()
        .filter(|t| t.deleted_at.is_none())
        .collect();
    let active_notes: Vec<&NoteItem> = data
        .notes
        .iter()
        .filter(|n| n.deleted_at.is_none())
        .collect();

    let scope_norm = scope.trim();
    if scope_norm.eq_ignore_ascii_case("notes") {
        return (Vec::new(), active_notes, "DeskTag 便签导出".to_string());
    }
    if scope_norm.eq_ignore_ascii_case("todos") {
        return (active_todos, Vec::new(), "DeskTag 待办导出".to_string());
    }
    if scope_norm.eq_ignore_ascii_case("today") {
        let filtered = active_todos
            .into_iter()
            .filter(|t| todo_in_date_range(t, today, today))
            .collect();
        return (filtered, Vec::new(), format!("DeskTag 今日待办 ({today})"));
    }
    if scope_norm.eq_ignore_ascii_case("week") {
        let offset = today.weekday().num_days_from_monday() as i64;
        let start = today - chrono::Duration::days(offset);
        let end = start + chrono::Duration::days(6);
        let filtered = active_todos
            .into_iter()
            .filter(|t| todo_in_date_range(t, start, end))
            .collect();
        return (
            filtered,
            Vec::new(),
            format!("DeskTag 本周待办 ({start} ~ {end})"),
        );
    }
    if scope_norm.eq_ignore_ascii_case("month") {
        let start = NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap_or(today);
        let next_month = if today.month() == 12 {
            NaiveDate::from_ymd_opt(today.year() + 1, 1, 1)
        } else {
            NaiveDate::from_ymd_opt(today.year(), today.month() + 1, 1)
        }
        .unwrap_or(today);
        let end = next_month - chrono::Duration::days(1);
        let filtered = active_todos
            .into_iter()
            .filter(|t| todo_in_date_range(t, start, end))
            .collect();
        return (
            filtered,
            Vec::new(),
            format!("DeskTag 本月待办 ({}-{:02})", today.year(), today.month()),
        );
    }
    if scope_norm.eq_ignore_ascii_case("unscheduled") {
        let filtered = active_todos
            .into_iter()
            .filter(|t| t.due_date.as_deref().map(str::trim).unwrap_or("").is_empty())
            .collect();
        return (filtered, Vec::new(), "DeskTag 待安排待办".to_string());
    }
    if let Some(list_id) = scope_norm.strip_prefix("list:") {
        let list_name = data
            .lists
            .iter()
            .find(|l| l.id == list_id && l.deleted_at.is_none())
            .map(|l| l.name.clone())
            .unwrap_or_else(|| list_id.to_string());
        let filtered = active_todos
            .into_iter()
            .filter(|t| t.list_id.as_deref() == Some(list_id))
            .collect();
        return (filtered, Vec::new(), format!("DeskTag 清单：{list_name}"));
    }

    (active_todos, active_notes, "DeskTag 全部待办与便签".to_string())
}

fn todo_in_date_range(todo: &TodoItem, range_start: NaiveDate, range_end: NaiveDate) -> bool {
    let Some(start_str) = todo.due_date.as_deref() else {
        return false;
    };
    let Ok(start) = NaiveDate::parse_from_str(start_str.trim(), "%Y-%m-%d") else {
        return false;
    };
    let end = todo
        .end_date
        .as_deref()
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok())
        .unwrap_or(start);
    start <= range_end && end >= range_start
}

fn priority_label(p: TodoPriority) -> &'static str {
    match p {
        TodoPriority::High => "高",
        TodoPriority::Medium => "中",
        TodoPriority::Low => "低",
        TodoPriority::None => "无",
    }
}

fn priority_badge(p: TodoPriority) -> &'static str {
    match p {
        TodoPriority::High => "[高] ",
        TodoPriority::Medium => "[中] ",
        TodoPriority::Low => "[低] ",
        TodoPriority::None => "",
    }
}

fn format_todo_due(todo: &TodoItem) -> Option<String> {
    match (&todo.due_date, &todo.due_time, &todo.end_date) {
        (Some(d), Some(t), Some(e)) if e != d => Some(format!("{d} ~ {e} {t}")),
        (Some(d), Some(t), _) => Some(format!("{d} {t}")),
        (Some(d), None, Some(e)) if e != d => Some(format!("{d} ~ {e}")),
        (Some(d), None, _) => Some(d.clone()),
        (None, Some(t), _) => Some(t.clone()),
        _ => None,
    }
}

fn build_markdown_export(
    title: &str,
    data: &AppData,
    todos: &[&TodoItem],
    notes: &[&NoteItem],
) -> String {
    let list_map: BTreeMap<&str, &str> = data
        .lists
        .iter()
        .filter(|l| l.deleted_at.is_none())
        .map(|l| (l.id.as_str(), l.name.as_str()))
        .collect();

    let mut md = String::with_capacity(4096);
    md.push_str(&format!("# {title}\n\n"));
    md.push_str(&format!(
        "> DeskTag 待办贴 · 导出于 {}\n\n",
        Local::now().format("%Y-%m-%d %H:%M")
    ));

    if !todos.is_empty() {
        md.push_str(&format!("## 待办事项 ({})\n\n", todos.len()));
        for todo in todos {
            let chk = if todo.completed { "x" } else { " " };
            let pri = priority_badge(todo.priority);
            let due = format_todo_due(todo)
                .map(|d| format!(" — `{d}`"))
                .unwrap_or_default();
            let list_tag = todo
                .list_id
                .as_deref()
                .and_then(|id| list_map.get(id).copied())
                .map(|l| format!(" `[{l}]`"))
                .unwrap_or_default();
            let tags = if todo.tags.is_empty() {
                String::new()
            } else {
                format!(
                    " {}",
                    todo.tags
                        .iter()
                        .map(|t| format!("#{t}"))
                        .collect::<Vec<_>>()
                        .join(" ")
                )
            };
            md.push_str(&format!("- [{chk}] {pri}{}{due}{list_tag}{tags}\n", todo.title));
            if !todo.notes.trim().is_empty() {
                for line in todo.notes.lines() {
                    md.push_str(&format!("  > {line}\n"));
                }
            }
            for img in &todo.note_images {
                md.push_str(&format!("  - 🖼 `{}` ({})\n", img.name, img.relative_path));
            }
            for sub in &todo.subtasks {
                let schk = if sub.completed { "x" } else { " " };
                md.push_str(&format!("  - [{schk}] {}\n", sub.title));
                if !sub.notes.trim().is_empty() {
                    for line in sub.notes.lines() {
                        md.push_str(&format!("    > {line}\n"));
                    }
                }
            }
        }
        md.push('\n');
    }

    if !notes.is_empty() {
        md.push_str(&format!("## 便签 ({})\n\n", notes.len()));
        for note in notes {
            let kind_lbl = match note.kind {
                NoteKind::Normal => "普通便签",
                NoteKind::Timeline => "时间轴便签",
            };
            md.push_str(&format!("### {} ({kind_lbl})\n\n", note.title));
            match note.kind {
                NoteKind::Normal => {
                    if !note.content.trim().is_empty() {
                        md.push_str(&note.content);
                        md.push_str("\n\n");
                    }
                    for att in &note.attachments {
                        md.push_str(&format!("- 附件: `{}` ({} B)\n", att.name, att.size));
                    }
                    if !note.attachments.is_empty() {
                        md.push('\n');
                    }
                }
                NoteKind::Timeline => {
                    for entry in &note.timeline_entries {
                        md.push_str(&format!("- **{}**\n", entry.created_at));
                        for line in entry.content.lines() {
                            md.push_str(&format!("  {line}\n"));
                        }
                    }
                    md.push('\n');
                }
            }
        }
    }

    if todos.is_empty() && notes.is_empty() {
        md.push_str("_当前导出范围内暂无待办或便签。_\n");
    }

    md
}

/// Build a valid pure-Rust PDF 1.4 document with multi-page layout and CJK + ASCII support
/// via Type0 CIDFont (`STSong-Light` + `/Encoding /UniGB-UCS2-H`).
fn build_pdf_export(
    title: &str,
    data: &AppData,
    todos: &[&TodoItem],
    notes: &[&NoteItem],
) -> Vec<u8> {
    let list_map: BTreeMap<&str, &str> = data
        .lists
        .iter()
        .filter(|l| l.deleted_at.is_none())
        .map(|l| (l.id.as_str(), l.name.as_str()))
        .collect();

    #[derive(Clone)]
    struct PdfLine {
        text: String,
        size: f32,
        indent: f32,
        accent: bool,
        muted: bool,
        space_before: f32,
    }

    let mut lines: Vec<PdfLine> = Vec::new();
    let push_wrapped = |out: &mut Vec<PdfLine>,
                        text: &str,
                        size: f32,
                        indent: f32,
                        accent: bool,
                        muted: bool,
                        space_before: f32| {
        let usable_width = 495.0 - indent;
        // Estimate average glyph advance (~0.95*size for CJK, ~0.55*size for ASCII).
        for (p_idx, raw_line) in text.split('\n').enumerate() {
            let mut cur = String::new();
            let mut cur_w = 0.0f32;
            let mut first = true;
            for ch in raw_line.chars() {
                if ch == '\r' {
                    continue;
                }
                let ch_w = if ch.is_ascii() { size * 0.56 } else { size * 1.0 };
                if !cur.is_empty() && cur_w + ch_w > usable_width {
                    out.push(PdfLine {
                        text: std::mem::take(&mut cur),
                        size,
                        indent,
                        accent,
                        muted,
                        space_before: if p_idx == 0 && first {
                            space_before
                        } else {
                            0.0
                        },
                    });
                    cur_w = 0.0;
                    first = false;
                }
                cur.push(ch);
                cur_w += ch_w;
            }
            out.push(PdfLine {
                text: cur,
                size,
                indent,
                accent,
                muted,
                space_before: if p_idx == 0 && first {
                    space_before
                } else {
                    0.0
                },
            });
        }
    };

    push_wrapped(&mut lines, title, 18.0, 0.0, true, false, 0.0);
    push_wrapped(
        &mut lines,
        &format!(
            "DeskTag 待办贴 · 导出于 {}",
            Local::now().format("%Y-%m-%d %H:%M")
        ),
        9.5,
        0.0,
        false,
        true,
        4.0,
    );

    if !todos.is_empty() {
        push_wrapped(
            &mut lines,
            &format!("待办事项 ({})", todos.len()),
            13.5,
            0.0,
            true,
            false,
            14.0,
        );
        for (idx, todo) in todos.iter().enumerate() {
            let chk = if todo.completed { "[x]" } else { "[ ]" };
            let pri = priority_badge(todo.priority);
            let due = format_todo_due(todo)
                .map(|d| format!(" ({d})"))
                .unwrap_or_default();
            let list_tag = todo
                .list_id
                .as_deref()
                .and_then(|id| list_map.get(id).copied())
                .map(|l| format!(" [{l}]"))
                .unwrap_or_default();
            let tags = if todo.tags.is_empty() {
                String::new()
            } else {
                format!(
                    " {}",
                    todo.tags
                        .iter()
                        .map(|t| format!("#{t}"))
                        .collect::<Vec<_>>()
                        .join(" ")
                )
            };
            push_wrapped(
                &mut lines,
                &format!("{chk} {}. {pri}{}{due}{list_tag}{tags}", idx + 1, todo.title),
                11.0,
                0.0,
                false,
                todo.completed,
                6.0,
            );
            if !todo.notes.trim().is_empty() {
                push_wrapped(&mut lines, &todo.notes, 9.5, 18.0, false, true, 2.0);
            }
            for (sidx, sub) in todo.subtasks.iter().enumerate() {
                let schk = if sub.completed { "[x]" } else { "[ ]" };
                push_wrapped(
                    &mut lines,
                    &format!("{schk} {}.{} {}", idx + 1, sidx + 1, sub.title),
                    10.0,
                    18.0,
                    false,
                    sub.completed,
                    2.0,
                );
            }
        }
    }

    if !notes.is_empty() {
        push_wrapped(
            &mut lines,
            &format!("便签 ({})", notes.len()),
            13.5,
            0.0,
            true,
            false,
            16.0,
        );
        for note in notes {
            push_wrapped(&mut lines, &note.title, 12.0, 0.0, false, false, 10.0);
            match note.kind {
                NoteKind::Normal => {
                    if !note.content.trim().is_empty() {
                        push_wrapped(&mut lines, &note.content, 10.0, 8.0, false, false, 3.0);
                    }
                }
                NoteKind::Timeline => {
                    for entry in &note.timeline_entries {
                        push_wrapped(
                            &mut lines,
                            &format!("{}  {}", entry.created_at, entry.content),
                            10.0,
                            8.0,
                            false,
                            false,
                            3.0,
                        );
                    }
                }
            }
        }
    }

    if todos.is_empty() && notes.is_empty() {
        push_wrapped(
            &mut lines,
            "当前导出范围内暂无待办或便签。",
            11.0,
            0.0,
            false,
            true,
            12.0,
        );
    }

    // Paginate onto A4 pages (595 x 842 pt, margins 50pt).
    let mut pages: Vec<String> = Vec::new();
    let mut cur_stream = String::new();
    let mut y = 785.0f32;
    let margin_x = 50.0f32;
    let min_y = 56.0f32;

    // Warm subtle accent rule under page 1 header.
    cur_stream.push_str("0.91 0.45 0.29 RG 1.2 w 50 755 m 545 755 l S\n");

    for line in &lines {
        let leading = line.size * 1.48;
        if y - line.space_before - leading < min_y {
            pages.push(std::mem::take(&mut cur_stream));
            y = 785.0;
        }
        y -= line.space_before;
        if !line.text.is_empty() {
            let color = if line.accent {
                "0.91 0.45 0.29 rg"
            } else if line.muted {
                "0.48 0.45 0.42 rg"
            } else {
                "0.20 0.18 0.17 rg"
            };
            let hex = utf16be_hex(&line.text);
            cur_stream.push_str(&format!(
                "BT {color} /F1 {:.1} Tf {:.1} {:.1} Td <{hex}> Tj ET\n",
                line.size,
                margin_x + line.indent,
                y
            ));
        }
        y -= leading;
    }
    pages.push(cur_stream);

    // Assemble PDF objects:
    // 1: Catalog, 2: Pages, 3: Type0 Font (STSong-Light + UniGB-UCS2-H), 4: CIDFont, 5: FontDescriptor
    // 6..(6+2*N): Page & Content stream pairs.
    let mut objects: Vec<Vec<u8>> = Vec::new();
    let page_count = pages.len();
    let first_page_obj = 6usize;

    let kids: String = (0..page_count)
        .map(|i| format!("{} 0 R", first_page_obj + i * 2))
        .collect::<Vec<_>>()
        .join(" ");

    objects.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
    objects.push(format!("<< /Type /Pages /Kids [ {kids} ] /Count {page_count} >>").into_bytes());
    objects.push(
        b"<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [ 4 0 R ] >>"
            .to_vec(),
    );
    objects.push(
        b"<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /FontDescriptor 5 0 R /DW 1000 >>"
            .to_vec(),
    );
    objects.push(
        b"<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [ -250 -143 1000 880 ] /ItalicAngle 0 /Ascent 880 /Descent -143 /CapHeight 800 /StemV 80 >>"
            .to_vec(),
    );

    for (i, stream) in pages.into_iter().enumerate() {
        let content_obj_num = first_page_obj + i * 2 + 1;
        let page_dict = format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 595 842 ] /Resources << /Font << /F1 3 0 R >> >> /Contents {content_obj_num} 0 R >>"
        );
        objects.push(page_dict.into_bytes());
        let stream_bytes = stream.into_bytes();
        let mut content_obj = format!("<< /Length {} >>\nstream\n", stream_bytes.len()).into_bytes();
        content_obj.extend_from_slice(&stream_bytes);
        content_obj.extend_from_slice(b"endstream");
        objects.push(content_obj);
    }

    let mut pdf = Vec::<u8>::with_capacity(4096);
    pdf.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    let mut offsets: Vec<usize> = Vec::with_capacity(objects.len() + 1);
    offsets.push(0);
    for (idx, obj) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n", idx + 1).as_bytes());
        pdf.extend_from_slice(obj);
        pdf.extend_from_slice(b"\nendobj\n");
    }

    let xref_offset = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for off in offsets.iter().skip(1) {
        pdf.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    pdf
}

fn utf16be_hex(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 4);
    for ch in s.chars() {
        // `/UniGB-UCS2-H` expects 2-byte BMP UCS-2 code units; replace astral glyphs cleanly.
        let code = ch as u32;
        if code <= 0xFFFF {
            use std::fmt::Write as _;
            let _ = write!(&mut out, "{:04X}", code as u16);
        }
    }
    out
}

fn html_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        // Strip invalid XML 1.0 control characters.
        if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') {
            continue;
        }
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

fn docx_paragraph(text: &str, style: Option<&str>, muted: bool) -> String {
    let ppr = style
        .map(|s| format!("<w:pPr><w:pStyle w:val=\"{s}\"/></w:pPr>"))
        .unwrap_or_default();
    let rpr = if muted {
        "<w:rPr><w:color w:val=\"7C756C\"/><w:sz w:val=\"19\"/></w:rPr>"
    } else {
        ""
    };
    let escaped = xml_escape(text);
    format!("<w:p>{ppr}<w:r>{rpr}<w:t xml:space=\"preserve\">{escaped}</w:t></w:r></w:p>\n")
}

fn docx_image_paragraph(rel_id: &str, doc_pr_id: u32, name: &str) -> String {
    let safe_name = xml_escape(name);
    // ~4.2in x 2.6in in EMUs (914400 EMU = 1 inch)
    let cx = 3_840_480u64;
    let cy = 2_377_440u64;
    format!(
        r#"<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{doc_pr_id}" name="{safe_name}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="{doc_pr_id}" name="{safe_name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
"#
    )
}

fn image_ext_from_mime(mime: &str, name: &str) -> String {
    if mime.contains("png") {
        "png".to_string()
    } else if mime.contains("jpeg") || mime.contains("jpg") {
        "jpeg".to_string()
    } else if mime.contains("gif") {
        "gif".to_string()
    } else if mime.contains("webp") {
        "webp".to_string()
    } else {
        Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp"))
            .unwrap_or_else(|| "png".to_string())
    }
}

fn csv_escape(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            total = total.saturating_add(dir_size(&p));
        } else if let Ok(meta) = entry.metadata() {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{NotificationKind, SubtaskItem, TimelineEntry, TodoList};

    fn temp_test_dir(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("desktag_test_{prefix}_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_data(att: AttachmentRef) -> AppData {
        let mut data = AppData::default();
        data.lists.push(TodoList {
            id: "list-1".into(),
            name: "工作项目".into(),
            color: "#e8734a".into(),
            icon: None,
            pinned_to_side: true,
            tab_width: None,
            sort_order: 1.0,
            created_at: now_iso(),
            updated_at: now_iso(),
            deleted_at: None,
        });
        data.todos.push(TodoItem {
            id: "todo-1".into(),
            title: "准备下午的项目评审".into(),
            notes: "需要核对交付清单 & 架构图".into(),
            note_images: vec![att.clone()],
            completed: false,
            completed_at: None,
            priority: TodoPriority::High,
            due_date: Some("2026-11-22".into()),
            due_time: Some("14:00".into()),
            end_date: None,
            list_id: Some("list-1".into()),
            tags: vec!["工作".into(), "评审".into()],
            subtasks: vec![SubtaskItem {
                id: "sub-1".into(),
                title: "核对优先事项".into(),
                notes: "已确认".into(),
                note_images: vec![],
                completed: true,
                sort_order: 1.0,
                updated_at: now_iso(),
            }],
            repeat_rule: None,
            reminder_rule: None,
            quadrant_override: None,
            links: vec![],
            sort_order: 1.0,
            created_at: now_iso(),
            updated_at: now_iso(),
            deleted_at: None,
        });
        data.notes.push(NoteItem {
            id: "note-1".into(),
            title: "项目备忘".into(),
            kind: NoteKind::Timeline,
            content: String::new(),
            timeline_entries: vec![TimelineEntry {
                id: "tl-1".into(),
                content: "完成原型讨论".into(),
                created_at: "2026/11/22 10:30".into(),
                updated_at: now_iso(),
                attachments: vec![att],
                linked_todo_id: Some("todo-1".into()),
            }],
            attachments: vec![],
            links: vec![],
            group_id: None,
            pinned_to_side: true,
            tab_width: None,
            sort_order: 1.0,
            created_at: now_iso(),
            updated_at: now_iso(),
            deleted_at: None,
        });
        data
    }

    #[test]
    fn test_backup_json_and_zip_roundtrip_preserves_attachments_and_custom_dir() {
        let dir1 = temp_test_dir("bk_src");
        let dir2 = temp_test_dir("bk_dst");
        let custom_dir2 = temp_test_dir("bk_custom");

        let src = StorageManager::new(dir1.clone());
        // 1x1 PNG bytes
        let png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let att = src
            .save_attachment(SaveAttachmentInput {
                name: "diagram.png".into(),
                mime: "image/png".into(),
                kind: AttachmentKind::Image,
                base64_data: png_b64.into(),
            })
            .unwrap();
        let data = sample_data(att.clone());
        src.save_app_data(data).unwrap();

        // Export default JSON backup (None target_path -> backups/desktag-backup-*.json)
        let json_bk = src
            .export_backup(BackupOptions {
                include_data: true,
                include_settings: true,
                target_path: None,
            })
            .unwrap();
        assert!(Path::new(&json_bk.path).exists());
        assert!(json_bk.path.contains(BACKUPS_DIR_NAME));

        // Export ZIP backup
        let zip_path = dir1.join("test-export.zip");
        let zip_bk = src
            .export_backup(BackupOptions {
                include_data: true,
                include_settings: true,
                target_path: Some(zip_path.to_string_lossy().to_string()),
            })
            .unwrap();
        assert!(zip_bk.bytes > 0);

        // Import ZIP into another StorageManager with its own custom_data_dir
        let dst = StorageManager::new(dir2.clone());
        dst.change_storage_dir(&custom_dir2.to_string_lossy())
            .unwrap();
        let res = dst.import_backup(Some(zip_bk.path)).unwrap();
        assert_eq!(res.imported_todos, 1);
        assert_eq!(res.imported_notes, 1);
        assert_eq!(
            dst.load_device_settings().custom_data_dir.as_deref(),
            Some(custom_dir2.to_string_lossy().as_ref())
        );
        // Verify attachment restored in custom_dir2
        assert!(dst.resolve_attachment_path(&att.relative_path).unwrap().exists());

        // Also test JSON backup import
        let res2 = dst.import_backup(Some(json_bk.path)).unwrap();
        assert_eq!(res2.imported_todos, 1);
        assert_eq!(res2.imported_notes, 1);

        let _ = fs::remove_dir_all(&dir1);
        let _ = fs::remove_dir_all(&dir2);
        let _ = fs::remove_dir_all(&custom_dir2);
    }

    #[test]
    fn test_change_storage_dir_migrates_files() {
        let dir1 = temp_test_dir("mig_old");
        let dir2 = temp_test_dir("mig_new");
        let mgr = StorageManager::new(dir1.clone());
        let att = mgr
            .save_attachment(SaveAttachmentInput {
                name: "note.txt".into(),
                mime: "text/plain".into(),
                kind: AttachmentKind::File,
                base64_data: base64::engine::general_purpose::STANDARD.encode(b"hello desktag"),
            })
            .unwrap();
        mgr.save_app_data(sample_data(att.clone())).unwrap();
        mgr.save_webdav_config(&WebDavConfig {
            enabled: true,
            url: "https://dav.example.com/dav".into(),
            username: "u".into(),
            password: "p".into(),
            ..Default::default()
        })
        .unwrap();
        mgr.append_notification(NotificationItem {
            id: "n1".into(),
            title: "T".into(),
            body: "B".into(),
            kind: NotificationKind::Reminder,
            todo_id: None,
            created_at: now_iso(),
            read: false,
        })
        .unwrap();

        let info = mgr
            .change_storage_dir(&dir2.to_string_lossy())
            .unwrap();
        assert!(info.is_custom_dir);
        assert!(dir2.join(DATA_FILE_NAME).exists());
        assert!(dir2.join(SYNC_CONFIG_FILE_NAME).exists());
        assert!(dir2.join(NOTIFICATIONS_FILE_NAME).exists());
        assert!(mgr.resolve_attachment_path(&att.relative_path).unwrap().exists());
        assert_eq!(mgr.load_app_data().todos.len(), 1);
        assert_eq!(mgr.load_notifications().len(), 1);

        let _ = fs::remove_dir_all(&dir1);
        let _ = fs::remove_dir_all(&dir2);
    }

    #[test]
    fn test_export_documents_all_formats() {
        let dir = temp_test_dir("exp_docs");
        let mgr = StorageManager::new(dir.clone());
        let png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let att = mgr
            .save_attachment(SaveAttachmentInput {
                name: "shot.png".into(),
                mime: "image/png".into(),
                kind: AttachmentKind::Image,
                base64_data: png_b64.into(),
            })
            .unwrap();
        mgr.save_app_data(sample_data(att)).unwrap();

        // Markdown
        let md = mgr
            .export_document(ExportDocumentRequest {
                format: ExportDocFormat::Markdown,
                scope: "all".into(),
                note_id: None,
                target_path: None,
            })
            .unwrap();
        let md_text = fs::read_to_string(&md.path).unwrap();
        assert!(md_text.contains("准备下午的项目评审"));
        assert!(md_text.contains("项目备忘"));

        // HTML with embedded base64 image
        let html = mgr
            .export_document(ExportDocumentRequest {
                format: ExportDocFormat::Html,
                scope: "all".into(),
                note_id: None,
                target_path: None,
            })
            .unwrap();
        let html_text = fs::read_to_string(&html.path).unwrap();
        assert!(html_text.contains("data:image/png;base64,"));
        assert!(html_text.contains("核对优先事项"));

        // DOCX valid OOXML zip archive
        let docx = mgr
            .export_document(ExportDocumentRequest {
                format: ExportDocFormat::Docx,
                scope: "all".into(),
                note_id: None,
                target_path: None,
            })
            .unwrap();
        let docx_bytes = fs::read(&docx.path).unwrap();
        let mut archive = ZipArchive::new(Cursor::new(docx_bytes)).unwrap();
        assert!(archive.by_name("[Content_Types].xml").is_ok());
        assert!(archive.by_name("_rels/.rels").is_ok());
        assert!(archive.by_name("word/document.xml").is_ok());
        assert!(archive.by_name("word/media/image1.png").is_ok());

        // PDF 1.4 valid structure
        let pdf = mgr
            .export_document(ExportDocumentRequest {
                format: ExportDocFormat::Pdf,
                scope: "all".into(),
                note_id: None,
                target_path: None,
            })
            .unwrap();
        let pdf_bytes = fs::read(&pdf.path).unwrap();
        assert!(pdf_bytes.starts_with(b"%PDF-1.4\n"));
        let pdf_str = String::from_utf8_lossy(&pdf_bytes);
        assert!(pdf_str.contains("xref\n"));
        assert!(pdf_str.contains("startxref\n"));
        assert!(pdf_str.ends_with("%%EOF\n"));

        // CSV helper
        let csv = mgr.export_csv_string("all");
        assert!(csv.contains("准备下午的项目评审"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_attachment_path_traversal_rejected_and_settings_only_backup() {
        let dir = temp_test_dir("sec_and_settings");
        let mgr = StorageManager::new(dir.clone());
        assert!(mgr.resolve_attachment_path("../secret.txt").is_err());
        assert!(mgr.resolve_attachment_path("/etc/passwd").is_err());
        assert!(mgr.resolve_attachment_path("C:\\Windows\\win.ini").is_err());
        assert!(mgr.resolve_attachment_path("").is_err());
        assert!(mgr.resolve_attachment_path("attachments/ok.png").is_ok());

        let mut dev = DeviceSettings::default();
        dev.panel_width = 520;
        mgr.save_device_settings(&dev).unwrap();

        let bk = mgr
            .export_backup(BackupOptions {
                include_data: false,
                include_settings: true,
                target_path: None,
            })
            .unwrap();
        let imported = mgr.import_backup(Some(bk.path)).unwrap();
        assert_eq!(imported.device.as_ref().map(|d| d.panel_width), Some(520));

        let _ = fs::remove_dir_all(&dir);
    }
}
