import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getWebdavConfig,
  getWebdavStatus,
  openSyncBackupDir,
  saveWebdavConfig,
  testWebdavConnection,
  webdavExportSetupText,
  webdavForceUpload,
  webdavImportSetupText,
  webdavPreview,
  webdavRestoreFromServer,
  webdavSyncNow,
  webdavSyncPreviewed,
  webdavUndoSync,
} from '../api/tauri';
import type {
  AppData,
  SyncPreview,
  WebDavConfigInput,
  WebDavConfigView,
  WebDavStatusView,
  WebDavTestResult,
} from '../types/models';

export interface WebDavSyncCardProps {
  /** Optional external status synced from store (events). */
  externalStatus?: WebDavStatusView | null;
  /** Called whenever a sync/restore/undo updates AppData locally. */
  onDataSynced?: (data: AppData) => void;
  /** Called whenever WebDAV status changes so header indicator stays fresh. */
  onStatusChange?: (status: WebDavStatusView) => void;
}

interface ProviderPreset {
  id: string;
  label: string;
  url: string;
  hint: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'jianguoyun',
    label: '坚果云',
    url: 'https://dav.jianguoyun.com/dav/',
    hint: '请在坚果云网页端「安全选项 → 第三方应用管理」中生成应用专用密码（非登录密码）。',
  },
  {
    id: '123pan',
    label: '123云盘',
    url: 'https://webdav.123pan.cn/webdav/',
    hint: '在 123 云盘开启 WebDAV 并使用应用密码。DeskTag 已内置 123 云盘条件请求兼容。',
  },
  {
    id: 'teracloud',
    label: 'TeraCLOUD',
    url: 'https://yura.teracloud.jp/dav/',
    hint: '请将子域名改为账号对应节点（如 InfiniCLOUD 面板给出的 DAV 地址）并填写 App Password。',
  },
  {
    id: 'synology',
    label: '群晖 NAS',
    url: 'https://your-nas.local:5006/',
    hint: '填写群晖 WebDAV Server 地址与 HTTPS 端口（默认 5006），确保账号对该目录具备读写权限。',
  },
  {
    id: 'alist',
    label: 'Alist/OpenList',
    url: 'https://your-host/dav/storage/',
    hint: '请填写具体挂载存储的子目录（如 /dav/onedrive/），而非只读的 /dav/ 根目录。',
  },
  {
    id: 'nextcloud',
    label: 'Nextcloud',
    url: 'https://your-cloud/remote.php/dav/files/username/',
    hint: '将 username 替换为你的 Nextcloud 用户名，推荐在「安全」中创建应用密码。',
  },
  {
    id: 'custom',
    label: '自定义',
    url: '',
    hint: '支持任意标准 WebDAV 服务（Basic / Digest 认证、ETag 并发校验、短写自动校验）。',
  },
];

const AUTO_SYNC_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '手动' },
  { value: 3, label: '每 3 分钟' },
  { value: 15, label: '每 15 分钟' },
  { value: 30, label: '每 30 分钟' },
  { value: 60, label: '每 60 分钟' },
];

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '尚未同步';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 45) return '刚刚同步';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function detectPresetId(url: string): string {
  const lower = url.toLowerCase();
  if (!lower.trim()) return 'custom';
  if (lower.includes('jianguoyun.com')) return 'jianguoyun';
  if (lower.includes('123pan.cn')) return '123pan';
  if (lower.includes('teracloud.jp') || lower.includes('infinicloud.net')) return 'teracloud';
  if (lower.includes(':5005') || lower.includes(':5006')) return 'synology';
  if (lower.includes('/remote.php/dav/')) return 'nextcloud';
  if (lower.includes('/dav/') && !lower.includes('jianguoyun')) return 'alist';
  return 'custom';
}

function actionLabel(action: string): { text: string; tone: 'up' | 'down' | 'conflict' | 'muted' } {
  const a = action.toLowerCase();
  if (a.includes('conflict')) return { text: '冲突', tone: 'conflict' };
  if (a.includes('upload') || a.includes('push') || a.includes('local')) {
    return { text: '上传', tone: 'up' };
  }
  if (a.includes('download') || a.includes('pull') || a.includes('remote')) {
    return { text: '下载', tone: 'down' };
  }
  if (a.includes('delete')) return { text: '删除', tone: 'conflict' };
  return { text: action, tone: 'muted' };
}

