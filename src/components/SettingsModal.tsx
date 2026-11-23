import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Upload,
} from 'lucide-react';
import {
  changeStorageDir,
  exportBackup,
  getStorageInfo,
  importBackup,
  isTauriRuntime,
  openStorageDir,
} from '../api/tauri';
import { useDeskTagStore, type SettingsTabId } from '../store/useDeskTagStore';
import { FONT_OPTIONS, SKINS, getFontFamilyStack, getSkinById } from '../themes/skins';
import type {
  AppData,
  DefaultView,
  DeviceSettings,
  DockMode,
  InstallKind,
  StorageInfo,
  TabWidthMode,
  TodoPriority,
  TodoSortBy,
} from '../types/models';
import { formatRelativeTime } from '../utils/lunar';
import { exportDeskTagDocument, type ClientExportFormat } from '../utils/exporter';
import { cn } from '@/lib/utils';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardFrame,
  CardFrameAction,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
  CardPanel,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Frame, FramePanel } from '@/components/ui/frame';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Progress, ProgressIndicator, ProgressTrack } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { MascotAvatar, SkinSwatchTile } from './Icons';
import { WebDavSyncCard } from './WebDavSyncCard';

export interface SettingsModalProps {
  /** Render inline without backdrop overlay (used for Android's bottom Settings tab). */
  inline?: boolean;
  /** Optional tab to activate when the settings modal opens (e.g. `'about'`). */
  initialTab?: SettingsTabId | string;
}

const CLOSE_BEHAVIOR_OPTIONS = [
  { value: 'tray', label: '隐藏至系统托盘' },
  { value: 'quit', label: '直接退出程序' },
];

const DOCK_MODE_OPTIONS: Array<{ value: DockMode; label: string }> = [
  { value: 'right_tabs', label: '右侧保留页签' },
  { value: 'right_hide', label: '右侧完全隐藏' },
  { value: 'left_tabs', label: '左侧保留页签' },
  { value: 'left_hide', label: '左侧完全隐藏' },
  { value: 'top_hide', label: '顶部完全隐藏' },
  { value: 'top_tabs', label: '顶部保留页签' },
];

const TAB_WIDTH_MODE_OPTIONS: Array<{ value: TabWidthMode; label: string }> = [
  { value: 'uniform', label: '统一宽度' },
  { value: 'auto', label: '自动适配标题' },
  { value: 'individual', label: '单独调整' },
];

const SORT_OPTIONS: Array<{ value: TodoSortBy; label: string }> = [
  { value: 'manual', label: '手动排序' },
  { value: 'priority', label: '按优先级（高到低）' },
  { value: 'due_date', label: '按截止日期' },
  { value: 'created_at', label: '按创建时间' },
  { value: 'updated_at', label: '按最近更新' },
];

const DEFAULT_VIEW_OPTIONS: Array<{ value: DefaultView; label: string }> = [
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'unscheduled', label: '待安排' },
  { value: 'quadrant', label: '四象限' },
];

const URGENT_DAYS_OPTIONS = [
  { value: '0', label: '仅当天及逾期' },
  { value: '1', label: '未来 1 天内' },
  { value: '3', label: '未来 3 天内' },
  { value: '7', label: '未来 7 天内' },
];

const FONT_SELECT_ITEMS = FONT_OPTIONS.map((f) => ({
  value: f.id,
  label: f.label,
}));

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFallbackAppVersion(): string {
  return typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim()
    ? __APP_VERSION__
    : '1.3.1';
}

function formatInstallKindLabel(kind: InstallKind): string {
  switch (kind) {
    case 'windows_standalone':
      return 'Windows 绿色版';
    case 'windows_nsis':
      return 'Windows NSIS 安装包';
    case 'windows_msi':
      return 'Windows MSI 安装包';
    case 'macos_arm64':
      return 'macOS (Apple Silicon)';
    case 'macos_x64':
      return 'macOS (Intel)';
    case 'android_arm64':
      return 'Android APK';
    default:
      return 'GitHub Release';
  }
}

function getInstallButtonLabel(kind: InstallKind, hasAsset: boolean): string {
  if (!hasAsset) return '前往发布页';
  switch (kind) {
    case 'windows_standalone':
      return '下载并自动更新';
    case 'windows_nsis':
    case 'windows_msi':
      return '下载并启动安装';
    case 'macos_arm64':
    case 'macos_x64':
      return '下载安装包 (.dmg)';
    case 'android_arm64':
      return '下载新版本 (.apk)';
    default:
      return '前往发布页';
  }
}

function formatReleaseDate(iso: string | null): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso.slice(0, 10);
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const VALID_SETTINGS_TABS: ReadonlySet<SettingsTabId> = new Set<SettingsTabId>([
  'general',
  'panel',
  'personalize',
  'shortcuts',
  'data',
  'about',
]);

