import { invoke } from '@tauri-apps/api/core';
import {
  type AppData,
  type AppStateBundle,
  type AttachmentRef,
  type BackupOptions,
  type BackupResult,
  type DeviceSettings,
  type DockMode,
  type DockState,
  type ExportDocumentRequest,
  type ExportDocumentResult,
  type ImportBackupResult,
  type InstallKind,
  type NotificationItem,
  type PlatformInfo,
  type SaveAttachmentInput,
  type StorageInfo,
  type SyncExecutionResult,
  type SyncPreview,
  type UpdateAsset,
  type UpdateCheckResult,
  type UpdateInstallResult,
  type WebDavConfigInput,
  type WebDavConfigView,
  type WebDavStatusView,
  type WebDavTestResult,
  createDefaultAppData,
  createDefaultDeviceSettings,
} from '../types/models';

const STORAGE_KEY_DATA = 'desktag_fallback_data_v1';
const STORAGE_KEY_DEVICE = 'desktag_fallback_device_v1';
const STORAGE_KEY_WEBDAV = 'desktag_fallback_webdav_v1';
const STORAGE_KEY_NOTIFS = 'desktag_fallback_notifications_v1';
const STORAGE_KEY_ATTACHMENTS = 'desktag_fallback_attachments_v1';

interface FallbackWebDavStore {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  passphrase: string;
  remoteDir: string;
  autoSyncMinutes: number;
  debouncePush: boolean;
  followServer: boolean;
  lastSyncAt: string | null;
}

const memoryFallback: {
  dockCollapsed: boolean;
  attachments: Record<string, { mime: string; base64Data: string }>;
} = {
  dockCollapsed: false,
  attachments: {},
};

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

function readJson<T>(key: string, fallback: () => T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback();
    return JSON.parse(raw) as T;
  } catch {
    return fallback();
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors in fallback mode.
  }
}

function getFallbackAppVersion(): string {
  return typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim()
    ? __APP_VERSION__
    : '1.1.0';
}

function detectBrowserPlatform(): PlatformInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isAndroid = /Android/i.test(ua);
  const isMac = /Macintosh|Mac OS X/i.test(ua);
  const isWin = /Windows/i.test(ua);
  const platform = isAndroid ? 'android' : isMac ? 'macos' : isWin ? 'windows' : 'linux';
  const isMobile = isAndroid;
  return {
    platform,
    isDesktop: !isMobile,
    isMobile,
    appVersion: getFallbackAppVersion(),
    supportsEdgeDock: !isMobile,
    supportsGlobalShortcut: !isMobile,
    supportsTray: !isMobile,
  };
}

function fallbackDockState(device?: DeviceSettings): DockState {
  const dev = device ?? readJson(STORAGE_KEY_DEVICE, createDefaultDeviceSettings);
  return {
    mode: dev.dockMode,
    collapsed: memoryFallback.dockCollapsed,
    autoHide: dev.autoHide,
    alwaysOnTop: dev.alwaysOnTop,
    platform: detectBrowserPlatform().platform,
  };
}

function defaultFallbackWebDav(): FallbackWebDavStore {
  return {
    enabled: false,
    url: '',
    username: '',
    password: '',
    passphrase: '',
    remoteDir: 'desktag',
    autoSyncMinutes: 3,
    debouncePush: true,
    followServer: false,
    lastSyncAt: null,
  };
}

function fallbackWebDavView(cfg: FallbackWebDavStore): WebDavConfigView {
  return {
    enabled: cfg.enabled,
    url: cfg.url,
    username: cfg.username,
    passwordSet: cfg.password.length > 0,
    passphraseSet: cfg.passphrase.length > 0,
    remoteDir: cfg.remoteDir,
    autoSyncMinutes: cfg.autoSyncMinutes,
    debouncePush: cfg.debouncePush,
    followServer: cfg.followServer,
  };
}

