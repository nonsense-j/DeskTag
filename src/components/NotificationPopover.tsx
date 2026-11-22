import React from 'react';
import { useDeskTagStore } from '../store/useDeskTagStore';
import { formatRelativeTime } from '../utils/lunar';

export const NotificationPopover: React.FC = () => {
  const {
    notifications,
    unreadNotificationCount,
    markNotificationsRead,
    clearNotifications,
    setShowNotifications,
    setEditingTodoId,
    setActiveTab,
  } = useDeskTagStore();

  const handleClickItem = (id: string, todoId: string | null) => {
    void markNotificationsRead([id]);
    if (todoId) {
      setActiveTab({ kind: 'todo' });
      setEditingTodoId(todoId);
      setShowNotifications(false);
    }
  };

  return (
    <>
      <div className="popover-backdrop" onClick={() => setShowNotifications(false)} />
      <div className="floating-popover notif-popover" role="dialog" aria-label="消息中心">
        <div className="notif-header">
          <span className="popover-title">
            消息中心{unreadNotificationCount > 0 ? ` (${unreadNotificationCount})` : ''}
          </span>
          <div className="notif-header-actions">
            {unreadNotificationCount > 0 && (
              <button
                type="button"
                className="text-link-btn"
                onClick={() => void markNotificationsRead()}
              >
                全部已读
              </button>
            )}
            {notifications.length > 0 && (
              <button
                type="button"
                className="text-link-btn muted"
                onClick={() => void clearNotifications()}
              >
                清空
              </button>
            )}
          </div>
        </div>

        <div className="notif-list">
          {notifications.length === 0 ? (
            <div className="empty-hint-box">暂无新消息，提醒与同步通知将显示在这里</div>
          ) : (
            notifications.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`notif-item${item.read ? '' : ' unread'}`}
                onClick={() => handleClickItem(item.id, item.todoId)}
              >
                <div className="notif-item-top">
                  <span className="notif-item-title">{item.title}</span>
                  <span className="notif-item-time">{formatRelativeTime(item.createdAt)}</span>
                </div>
                {item.body && <div className="notif-item-body">{item.body}</div>}
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
};
