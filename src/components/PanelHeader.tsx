import {
  ArrowLeftIcon,
  ArrowRightToLineIcon,
  BellIcon,
  CalendarIcon,
  CloudUploadIcon,
  DownloadIcon,
  EllipsisIcon,
  LayoutGridIcon,
  LogOutIcon,
  MicIcon,
  PinIcon,
  RotateCcwIcon,
  SearchIcon,
  SettingsIcon,
  ShirtIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from '@/components/ui/menu';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import * as api from '../api/tauri';
import { useDeskTagStore } from '../store/useDeskTagStore';
import { exportDeskTagDocument } from '../utils/exporter';
import { formatHeaderDate, formatRelativeTime } from '../utils/lunar';
import { MascotAvatar } from './Icons';
import { NotificationPopover } from './NotificationPopover';
import { SkinPopover } from './SkinPopover';

export interface PanelHeaderProps {
  onOpenSettingsAbout?: () => void;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({ onOpenSettingsAbout }) => {
  const {
    data,
    device,
    dock,
    platform,
    webdavStatus,
    unreadNotificationCount,
    showSkinPopover,
    showNotifications,
    showMoreMenu,
    navHistory,
    updateResult,
    hasUnignoredUpdate,
    toggleAutoHide,
    toggleAlwaysOnTop,
    hideToTray,
    quitApp,
    resetPanelLayout,
    setShowMoreMenu,
    setShowQuadrant,
    setShowSearch,
    setShowVoiceModal,
    setShowSettings,
    closeAllPopovers,
    navigateBack,
    triggerWebdavSyncNow,
    showToast,
  } = useDeskTagStore();

  const headerDateText = formatHeaderDate(new Date());

  const syncDotClassName = webdavStatus.syncing
    ? 'animate-pulse bg-warning'
    : webdavStatus.lastError
      ? 'bg-destructive'
      : webdavStatus.lastSyncAt
        ? 'bg-success'
        : 'bg-muted-foreground/50';

  const syncTooltipText = webdavStatus.syncing
    ? '正在同步 WebDAV…'
    : webdavStatus.lastError
      ? `同步异常：${webdavStatus.lastError}`
      : `WebDAV 已开启 · 上次同步 ${formatRelativeTime(webdavStatus.lastSyncAt)}（点击立即同步）`;

  const handleOpenCalendar = () => {
    closeAllPopovers();
    void api.openCalendarWindow().catch((err) => {
      showToast(`打开日历失败：${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const handleQuitApp = async () => {
    closeAllPopovers();
    await quitApp();
  };

  const handleOpenSettingsAbout = () => {
    closeAllPopovers();
    if (onOpenSettingsAbout) {
      onOpenSettingsAbout();
    } else {
      setShowSettings(true, 'about');
    }
  };

  const handleHeaderClose = () => {
    if (device.closeToTray !== false) {
      void hideToTray();
    } else {
      void handleQuitApp();
    }
  };

  const handleQuickExport = async () => {
    closeAllPopovers();
    try {
      const res = await exportDeskTagDocument(data, 'markdown', { scope: 'all' });
      showToast(res.message);
    } catch (err) {
      showToast(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleMoreMenuOpenChange = (open: boolean) => {
    if (open) {
      closeAllPopovers();
      setShowMoreMenu(true);
    } else {
      setShowMoreMenu(false);
    }
  };

  return (
    <header
      className="relative z-20 flex h-12 min-h-12 shrink-0 select-none items-center justify-between gap-2 border-b border-border bg-sidebar px-3.5"
      data-tauri-drag-region
    >
      {/* Left: Mascot + Date or Back Pill + WebDAV status dot */}
      <div className="flex min-w-0 items-center gap-2.5" data-tauri-drag-region>
        <span className="inline-flex shrink-0 items-center" data-tauri-drag-region>
          <MascotAvatar size={26} />
        </span>

        {navHistory.length > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  className="dt-pop-in rounded-full"
                  onClick={navigateBack}
                  size="xs"
                  variant="outline"
                />
              }
            >
              <ArrowLeftIcon aria-hidden="true" strokeWidth={1.75} />
              <span>返回</span>
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              返回：{navHistory[navHistory.length - 1]?.label ?? ''}
            </TooltipPopup>
          </Tooltip>
        ) : (
          <span
            className="truncate font-semibold text-[var(--font-ui-size)] tracking-tight text-foreground"
            data-tauri-drag-region
          >
            {headerDateText}
          </span>
        )}

        {webdavStatus.enabled && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  aria-label="WebDAV 同步状态"
                  className="dt-pressable-icon inline-flex size-5 shrink-0 items-center justify-center rounded-full outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => void triggerWebdavSyncNow()}
                  type="button"
                />
              }
            >
              <span className={cn('size-2 rounded-full transition-colors', syncDotClassName)} />
            </TooltipTrigger>
            <TooltipPopup side="bottom">{syncTooltipText}</TooltipPopup>
          </Tooltip>
        )}
      </div>

      {/* Center draggable spacer */}
      <div className="h-full min-w-2 flex-1" data-tauri-drag-region />

      {/* Right actions */}
      <div className="flex shrink-0 items-center gap-0.5">
        {platform.supportsEdgeDock && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="自动收起"
                  aria-pressed={dock.autoHide}
                  className={cn(
                    'size-7 text-muted-foreground hover:text-foreground',
                    dock.autoHide &&
                      'bg-dt-accent-soft text-dt-accent-soft-text hover:bg-dt-accent-soft/85 hover:text-dt-accent-soft-text',
                  )}
                  onClick={() => void toggleAutoHide()}
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              <ArrowRightToLineIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {dock.autoHide ? '自动收起：已开启（点击关闭）' : '自动收起：已关闭（点击开启）'}
            </TooltipPopup>
          </Tooltip>
        )}

        {platform.isDesktop && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="窗口置顶"
                  aria-pressed={dock.alwaysOnTop}
                  className={cn(
                    'size-7 text-muted-foreground hover:text-foreground',
                    dock.alwaysOnTop &&
                      'bg-dt-accent-soft text-dt-accent-soft-text hover:bg-dt-accent-soft/85 hover:text-dt-accent-soft-text',
                  )}
                  onClick={() => void toggleAlwaysOnTop()}
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              <PinIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {dock.alwaysOnTop ? '取消置顶' : '窗口置顶'}
            </TooltipPopup>
          </Tooltip>
        )}

        {/* Notifications Popover */}
        <NotificationPopover
          tooltipLabel="消息中心"
          trigger={
            <Button
              aria-label="消息中心"
              className={cn(
                'relative size-7 text-muted-foreground hover:text-foreground',
                showNotifications &&
                  'bg-dt-accent-soft text-dt-accent-soft-text hover:bg-dt-accent-soft/85 hover:text-dt-accent-soft-text',
              )}
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <BellIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
          {unreadNotificationCount > 0 && (
            <span className="pointer-events-none absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-1 font-bold text-[9px] leading-none text-white ring-2 ring-sidebar tabular-nums">
              {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
            </span>
          )}
        </NotificationPopover>

        {/* Skin & Opacity Popover */}
        <SkinPopover
          tooltipLabel="切换皮肤与透明度"
          trigger={
            <Button
              aria-label="切换皮肤"
              className={cn(
                'size-7 text-muted-foreground hover:text-foreground',
                showSkinPopover &&
                  'bg-dt-accent-soft text-dt-accent-soft-text hover:bg-dt-accent-soft/85 hover:text-dt-accent-soft-text',
              )}
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <ShirtIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
        </SkinPopover>

        {/* More Menu */}
        <Menu onOpenChange={handleMoreMenuOpenChange} open={showMoreMenu}>
          <Tooltip disabled={showMoreMenu}>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <Button
                      aria-label="更多功能"
                      className={cn(
                        'relative size-7 text-muted-foreground hover:text-foreground',
                        showMoreMenu &&
                          'bg-dt-accent-soft text-dt-accent-soft-text hover:bg-dt-accent-soft/85 hover:text-dt-accent-soft-text',
                      )}
                      size="icon-xs"
                      variant="ghost"
                    />
                  }
                />
              }
            >
              <EllipsisIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
              {hasUnignoredUpdate && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-dt-accent ring-2 ring-sidebar"
                />
              )}
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {hasUnignoredUpdate ? '更多功能（发现新版本）' : '更多功能'}
            </TooltipPopup>
          </Tooltip>

          <MenuPopup align="end" className="w-52" side="bottom" sideOffset={6}>
            <MenuGroup>
              <MenuItem onClick={handleOpenCalendar}>
                <CalendarIcon aria-hidden="true" strokeWidth={1.75} />
                <span>日历视图</span>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  closeAllPopovers();
                  setShowQuadrant(true);
                }}
              >
                <LayoutGridIcon aria-hidden="true" strokeWidth={1.75} />
                <span>四象限</span>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  closeAllPopovers();
                  setShowSearch(true);
                }}
              >
                <SearchIcon aria-hidden="true" strokeWidth={1.75} />
                <span>全局检索</span>
                <MenuShortcut>Ctrl+K</MenuShortcut>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  closeAllPopovers();
                  setShowVoiceModal(true);
                }}
              >
                <MicIcon aria-hidden="true" strokeWidth={1.75} />
                <span>快速录音</span>
              </MenuItem>
            </MenuGroup>

            <MenuSeparator />

            <MenuGroup>
              <MenuItem
                onClick={() => {
                  closeAllPopovers();
                  if (webdavStatus.configured) {
                    void triggerWebdavSyncNow();
                  } else {
                    setShowSettings(true, 'data');
                  }
                }}
              >
                <CloudUploadIcon aria-hidden="true" strokeWidth={1.75} />
                <span>{webdavStatus.configured ? '立即同步 WebDAV' : '配置云同步'}</span>
              </MenuItem>
              <MenuItem onClick={() => void handleQuickExport()}>
                <DownloadIcon aria-hidden="true" strokeWidth={1.75} />
                <span>导出 Markdown</span>
              </MenuItem>
            </MenuGroup>

            <MenuSeparator />

            <MenuGroup>
              {hasUnignoredUpdate && updateResult && (
                <MenuItem
                  className="font-semibold text-dt-accent-soft-text"
                  onClick={handleOpenSettingsAbout}
                >
                  <SparklesIcon aria-hidden="true" className="text-dt-accent" strokeWidth={1.75} />
                  <span className="truncate">发现新版本 v{updateResult.latestVersion}</span>
                </MenuItem>
              )}

              <MenuItem
                onClick={() => {
                  if (hasUnignoredUpdate && onOpenSettingsAbout) {
                    handleOpenSettingsAbout();
                  } else {
                    closeAllPopovers();
                    setShowSettings(true, 'general');
                  }
                }}
              >
                <SettingsIcon aria-hidden="true" strokeWidth={1.75} />
                <span>设置</span>
                {hasUnignoredUpdate && (
                  <Badge className="ms-auto" size="sm" variant="info">
                    有更新
                  </Badge>
                )}
              </MenuItem>

              {platform.supportsEdgeDock && (
                <MenuItem
                  onClick={() => {
                    closeAllPopovers();
                    void resetPanelLayout();
                  }}
                >
                  <RotateCcwIcon aria-hidden="true" strokeWidth={1.75} />
                  <span>恢复默认布局</span>
                </MenuItem>
              )}
            </MenuGroup>

            {platform.isDesktop && (
              <>
                <MenuSeparator />
                <MenuGroup>
                  <MenuItem onClick={() => void handleQuitApp()} variant="destructive">
                    <LogOutIcon aria-hidden="true" strokeWidth={1.75} />
                    <span>退出 DeskTag</span>
                  </MenuItem>
                </MenuGroup>
              </>
            )}
          </MenuPopup>
        </Menu>

        {platform.isDesktop && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={device.closeToTray !== false ? '隐藏到系统托盘' : '退出 DeskTag'}
                  className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
                  onClick={handleHeaderClose}
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              <XIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {device.closeToTray !== false ? '隐藏到系统托盘' : '退出 DeskTag'}
            </TooltipPopup>
          </Tooltip>
        )}
      </div>
    </header>
  );
};