function fallbackWebDavStatus(cfg: FallbackWebDavStore): WebDavStatusView {
  const configured = cfg.url.trim().length > 0 && cfg.username.trim().length > 0 && cfg.password.length > 0;
  return {
    enabled: cfg.enabled,
    configured,
    syncing: false,
    lastSyncAt: cfg.lastSyncAt,
    lastError: null,
    serverFileWarning: null,
    conflictNotice: null,
    canUndo: false,
    nextAutoSyncAt: null,
    backendHint: 'Browser preview mode (WebDAV executes inside Tauri runtime)',
  };
}

function loadFallbackAttachments(): Record<string, { mime: string; base64Data: string }> {
  const persisted = readJson<Record<string, { mime: string; base64Data: string }>>(
    STORAGE_KEY_ATTACHMENTS,
    () => ({}),
  );
  return { ...persisted, ...memoryFallback.attachments };
}

// ---------------------------------------------------------------------------
// App State & Persistence
// ---------------------------------------------------------------------------

export async function loadAppState(): Promise<AppStateBundle> {
  if (isTauriRuntime()) {
    return invoke<AppStateBundle>('load_app_state');
  }
  const data = readJson(STORAGE_KEY_DATA, createDefaultAppData);
  const device = readJson(STORAGE_KEY_DEVICE, createDefaultDeviceSettings);
  const platform = detectBrowserPlatform();
  return {
    data,
    device,
    dock: fallbackDockState(device),
    platform,
  };
}

export async function saveAppData(data: AppData): Promise<void> {
  if (isTauriRuntime()) {
    return invoke<void>('save_app_data', { data });
  }
  writeJson(STORAGE_KEY_DATA, { ...data, updatedAt: new Date().toISOString() });
}

export async function saveDeviceSettings(device: DeviceSettings): Promise<DockState> {
  if (isTauriRuntime()) {
    return invoke<DockState>('save_device_settings', { device });
  }
  writeJson(STORAGE_KEY_DEVICE, device);
  return fallbackDockState(device);
}

// ---------------------------------------------------------------------------
// Window Docking & Multi-Window Controls
// ---------------------------------------------------------------------------

export async function getDockState(): Promise<DockState> {
  if (isTauriRuntime()) {
    return invoke<DockState>('get_dock_state');
  }
  return fallbackDockState();
}

export async function setDockMode(mode: DockMode): Promise<DockState> {
  if (isTauriRuntime()) {
    return invoke<DockState>('set_dock_mode', { mode });
  }
  const dev = readJson(STORAGE_KEY_DEVICE, createDefaultDeviceSettings);
  dev.dockMode = mode;
  writeJson(STORAGE_KEY_DEVICE, dev);
  return fallbackDockState(dev);
}

export async function setAutoHide(enabled: boolean): Promise<DockState> {
  if (isTauriRuntime()) {
    return invoke<DockState>('set_auto_hide', { enabled });
  }
  const dev = readJson(STORAGE_KEY_DEVICE, createDefaultDeviceSettings);
  dev.autoHide = enabled;
  writeJson(STORAGE_KEY_DEVICE, dev);
  return fallbackDockState(dev);
}

export async function setAutoHidePaused(paused: boolean): Promise<void> {
  if (isTauriRuntime()) {
    return invoke<void>('set_auto_hide_paused', { paused });
  }
}

export async function setAlwaysOnTop(enabled: boolean): Promise<DockState> {
  if (isTauriRuntime()) {
    return invoke<DockState>('set_always_on_top', { enabled });
  }
  const dev = readJson(STORAGE_KEY_DEVICE, createDefaultDeviceSettings);
  dev.alwaysOnTop = enabled;
  writeJson(STORAGE_KEY_DEVICE, dev);
  return fallbackDockState(dev);
}

export async function expandPanel(): Promise<DockState> {
  if (isTauriRuntime()) {
    return invoke<DockState>('expand_panel');
  }
  memoryFallback.dockCollapsed = false;
  return fallbackDockState();
}

export async function collapsePanel(): Promise<DockState> {
  if (isTauriRuntime()) {
    return invoke<DockState>('collapse_panel');
  }
  memoryFallback.dockCollapsed = true;
  return fallbackDockState();
}

