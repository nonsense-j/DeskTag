pub mod client;
pub mod crypto;
pub mod merge;

use std::fs::{self, File, OpenOptions};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use chrono::Utc;
use reqwest::Url;
use tauri::Emitter;
use tokio::sync::{Mutex, Notify};

use crate::models::{
    now_iso, AppData, ConflictNotice, ServerFileWarning, SyncExecutionResult, SyncPreview,
    WebDavConfig, WebDavConfigInput, WebDavConfigView, WebDavStatusView, WebDavTestResult,
};
use crate::storage::StorageManager;
use crate::webdav::client::{
    compute_backoff, infer_backend_hint, normalize_remote_dir, what_is, DavError, GetOutcome,
    RemoteVersion, WebDavClient,
};
use crate::webdav::crypto::{
    export_setup_text as crypto_export_setup, import_setup_text as crypto_import_setup,
    open_app_data, seal_app_data, sha256_hex, CryptoError, SetupPayload,
};
use crate::webdav::merge::{
    build_initial_upload_preview, build_sync_preview, can_auto_rebuild_corrupt,
    compute_bundle_hash, compute_item_hashes, load_cached_remote, load_sync_state,
    merge_app_data_with_hashes, save_cached_remote, save_rotating_snapshot, save_sync_state,
    state_key, AppliedSync, SyncState,
};

const SYNC_LOCK_FILE_NAME: &str = "sync.lock";
const LOCK_TIMEOUT: Duration = Duration::from_secs(15);
const LOCK_POLL_INTERVAL: Duration = Duration::from_millis(100);
const STARTUP_SYNC_DELAY: Duration = Duration::from_secs(20);
const DEBOUNCE_WINDOW: Duration = Duration::from_secs(5);
const SCHEDULER_POLL_INTERVAL: Duration = Duration::from_secs(60);

const EVENT_DATA_SYNCED: &str = "desktag://data-synced";
const EVENT_SYNC_STATUS: &str = "desktag://sync-status";

struct SyncLockGuard {
    file: File,
}

impl Drop for SyncLockGuard {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

/// Acquire cross-process exclusive OS lock on `<active_dir>/sync.lock`, polling up to 15s.
async fn acquire_os_sync_lock(active_dir: &Path) -> Result<SyncLockGuard, String> {
    fs::create_dir_all(active_dir).map_err(|e| format!("failed to prepare data dir: {e}"))?;
    let lock_path = active_dir.join(SYNC_LOCK_FILE_NAME);
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|e| format!("failed to open sync lock file: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o600));
    }

    let deadline = Instant::now() + LOCK_TIMEOUT;
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(SyncLockGuard { file }),
            Err(std::fs::TryLockError::WouldBlock) => {
                if Instant::now() >= deadline {
                    return Err(
                        "Another DeskTag sync operation is still running (lock busy)".to_string(),
                    );
                }
                tokio::time::sleep(LOCK_POLL_INTERVAL).await;
            }
            Err(std::fs::TryLockError::Error(e)) => {
                return Err(format!("failed to acquire sync file lock: {e}"));
            }
        }
    }
}

pub struct WebDavManager {
    storage: Arc<StorageManager>,
    status: Mutex<WebDavStatusView>,
    op_lock: Mutex<()>,
    app_handle: OnceLock<tauri::AppHandle>,
    debounce_notify: Arc<Notify>,
    config_notify: Arc<Notify>,
    debounce_pending: AtomicBool,
    last_rate_limit: Mutex<Option<Option<Duration>>>,
}

impl WebDavManager {
    pub fn new(storage: Arc<StorageManager>) -> Self {
        let cfg = storage.load_webdav_config();
        let st = load_sync_state(&storage);
        let initial = status_from_config_and_state(&cfg, &st, false, None);
        Self {
            storage,
            status: Mutex::new(initial),
            op_lock: Mutex::new(()),
            app_handle: OnceLock::new(),
            debounce_notify: Arc::new(Notify::new()),
            config_notify: Arc::new(Notify::new()),
            debounce_pending: AtomicBool::new(false),
            last_rate_limit: Mutex::new(None),
        }
    }

    /// Wake the background sync loop after external WebDAV config or storage-dir changes.
    pub fn notify_config_changed(&self) {
        self.config_notify.notify_one();
    }

    /// Spawn background auto-sync loop:
    /// - 20s startup sync delay
    /// - 5s debounced push on local changes (`trigger_debounced_sync`)
    /// - Periodic conditional-GET auto-sync respecting `auto_sync_minutes` and `Retry-After` backoff
    /// - Emits `desktag://data-synced` and `desktag://sync-status` to the frontend
    pub fn spawn_background_sync(self: &Arc<Self>, app: tauri::AppHandle) {
        let _ = self.app_handle.set(app);
        let mgr = Arc::clone(self);

        tauri::async_runtime::spawn(async move {
            let mut last_tried: Option<Instant> = None;
            let mut rate_limited = false;
            let mut backoff_gap = Duration::ZERO;
            let mut startup_done = false;

            let startup_sleep = tokio::time::sleep(STARTUP_SYNC_DELAY);
            tokio::pin!(startup_sleep);

            loop {
                if !startup_done {
                    tokio::select! {
                        () = &mut startup_sleep => {
                            startup_done = true;
                            let cfg = mgr.storage.load_webdav_config();
                            if cfg.enabled && cfg.is_configured() && cfg.auto_sync_minutes > 0 {
                                let base = Duration::from_secs((cfg.auto_sync_minutes as u64) * 60);
                                let _ = mgr.sync_now().await;
                                last_tried = Some(Instant::now());
                                let rl = *mgr.last_rate_limit.lock().await;
                                rate_limited = rl.is_some();
                                backoff_gap = compute_backoff(rl, base, base);
                                mgr.update_next_auto_sync_at(&cfg, last_tried, rate_limited, backoff_gap).await;
                            } else {
                                mgr.update_next_auto_sync_at(&cfg, last_tried, rate_limited, backoff_gap).await;
                            }
                        }
                        () = mgr.debounce_notify.notified() => {
                            startup_done = true;
                            mgr.run_debounced_window(&mut last_tried, &mut rate_limited, &mut backoff_gap).await;
                        }
                        () = mgr.config_notify.notified() => {
                            let cfg = mgr.storage.load_webdav_config();
                            mgr.update_next_auto_sync_at(&cfg, last_tried, rate_limited, backoff_gap).await;
                        }
                    }
                    continue;
                }

                let cfg = mgr.storage.load_webdav_config();
                if !cfg.enabled || !cfg.is_configured() || cfg.auto_sync_minutes <= 0 {
                    mgr.update_next_auto_sync_at(&cfg, last_tried, false, Duration::ZERO)
                        .await;
                    // Park indefinitely until config or debounced-sync notification arrives (0 periodic wakeups).
                    tokio::select! {
                        () = mgr.debounce_notify.notified() => {
                            mgr.run_debounced_window(&mut last_tried, &mut rate_limited, &mut backoff_gap).await;
                        }
                        () = mgr.config_notify.notified() => {
                            rate_limited = false;
                            backoff_gap = Duration::ZERO;
                            let next_cfg = mgr.storage.load_webdav_config();
                            mgr.update_next_auto_sync_at(&next_cfg, last_tried, rate_limited, backoff_gap).await;
                        }
                    }
                    continue;
                }

                tokio::select! {
                    () = tokio::time::sleep(SCHEDULER_POLL_INTERVAL) => {
                        let cfg = mgr.storage.load_webdav_config();
                        if !cfg.enabled || !cfg.is_configured() || cfg.auto_sync_minutes <= 0 {
                            mgr.update_next_auto_sync_at(&cfg, last_tried, false, Duration::ZERO).await;
                            continue;
                        }
                        let base = Duration::from_secs((cfg.auto_sync_minutes as u64) * 60);
                        let wait = if rate_limited { backoff_gap.max(base) } else { base };
                        let due = last_tried.map(|t| t.elapsed() >= wait).unwrap_or(true);
                        if due {
                            let _ = mgr.sync_now().await;
                            last_tried = Some(Instant::now());
                            let rl = *mgr.last_rate_limit.lock().await;
                            rate_limited = rl.is_some();
                            backoff_gap = compute_backoff(rl, wait, base);
                        }
                        mgr.update_next_auto_sync_at(&cfg, last_tried, rate_limited, backoff_gap).await;
                    }
                    () = mgr.debounce_notify.notified() => {
                        mgr.run_debounced_window(&mut last_tried, &mut rate_limited, &mut backoff_gap).await;
                    }
                    () = mgr.config_notify.notified() => {
                        rate_limited = false;
                        backoff_gap = Duration::ZERO;
                        let cfg = mgr.storage.load_webdav_config();
                        mgr.update_next_auto_sync_at(&cfg, last_tried, rate_limited, backoff_gap).await;
                    }
                }
            }
        });
    }

    async fn run_debounced_window(
        &self,
        last_tried: &mut Option<Instant>,
        rate_limited: &mut bool,
        backoff_gap: &mut Duration,
    ) {
        loop {
            self.debounce_pending.store(false, Ordering::SeqCst);
            let timer = tokio::time::sleep(DEBOUNCE_WINDOW);
            tokio::pin!(timer);
            tokio::select! {
                () = &mut timer => break,
                () = self.debounce_notify.notified() => continue,
            }
        }

        let cfg = self.storage.load_webdav_config();
        if !cfg.enabled || !cfg.is_configured() || !cfg.debounce_push || cfg.follow_server {
            return;
        }
        // Respect active rate-limit backoff window even for debounced pushes
        if *rate_limited {
            if let Some(prev) = *last_tried {
                if prev.elapsed() < *backoff_gap {
                    return;
                }
            }
        }

        let base = if cfg.auto_sync_minutes > 0 {
            Duration::from_secs((cfg.auto_sync_minutes as u64) * 60)
        } else {
            Duration::from_secs(180)
        };
        let prev_wait = if *rate_limited {
            (*backoff_gap).max(base)
        } else {
            base
        };

        let _ = self.sync_now().await;
        *last_tried = Some(Instant::now());
        let rl = *self.last_rate_limit.lock().await;
        *rate_limited = rl.is_some();
        *backoff_gap = compute_backoff(rl, prev_wait, base);
        self.update_next_auto_sync_at(&cfg, *last_tried, *rate_limited, *backoff_gap)
            .await;
    }

    async fn update_next_auto_sync_at(
        &self,
        cfg: &WebDavConfig,
        last_tried: Option<Instant>,
        rate_limited: bool,
        backoff_gap: Duration,
    ) {
        let next_at = if cfg.enabled && cfg.is_configured() && cfg.auto_sync_minutes > 0 {
            let base = Duration::from_secs((cfg.auto_sync_minutes as u64) * 60);
            let wait = if rate_limited {
                backoff_gap.max(base)
            } else {
                base
            };
            let remaining = match last_tried {
                Some(t) => wait.saturating_sub(t.elapsed()),
                None => wait,
            };
            let target = Utc::now()
                + chrono::Duration::from_std(remaining).unwrap_or_else(|_| chrono::Duration::seconds(180));
            Some(target.to_rfc3339())
        } else {
            None
        };

        let status_snapshot = {
            let mut st = self.status.lock().await;
            if st.next_auto_sync_at == next_at {
                return;
            }
            st.next_auto_sync_at = next_at;
            st.clone()
        };
        self.emit_status(&status_snapshot);
    }

    fn emit_status(&self, status: &WebDavStatusView) {
        if let Some(app) = self.app_handle.get() {
            let _ = app.emit(EVENT_SYNC_STATUS, status);
        }
    }

    fn emit_data_synced(&self, data: &AppData) {
        if let Some(app) = self.app_handle.get() {
            let _ = app.emit(EVENT_DATA_SYNCED, data);
        }
    }

    async fn set_syncing(&self, syncing: bool) -> WebDavStatusView {
        let mut st = self.status.lock().await;
        st.syncing = syncing;
        let snap = st.clone();
        drop(st);
        self.emit_status(&snap);
        snap
    }

    async fn refresh_status_from_state(
        &self,
        cfg: &WebDavConfig,
        sync_state: &SyncState,
        syncing: bool,
    ) -> WebDavStatusView {
        let mut st = self.status.lock().await;
        let next_auto = st.next_auto_sync_at.clone();
        *st = status_from_config_and_state(cfg, sync_state, syncing, next_auto);
        let snap = st.clone();
        drop(st);
        self.emit_status(&snap);
        snap
    }

    pub async fn get_config_view(&self) -> WebDavConfigView {
        self.storage.load_webdav_config().to_view()
    }

    pub async fn save_config(&self, input: WebDavConfigInput) -> Result<WebDavConfigView, String> {
        let _op = self.op_lock.lock().await;
        let _file_lock = acquire_os_sync_lock(&self.storage.active_dir()).await?;

        let prev = self.storage.load_webdav_config();
        let next = merge_config_input(&prev, &input)?;
        self.storage.save_webdav_config(&next)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(
                self.storage.sync_config_path(),
                fs::Permissions::from_mode(0o600),
            );
        }

