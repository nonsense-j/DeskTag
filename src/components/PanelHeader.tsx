import React from 'react';
import * as api from '../api/tauri';
import { useDeskTagStore } from '../store/useDeskTagStore';
import { formatHeaderDate, formatRelativeTime } from '../utils/lunar';
import { exportDeskTagDocument } from '../utils/exporter';
import {
  ArrowLeftIcon,
  AutoHideIcon,
  BellIcon,
  CalendarIcon,
  CloseIcon,
  CloudSyncIcon,
  ExportIcon,
  MascotAvatar,
  MicIcon,
  MoreIcon,
  PinIcon,
  QuadrantIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  ShirtSkinIcon,
} from './Icons';
import { NotificationPopover } from './NotificationPopover';
import { SkinPopover } from './SkinPopover';

export const PanelHeader: React.FC = () => {
  const {
    data,
    dock,
    platform,
    webdavStatus,
    unreadNotificationCount,
    showSkinPopover,
    showNotifications,
    showMoreMenu,
    navHistory,
    toggleAutoHide,
    toggleAlwaysOnTop,
    hideToTray,
    resetPanelLayout,
    setShowSkinPopover,
    setShowNotifications,
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

  const syncDotClass = webdavStatus.syncing
    ? 'syncing'
    : webdavStatus.lastError
      ? 'error'
      : webdavStatus.lastSyncAt
        ? 'synced'
        : 'idle';

  const handleOpenCalendar = () => {
    closeAllPopovers();
    void api.openCalendarWindow().catch((err) => {
      showToast(`打开日历失败：${err instanceof Error ? err.message : String(err)}`);
    });
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

  return (
    <header className="panel-header" data-tauri-drag-region>
      <div className="panel-header-left" data-tauri-drag-region>
        <MascotAvatar size={28} />
        {navHistory.length > 0 ? (
          <button
            type="button"
            className="nav-back-pill"
            onClick={navigateBack}
            title={`返回：${navHistory[navHistory.length - 1]?.label ?? ''}`}
          >
            <ArrowLeftIcon size={13} />
            <span>返回</span>
          </button>
        ) : (
          <span className="panel-header-date" data-tauri-drag-region>
            {headerDateText}
          </span>
        )}

        {webdavStatus.enabled && (
          <button
            type="button"
            className="header-sync-dot-btn"
            onClick={() => void triggerWebdavSyncNow()}
            title={
              webdavStatus.syncing
                ? '正在同步 WebDAV...'
                : webdavStatus.lastError
                  ? `同步异常：${webdavStatus.lastError}`
                  : `WebDAV 已开启 · 上次同步 ${formatRelativeTime(webdavStatus.lastSyncAt)}（点击立即同步）`
            }
          >
            <span className={`status-dot ${syncDotClass}`} />
          </button>
        )}
      </div>

      <div className="panel-header-actions">
        {platform.supportsEdgeDock && (
          <button
            type="button"
            className={`header-icon-btn${dock.autoHide ? ' active' : ''}`}
            onClick={() => void toggleAutoHide()}
            title={dock.autoHide ? '自动收起：已开启（点击关闭）' : '自动收起：已关闭（点击开启）'}
            aria-label="自动收起"
          >
            <AutoHideIcon size={16} />
          </button>
        )}

        {platform.isDesktop && (
          <button
            type="button"
            className={`header-icon-btn${dock.alwaysOnTop ? ' active' : ''}`}
            onClick={() => void toggleAlwaysOnTop()}
            title={dock.alwaysOnTop ? '取消置顶' : '窗口置顶'}
            aria-label="窗口置顶"
          >
            <PinIcon size={15} />
          </button>
        )}

        <button
          type="button"
          className={`header-icon-btn${showNotifications ? ' active' : ''}`}
          onClick={() => {
            const next = !showNotifications;
            closeAllPopovers();
            setShowNotifications(next);
          }}
          title="消息中心"
          aria-label="消息中心"
        >
          <BellIcon size={16} />
          {unreadNotificationCount > 0 && (
            <span className="header-badge-dot">
              {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
            </span>
          )}
        </button>

        <button
          type="button"
          className={`header-icon-btn${showSkinPopover ? ' active' : ''}`}
          onClick={() => {
            const next = !showSkinPopover;
            closeAllPopovers();
            setShowSkinPopover(next);
          }}
          title="切换皮肤与透明度"
          aria-label="切换皮肤"
        >
          <ShirtSkinIcon size={16} />
        </button>

        <button
          type="button"
          className={`header-icon-btn${showMoreMenu ? ' active' : ''}`}
          onClick={() => {
            const next = !showMoreMenu;
            closeAllPopovers();
            setShowMoreMenu(next);
          }}
          title="更多功能"
          aria-label="更多功能"
        >
          <MoreIcon size={16} />
        </button>

        {platform.isDesktop && (
          <button
            type="button"
            className="header-icon-btn danger"
            onClick={() => void hideToTray()}
            title="隐藏至系统托盘"
            aria-label="隐藏至托盘"
          >
            <CloseIcon size={16} />
          </button>
        )}
      </div>

      {/* Popovers */}
      {showSkinPopover && <SkinPopover />}
      {showNotifications && <NotificationPopover />}

      {showMoreMenu && (
        <>
          <div className="popover-backdrop" onClick={closeAllPopovers} />
          <div className="floating-popover more-menu-popover" role="menu">
            <button type="button" className="menu-item-btn" onClick={handleOpenCalendar}>
              <CalendarIcon size={15} />
              <span>日历视图</span>
            </button>
            <button
              type="button"
              className="menu-item-btn"
              onClick={() => {
                closeAllPopovers();
                setShowQuadrant(true);
              }}
            >
              <QuadrantIcon size={15} />
              <span>四象限</span>
            </button>
            <button
              type="button"
              className="menu-item-btn"
              onClick={() => {
                closeAllPopovers();
                setShowSearch(true);
              }}
            >
              <SearchIcon size={15} />
              <span>全局检索</span>
              <span className="menu-shortcut">Ctrl+K</span>
            </button>
            <button
              type="button"
              className="menu-item-btn"
              onClick={() => {
                closeAllPopovers();
                setShowVoiceModal(true);
              }}
            >
              <MicIcon size={15} />
              <span>快速录音</span>
            </button>

            <div className="menu-divider" />

            <button
              type="button"
              className="menu-item-btn"
              onClick={() => {
                closeAllPopovers();
                if (webdavStatus.configured) {
                  void triggerWebdavSyncNow();
                } else {
                  setShowSettings(true, 'data');
                }
              }}
            >
              <CloudSyncIcon size={15} />
              <span>{webdavStatus.configured ? '立即同步 WebDAV' : '配置云同步'}</span>
            </button>
            <button type="button" className="menu-item-btn" onClick={() => void handleQuickExport()}>
              <ExportIcon size={15} />
              <span>导出 Markdown</span>
            </button>

            <div className="menu-divider" />

            <button
              type="button"
              className="menu-item-btn"
              onClick={() => {
                closeAllPopovers();
                setShowSettings(true, 'general');
              }}
            >
              <SettingsIcon size={15} />
              <span>设置</span>
            </button>

            {platform.supportsEdgeDock && (
              <button
                type="button"
                className="menu-item-btn"
                onClick={() => {
                  closeAllPopovers();
                  void resetPanelLayout();
                }}
              >
                <RefreshIcon size={15} />
                <span>恢复默认布局</span>
              </button>
            )}
          </div>
        </>
      )}
    </header>
  );
};