export async function hideToTray(): Promise<void> {
  if (isTauriRuntime()) {
    return invoke<void>('hide_to_tray');
  }
  memoryFallback.dockCollapsed = true;
}

export async function quitApp(): Promise<void> {
  if (isTauriRuntime()) {
    return invoke<void>('quit_app');
  }
}

export async function resetPanelLayout(): Promise<DeviceSettings> {
  if (isTauriRuntime()) {
    return invoke<DeviceSettings>('reset_panel_layout');
  }
  const current = readJson(STORAGE_KEY_DEVICE, createDefaultDeviceSettings);
  const reset: DeviceSettings = {
    ...current,
    panelWidth: 480,
    panelHeight: 680,
    panelX: null,
    panelY: null,
    uniformTabWidth: 64,
    tabWidthMode: 'uniform',
  };
  writeJson(STORAGE_KEY_DEVICE, reset);
  return reset;
}

export async function openCalendarWindow(): Promise<void> {
  if (isTauriRuntime()) {
    return invoke<void>('open_calendar_window');
  }
  window.open(`${window.location.pathname}?window=calendar`, '_blank', 'width=960,height=660');
}

export async function openNoteWindow(noteId: string): Promise<void> {
  if (isTauriRuntime()) {
    return invoke<void>('open_note_window', { noteId });
  }
  window.open(
    `${window.location.pathname}?window=note&noteId=${encodeURIComponent(noteId)}`,
    '_blank',
    'width=560,height=680',
  );
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export async function saveAttachment(input: SaveAttachmentInput): Promise<AttachmentRef> {
  if (isTauriRuntime()) {
    return invoke<AttachmentRef>('save_attachment', { input });
  }
  const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const safeName = input.name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_');
  const relativePath = `attachments/${id}_${safeName}`;
  const rawBase64 = input.base64Data.includes(',')
    ? input.base64Data.split(',')[1] ?? ''
    : input.base64Data;
  const approxBytes = Math.floor((rawBase64.length * 3) / 4);
  memoryFallback.attachments[relativePath] = { mime: input.mime, base64Data: rawBase64 };
  writeJson(STORAGE_KEY_ATTACHMENTS, loadFallbackAttachments());
  return {
    id,
    name: input.name,
    mime: input.mime,
    size: approxBytes,
    relativePath,
    kind: input.kind,
  };
}

export async function openAttachment(relativePath: string): Promise<void> {
  if (isTauriRuntime()) {
    return invoke<void>('open_attachment', { relativePath });
  }
  const dataUrl = await readAttachmentDataUrl(relativePath);
  if (dataUrl) {
    window.open(dataUrl, '_blank');
  }
}

export async function readAttachmentDataUrl(
  relativePath: string,
  mime?: string,
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>('read_attachment_data_url', {
      relativePath,
      mime: mime ?? null,
    });
  }
  const map = loadFallbackAttachments();
  const entry = map[relativePath];
  if (!entry) return '';
  return `data:${mime || entry.mime || 'application/octet-stream'};base64,${entry.base64Data}`;
}

// ---------------------------------------------------------------------------
// Backup, Export & Storage
// ---------------------------------------------------------------------------