        let sync_state = load_sync_state(&self.storage);
        self.refresh_status_from_state(&next, &sync_state, false)
            .await;
        self.config_notify.notify_one();
        Ok(next.to_view())
    }

    pub async fn get_status(&self) -> WebDavStatusView {
        let cfg = self.storage.load_webdav_config();
        let sync_state = load_sync_state(&self.storage);
        let mut st = self.status.lock().await;
        let syncing = st.syncing;
        let next_auto = st.next_auto_sync_at.clone();
        *st = status_from_config_and_state(&cfg, &sync_state, syncing, next_auto);
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
        let client = match WebDavClient::from_config(&cfg) {
            Ok(c) => c,
            Err(e) => {
                return Ok(WebDavTestResult {
                    ok: false,
                    status_code: None,
                    message: e.to_string(),
                    remote_file_exists: false,
                    suggested_url: None,
                    latency_ms: 0,
                });
            }
        };
        Ok(client.test_connection().await)
    }

    pub async fn preview(&self, input: Option<WebDavConfigInput>) -> Result<SyncPreview, String> {
        let _op = self.op_lock.lock().await;
        let _file_lock = acquire_os_sync_lock(&self.storage.active_dir()).await?;

        let cfg = match input {
            Some(inp) => merge_config_input(&self.storage.load_webdav_config(), &inp)?,
            None => self.storage.load_webdav_config(),
        };
        if cfg.url.trim().is_empty() {
            return Err("WebDAV server URL is required".to_string());
        }
        let mut st = load_sync_state(&self.storage);
        let key = state_key(&cfg);
        if st.key != key {
            st = SyncState {
                key,
                ..SyncState::default()
            };
        }
        self.compute_preview_locked(&cfg, &st).await
    }

    pub async fn sync_now(&self) -> Result<SyncExecutionResult, String> {
        self.run_sync_internal(None).await
    }

    pub async fn sync_previewed(&self, token: String) -> Result<SyncExecutionResult, String> {
        if token.trim().is_empty() {
            return Err("Preview token is required".to_string());
        }
        self.run_sync_internal(Some(token)).await
    }

    async fn run_sync_internal(
        &self,
        expected_token: Option<String>,
    ) -> Result<SyncExecutionResult, String> {
        let _op = self.op_lock.lock().await;
        let _file_lock = acquire_os_sync_lock(&self.storage.active_dir()).await?;

        let cfg = self.storage.load_webdav_config();
        if cfg.url.trim().is_empty() {
            return Err("WebDAV sync is not configured (server URL is empty)".to_string());
        }

        let mut st = load_sync_state(&self.storage);
        let key = state_key(&cfg);
        if st.key != key {
            st = SyncState {
                key,
                ..SyncState::default()
            };
        }

        self.set_syncing(true).await;

        if let Some(ref want_token) = expected_token {
            match self.compute_preview_locked(&cfg, &st).await {
                Ok(live_preview) => {
                    if &live_preview.token != want_token {
                        self.refresh_status_from_state(&cfg, &st, false).await;
                        return Err(
                            "Local or remote data changed since preview; please preview again before syncing"
                                .to_string(),
                        );
                    }
                }
                Err(e) => {
                    self.refresh_status_from_state(&cfg, &st, false).await;
                    return Err(e);
                }
            }
        }

        let client = match WebDavClient::from_config(&cfg) {
            Ok(c) => c,
            Err(e) => {
                let msg = e.to_string();
                st.last_error = Some(msg.clone());
                let _ = save_sync_state(&self.storage, &st);
                let status = self.refresh_status_from_state(&cfg, &st, false).await;
                return Ok(SyncExecutionResult {
                    ok: false,
                    changed_local: false,
                    changed_remote: false,
                    data: None,
                    status,
                    message: msg,
                });
            }
        };
        if st.server.no_cond_read {
            client.set_no_cond_read(true);
        }

        // Attempt sync; automatically retry ONCE on 412 Precondition Failed (concurrent device write)
        let mut attempt = self.execute_sync_once(&client, &cfg, &mut st).await;
        if let Err(SyncStepError::PreconditionFailed) = attempt {
            attempt = self.execute_sync_once(&client, &cfg, &mut st).await;
        }

        match attempt {
            Ok(step) => {
                *self.last_rate_limit.lock().await = None;
                st.last_sync_at = Some(now_iso());
                st.last_error = None;
                st.server_file_warning = None;
                let _ = save_sync_state(&self.storage, &st);
                let status = self.refresh_status_from_state(&cfg, &st, false).await;
                if step.changed_local {
                    if let Some(ref data) = step.data {
                        self.emit_data_synced(data);
                    }
                }
                Ok(SyncExecutionResult {
                    ok: true,
                    changed_local: step.changed_local,
                    changed_remote: step.changed_remote,
                    data: step.data,
                    status,
                    message: step.message,
                })
            }
            Err(err) => {
                let (msg, warning, rate_limit) = classify_sync_error(err);
                *self.last_rate_limit.lock().await = rate_limit;
                st.last_error = Some(msg.clone());
                st.server_file_warning = warning;
                st.server.no_cond_read = st.server.no_cond_read || client.is_no_cond_read();
                let _ = save_sync_state(&self.storage, &st);
                let status = self.refresh_status_from_state(&cfg, &st, false).await;
                Ok(SyncExecutionResult {
                    ok: false,
                    changed_local: false,
                    changed_remote: false,
                    data: None,
                    status,
                    message: msg,
                })
            }
        }
    }

    async fn compute_preview_locked(
        &self,
        cfg: &WebDavConfig,
        st: &SyncState,
    ) -> Result<SyncPreview, String> {
        let client = WebDavClient::from_config(cfg).map_err(|e| e.to_string())?;
        // Preview always fetches the live remote copy unconditionally
        let fresh_ver = RemoteVersion {
            etag: None,
            modified: None,
            no_cond_read: true,
        };
        let local = self.storage.load_app_data();
        let local_bundle_hash = compute_bundle_hash(&local);

        match client.get(&fresh_ver).await {
            Ok(GetOutcome::NotFound) => {
                if cfg.follow_server {
                    return Err(
                        "There is no DeskTag backup on the server to follow yet".to_string(),
                    );
                }
                Ok(build_initial_upload_preview(
                    &local,
                    &local_bundle_hash,
                    cfg.follow_server,
                ))
            }
            Ok(GetOutcome::Data { bytes, version }) => {
                let remote_sum = sha256_hex(&bytes);
                let remote_data = match open_app_data(&bytes, &cfg.passphrase) {
                    Ok(d) => d,
                    Err(CryptoError::Corrupt) => {
                        if st.prev_hashes.is_some() && !cfg.follow_server {
                            if let Some(cached) =
                                load_cached_remote(&self.storage, &st.remote_sum)
                            {
                                if can_auto_rebuild_corrupt(&bytes, &cached) {
                                    open_app_data(&cached, &cfg.passphrase)
                                        .map_err(|e| e.to_string())?
                                } else {
                                    return Err(
                                        what_is(&bytes, None, &client.remote_rel_path()).message,
                                    );
                                }
                            } else {
                                return Err(
                                    what_is(&bytes, None, &client.remote_rel_path()).message,
                                );
                            }
                        } else {
                            return Err(what_is(&bytes, None, &client.remote_rel_path()).message);
                        }
                    }
                    Err(CryptoError::NotBackup) => {
                        return Err(what_is(&bytes, None, &client.remote_rel_path()).message);
                    }
                    Err(CryptoError::WrongPassphrase) => {
                        return Err(
                            "Incorrect encryption passphrase for the remote DeskTag backup"
                                .to_string(),
                        );
                    }
                    Err(CryptoError::NewerVersion) => {
                        return Err(
                            "Remote backup was created by a newer version of DeskTag; please update DeskTag"
                                .to_string(),
                        );
                    }
                    Err(e) => return Err(e.to_string()),
                };

                let outcome = merge_app_data_with_hashes(
                    &local,
                    &remote_data,
                    st.prev_hashes.as_ref(),
                    cfg.follow_server,
                );
                Ok(build_sync_preview(
                    &outcome,
                    &local_bundle_hash,
                    &remote_sum,
                    version.etag.as_deref(),
                    false,
                    cfg.follow_server,
                ))
            }
            Ok(GetOutcome::NotModified(_)) => {
                unreachable!("unconditional preview GET never sends conditional headers")
            }
            Err(e) => Err(e.to_string()),
        }
    }

    async fn execute_sync_once(
        &self,
        client: &WebDavClient,
        cfg: &WebDavConfig,
        st: &mut SyncState,
    ) -> Result<SyncStepOutput, SyncStepError> {
        let local = self.storage.load_app_data();
        let local_bundle_hash = compute_bundle_hash(&local);

        let get_outcome = client.get(&st.server).await.map_err(SyncStepError::Dav)?;
        // Persist 123pan no_cond_read discovery immediately onto state
        st.server.no_cond_read = st.server.no_cond_read || client.is_no_cond_read();

        let (remote_bytes, remote_ver) = match get_outcome {
            GetOutcome::NotModified(ver) => {
                st.server = ver.clone();
                if local_bundle_hash == st.local_bundle_hash && st.prev_hashes.is_some() {
                    // Fast-path: 304 Not Modified + unchanged local hash => 0 download, 0 decrypt, 0 upload!
                    return Ok(SyncStepOutput {
                        changed_local: false,
                        changed_remote: false,
                        data: None,
                        message: "Already up to date (304 Not Modified)".to_string(),
                    });
                }
                // Local changed while server stayed unchanged -> try cached remote ciphertext first!
                if let Some(cached) = load_cached_remote(&self.storage, &st.remote_sum) {
                    (cached, ver)
                } else {
                    // Cache missing or mismatched -> fall back to unconditional GET
                    let uncond = RemoteVersion {
                        etag: None,
                        modified: None,
                        no_cond_read: true,
                    };
                    match client.get(&uncond).await.map_err(SyncStepError::Dav)? {
                        GetOutcome::Data { bytes, version } => (bytes, version),
                        GetOutcome::NotFound => {
                            return self
                                .upload_initial_backup(client, cfg, st, &local, &local_bundle_hash)
                                .await;
                        }
                        GetOutcome::NotModified(_) => {
                            return Err(SyncStepError::Other(
                                "Unexpected 304 on unconditional GET".to_string(),
                            ));
                        }
                    }
                }
            }
            GetOutcome::NotFound => {
                return self
                    .upload_initial_backup(client, cfg, st, &local, &local_bundle_hash)
                    .await;
            }
            GetOutcome::Data { bytes, version } => (bytes, version),
        };

        let remote_sum = sha256_hex(&remote_bytes);

        // Full-body fast-path when ETag changed/absent but ciphertext and local state are identical
        if remote_sum == st.remote_sum
            && local_bundle_hash == st.local_bundle_hash
            && st.prev_hashes.is_some()
        {
            st.server = remote_ver;
            let _ = save_cached_remote(&self.storage, &remote_bytes);
            return Ok(SyncStepOutput {
                changed_local: false,
                changed_remote: false,
                data: None,
                message: "Already up to date".to_string(),
            });
        }

        // Open remote backup (with corrupt-prefix auto-rebuild!)
        let mut rebuilt = false;
        let remote_data = match open_app_data(&remote_bytes, &cfg.passphrase) {
            Ok(d) => d,
            Err(CryptoError::Corrupt) => {
                let mut recovered = None;
                if st.prev_hashes.is_some() && !cfg.follow_server {
                    if let Some(cached_good) = load_cached_remote(&self.storage, &st.remote_sum) {
                        if can_auto_rebuild_corrupt(&remote_bytes, &cached_good) {
                            let _ = save_rotating_snapshot(
                                &self.storage,
                                "server-damaged",
                                &remote_bytes,
                            );
                            if let Ok(d) = open_app_data(&cached_good, &cfg.passphrase) {
                                rebuilt = true;
                                recovered = Some(d);
                            }
                        }
                    }
                }
                match recovered {
                    Some(d) => d,
                    None => {
                        let warn = what_is(&remote_bytes, None, &client.remote_rel_path());
                        return Err(SyncStepError::ServerWarning(warn));
                    }
                }
            }
            Err(CryptoError::NotBackup) => {
                let warn = what_is(&remote_bytes, None, &client.remote_rel_path());
                return Err(SyncStepError::ServerWarning(warn));
            }
            Err(CryptoError::WrongPassphrase) => {
                return Err(SyncStepError::Other(
                    "Incorrect encryption passphrase: cannot decrypt remote DeskTag backup"
                        .to_string(),
                ));
            }
            Err(CryptoError::NewerVersion) => {
                return Err(SyncStepError::Other(
                    "Remote backup was created by a newer version of DeskTag; please update DeskTag"
                        .to_string(),
                ));
            }
            Err(e) => return Err(SyncStepError::Other(e.to_string())),
        };

        let outcome = merge_app_data_with_hashes(
            &local,
            &remote_data,
            st.prev_hashes.as_ref(),
            cfg.follow_server,
        );

        // Save displaced snapshots on conflict
        if outcome.conflict_count > 0 {
            if outcome.local_displaced {
                if let Ok(sealed_local) = seal_app_data(&local, &cfg.passphrase) {
                    let _ =
                        save_rotating_snapshot(&self.storage, "this-computer", &sealed_local);
                }
            }
            if outcome.remote_displaced {
                if let Ok(sealed_remote) = seal_app_data(&remote_data, &cfg.passphrase) {
                    let _ = save_rotating_snapshot(&self.storage, "server", &sealed_remote);
                }
            }
            st.conflict_notice = Some(ConflictNotice {
                at: now_iso(),
                summary: format!(
                    "Merged with {} conflict(s) (newer edits kept; displaced snapshot archived)",
                    outcome.conflict_count
                ),
                backup_dir: self.storage.sync_backup_dir().to_string_lossy().to_string(),
                conflict_count: outcome.conflict_count,
                restored: false,
                followed: cfg.follow_server,
            });
        }

        // Apply remote changes locally (keeping pre-sync safety snapshot for undo_sync)
        let mut final_data = outcome.merged.clone();
        if outcome.changed_local {
            let pre_sync_bytes = seal_app_data(&local, &cfg.passphrase)
                .map_err(|e| SyncStepError::Other(e.to_string()))?;
            let snapshot_path = save_rotating_snapshot(&self.storage, "before-sync", &pre_sync_bytes)
                .map_err(SyncStepError::Other)?;

            self.storage
                .save_app_data(final_data.clone())
                .map_err(SyncStepError::Other)?;
            final_data = self.storage.load_app_data();

            st.applied = Some(AppliedSync {
                at: now_iso(),
                snapshot_path: snapshot_path.to_string_lossy().to_string(),
                after_hashes: compute_item_hashes(&final_data),
                after_bundle_hash: compute_bundle_hash(&final_data),
            });
        }

        let needs_upload = (rebuilt || outcome.changed_remote) && !cfg.follow_server;
        if needs_upload {
            let sealed = seal_app_data(&final_data, &cfg.passphrase)
                .map_err(|e| SyncStepError::Other(e.to_string()))?;
            let put_ver = match client.put(&sealed, remote_ver.etag.as_deref()).await {
                Ok(v) => v,
                Err(DavError::PreconditionFailed) => {
                    return Err(SyncStepError::PreconditionFailed);
                }
                Err(e) => return Err(SyncStepError::Dav(e)),
            };
            let _ = save_cached_remote(&self.storage, &sealed);
            st.remote_sum = sha256_hex(&sealed);
            st.server = RemoteVersion {
                etag: put_ver.etag,
                modified: put_ver.modified,
                no_cond_read: put_ver.no_cond_read || remote_ver.no_cond_read,
            };
        } else {
            let _ = save_cached_remote(&self.storage, &remote_bytes);
            st.remote_sum = remote_sum;
            st.server = remote_ver;
        }

        st.prev_hashes = Some(compute_item_hashes(&final_data));
        st.local_bundle_hash = compute_bundle_hash(&final_data);

        let message = if rebuilt {
            "Rebuilt truncated remote backup and synced cleanly".to_string()
        } else if outcome.changed_local && needs_upload {
            format!(
                "Synced ({} uploaded, {} downloaded{})",
                outcome.to_upload_count,
                outcome.to_download_count,
                if outcome.conflict_count > 0 {
                    format!(", {} conflicts resolved", outcome.conflict_count)
                } else {
                    String::new()
                }
            )
        } else if outcome.changed_local {
            format!(
                "Downloaded {} change(s) from server",
                outcome.to_download_count.max(outcome.conflict_count)
            )
        } else if needs_upload {
            format!(
                "Uploaded {} change(s) to server",
                outcome.to_upload_count.max(outcome.conflict_count)
            )
        } else {
            "Already up to date".to_string()
        };

        Ok(SyncStepOutput {
            changed_local: outcome.changed_local,
            changed_remote: needs_upload,
            data: if outcome.changed_local {
                Some(final_data)
            } else {
                None
            },
            message,
        })
    }

    async fn upload_initial_backup(
        &self,
        client: &WebDavClient,
        cfg: &WebDavConfig,
        st: &mut SyncState,
        local: &AppData,
        local_bundle_hash: &str,
    ) -> Result<SyncStepOutput, SyncStepError> {
        if cfg.follow_server {
            return Err(SyncStepError::Other(
                "There is no DeskTag backup on the server to follow yet: sync another device first"
                    .to_string(),
            ));
        }
        let sealed = seal_app_data(local, &cfg.passphrase)
            .map_err(|e| SyncStepError::Other(e.to_string()))?;
        let put_ver = match client.put(&sealed, None).await {
            Ok(v) => v,
            Err(DavError::PreconditionFailed) => return Err(SyncStepError::PreconditionFailed),
            Err(e) => return Err(SyncStepError::Dav(e)),
        };
        let _ = save_cached_remote(&self.storage, &sealed);
        st.remote_sum = sha256_hex(&sealed);
        st.server = RemoteVersion {
            etag: put_ver.etag,
            modified: put_ver.modified,
            no_cond_read: put_ver.no_cond_read || st.server.no_cond_read,
        };
        st.prev_hashes = Some(compute_item_hashes(local));
        st.local_bundle_hash = local_bundle_hash.to_string();

        Ok(SyncStepOutput {
            changed_local: false,
            changed_remote: true,
            data: None,
            message: "Initialized DeskTag backup on WebDAV server".to_string(),
        })
    }

    pub async fn undo_sync(&self, force: bool) -> Result<SyncExecutionResult, String> {
        let _op = self.op_lock.lock().await;
        let _file_lock = acquire_os_sync_lock(&self.storage.active_dir()).await?;

        let cfg = self.storage.load_webdav_config();
        let mut st = load_sync_state(&self.storage);
        let key = state_key(&cfg);

        if st.key != key {
            let status = self.refresh_status_from_state(&cfg, &st, false).await;
            return Ok(SyncExecutionResult {
                ok: false,
                changed_local: false,
                changed_remote: false,
                data: None,
                status,
                message: "No sync snapshot available to undo".to_string(),
            });
        }

        let (snapshot_path, after_bundle_hash) = if let Some(ref applied) = st.applied {
            if Path::new(&applied.snapshot_path).is_file() {
                (
                    applied.snapshot_path.clone(),
                    Some(applied.after_bundle_hash.clone()),
                )
            } else if let Some(ref rpath) = st.restore_undo_file {
                (rpath.clone(), None)
            } else {
                let status = self.refresh_status_from_state(&cfg, &st, false).await;
                return Ok(SyncExecutionResult {
                    ok: false,
                    changed_local: false,
                    changed_remote: false,
                    data: None,
                    status,
                    message: "No sync snapshot available to undo".to_string(),
                });
            }
        } else if let Some(ref rpath) = st.restore_undo_file {
            if Path::new(rpath).is_file() {
                (rpath.clone(), None)
            } else {
                let status = self.refresh_status_from_state(&cfg, &st, false).await;
                return Ok(SyncExecutionResult {
                    ok: false,
                    changed_local: false,
                    changed_remote: false,
                    data: None,
                    status,
                    message: "No sync snapshot available to undo".to_string(),
                });
            }
        } else {
            let status = self.refresh_status_from_state(&cfg, &st, false).await;
            return Ok(SyncExecutionResult {
                ok: false,
                changed_local: false,
                changed_remote: false,
                data: None,
                status,
                message: "No sync snapshot available to undo".to_string(),
            });
        };

        let current_local = self.storage.load_app_data();
        if !force {
            if let Some(ref expected_after) = after_bundle_hash {
                let current_hash = compute_bundle_hash(&current_local);
                if !expected_after.is_empty() && current_hash != *expected_after {
                    let status = self.refresh_status_from_state(&cfg, &st, false).await;
                    return Ok(SyncExecutionResult {
                        ok: false,
                        changed_local: false,
                        changed_remote: false,
                        data: None,
                        status,
                        message: "Local data changed since the last sync; confirm force undo to overwrite recent local edits".to_string(),
                    });
                }
            }
        }

        let snap_bytes = fs::read(&snapshot_path)
            .map_err(|e| format!("failed to read pre-sync snapshot: {e}"))?;
        let restored = open_app_data(&snap_bytes, &cfg.passphrase)
            .map_err(|e| format!("failed to open pre-sync snapshot: {e}"))?;

        // Keep a copy of current local data before undoing
        if let Ok(cur_sealed) = seal_app_data(&current_local, &cfg.passphrase) {
            let _ = save_rotating_snapshot(&self.storage, "before-undo", &cur_sealed);
        }

        self.storage.save_app_data(restored.clone())?;
        let saved_local = self.storage.load_app_data();

        // Keep undo local: update local_bundle_hash and prev_hashes so the undo doesn't immediately overwrite other devices
        st.prev_hashes = Some(compute_item_hashes(&saved_local));
        st.local_bundle_hash = compute_bundle_hash(&saved_local);
        st.applied = None;
        st.restore_undo_file = None;
        st.conflict_notice = None;
        let _ = save_sync_state(&self.storage, &st);

        let status = self.refresh_status_from_state(&cfg, &st, false).await;
        self.emit_data_synced(&saved_local);

        Ok(SyncExecutionResult {
            ok: true,
            changed_local: true,
            changed_remote: false,
            data: Some(saved_local),
            status,
            message: "Undid last sync and restored pre-sync local snapshot".to_string(),
        })
    }

    pub async fn restore_from_server(&self) -> Result<SyncExecutionResult, String> {
        let _op = self.op_lock.lock().await;
        let _file_lock = acquire_os_sync_lock(&self.storage.active_dir()).await?;

        let cfg = self.storage.load_webdav_config();
        if cfg.url.trim().is_empty() {
            return Err("WebDAV sync is not configured".to_string());
        }
        let client = WebDavClient::from_config(&cfg).map_err(|e| e.to_string())?;

        self.set_syncing(true).await;

        let uncond = RemoteVersion {
            etag: None,
            modified: None,
            no_cond_read: true,
        };
        let mut st = load_sync_state(&self.storage);
        let key = state_key(&cfg);
        if st.key != key {
            st = SyncState {
                key,
                ..SyncState::default()
            };
        }

        let (remote_bytes, remote_ver) = match client.get(&uncond).await {
            Ok(GetOutcome::Data { bytes, version }) => (bytes, version),
            Ok(GetOutcome::NotFound) => {
                let msg = "No DeskTag backup exists on the WebDAV server to restore".to_string();
                st.last_error = Some(msg.clone());
                let _ = save_sync_state(&self.storage, &st);
                let status = self.refresh_status_from_state(&cfg, &st, false).await;
                return Ok(SyncExecutionResult {
                    ok: false,
                    changed_local: false,
                    changed_remote: false,
                    data: None,
                    status,
                    message: msg,
                });
            }
            Ok(GetOutcome::NotModified(_)) => {
                unreachable!("unconditional restore GET cannot return 304")
            }
            Err(e) => {
                let (msg, warning, rate_limit) = classify_sync_error(SyncStepError::Dav(e));
                *self.last_rate_limit.lock().await = rate_limit;
                st.last_error = Some(msg.clone());
                st.server_file_warning = warning;
                let _ = save_sync_state(&self.storage, &st);
                let status = self.refresh_status_from_state(&cfg, &st, false).await;
                return Ok(SyncExecutionResult {
                    ok: false,
                    changed_local: false,
                    changed_remote: false,
                    data: None,
                    status,
                    message: msg,
                });
            }
        };

        let remote_data = match open_app_data(&remote_bytes, &cfg.passphrase) {
            Ok(d) => d,
            Err(CryptoError::Corrupt | CryptoError::NotBackup) => {
                let warn = what_is(&remote_bytes, None, &client.remote_rel_path());
                let msg = warn.message.clone();
                st.last_error = Some(msg.clone());
                st.server_file_warning = Some(warn);
                let _ = save_sync_state(&self.storage, &st);
                let status = self.refresh_status_from_state(&cfg, &st, false).await;
                return Ok(SyncExecutionResult {
                    ok: false,
                    changed_local: false,
                    changed_remote: false,
                    data: None,
                    status,
                    message: msg,
                });
            }
            Err(e) => {
                let msg = e.to_string();
                st.last_error = Some(msg.clone());
                let _ = save_sync_state(&self.storage, &st);
                let status = self.refresh_status_from_state(&cfg, &st, false).await;
                return Ok(SyncExecutionResult {
                    ok: false,
                    changed_local: false,
                    changed_remote: false,
                    data: None,
                    status,
                    message: msg,
                });
            }
        };

        // Always save pre-restore local snapshot first
        let local_before = self.storage.load_app_data();
        let pre_restore_sealed =
            seal_app_data(&local_before, &cfg.passphrase).map_err(|e| e.to_string())?;
        let snap_path =
            save_rotating_snapshot(&self.storage, "before-restore", &pre_restore_sealed)?;

        self.storage.save_app_data(remote_data)?;
        let saved_local = self.storage.load_app_data();

        let _ = save_cached_remote(&self.storage, &remote_bytes);
        let hashes = compute_item_hashes(&saved_local);
        let bundle_hash = compute_bundle_hash(&saved_local);
        let snap_str = snap_path.to_string_lossy().to_string();

        st.remote_sum = sha256_hex(&remote_bytes);
        st.server = RemoteVersion {
            etag: remote_ver.etag,
            modified: remote_ver.modified,
            no_cond_read: st.server.no_cond_read || remote_ver.no_cond_read,
        };
        st.prev_hashes = Some(hashes.clone());
        st.local_bundle_hash = bundle_hash.clone();
        st.restore_undo_file = Some(snap_str.clone());
        st.applied = Some(AppliedSync {
            at: now_iso(),
            snapshot_path: snap_str,
            after_hashes: hashes,
            after_bundle_hash: bundle_hash,
        });
        st.conflict_notice = Some(ConflictNotice {
            at: now_iso(),
            summary: "Restored full state from WebDAV server (local copy archived before restore)"
                .to_string(),
            backup_dir: self.storage.sync_backup_dir().to_string_lossy().to_string(),
            conflict_count: 0,
            restored: true,
            followed: cfg.follow_server,
        });
        st.last_sync_at = Some(now_iso());
        st.last_error = None;
        st.server_file_warning = None;
        let _ = save_sync_state(&self.storage, &st);

        let status = self.refresh_status_from_state(&cfg, &st, false).await;
        self.emit_data_synced(&saved_local);

        Ok(SyncExecutionResult {
            ok: true,
            changed_local: true,
            changed_remote: false,
            data: Some(saved_local),
            status,
            message: "Restored DeskTag data from WebDAV server".to_string(),
        })
    }

    pub async fn force_upload(&self) -> Result<SyncExecutionResult, String> {
        let _op = self.op_lock.lock().await;
        let _file_lock = acquire_os_sync_lock(&self.storage.active_dir()).await?;

        let cfg = self.storage.load_webdav_config();
        if cfg.url.trim().is_empty() {
            return Err("WebDAV sync is not configured".to_string());
        }
        let client = WebDavClient::from_config(&cfg).map_err(|e| e.to_string())?;
        self.set_syncing(true).await;

        let mut st = load_sync_state(&self.storage);
        let key = state_key(&cfg);
        if st.key != key {
            st = SyncState {
                key,
                ..SyncState::default()
            };
        }

        // Inspect existing remote file first (Magpie safety guard: never overwrite wrong-passphrase, newer-version, or HTML/XML endpoints)
        let uncond = RemoteVersion {
            etag: None,
            modified: None,
            no_cond_read: true,
        };
        let remote_etag = match client.get(&uncond).await {
            Ok(GetOutcome::NotFound) => None,
            Ok(GetOutcome::Data { bytes, version }) => {
                match open_app_data(&bytes, &cfg.passphrase) {
                    Ok(_) => {
                        // Valid backup opened with same passphrase: save aside before overwriting
                        if !bytes.is_empty() {
                            save_rotating_snapshot(&self.storage, "server-replaced", &bytes)?;
                        }
                    }
                    Err(CryptoError::WrongPassphrase) => {
                        let msg = "Refused to overwrite: remote file is a valid DeskTag backup encrypted with a different passphrase".to_string();
                        st.last_error = Some(msg.clone());
                        let _ = save_sync_state(&self.storage, &st);
                        let status = self.refresh_status_from_state(&cfg, &st, false).await;
                        return Ok(SyncExecutionResult {
                            ok: false,
                            changed_local: false,
                            changed_remote: false,
                            data: None,
                            status,
                            message: msg,
                        });
                    }
                    Err(CryptoError::NewerVersion) => {
                        let msg = "Refused to overwrite: remote file was created by a newer version of DeskTag".to_string();
                        st.last_error = Some(msg.clone());
                        let _ = save_sync_state(&self.storage, &st);
                        let status = self.refresh_status_from_state(&cfg, &st, false).await;
                        return Ok(SyncExecutionResult {
                            ok: false,
                            changed_local: false,
                            changed_remote: false,
                            data: None,
                            status,
                            message: msg,
                        });
                    }
                    Err(CryptoError::Corrupt | CryptoError::NotBackup) => {
                        let warn = what_is(&bytes, None, &client.remote_rel_path());
                        if !warn.can_replace {
                            let msg = format!(
                                "Refused to overwrite non-file server endpoint: {}",
                                warn.message
                            );
                            st.last_error = Some(msg.clone());
                            st.server_file_warning = Some(warn);
                            let _ = save_sync_state(&self.storage, &st);
                            let status = self.refresh_status_from_state(&cfg, &st, false).await;
                            return Ok(SyncExecutionResult {
                                ok: false,
                                changed_local: false,
                                changed_remote: false,
                                data: None,
                                status,
                                message: msg,
                            });
                        }
                        if !bytes.is_empty() {
                            save_rotating_snapshot(&self.storage, "server-replaced", &bytes)?;
                        }
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        st.last_error = Some(msg.clone());
                        let _ = save_sync_state(&self.storage, &st);
                        let status = self.refresh_status_from_state(&cfg, &st, false).await;
                        return Ok(SyncExecutionResult {
                            ok: false,
                            changed_local: false,
                            changed_remote: false,
                            data: None,
                            status,
                            message: msg,
                        });
                    }
                }
                version.etag
            }
            Ok(GetOutcome::NotModified(_)) => None,
            Err(DavError::NotBackup(warn)) => {
                let msg = format!(
                    "Refused to overwrite non-file server endpoint: {}",
                    warn.message
                );
                st.last_error = Some(msg.clone());
                st.server_file_warning = Some(warn);
                let _ = save_sync_state(&self.storage, &st);
                let status = self.refresh_status_from_state(&cfg, &st, false).await;
                return Ok(SyncExecutionResult {
                    ok: false,
                    changed_local: false,
                    changed_remote: false,
                    data: None,
                    status,
                    message: msg,
                });
            }
            Err(e) => {
                let (msg, warning, rate_limit) = classify_sync_error(SyncStepError::Dav(e));
                *self.last_rate_limit.lock().await = rate_limit;
                st.last_error = Some(msg.clone());
                st.server_file_warning = warning;
                let _ = save_sync_state(&self.storage, &st);
                let status = self.refresh_status_from_state(&cfg, &st, false).await;
                return Ok(SyncExecutionResult {
                    ok: false,
                    changed_local: false,
                    changed_remote: false,
                    data: None,
                    status,
                    message: msg,
                });
            }
        };

        let local = self.storage.load_app_data();
        let sealed = seal_app_data(&local, &cfg.passphrase).map_err(|e| e.to_string())?;
        let put_ver = match client.put(&sealed, remote_etag.as_deref()).await {
            Ok(v) => v,
            Err(e) => {
                let (msg, warning, rate_limit) = classify_sync_error(SyncStepError::Dav(e));
                *self.last_rate_limit.lock().await = rate_limit;
                st.last_error = Some(msg.clone());
                st.server_file_warning = warning;
                let _ = save_sync_state(&self.storage, &st);
                let status = self.refresh_status_from_state(&cfg, &st, false).await;
                return Ok(SyncExecutionResult {
                    ok: false,
                    changed_local: false,
                    changed_remote: false,
                    data: None,
                    status,
                    message: msg,
                });
            }
        };

        let _ = save_cached_remote(&self.storage, &sealed);
        st.remote_sum = sha256_hex(&sealed);
        st.server = RemoteVersion {
            etag: put_ver.etag,
            modified: put_ver.modified,
            no_cond_read: st.server.no_cond_read || put_ver.no_cond_read,
        };
        st.prev_hashes = Some(compute_item_hashes(&local));
        st.local_bundle_hash = compute_bundle_hash(&local);
        st.last_sync_at = Some(now_iso());
        st.last_error = None;
        st.server_file_warning = None;
        let _ = save_sync_state(&self.storage, &st);

        let status = self.refresh_status_from_state(&cfg, &st, false).await;
        Ok(SyncExecutionResult {
            ok: true,
            changed_local: false,
            changed_remote: true,
            data: None,
            status,
            message: "Uploaded local DeskTag data to WebDAV server".to_string(),
        })
    }

    pub async fn export_setup_text(&self) -> Result<String, String> {
        let cfg = self.storage.load_webdav_config();
        if cfg.url.trim().is_empty() {
            return Err("Configure WebDAV server URL before exporting setup text".to_string());
        }
        if cfg.passphrase.is_empty() {
            return Err(
                "Set an encryption passphrase before exporting a one-paste setup string"
                    .to_string(),
            );
        }
        let payload = SetupPayload {
            url: cfg.url,
            username: cfg.username,
            password: cfg.password,
            remote_dir: normalize_remote_dir(&cfg.remote_dir),
        };
        crypto_export_setup(&payload, &cfg.passphrase).map_err(|e| e.to_string())
    }

    pub async fn import_setup_text(
        &self,
        setup_text: String,
        passphrase: String,
    ) -> Result<WebDavConfigView, String> {
        if passphrase.is_empty() {
            return Err("Encryption passphrase is required to decrypt setup text".to_string());
        }
        let payload = crypto_import_setup(&setup_text, &passphrase).map_err(|e| match e {
            CryptoError::WrongPassphrase => {
                "Incorrect passphrase: could not decrypt setup text".to_string()
            }
            CryptoError::NotBackup => {
                "Input is not a valid DeskTag sync setup string (expected desktag-sync:...)"
                    .to_string()
            }
            other => other.to_string(),
        })?;

        if !payload.password.is_empty() && passphrase == payload.password {
            return Err(
                "Encryption passphrase must differ from WebDAV login password".to_string(),
            );
        }

        let _op = self.op_lock.lock().await;
        let _file_lock = acquire_os_sync_lock(&self.storage.active_dir()).await?;

        let prev = self.storage.load_webdav_config();
        let next = WebDavConfig {
            enabled: true,
            url: payload.url.trim().to_string(),
            username: payload.username.trim().to_string(),
            password: payload.password,
            passphrase,
            remote_dir: normalize_remote_dir(&payload.remote_dir),
            auto_sync_minutes: prev.auto_sync_minutes,
            debounce_push: prev.debounce_push,
            follow_server: prev.follow_server,
        };

        // Validate URL format
        WebDavClient::from_config(&next).map_err(|e| e.to_string())?;
        self.storage.save_webdav_config(&next)?;

        let sync_state = load_sync_state(&self.storage);
        self.refresh_status_from_state(&next, &sync_state, false)
            .await;
        self.config_notify.notify_one();
        Ok(next.to_view())
    }

    pub async fn trigger_debounced_sync(&self) -> Result<(), String> {
        let cfg = self.storage.load_webdav_config();
        if !cfg.enabled || !cfg.is_configured() || !cfg.debounce_push || cfg.follow_server {
            return Ok(());
        }
        self.debounce_pending.store(true, Ordering::SeqCst);
        self.debounce_notify.notify_one();
        Ok(())
    }
}