function entityTypeLabel(entityType: string): string {
  switch (entityType.toLowerCase()) {
    case 'todo':
      return '待办';
    case 'list':
      return '清单';
    case 'note':
      return '便签';
    case 'note_group':
    case 'notegroup':
      return '分组';
    case 'settings':
      return '设置';
    default:
      return entityType;
  }
}

export const WebDavSyncCard: React.FC<WebDavSyncCardProps> = ({
  externalStatus,
  onDataSynced,
  onStatusChange,
}) => {
  const [config, setConfig] = useState<WebDavConfigView | null>(null);
  const [status, setStatus] = useState<WebDavStatusView | null>(externalStatus ?? null);
  const [expanded, setExpanded] = useState(false);

  // Editable form state
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [remoteDir, setRemoteDir] = useState('desktag');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [clearPassphrase, setClearPassphrase] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [autoSyncMinutes, setAutoSyncMinutes] = useState(3);
  const [debouncePush, setDebouncePush] = useState(true);
  const [followServer, setFollowServer] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>('jianguoyun');

  // Interactive panels & feedback
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<WebDavTestResult | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  // One-paste multi-device setup
  const [exportedSetupText, setExportedSetupText] = useState<string | null>(null);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');

  // Inline destructive confirmations
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmForceUpload, setConfirmForceUpload] = useState(false);
  const [needsForceUndo, setNeedsForceUndo] = useState(false);
  const userToggledEnabledRef = useRef(false);

  // Refresh relative timestamp periodically
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const hydrateFromConfig = useCallback((cfg: WebDavConfigView) => {
    setConfig(cfg);
    setEnabled(cfg.enabled);
    userToggledEnabledRef.current = false;
    setUrl(cfg.url);
    setRemoteDir(cfg.remoteDir || 'desktag');
    setUsername(cfg.username);
    setPassword('');
    setClearPassword(false);
    setPassphrase('');
    setClearPassphrase(false);
    setAutoSyncMinutes(cfg.autoSyncMinutes <= 0 ? 0 : cfg.autoSyncMinutes);
    setDebouncePush(cfg.debouncePush);
    setFollowServer(cfg.followServer);
    setSelectedPreset(detectPresetId(cfg.url));
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [cfg, st] = await Promise.all([getWebdavConfig(), getWebdavStatus()]);
      hydrateFromConfig(cfg);
      setStatus(st);
      onStatusChange?.(st);
      if (!st.configured) {
        setExpanded(true);
      }
    } catch (err) {
      setFeedback({ kind: 'error', text: `加载同步配置失败：${String(err)}` });
    }
  }, [hydrateFromConfig, onStatusChange]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (externalStatus) {
      setStatus(externalStatus);
    }
  }, [externalStatus]);

  const passphraseEqualsPassword = useMemo(() => {
    if (!passphrase || !password) return false;
    return passphrase === password;
  }, [passphrase, password]);

  const buildInput = useCallback(
    (forceEnable?: boolean): WebDavConfigInput => ({
      enabled: forceEnable !== undefined ? forceEnable : enabled,
      url: url.trim(),
      username: username.trim(),
      password: password.length > 0 ? password : null,
      passphrase: passphrase.length > 0 ? passphrase : null,
      clearPassword,
      clearPassphrase,
      remoteDir: remoteDir.trim() || 'desktag',
      autoSyncMinutes,
      debouncePush,
      followServer,
    }),
    [
      enabled,
      url,
      username,
      password,
      passphrase,
      clearPassword,
      clearPassphrase,
      remoteDir,
      autoSyncMinutes,
      debouncePush,
      followServer,
    ],
  );

  const handleSelectPreset = (preset: ProviderPreset) => {
    setSelectedPreset(preset.id);
    if (preset.url) {
      setUrl(preset.url);
      if (!config?.url && !userToggledEnabledRef.current) {
        setEnabled(true);
      }
    }
    setTestResult(null);
  };

  const activePreset = useMemo(
    () => PROVIDER_PRESETS.find((p) => p.id === selectedPreset) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1],
    [selectedPreset],
  );

  const applyStatusResult = useCallback(
    (nextStatus: WebDavStatusView, data?: AppData | null) => {
      setStatus(nextStatus);
      onStatusChange?.(nextStatus);
      if (data) {
        onDataSynced?.(data);
      }
    },
    [onDataSynced, onStatusChange],
  );

  const handleTestConnection = async () => {
    if (passphraseEqualsPassword) {
      setFeedback({ kind: 'error', text: '加密口令不能与 WebDAV 登录密码相同。' });
      return;
    }
    setBusyAction('test');
    setFeedback(null);
    setTestResult(null);
    try {
      const res = await testWebdavConnection(buildInput());
      setTestResult(res);
    } catch (err) {
      setTestResult({
        ok: false,
        statusCode: null,
        message: String(err),
        remoteFileExists: false,
        suggestedUrl: null,
        latencyMs: 0,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleApplySuggestedUrl = (suggested: string) => {
    setUrl(suggested);
    setSelectedPreset(detectPresetId(suggested));
    setTestResult(null);
    setFeedback({ kind: 'info', text: `已替换为建议地址：${suggested}` });
  };

  const handlePreview = async () => {
    if (passphraseEqualsPassword) {
      setFeedback({ kind: 'error', text: '加密口令不能与 WebDAV 登录密码相同。' });
      return;
    }
    setBusyAction('preview');
    setFeedback(null);
    setPreview(null);
    try {
      const res = await webdavPreview(buildInput());
      setPreview(res);
    } catch (err) {
      setFeedback({ kind: 'error', text: `预览失败：${String(err)}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleApplyPreview = async () => {
    if (!preview) return;
    setBusyAction('apply-preview');
    setFeedback(null);
    try {
      // Persist current form first if user edited fields before previewing
      const saved = await saveWebdavConfig(buildInput(true));
      hydrateFromConfig(saved);
      const res = await webdavSyncPreviewed(preview.token);
      applyStatusResult(res.status, res.data);
      setPreview(null);
      setFeedback({
        kind: res.ok ? 'success' : 'error',
        text: res.message || (res.ok ? '已应用本次同步变更' : '应用同步失败'),
      });
    } catch (err) {
      setFeedback({ kind: 'error', text: `应用同步失败：${String(err)}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveAndSync = async () => {
    if (passphraseEqualsPassword) {
      setFeedback({ kind: 'error', text: '加密口令不能与 WebDAV 登录密码相同，请修改后再保存。' });
      return;
    }
    setBusyAction('save-sync');
    setFeedback(null);
    setPreview(null);
    try {
      const shouldEnable =
        !userToggledEnabledRef.current && !config?.url && !config?.enabled && url.trim().length > 0
          ? true
          : enabled;
      const saved = await saveWebdavConfig(buildInput(shouldEnable));
      hydrateFromConfig(saved);
      if (saved.enabled) {
        const res = await webdavSyncNow();
        applyStatusResult(res.status, res.data);
        setFeedback({
          kind: res.ok ? 'success' : 'error',
          text: res.message || (res.ok ? '已保存配置并完成同步' : '配置已保存，但同步失败'),
        });
      } else {
        const st = await getWebdavStatus();
        applyStatusResult(st);
        setFeedback({ kind: 'success', text: '已保存同步配置（当前已暂停云同步）' });
      }
    } catch (err) {
      setFeedback({ kind: 'error', text: `保存或同步失败：${String(err)}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncNow = async () => {
    setBusyAction('sync');
    setFeedback(null);
    try {
      const res = await webdavSyncNow();
      applyStatusResult(res.status, res.data);
      setFeedback({
        kind: res.ok ? 'success' : 'error',
        text: res.message || (res.ok ? '同步完成' : '同步失败'),
      });
    } catch (err) {
      setFeedback({ kind: 'error', text: `同步失败：${String(err)}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportSetup = async () => {
    setBusyAction('export-setup');
    setFeedback(null);
    try {
      const text = await webdavExportSetupText();
      setExportedSetupText(text);
      try {
        await navigator.clipboard.writeText(text);
        setFeedback({
          kind: 'success',
          text: '已复制加密同步配置（desktag-sync:...），可在 Android 或另一台设备一键粘贴导入。',
        });
      } catch {
        setFeedback({
          kind: 'info',
          text: '已生成加密同步配置，请从下方文本框手动复制。',
        });
      }
    } catch (err) {
      setFeedback({ kind: 'error', text: `生成同步配置失败：${String(err)}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportSetup = async () => {
    const trimmed = importText.trim();
    if (!trimmed) {
      setFeedback({ kind: 'error', text: '请先粘贴 desktag-sync:... 同步配置文本。' });
      return;
    }
    setBusyAction('import-setup');
    setFeedback(null);
    try {
      const imported = await webdavImportSetupText(trimmed, importPassphrase);
      hydrateFromConfig(imported);
      const st = await getWebdavStatus();
      applyStatusResult(st);
      setShowImportPanel(false);
      setImportText('');
      setImportPassphrase('');
      setExpanded(true);
      setFeedback({
        kind: 'success',
        text: '已导入并解密同步配置！点击「保存并同步」或「立即同步」即可开始同步。',
      });
    } catch (err) {
      setFeedback({ kind: 'error', text: `导入失败：${String(err)}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleUndoSync = async (force = false) => {
    setBusyAction('undo');
    setFeedback(null);
    try {
      const res = await webdavUndoSync(force);
      applyStatusResult(res.status, res.data);
      if (res.ok) {
        setNeedsForceUndo(false);
        setFeedback({ kind: 'success', text: res.message || '已撤销上次同步并恢复本机快照' });
      } else {
        const msg = res.message || '无法撤销上次同步';
        if (!force && (msg.toLowerCase().includes('changed') || msg.includes('修改'))) {
          setNeedsForceUndo(true);
        }
        setFeedback({ kind: 'error', text: msg });
      }
    } catch (err) {
      setFeedback({ kind: 'error', text: `撤销失败：${String(err)}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestoreFromServer = async () => {
    setBusyAction('restore');
    setFeedback(null);
    try {
      const res = await webdavRestoreFromServer();
      applyStatusResult(res.status, res.data);
      setConfirmRestore(false);
      setFeedback({
        kind: res.ok ? 'success' : 'error',
        text: res.message || (res.ok ? '已从云端恢复完整数据（本机原数据已自动备份）' : '从云端恢复失败'),
      });
    } catch (err) {
      setFeedback({ kind: 'error', text: `从云端恢复失败：${String(err)}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleForceUpload = async () => {
    setBusyAction('force-upload');
    setFeedback(null);
    try {
      const res = await webdavForceUpload();
      applyStatusResult(res.status, res.data);
      setConfirmForceUpload(false);
      setFeedback({
        kind: res.ok ? 'success' : 'error',
        text: res.message || (res.ok ? '已强制上传本机数据覆盖云端损坏文件' : '强制上传失败'),
      });
    } catch (err) {
      setFeedback({ kind: 'error', text: `强制上传失败：${String(err)}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenSyncBackupDir = async () => {
    try {
      await openSyncBackupDir();
    } catch (err) {
      setFeedback({ kind: 'error', text: `无法打开同步备份目录：${String(err)}` });
    }
  };

  const isSyncing = Boolean(status?.syncing) || busyAction === 'sync' || busyAction === 'save-sync';
  const hasError = Boolean(status?.lastError || status?.serverFileWarning);
  const isReady = Boolean(status?.enabled && status?.configured);
  const hasE2ee = Boolean((config?.passphraseSet && !clearPassphrase) || passphrase.length > 0);

  const statusDotColor = isSyncing
    ? '#d4a741'
    : hasError
      ? '#e05552'
      : isReady
        ? '#5b8c5a'
        : '#9e988e';

  const statusText = isSyncing
    ? '正在同步…'
    : hasError
      ? '同步异常'
      : isReady
        ? formatRelativeTime(status?.lastSyncAt ?? null)
        : status?.configured
          ? '已暂停同步'
          : '未配置 WebDAV';

  return (
    <div className="dt-settings-card dt-webdav-card">
      {/* Top Status Row */}
      <div className="dt-webdav-header">
        <div className="dt-webdav-title-wrap">
          <div className="dt-webdav-title-row">
            <span
              className={`dt-status-dot${isSyncing ? ' is-pulsing' : ''}`}
              style={{ backgroundColor: statusDotColor }}
              title={statusText}
            />
            <span className="dt-settings-card-title">WebDAV 云同步</span>
            {hasE2ee && (
              <span className="dt-e2ee-badge" title="AES-256-GCM + PBKDF2-SHA256 本地端到端加密">
                🔒 AES-256-GCM 端到端加密
              </span>
            )}
          </div>
          <div className="dt-webdav-subtitle">
            <span>{statusText}</span>
            {status?.nextAutoSyncAt && isReady && !isSyncing && (
              <span className="dt-webdav-meta-sep">
                · 下次自动同步 {new Date(status.nextAutoSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        <div className="dt-webdav-header-actions">
          <button
            type="button"
            className="dt-btn dt-btn-soft"
            disabled={!status?.configured || busyAction !== null}
            onClick={() => void handleSyncNow()}
          >
            {isSyncing ? '同步中…' : '立即同步'}
          </button>
          <button
            type="button"
            className="dt-btn dt-btn-ghost"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '收起' : '配置'}
          </button>
        </div>
      </div>

      {/* Inline backend hint */}
      {status?.backendHint && (
        <div className="dt-webdav-banner is-info">{status.backendHint}</div>
      )}

      {/* Inline error notice */}
      {status?.lastError && (
        <div className="dt-webdav-banner is-error">
          <strong>同步错误：</strong>
          <span>{status.lastError}</span>
        </div>
      )}

      {/* Server file warning (Force Upload ONLY when canReplace === true) */}
      {status?.serverFileWarning && (
        <div className="dt-webdav-banner is-warning">
          <div className="dt-webdav-banner-body">
            <div>
              <strong>远端文件警告 ({status.serverFileWarning.kind})：</strong>
              <span>{status.serverFileWarning.message}</span>
            </div>
            {status.serverFileWarning.hint && (
              <div className="dt-webdav-banner-hint">{status.serverFileWarning.hint}</div>
            )}
          </div>
          {status.serverFileWarning.canReplace && (
            <div className="dt-webdav-banner-actions">
              {!confirmForceUpload ? (
                <button
                  type="button"
                  className="dt-btn dt-btn-danger-soft"
                  disabled={busyAction !== null}
                  onClick={() => setConfirmForceUpload(true)}
                >
                  强制上传覆盖
                </button>
              ) : (
                <div className="dt-inline-confirm">
                  <span>确认用本机数据覆盖远端文件？（原文件将保留备份）</span>
                  <button
                    type="button"
                    className="dt-btn dt-btn-danger"
                    disabled={busyAction !== null}
                    onClick={() => void handleForceUpload()}
                  >
                    确认覆盖
                  </button>
                  <button
                    type="button"
                    className="dt-btn dt-btn-ghost"
                    onClick={() => setConfirmForceUpload(false)}
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Conflict / Restore notice */}
      {status?.conflictNotice && (
        <div className="dt-webdav-banner is-warning">
          <div className="dt-webdav-banner-body">
            <div>
              <strong>
                {status.conflictNotice.restored
                  ? '已从云端恢复'
                  : status.conflictNotice.followed
                    ? '已跟随服务端'
                    : `同步合并提示（${status.conflictNotice.conflictCount} 项冲突已自动保留备份）`}
              </strong>
              <span className="dt-webdav-meta-sep"> · {formatRelativeTime(status.conflictNotice.at)}</span>
            </div>
            <div className="dt-webdav-banner-hint">{status.conflictNotice.summary}</div>
          </div>
          <button
            type="button"
            className="dt-btn dt-btn-soft dt-btn-xs"
            onClick={() => void handleOpenSyncBackupDir()}
          >
            打开同步备份目录
          </button>
        </div>
      )}

      {/* Transient Feedback */}
      {feedback && (
        <div className={`dt-webdav-banner is-${feedback.kind}`}>
          <span>{feedback.text}</span>
          <button
            type="button"
            className="dt-icon-btn-xs"
            aria-label="关闭提示"
            onClick={() => setFeedback(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Expandable Configuration Form */}
      {expanded && (
        <div className="dt-webdav-form">
          {/* Enable Switch */}
          <label className="dt-webdav-toggle-row">
            <div>
              <div className="dt-field-label">启用 WebDAV 云同步</div>
              <div className="dt-field-hint">
                数据完全保存在你自己的网盘或 NAS 中，零订阅费，支持 Windows / macOS / Android 跨端合并
              </div>
            </div>
            <input
              type="checkbox"
              className="dt-switch"
              checked={enabled}
              onChange={(e) => {
                userToggledEnabledRef.current = true;
                setEnabled(e.target.checked);
              }}
            />
          </label>

          {/* Provider Preset Chips */}
          <div className="dt-field-group">
            <div className="dt-field-label">快速选择服务商模板</div>
            <div className="dt-preset-chips">
              {PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`dt-chip${selectedPreset === preset.id ? ' is-active' : ''}`}
                  onClick={() => handleSelectPreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="dt-field-hint">{activePreset.hint}</div>
          </div>

          {/* URL & Remote Folder */}
          <div className="dt-form-grid-2-1">
            <label className="dt-field-group">
              <span className="dt-field-label">WebDAV 服务器地址</span>
              <input
                type="url"
                className="dt-input"
                placeholder="https://dav.jianguoyun.com/dav/"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setSelectedPreset(detectPresetId(e.target.value));
                  setTestResult(null);
                }}
              />
            </label>
            <label className="dt-field-group">
              <span className="dt-field-label">远程目录</span>
              <input
                type="text"
                className="dt-input"
                placeholder="desktag"
                value={remoteDir}
                onChange={(e) => setRemoteDir(e.target.value)}
              />
            </label>
          </div>

          {/* Username & Password */}
          <div className="dt-form-grid-2">
            <label className="dt-field-group">
              <span className="dt-field-label">用户名</span>
              <input
                type="text"
                className="dt-input"
                autoComplete="username"
                placeholder="邮箱或 WebDAV 账号"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>

            <div className="dt-field-group">
              <div className="dt-field-label-row">
                <span className="dt-field-label">密码 / 应用专用密码</span>
                {config?.passwordSet && !clearPassword && !password && (
                  <button
                    type="button"
                    className="dt-link-btn"
                    onClick={() => setClearPassword(true)}
                  >
                    清除已存密码
                  </button>
                )}
              </div>
              <div className="dt-input-with-action">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="dt-input"
                  autoComplete="current-password"
                  placeholder={
                    config?.passwordSet && !clearPassword
                      ? '••••••••（已安全保存，留空保持不变）'
                      : '请输入应用专用密码'
                  }
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (e.target.value) setClearPassword(false);
                  }}
                />
                <button
                  type="button"
                  className="dt-input-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  title={showPassword ? '隐藏' : '显示'}
                >
                  {showPassword ? '隐' : '显'}
                </button>
              </div>
            </div>
          </div>

          {/* Optional E2EE Passphrase */}
          <div className="dt-field-group">
            <div className="dt-field-label-row">
              <span className="dt-field-label">
                端到端加密口令（可选，强烈推荐）
                <span className="dt-e2ee-badge-inline">AES-256-GCM 端到端加密</span>
              </span>
              {config?.passphraseSet && !clearPassphrase && !passphrase && (
                <button
                  type="button"
                  className="dt-link-btn"
                  onClick={() => setClearPassphrase(true)}
                >
                  取消加密口令
                </button>
              )}
            </div>
            <div className="dt-input-with-action">
              <input
                type={showPassphrase ? 'text' : 'password'}
                className={`dt-input${passphraseEqualsPassword ? ' is-error' : ''}`}
                autoComplete="new-password"
                placeholder={
                  config?.passphraseSet && !clearPassphrase
                    ? '••••••••（已设置端到端加密口令，留空保持不变）'
                    : '输入独立加密口令，所有设备需保持一致'
                }
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  if (e.target.value) setClearPassphrase(false);
                }}
              />
              <button
                type="button"
                className="dt-input-eye"
                onClick={() => setShowPassphrase((v) => !v)}
                title={showPassphrase ? '隐藏' : '显示'}
              >
                {showPassphrase ? '隐' : '显'}
              </button>
            </div>
            {passphraseEqualsPassword ? (
              <div className="dt-field-error">
                安全警告：端到端加密口令不能与 WebDAV 登录密码相同（服务器收到登录密码后将能解密您的备份）。请换一个独立口令。
              </div>
            ) : (
              <div className="dt-field-hint">
                使用 PBKDF2-SHA256 + AES-256-GCM 在本地加密后上传；未填写时将仅以明文 JSON 同步。
              </div>
            )}
          </div>

          {/* Sync Frequency & Options */}
          <div className="dt-webdav-options-grid">
            <label className="dt-field-group">
              <span className="dt-field-label">自动同步频率</span>
              <select
                className="dt-select"
                value={autoSyncMinutes}
                onChange={(e) => setAutoSyncMinutes(Number(e.target.value))}
              >
                {AUTO_SYNC_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="dt-check-row">
              <input
                type="checkbox"
                checked={debouncePush}
                onChange={(e) => setDebouncePush(e.target.checked)}
              />
              <span>
                <strong>编辑后自动防抖推送</strong>
                <small>修改待办或便签几秒后自动增量同步</small>
              </span>
            </label>

            <label className="dt-check-row">
              <input
                type="checkbox"
                checked={followServer}
                onChange={(e) => setFollowServer(e.target.checked)}
              />
              <span>
                <strong>仅跟随服务端 (FollowServer)</strong>
                <small>只拉取云端更新，不把本机修改上传覆盖远端</small>
              </span>
            </label>
          </div>

          {/* Primary Action Buttons */}
          <div className="dt-webdav-actions">
            <button
              type="button"
              className="dt-btn dt-btn-soft"
              disabled={busyAction !== null || !url.trim()}
              onClick={() => void handleTestConnection()}
            >
              {busyAction === 'test' ? '测试中…' : '测试连接'}
            </button>
            <button
              type="button"
              className="dt-btn dt-btn-soft"
              disabled={busyAction !== null || !url.trim() || passphraseEqualsPassword}
              onClick={() => void handlePreview()}
            >
              {busyAction === 'preview' ? '计算差异…' : '预览变更'}
            </button>
            <button
              type="button"
              className="dt-btn dt-btn-primary"
              disabled={busyAction !== null || passphraseEqualsPassword}
              onClick={() => void handleSaveAndSync()}
            >
              {busyAction === 'save-sync'
                ? enabled
                  ? '保存并同步中…'
                  : '保存中…'
                : enabled
                  ? '保存并同步'
                  : '保存配置'}
            </button>
          </div>

          {/* Test Connection Result */}
          {testResult && (
            <div className={`dt-webdav-test-result ${testResult.ok ? 'is-ok' : 'is-fail'}`}>
              <div className="dt-webdav-test-top">
                <span>
                  {testResult.ok ? '✓ 连接成功' : '✕ 连接失败'}
                  {testResult.statusCode !== null && ` (HTTP ${testResult.statusCode})`}
                </span>
                <span className="dt-webdav-latency">
                  {testResult.latencyMs > 0 ? `${testResult.latencyMs} ms` : ''}
                  {testResult.ok &&
                    ` · ${testResult.remoteFileExists ? '已发现云端同步文件' : '云端尚无同步文件（首次同步将自动创建）'}`}
                </span>
              </div>
              <div className="dt-webdav-test-msg">{testResult.message}</div>
              {testResult.suggestedUrl && (
                <div className="dt-suggested-url-row">
                  <span>检测到建议地址：<code>{testResult.suggestedUrl}</code></span>
                  <button
                    type="button"
                    className="dt-btn dt-btn-primary dt-btn-xs"
                    onClick={() => handleApplySuggestedUrl(testResult.suggestedUrl!)}
                  >
                    一键应用此地址
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Live Preview Diff Panel */}
          {preview && (
            <div className="dt-webdav-preview-box">
              <div className="dt-webdav-preview-head">
                <div>
                  <strong>同步变更预览</strong>
                  <span className="dt-webdav-meta-sep"> · {preview.summary}</span>
                </div>
                <button
                  type="button"
                  className="dt-icon-btn-xs"
                  onClick={() => setPreview(null)}
                  aria-label="关闭预览"
                >
                  ×
                </button>
              </div>
              <div className="dt-webdav-preview-stats">
                <span className="dt-stat-pill is-up">上传 {preview.toUploadCount}</span>
                <span className="dt-stat-pill is-down">下载 {preview.toDownloadCount}</span>
                <span className="dt-stat-pill is-conflict">冲突 {preview.conflictCount}</span>
              </div>
              {preview.items.length > 0 && (
                <ul className="dt-webdav-preview-list">
                  {preview.items.slice(0, 30).map((item, idx) => {
                    const badge = actionLabel(item.action);
                    return (
                      <li key={`${item.entityType}-${item.entityId}-${idx}`}>
                        <span className={`dt-diff-tag is-${badge.tone}`}>{badge.text}</span>
                        <span className="dt-diff-type">{entityTypeLabel(item.entityType)}</span>
                        <span className="dt-diff-title">{item.title || item.entityId}</span>
                      </li>
                    );
                  })}
                  {preview.items.length > 30 && (
                    <li className="dt-diff-more">其余 {preview.items.length - 30} 项已省略…</li>
                  )}
                </ul>
              )}
              <div className="dt-webdav-preview-footer">
                <span className="dt-field-hint">校验令牌：{preview.token.slice(0, 12)}</span>
                <div className="dt-webdav-preview-btns">
                  <button
                    type="button"
                    className="dt-btn dt-btn-ghost dt-btn-xs"
                    onClick={() => setPreview(null)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="dt-btn dt-btn-primary dt-btn-xs"
                    disabled={busyAction !== null}
                    onClick={() => void handleApplyPreview()}
                  >
                    {busyAction === 'apply-preview' ? '应用中…' : '确认应用本次同步'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Advanced / Multi-device Row */}
          <div className="dt-webdav-advanced">
            <div className="dt-field-label">多设备快捷配置与恢复工具</div>
            <div className="dt-webdav-advanced-btns">
              <button
                type="button"
                className="dt-btn dt-btn-soft dt-btn-xs"
                disabled={busyAction !== null || !status?.configured}
                onClick={() => void handleExportSetup()}
              >
                复制同步配置
              </button>
              <button
                type="button"
                className="dt-btn dt-btn-soft dt-btn-xs"
                disabled={busyAction !== null}
                onClick={() => setShowImportPanel((v) => !v)}
              >
                粘贴导入配置
              </button>
              <button
                type="button"
                className="dt-btn dt-btn-soft dt-btn-xs"
                disabled={busyAction !== null || !status?.canUndo}
                onClick={() => void handleUndoSync(false)}
                title={status?.canUndo ? '回滚到上次同步前的本机快照' : '暂无可撤销的同步快照'}
              >
                撤销上次同步
              </button>
              {needsForceUndo && (
                <button
                  type="button"
                  className="dt-btn dt-btn-danger-soft dt-btn-xs"
                  disabled={busyAction !== null}
                  onClick={() => void handleUndoSync(true)}
                >
                  强制撤销
                </button>
              )}
              <button
                type="button"
                className="dt-btn dt-btn-soft dt-btn-xs"
                disabled={busyAction !== null || !status?.configured}
                onClick={() => setConfirmRestore((v) => !v)}
              >
                从云端恢复
              </button>
              <button
                type="button"
                className="dt-btn dt-btn-ghost dt-btn-xs"
                onClick={() => void handleOpenSyncBackupDir()}
              >
                打开同步备份目录
              </button>
            </div>

            {/* Exported Setup Text Fallback Box */}
            {exportedSetupText && (
              <div className="dt-setup-box">
                <div className="dt-field-label-row">
                  <span className="dt-field-hint">已加密同步配置（仅含服务端凭据，不含加密口令本身）：</span>
                  <button
                    type="button"
                    className="dt-link-btn"
                    onClick={() => setExportedSetupText(null)}
                  >
                    收起
                  </button>
                </div>
                <textarea
                  readOnly
                  className="dt-textarea dt-setup-textarea"
                  rows={2}
                  value={exportedSetupText}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </div>
            )}

            {/* Paste & Import Setup Panel */}
            {showImportPanel && (
              <div className="dt-setup-box">
                <div className="dt-field-label">粘贴来自其他设备的同步配置</div>
                <textarea
                  className="dt-textarea dt-setup-textarea"
                  rows={2}
                  placeholder="粘贴 desktag-sync:... 字符串"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                <div className="dt-import-row">
                  <input
                    type="password"
                    className="dt-input"
                    placeholder="输入对应的端到端加密口令（若未设加密可留空）"
                    value={importPassphrase}
                    onChange={(e) => setImportPassphrase(e.target.value)}
                  />
                  <button
                    type="button"
                    className="dt-btn dt-btn-primary dt-btn-xs"
                    disabled={busyAction !== null}
                    onClick={() => void handleImportSetup()}
                  >
                    {busyAction === 'import-setup' ? '导入中…' : '解密并导入'}
                  </button>
                </div>
              </div>
            )}

            {/* Confirm Restore From Server */}
            {confirmRestore && (
              <div className="dt-inline-confirm dt-setup-box">
                <span>
                  确认从云端全量恢复并覆盖本机当前数据？（系统会先将本机数据备份至同步备份目录）
                </span>
                <div className="dt-inline-confirm-btns">
                  <button
                    type="button"
                    className="dt-btn dt-btn-danger dt-btn-xs"
                    disabled={busyAction !== null}
                    onClick={() => void handleRestoreFromServer()}
                  >
                    {busyAction === 'restore' ? '恢复中…' : '确认从云端恢复'}
                  </button>
                  <button
                    type="button"
                    className="dt-btn dt-btn-ghost dt-btn-xs"
                    onClick={() => setConfirmRestore(false)}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WebDavSyncCard;