export async function exportBackup(options: BackupOptions): Promise<BackupResult> {
  if (isTauriRuntime()) {
    return invoke<BackupResult>('export_backup', { options });
  }
  const payload = {
    data: options.includeData ? readJson(STORAGE_KEY_DATA, createDefaultAppData) : null,
    device: options.includeSettings ? readJson(STORAGE_KEY_DEVICE, createDefaultDeviceSettings) : null,
    exportedAt: new Date().toISOString(),
  };
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `desktag-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return {
    path: a.download,
    bytes: text.length,
    exportedAt: payload.exportedAt,
  };
}

export async function importBackup(sourcePath?: string | null): Promise<ImportBackupResult> {
  if (isTauriRuntime()) {
    return invoke<ImportBackupResult>('import_backup', {
      sourcePath: sourcePath ?? null,
    });
  }
  const data = readJson(STORAGE_KEY_DATA, createDefaultAppData);
  return {
    data,
    device: readJson(STORAGE_KEY_DEVICE, createDefaultDeviceSettings),
    importedTodos: data.todos.length,
    importedNotes: data.notes.length,
  };
}

export async function exportDocument(
  request: ExportDocumentRequest,
): Promise<ExportDocumentResult> {
  if (isTauriRuntime()) {
    return invoke<ExportDocumentResult>('export_document', { request });
  }
  const data = readJson(STORAGE_KEY_DATA, createDefaultAppData);
  const content =
    request.format === 'html'
      ? `<!doctype html><html><body><h1>DeskTag Export</h1><pre>${JSON.stringify(data.todos, null, 2)}</pre></body></html>`
      : `# DeskTag Export\n\n${data.todos.map((t) => `- [${t.completed ? 'x' : ' '}] ${t.title}`).join('\n')}\n`;
  return {
    path: request.targetPath || `desktag-export.${request.format === 'markdown' ? 'md' : request.format}`,
    format: request.format,
    bytes: content.length,
  };
}

export async function getStorageInfo(): Promise<StorageInfo> {
  if (isTauriRuntime()) {
    return invoke<StorageInfo>('get_storage_info');
  }
  const raw = window.localStorage.getItem(STORAGE_KEY_DATA) ?? '';
  return {
    dataDir: 'browser://localStorage/desktag',
    dataFilePath: 'browser://localStorage/desktag/data.json',
    attachmentsDir: 'browser://localStorage/desktag/attachments',
    syncBackupDir: 'browser://localStorage/desktag/sync',
    totalBytes: raw.length,
    isCustomDir: false,
  };
}

export async function changeStorageDir(newDir: string): Promise<StorageInfo> {
  if (isTauriRuntime()) {
    return invoke<StorageInfo>('change_storage_dir', { newDir });
  }
  const dev = readJson(STORAGE_KEY_DEVICE, createDefaultDeviceSettings);
  dev.customDataDir = newDir;
  writeJson(STORAGE_KEY_DEVICE, dev);
  return getStorageInfo();
}

export async function openStorageDir(): Promise<void> {
  if (isTauriRuntime()) {
    return invoke<void>('open_storage_dir');
  }
}

export async function openSyncBackupDir(): Promise<void> {
  if (isTauriRuntime()) {
    return invoke<void>('open_sync_backup_dir');
  }
}

// ---------------------------------------------------------------------------
// Notifications Center
// ---------------------------------------------------------------------------

export async function getNotifications(): Promise<NotificationItem[]> {
  if (isTauriRuntime()) {
    return invoke<NotificationItem[]>('get_notifications');
  }
  return readJson<NotificationItem[]>(STORAGE_KEY_NOTIFS, () => []);
}

export async function markNotificationsRead(
  ids?: string[] | null,
): Promise<NotificationItem[]> {
  if (isTauriRuntime()) {
    return invoke<NotificationItem[]>('mark_notifications_read', {
      ids: ids ?? null,
    });
  }
  const list = readJson<NotificationItem[]>(STORAGE_KEY_NOTIFS, () => []);
  const idSet = ids ? new Set(ids) : null;
  const next = list.map((item) =>
    !idSet || idSet.has(item.id) ? { ...item, read: true } : item,
  );
  writeJson(STORAGE_KEY_NOTIFS, next);
  return next;
}

export async function clearNotifications(): Promise<void> {
  if (isTauriRuntime()) {
    return invoke<void>('clear_notifications');
  }
  writeJson(STORAGE_KEY_NOTIFS, []);
}

// ---------------------------------------------------------------------------
// WebDAV E2EE Cloud Sync
// ---------------------------------------------------------------------------

export async function getWebdavConfig(): Promise<WebDavConfigView> {
  if (isTauriRuntime()) {
    return invoke<WebDavConfigView>('get_webdav_config');
  }
  return fallbackWebDavView(readJson(STORAGE_KEY_WEBDAV, defaultFallbackWebDav));
}

