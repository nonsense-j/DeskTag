use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use base64::Engine;
use uuid::Uuid;

use crate::models::{
    now_iso, AppData, AttachmentRef, BackupOptions, BackupResult, DeviceSettings,
    ExportDocumentRequest, ExportDocumentResult, ImportBackupResult, NotificationItem,
    SaveAttachmentInput, StorageInfo, WebDavConfig,
};

pub const DATA_FILE_NAME: &str = "data.json";
pub const DEVICE_FILE_NAME: &str = "device.json";
pub const SYNC_CONFIG_FILE_NAME: &str = "sync.json";
pub const NOTIFICATIONS_FILE_NAME: &str = "notifications.json";
pub const ATTACHMENTS_DIR_NAME: &str = "attachments";
pub const SYNC_BACKUP_DIR_NAME: &str = "sync";

pub fn fallback_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("DeskTag")
}

/// Write bytes atomically via temp file + rename in the same directory.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
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
    fs::write(&tmp_path, bytes).map_err(|e| format!("failed to write temp file: {e}"))?;
    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("failed to replace target file: {e}")
    })?;
    Ok(())
}

pub struct StorageManager {
    default_dir: PathBuf,
    active_dir: RwLock<PathBuf>,
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
        Self {
            default_dir,
            active_dir: RwLock::new(initial_dir),
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
        self.active_dir().join(SYNC_BACKUP_DIR_NAME)
    }

    fn read_device_from(dir: &Path) -> DeviceSettings {
        let path = dir.join(DEVICE_FILE_NAME);
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<DeviceSettings>(&raw).ok())
            .unwrap_or_default()
    }

    pub fn load_app_data(&self) -> AppData {
        let path = self.data_file_path();
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<AppData>(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save_app_data(&self, mut data: AppData) -> Result<(), String> {
        data.updated_at = now_iso();
        let bytes = serde_json::to_vec_pretty(&data)
            .map_err(|e| format!("failed to serialize app data: {e}"))?;
        write_atomic(&self.data_file_path(), &bytes)
    }

    pub fn load_device_settings(&self) -> DeviceSettings {
        Self::read_device_from(&self.default_dir)
    }

    pub fn save_device_settings(&self, device: &DeviceSettings) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(device)
            .map_err(|e| format!("failed to serialize device settings: {e}"))?;
        write_atomic(&self.device_file_path(), &bytes)
    }

    pub fn load_webdav_config(&self) -> WebDavConfig {
        let path = self.sync_config_path();
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<WebDavConfig>(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save_webdav_config(&self, cfg: &WebDavConfig) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(cfg)
            .map_err(|e| format!("failed to serialize webdav config: {e}"))?;
        write_atomic(&self.sync_config_path(), &bytes)
    }

    pub fn load_notifications(&self) -> Vec<NotificationItem> {
        let path = self.notifications_file_path();
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<NotificationItem>>(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save_notifications(&self, items: &[NotificationItem]) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(items)
            .map_err(|e| format!("failed to serialize notifications: {e}"))?;
        write_atomic(&self.notifications_file_path(), &bytes)
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
        if relative_path.contains("..") {
            return Err("invalid attachment path".to_string());
        }
        Ok(self.active_dir().join(relative_path))
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
            sync_backup_dir: self.sync_backup_dir().to_string_lossy().to_string(),
            total_bytes,
            is_custom_dir: active != self.default_dir,
        }
    }

    pub fn change_storage_dir(&self, new_dir: &str) -> Result<StorageInfo, String> {
        let target = PathBuf::from(new_dir.trim());
        if target.as_os_str().is_empty() {
            return Err("storage directory path cannot be empty".to_string());
        }
        fs::create_dir_all(&target)
            .map_err(|e| format!("failed to create storage directory: {e}"))?;
        if let Ok(mut guard) = self.active_dir.write() {
            *guard = target.clone();
        }
        let mut device = self.load_device_settings();
        device.custom_data_dir = Some(target.to_string_lossy().to_string());
        self.save_device_settings(&device)?;
        Ok(self.get_storage_info())
    }

    pub fn export_backup(&self, options: BackupOptions) -> Result<BackupResult, String> {
        let exported_at = now_iso();
        let payload = serde_json::json!({
            "schemaVersion": crate::models::CURRENT_SCHEMA_VERSION,
            "exportedAt": exported_at,
            "data": if options.include_data { Some(self.load_app_data()) } else { None },
            "device": if options.include_settings { Some(self.load_device_settings()) } else { None },
        });
        let bytes = serde_json::to_vec_pretty(&payload)
            .map_err(|e| format!("failed to serialize backup: {e}"))?;
        let target = options
            .target_path
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                self.active_dir().join(format!(
                    "desktag-backup-{}.json",
                    chrono::Utc::now().format("%Y%m%d-%H%M%S")
                ))
            });
        write_atomic(&target, &bytes)?;
        Ok(BackupResult {
            path: target.to_string_lossy().to_string(),
            bytes: bytes.len() as u64,
            exported_at,
        })
    }

    pub fn import_backup(&self, source_path: Option<String>) -> Result<ImportBackupResult, String> {
        let path = source_path
            .map(PathBuf::from)
            .ok_or_else(|| "source backup path is required".to_string())?;
        let raw = fs::read_to_string(&path).map_err(|e| format!("failed to read backup: {e}"))?;
        let value: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("invalid backup JSON: {e}"))?;
        let data: AppData = if let Some(d) = value.get("data").filter(|v| !v.is_null()) {
            serde_json::from_value(d.clone()).map_err(|e| format!("invalid data section: {e}"))?
        } else {
            serde_json::from_value(value.clone()).map_err(|e| format!("invalid backup format: {e}"))?
        };
        let device: Option<DeviceSettings> = value
            .get("device")
            .filter(|v| !v.is_null())
            .and_then(|v| serde_json::from_value(v.clone()).ok());

        self.save_app_data(data.clone())?;
        if let Some(ref dev) = device {
            self.save_device_settings(dev)?;
        }
        Ok(ImportBackupResult {
            imported_todos: data.todos.len(),
            imported_notes: data.notes.len(),
            data,
            device,
        })
    }

    pub fn export_document(
        &self,
        request: ExportDocumentRequest,
    ) -> Result<ExportDocumentResult, String> {
        let data = self.load_app_data();
        let ext = match request.format {
            crate::models::ExportDocFormat::Markdown => "md",
            crate::models::ExportDocFormat::Html => "html",
            crate::models::ExportDocFormat::Docx => "docx",
            crate::models::ExportDocFormat::Pdf => "pdf",
        };
        let target = request
            .target_path
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                self.active_dir().join(format!(
                    "desktag-export-{}.{ext}",
                    chrono::Utc::now().format("%Y%m%d-%H%M%S")
                ))
            });
        let content = format!(
            "# DeskTag Export ({})\n\nTotal todos: {}\nTotal notes: {}\n",
            request.scope,
            data.todos.len(),
            data.notes.len()
        );
        let bytes = content.into_bytes();
        write_atomic(&target, &bytes)?;
        Ok(ExportDocumentResult {
            path: target.to_string_lossy().to_string(),
            format: request.format,
            bytes: bytes.len() as u64,
        })
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