struct SyncStepOutput {
    changed_local: bool,
    changed_remote: bool,
    data: Option<AppData>,
    message: String,
}

enum SyncStepError {
    PreconditionFailed,
    Dav(DavError),
    ServerWarning(ServerFileWarning),
    Other(String),
}

fn classify_sync_error(
    err: SyncStepError,
) -> (String, Option<ServerFileWarning>, Option<Option<Duration>>) {
    match err {
        SyncStepError::PreconditionFailed => (
            "Remote file changed concurrently on the WebDAV server (HTTP 412); please sync again"
                .to_string(),
            None,
            None,
        ),
        SyncStepError::ServerWarning(w) => (w.message.clone(), Some(w), None),
        SyncStepError::Dav(DavError::NotBackup(w)) => (w.message.clone(), Some(w), None),
        SyncStepError::Dav(DavError::RateLimited {
            status,
            retry_after,
        }) => {
            let extra = retry_after
                .map(|d| format!(" (retry after {}s)", d.as_secs()))
                .unwrap_or_default();
            (
                format!(
                    "WebDAV server is rate-limiting requests (HTTP {status}){extra}; auto-sync will back off"
                ),
                None,
                Some(retry_after),
            )
        }
        SyncStepError::Dav(e) => (e.to_string(), None, None),
        SyncStepError::Other(msg) => (msg, None, None),
    }
}

