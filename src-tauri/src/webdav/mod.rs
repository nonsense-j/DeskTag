pub mod client;
pub mod crypto;
pub mod merge;

use std::sync::Arc;

use tokio::sync::Mutex;

use crate::models::{
    SyncExecutionResult, SyncPreview, WebDavConfig, WebDavConfigInput, WebDavConfigView,
    WebDavStatusView, WebDavTestResult,
};
use crate::storage::StorageManager;

pub struct WebDavManager {
    storage: Arc<StorageManager>,
    status: Mutex<WebDavStatusView>,
}

impl WebDavManager {
    pub fn new(storage: Arc<StorageManager>) -> Self {
        let cfg = storage.load_webdav_config();
        let initial = WebDavStatusView {
            enabled: cfg.enabled,
            configured: cfg.is_configured(),
            ..WebDavStatusView::default()
        };
        Self {
            storage,
            status: Mutex::new(initial),
        }
    }

    pub async fn get_config_view(&self) -> WebDavConfigView {
        self.storage.load_webdav_config().to_view()
    }

    pub async fn save_config(&self, input: WebDavConfigInput) -> Result<WebDavConfigView, String> {
        let prev = self.storage.load_webdav_config();
        let next = merge_config_input(&prev, &input)?;
        self.storage.save_webdav_config(&next)?;
        let mut st = self.status.lock().await;
        st.enabled = next.enabled;
        st.configured = next.is_configured();
        Ok(next.to_view())
    }

    pub async fn get_status(&self) -> WebDavStatusView {
        let cfg = self.storage.load_webdav_config();
        let mut st = self.status.lock().await;
        st.enabled = cfg.enabled;
        st.configured = cfg.is_configured();
        st.clone()
    }

    pub async fn test_connection(
        &self,
        input: Option<WebDavConfigInput>,
    ) -> Result<WebDavTestResult, String> {
        let cfg = match input {
            Some(inp) => merge_config_input(&self.storage.load_webdav_config(), &inp)?,
            None => self.storage.load_webdav_config(),
        };
        if cfg.url.trim().is_empty() {
            return Ok(WebDavTestResult {
                ok: false,
                status_code: None,
                message: "WebDAV server URL is required".to_string(),
                remote_file_exists: false,
                suggested_url: None,
                latency_ms: 0,
            });
        }
        Ok(WebDavTestResult {
            ok: false,
            status_code: None,
            message: "WebDAV engine stub — implementation pending".to_string(),
            remote_file_exists: false,
            suggested_url: None,
            latency_ms: 0,
        })
    }

    pub async fn preview(&self, _input: Option<WebDavConfigInput>) -> Result<SyncPreview, String> {
        Ok(SyncPreview {
            token: "stub-preview".to_string(),
            direction: "up_to_date".to_string(),
            to_upload_count: 0,
            to_download_count: 0,
            conflict_count: 0,
            items: Vec::new(),
            summary: "No pending changes".to_string(),
        })
    }

    pub async fn sync_now(&self) -> Result<SyncExecutionResult, String> {
        let status = self.get_status().await;
        Ok(SyncExecutionResult {
            ok: true,
            changed_local: false,
            changed_remote: false,
            data: None,
            status,
            message: "WebDAV sync stub".to_string(),
        })
    }

    pub async fn sync_previewed(&self, _token: String) -> Result<SyncExecutionResult, String> {
        self.sync_now().await
    }

    pub async fn undo_sync(&self, _force: bool) -> Result<SyncExecutionResult, String> {
        let status = self.get_status().await;
        Ok(SyncExecutionResult {
            ok: false,
            changed_local: false,
            changed_remote: false,
            data: None,
            status,
            message: "No sync snapshot available to undo".to_string(),
        })
    }

    pub async fn restore_from_server(&self) -> Result<SyncExecutionResult, String> {
        self.sync_now().await
    }

    pub async fn force_upload(&self) -> Result<SyncExecutionResult, String> {
        self.sync_now().await
    }

    pub async fn export_setup_text(&self) -> Result<String, String> {
        Err("WebDAV setup text export not configured yet".to_string())
    }

    pub async fn import_setup_text(
        &self,
        _setup_text: String,
        _passphrase: String,
    ) -> Result<WebDavConfigView, String> {
        Err("WebDAV setup text import not configured yet".to_string())
    }

    pub async fn trigger_debounced_sync(&self) -> Result<(), String> {
        Ok(())
    }
}

fn merge_config_input(
    prev: &WebDavConfig,
    input: &WebDavConfigInput,
) -> Result<WebDavConfig, String> {
    let url = input.url.trim().to_string();
    let username = input.username.trim().to_string();
    let same_account = prev.url.trim().eq_ignore_ascii_case(&url)
        && prev.username.trim() == username;

    let password = if input.clear_password.unwrap_or(false) {
        String::new()
    } else if let Some(ref p) = input.password {
        if !p.is_empty() {
            p.clone()
        } else if same_account {
            prev.password.clone()
        } else {
            String::new()
        }
    } else if same_account {
        prev.password.clone()
    } else {
        String::new()
    };

    let passphrase = if input.clear_passphrase.unwrap_or(false) {
        String::new()
    } else if let Some(ref p) = input.passphrase {
        if !p.is_empty() {
            p.clone()
        } else {
            prev.passphrase.clone()
        }
    } else {
        prev.passphrase.clone()
    };

    if !passphrase.is_empty() && passphrase == password {
        return Err(
            "Encryption passphrase must differ from WebDAV login password".to_string(),
        );
    }

    Ok(WebDavConfig {
        enabled: input.enabled,
        url,
        username,
        password,
        passphrase,
        remote_dir: if input.remote_dir.trim().is_empty() {
            "desktag".to_string()
        } else {
            input.remote_dir.trim().to_string()
        },
        auto_sync_minutes: input.auto_sync_minutes,
        debounce_push: input.debounce_push,
        follow_server: input.follow_server,
    })
}