export async function saveWebdavConfig(
  input: WebDavConfigInput,
): Promise<WebDavConfigView> {
  if (isTauriRuntime()) {
    return invoke<WebDavConfigView>('save_webdav_config', { input });
  }
  const prev = readJson(STORAGE_KEY_WEBDAV, defaultFallbackWebDav);
  const next: FallbackWebDavStore = {
    enabled: input.enabled,
    url: input.url.trim(),
    username: input.username.trim(),
    password: input.clearPassword
      ? ''
      : input.password !== undefined && input.password !== null && input.password.length > 0
        ? input.password
        : prev.password,
    passphrase: input.clearPassphrase
      ? ''
      : input.passphrase !== undefined && input.passphrase !== null && input.passphrase.length > 0
        ? input.passphrase
        : prev.passphrase,
    remoteDir: input.remoteDir.trim() || 'desktag',
    autoSyncMinutes: input.autoSyncMinutes,
    debouncePush: input.debouncePush,
    followServer: input.followServer,
    lastSyncAt: prev.lastSyncAt,
  };
  writeJson(STORAGE_KEY_WEBDAV, next);
  return fallbackWebDavView(next);
}

export async function getWebdavStatus(): Promise<WebDavStatusView> {
  if (isTauriRuntime()) {
    return invoke<WebDavStatusView>('get_webdav_status');
  }
  return fallbackWebDavStatus(readJson(STORAGE_KEY_WEBDAV, defaultFallbackWebDav));
}

export async function testWebdavConnection(
  input?: WebDavConfigInput | null,
): Promise<WebDavTestResult> {
  if (isTauriRuntime()) {
    return invoke<WebDavTestResult>('test_webdav_connection', {
      input: input ?? null,
    });
  }
  const url = input?.url ?? readJson(STORAGE_KEY_WEBDAV, defaultFallbackWebDav).url;
  return {
    ok: url.startsWith('http://') || url.startsWith('https://'),
    statusCode: url.startsWith('http') ? 207 : null,
    message: url.startsWith('http')
      ? '浏览器预览模式：URL 格式有效（真实连接请在 Tauri 客户端测试）'
      : '请输入以 http:// 或 https:// 开头的 WebDAV 地址',
    remoteFileExists: false,
    suggestedUrl: null,
    latencyMs: 12,
  };
}

export async function webdavPreview(
  input?: WebDavConfigInput | null,
): Promise<SyncPreview> {
  if (isTauriRuntime()) {
    return invoke<SyncPreview>('webdav_preview', { input: input ?? null });
  }
  return {
    token: 'browser-preview-token',
    direction: 'up_to_date',
    toUploadCount: 0,
    toDownloadCount: 0,
    conflictCount: 0,
    items: [],
    summary: '浏览器预览模式下无待同步变更',
  };
}

export async function webdavSyncNow(): Promise<SyncExecutionResult> {
  if (isTauriRuntime()) {
    return invoke<SyncExecutionResult>('webdav_sync_now');
  }
  const cfg = readJson(STORAGE_KEY_WEBDAV, defaultFallbackWebDav);
  cfg.lastSyncAt = new Date().toISOString();
  writeJson(STORAGE_KEY_WEBDAV, cfg);
  return {
    ok: true,
    changedLocal: false,
    changedRemote: false,
    data: readJson(STORAGE_KEY_DATA, createDefaultAppData),
    status: fallbackWebDavStatus(cfg),
    message: '浏览器预览模式同步完成',
  };
}

export async function webdavSyncPreviewed(token: string): Promise<SyncExecutionResult> {
  if (isTauriRuntime()) {
    return invoke<SyncExecutionResult>('webdav_sync_previewed', { token });
  }
  return webdavSyncNow();
}

export async function webdavUndoSync(force?: boolean): Promise<SyncExecutionResult> {
  if (isTauriRuntime()) {
    return invoke<SyncExecutionResult>('webdav_undo_sync', {
      force: force ?? false,
    });
  }
  const cfg = readJson(STORAGE_KEY_WEBDAV, defaultFallbackWebDav);
  return {
    ok: false,
    changedLocal: false,
    changedRemote: false,
    data: null,
    status: fallbackWebDavStatus(cfg),
    message: '暂无可撤销的同步快照',
  };
}

