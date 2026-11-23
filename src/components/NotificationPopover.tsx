import { BellOffIcon, CheckCheckIcon, Trash2Icon } from 'lucide-react';
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useDeskTagStore } from '../store/useDeskTagStore';
import { formatRelativeTime } from '../utils/lunar';

export interface NotificationPopoverProps {
  /** Trigger element passed to PopoverTrigger `render` (childless button element) */
  trigger?: React.ReactElement;
  /** Content rendered inside the trigger element */
  children?: React.ReactNode;
  /** Optional desktop hover tooltip text */
  tooltipLabel?: string;
}

export const NotificationPopover: React.FC<NotificationPopoverProps> = ({
  trigger,
  children,
  tooltipLabel,
}) => {
  const {
    notifications,
    unreadNotificationCount,
    showNotifications,
    markNotificationsRead,
    clearNotifications,
    setShowNotifications,
    closeAllPopovers,
    setEditingTodoId,
    setActiveTab,
  } = useDeskTagStore();

  const handleOpenChange = (open: boolean) => {
    if (open) {
      closeAllPopovers();
      setShowNotifications(true);
    } else {
      setShowNotifications(false);
    }
  };

  const handleClickItem = (id: string, todoId: string | null) => {
    void markNotificationsRead([id]);
    if (todoId) {
      setActiveTab({ kind: 'todo' });
      setEditingTodoId(todoId);
      setShowNotifications(false);
    }
  };

  const headingNode = trigger ? (
    <PopoverTitle className="text-sm font-semibold text-foreground">消息中心</PopoverTitle>
  ) : (
    <span className="text-sm font-semibold text-foreground">消息中心</span>
  );

  const bodyContent = (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {headingNode}
          {unreadNotificationCount > 0 && (
            <Badge size="sm" variant="error" className="tabular-nums">
              {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1">
          {unreadNotificationCount > 0 && (
            <Button
              onClick={() => void markNotificationsRead()}
              size="xs"
              variant="ghost"
            >
              <CheckCheckIcon aria-hidden="true" strokeWidth={1.75} />
              <span>全部已读</span>
            </Button>
          )}
          {notifications.length > 0 && (
            <Button
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
              onClick={() => void clearNotifications()}
              size="xs"
              variant="ghost"
            >
              <Trash2Icon aria-hidden="true" strokeWidth={1.75} />
              <span>清空</span>
            </Button>
          )}
        </div>
      </div>

      <Separator className="my-2.5" />

      {notifications.length === 0 ? (
        <Empty className="gap-2.5 px-3 py-7 md:py-7">
          <EmptyHeader>
            <EmptyMedia className="mb-2.5" variant="icon">
              <BellOffIcon aria-hidden="true" strokeWidth={1.75} />
            </EmptyMedia>
            <EmptyTitle className="text-sm font-semibold">暂无新消息</EmptyTitle>
            <EmptyDescription className="text-xs">
              待办提醒与 WebDAV 同步通知将显示在这里
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex max-h-[300px] min-h-0 flex-col">
          <ScrollArea className="-mx-1 max-h-[300px] flex-1 px-1" scrollFade>
            <div className="flex flex-col gap-1 pb-0.5">
              {notifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleClickItem(item.id, item.todoId)}
                  className={cn(
                    'group flex w-full flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    item.read
                      ? 'border-transparent bg-transparent hover:bg-accent'
                      : 'border-dt-accent-border/40 bg-dt-accent-soft/65 hover:bg-dt-accent-soft',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {!item.read && (
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full bg-dt-accent"
                        />
                      )}
                      <span
                        className={cn(
                          'truncate text-xs leading-snug',
                          item.read
                            ? 'font-medium text-foreground/85'
                            : 'font-semibold text-foreground',
                        )}
                      >
                        {item.title}
                      </span>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {formatRelativeTime(item.createdAt)}
                    </span>
                  </div>
                  {item.body && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );

  // Fallback standalone mode if rendered without an explicit trigger
  if (!trigger) {
    return (
      <>
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowNotifications(false)}
        />
        <div
          aria-label="消息中心"
          className="absolute top-12 right-3 z-50 w-[332px] max-w-[calc(100%-24px)] rounded-xl border bg-popover not-dark:bg-clip-padding p-3.5 text-popover-foreground shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
          role="dialog"
        >
          {bodyContent}
        </div>
      </>
    );
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={showNotifications}>
      {tooltipLabel ? (
        <Tooltip disabled={showNotifications}>
          <TooltipTrigger render={<PopoverTrigger render={trigger} />}>
            {children}
          </TooltipTrigger>
          <TooltipPopup side="bottom">{tooltipLabel}</TooltipPopup>
        </Tooltip>
      ) : (
        <PopoverTrigger render={trigger}>{children}</PopoverTrigger>
      )}

      <PopoverPopup
        align="end"
        aria-label="消息中心"
        className="w-[332px] max-w-[calc(100vw-24px)]"
        side="bottom"
        sideOffset={6}
      >
        {bodyContent}
      </PopoverPopup>
    </Popover>
  );
};
