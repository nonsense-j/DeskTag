import React from 'react';
import { useDeskTagStore, type MobileSection } from '../store/useDeskTagStore';
import { formatHeaderDate } from '../utils/lunar';
import {
  BellIcon,
  CalendarIcon,
  CheckIcon,
  CloudSyncIcon,
  ListIcon,
  MascotAvatar,
  MicIcon,
  NoteIcon,
  SearchIcon,
  SettingsIcon,
  ShirtSkinIcon,
} from './Icons';
import { NotificationPopover } from './NotificationPopover';
import { SkinPopover } from './SkinPopover';

export const MobileTopHeader: React.FC = () => {
  const {
    webdavStatus,
    unreadNotificationCount,
    showSkinPopover,
    showNotifications,
    closeAllPopovers,
    setShowSkinPopover,
    setShowNotifications,
    setShowSearch,
    setShowVoiceModal,
    setMobileSection,
    triggerWebdavSyncNow,
  } = useDeskTagStore();

  const syncDotClass = webdavStatus.syncing
    ? 'syncing'
    : webdavStatus.lastError
      ? 'error'
      : webdavStatus.lastSyncAt
        ? 'synced'
        : 'idle';

  return (
    <header className="mobile-top-header">
      <div className="panel-header-left">
        <MascotAvatar size={26} />
        <span className="panel-header-date">{formatHeaderDate(new Date())}</span>
      </div>

      <div className="panel-header-actions">
        <button
          type="button"
          className="header-icon-btn"
          onClick={() => {
            if (webdavStatus.configured) {
              void triggerWebdavSyncNow();
            } else {
              setMobileSection('settings');
            }
          }}
          title={webdavStatus.configured ? '立即同步 WebDAV' : '去设置配置 WebDAV 同步'}
          aria-label="同步"
        >
          <CloudSyncIcon size={17} />
          {webdavStatus.enabled && (
            <span
              className={`status-dot ${syncDotClass}`}
              style={{ position: 'absolute', bottom: 4, right: 4, width: 6, height: 6 }}
            />
          )}
        </button>

        <button
          type="button"
          className="header-icon-btn"
          onClick={() => setShowSearch(true)}
          aria-label="搜索"
        >
          <SearchIcon size={16} />
        </button>

        <button
          type="button"
          className="header-icon-btn"
          onClick={() => setShowVoiceModal(true)}
          aria-label="语音速记"
        >
          <MicIcon size={16} />
        </button>

        <button
          type="button"
          className={`header-icon-btn${showNotifications ? ' active' : ''}`}
          onClick={() => {
            const next = !showNotifications;
            closeAllPopovers();
            setShowNotifications(next);
          }}
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
          aria-label="切换皮肤"
        >
          <ShirtSkinIcon size={16} />
        </button>
      </div>

      {showSkinPopover && <SkinPopover />}
      {showNotifications && <NotificationPopover />}
    </header>
  );
};

const NAV_ITEMS: Array<{
  id: MobileSection;
  label: string;
  renderIcon: () => React.ReactNode;
}> = [
  { id: 'todo', label: '待办', renderIcon: () => <CheckIcon size={18} strokeWidth={2} /> },
  { id: 'lists', label: '清单', renderIcon: () => <ListIcon size={18} /> },
  { id: 'notes', label: '便签', renderIcon: () => <NoteIcon size={18} /> },
  { id: 'views', label: '视图', renderIcon: () => <CalendarIcon size={18} /> },
  { id: 'settings', label: '设置', renderIcon: () => <SettingsIcon size={18} /> },
];

export const MobileBottomNav: React.FC = () => {
  const { mobileSection, setMobileSection, setShowQuadrant, closeAllPopovers } = useDeskTagStore();

  return (
    <nav className="mobile-bottom-nav" aria-label="移动端底部导航">
      {NAV_ITEMS.map((item) => {
        const active = mobileSection === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={`mobile-nav-item${active ? ' active' : ''}`}
            onClick={() => {
              closeAllPopovers();
              if (item.id === 'todo') setShowQuadrant(false);
              setMobileSection(item.id);
            }}
          >
            {item.renderIcon()}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

/** Default alias exporting MobileBottomNav for convenience */
export const MobileNav: React.FC = () => <MobileBottomNav />;