fn status_from_config_and_state(
    cfg: &WebDavConfig,
    st: &SyncState,
    syncing: bool,
    next_auto_sync_at: Option<String>,
) -> WebDavStatusView {
    let matches_key = !cfg.url.trim().is_empty() && st.key == state_key(cfg);
    WebDavStatusView {
        enabled: cfg.enabled,
        configured: cfg.is_configured(),
        syncing,
        last_sync_at: if matches_key {
            st.last_sync_at.clone()
        } else {
            None
        },
        last_error: if matches_key {
            st.last_error.clone()
        } else {
            None
        },
        server_file_warning: if matches_key {
            st.server_file_warning.clone()
        } else {
            None
        },
        conflict_notice: if matches_key {
            st.conflict_notice.clone()
        } else {
            None
        },
        can_undo: matches_key && st.has_undo(),
        next_auto_sync_at,
        backend_hint: infer_backend_hint(&cfg.url),
    }
}

/// Magpie `sameAccount` guard: scheme + host (case-insensitive) + port + username must match
/// before a previously saved password may be reused across edits.
fn same_account(prev_url: &str, prev_user: &str, next_url: &str, next_user: &str) -> bool {
    let Ok(a) = Url::parse(prev_url.trim()) else {
        return false;
    };
    let Ok(b) = Url::parse(next_url.trim()) else {
        return false;
    };
    let Some(host_a) = a.host_str() else {
        return false;
    };
    let Some(host_b) = b.host_str() else {
        return false;
    };
    a.scheme().eq_ignore_ascii_case(b.scheme())
        && host_a.eq_ignore_ascii_case(host_b)
        && a.port_or_known_default() == b.port_or_known_default()
        && prev_user.trim() == next_user.trim()
}

fn merge_config_input(
    prev: &WebDavConfig,
    input: &WebDavConfigInput,
) -> Result<WebDavConfig, String> {
    let url = input.url.trim().to_string();
    let username = input.username.trim().to_string();

    if !url.is_empty() {
        let parsed = Url::parse(&url).map_err(|e| format!("Invalid WebDAV URL: {e}"))?;
        if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
            return Err("WebDAV URL must start with https:// or http://".to_string());
        }
    }

    let is_same_account = same_account(&prev.url, &prev.username, &url, &username);

    let password = if input.clear_password.unwrap_or(false) {
        String::new()
    } else if let Some(ref p) = input.password {
        if !p.is_empty() {
            p.clone()
        } else if prev.password.is_empty() {
            String::new()
        } else if is_same_account {
            prev.password.clone()
        } else if username.is_empty() && !prev.username.trim().is_empty() {
            String::new()
        } else {
            return Err(
                "Please enter the password for this WebDAV account: the saved password is only reused for the same server and username"
                    .to_string(),
            );
        }
    } else if prev.password.is_empty() {
        String::new()
    } else if is_same_account {
        prev.password.clone()
    } else if username.is_empty() && !prev.username.trim().is_empty() {
        String::new()
    } else {
        return Err(
            "Please enter the password for this WebDAV account: the saved password is only reused for the same server and username"
                .to_string(),
        );
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

    if !passphrase.is_empty() && !password.is_empty() && passphrase == password {
        return Err(
            "Encryption passphrase must differ from WebDAV login password (the server receives the login password and could otherwise decrypt your backup)"
                .to_string(),
        );
    }

    Ok(WebDavConfig {
        enabled: input.enabled,
        url,
        username,
        password,
        passphrase,
        remote_dir: normalize_remote_dir(&input.remote_dir),
        auto_sync_minutes: input.auto_sync_minutes,
        debounce_push: input.debounce_push,
        follow_server: input.follow_server,
    })
}

