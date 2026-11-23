import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  GitCompareArrows,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardFrame,
  CardFrameAction,
  CardFrameHeader,
  CardFrameTitle,
  CardPanel,
} from '@/components/ui/card';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Frame, FramePanel } from '@/components/ui/frame';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

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

const AUTO_SYNC_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '0', label: '手动' },
  { value: '3', label: '每 3 分钟' },
  { value: '15', label: '每 15 分钟' },
  { value: '30', label: '每 30 分钟' },
  { value: '60', label: '每 60 分钟' },
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

function actionLabel(action: string): {
  text: string;
  variant: 'info' | 'success' | 'warning' | 'error' | 'secondary';
} {
  const a = action.toLowerCase();
  if (a.includes('conflict')) return { text: '冲突', variant: 'warning' };
  if (a.includes('upload') || a.includes('push') || a.includes('local')) {
    return { text: '上传', variant: 'info' };
  }
  if (a.includes('download') || a.includes('pull') || a.includes('remote')) {
    return { text: '下载', variant: 'success' };
  }
  if (a.includes('delete')) return { text: '删除', variant: 'error' };
  return { text: action, variant: 'secondary' };
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
  const [expanded, setExpanded] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
    () =>
      PROVIDER_PRESETS.find((p) => p.id === selectedPreset) ??
      PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1],
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

  const statusDotClass = isSyncing
    ? 'bg-warning animate-pulse'
    : hasError
      ? 'bg-destructive'
      : isReady
        ? 'bg-success'
        : 'bg-muted-foreground/45';

  const nextSyncTime =
    status?.nextAutoSyncAt && isReady && !isSyncing
      ? new Date(status.nextAutoSyncAt).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  const statusSummaryText = isSyncing
    ? '正在与云端同步…'
    : hasError
      ? '同步存在异常，请查看下方详情'
      : isReady
        ? `云端已同步 · ${formatRelativeTime(status?.lastSyncAt ?? null)}${nextSyncTime ? ` · 下次自动同步 ${nextSyncTime}` : ''}`
        : status?.configured
          ? '已配置但当前已暂停自动同步'
          : '尚未配置 WebDAV，选择服务商模板快速开始';

  const statusAlertVariant: 'success' | 'error' | 'warning' | 'info' = hasError
    ? status?.lastError
      ? 'error'
      : 'warning'
    : isReady
      ? 'success'
      : 'info';

  return (
    <CardFrame>
      {/* Top Single-Row Header */}
      <CardFrameHeader className="items-center gap-x-2 py-2.5 px-3.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            className={cn('inline-block size-2 shrink-0 rounded-full', statusDotClass)}
            aria-hidden="true"
          />
          <CardFrameTitle className="text-[13.5px] font-semibold text-foreground">
            WebDAV 云同步
          </CardFrameTitle>
          {hasE2ee && (
            <Badge
              variant="success"
              size="sm"
              className="gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium"
              title="AES-256-GCM + PBKDF2-SHA256 本地端到端加密"
            >
              <Lock className="size-2.5" />
              <span>AES-256-GCM 端到端加密</span>
            </Badge>
          )}
        </div>
        <CardFrameAction className="items-center gap-1">
          <Button
            size="sm"
            variant="default"
            loading={isSyncing}
            disabled={!status?.configured || busyAction !== null}
            onClick={() => void handleSyncNow()}
            className="h-7 px-2.5 text-xs"
          >
            <RefreshCw className="size-3.5" />
            <span>立即同步</span>
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? '收起同步配置' : '展开同步配置'}
            title={expanded ? '收起配置' : '展开配置'}
            className="size-7 text-muted-foreground"
          >
            <ChevronDown
              className={cn('size-4 transition-transform duration-150', expanded && 'rotate-180')}
            />
          </Button>
        </CardFrameAction>
      </CardFrameHeader>

      <Card>
        <CardPanel className="flex flex-col gap-3 p-3.5">
          {/* Status Summary Alert Bar + Inline Test Connection */}
          <Alert variant={statusAlertVariant} className="items-center px-3 py-2">
            {statusAlertVariant === 'success' ? (
              <CheckCircle2 className="size-3.5" />
            ) : statusAlertVariant === 'error' ? (
              <AlertCircle className="size-3.5" />
            ) : statusAlertVariant === 'warning' ? (
              <AlertTriangle className="size-3.5" />
            ) : (
              <Cloud className="size-3.5" />
            )}
            <AlertTitle className="text-xs font-medium leading-snug">
              {statusSummaryText}
            </AlertTitle>
            <AlertAction>
              <Button
                size="xs"
                variant="ghost"
                disabled={busyAction !== null || !url.trim()}
                loading={busyAction === 'test'}
                onClick={() => void handleTestConnection()}
                className={cn(
                  'h-6 px-2 text-xs font-medium',
                  statusAlertVariant === 'success' && 'text-success-foreground hover:bg-success/12',
                )}
              >
                测试连接
              </Button>
            </AlertAction>
          </Alert>

          {/* Backend Runtime Hint */}
          {status?.backendHint && (
            <Alert variant="info" className="px-3 py-2">
              <Cloud className="size-3.5" />
              <AlertDescription className="text-xs text-foreground/85">
                {status.backendHint}
              </AlertDescription>
            </Alert>
          )}

          {/* Sync Error Notice */}
          {status?.lastError && (
            <Alert variant="error" className="px-3 py-2">
              <AlertCircle className="size-3.5" />
              <AlertTitle className="text-xs font-semibold text-destructive-foreground">
                同步错误
              </AlertTitle>
              <AlertDescription className="text-xs text-destructive-foreground/90 break-words">
                {status.lastError}
              </AlertDescription>
            </Alert>
          )}

          {/* Server File Warning (Force Upload ONLY when canReplace === true) */}
          {status?.serverFileWarning && (
            <Alert variant="warning" className="px-3 py-2.5">
              <ShieldAlert className="size-3.5" />
              <AlertTitle className="text-xs font-semibold text-warning-foreground">
                远端文件警告 ({status.serverFileWarning.kind})
              </AlertTitle>
              <AlertDescription className="gap-1.5 text-xs">
                <span className="text-foreground/90">{status.serverFileWarning.message}</span>
                {status.serverFileWarning.hint && (
                  <span className="text-muted-foreground">{status.serverFileWarning.hint}</span>
                )}
                {status.serverFileWarning.canReplace && (
                  <div className="pt-1">
                    {!confirmForceUpload ? (
                      <Button
                        size="xs"
                        variant="destructive-outline"
                        disabled={busyAction !== null}
                        onClick={() => setConfirmForceUpload(true)}
                      >
                        <Upload className="size-3" />
                        <span>强制上传覆盖</span>
                      </Button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-destructive/25 bg-destructive/6 p-2">
                        <span className="text-xs text-foreground">
                          确认用本机数据覆盖远端文件？（原文件将保留备份）
                        </span>
                        <div className="flex items-center gap-1.5 ms-auto">
                          <Button
                            size="xs"
                            variant="destructive"
                            disabled={busyAction !== null}
                            loading={busyAction === 'force-upload'}
                            onClick={() => void handleForceUpload()}
                          >
                            确认覆盖
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setConfirmForceUpload(false)}
                          >
                            取消
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Conflict / Restore Notice */}
          {status?.conflictNotice && (
            <Alert variant="warning" className="px-3 py-2">
              <AlertTriangle className="size-3.5" />
              <AlertTitle className="text-xs font-semibold">
                {status.conflictNotice.restored
                  ? '已从云端恢复'
                  : status.conflictNotice.followed
                    ? '已跟随服务端'
                    : `同步合并提示（${status.conflictNotice.conflictCount} 项冲突已自动保留备份）`}
                <span className="ms-1.5 font-normal text-muted-foreground">
                  · {formatRelativeTime(status.conflictNotice.at)}
                </span>
              </AlertTitle>
              <AlertDescription className="text-xs">
                {status.conflictNotice.summary}
              </AlertDescription>
              <AlertAction>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void handleOpenSyncBackupDir()}
                >
                  打开备份目录
                </Button>
              </AlertAction>
            </Alert>
          )}

          {/* Transient Feedback Banner */}
          {feedback && (
            <Alert
              variant={feedback.kind === 'error' ? 'error' : feedback.kind === 'success' ? 'success' : 'info'}
              className="items-center px-3 py-2"
            >
              {feedback.kind === 'error' ? (
                <AlertCircle className="size-3.5" />
              ) : feedback.kind === 'success' ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <Cloud className="size-3.5" />
              )}
              <AlertDescription className="text-xs text-foreground">
                {feedback.text}
              </AlertDescription>
              <AlertAction>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="关闭提示"
                  onClick={() => setFeedback(null)}
                >
                  <X className="size-3" />
                </Button>
              </AlertAction>
            </Alert>
          )}

          {/* Expandable Configuration Form */}
          {expanded && (
            <div className="flex flex-col gap-3">
              {/* Enable Switch Row */}
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-foreground">
                    启用 WebDAV 云同步
                  </div>
                  <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    数据完全保存在个人网盘或 NAS，支持 Windows / macOS / Android 多端自动合并
                  </div>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) => {
                    userToggledEnabledRef.current = true;
                    setEnabled(checked);
                  }}
                  aria-label="启用 WebDAV 云同步"
                />
              </div>

              <Separator />

              {/* Provider Presets */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">服务商模板</span>
                <ToggleGroup
                  value={[selectedPreset]}
                  onValueChange={(vals) => {
                    const next = vals[vals.length - 1];
                    const preset = PROVIDER_PRESETS.find((p) => p.id === next);
                    if (preset) handleSelectPreset(preset);
                  }}
                  className="flex w-full flex-wrap gap-1.5"
                >
                  {PROVIDER_PRESETS.map((preset) => (
                    <ToggleGroupItem
                      key={preset.id}
                      value={preset.id}
                      size="sm"
                      className="h-7 rounded-lg border-input bg-background px-2.5 text-xs font-medium text-foreground shadow-xs/5 hover:bg-accent/60 data-pressed:border-primary data-pressed:bg-primary data-pressed:text-primary-foreground data-pressed:shadow-xs data-pressed:hover:bg-primary/90 dark:bg-input/32 dark:data-pressed:bg-primary"
                    >
                      {preset.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {activePreset.hint}
                </p>
              </div>

              {/* Row 1: Server URL & Remote Directory */}
              <div className="grid grid-cols-1 gap-2.5 min-[380px]:grid-cols-[1.65fr_1fr]">
                <Field>
                  <FieldLabel className="text-xs">服务器地址</FieldLabel>
                  <Input
                    size="sm"
                    type="url"
                    placeholder="https://dav.jianguoyun.com/dav/"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setSelectedPreset(detectPresetId(e.target.value));
                      setTestResult(null);
                    }}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">远程目录</FieldLabel>
                  <Input
                    size="sm"
                    type="text"
                    placeholder="desktag"
                    value={remoteDir}
                    onChange={(e) => setRemoteDir(e.target.value)}
                  />
                </Field>
              </div>

              {/* Row 2: Username & App Password */}
              <div className="grid grid-cols-1 gap-2.5 min-[380px]:grid-cols-2">
                <Field>
                  <FieldLabel className="text-xs">用户名</FieldLabel>
                  <Input
                    size="sm"
                    type="text"
                    autoComplete="username"
                    placeholder="邮箱或 WebDAV 账号"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </Field>

                <Field>
                  <div className="flex w-full items-center justify-between gap-2">
                    <FieldLabel className="text-xs">应用密码</FieldLabel>
                    {config?.passwordSet && !clearPassword && !password && (
                      <button
                        type="button"
                        className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline cursor-pointer"
                        onClick={() => setClearPassword(true)}
                      >
                        清除已存密码
                      </button>
                    )}
                  </div>
                  <InputGroup>
                    <InputGroupInput
                      size="sm"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder={
                        config?.passwordSet && !clearPassword
                          ? '••••••••（留空不变）'
                          : '应用专用密码'
                      }
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (e.target.value) setClearPassword(false);
                      }}
                    />
                    <InputGroupAddon align="inline-end">
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? '隐藏密码' : '显示密码'}
                        title={showPassword ? '隐藏密码' : '显示密码'}
                      >
                        {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </Button>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
              </div>

              {/* Row 3: Optional E2EE Passphrase */}
              <Field invalid={passphraseEqualsPassword}>
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <FieldLabel className="text-xs">端到端加密口令</FieldLabel>
                    {hasE2ee ? (
                      <Badge variant="success" size="sm">
                        已加密
                      </Badge>
                    ) : (
                      <Badge variant="secondary" size="sm">
                        可选·推荐
                      </Badge>
                    )}
                  </div>
                  {config?.passphraseSet && !clearPassphrase && !passphrase && (
                    <button
                      type="button"
                      className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline cursor-pointer"
                      onClick={() => setClearPassphrase(true)}
                    >
                      取消加密口令
                    </button>
                  )}
                </div>
                <InputGroup>
                  <InputGroupInput
                    size="sm"
                    type={showPassphrase ? 'text' : 'password'}
                    autoComplete="new-password"
                    aria-invalid={passphraseEqualsPassword || undefined}
                    placeholder={
                      config?.passphraseSet && !clearPassphrase
                        ? '••••••••（已设置加密口令，留空保持不变）'
                        : '输入独立加密口令，所有设备需保持一致'
                    }
                    value={passphrase}
                    onChange={(e) => {
                      setPassphrase(e.target.value);
                      if (e.target.value) setClearPassphrase(false);
                    }}
                  />
                  <InputGroupAddon align="inline-end">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => setShowPassphrase((v) => !v)}
                      aria-label={showPassphrase ? '隐藏口令' : '显示口令'}
                      title={showPassphrase ? '隐藏口令' : '显示口令'}
                    >
                      {showPassphrase ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </Button>
                  </InputGroupAddon>
                </InputGroup>
                {passphraseEqualsPassword ? (
                  <FieldError match={true}>
                    安全警告：端到端加密口令不能与 WebDAV 登录密码相同，请换一个独立口令。
                  </FieldError>
                ) : (
                  <FieldDescription className="text-[11.5px]">
                    使用 PBKDF2-SHA256 + AES-256-GCM 在本地加密后上传；留空时以明文 JSON 同步。
                  </FieldDescription>
                )}
              </Field>

              {/* Auto-Sync Interval Row */}
              <div className="flex items-center justify-between gap-3 pt-0.5">
                <span className="text-xs font-medium text-foreground">后台自动同步间隔</span>
                <Select
                  items={AUTO_SYNC_OPTIONS}
                  value={String(autoSyncMinutes)}
                  onValueChange={(val) => {
                    if (val !== null) setAutoSyncMinutes(Number(val));
                  }}
                >
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {AUTO_SYNC_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              {/* Primary Action Bar */}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <Button
                  size="sm"
                  variant="outline"
                  loading={busyAction === 'preview'}
                  disabled={busyAction !== null || !url.trim() || passphraseEqualsPassword}
                  onClick={() => void handlePreview()}
                  className="text-xs"
                >
                  <GitCompareArrows className="size-3.5" />
                  <span>预览差异</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  loading={busyAction === 'export-setup'}
                  disabled={busyAction !== null || !status?.configured}
                  onClick={() => void handleExportSetup()}
                  className="text-xs"
                >
                  <Copy className="size-3.5" />
                  <span>导出配置码</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyAction !== null}
                  onClick={() => setShowImportPanel((v) => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  <Download className="size-3.5" />
                  <span>导入配置码</span>
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  loading={busyAction === 'save-sync'}
                  disabled={busyAction !== null || passphraseEqualsPassword}
                  onClick={() => void handleSaveAndSync()}
                  className="ms-auto text-xs"
                >
                  <Save className="size-3.5" />
                  <span>{enabled ? '保存并同步' : '保存配置'}</span>
                </Button>
              </div>

              {/* Test Connection Result */}
              {testResult && (
                <Alert variant={testResult.ok ? 'success' : 'error'} className="px-3 py-2.5">
                  {testResult.ok ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : (
                    <AlertCircle className="size-3.5" />
                  )}
                  <AlertTitle className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
                    <span>
                      {testResult.ok ? '连接成功' : '连接失败'}
                      {testResult.statusCode !== null && ` (HTTP ${testResult.statusCode})`}
                    </span>
                    <span className="font-normal tabular-nums text-muted-foreground">
                      {testResult.latencyMs > 0 ? `${testResult.latencyMs} ms` : ''}
                      {testResult.ok &&
                        ` · ${testResult.remoteFileExists ? '已发现云端同步文件' : '首次同步将自动创建'}`}
                    </span>
                  </AlertTitle>
                  <AlertDescription className="gap-2 text-xs">
                    <span className="break-words text-foreground/90">{testResult.message}</span>
                    {testResult.suggestedUrl && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/80 px-2.5 py-1.5">
                        <span className="min-w-0 break-all text-xs text-muted-foreground">
                          建议地址：
                          <code className="ms-1 font-mono text-foreground">
                            {testResult.suggestedUrl}
                          </code>
                        </span>
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() => handleApplySuggestedUrl(testResult.suggestedUrl!)}
                        >
                          一键应用
                        </Button>
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* Live Preview Diff Panel */}
              {preview && (
                <Frame>
                  <FramePanel className="flex flex-col gap-2.5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-foreground">同步变更预览</div>
                        <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                          {preview.summary}
                        </div>
                      </div>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => setPreview(null)}
                        aria-label="关闭预览"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="info" size="sm">
                        上传 {preview.toUploadCount}
                      </Badge>
                      <Badge variant="success" size="sm">
                        下载 {preview.toDownloadCount}
                      </Badge>
                      <Badge variant={preview.conflictCount > 0 ? 'warning' : 'secondary'} size="sm">
                        冲突 {preview.conflictCount}
                      </Badge>
                    </div>

                    {preview.items.length > 0 && (
                      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-background/60 p-1.5">
                        {preview.items.slice(0, 30).map((item, idx) => {
                          const badge = actionLabel(item.action);
                          return (
                            <li
                              key={`${item.entityType}-${item.entityId}-${idx}`}
                              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs"
                            >
                              <Badge variant={badge.variant} size="sm" className="shrink-0">
                                {badge.text}
                              </Badge>
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {entityTypeLabel(item.entityType)}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-foreground">
                                {item.title || item.entityId}
                              </span>
                            </li>
                          );
                        })}
                        {preview.items.length > 30 && (
                          <li className="px-1.5 py-1 text-[11px] text-muted-foreground">
                            其余 {preview.items.length - 30} 项已省略…
                          </li>
                        )}
                      </ul>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        令牌：{preview.token.slice(0, 12)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button size="xs" variant="ghost" onClick={() => setPreview(null)}>
                          取消
                        </Button>
                        <Button
                          size="xs"
                          variant="default"
                          loading={busyAction === 'apply-preview'}
                          disabled={busyAction !== null}
                          onClick={() => void handleApplyPreview()}
                        >
                          确认应用本次同步
                        </Button>
                      </div>
                    </div>
                  </FramePanel>
                </Frame>
              )}

              {/* Exported Setup Code Panel */}
              {exportedSetupText && (
                <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-coss-frame-well p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11.5px] text-muted-foreground">
                      已加密同步配置码（仅含服务端凭据，不含加密口令本身）
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setExportedSetupText(null)}
                    >
                      收起
                    </Button>
                  </div>
                  <Textarea
                    readOnly
                    size="sm"
                    rows={2}
                    className="font-mono text-xs"
                    value={exportedSetupText}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </div>
              )}

              {/* Paste & Import Setup Code Panel */}
              {showImportPanel && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-coss-frame-well p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">
                      粘贴来自其他设备的同步配置码
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="关闭导入面板"
                      onClick={() => setShowImportPanel(false)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                  <Textarea
                    size="sm"
                    rows={2}
                    className="font-mono text-xs"
                    placeholder="粘贴 desktag-sync:... 字符串"
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                  />
                  <div className="flex flex-col gap-2 min-[380px]:flex-row min-[380px]:items-center">
                    <Input
                      size="sm"
                      type="password"
                      placeholder="输入对应的端到端加密口令（未加密可留空）"
                      value={importPassphrase}
                      onChange={(e) => setImportPassphrase(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      variant="default"
                      loading={busyAction === 'import-setup'}
                      disabled={busyAction !== null}
                      onClick={() => void handleImportSetup()}
                      className="shrink-0 text-xs"
                    >
                      解密并导入
                    </Button>
                  </div>
                </div>
              )}

              <Separator />

              {/* Collapsible Advanced Sync Options & Recovery Tools */}
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="xs"
                      className="w-full justify-between px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    />
                  }
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Settings2 className="size-3.5" />
                    <span>高级同步选项与恢复工具</span>
                  </span>
                  <ChevronDown
                    className={cn(
                      'size-3.5 transition-transform duration-150',
                      advancedOpen && 'rotate-180',
                    )}
                  />
                </CollapsibleTrigger>

                <CollapsiblePanel>
                  <div className="flex flex-col gap-2.5 pt-2.5">
                    {/* Debounce Push Switch */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground">
                          编辑后自动防抖推送
                        </div>
                        <div className="text-[11.5px] text-muted-foreground">
                          修改待办或便签几秒后自动增量同步
                        </div>
                      </div>
                      <Switch
                        checked={debouncePush}
                        onCheckedChange={setDebouncePush}
                        aria-label="编辑后自动防抖推送"
                      />
                    </div>

                    {/* Follow Server Switch */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground">
                          仅跟随服务端 (FollowServer)
                        </div>
                        <div className="text-[11.5px] text-muted-foreground">
                          只拉取云端更新，不把本机修改上传覆盖远端
                        </div>
                      </div>
                      <Switch
                        checked={followServer}
                        onCheckedChange={setFollowServer}
                        aria-label="仅跟随服务端"
                      />
                    </div>

                    <Separator />

                    {/* Recovery Action Buttons */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busyAction !== null || !status?.canUndo}
                        loading={busyAction === 'undo'}
                        onClick={() => void handleUndoSync(false)}
                        title={
                          status?.canUndo ? '回滚到上次同步前的本机快照' : '暂无可撤销的同步快照'
                        }
                      >
                        <RotateCcw className="size-3" />
                        <span>撤销上次同步</span>
                      </Button>

                      {needsForceUndo && (
                        <Button
                          size="xs"
                          variant="destructive-outline"
                          disabled={busyAction !== null}
                          onClick={() => void handleUndoSync(true)}
                        >
                          强制撤销
                        </Button>
                      )}

                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busyAction !== null || !status?.configured}
                        onClick={() => setConfirmRestore((v) => !v)}
                      >
                        <Download className="size-3" />
                        <span>从云端恢复</span>
                      </Button>

                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => void handleOpenSyncBackupDir()}
                      >
                        <FolderOpen className="size-3" />
                        <span>同步备份目录</span>
                      </Button>
                    </div>

                    {/* Confirm Restore From Server */}
                    {confirmRestore && (
                      <Alert variant="warning" className="px-3 py-2.5">
                        <AlertTriangle className="size-3.5" />
                        <AlertDescription className="gap-2 text-xs">
                          <span className="text-foreground">
                            确认从云端全量恢复并覆盖本机当前数据？（系统会先将本机数据备份至同步备份目录）
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="xs"
                              variant="destructive"
                              loading={busyAction === 'restore'}
                              disabled={busyAction !== null}
                              onClick={() => void handleRestoreFromServer()}
                            >
                              确认从云端恢复
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setConfirmRestore(false)}
                            >
                              取消
                            </Button>
                          </div>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </CollapsiblePanel>
              </Collapsible>
            </div>
          )}
        </CardPanel>
      </Card>
    </CardFrame>
  );
};

export default WebDavSyncCard;
