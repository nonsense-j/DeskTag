import {
  BellIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  CloudUploadIcon,
  ListTodoIcon,
  MicIcon,
  SearchIcon,
  SettingsIcon,
  ShirtIcon,
  StickyNoteIcon,
} from 'lucide-react';
import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDeskTagStore, type MobileSection } from '../store/useDeskTagStore';
import { formatHeaderDate } from '../utils/lunar';
import { MascotAvatar } from './Icons';
import { NotificationPopover } from './NotificationPopover';
import { SkinPopover } from './SkinPopover';

export const MobileTopHeader: React.FC = () => {
  const {
    webdavStatus,
    unreadNotificationCount,
    showSkinPopover,
    showNotifications,
    setShowSearch,
    setShowVoiceModal,
    setMobileSection,
    triggerWebdavSyncNow,
  } = useDeskTagStore();

  const syncDotClassName = webdavStatus.syncing
    ? 'animate-pulse bg-warning'
    : webdavStatus.lastError
      ? 'bg-destructive'
      : webdavStatus.lastSyncAt
        ? 'bg-success'
        : 'bg-muted-foreground/50';

  return (
    <header className="relative z-20 flex min-h-[52px] shrink-0 select-none items-center justify-between gap-2 border-b border-border bg-card/95 px-3.5 pt-[env(safe-area-inset-top,0px)] backdrop-blur-sm">
      <div className="flex min-w-0 items-center gap-2.5">
        <MascotAvatar size={26} />
        <span className="truncate font-semibold text-sm tracking-tight text-foreground">
          {formatHeaderDate(new Date())}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          aria-label="同步"
          className="relative size-8 text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (webdavStatus.configured) {
              void triggerWebdavSyncNow();
            } else {
              setMobileSection('settings');
            }
          }}
          size="icon-sm"
          title={webdavStatus.configured ? '立即同步 WebDAV' : '去设置配置 WebDAV 同步'}
          variant="ghost"
        >
          <CloudUploadIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
          {webdavStatus.enabled && (
            <span
              className={cn(
                'pointer-events-none absolute right-1.5 bottom-1.5 size-1.5 rounded-full ring-2 ring-card',
                syncDotClassName,
              )}
            />
          )}
        </Button>

        <Button
          aria-label="搜索"
          className="size-8 text-muted-foreground hover:text-foreground"
          onClick={() => setShowSearch(true)}
          size="icon-sm"
          variant="ghost"
        >
          <SearchIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
        </Button>

        <Button
          aria-label="语音速记"
          className="size-8 text-muted-foreground hover:text-foreground"
          onClick={() => setShowVoiceModal(true)}
          size="icon-sm"
          variant="ghost"
        >
          <MicIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
        </Button>

        <NotificationPopover
          trigger={
            <Button
              aria-label="消息中心"
              className={cn(
                'relative size-8 text-muted-foreground hover:text-foreground',
                showNotifications &&
                  'bg-dt-accent-soft text-dt-accent-soft-text hover:bg-dt-accent-soft/85',
              )}
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <BellIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
          {unreadNotificationCount > 0 && (
            <span className="pointer-events-none absolute top-1 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-1 font-bold text-[9px] leading-none text-white ring-2 ring-card tabular-nums">
              {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
            </span>
          )}
        </NotificationPopover>

        <SkinPopover
          trigger={
            <Button
              aria-label="切换皮肤"
              className={cn(
                'size-8 text-muted-foreground hover:text-foreground',
                showSkinPopover &&
                  'bg-dt-accent-soft text-dt-accent-soft-text hover:bg-dt-accent-soft/85',
              )}
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <ShirtIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
        </SkinPopover>
      </div>
    </header>
  );
};

const NAV_ITEMS: Array<{
  id: MobileSection;
  label: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>;
}> = [
  { id: 'todo', label: '待办', Icon: CheckCircle2Icon },
  { id: 'lists', label: '清单', Icon: ListTodoIcon },
  { id: 'notes', label: '便签', Icon: StickyNoteIcon },
  { id: 'views', label: '视图', Icon: CalendarDaysIcon },
  { id: 'settings', label: '设置', Icon: SettingsIcon },
];

export const MobileBottomNav: React.FC = () => {
  const {
    mobileSection,
    hasUnignoredUpdate,
    setMobileSection,
    setShowQuadrant,
    closeAllPopovers,
  } = useDeskTagStore();

  return (
    <nav
      aria-label="移动端底部导航"
      className="relative z-30 grid shrink-0 grid-cols-5 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-sm"
    >
      {NAV_ITEMS.map(({ id, label, Icon }) => {
        const active = mobileSection === id;
        const showUpdateDot = id === 'settings' && hasUnignoredUpdate;
        return (
          <button
            key={id}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors duration-[120ms] ease-[var(--dt-ease)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              active
                ? 'font-semibold text-dt-accent-soft-text'
                : 'font-medium text-muted-foreground hover:text-foreground',
            )}
            onClick={() => {
              closeAllPopovers();
              if (id === 'todo') setShowQuadrant(false);
              setMobileSection(id);
            }}
            type="button"
          >
            <span
              className={cn(
                'relative inline-flex h-7 w-11 items-center justify-center rounded-full transition-[background-color,color,transform] duration-[130ms] ease-[var(--dt-ease)] motion-safe:group-active:scale-[0.94] motion-safe:group-active:duration-[80ms]',
                active
                  ? 'bg-dt-accent-soft text-dt-accent-soft-text scale-100'
                  : 'scale-95 group-hover:bg-accent group-hover:text-foreground group-hover:scale-100',
              )}
            >
              <Icon
                aria-hidden
                className="size-[18px]"
                strokeWidth={active ? 2.1 : 1.75}
              />
              {showUpdateDot && (
                <span
                  aria-label="有可用更新"
                  className="pointer-events-none absolute top-0.5 right-2 size-2 rounded-full bg-dt-accent ring-2 ring-card"
                />
              )}
            </span>
            <span className="leading-none">{label}</span>
          </button>
        );
      })}
    </nav>
  );
};

/** Default alias exporting MobileBottomNav for convenience */
export const MobileNav: React.FC = () => <MobileBottomNav />;