// ===========================================================================
// Comprehensive Unit & Local TCP Mock-WebDAV Integration Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{SocketAddr, TcpListener, TcpStream};
    use std::sync::{Arc as StdArc, Mutex as StdMutex};
    use std::thread;

    use flate2::write::GzEncoder;
    use flate2::Compression;
    use md5::Md5;
    use reqwest::header::{HeaderMap, HeaderValue, DATE, LAST_MODIFIED};
    use sha2::{Digest, Sha256};

    use crate::models::{NoteItem, SyncedSettings, TodoItem, TodoPriority};
    use crate::webdav::client::{
        parse_digest_challenges, parse_retry_after, version_from_headers, REMOTE_FILE_NAME,
    };
    use crate::webdav::crypto::{
        open_app_data, seal_app_data, EncryptedEnvelope, DEFAULT_ITERATIONS, ENVELOPE_FORMAT,
        PLAIN_ENVELOPE_FORMAT, SETUP_PREFIX,
    };
    use crate::webdav::merge::{load_sync_state, merge_app_data};

    // -----------------------------------------------------------------------
    // Mock WebDAV HTTP/1.1 Server over std::net::TcpListener
    // -----------------------------------------------------------------------

    #[derive(Debug, Clone)]
    struct MockRequest {
        method: String,
        path: String,
        headers: HashMap<String, String>,
        body: Vec<u8>,
    }

    #[derive(Debug, Clone)]
    struct MockResponse {
        status: u16,
        reason: String,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    }

    impl MockResponse {
        fn new(status: u16, reason: &str, body: Vec<u8>) -> Self {
            Self {
                status,
                reason: reason.to_string(),
                headers: Vec::new(),
                body,
            }
        }
        fn header(mut self, k: &str, v: &str) -> Self {
            self.headers.push((k.to_string(), v.to_string()));
            self
        }
    }

    struct MockServer {
        addr: SocketAddr,
        stop: StdArc<AtomicBool>,
        requests: StdArc<StdMutex<Vec<MockRequest>>>,
    }

    impl MockServer {
        fn start<F>(handler: F) -> Self
        where
            F: Fn(&MockRequest) -> MockResponse + Send + Sync + 'static,
        {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
            let addr = listener.local_addr().expect("local addr");
            listener
                .set_nonblocking(true)
                .expect("set nonblocking");
            let stop = StdArc::new(AtomicBool::new(false));
            let requests = StdArc::new(StdMutex::new(Vec::new()));

            let stop_bg = StdArc::clone(&stop);
            let reqs_bg = StdArc::clone(&requests);
            let handler = StdArc::new(handler);

            thread::spawn(move || {
                while !stop_bg.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            // On Windows, accepted sockets inherit non-blocking mode from the listener.
                            let _ = stream.set_nonblocking(false);
                            let h = StdArc::clone(&handler);
                            let rlog = StdArc::clone(&reqs_bg);
                            thread::spawn(move || handle_connection(stream, &*h, &rlog));
                        }
                        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(_) => break,
                    }
                }
            });

            Self {
                addr,
                stop,
                requests,
            }
        }

        fn url(&self, path: &str) -> String {
            format!("http://{}{}", self.addr, path)
        }

        fn recorded_requests(&self) -> Vec<MockRequest> {
            self.requests.lock().unwrap().clone()
        }
    }

    impl Drop for MockServer {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Relaxed);
        }
    }

    fn handle_connection<F>(
        mut stream: TcpStream,
        handler: &F,
        log: &StdArc<StdMutex<Vec<MockRequest>>>,
    ) where
        F: Fn(&MockRequest) -> MockResponse,
    {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
        let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));

        let mut req_line = String::new();
        if reader.read_line(&mut req_line).unwrap_or(0) == 0 {
            return;
        }
        let mut parts = req_line.split_whitespace();
        let method = parts.next().unwrap_or("").to_string();
        let path = parts.next().unwrap_or("/").to_string();

        let mut headers = HashMap::new();
        let mut content_length = 0usize;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 {
                break;
            }
            let trimmed = line.trim_end_matches(['\r', '\n']);
            if trimmed.is_empty() {
                break;
            }
            if let Some((k, v)) = trimmed.split_once(':') {
                let kl = k.trim().to_ascii_lowercase();
                let vv = v.trim().to_string();
                if kl == "content-length" {
                    content_length = vv.parse().unwrap_or(0);
                }
                headers.insert(kl, vv);
            }
        }

        let mut body = vec![0u8; content_length];
        if content_length > 0 && reader.read_exact(&mut body).is_err() {
            return;
        }

        let req = MockRequest {
            method,
            path,
            headers,
            body,
        };
        log.lock().unwrap().push(req.clone());

        let resp = handler(&req);
        let mut raw = format!("HTTP/1.1 {} {}\r\n", resp.status, resp.reason);
        let has_cl = resp
            .headers
            .iter()
            .any(|(k, _)| k.eq_ignore_ascii_case("content-length"));
        for (k, v) in &resp.headers {
            raw.push_str(&format!("{k}: {v}\r\n"));
        }
        if !has_cl {
            raw.push_str(&format!("Content-Length: {}\r\n", resp.body.len()));
        }
        raw.push_str("Connection: close\r\n\r\n");

        let _ = stream.write_all(raw.as_bytes());
        if req.method != "HEAD" {
            let _ = stream.write_all(&resp.body);
        }
        let _ = stream.flush();
    }

    fn temp_storage(label: &str) -> Arc<StorageManager> {
        let dir = std::env::temp_dir().join(format!(
            "desktag-webdav-test-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        Arc::new(StorageManager::new(dir))
    }

    fn sample_todo(id: &str, title: &str, updated_at: &str) -> TodoItem {
        TodoItem {
            id: id.to_string(),
            title: title.to_string(),
            notes: String::new(),
            note_images: Vec::new(),
            completed: false,
            completed_at: None,
            priority: TodoPriority::Medium,
            due_date: None,
            due_time: None,
            end_date: None,
            list_id: None,
            tags: Vec::new(),
            subtasks: Vec::new(),
            repeat_rule: None,
            reminder_rule: None,
            quadrant_override: None,
            links: Vec::new(),
            sort_order: 1.0,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: updated_at.to_string(),
            deleted_at: None,
        }
    }

    fn sample_note(id: &str, title: &str, updated_at: &str) -> NoteItem {
        NoteItem {
            id: id.to_string(),
            title: title.to_string(),
            kind: crate::models::NoteKind::Normal,
            content: format!("content of {title}"),
            timeline_entries: Vec::new(),
            attachments: Vec::new(),
            links: Vec::new(),
            group_id: None,
            pinned_to_side: false,
            tab_width: None,
            sort_order: 1.0,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: updated_at.to_string(),
            deleted_at: None,
        }
    }

    fn make_config_input(url: &str, user: &str, pass: &str, passphrase: &str) -> WebDavConfigInput {
        WebDavConfigInput {
            enabled: true,
            url: url.to_string(),
            username: user.to_string(),
            password: Some(pass.to_string()),
            passphrase: Some(passphrase.to_string()),
            clear_password: Some(false),
            clear_passphrase: Some(false),
            remote_dir: "desktag".to_string(),
            auto_sync_minutes: 3,
            debounce_push: true,
            follow_server: false,
        }
    }

    // -----------------------------------------------------------------------
    // 1. Crypto, AAD, Error Classes, BOM & SetupText Tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_crypto_seal_open_roundtrip_salt_reuse_and_fresh_nonce() {
        let mut data = AppData::default();
        data.todos
            .push(sample_todo("t1", "Buy milk", "2026-05-01T10:00:00Z"));
        let pass = "strong-passphrase-unit-test";

        let sealed1 = seal_app_data(&data, pass).expect("seal 1");
        let sealed2 = seal_app_data(&data, pass).expect("seal 2 (cached key)");

        let env1: EncryptedEnvelope = serde_json::from_slice(&sealed1).expect("parse env1");
        let env2: EncryptedEnvelope = serde_json::from_slice(&sealed2).expect("parse env2");

        assert_eq!(env1.format, ENVELOPE_FORMAT);
        assert_eq!(env1.version, 1);
        assert_eq!(env1.kdf, "pbkdf2-sha256");
        assert_eq!(env1.iterations, DEFAULT_ITERATIONS);
        // Same process reuses per-passphrase salt, but ALWAYS generates a fresh random 12-byte nonce
        assert_eq!(env1.salt, env2.salt);
        assert_ne!(env1.nonce, env2.nonce);

        let opened = open_app_data(&sealed1, pass).expect("open 1");
        assert_eq!(opened.todos.len(), 1);
        assert_eq!(opened.todos[0].title, "Buy milk");

        // UTF-8 BOM stripped cleanly before parsing
        let mut with_bom = vec![0xEF, 0xBB, 0xBF];
        with_bom.extend_from_slice(&sealed2);
        let opened_bom = open_app_data(&with_bom, pass).expect("open BOM");
        assert_eq!(opened_bom.todos[0].id, "t1");
    }

    #[test]
    fn test_crypto_plain_envelope_when_passphrase_empty() {
        let mut data = AppData::default();
        data.notes
            .push(sample_note("n1", "Plain note", "2026-05-01T10:00:00Z"));
        let bytes = seal_app_data(&data, "").expect("seal plain");
        let val: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(val["format"], PLAIN_ENVELOPE_FORMAT);
        assert_eq!(val["version"], 1);

        let opened = open_app_data(&bytes, "").expect("open plain");
        assert_eq!(opened.notes[0].title, "Plain note");
    }

    #[test]
    fn test_crypto_aad_tamper_and_four_error_classes() {
        let data = AppData::default();
        let pass = "secret-e2ee-pass";
        let sealed = seal_app_data(&data, pass).unwrap();

        // WrongPassphrase
        assert!(matches!(
            open_app_data(&sealed, "wrong-pass"),
            Err(CryptoError::WrongPassphrase)
        ));
        assert!(matches!(
            open_app_data(&sealed, ""),
            Err(CryptoError::WrongPassphrase)
        ));

        // AAD binding check: changing iterations (still valid range) breaks GCM tag!
        let mut env: EncryptedEnvelope = serde_json::from_slice(&sealed).unwrap();
        env.iterations = 600_001;
        let tampered = serde_json::to_vec(&env).unwrap();
        assert!(matches!(
            open_app_data(&tampered, pass),
            Err(CryptoError::WrongPassphrase)
        ));

        // Corrupt: iterations out of bounds [100_000, 10_000_000]
        let mut low_iter: EncryptedEnvelope = serde_json::from_slice(&sealed).unwrap();
        low_iter.iterations = 10_000;
        assert!(matches!(
            open_app_data(&serde_json::to_vec(&low_iter).unwrap(), pass),
            Err(CryptoError::Corrupt)
        ));

        // Corrupt: truncated JSON starting with {"format":"desktag-backup"
        let truncated = &sealed[..sealed.len() / 2];
        assert!(matches!(
            open_app_data(truncated, pass),
            Err(CryptoError::Corrupt)
        ));

        // NewerVersion: version != 1 or kdf != pbkdf2-sha256
        let mut newer: serde_json::Value = serde_json::from_slice(&sealed).unwrap();
        newer["version"] = serde_json::json!(2);
        assert!(matches!(
            open_app_data(&serde_json::to_vec(&newer).unwrap(), pass),
            Err(CryptoError::NewerVersion)
        ));

        // NotBackup: HTML / foreign JSON
        assert!(matches!(
            open_app_data(b"<html><title>Login</title></html>", pass),
            Err(CryptoError::NotBackup)
        ));
        assert!(matches!(
            open_app_data(br#"{"format":"other-app","version":1}"#, pass),
            Err(CryptoError::NotBackup)
        ));
    }

    #[test]
    fn test_crypto_setup_text_roundtrip_and_wrapping() {
        let payload = SetupPayload {
            url: "https://dav.jianguoyun.com/dav/".to_string(),
            username: "alice@example.com".to_string(),
            password: "app-specific-password".to_string(),
            remote_dir: "desktag-work".to_string(),
        };
        let pass = "setup-passphrase-123";
        let text = crypto_export_setup(&payload, pass).expect("export setup");
        assert!(text.starts_with(SETUP_PREFIX));
        // Passphrase is NEVER embedded in plaintext
        assert!(!text.contains(pass));

        // Simulate chat message prefix and line breaks
        let wrapped = format!(
            "Here is my sync config:\n{}\n{}\nThanks!",
            &text[..40],
            &text[40..]
        );
        let decoded = crypto_import_setup(&wrapped, pass).expect("import setup");
        assert_eq!(decoded, payload);

        // Wrong passphrase
        assert!(matches!(
            crypto_import_setup(&text, "bad-pass"),
            Err(CryptoError::WrongPassphrase)
        ));
    }

    // -----------------------------------------------------------------------
    // 2. RFC 7616 Digest Auth + WebDAV Client Quirk Tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_digest_parser_prefers_sha256_and_supports_sess() {
        let hdrs = [
            r#"Digest realm="dav", nonce="n1", qop="auth", algorithm=MD5"#,
            r#"Digest realm="dav", nonce="n2", qop="auth,auth-int", algorithm=SHA-256, opaque="op1""#,
        ];
        let ch = parse_digest_challenges(hdrs).expect("parsed challenge");
        let auth = ch.authorize("GET", "/dav/desktag/file", "alice", "pw", 1);
        assert!(auth.contains("algorithm=SHA-256"));
        assert!(auth.contains("qop=auth"));
        assert!(auth.contains("nc=00000001"));
        assert!(auth.contains(r#"opaque="op1""#));

        let sess = parse_digest_challenges([
            r#"Digest realm="r", nonce="n3", qop="auth", algorithm="MD5-sess""#,
        ])
        .expect("md5-sess");
        let auth_sess = sess.authorize("PUT", "/dav/a", "u", "p", 2);
        assert!(auth_sess.contains("algorithm=MD5-sess"));
        assert!(auth_sess.contains("nc=00000002"));
    }

    #[tokio::test]
    async fn test_client_rfc7616_digest_auth_caching_and_nc_increment() {
        let realm = "DeskTagDAV";
        let nonce = "abcdef0123456789";
        let user = "bob";
        let pass = "hunter2";

        let server = MockServer::start(move |req| {
            let Some(auth) = req.headers.get("authorization") else {
                return MockResponse::new(401, "Unauthorized", Vec::new())
                    .header(
                        "WWW-Authenticate",
                        &format!(
                            r#"Digest realm="{realm}", nonce="{nonce}", qop="auth", algorithm=MD5"#
                        ),
                    )
                    .header(
                        "WWW-Authenticate",
                        &format!(
                            r#"Digest realm="{realm}", nonce="{nonce}", qop="auth", algorithm=SHA-256"#
                        ),
                    );
            };
            if auth.starts_with("Basic ") {
                return MockResponse::new(401, "Unauthorized", Vec::new()).header(
                    "WWW-Authenticate",
                    &format!(
                        r#"Digest realm="{realm}", nonce="{nonce}", qop="auth", algorithm=SHA-256"#
                    ),
                );
            }
            // Verify RFC 7616 SHA-256 Digest response
            assert!(auth.starts_with("Digest "));
            assert!(auth.contains("algorithm=SHA-256"));
            let cnonce = extract_quoted(auth, "cnonce").unwrap();
            let nc = extract_unquoted(auth, "nc").unwrap();
            let resp_got = extract_quoted(auth, "response").unwrap();

            let h = |s: &str| hex::encode(Sha256::digest(s.as_bytes()));
            let ha1 = h(&format!("{user}:{realm}:{pass}"));
            let ha2 = h(&format!("{}:{}", req.method, req.path));
            let expected = h(&format!("{ha1}:{nonce}:{nc}:{cnonce}:auth:{ha2}"));
            assert_eq!(resp_got, expected, "Digest SHA-256 response mismatch");

            if req.method == "PROPFIND" {
                MockResponse::new(207, "Multi-Status", b"<d:multistatus/>".to_vec())
            } else {
                MockResponse::new(404, "Not Found", Vec::new())
            }
        });

        let client = WebDavClient::new(&server.url("/dav"), "desktag", user, pass).unwrap();
        // First request triggers Basic -> 401 -> Digest SHA-256 (nc=00000001)
        let r1 = client.get(&RemoteVersion::default()).await.unwrap();
        assert!(matches!(r1, GetOutcome::NotFound));
        // Second request uses cached Digest directly with nc=00000002 (no Basic sent!)
        let r2 = client.get(&RemoteVersion::default()).await.unwrap();
        assert!(matches!(r2, GetOutcome::NotFound));

        let reqs = server.recorded_requests();
        assert_eq!(reqs.len(), 3);
        assert!(reqs[0].headers["authorization"].starts_with("Basic "));
        assert!(reqs[1].headers["authorization"].contains("nc=00000001"));
        assert!(reqs[2].headers["authorization"].contains("nc=00000002"));
    }

    fn extract_quoted(s: &str, key: &str) -> Option<String> {
        let pat = format!("{key}=\"");
        let start = s.find(&pat)? + pat.len();
        let end = s[start..].find('"')? + start;
        Some(s[start..end].to_string())
    }

    fn extract_unquoted(s: &str, key: &str) -> Option<String> {
        let pat = format!("{key}=");
        let start = s.find(&pat)? + pat.len();
        let end = s[start..]
            .find(',')
            .map(|i| start + i)
            .unwrap_or(s.len());
        Some(s[start..end].trim().to_string())
    }

    #[tokio::test]
    async fn test_client_nutstore_409_get_and_head0_propfind_fallback() {
        let dir_created = StdArc::new(AtomicBool::new(false));
        let stored = StdArc::new(StdMutex::new(Vec::<u8>::new()));
        let d_flag = StdArc::clone(&dir_created);
        let s_ref = StdArc::clone(&stored);

        let server = MockServer::start(move |req| match req.method.as_str() {
            "GET" => {
                if !d_flag.load(Ordering::SeqCst) {
                    // Nutstore returns 409 Conflict when folder does not exist yet
                    MockResponse::new(409, "Conflict", Vec::new())
                } else {
                    MockResponse::new(200, "OK", s_ref.lock().unwrap().clone())
                        .header("ETag", "\"nut-1\"")
                }
            }
            "PUT" => {
                if !d_flag.load(Ordering::SeqCst) {
                    return MockResponse::new(409, "Conflict", Vec::new());
                }
                *s_ref.lock().unwrap() = req.body.clone();
                MockResponse::new(201, "Created", Vec::new()).header("ETag", "\"nut-1\"")
            }
            "MKCOL" => {
                d_flag.store(true, Ordering::SeqCst);
                MockResponse::new(201, "Created", Vec::new())
            }
            "HEAD" => {
                // Nutstore quirk (#1259): HEAD returns Content-Length: 0 even for non-empty file!
                MockResponse::new(200, "OK", Vec::new())
                    .header("Content-Length", "0")
                    .header("ETag", "\"nut-1\"")
            }
            "PROPFIND" => {
                let len = s_ref.lock().unwrap().len();
                let xml = format!(
                    r#"<?xml version="1.0" encoding="utf-8"?>
                    <D:multistatus xmlns:D="DAV:">
                      <D:response>
                        <D:href>{}</D:href>
                        <D:propstat>
                          <D:prop><D:getcontentlength>{len}</D:getcontentlength></D:prop>
                          <D:status>HTTP/1.1 200 OK</D:status>
                        </D:propstat>
                      </D:response>
                    </D:multistatus>"#,
                    req.path
                );
                MockResponse::new(207, "Multi-Status", xml.into_bytes())
            }
            _ => MockResponse::new(405, "Method Not Allowed", Vec::new()),
        });

        let client = WebDavClient::new(&server.url("/dav"), "desktag", "u", "p").unwrap();
        let got = client.get(&RemoteVersion::default()).await.unwrap();
        assert!(matches!(got, GetOutcome::NotFound));

        let payload = b"{\"format\":\"desktag-plain\",\"version\":1,\"data\":{}}";
        let ver = client.put(payload, None).await.expect("PUT with HEAD=0 -> PROPFIND fallback");
        assert_eq!(ver.etag.as_deref(), Some("\"nut-1\""));

        let reqs = server.recorded_requests();
        assert!(reqs.iter().any(|r| r.method == "MKCOL"));
        assert!(reqs.iter().any(|r| r.method == "HEAD"));
        assert!(reqs.iter().any(|r| r.method == "PROPFIND"));
    }

    #[tokio::test]
    async fn test_client_123pan_500_flips_no_cond_read_and_persists() {
        let storage = temp_storage("123pan");
        let file_bytes = StdArc::new(StdMutex::new(None::<Vec<u8>>));
        let f_ref = StdArc::clone(&file_bytes);

        let server = MockServer::start(move |req| match req.method.as_str() {
            "GET" => {
                // 123pan quirk (#4993): conditional GET with If-None-Match returns 500!
                if req.headers.contains_key("if-none-match") {
                    return MockResponse::new(500, "Internal Server Error", Vec::new());
                }
                match f_ref.lock().unwrap().as_ref() {
                    Some(b) => MockResponse::new(200, "OK", b.clone()).header("ETag", "\"pan-1\""),
                    None => MockResponse::new(404, "Not Found", Vec::new()),
                }
            }
            "PUT" => {
                *f_ref.lock().unwrap() = Some(req.body.clone());
                MockResponse::new(201, "Created", Vec::new()).header("ETag", "\"pan-1\"")
            }
            "HEAD" => {
                let len = f_ref.lock().unwrap().as_ref().map(|b| b.len()).unwrap_or(0);
                MockResponse::new(200, "OK", Vec::new())
                    .header("Content-Length", &len.to_string())
                    .header("ETag", "\"pan-1\"")
            }
            _ => MockResponse::new(201, "Created", Vec::new()),
        });

        let mgr = WebDavManager::new(storage.clone());
        mgr.save_config(make_config_input(&server.url("/dav"), "u", "p", "pass-123"))
            .await
            .unwrap();

        // Sync 1: initial upload -> sets ETag "pan-1"
        let r1 = mgr.sync_now().await.unwrap();
        assert!(r1.ok);
        assert!(r1.changed_remote);

        // Sync 2: sends If-None-Match -> 500 -> immediately retries unconditionally & persists no_cond_read = true
        let r2 = mgr.sync_now().await.unwrap();
        assert!(r2.ok);
        let st = load_sync_state(&storage);
        assert!(st.server.no_cond_read, "no_cond_read must be persisted");

        let count_before_r3 = server.recorded_requests().len();
        // Sync 3: MUST NOT send If-None-Match at all!
        let r3 = mgr.sync_now().await.unwrap();
        assert!(r3.ok);
        let reqs_r3 = &server.recorded_requests()[count_before_r3..];
        assert!(reqs_r3
            .iter()
            .filter(|r| r.method == "GET")
            .all(|r| !r.headers.contains_key("if-none-match")));
    }

    #[tokio::test]
    async fn test_client_teracloud_gzip_and_zstd_transparent_unpack() {
        let mut data = AppData::default();
        data.todos
            .push(sample_todo("tz1", "Compressed task", "2026-05-01T12:00:00Z"));
        let plain_env = seal_app_data(&data, "pass-tera").unwrap();

        let mut gz = GzEncoder::new(Vec::new(), Compression::default());
        gz.write_all(&plain_env).unwrap();
        let gz_bytes = gz.finish().unwrap();

        let zstd_bytes = zstd::stream::encode_all(plain_env.as_slice(), 0).unwrap();

        let mode = StdArc::new(StdMutex::new(0u8));
        let m_ref = StdArc::clone(&mode);

        let server = MockServer::start(move |req| {
            // Verify client ALWAYS sends Accept-Encoding: identity on GET
            assert_eq!(
                req.headers.get("accept-encoding").map(String::as_str),
                Some("identity")
            );
            let cur = *m_ref.lock().unwrap();
            if cur == 0 {
                MockResponse::new(200, "OK", gz_bytes.clone())
                    .header("Content-Encoding", "gzip")
                    .header("ETag", "\"t-gz\"")
            } else {
                // Even without Content-Encoding header (proxy stripped it), zstd magic unpacks!
                MockResponse::new(200, "OK", zstd_bytes.clone()).header("ETag", "\"t-zst\"")
            }
        });

        let client = WebDavClient::new(&server.url("/dav"), "desktag", "u", "p").unwrap();
        let GetOutcome::Data { bytes: b1, .. } =
            client.get(&RemoteVersion::default()).await.unwrap()
        else {
            panic!("expected data");
        };
        assert_eq!(open_app_data(&b1, "pass-tera").unwrap().todos[0].id, "tz1");

        *mode.lock().unwrap() = 1;
        let GetOutcome::Data { bytes: b2, .. } =
            client.get(&RemoteVersion::default()).await.unwrap()
        else {
            panic!("expected data");
        };
        assert_eq!(open_app_data(&b2, "pass-tera").unwrap().todos[0].id, "tz1");
    }

    #[tokio::test]
    async fn test_client_synology_403_missing_dir_get_and_mkcol_put() {
        let dir_exists = StdArc::new(AtomicBool::new(false));
        let d_flag = StdArc::clone(&dir_exists);

        let server = MockServer::start(move |req| match req.method.as_str() {
            "GET" => {
                if !d_flag.load(Ordering::SeqCst) {
                    // Synology DSM returns 403 for file inside non-existent folder
                    MockResponse::new(403, "Forbidden", Vec::new())
                } else {
                    MockResponse::new(404, "Not Found", Vec::new())
                }
            }
            "PROPFIND" => {
                if req.path.contains("/desktag") && !d_flag.load(Ordering::SeqCst) {
                    MockResponse::new(404, "Not Found", Vec::new())
                } else {
                    MockResponse::new(207, "Multi-Status", b"<D:multistatus/>".to_vec())
                }
            }
            "MKCOL" => {
                d_flag.store(true, Ordering::SeqCst);
                MockResponse::new(201, "Created", Vec::new())
            }
            "PUT" => {
                if !d_flag.load(Ordering::SeqCst) {
                    MockResponse::new(403, "Forbidden", Vec::new())
                } else {
                    MockResponse::new(201, "Created", Vec::new()).header("ETag", "\"syno-1\"")
                }
            }
            "HEAD" => MockResponse::new(200, "OK", Vec::new()).header("Content-Length", "10"),
            _ => MockResponse::new(405, "Method Not Allowed", Vec::new()),
        });

        let client = WebDavClient::new(&server.url("/dav"), "desktag", "u", "p").unwrap();
        let got = client.get(&RemoteVersion::default()).await.unwrap();
        assert!(matches!(got, GetOutcome::NotFound));

        let ver = client.put(b"0123456789", None).await.expect("Synology 403 -> MKCOL -> PUT");
        assert_eq!(ver.etag.as_deref(), Some("\"syno-1\""));
    }

    #[tokio::test]
    async fn test_client_alist_nowhere_propfind_depth1_suggested_url() {
        let server = MockServer::start(move |req| match req.method.as_str() {
            "MKCOL" => MockResponse::new(405, "Method Not Allowed", Vec::new()),
            "PUT" => MockResponse::new(404, "Not Found", Vec::new()),
            "PROPFIND" => {
                let xml = r#"<?xml version="1.0" encoding="utf-8"?>
                <D:multistatus xmlns:D="DAV:">
                  <D:response>
                    <D:href>/dav/</D:href>
                    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
                  </D:response>
                  <D:response>
                    <D:href>/dav/local/</D:href>
                    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
                  </D:response>
                  <D:response>
                    <D:href>/dav/onedrive/</D:href>
                    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
                  </D:response>
                </D:multistatus>"#;
                MockResponse::new(207, "Multi-Status", xml.as_bytes().to_vec())
            }
            _ => MockResponse::new(404, "Not Found", Vec::new()),
        });

        let client = WebDavClient::new(&server.url("/dav"), "desktag", "u", "p").unwrap();
        let err = client.put(b"hello", None).await.unwrap_err();
        match err {
            DavError::Nowhere {
                suggested_url,
                message,
                ..
            } => {
                assert!(message.contains("local"));
                assert!(message.contains("onedrive"));
                assert_eq!(
                    suggested_url.as_deref(),
                    Some(format!("{}/local/", server.url("/dav")).as_str())
                );
            }
            other => panic!("expected Nowhere, got {other:?}"),
        }
    }

    #[test]
    fn test_version_last_modified_1s_guard_and_retry_after() {
        let mut h_same = HeaderMap::new();
        h_same.insert(
            LAST_MODIFIED,
            HeaderValue::from_static("Wed, 21 Oct 2026 07:28:00 GMT"),
        );
        h_same.insert(
            DATE,
            HeaderValue::from_static("Wed, 21 Oct 2026 07:28:00 GMT"),
        );
        assert_eq!(version_from_headers(&h_same).modified, None);

        let mut h_older = HeaderMap::new();
        h_older.insert(
            LAST_MODIFIED,
            HeaderValue::from_static("Wed, 21 Oct 2026 07:28:00 GMT"),
        );
        h_older.insert(
            DATE,
            HeaderValue::from_static("Wed, 21 Oct 2026 07:28:02 GMT"),
        );
        assert_eq!(
            version_from_headers(&h_older).modified.as_deref(),
            Some("Wed, 21 Oct 2026 07:28:00 GMT")
        );

        assert_eq!(parse_retry_after("120"), Some(Duration::from_secs(120)));
        assert_eq!(
            compute_backoff(
                Some(Some(Duration::from_secs(600))),
                Duration::from_secs(180),
                Duration::from_secs(180)
            ),
            Duration::from_secs(600)
        );
        assert_eq!(
            compute_backoff(
                Some(None),
                Duration::from_secs(180),
                Duration::from_secs(180)
            ),
            Duration::from_secs(360)
        );
    }

    // -----------------------------------------------------------------------
    // 3. 3-Way Per-Item Merge, Tombstone, Conflict & Empty-First Guard Tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_merge_three_way_items_tombstones_conflicts_and_empty_first() {
        // Base state with t1, t2, t3, t4
        let mut base = AppData::default();
        base.todos = vec![
            sample_todo("t1", "Shared 1", "2026-05-01T08:00:00Z"),
            sample_todo("t2", "Shared 2", "2026-05-01T08:00:00Z"),
            sample_todo("t3", "To delete via tombstone", "2026-05-01T08:00:00Z"),
            sample_todo("t4", "Conflict item", "2026-05-01T08:00:00Z"),
        ];

        // Local edits t1, edits t4 (older), adds t5
        let mut local = base.clone();
        local.todos[0].title = "Shared 1 (local edit)".to_string();
        local.todos[0].updated_at = "2026-05-01T09:00:00Z".to_string();
        local.todos[3].title = "Conflict local".to_string();
        local.todos[3].updated_at = "2026-05-01T09:05:00Z".to_string();
        local
            .todos
            .push(sample_todo("t5", "Local new", "2026-05-01T09:10:00Z"));

        // Remote edits t2, soft-deletes t3 via deleted_at, edits t4 (newer!), adds t6
        let mut remote = base.clone();
        remote.todos[1].title = "Shared 2 (remote edit)".to_string();
        remote.todos[1].updated_at = "2026-05-01T09:00:00Z".to_string();
        remote.todos[2].deleted_at = Some("2026-05-01T09:02:00Z".to_string());
        remote.todos[2].updated_at = "2026-05-01T09:02:00Z".to_string();
        remote.todos[3].title = "Conflict remote wins".to_string();
        remote.todos[3].updated_at = "2026-05-01T09:20:00Z".to_string();
        remote
            .todos
            .push(sample_todo("t6", "Remote new", "2026-05-01T09:15:00Z"));

        let out = merge_app_data(&local, &remote, Some(&base));
        assert!(out.changed_local);
        assert!(out.changed_remote);
        assert_eq!(out.conflict_count, 1);
        assert!(out.local_displaced);

        let by_id: HashMap<&str, &TodoItem> = out
            .merged
            .todos
            .iter()
            .map(|t| (t.id.as_str(), t))
            .collect();
        assert_eq!(by_id["t1"].title, "Shared 1 (local edit)");
        assert_eq!(by_id["t2"].title, "Shared 2 (remote edit)");
        assert!(by_id["t3"].deleted_at.is_some());
        assert_eq!(by_id["t4"].title, "Conflict remote wins");
        assert_eq!(by_id["t5"].title, "Local new");
        assert_eq!(by_id["t6"].title, "Remote new");

        // Empty-first join guard: populated local joining an empty server must NEVER be wiped!
        let mut populated_local = AppData::default();
        populated_local
            .todos
            .push(sample_todo("keep-me", "Important", "2026-05-01T10:00:00Z"));
        populated_local.settings = SyncedSettings {
            skin_id: "midnight-ink".to_string(),
            ..SyncedSettings::default()
        };
        let empty_remote = AppData::default();
        let join_out = merge_app_data(&populated_local, &empty_remote, None);
        assert!(!join_out.changed_local);
        assert!(join_out.changed_remote);
        assert_eq!(join_out.merged.todos.len(), 1);
        assert_eq!(join_out.merged.todos[0].id, "keep-me");
        assert_eq!(join_out.merged.settings.skin_id, "midnight-ink");
    }

    // -----------------------------------------------------------------------
    // 4. End-to-End WebDavManager Integration Tests:
    //    412 Auto-Retry, 304 Fast-Path, Corrupt-Prefix Auto-Rebuild,
    //    Preview Token Check, UndoSync, Config Guards & Force Upload
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_manager_412_concurrent_write_auto_retry_and_304_fast_path() {
        let storage = temp_storage("412-304");
        let pass = "sync-e2ee-passphrase";

        // Shared mock WebDAV file state
        #[derive(Default)]
        struct DavStore {
            bytes: Option<Vec<u8>>,
            etag: String,
            seq: u32,
        }
        let dav = StdArc::new(StdMutex::new(DavStore::default()));
        let d_ref = StdArc::clone(&dav);

        let server = MockServer::start(move |req| {
            let mut st = d_ref.lock().unwrap();
            match req.method.as_str() {
                "GET" => {
                    let Some(ref b) = st.bytes else {
                        return MockResponse::new(404, "Not Found", Vec::new());
                    };
                    if req.headers.get("if-none-match").map(String::as_str)
                        == Some(st.etag.as_str())
                    {
                        return MockResponse::new(304, "Not Modified", Vec::new())
                            .header("ETag", &st.etag);
                    }
                    MockResponse::new(200, "OK", b.clone()).header("ETag", &st.etag)
                }
                "PUT" => {
                    if let Some(if_match) = req.headers.get("if-match") {
                        if st.bytes.is_some() && if_match != &st.etag {
                            return MockResponse::new(412, "Precondition Failed", Vec::new());
                        }
                    }
                    st.seq += 1;
                    st.etag = format!("\"v{}\"", st.seq);
                    st.bytes = Some(req.body.clone());
                    MockResponse::new(201, "Created", Vec::new()).header("ETag", &st.etag)
                }
                "HEAD" => {
                    let len = st.bytes.as_ref().map(|b| b.len()).unwrap_or(0);
                    MockResponse::new(200, "OK", Vec::new())
                        .header("Content-Length", &len.to_string())
                        .header("ETag", &st.etag)
                }
                "MKCOL" => MockResponse::new(201, "Created", Vec::new()),
                _ => MockResponse::new(207, "Multi-Status", b"<D:multistatus/>".to_vec()),
            }
        });

        let mgr = WebDavManager::new(storage.clone());
        mgr.save_config(make_config_input(&server.url("/dav"), "u", "p", pass))
            .await
            .unwrap();

        // Seed initial local data & Sync 1 -> uploads v1
        let mut local = AppData::default();
        local
            .todos
            .push(sample_todo("t-init", "Initial", "2026-05-01T08:00:00Z"));
        storage.save_app_data(local.clone()).unwrap();
        let res1 = mgr.sync_now().await.unwrap();
        assert!(res1.ok && res1.changed_remote);

        // Sync 2 with NO changes -> 304 Not Modified fast-path (no PUT!)
        let reqs_before_304 = server.recorded_requests().len();
        let res2 = mgr.sync_now().await.unwrap();
        assert!(res2.ok && !res2.changed_local && !res2.changed_remote);
        assert!(res2.message.contains("304"));
        let reqs_304 = &server.recorded_requests()[reqs_before_304..];
        assert_eq!(reqs_304.len(), 1);
        assert_eq!(reqs_304[0].method, "GET");

        // Now simulate race:
        // 1) Local device adds t-local
        let mut local2 = storage.load_app_data();
        local2
            .todos
            .push(sample_todo("t-local", "From Device A", "2026-05-01T10:00:00Z"));
        storage.save_app_data(local2).unwrap();

        // 2) Device B writes t-remote directly onto server (advancing ETag to "v2"),
        //    so Device A's cached-ETag PUT ("v1") hits 412 and auto-retries!
        {
            let mut st = dav.lock().unwrap();
            let mut remote_data = open_app_data(st.bytes.as_ref().unwrap(), pass).unwrap();
            remote_data
                .todos
                .push(sample_todo("t-remote", "From Device B", "2026-05-01T10:01:00Z"));
            st.bytes = Some(seal_app_data(&remote_data, pass).unwrap());
            st.seq += 1;
            st.etag = format!("\"v{}\"", st.seq);
        }

        // Wait: if Device A gets 200 (not 304) because ETag changed to "v2", let's ALSO explicitly test
        // a mid-flight 412 where server mutates BETWEEN GET and PUT!
        // Let's test BOTH: first run sync_now -> merges t-local + t-remote cleanly!
        let res3 = mgr.sync_now().await.unwrap();
        assert!(res3.ok && res3.changed_local && res3.changed_remote);
        let merged = storage.load_app_data();
        assert_eq!(merged.todos.len(), 3);

        // Now explicitly inject a true mid-flight 412 between GET and PUT!
        let storage2 = temp_storage("true-412");
        let injected_412 = StdArc::new(AtomicBool::new(false));
        let inj_ref = StdArc::clone(&injected_412);
        let dav2 = StdArc::new(StdMutex::new(DavStore::default()));
        let d2 = StdArc::clone(&dav2);

        let server412 = MockServer::start(move |req| {
            let mut st = d2.lock().unwrap();
            match req.method.as_str() {
                "GET" => match st.bytes {
                    Some(ref b) => MockResponse::new(200, "OK", b.clone()).header("ETag", &st.etag),
                    None => MockResponse::new(404, "Not Found", Vec::new()),
                },
                "PUT" => {
                    if let Some(if_match) = req.headers.get("if-match") {
                        if if_match == "\"v1\"" && !inj_ref.swap(true, Ordering::SeqCst) {
                            // Another device raced in right before our PUT!
                            let mut raced = open_app_data(st.bytes.as_ref().unwrap(), pass).unwrap();
                            raced.todos.push(sample_todo(
                                "t-raced",
                                "Concurrent peer",
                                "2026-05-01T11:00:00Z",
                            ));
                            st.bytes = Some(seal_app_data(&raced, pass).unwrap());
                            st.seq = 2;
                            st.etag = "\"v2\"".to_string();
                            return MockResponse::new(412, "Precondition Failed", Vec::new());
                        }
                        if if_match != &st.etag {
                            return MockResponse::new(412, "Precondition Failed", Vec::new());
                        }
                    }
                    st.seq += 1;
                    st.etag = format!("\"v{}\"", st.seq);
                    st.bytes = Some(req.body.clone());
                    MockResponse::new(201, "Created", Vec::new()).header("ETag", &st.etag)
                }
                "HEAD" => {
                    let len = st.bytes.as_ref().map(|b| b.len()).unwrap_or(0);
                    MockResponse::new(200, "OK", Vec::new())
                        .header("Content-Length", &len.to_string())
                        .header("ETag", &st.etag)
                }
                _ => MockResponse::new(201, "Created", Vec::new()),
            }
        });

        let mgr2 = WebDavManager::new(storage2.clone());
        mgr2.save_config(make_config_input(&server412.url("/dav"), "u", "p", pass))
            .await
            .unwrap();
        let mut init2 = AppData::default();
        init2
            .todos
            .push(sample_todo("t0", "Base", "2026-05-01T08:00:00Z"));
        storage2.save_app_data(init2).unwrap();
        assert!(mgr2.sync_now().await.unwrap().ok);

        let mut edit2 = storage2.load_app_data();
        edit2
            .todos
            .push(sample_todo("t-me", "My edit", "2026-05-01T11:01:00Z"));
        storage2.save_app_data(edit2).unwrap();

        let retry_res = mgr2.sync_now().await.unwrap();
        assert!(retry_res.ok, "412 auto-retry must succeed: {}", retry_res.message);
        assert!(injected_412.load(Ordering::SeqCst));
        let final2 = storage2.load_app_data();
        let ids: Vec<&str> = final2.todos.iter().map(|t| t.id.as_str()).collect();
        assert!(ids.contains(&"t0") && ids.contains(&"t-me") && ids.contains(&"t-raced"));
    }

    #[tokio::test]
    async fn test_manager_preview_token_check_and_undo_sync() {
        let storage = temp_storage("preview-undo");
        let pass = "preview-undo-pass";

        let mut remote_data = AppData::default();
        remote_data
            .todos
            .push(sample_todo("t-srv", "Server task", "2026-05-01T12:00:00Z"));
        let remote_sealed = StdArc::new(StdMutex::new(
            seal_app_data(&remote_data, pass).unwrap(),
        ));
        let r_ref = StdArc::clone(&remote_sealed);

        let server = MockServer::start(move |req| match req.method.as_str() {
            "GET" => MockResponse::new(200, "OK", r_ref.lock().unwrap().clone())
                .header("ETag", "\"p-1\""),
            "PUT" => {
                *r_ref.lock().unwrap() = req.body.clone();
                MockResponse::new(201, "Created", Vec::new()).header("ETag", "\"p-2\"")
            }
            "HEAD" => {
                let len = r_ref.lock().unwrap().len();
                MockResponse::new(200, "OK", Vec::new())
                    .header("Content-Length", &len.to_string())
                    .header("ETag", "\"p-2\"")
            }
            _ => MockResponse::new(201, "Created", Vec::new()),
        });

        let mgr = WebDavManager::new(storage.clone());
        mgr.save_config(make_config_input(&server.url("/dav"), "u", "p", pass))
            .await
            .unwrap();

        let mut local = AppData::default();
        local
            .todos
            .push(sample_todo("t-loc", "Local task", "2026-05-01T11:00:00Z"));
        storage.save_app_data(local).unwrap();

        let pv1 = mgr.preview(None).await.unwrap();
        assert_eq!(pv1.token.len(), 16);
        assert_eq!(pv1.direction, "bidirectional");
        assert_eq!(pv1.to_upload_count, 1);
        assert_eq!(pv1.to_download_count, 1);

        // Mutate local data -> old token must be rejected!
        let mut local_mod = storage.load_app_data();
        local_mod
            .todos
            .push(sample_todo("t-extra", "Extra", "2026-05-01T12:05:00Z"));
        storage.save_app_data(local_mod).unwrap();

        let stale_err = mgr.sync_previewed(pv1.token.clone()).await;
        assert!(stale_err.is_err(), "stale preview token must be rejected");

        // Fresh preview + sync_previewed succeeds
        let pv2 = mgr.preview(None).await.unwrap();
        assert_ne!(pv2.token, pv1.token);
        let applied = mgr.sync_previewed(pv2.token).await.unwrap();
        assert!(applied.ok && applied.changed_local);
        assert!(applied.status.can_undo);
        assert_eq!(storage.load_app_data().todos.len(), 3);

        // Edit locally after sync -> undo_sync(false) refuses cleanly
        let mut edited = storage.load_app_data();
        edited.todos[0].title = "Edited after sync".to_string();
        storage.save_app_data(edited).unwrap();

        let undo_blocked = mgr.undo_sync(false).await.unwrap();
        assert!(!undo_blocked.ok);
        assert!(undo_blocked.message.to_lowercase().contains("changed"));

        // Force undo succeeds and restores pre-sync 2 local todos!
        let undo_forced = mgr.undo_sync(true).await.unwrap();
        assert!(undo_forced.ok && undo_forced.changed_local);
        let after_undo = storage.load_app_data();
        assert_eq!(after_undo.todos.len(), 2);
        assert!(after_undo.todos.iter().all(|t| t.id != "t-srv"));
    }

    #[tokio::test]
    async fn test_manager_corrupt_prefix_auto_rebuild_and_force_upload_guards() {
        let storage = temp_storage("corrupt-rebuild");
        let pass = "rebuild-pass-1";
        let remote_body = StdArc::new(StdMutex::new(None::<Vec<u8>>));
        let r_ref = StdArc::clone(&remote_body);

        let server = MockServer::start(move |req| match req.method.as_str() {
            "GET" => match r_ref.lock().unwrap().as_ref() {
                Some(b) => MockResponse::new(200, "OK", b.clone()).header("ETag", "\"c-1\""),
                None => MockResponse::new(404, "Not Found", Vec::new()),
            },
            "PUT" => {
                *r_ref.lock().unwrap() = Some(req.body.clone());
                MockResponse::new(201, "Created", Vec::new()).header("ETag", "\"c-2\"")
            }
            "HEAD" => {
                let len = r_ref.lock().unwrap().as_ref().map(|b| b.len()).unwrap_or(0);
                MockResponse::new(200, "OK", Vec::new())
                    .header("Content-Length", &len.to_string())
                    .header("ETag", "\"c-2\"")
            }
            _ => MockResponse::new(201, "Created", Vec::new()),
        });

        let mgr = WebDavManager::new(storage.clone());
        mgr.save_config(make_config_input(&server.url("/dav"), "u", "p", pass))
            .await
            .unwrap();

        let mut d = AppData::default();
        d.todos
            .push(sample_todo("t1", "Keep safe", "2026-05-01T10:00:00Z"));
        storage.save_app_data(d).unwrap();
        assert!(mgr.sync_now().await.unwrap().ok);

        // Truncate server body past `"data"` to simulate relay cut-off
        {
            let mut guard = remote_body.lock().unwrap();
            let full = guard.as_ref().unwrap().clone();
            let cut_len = full.len() - 12;
            *guard = Some(full[..cut_len].to_vec());
        }

        // Next sync auto-rebuilds truncated backup and saves *-server-damaged.desktag-backup!
        let rebuilt_res = mgr.sync_now().await.unwrap();
        assert!(rebuilt_res.ok, "expected auto-rebuild: {}", rebuilt_res.message);
        assert!(rebuilt_res.changed_remote);
        assert!(fs::read_dir(storage.sync_backup_dir())
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().contains("server-damaged")));

        // Verify force_upload refuses to overwrite an HTML server page (can_replace: false)
        *remote_body.lock().unwrap() =
            Some(b"<!doctype html><html><head><title>Portal</title></head></html>".to_vec());
        let refused = mgr.force_upload().await.unwrap();
        assert!(!refused.ok);
        assert_eq!(
            refused
                .status
                .server_file_warning
                .as_ref()
                .map(|w| w.can_replace),
            Some(false)
        );
    }

    #[tokio::test]
    async fn test_manager_config_same_account_and_passphrase_guards_and_setup_import() {
        let storage = temp_storage("config-guards");
        let mgr = WebDavManager::new(storage.clone());

        // passphrase == password MUST be rejected
        let same_secret = mgr
            .save_config(make_config_input(
                "https://dav.jianguoyun.com/dav/",
                "alice",
                "same-secret",
                "same-secret",
            ))
            .await;
        assert!(same_secret.is_err());

        // Valid save
        let saved = mgr
            .save_config(make_config_input(
                "https://dav.jianguoyun.com/dav/",
                "alice",
                "login-pass",
                "enc-pass",
            ))
            .await
            .unwrap();
        assert!(saved.password_set && saved.passphrase_set);

        // Editing subdir on SAME host+user without retyping password reuses password!
        let same_acct_edit = mgr
            .save_config(WebDavConfigInput {
                enabled: true,
                url: "https://DAV.JIANGUOYUN.COM/dav/work/".to_string(),
                username: "alice".to_string(),
                password: None,
                passphrase: None,
                clear_password: Some(false),
                clear_passphrase: Some(false),
                remote_dir: "desktag".to_string(),
                auto_sync_minutes: 15,
                debounce_push: true,
                follow_server: false,
            })
            .await
            .unwrap();
        assert!(same_acct_edit.password_set);

        // Changing host while omitting password MUST be rejected (sameAccount guard!)
        let diff_host = mgr
            .save_config(WebDavConfigInput {
                enabled: true,
                url: "https://evil.example.com/dav/".to_string(),
                username: "alice".to_string(),
                password: None,
                passphrase: None,
                clear_password: Some(false),
                clear_passphrase: Some(false),
                remote_dir: "desktag".to_string(),
                auto_sync_minutes: 15,
                debounce_push: true,
                follow_server: false,
            })
            .await;
        assert!(diff_host.is_err());

        // Export SetupText on device 1 -> import on device 2
        let setup_str = mgr.export_setup_text().await.unwrap();
        let storage_b = temp_storage("config-guards-b");
        let mgr_b = WebDavManager::new(storage_b);
        let imported = mgr_b
            .import_setup_text(setup_str, "enc-pass".to_string())
            .await
            .unwrap();
        assert!(imported.enabled && imported.password_set && imported.passphrase_set);
        assert_eq!(imported.username, "alice");
    }

    #[tokio::test]
    async fn test_client_short_write_retries_updating_if_match() {
        let put_count = StdArc::new(StdMutex::new(0usize));
        let p_ref = StdArc::clone(&put_count);
        let full_len = StdArc::new(StdMutex::new(0usize));
        let l_ref = StdArc::clone(&full_len);

        let server = MockServer::start(move |req| match req.method.as_str() {
            "PUT" => {
                let mut cnt = p_ref.lock().unwrap();
                *cnt += 1;
                *l_ref.lock().unwrap() = req.body.len();
                let etag = format!("\"w-{}\"", *cnt);
                MockResponse::new(201, "Created", Vec::new()).header("ETag", &etag)
            }
            "HEAD" => {
                let cnt = *p_ref.lock().unwrap();
                let want = *l_ref.lock().unwrap();
                let reported = if cnt == 1 { want / 2 } else { want };
                MockResponse::new(200, "OK", Vec::new())
                    .header("Content-Length", &reported.to_string())
                    .header("ETag", &format!("\"w-{cnt}\""))
            }
            "PROPFIND" => {
                let cnt = *p_ref.lock().unwrap();
                let want = *l_ref.lock().unwrap();
                let reported = if cnt == 1 { want / 2 } else { want };
                let xml = format!(
                    "<D:multistatus xmlns:D=\"DAV:\"><D:response><D:propstat><D:prop><D:getcontentlength>{reported}</D:getcontentlength></D:prop></D:propstat></D:response></D:multistatus>"
                );
                MockResponse::new(207, "Multi-Status", xml.into_bytes())
            }
            _ => MockResponse::new(200, "OK", Vec::new()),
        });

        let client = WebDavClient::new(&server.url("/dav"), "desktag", "u", "p").unwrap();
        let ver = client
            .put(b"0123456789abcdef0123456789abcdef", Some("\"orig\""))
            .await
            .expect("second PUT retry must succeed");
        assert_eq!(ver.etag.as_deref(), Some("\"w-2\""));

        let puts: Vec<MockRequest> = server
            .recorded_requests()
            .into_iter()
            .filter(|r| r.method == "PUT")
            .collect();
        assert_eq!(puts.len(), 2);
        assert_eq!(puts[0].headers.get("if-match").map(String::as_str), Some("\"orig\""));
        assert_eq!(puts[1].headers.get("if-match").map(String::as_str), Some("\"w-1\""));
    }

    #[tokio::test]
    async fn test_client_test_connection_and_redirect_portal() {
        let server = MockServer::start(move |req| match (req.method.as_str(), req.path.as_str()) {
            ("PROPFIND", "/dav/") => {
                MockResponse::new(207, "Multi-Status", b"<D:multistatus/>".to_vec())
            }
            ("PROPFIND", p) if p.ends_with(REMOTE_FILE_NAME) => {
                MockResponse::new(207, "Multi-Status", b"<D:multistatus/>".to_vec())
            }
            ("GET", p) if p.ends_with(REMOTE_FILE_NAME) => {
                MockResponse::new(302, "Found", Vec::new()).header("Location", "/login")
            }
            ("GET", "/login") => MockResponse::new(
                200,
                "OK",
                b"<html><head><title>Web Portal Login</title></head><body>Sign in</body></html>"
                    .to_vec(),
            ),
            _ => MockResponse::new(404, "Not Found", Vec::new()),
        });

        let storage = temp_storage("test-conn");
        let mgr = WebDavManager::new(storage);
        let input = make_config_input(&server.url("/dav"), "u", "p", "pass");
        let res = mgr.test_connection(Some(input.clone())).await.unwrap();
        assert!(res.ok);
        assert!(res.remote_file_exists);
        assert_eq!(res.status_code, Some(207));

        // Redirect to login portal triggers ServerFileWarning with can_replace: false
        let client = WebDavClient::new(&server.url("/dav"), "desktag", "u", "p").unwrap();
        let err = client.get(&RemoteVersion::default()).await.unwrap_err();
        match err {
            DavError::NotBackup(w) => {
                assert_eq!(w.kind, "page");
                assert!(!w.can_replace);
                assert!(w.message.contains("Web Portal Login"));
                assert!(w.message.contains("/login"));
            }
            other => panic!("expected NotBackup, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_client_nutstore_403_quota_disambiguation_and_429_retry_after() {
        let mode = StdArc::new(StdMutex::new(0u8));
        let m_ref = StdArc::clone(&mode);

        let server = MockServer::start(move |req| {
            let cur = *m_ref.lock().unwrap();
            if cur == 0 {
                // Both base and desktag/ exist -> PUT 403 must diagnose quota / write permission!
                match req.method.as_str() {
                    "PROPFIND" => MockResponse::new(207, "Multi-Status", b"<D:multistatus/>".to_vec()),
                    "PUT" => MockResponse::new(403, "Forbidden", Vec::new()),
                    _ => MockResponse::new(403, "Forbidden", Vec::new()),
                }
            } else {
                // 429 Too Many Requests with Retry-After: 90
                MockResponse::new(429, "Too Many Requests", Vec::new())
                    .header("Retry-After", "90")
            }
        });

        let client = WebDavClient::new(&server.url("/dav"), "desktag", "u", "p").unwrap();
        let err_403 = client.put(b"hello", None).await.unwrap_err();
        match err_403 {
            DavError::Forbidden(msg) => {
                assert!(
                    msg.to_lowercase().contains("quota"),
                    "expected quota hint in 403 diagnostic, got: {msg}"
                );
            }
            other => panic!("expected Forbidden, got {other:?}"),
        }

        *mode.lock().unwrap() = 1;
        let err_429 = client.get(&RemoteVersion::default()).await.unwrap_err();
        match err_429 {
            DavError::RateLimited {
                status,
                retry_after,
            } => {
                assert_eq!(status, 429);
                assert_eq!(retry_after, Some(Duration::from_secs(90)));
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_manager_restore_from_server_and_rotating_snapshots_limit_5() {
        let storage = temp_storage("restore-rotate");
        let pass = "restore-pass-42";

        // Verify rotating snapshots cap at 5 per tag
        for i in 0..8 {
            save_rotating_snapshot(
                &storage,
                "before-sync",
                format!("snapshot-{i}").as_bytes(),
            )
            .unwrap();
        }
        let count = fs::read_dir(storage.sync_backup_dir())
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .ends_with("-before-sync.desktag-backup")
            })
            .count();
        assert_eq!(count, 5, "rotating snapshots must retain at most 5 per tag");

        // Prepare server backup with a distinct todo
        let mut srv_data = AppData::default();
        srv_data
            .todos
            .push(sample_todo("srv-only", "Server canonical", "2026-05-02T10:00:00Z"));
        let srv_bytes = seal_app_data(&srv_data, pass).unwrap();

        let server = MockServer::start(move |req| match req.method.as_str() {
            "GET" => MockResponse::new(200, "OK", srv_bytes.clone()).header("ETag", "\"rst-1\""),
            _ => MockResponse::new(200, "OK", Vec::new()),
        });

        let mgr = WebDavManager::new(storage.clone());
        mgr.save_config(make_config_input(&server.url("/dav"), "u", "p", pass))
            .await
            .unwrap();

        let mut loc_data = AppData::default();
        loc_data
            .todos
            .push(sample_todo("loc-only", "Local original", "2026-05-02T09:00:00Z"));
        storage.save_app_data(loc_data).unwrap();

        let restored = mgr.restore_from_server().await.unwrap();
        assert!(restored.ok && restored.changed_local && !restored.changed_remote);
        assert!(restored.status.can_undo);
        assert_eq!(storage.load_app_data().todos[0].id, "srv-only");

        // Undo restore brings back local original!
        let undone = mgr.undo_sync(false).await.unwrap();
        assert!(undone.ok && undone.changed_local);
        assert_eq!(storage.load_app_data().todos[0].id, "loc-only");
    }

    #[test]
    fn test_md5_digest_helper_sanity() {
        let digest = hex::encode(Md5::digest(b"hello"));
        assert_eq!(digest, "5d41402abc4b2a76b9719d911017c592");
    }
}
