import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  StorageInfo,
  TabWidthMode,
  TodoPriority,
  TodoSortBy,
} from '../types/models';
import { exportDeskTagDocument, type ClientExportFormat } from '../utils/exporter';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  FolderIcon,
  MascotAvatar,
  SkinSwatchTile,
} from './Icons';
import { WebDavSyncCard } from './WebDavSyncCard';

export interface SettingsModalProps {
  /** Render inline without backdrop overlay (used for Android's bottom Settings tab). */
  inline?: boolean;
}

const DOCK_MODE_OPTIONS: Array<{ value: DockMode; label: string }> = [
  { value: 'right_tabs', label: '右侧保留页签' },
  { value: 'right_hide', label: '右侧完全隐藏' },
  { value: 'left_tabs', label: '左侧保留页签' },
  { value: 'left_hide', label: '左侧完全隐藏' },
  { value: 'top_hide', label: '顶部完全隐藏' },
  { value: 'top_tabs', label: '顶部保留页签' },
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ inline = false }) => {
  const {
    data,
    device,
    platform,
    isMobileLayout,
    showSettings,
    settingsTab,
    webdavStatus,
    setShowSettings,
    setSettingsTab,
    updateSyncedSettings,
    updateDeviceSettings,
    setDockMode,
    resetPanelLayout,
    replaceAppData,
    applySyncedAppData,
    setWebdavStatusState,
    showToast,
  } = useDeskTagStore();

  const settings = data.settings;
  const hideDesktopOnly = platform.isMobile;

  const tabs: Array<{ id: SettingsTabId; label: string }> = hideDesktopOnly
    ? [
        { id: 'general', label: '通用' },
        { id: 'personalize', label: '个性化' },
        { id: 'data', label: '数据与同步' },
        { id: 'about', label: '关于' },
      ]
    : [
        { id: 'general', label: '通用' },
        { id: 'panel', label: '面板设置' },
        { id: 'personalize', label: '个性化' },
        { id: 'shortcuts', label: '快捷键' },
        { id: 'data', label: '数据与同步' },
        { id: 'about', label: '关于' },
      ];

  const activeTab: SettingsTabId = tabs.some((t) => t.id === settingsTab)
    ? settingsTab
    : 'general';

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
    if ((inline || showSettings) && activeTab === 'data') {
      void loadStorageInfo();
    }
  }, [inline, showSettings, activeTab, loadStorageInfo]);

  if (!inline && !showSettings) return null;

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

  const content = (
    <div
      className="dt-settings-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: inline ? '100%' : 'min(84vh, 620px)',
        maxWidth: inline ? 'none' : 700,
        borderRadius: inline ? 0 : 14,
        background: 'var(--bg-panel)',
        color: 'var(--text-primary)',
        border: inline ? 'none' : '1px solid var(--border)',
        boxShadow: inline ? 'none' : 'var(--shadow-popover)',
        overflow: 'hidden',
      }}
    >
      <input
        ref={backupFileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleBrowserBackupFile(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Top Header */}
      {!inline && (
        <div
          style={{
            height: 46,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 14px 0 18px',
            background: 'var(--bg-header)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 15 }}>设置</span>
          <button
            type="button"
            aria-label="关闭设置"
            onClick={() => setShowSettings(false)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-secondary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      {/* Body: Left Sidebar (Desktop) or Top Scrollable Pill Bar (Mobile) + Right Pane */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: isMobileLayout ? 'column' : 'row',
          overflow: 'hidden',
        }}
      >
        {/* Navigation */}
        <nav
          style={
            isMobileLayout
              ? {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  overflowX: 'auto',
                  padding: '8px 12px',
                  background: 'var(--bg-header)',
                  borderBottom: '1px solid var(--border)',
                  flexShrink: 0,
                }
              : {
                  width: 136,
                  flexShrink: 0,
                  padding: '10px 8px',
                  background: 'var(--bg-header)',
                  borderRight: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }
          }
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSettingsTab(tab.id)}
                style={{
                  textAlign: isMobileLayout ? 'center' : 'left',
                  padding: isMobileLayout ? '6px 12px' : '8px 12px',
                  borderRadius: 9,
                  border: 'none',
                  background: active ? 'var(--pill-active-bg)' : 'transparent',
                  color: active ? 'var(--pill-active-text)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 500,
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Scrollable Content Pane */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflowY: 'auto',
            padding: isMobileLayout ? '14px 12px 28px' : '18px 22px 26px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {/* =============================================================== */}
          {/* TAB 1: 通用 (General)                                           */}
          {/* =============================================================== */}
          {activeTab === 'general' && (
            <>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>通用</h3>

              <div className="dt-settings-card">
                {!hideDesktopOnly && (
                  <>
                    <label className="dt-setting-row">
                      <div>
                        <div className="dt-setting-title">开机自动启动</div>
                        <div className="dt-setting-desc">登录系统后安静贴边待命，不打扰桌面焦点</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={device.launchAtLogin}
                        onChange={(e) => void updateDeviceSettings({ launchAtLogin: e.target.checked })}
                      />
                    </label>

                    <div className="dt-setting-divider" />

                    <div className="dt-setting-row">
                      <div>
                        <div className="dt-setting-title">点击右上角 × 时</div>
                        <div className="dt-setting-desc">推荐隐藏至系统托盘，随时点击托盘图标或快捷键展开</div>
                      </div>
                      <select
                        className="dt-select"
                        value={device.closeToTray ? 'tray' : 'quit'}
                        onChange={(e) =>
                          void updateDeviceSettings({ closeToTray: e.target.value === 'tray' })
                        }
                      >
                        <option value="tray">隐藏至系统托盘</option>
                        <option value="quit">直接退出程序</option>
                      </select>
                    </div>

                    <div className="dt-setting-divider" />
                  </>
                )}

                <label className="dt-setting-row">
                  <div>
                    <div className="dt-setting-title">提醒提示音</div>
                    <div className="dt-setting-desc">待办提醒触发时播放轻柔提示音</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.notificationSound}
                    onChange={(e) => updateSyncedSettings({ notificationSound: e.target.checked })}
                  />
                </label>

                <div className="dt-setting-divider" />

                {/* Do-Not-Disturb Window (勿扰时段) */}
                <label className="dt-setting-row">
                  <div>
                    <div className="dt-setting-title">勿扰时段</div>
                    <div className="dt-setting-desc">在设定的休息时段内暂不弹出系统通知与声音提醒</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.dndEnabled}
                    onChange={(e) => updateSyncedSettings({ dndEnabled: e.target.checked })}
                  />
                </label>

                {settings.dndEnabled && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                      paddingTop: 8,
                    }}
                  >
                    <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>静默时间：</span>
                    <input
                      type="time"
                      className="dt-input"
                      style={{ width: 112 }}
                      value={settings.dndStart}
                      onChange={(e) => updateSyncedSettings({ dndStart: e.target.value })}
                    />
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>至</span>
                    <input
                      type="time"
                      className="dt-input"
                      style={{ width: 112 }}
                      value={settings.dndEnd}
                      onChange={(e) => updateSyncedSettings({ dndEnd: e.target.value })}
                    />
                  </div>
                )}

                <div className="dt-setting-divider" />

                <div className="dt-setting-row">
                  <div>
                    <div className="dt-setting-title">默认启动视图</div>
                    <div className="dt-setting-desc">打开 DeskTag 时默认展示的待办时间范围</div>
                  </div>
                  <select
                    className="dt-select"
                    value={settings.defaultView}
                    onChange={(e) =>
                      updateSyncedSettings({ defaultView: e.target.value as DefaultView })
                    }
                  >
                    {DEFAULT_VIEW_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* =============================================================== */}
          {/* TAB 2: 面板设置 (Panel Settings — Desktop Only)                 */}
          {/* =============================================================== */}
          {activeTab === 'panel' && !hideDesktopOnly && (
            <>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>面板设置</h3>

              <div className="dt-settings-card">
                <div className="dt-setting-row">
                  <div>
                    <div className="dt-setting-title">贴边方式</div>
                    <div className="dt-setting-desc">选择面板停靠屏幕边缘的位置及自动收起后的表现</div>
                  </div>
                  <select
                    className="dt-select"
                    value={device.dockMode}
                    onChange={(e) => void setDockMode(e.target.value as DockMode)}
                  >
                    {DOCK_MODE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="dt-setting-divider" />

                <div className="dt-setting-row">
                  <div>
                    <div className="dt-setting-title">面板布局</div>
                    <div className="dt-setting-desc">
                      恢复默认大小 480 × 680、位置及页签大小，并重新贴边。字体和字号保持不变。
                    </div>
                  </div>
                  <button
                    type="button"
                    className="dt-btn dt-btn-soft"
                    onClick={() => void resetPanelLayout()}
                  >
                    恢复默认
                  </button>
                </div>

                <div className="dt-setting-divider" />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="dt-setting-row">
                    <div>
                      <div className="dt-setting-title">页签大小</div>
                      <div className="dt-setting-desc">自定义外凸侧边页签的宽度策略与展示数量</div>
                    </div>
                    <select
                      className="dt-select"
                      value={device.tabWidthMode}
                      onChange={(e) =>
                        void updateDeviceSettings({ tabWidthMode: e.target.value as TabWidthMode })
                      }
                    >
                      <option value="uniform">统一宽度</option>
                      <option value="auto">自动适配标题</option>
                      <option value="individual">单独调整</option>
                    </select>
                  </div>

                  <div className="dt-setting-row">
                    <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      页签宽度 ({device.uniformTabWidth} px)
                    </span>
                    <input
                      type="range"
                      min={48}
                      max={104}
                      step={2}
                      value={device.uniformTabWidth}
                      onChange={(e) =>
                        void updateDeviceSettings({ uniformTabWidth: Number(e.target.value) })
                      }
                      style={{ width: 126, accentColor: 'var(--accent)', flexShrink: 0 }}
                    />
                  </div>

                  <div className="dt-setting-row">
                    <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      最大可见页签数 ({device.maxVisibleTabs} 个)
                    </span>
                    <input
                      type="range"
                      min={4}
                      max={14}
                      step={1}
                      value={device.maxVisibleTabs}
                      onChange={(e) =>
                        void updateDeviceSettings({ maxVisibleTabs: Number(e.target.value) })
                      }
                      style={{ width: 126, accentColor: 'var(--accent)', flexShrink: 0 }}
                    />
                  </div>
                </div>
              </div>

              {/* Typography Card */}
              <div className="dt-settings-card">
                <div className="dt-setting-title" style={{ marginBottom: 8 }}>
                  字体和字号
                </div>

                {/* Live Preview Box */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    fontFamily: getFontFamilyStack(settings.fontFamily),
                    fontSize: settings.bodyFontSize,
                    color: 'var(--text-primary)',
                    marginBottom: 12,
                  }}
                >
                  DeskTag Aa 123
                </div>

                <div className="dt-setting-row">
                  <span style={{ fontSize: 13 }}>字体</span>
                  <select
                    className="dt-select"
                    value={settings.fontFamily}
                    onChange={(e) => updateSyncedSettings({ fontFamily: e.target.value })}
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="dt-setting-divider" />

                <div className="dt-setting-row">
                  <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                    正文字号 ({settings.bodyFontSize} px)
                  </span>
                  <input
                    type="range"
                    min={12}
                    max={18}
                    step={1}
                    value={settings.bodyFontSize}
                    onChange={(e) =>
                      updateSyncedSettings({ bodyFontSize: Number(e.target.value) })
                    }
                    style={{ width: 126, accentColor: 'var(--accent)', flexShrink: 0 }}
                  />
                </div>

                <div className="dt-setting-divider" />

                <div className="dt-setting-row">
                  <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                    界面字号 ({settings.uiFontSize} px)
                  </span>
                  <input
                    type="range"
                    min={11}
                    max={16}
                    step={1}
                    value={settings.uiFontSize}
                    onChange={(e) => updateSyncedSettings({ uiFontSize: Number(e.target.value) })}
                    style={{ width: 126, accentColor: 'var(--accent)', flexShrink: 0 }}
                  />
                </div>
              </div>
            </>
          )}

          {/* =============================================================== */}
          {/* TAB 3: 个性化 (Personalization)                                 */}
          {/* =============================================================== */}
          {activeTab === 'personalize' && (
            <>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>个性化</h3>

              {/* 11 Skins Quick Grid + Opacity */}
              <div className="dt-settings-card">
                <div className="dt-setting-title" style={{ marginBottom: 10 }}>
                  主题皮肤（11 款原创配色）
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))',
                    gap: 8,
                  }}
                >
                  {SKINS.map((skin) => {
                    const active = getSkinById(settings.skinId).id === skin.id;
                    return (
                      <button
                        key={skin.id}
                        type="button"
                        onClick={() => updateSyncedSettings({ skinId: skin.id })}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 8px',
                          borderRadius: 10,
                          border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                          background: active ? 'var(--accent-soft)' : 'var(--bg-surface)',
                          color: active ? 'var(--accent-soft-text)' : 'var(--text-primary)',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <SkinSwatchTile swatch={skin.swatch} size={26} />
                        <span style={{ fontSize: 12.5, fontWeight: active ? 600 : 500 }}>
                          {skin.name}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {!hideDesktopOnly && (
                  <>
                    <div className="dt-setting-divider" />
                    <div className="dt-setting-row">
                      <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                        面板透明度 ({Math.round(settings.opacity * 100)}%)
                      </span>
                      <input
                        type="range"
                        min={40}
                        max={100}
                        step={2}
                        value={Math.round(settings.opacity * 100)}
                        onChange={(e) =>
                          updateSyncedSettings({ opacity: Number(e.target.value) / 100 })
                        }
                        style={{ width: 126, accentColor: 'var(--accent)', flexShrink: 0 }}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Todo Display & Intelligence */}
              <div className="dt-settings-card">
                <div className="dt-setting-row">
                  <div>
                    <div className="dt-setting-title">列表排序</div>
                    <div className="dt-setting-desc">待办列表内未完成项目的默认排列方式</div>
                  </div>
                  <select
                    className="dt-select"
                    value={settings.sortBy}
                    onChange={(e) => updateSyncedSettings({ sortBy: e.target.value as TodoSortBy })}
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="dt-setting-divider" />

                <label className="dt-setting-row">
                  <div>
                    <div className="dt-setting-title">自动编号</div>
                    <div className="dt-setting-desc">在待办与子任务前显示层次序号（1. / 1.1）</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.autoNumbering}
                    onChange={(e) => updateSyncedSettings({ autoNumbering: e.target.checked })}
                  />
                </label>

                <div className="dt-setting-divider" />

                <label className="dt-setting-row">
                  <div>
                    <div className="dt-setting-title">详情展示</div>
                    <div className="dt-setting-desc">在待办列表中直接展示提醒时间、标签与子任务进度</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.showDetailsInList}
                    onChange={(e) => updateSyncedSettings({ showDetailsInList: e.target.checked })}
                  />
                </label>

                <div className="dt-setting-divider" />

                <label className="dt-setting-row">
                  <div>
                    <div className="dt-setting-title">智能文字识别</div>
                    <div className="dt-setting-desc">
                      新建待办时自动解析日期、时段、优先级、标签、提醒与重复规则
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.smartTextRecognition}
                    onChange={(e) =>
                      updateSyncedSettings({ smartTextRecognition: e.target.checked })
                    }
                  />
                </label>
              </div>

              {/* Quadrant Rules */}
              <div className="dt-settings-card">
                <div className="dt-setting-title" style={{ marginBottom: 8 }}>
                  四象限归类规则
                </div>
                <div className="dt-setting-row">
                  <span style={{ fontSize: 13 }}>「紧急」判定截止天数</span>
                  <select
                    className="dt-select"
                    value={settings.quadrantRules.urgentWithinDays}
                    onChange={(e) =>
                      updateSyncedSettings({
                        quadrantRules: {
                          ...settings.quadrantRules,
                          urgentWithinDays: Number(e.target.value),
                        },
                      })
                    }
                  >
                    <option value={0}>仅当天及逾期</option>
                    <option value={1}>未来 1 天内</option>
                    <option value={3}>未来 3 天内</option>
                    <option value={7}>未来 7 天内</option>
                  </select>
                </div>

                <div className="dt-setting-divider" />

                <div className="dt-setting-row">
                  <span style={{ fontSize: 13 }}>「重要」包含优先级</span>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {(
                      [
                        ['high', '高'],
                        ['medium', '中'],
                        ['low', '低'],
                      ] as Array<[TodoPriority, string]>
                    ).map(([p, label]) => (
                      <label
                        key={p}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={settings.quadrantRules.importantPriorities.includes(p)}
                          onChange={() => toggleImportantPriority(p)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* =============================================================== */}
          {/* TAB 4: 快捷键 (Shortcuts — Desktop Only)                         */}
          {/* =============================================================== */}
          {activeTab === 'shortcuts' && !hideDesktopOnly && (
            <>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>快捷键</h3>

              <div className="dt-settings-card">
                <div className="dt-setting-title" style={{ marginBottom: 10 }}>
                  全局快捷键
                </div>
                <div className="dt-setting-row">
                  <div>
                    <div className="dt-setting-title">显示 / 收起面板</div>
                    <div className="dt-setting-desc">点击输入框后直接按下组合键即可录制</div>
                  </div>
                  <input
                    type="text"
                    className="dt-input"
                    style={{ width: 150, textAlign: 'center', fontWeight: 600 }}
                    value={shortcutToggle}
                    onKeyDown={(e) => captureKeyCombo(e, setShortcutToggle)}
                    onChange={(e) => setShortcutToggle(e.target.value)}
                  />
                </div>

                <div className="dt-setting-divider" />

                <div className="dt-setting-row">
                  <div>
                    <div className="dt-setting-title">快速新建待办</div>
                    <div className="dt-setting-desc">唤起面板并立即聚焦顶部待办输入框</div>
                  </div>
                  <input
                    type="text"
                    className="dt-input"
                    style={{ width: 150, textAlign: 'center', fontWeight: 600 }}
                    value={shortcutQuickAdd}
                    onKeyDown={(e) => captureKeyCombo(e, setShortcutQuickAdd)}
                    onChange={(e) => setShortcutQuickAdd(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button
                    type="button"
                    className="dt-btn dt-btn-primary"
                    onClick={() => {
                      void updateDeviceSettings({
                        globalShortcutToggle: shortcutToggle.trim() || 'Alt+Shift+D',
                        globalShortcutQuickAdd: shortcutQuickAdd.trim() || 'Alt+Shift+N',
                      }).then(() => showToast('全局快捷键已保存'));
                    }}
                  >
                    保存快捷键
                  </button>
                </div>
              </div>

              <div className="dt-settings-card">
                <div className="dt-setting-title" style={{ marginBottom: 10 }}>
                  应用内快捷键参考
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
                  {[
                    ['Enter', '快速创建待办'],
                    ['Shift + Enter', '待办输入框内换行 / 批量粘贴多条待办'],
                    ['@', '在便签或待办中输入 @ 快速双向关联其他内容'],
                    ['Ctrl / Cmd + K', '打开全局检索（搜待办、子任务、标签、便签）'],
                    ['Esc', '关闭当前弹窗、浮层或下拉菜单'],
                  ].map(([key, desc]) => (
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                      }}
                    >
                      <span style={{ color: 'var(--text-secondary)' }}>{desc}</span>
                      <kbd
                        style={{
                          padding: '2px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border-strong)',
                          background: 'var(--bg-surface)',
                          fontSize: 11.5,
                          fontFamily: 'monospace',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* =============================================================== */}
          {/* TAB 5: 数据与同步 (Data & Sync + WebDAV)                        */}
          {/* =============================================================== */}
          {activeTab === 'data' && (
            <>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>数据与同步</h3>

              {/* Card 1: WebDAV Cloud Sync */}
              <WebDavSyncCard
                externalStatus={webdavStatus}
                onDataSynced={applySyncedAppData}
                onStatusChange={setWebdavStatusState}
              />

              {/* Card 2: Backup & Migration */}
              <div className="dt-settings-card">
                <div className="dt-settings-card-title">备份与迁移</div>
                <div className="dt-setting-desc" style={{ marginTop: 4 }}>
                  本地优先存储，零账号依赖。可随时导出完整备份或在其他设备导入。
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    marginTop: 12,
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>备份内容</span>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={includeData}
                      onChange={(e) => setIncludeData(e.target.checked)}
                    />
                    <span>数据</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={includeSettings}
                      onChange={(e) => setIncludeSettings(e.target.checked)}
                    />
                    <span>设置</span>
                  </label>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                  <button
                    type="button"
                    className="dt-btn dt-btn-primary"
                    disabled={busyExport}
                    onClick={() => void handleExportBackup()}
                  >
                    导出备份
                  </button>
                  <button
                    type="button"
                    className="dt-btn dt-btn-soft"
                    disabled={busyExport}
                    onClick={() => void handleImportBackupClick()}
                  >
                    导入备份
                  </button>
                </div>

                {/* Collapsible "其他导出" */}
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => setShowOtherExports((v) => !v)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--accent)',
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {showOtherExports ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
                    <span>其他导出</span>
                  </button>

                  {showOtherExports && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        marginTop: 10,
                      }}
                    >
                      {(
                        [
                          ['docx', 'Word (.docx)'],
                          ['pdf', 'PDF / 打印'],
                          ['html', 'HTML 网页'],
                          ['markdown', 'Markdown (.md)'],
                          ['csv', 'CSV 表格'],
                        ] as Array<[ClientExportFormat, string]>
                      ).map(([fmt, label]) => (
                        <button
                          key={fmt}
                          type="button"
                          className="dt-btn dt-btn-soft dt-btn-xs"
                          disabled={busyExport}
                          onClick={() => void handleOtherExport(fmt)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Card 3: Local Storage */}
              <div className="dt-settings-card">
                <div className="dt-settings-card-title">本机存储</div>
                <div className="dt-setting-desc" style={{ marginTop: 4 }}>
                  仅调整本机保存位置；换电脑或跨设备同步请使用上方的 WebDAV 云同步或备份与迁移。
                </div>

                <div
                  style={{
                    marginTop: 10,
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                    wordBreak: 'break-all',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <FolderIcon size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span>{storageInfo?.dataDir ?? '加载中…'}</span>
                  {storageInfo && (
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                      {formatBytes(storageInfo.totalBytes)}
                    </span>
                  )}
                </div>

                {editingStorageDir && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <input
                      type="text"
                      className="dt-input"
                      value={customDirDraft}
                      onChange={(e) => setCustomDirDraft(e.target.value)}
                      placeholder="输入新的数据目录路径…"
                    />
                    <button
                      type="button"
                      className="dt-btn dt-btn-primary dt-btn-xs"
                      onClick={() => void handleSaveCustomDir()}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      className="dt-btn dt-btn-ghost dt-btn-xs"
                      onClick={() => setEditingStorageDir(false)}
                    >
                      取消
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    className="dt-btn dt-btn-soft"
                    onClick={() => void handleChangeStorageDir()}
                  >
                    更改位置
                  </button>
                  {!hideDesktopOnly && (
                    <button
                      type="button"
                      className="dt-btn dt-btn-soft"
                      onClick={() => void openStorageDir()}
                    >
                      打开目录
                    </button>
                  )}
                  <button
                    type="button"
                    className="dt-btn dt-btn-soft"
                    onClick={() => void handleCopyPath()}
                  >
                    <CopyIcon size={13} style={{ marginRight: 4, verticalAlign: '-2px' }} />
                    复制路径
                  </button>
                </div>
              </div>
            </>
          )}

          {/* =============================================================== */}
          {/* TAB 6: 关于 (About)                                             */}
          {/* =============================================================== */}
          {activeTab === 'about' && (
            <>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>关于</h3>

              <div className="dt-settings-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <MascotAvatar size={44} />
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>DeskTag</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      版本 v{platform.appVersion || '1.0.1'} · 独立开源跨平台桌面贴边待办与便签
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.7,
                    color: 'var(--text-secondary)',
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                  }}
                >
                  DeskTag 是一款独立开源的轻量跨平台桌面贴边待办与便签工具，让日常任务与灵感记录随手可得、专注时安静收拢。
                  <br />
                  坚持本地优先与数据自主，支持通过 AES-256-GCM 端到端加密 WebDAV 引擎在 Windows、macOS 与 Android 间自由同步。
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    'Rust + Tauri v2',
                    'React 19 + TypeScript',
                    'AES-256-GCM E2EE WebDAV',
                    '11 款原创主题',
                    'Windows · macOS · Android',
                  ].map((badge) => (
                    <span
                      key={badge}
                      style={{
                        fontSize: 11.5,
                        padding: '3px 9px',
                        borderRadius: 999,
                        background: 'var(--tag-bg)',
                        border: '1px solid var(--tag-border)',
                        color: 'var(--tag-text)',
                      }}
                    >
                      {badge}
                    </span>
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    项目源码与问题反馈
                  </span>
                  <button
                    type="button"
                    className="dt-btn dt-btn-soft"
                    onClick={() => void handleOpenExternalUrl('https://github.com/nonsense-j/DeskTag')}
                  >
                    GitHub: nonsense-j/DeskTag ↗
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (inline) {
    return content;
  }

  return (
    <div
      onClick={() => setShowSettings(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 16, 12, 0.36)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobileLayout ? 0 : 18,
        zIndex: 85,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: isMobileLayout ? '100%' : 700,
          height: isMobileLayout ? '100%' : 'auto',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {content}
      </div>
    </div>
  );
};

export default SettingsModal;