export async function webdavRestoreFromServer(): Promise<SyncExecutionResult> {
  if (isTauriRuntime()) {
    return invoke<SyncExecutionResult>('webdav_restore_from_server');
  }
  return webdavSyncNow();
}

export async function webdavForceUpload(): Promise<SyncExecutionResult> {
  if (isTauriRuntime()) {
    return invoke<SyncExecutionResult>('webdav_force_upload');
  }
  return webdavSyncNow();
}

export async function webdavExportSetupText(): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>('webdav_export_setup_text');
  }
  const cfg = readJson(STORAGE_KEY_WEBDAV, defaultFallbackWebDav);
  const encoded = btoa(
    unescape(encodeURIComponent(JSON.stringify({ url: cfg.url, username: cfg.username }))),
  );
  return `desktag-sync:${encoded}`;
}

export async function webdavImportSetupText(
  setupText: string,
  passphrase: string,
): Promise<WebDavConfigView> {
  if (isTauriRuntime()) {
    return invoke<WebDavConfigView>('webdav_import_setup_text', {
      setupText,
      passphrase,
    });
  }
  const prev = readJson(STORAGE_KEY_WEBDAV, defaultFallbackWebDav);
  const payload = setupText.replace(/^desktag-sync:/, '');
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(payload)))) as {
      url?: string;
      username?: string;
    };
    const next: FallbackWebDavStore = {
      ...prev,
      enabled: true,
      url: parsed.url ?? prev.url,
      username: parsed.username ?? prev.username,
      passphrase,
    };
    writeJson(STORAGE_KEY_WEBDAV, next);
    return fallbackWebDavView(next);
  } catch {
    throw new Error('无法解析同步配置文本');
  }
}

export async function triggerDebouncedSync(): Promise<void> {
  if (isTauriRuntime()) {
    return invoke<void>('trigger_debounced_sync');
  }
}

// ---------------------------------------------------------------------------
// App Updates (GitHub Releases)
// ---------------------------------------------------------------------------

function normalizeVersionTag(raw: string): string {
  return raw.trim().replace(/^[vV]+/, '').trim();
}

function compareSemVerFallback(current: string, candidate: string): boolean {
  const parse = (v: string) => {
    const clean = normalizeVersionTag(v).split('+')[0] ?? '';
    const [core, pre] = clean.split('-', 2);
    const nums = (core ?? '').split('.').map((n) => Number.parseInt(n, 10));
    if (nums.length < 2 || nums.some((n) => Number.isNaN(n))) return null;
    return { major: nums[0] ?? 0, minor: nums[1] ?? 0, patch: nums[2] ?? 0, pre: pre ?? '' };
  };
  const a = parse(current);
  const b = parse(candidate);
  if (!a || !b) return false;
  if (b.major !== a.major) return b.major > a.major;
  if (b.minor !== a.minor) return b.minor > a.minor;
  if (b.patch !== a.patch) return b.patch > a.patch;
  if (!a.pre && !b.pre) return false;
  if (!b.pre && a.pre) return true;
  if (b.pre && !a.pre) return false;
  return b.pre > a.pre;
}

function detectBrowserInstallKind(): InstallKind {
  const plat = detectBrowserPlatform().platform;
  if (plat === 'windows') return 'windows_standalone';
  if (plat === 'macos') return 'macos_arm64';
  if (plat === 'android') return 'android_arm64';
  return 'linux';
}