export const SettingsModal: React.FC<SettingsModalProps> = ({ inline = false, initialTab }) => {
  const {
    data,
    device,
    platform,
    showSettings,
    settingsTab,
    webdavStatus,
    updateResult,
    updateChecking,
    updateError,
    updateInstalling,
    updateProgress,
    hasUnignoredUpdate,
    setShowSettings,
    setSettingsTab,
    updateSyncedSettings,
    updateDeviceSettings,
    setDockMode,
    resetPanelLayout,
    replaceAppData,
    applySyncedAppData,
    setWebdavStatusState,
    checkForUpdates,
    installAvailableUpdate,
    skipUpdateVersion,
    showToast,
  } = useDeskTagStore();

  const settings = data.settings;
  const hideDesktopOnly = platform.isMobile;

  const tabs: Array<{ id: SettingsTabId; label: string }> = hideDesktopOnly
    ? [
        { id: 'general', label: '通用' },
        { id: 'personalize', label: '外观' },
        { id: 'data', label: '同步' },
        { id: 'about', label: '关于' },
      ]
    : [
        { id: 'general', label: '通用' },
        { id: 'panel', label: '面板' },
        { id: 'personalize', label: '外观' },
        { id: 'shortcuts', label: '快捷键' },
        { id: 'data', label: '同步' },
        { id: 'about', label: '关于' },
      ];

  const activeTab: SettingsTabId = tabs.some((t) => t.id === settingsTab)
    ? settingsTab
    : 'general';

  // Animate tab content transitions only after user switches tabs (avoid stacking on modal open)
  const initialTabRef = useRef<SettingsTabId>(activeTab);
  const hasSwitchedTabRef = useRef(false);
  if (activeTab !== initialTabRef.current) {
    hasSwitchedTabRef.current = true;
  }
  const animateTabPanel = hasSwitchedTabRef.current;

  // Backup & storage state
  const [includeData, setIncludeData] = useState(true);
  const [includeSettings, setIncludeSettings] = useState(true);
  const [showOtherExports, setShowOtherExports] = useState(false);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [editingStorageDir, setEditingStorageDir] = useState(false);
  const [customDirDraft, setCustomDirDraft] = useState('');
  const [busyExport, setBusyExport] = useState(false);

  // Global shortcut drafts
  const [shortcutToggle, setShortcutToggle] = useState(device.globalShortcutToggle);
  const [shortcutQuickAdd, setShortcutQuickAdd] = useState(device.globalShortcutQuickAdd);

  const backupFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setShortcutToggle(device.globalShortcutToggle);
    setShortcutQuickAdd(device.globalShortcutQuickAdd);
  }, [device.globalShortcutToggle, device.globalShortcutQuickAdd]);

  const loadStorageInfo = useCallback(async () => {
    try {
      const info = await getStorageInfo();
      setStorageInfo(info);
      setCustomDirDraft(info.dataDir);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (
      (inline || showSettings) &&
      initialTab &&
      VALID_SETTINGS_TABS.has(initialTab as SettingsTabId)
    ) {
      setSettingsTab(initialTab as SettingsTabId);
    }
  }, [inline, showSettings, initialTab, setSettingsTab]);

  useEffect(() => {
    if ((inline || showSettings) && activeTab === 'data') {
      void loadStorageInfo();
    }
  }, [inline, showSettings, activeTab, loadStorageInfo]);

  const handleExportBackup = async () => {
    if (!includeData && !includeSettings) {
      showToast('请至少勾选「数据」或「设置」之一');
      return;
    }
    setBusyExport(true);
    try {
      const res = await exportBackup({ includeData, includeSettings });
      showToast(`已导出备份 (${formatBytes(res.bytes)})：${res.path}`);
    } catch (err) {
      showToast(`导出备份失败：${String(err)}`);
    } finally {
      setBusyExport(false);
    }
  };

  const handleImportBackupClick = async () => {
    if (isTauriRuntime()) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          multiple: false,
          filters: [{ name: 'DeskTag Backup', extensions: ['json', 'zip', 'desktag-backup'] }],
        });
        if (!selected || Array.isArray(selected)) return;
        const res = await importBackup(selected);
        applySyncedAppData(res.data);
        if (res.device) {
          await updateDeviceSettings(res.device);
        }
        showToast(`已导入 ${res.importedTodos} 条待办与 ${res.importedNotes} 篇便签`);
      } catch (err) {
        showToast(`导入备份失败：${String(err)}`);
      }
      return;
    }
    backupFileInputRef.current?.click();
  };

  const handleBrowserBackupFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { data?: AppData; device?: DeviceSettings | null };
      if (parsed.data && Array.isArray(parsed.data.todos)) {
        replaceAppData(parsed.data);
      }
      if (parsed.device) {
        await updateDeviceSettings(parsed.device);
      }
      showToast('已成功从备份文件导入数据');
    } catch (err) {
      showToast(`备份文件解析失败：${String(err)}`);
    }
  };

  const handleOtherExport = async (format: ClientExportFormat) => {
    setBusyExport(true);
    try {
      const res = await exportDeskTagDocument(data, format, { scope: 'all' });
      showToast(res.message);
    } catch (err) {
      showToast(`导出失败：${String(err)}`);
    } finally {
      setBusyExport(false);
    }
  };

  const handleChangeStorageDir = async () => {
    if (isTauriRuntime()) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const dir = await open({ directory: true, multiple: false });
        if (dir && !Array.isArray(dir)) {
          const info = await changeStorageDir(dir);
          setStorageInfo(info);
          showToast(`本机存储位置已更新为：${info.dataDir}`);
        }
        return;
      } catch {
        // Fallback to inline path input
      }
    }
    setEditingStorageDir(true);
  };

  const handleSaveCustomDir = async () => {
    const next = customDirDraft.trim();
    if (!next) return;
    try {
      const info = await changeStorageDir(next);
      setStorageInfo(info);
      setEditingStorageDir(false);
      showToast(`已更新存储路径：${info.dataDir}`);
    } catch (err) {
      showToast(`更改路径失败：${String(err)}`);
    }
  };

  const handleCopyPath = async () => {
    if (!storageInfo?.dataDir) return;
    try {
      await navigator.clipboard.writeText(storageInfo.dataDir);
      showToast('已复制本机存储路径');
    } catch {
      showToast(storageInfo.dataDir);
    }
  };

  const handleOpenExternalUrl = async (url: string) => {
    if (isTauriRuntime()) {
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
        return;
      } catch {
        // fallback
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const toggleImportantPriority = (prio: TodoPriority) => {
    const cur = settings.quadrantRules.importantPriorities;
    const next = cur.includes(prio) ? cur.filter((p) => p !== prio) : [...cur, prio];
    updateSyncedSettings({
      quadrantRules: {
        ...settings.quadrantRules,
        importantPriorities: next,
      },
    });
  };

  const captureKeyCombo = (
    e: React.KeyboardEvent<HTMLInputElement>,
    setter: (v: string) => void,
  ) => {
    e.preventDefault();
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Super');
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      parts.push(key);
      setter(parts.join('+'));
    }
  };

  const appVersion = platform.appVersion || getFallbackAppVersion();
  const isVersionSkipped = Boolean(
    updateResult?.hasUpdate &&
      device.skippedUpdateVersion &&
      device.skippedUpdateVersion === updateResult.latestVersion,
  );
  const updateBadge: { label: string; variant: 'secondary' | 'error' | 'info' | 'success' } | null =
    updateChecking
      ? { label: '检查中', variant: 'secondary' }
      : updateError
        ? { label: '检查失败', variant: 'error' }
        : updateResult?.hasUpdate
          ? { label: '有新版本', variant: 'info' }
          : updateResult
            ? { label: '已是最新', variant: 'success' }
            : null;
  const releaseDate = formatReleaseDate(updateResult?.publishedAt ?? null);
  const showProgress =
    updateInstalling || Boolean(updateProgress && updateProgress.stage !== 'error');

  const tabsBody = (
    <>
      <input
        ref={backupFileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          void handleBrowserBackupFile(e.target.files);
          e.target.value = '';
        }}
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (typeof value === 'string' && VALID_SETTINGS_TABS.has(value as SettingsTabId)) {
            setSettingsTab(value as SettingsTabId);
          }
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        {/* Horizontal Underline Tabs Bar */}
        <div className="shrink-0 overflow-x-auto border-b border-border px-3">
          <TabsList
            variant="underline"
            size="sm"
            className="w-max min-w-full justify-start gap-1 py-0.5"
          >
            {tabs.map((tab) => (
              <TabsTab
                key={tab.id}
                value={tab.id}
                className="h-8 grow-0 px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground data-active:font-semibold data-active:text-foreground"
              >
                <span>{tab.label}</span>
                {tab.id === 'about' && hasUnignoredUpdate && (
                  <span
                    className="ms-1 inline-block size-1.5 rounded-full bg-destructive"
                    aria-label="有可用更新"
                  />
                )}
              </TabsTab>
            ))}
          </TabsList>
        </div>

        {/* Scrollable Content Pane */}
        <ScrollArea overscrollContain scrollFade className="min-h-0 flex-1">
          {/* =============================================================== */}
          {/* TAB 1: 通用 (General)                                           */}
          {/* =============================================================== */}
          <TabsPanel
            value="general"
            className={cn('flex flex-col gap-3 p-3.5 pb-5', animateTabPanel && 'dt-view-enter')}
          >
            <Frame>
              <FramePanel className="flex flex-col gap-3 p-3.5">
                {!hideDesktopOnly && (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-foreground">开机自动启动</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          登录系统后安静贴边待命，不打扰桌面焦点
                        </div>
                      </div>
                      <Switch
                        checked={device.launchAtLogin}
                        onCheckedChange={(checked) =>
                          void updateDeviceSettings({ launchAtLogin: checked })
                        }
                        aria-label="开机自动启动"
                      />
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-foreground">
                          点击右上角 × 时
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          推荐隐藏至系统托盘，随时点击托盘图标或快捷键展开
                        </div>
                      </div>
                      <Select
                        items={CLOSE_BEHAVIOR_OPTIONS}
                        value={device.closeToTray ? 'tray' : 'quit'}
                        onValueChange={(val) => {
                          if (val !== null) {
                            void updateDeviceSettings({ closeToTray: val === 'tray' });
                          }
                        }}
                      >
                        <SelectTrigger size="sm" className="w-36 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectPopup align="end" alignItemWithTrigger={false}>
                          {CLOSE_BEHAVIOR_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>

                    <Separator />
                  </>
                )}

                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-foreground">提醒提示音</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      待办提醒触发时播放轻柔提示音
                    </div>
                  </div>
                  <Switch
                    checked={settings.notificationSound}
                    onCheckedChange={(checked) =>
                      updateSyncedSettings({ notificationSound: checked })
                    }
                    aria-label="提醒提示音"
                  />
                </div>

                <Separator />

                {/* Do-Not-Disturb Window */}
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-foreground">勿扰时段</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        在设定的休息时段内暂不弹出系统通知与声音提醒
                      </div>
                    </div>
                    <Switch
                      checked={settings.dndEnabled}
                      onCheckedChange={(checked) => updateSyncedSettings({ dndEnabled: checked })}
                      aria-label="勿扰时段"
                    />
                  </div>

                  {settings.dndEnabled && (
                    <div className="dt-reveal flex flex-wrap items-center gap-2 rounded-lg border border-border bg-coss-frame-well px-3 py-2">
                      <span className="text-xs font-medium text-muted-foreground">静默时间</span>
                      <Input
                        size="sm"
                        type="time"
                        className="w-28"
                        aria-label="勿扰开始时间"
                        value={settings.dndStart}
                        onChange={(e) => updateSyncedSettings({ dndStart: e.target.value })}
                      />
                      <span className="text-xs text-muted-foreground">至</span>
                      <Input
                        size="sm"
                        type="time"
                        className="w-28"
                        aria-label="勿扰结束时间"
                        value={settings.dndEnd}
                        onChange={(e) => updateSyncedSettings({ dndEnd: e.target.value })}
                      />
                    </div>
                  )}
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-foreground">默认启动视图</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      打开 DeskTag 时默认展示的待办时间范围
                    </div>
                  </div>
                  <Select
                    items={DEFAULT_VIEW_OPTIONS}
                    value={settings.defaultView}
                    onValueChange={(val) => {
                      if (val !== null) {
                        updateSyncedSettings({ defaultView: val as DefaultView });
                      }
                    }}
                  >
                    <SelectTrigger size="sm" className="w-32 shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {DEFAULT_VIEW_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              </FramePanel>
            </Frame>
          </TabsPanel>

          {/* =============================================================== */}
          {/* TAB 2: 面板 (Panel Settings — Desktop Only)                     */}
          {/* =============================================================== */}
          {!hideDesktopOnly && (
            <TabsPanel
              value="panel"
              className={cn('flex flex-col gap-3 p-3.5 pb-5', animateTabPanel && 'dt-view-enter')}
            >
              {/* Dock & Tab Rail Card */}
              <CardFrame>
                <CardFrameHeader className="py-2.5 px-3.5">
                  <CardFrameTitle className="text-[13px]">贴边与页签</CardFrameTitle>
                </CardFrameHeader>
                <Card>
                  <CardPanel className="flex flex-col gap-3 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-foreground">贴边方式</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          选择面板停靠屏幕边缘的位置及自动收起后的表现
                        </div>
                      </div>
                      <Select
                        items={DOCK_MODE_OPTIONS}
                        value={device.dockMode}
                        onValueChange={(val) => {
                          if (val !== null) void setDockMode(val as DockMode);
                        }}
                      >
                        <SelectTrigger size="sm" className="w-36 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectPopup align="end" alignItemWithTrigger={false}>
                          {DOCK_MODE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-foreground">面板布局</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          恢复默认大小 480 × 680、位置及页签大小，并重新贴边。字体与字号保持不变。
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void resetPanelLayout()}
                        className="shrink-0 text-xs"
                      >
                        <RotateCcw className="size-3.5" />
                        <span>恢复默认</span>
                      </Button>
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-foreground">页签宽度策略</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          自定义外凸侧边页签的宽度策略与展示数量
                        </div>
                      </div>
                      <Select
                        items={TAB_WIDTH_MODE_OPTIONS}
                        value={device.tabWidthMode}
                        onValueChange={(val) => {
                          if (val !== null) {
                            void updateDeviceSettings({ tabWidthMode: val as TabWidthMode });
                          }
                        }}
                      >
                        <SelectTrigger size="sm" className="w-36 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectPopup align="end" alignItemWithTrigger={false}>
                          {TAB_WIDTH_MODE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>

                    {/* Uniform Tab Width Slider */}
                    <div className="flex flex-col gap-2 pt-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">页签宽度</span>
                        <Badge variant="secondary" size="sm" className="tabular-nums">
                          {device.uniformTabWidth} px
                        </Badge>
                      </div>
                      <Slider
                        min={48}
                        max={104}
                        step={2}
                        value={device.uniformTabWidth}
                        getAriaLabel={() => '页签宽度'}
                        onValueChange={(val) => {
                          const next = Array.isArray(val) ? val[0] : val;
                          if (typeof next === 'number') {
                            void updateDeviceSettings({ uniformTabWidth: next });
                          }
                        }}
                      />
                    </div>

                    {/* Max Visible Tabs Slider */}
                    <div className="flex flex-col gap-2 pt-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          最大可见页签数
                        </span>
                        <Badge variant="secondary" size="sm" className="tabular-nums">
                          {device.maxVisibleTabs} 个
                        </Badge>
                      </div>
                      <Slider
                        min={4}
                        max={14}
                        step={1}
                        value={device.maxVisibleTabs}
                        getAriaLabel={() => '最大可见页签数'}
                        onValueChange={(val) => {
                          const next = Array.isArray(val) ? val[0] : val;
                          if (typeof next === 'number') {
                            void updateDeviceSettings({ maxVisibleTabs: next });
                          }
                        }}
                      />
                    </div>
                  </CardPanel>
                </Card>
              </CardFrame>

              {/* Typography Card */}
              <CardFrame>
                <CardFrameHeader className="py-2.5 px-3.5">
                  <CardFrameTitle className="text-[13px]">字体与字号</CardFrameTitle>
                </CardFrameHeader>
                <Card>
                  <CardPanel className="flex flex-col gap-3 p-3.5">
                    {/* Live Preview Box */}
                    <div
                      className="rounded-xl border border-border bg-coss-frame-well px-3.5 py-3 text-foreground"
                      style={{
                        fontFamily: getFontFamilyStack(settings.fontFamily),
                        fontSize: settings.bodyFontSize,
                      }}
                    >
                      DeskTag Aa 123 · 让日常任务与灵感随手可得
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-medium text-foreground">字体</span>
                      <Select
                        items={FONT_SELECT_ITEMS}
                        value={settings.fontFamily}
                        onValueChange={(val) => {
                          if (val !== null) updateSyncedSettings({ fontFamily: val });
                        }}
                      >
                        <SelectTrigger size="sm" className="w-44 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectPopup align="end" alignItemWithTrigger={false}>
                          {FONT_SELECT_ITEMS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>

                    <Separator />

                    {/* Body Font Size Slider */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-foreground">正文字号</span>
                        <Badge variant="secondary" size="sm" className="tabular-nums">
                          {settings.bodyFontSize} px
                        </Badge>
                      </div>
                      <Slider
                        min={12}
                        max={18}
                        step={1}
                        value={settings.bodyFontSize}
                        getAriaLabel={() => '正文字号'}
                        onValueChange={(val) => {
                          const next = Array.isArray(val) ? val[0] : val;
                          if (typeof next === 'number') {
                            updateSyncedSettings({ bodyFontSize: next });
                          }
                        }}
                      />
                    </div>

                    <Separator />

                    {/* UI Font Size Slider */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-foreground">界面字号</span>
                        <Badge variant="secondary" size="sm" className="tabular-nums">
                          {settings.uiFontSize} px
                        </Badge>
                      </div>
                      <Slider
                        min={11}
                        max={16}
                        step={1}
                        value={settings.uiFontSize}
                        getAriaLabel={() => '界面字号'}
                        onValueChange={(val) => {
                          const next = Array.isArray(val) ? val[0] : val;
                          if (typeof next === 'number') {
                            updateSyncedSettings({ uiFontSize: next });
                          }
                        }}
                      />
                    </div>
                  </CardPanel>
                </Card>
              </CardFrame>
            </TabsPanel>
          )}

          {/* =============================================================== */}
          {/* TAB 3: 外观 (Personalization)                                   */}
          {/* =============================================================== */}
          <TabsPanel
            value="personalize"
            className={cn('flex flex-col gap-3 p-3.5 pb-5', animateTabPanel && 'dt-view-enter')}
          >
            {/* Theme Skins Grid + Opacity */}
            <CardFrame>
              <CardFrameHeader className="items-center py-2.5 px-3.5">
                <CardFrameTitle className="text-[13px]">主题皮肤</CardFrameTitle>
                <CardFrameAction>
                  <Badge variant="secondary" size="sm">
                    {SKINS.length} 款原创配色
                  </Badge>
                </CardFrameAction>
              </CardFrameHeader>
              <Card>
                <CardPanel className="flex flex-col gap-3 p-3.5">
                  <div className="grid grid-cols-2 gap-2 min-[380px]:grid-cols-3">
                    {SKINS.map((skin) => {
                      const active = getSkinById(settings.skinId).id === skin.id;
                      return (
                        <button
                          key={skin.id}
                          type="button"
                          onClick={() => updateSyncedSettings({ skinId: skin.id })}
                          className={cn(
                            'dt-pressable group relative flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            active
                              ? 'border-primary bg-accent text-foreground shadow-xs/5 ring-1 ring-primary/25'
                              : 'border-border bg-card text-foreground/85 hover:border-ring/40 hover:bg-accent/60 hover:text-foreground',
                          )}
                        >
                          <span className="inline-flex shrink-0 transition-transform duration-[120ms] ease-[var(--dt-ease)] group-hover:scale-[1.04]">
                            <SkinSwatchTile swatch={skin.swatch} size={24} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {skin.name}
                          </span>
                          {active && (
                            <Check
                              className="dt-check-pop size-3.5 shrink-0 text-primary"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {!hideDesktopOnly && (
                    <>
                      <Separator />
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium text-foreground">
                            面板透明度
                          </span>
                          <Badge variant="secondary" size="sm" className="tabular-nums">
                            {Math.round(settings.opacity * 100)}%
                          </Badge>
                        </div>
                        <Slider
                          min={40}
                          max={100}
                          step={2}
                          value={Math.round(settings.opacity * 100)}
                          getAriaLabel={() => '面板透明度'}
                          onValueChange={(val) => {
                            const next = Array.isArray(val) ? val[0] : val;
                            if (typeof next === 'number') {
                              updateSyncedSettings({ opacity: next / 100 });
                            }
                          }}
                        />
                      </div>
                    </>
                  )}
                </CardPanel>
              </Card>
            </CardFrame>

            {/* Todo Display & Intelligence */}
            <CardFrame>
              <CardFrameHeader className="py-2.5 px-3.5">
                <CardFrameTitle className="text-[13px]">待办显示与智能解析</CardFrameTitle>
              </CardFrameHeader>
              <Card>
                <CardPanel className="flex flex-col gap-3 p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-foreground">列表排序</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        待办列表内未完成项目的默认排列方式
                      </div>
                    </div>
                    <Select
                      items={SORT_OPTIONS}
                      value={settings.sortBy}
                      onValueChange={(val) => {
                        if (val !== null) updateSyncedSettings({ sortBy: val as TodoSortBy });
                      }}
                    >
                      <SelectTrigger size="sm" className="w-40 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup align="end" alignItemWithTrigger={false}>
                        {SORT_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-foreground">自动编号</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        在待办与子任务前显示层次序号（1. / 1.1）
                      </div>
                    </div>
                    <Switch
                      checked={settings.autoNumbering}
                      onCheckedChange={(checked) =>
                        updateSyncedSettings({ autoNumbering: checked })
                      }
                      aria-label="自动编号"
                    />
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-foreground">详情展示</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        在待办列表中直接展示提醒时间、标签与子任务进度
                      </div>
                    </div>
                    <Switch
                      checked={settings.showDetailsInList}
                      onCheckedChange={(checked) =>
                        updateSyncedSettings({ showDetailsInList: checked })
                      }
                      aria-label="详情展示"
                    />
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-foreground">智能文字识别</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        新建待办时自动解析日期、时段、优先级、标签、提醒与重复规则
                      </div>
                    </div>
                    <Switch
                      checked={settings.smartTextRecognition}
                      onCheckedChange={(checked) =>
                        updateSyncedSettings({ smartTextRecognition: checked })
                      }
                      aria-label="智能文字识别"
                    />
                  </div>
                </CardPanel>
              </Card>
            </CardFrame>

            {/* Quadrant Rules */}
            <CardFrame>
              <CardFrameHeader className="py-2.5 px-3.5">
                <CardFrameTitle className="text-[13px]">四象限归类规则</CardFrameTitle>
              </CardFrameHeader>
              <Card>
                <CardPanel className="flex flex-col gap-3 p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-medium text-foreground">
                      「紧急」判定截止天数
                    </span>
                    <Select
                      items={URGENT_DAYS_OPTIONS}
                      value={String(settings.quadrantRules.urgentWithinDays)}
                      onValueChange={(val) => {
                        if (val !== null) {
                          updateSyncedSettings({
                            quadrantRules: {
                              ...settings.quadrantRules,
                              urgentWithinDays: Number(val),
                            },
                          });
                        }
                      }}
                    >
                      <SelectTrigger size="sm" className="w-36 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup align="end" alignItemWithTrigger={false}>
                        {URGENT_DAYS_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-medium text-foreground">
                      「重要」包含优先级
                    </span>
                    <div className="flex items-center gap-3">
                      {(
                        [
                          ['high', '高'],
                          ['medium', '中'],
                          ['low', '低'],
                        ] as Array<[TodoPriority, string]>
                      ).map(([p, label]) => {
                        const checked = settings.quadrantRules.importantPriorities.includes(p);
                        return (
                          <label
                            key={p}
                            className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-foreground"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleImportantPriority(p)}
                            />
                            <span>{label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </CardPanel>
              </Card>
            </CardFrame>
          </TabsPanel>

          {/* =============================================================== */}
          {/* TAB 4: 快捷键 (Shortcuts — Desktop Only)                         */}
          {/* =============================================================== */}
          {!hideDesktopOnly && (
            <TabsPanel
              value="shortcuts"
              className={cn('flex flex-col gap-3 p-3.5 pb-5', animateTabPanel && 'dt-view-enter')}
            >
              <CardFrame>
                <CardFrameHeader className="py-2.5 px-3.5">
                  <CardFrameTitle className="text-[13px]">全局快捷键</CardFrameTitle>
                </CardFrameHeader>
                <Card>
                  <CardPanel className="flex flex-col gap-3 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-foreground">
                          显示 / 收起面板
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          点击输入框后直接按下组合键即可录制
                        </div>
                      </div>
                      <Input
                        size="sm"
                        type="text"
                        aria-label="显示或收起面板快捷键"
                        className="w-36 shrink-0 [&_input]:text-center [&_input]:font-mono [&_input]:text-xs [&_input]:font-semibold"
                        value={shortcutToggle}
                        onKeyDown={(e) => captureKeyCombo(e, setShortcutToggle)}
                        onChange={(e) => setShortcutToggle(e.target.value)}
                      />
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-foreground">快速新建待办</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          唤起面板并立即聚焦顶部待办输入框
                        </div>
                      </div>
                      <Input
                        size="sm"
                        type="text"
                        aria-label="快速新建待办快捷键"
                        className="w-36 shrink-0 [&_input]:text-center [&_input]:font-mono [&_input]:text-xs [&_input]:font-semibold"
                        value={shortcutQuickAdd}
                        onKeyDown={(e) => captureKeyCombo(e, setShortcutQuickAdd)}
                        onChange={(e) => setShortcutQuickAdd(e.target.value)}
                      />
                    </div>

                    <div className="flex justify-end pt-1">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => {
                          void updateDeviceSettings({
                            globalShortcutToggle: shortcutToggle.trim() || 'Alt+Shift+D',
                            globalShortcutQuickAdd: shortcutQuickAdd.trim() || 'Alt+Shift+N',
                          }).then(() => showToast('全局快捷键已保存'));
                        }}
                      >
                        保存快捷键
                      </Button>
                    </div>
                  </CardPanel>
                </Card>
              </CardFrame>

              <CardFrame>
                <CardFrameHeader className="py-2.5 px-3.5">
                  <CardFrameTitle className="text-[13px]">应用内快捷键参考</CardFrameTitle>
                </CardFrameHeader>
                <Card>
                  <CardPanel className="flex flex-col gap-2.5 p-3.5">
                    {[
                      ['Enter', '快速创建待办'],
                      ['Shift + Enter', '待办输入框内换行 / 批量粘贴多条待办'],
                      ['@', '在便签或待办中输入 @ 快速双向关联其他内容'],
                      ['Ctrl / Cmd + K', '打开全局检索（搜待办、子任务、标签、便签）'],
                      ['Esc', '关闭当前弹窗、浮层或下拉菜单'],
                    ].map(([key, desc]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="text-muted-foreground">{desc}</span>
                        <Kbd className="shrink-0 px-1.5 font-mono text-[11px]">{key}</Kbd>
                      </div>
                    ))}
                  </CardPanel>
                </Card>
              </CardFrame>
            </TabsPanel>
          )}

          {/* =============================================================== */}
          {/* TAB 5: 同步 (Data & Sync + WebDAV)                              */}
          {/* =============================================================== */}
          <TabsPanel
            value="data"
            className={cn('flex flex-col gap-3 p-3.5 pb-5', animateTabPanel && 'dt-view-enter')}
          >
            {/* Card 1: WebDAV Cloud Sync */}
            <WebDavSyncCard
              externalStatus={webdavStatus}
              onDataSynced={applySyncedAppData}
              onStatusChange={setWebdavStatusState}
            />

            {/* Card 2: Backup & Local Storage */}
            <CardFrame>
              <CardFrameHeader className="items-center gap-x-2 py-2.5 px-3.5">
                <div className="min-w-0">
                  <CardFrameTitle className="flex items-center gap-1.5 text-[13px]">
                    <HardDrive className="size-3.5 text-muted-foreground" />
                    <span>备份与本机存储</span>
                  </CardFrameTitle>
                  <CardFrameDescription className="mt-0.5 truncate font-mono text-[11px]">
                    {storageInfo
                      ? `${storageInfo.dataDir} · ${formatBytes(storageInfo.totalBytes)}`
                      : '本地优先存储 · 零账号依赖'}
                  </CardFrameDescription>
                </div>
                <CardFrameAction className="items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    loading={busyExport}
                    onClick={() => void handleExportBackup()}
                  >
                    <Download className="size-3" />
                    <span>导出备份</span>
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busyExport}
                    onClick={() => void handleImportBackupClick()}
                  >
                    <Upload className="size-3" />
                    <span>导入</span>
                  </Button>
                </CardFrameAction>
              </CardFrameHeader>

              <Card>
                <CardPanel className="flex flex-col gap-3 p-3.5">
                  {/* Backup Scope Checkboxes & Collapsible Other Export Formats */}
                  <Collapsible open={showOtherExports} onOpenChange={setShowOtherExports}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-medium text-muted-foreground">备份内容</span>
                        <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-foreground">
                          <Checkbox
                            checked={includeData}
                            onCheckedChange={(checked) => setIncludeData(Boolean(checked))}
                          />
                          <span>数据</span>
                        </label>
                        <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-foreground">
                          <Checkbox
                            checked={includeSettings}
                            onCheckedChange={(checked) => setIncludeSettings(Boolean(checked))}
                          />
                          <span>设置</span>
                        </label>
                      </div>

                      <CollapsibleTrigger
                        render={
                          <Button
                            size="xs"
                            variant="ghost"
                            className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                          />
                        }
                      >
                        <span>其他格式导出</span>
                        <ChevronDown
                          className={cn(
                            'dt-chevron size-3.5',
                            showOtherExports && 'rotate-180',
                          )}
                        />
                      </CollapsibleTrigger>
                    </div>

                    <CollapsiblePanel>
                      <div className="mt-2.5 flex flex-wrap gap-1.5 rounded-xl border border-border bg-coss-frame-well p-2.5">
                        {(
                          [
                            ['docx', 'Word (.docx)'],
                            ['pdf', 'PDF / 打印'],
                            ['html', 'HTML 网页'],
                            ['markdown', 'Markdown (.md)'],
                            ['csv', 'CSV 表格'],
                          ] as Array<[ClientExportFormat, string]>
                        ).map(([fmt, label]) => (
                          <Button
                            key={fmt}
                            size="xs"
                            variant="outline"
                            disabled={busyExport}
                            onClick={() => void handleOtherExport(fmt)}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    </CollapsiblePanel>
                  </Collapsible>

                  <Separator />

                  {/* Local Storage Path & Controls */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-coss-frame-well px-2.5 py-2 text-xs">
                      <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-foreground">
                        {storageInfo?.dataDir ?? '加载中…'}
                      </span>
                      {storageInfo && (
                        <Badge variant="secondary" size="sm" className="shrink-0 tabular-nums">
                          {formatBytes(storageInfo.totalBytes)}
                        </Badge>
                      )}
                    </div>

                    {editingStorageDir && (
                      <div className="dt-reveal flex items-center gap-1.5">
                        <Input
                          size="sm"
                          type="text"
                          value={customDirDraft}
                          onChange={(e) => setCustomDirDraft(e.target.value)}
                          placeholder="输入新的数据目录路径…"
                          className="flex-1"
                        />
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() => void handleSaveCustomDir()}
                        >
                          保存
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setEditingStorageDir(false)}
                        >
                          取消
                        </Button>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void handleChangeStorageDir()}
                      >
                        更改位置
                      </Button>
                      {!hideDesktopOnly && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => void openStorageDir()}
                        >
                          <FolderOpen className="size-3" />
                          <span>打开目录</span>
                        </Button>
                      )}
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => void handleCopyPath()}
                      >
                        <Copy className="size-3" />
                        <span>复制路径</span>
                      </Button>
                    </div>
                  </div>
                </CardPanel>
              </Card>
            </CardFrame>
          </TabsPanel>

          {/* =============================================================== */}
          {/* TAB 6: 关于 (About)                                             */}
          {/* =============================================================== */}
          <TabsPanel
            value="about"
            className={cn('flex flex-col gap-3 p-3.5 pb-5', animateTabPanel && 'dt-view-enter')}
          >
            {/* Card 1: Software Identity */}
            <Frame>
              <FramePanel className="flex flex-col gap-3 p-3.5">
                <div className="flex items-center gap-3">
                  <MascotAvatar size={42} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-foreground">DeskTag</span>
                      <Badge variant="secondary" size="sm" className="tabular-nums">
                        v{appVersion}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      独立开源跨平台桌面贴边待办与便签
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-coss-frame-well px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                  DeskTag 是一款独立开源的轻量跨平台桌面贴边待办与便签工具，让日常任务与灵感记录随手可得、专注时安静收拢。
                  <br />
                  坚持本地优先与数据自主，支持通过 AES-256-GCM 端到端加密 WebDAV 引擎在 Windows、macOS 与 Android 间自由同步。
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Rust + Tauri v2',
                    'React 19 + TypeScript',
                    'AES-256-GCM E2EE WebDAV',
                    `${SKINS.length} 款原创主题`,
                    'Windows · macOS · Android',
                  ].map((item) => (
                    <Badge key={item} variant="secondary" size="sm">
                      {item}
                    </Badge>
                  ))}
                </div>

                <Separator />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">项目源码与问题反馈</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        void handleOpenExternalUrl('https://github.com/nonsense-j/DeskTag/releases')
                      }
                    >
                      <span>发布日志</span>
                      <ExternalLink className="size-3" />
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        void handleOpenExternalUrl('https://github.com/nonsense-j/DeskTag')
                      }
                    >
                      <span>GitHub: nonsense-j/DeskTag</span>
                      <ExternalLink className="size-3" />
                    </Button>
                  </div>
                </div>
              </FramePanel>
            </Frame>

            {/* Card 2: Software Updates */}
            <CardFrame>
              <CardFrameHeader className="items-center gap-x-2 py-2.5 px-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CardFrameTitle className="text-[13px]">软件更新</CardFrameTitle>
                    {updateBadge && (
                      <Badge variant={updateBadge.variant} size="sm">
                        {updateBadge.label}
                      </Badge>
                    )}
                  </div>
                  <CardFrameDescription className="mt-0.5 text-[11.5px]">
                    当前版本 v{appVersion}
                    {device.lastUpdateCheckAt
                      ? ` · 上次检查：${formatRelativeTime(device.lastUpdateCheckAt)}`
                      : ''}
                  </CardFrameDescription>
                </div>
                <CardFrameAction>
                  <Button
                    size="xs"
                    variant="outline"
                    loading={updateChecking}
                    disabled={updateChecking || updateInstalling}
                    onClick={() => void checkForUpdates({ force: true, silent: false })}
                  >
                    <RefreshCw className="size-3" />
                    <span>{updateResult ? '重新检查' : '检查更新'}</span>
                  </Button>
                </CardFrameAction>
              </CardFrameHeader>

              <Card>
                <CardPanel className="flex flex-col gap-3 p-3.5">
                  {/* Error State */}
                  {updateError && !updateChecking && (
                    <Alert variant="error" className="px-3 py-2">
                      <AlertCircle className="size-3.5" />
                      <AlertDescription className="text-xs text-destructive-foreground">
                        {updateError}
                      </AlertDescription>
                      <AlertAction>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => void checkForUpdates({ force: true, silent: false })}
                        >
                          重试
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            void handleOpenExternalUrl(
                              'https://github.com/nonsense-j/DeskTag/releases',
                            )
                          }
                        >
                          发布页
                        </Button>
                      </AlertAction>
                    </Alert>
                  )}

                  {/* Up-to-date State */}
                  {updateResult && !updateResult.hasUpdate && !updateError && !updateChecking && (
                    <Alert variant="success" className="items-center px-3 py-2">
                      <CheckCircle2 className="size-3.5" />
                      <AlertTitle className="text-xs font-medium">
                        {updateResult.latestVersion === appVersion
                          ? `当前已是最新版本（v${appVersion}）。`
                          : `当前已是最新版本（当前 v${appVersion}，GitHub 最新 v${updateResult.latestVersion}）。`}
                      </AlertTitle>
                    </Alert>
                  )}

                  {/* New Version Available Panel */}
                  {updateResult?.hasUpdate && (
                    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-coss-frame-well p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-semibold text-foreground">
                            {updateResult.releaseName || `DeskTag v${updateResult.latestVersion}`}
                          </span>
                          <Badge variant="info" size="sm">
                            {formatInstallKindLabel(updateResult.installKind)}
                          </Badge>
                          {isVersionSkipped && (
                            <Badge variant="secondary" size="sm">
                              已跳过
                            </Badge>
                          )}
                        </div>
                        <span className="text-[11.5px] tabular-nums text-muted-foreground">
                          {[
                            releaseDate,
                            updateResult.recommendedAsset?.size
                              ? formatBytes(updateResult.recommendedAsset.size)
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>

                      {updateResult.releaseNotes.trim() && (
                        <div className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-card px-2.5 py-2 text-xs leading-relaxed text-muted-foreground select-text">
                          {updateResult.releaseNotes.trim()}
                        </div>
                      )}

                      {showProgress && updateProgress && (
                        <div className="flex flex-col gap-1.5">
                          <Progress value={updateProgress.percent ?? 100}>
                            <ProgressTrack>
                              <ProgressIndicator />
                            </ProgressTrack>
                          </Progress>
                          <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
                            <span>
                              {updateProgress.message ||
                                (updateProgress.stage === 'downloading'
                                  ? `正在下载${updateResult.recommendedAsset ? ` ${updateResult.recommendedAsset.name}` : ''}…`
                                  : updateProgress.stage === 'verifying'
                                    ? '正在校验 SHA-256…'
                                    : updateProgress.stage === 'installing'
                                      ? '正在准备更新…'
                                      : '更新已就绪')}
                            </span>
                            {updateProgress.totalBytes ? (
                              <span className="shrink-0 tabular-nums">
                                {formatBytes(updateProgress.downloadedBytes)} /{' '}
                                {formatBytes(updateProgress.totalBytes)}
                                {updateProgress.percent !== null
                                  ? ` · ${updateProgress.percent}%`
                                  : ''}
                              </span>
                            ) : updateProgress.downloadedBytes > 0 ? (
                              <span className="shrink-0 tabular-nums">
                                {formatBytes(updateProgress.downloadedBytes)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <Button
                          size="sm"
                          variant="default"
                          loading={updateInstalling}
                          disabled={updateInstalling || updateChecking}
                          onClick={() => void installAvailableUpdate()}
                          className="text-xs"
                        >
                          {getInstallButtonLabel(
                            updateResult.installKind,
                            Boolean(updateResult.recommendedAsset),
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleOpenExternalUrl(updateResult.releaseUrl)}
                          className="text-xs"
                        >
                          <span>前往发布页</span>
                          <ExternalLink className="size-3" />
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="ms-auto text-xs text-muted-foreground"
                          disabled={updateInstalling}
                          onClick={() =>
                            void skipUpdateVersion(
                              isVersionSkipped ? null : updateResult.latestVersion,
                            )
                          }
                        >
                          {isVersionSkipped ? '取消跳过此版本' : '跳过此版本'}
                        </Button>
                      </div>
                    </div>
                  )}

                  <Separator />

                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-foreground">
                        启动时自动检查更新
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        应用启动后在后台静默检查 GitHub 新版本，仅发现更新时轻提示
                      </div>
                    </div>
                    <Switch
                      checked={device.autoCheckUpdates !== false}
                      onCheckedChange={(checked) =>
                        void updateDeviceSettings({ autoCheckUpdates: checked })
                      }
                      aria-label="启动时自动检查更新"
                    />
                  </div>
                </CardPanel>
              </Card>
            </CardFrame>
          </TabsPanel>
        </ScrollArea>
      </Tabs>
    </>
  );

  if (inline) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
        {tabsBody}
      </div>
    );
  }

  return (
    <Dialog open={showSettings} onOpenChange={(open) => setShowSettings(open)}>
      <DialogPopup
        className="h-[min(88vh,624px)] max-h-full max-w-[560px] overflow-hidden"
        closeProps={{ 'aria-label': '关闭设置' }}
      >
        <DialogHeader className="shrink-0 px-4 pt-3.5 pb-1.5">
          <DialogTitle className="text-[15px] font-semibold">设置</DialogTitle>
        </DialogHeader>
        {tabsBody}
      </DialogPopup>
    </Dialog>
  );
};

export default SettingsModal;