export async function checkForUpdate(force?: boolean): Promise<UpdateCheckResult> {
  if (isTauriRuntime()) {
    return invoke<UpdateCheckResult>('check_for_update', {
      force: force ?? false,
    });
  }

  const currentVersion = getFallbackAppVersion();
  const installKind = detectBrowserInstallKind();
  const resp = await fetch('https://api.github.com/repos/nonsense-j/DeskTag/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!resp.ok) {
    throw new Error(`检查更新失败：GitHub 返回 HTTP ${resp.status}`);
  }
  const payload = (await resp.json()) as {
    tag_name?: string;
    name?: string;
    body?: string;
    published_at?: string;
    html_url?: string;
    assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>;
  };
  const tagName = payload.tag_name ?? `v${currentVersion}`;
  const latestVersion = normalizeVersionTag(tagName);
  const hasUpdate = compareSemVerFallback(currentVersion, latestVersion);
  const dev = readJson(STORAGE_KEY_DEVICE, createDefaultDeviceSettings);
  const skipped =
    hasUpdate &&
    !force &&
    Boolean(dev.skippedUpdateVersion) &&
    normalizeVersionTag(dev.skippedUpdateVersion ?? '') === latestVersion;
  const checkedAt = new Date().toISOString();
  writeJson(STORAGE_KEY_DEVICE, { ...dev, lastUpdateCheckAt: checkedAt });

  const assets = payload.assets ?? [];
  const matched = assets.find((a) => {
    const low = (a.name ?? '').toLowerCase();
    if (installKind === 'windows_standalone') return low.endsWith('-standalone.exe');
    if (installKind === 'macos_arm64') return low.endsWith('_aarch64.dmg');
    if (installKind === 'android_arm64') return low.endsWith('.apk');
    return false;
  });
  const recommendedAsset: UpdateAsset | null =
    matched?.name && matched.browser_download_url
      ? {
          name: matched.name,
          url: matched.browser_download_url,
          size: typeof matched.size === 'number' ? matched.size : null,
          sha256: null,
        }
      : null;

  return {
    currentVersion,
    latestVersion,
    hasUpdate,
    skipped,
    releaseName: payload.name || `DeskTag ${tagName}`,
    releaseNotes: payload.body ?? '',
    publishedAt: payload.published_at ?? null,
    releaseUrl: payload.html_url || 'https://github.com/nonsense-j/DeskTag/releases',
    installKind,
    recommendedAsset,
    checkedAt,
    source: 'github_api',
  };
}

export async function downloadAndInstallUpdate(
  update: UpdateCheckResult,
): Promise<UpdateInstallResult> {
  if (isTauriRuntime()) {
    return invoke<UpdateInstallResult>('download_and_install_update', { update });
  }
  const targetUrl = update.recommendedAsset?.url || update.releaseUrl;
  window.open(targetUrl, '_blank', 'noopener,noreferrer');
  return {
    action: 'opened_url',
    path: null,
    message: '已在浏览器中打开新版本下载链接',
  };
}

// ---------------------------------------------------------------------------
// Platform Info
// ---------------------------------------------------------------------------

export async function getPlatformInfo(): Promise<PlatformInfo> {
  if (isTauriRuntime()) {
    return invoke<PlatformInfo>('get_platform_info');
  }
  return detectBrowserPlatform();
}

export const tauriApi = {
  loadAppState,
  saveAppData,
  saveDeviceSettings,
  getDockState,
  setDockMode,
  setAutoHide,
  setAutoHidePaused,
  setAlwaysOnTop,
  expandPanel,
  collapsePanel,
  hideToTray,
  quitApp,
  resetPanelLayout,
  openCalendarWindow,
  openNoteWindow,
  saveAttachment,
  openAttachment,
  readAttachmentDataUrl,
  exportBackup,
  importBackup,
  exportDocument,
  getStorageInfo,
  changeStorageDir,
  openStorageDir,
  openSyncBackupDir,
  getNotifications,
  markNotificationsRead,
  clearNotifications,
  getWebdavConfig,
  saveWebdavConfig,
  getWebdavStatus,
  testWebdavConnection,
  webdavPreview,
  webdavSyncNow,
  webdavSyncPreviewed,
  webdavUndoSync,
  webdavRestoreFromServer,
  webdavForceUpload,
  webdavExportSetupText,
  webdavImportSetupText,
  triggerDebouncedSync,
  checkForUpdate,
  downloadAndInstallUpdate,
  getPlatformInfo,
} as const;
