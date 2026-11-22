import React, { useMemo, useState } from 'react';
import { isTauriRuntime } from '../api/tauri';
import { useDeskTagStore } from '../store/useDeskTagStore';
import type { TodoItem, TodoPriority } from '../types/models';
import { exportDeskTagDocument, type ClientExportFormat } from '../utils/exporter';
import {
  WEEKDAY_LABELS,
  addDays,
  formatDateKey,
  formatWeekRangeLabel,
  getLunarDayLabel,
  getMonthGrid,
  getTodayKey,
  getWeekRange,
  solarToLunar,
} from '../utils/lunar';
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ExportIcon,
  FilterIcon,
  MaximizeIcon,
  MinimizeIcon,
  PinIcon,
  PlusIcon,
} from './Icons';

export interface CalendarViewProps {
  standalone?: boolean;
}

type CalendarMode = 'day' | 'week' | 'month';
type DrawerKind = 'unscheduled' | 'overdue' | null;

function priorityDotColor(priority: TodoPriority): string | null {
  if (priority === 'high') return 'var(--priority-high)';
  if (priority === 'medium') return 'var(--priority-medium)';
  if (priority === 'low') return 'var(--priority-low)';
  return null;
}

function todoCoversDate(todo: TodoItem, dateKey: string): boolean {
  if (!todo.dueDate) return false;
  const end = todo.endDate && todo.endDate >= todo.dueDate ? todo.endDate : todo.dueDate;
  return todo.dueDate <= dateKey && dateKey <= end;
}

function sortDayTodos(todos: TodoItem[]): TodoItem[] {
  const prioWeight: Record<TodoPriority, number> = { high: 3, medium: 2, low: 1, none: 0 };
  return [...todos].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.dueTime && b.dueTime && a.dueTime !== b.dueTime) {
      return a.dueTime.localeCompare(b.dueTime);
    }
    if (a.dueTime && !b.dueTime) return -1;
    if (!a.dueTime && b.dueTime) return 1;
    if (prioWeight[b.priority] !== prioWeight[a.priority]) {
      return prioWeight[b.priority] - prioWeight[a.priority];
    }
    return a.sortOrder - b.sortOrder;
  });
}

export const CalendarView: React.FC<CalendarViewProps> = ({ standalone = false }) => {
  const {
    data,
    activeTodos,
    activeLists,
    isMobileLayout,
    setEditingTodoId,
    addTodo,
    updateTodo,
    toggleTodo,
    showToast,
  } = useDeskTagStore();

  const [mode, setMode] = useState<CalendarMode>(isMobileLayout ? 'month' : 'week');
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [pinned, setPinned] = useState(false);

  // Filter popover
  const [showFilter, setShowFilter] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [filterListId, setFilterListId] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<TodoPriority | 'all'>('all');
  const [filterTag, setFilterTag] = useState<string>('all');
  const [showCompleted, setShowCompleted] = useState<boolean>(true);

  // Quick-add on clicked day
  const [quickAddDateKey, setQuickAddDateKey] = useState<string | null>(null);
  const [quickAddTitle, setQuickAddTitle] = useState('');

  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => getTodayKey(today), [today]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of activeTodos) {
      for (const tag of t.tags) set.add(tag);
    }
    return Array.from(set).sort();
  }, [activeTodos]);

  const filteredTodos = useMemo(() => {
    return activeTodos.filter((t) => {
      if (!showCompleted && t.completed) return false;
      if (filterListId !== 'all') {
        if (filterListId === '__none__') {
          if (t.listId !== null) return false;
        } else if (t.listId !== filterListId) {
          return false;
        }
      }
      if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
      if (filterTag !== 'all' && !t.tags.includes(filterTag)) return false;
      return true;
    });
  }, [activeTodos, showCompleted, filterListId, filterPriority, filterTag]);

  const unscheduledTodos = useMemo(
    () => activeTodos.filter((t) => !t.completed && !t.dueDate),
    [activeTodos],
  );

  const overdueTodos = useMemo(
    () =>
      activeTodos.filter((t) => {
        if (t.completed || !t.dueDate) return false;
        const end = t.endDate && t.endDate >= t.dueDate ? t.endDate : t.dueDate;
        return end < todayKey;
      }),
    [activeTodos, todayKey],
  );

  const weekRange = useMemo(() => getWeekRange(anchorDate), [anchorDate]);
  const monthCells = useMemo(
    () => getMonthGrid(anchorDate.getFullYear(), anchorDate.getMonth() + 1, today),
    [anchorDate, today],
  );

  const hasActiveFilters =
    filterListId !== 'all' || filterPriority !== 'all' || filterTag !== 'all' || !showCompleted;

  const stepAnchor = (delta: number) => {
    setAnchorDate((prev) => {
      if (mode === 'day') return addDays(prev, delta);
      if (mode === 'week') return addDays(prev, delta * 7);
      return new Date(prev.getFullYear(), prev.getMonth() + delta, 1);
    });
  };

  const rangeLabel = useMemo(() => {
    if (mode === 'week') {
      return formatWeekRangeLabel(weekRange.start, weekRange.end);
    }
    if (mode === 'month') {
      return `${anchorDate.getFullYear()}年 ${anchorDate.getMonth() + 1}月`;
    }
    const lunar = solarToLunar(
      anchorDate.getFullYear(),
      anchorDate.getMonth() + 1,
      anchorDate.getDate(),
    );
    const wk = WEEKDAY_LABELS[(anchorDate.getDay() + 6) % 7];
    return `${anchorDate.getFullYear()}/${anchorDate.getMonth() + 1}/${anchorDate.getDate()} ${wk} · ${lunar.monthLabel}${lunar.dayLabel}`;
  }, [mode, weekRange, anchorDate]);

  const handleQuickAddSubmit = (dateKey: string) => {
    const title = quickAddTitle.trim();
    if (!title) {
      setQuickAddDateKey(null);
      return;
    }
    addTodo({
      title,
      dueDate: dateKey,
      listId: filterListId !== 'all' && filterListId !== '__none__' ? filterListId : null,
      priority: filterPriority !== 'all' ? filterPriority : 'none',
      tags: filterTag !== 'all' ? [filterTag] : [],
    });
    setQuickAddTitle('');
    setQuickAddDateKey(null);
  };

  const handleExport = async (format: ClientExportFormat) => {
    setShowExportMenu(false);
    try {
      const res = await exportDeskTagDocument(data, format, { scope: 'todos' });
      showToast(res.message);
    } catch (err) {
      showToast(`导出失败：${String(err)}`);
    }
  };

  const handleToggleWindowPin = async () => {
    const next = !pinned;
    setPinned(next);
    if (isTauriRuntime()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().setAlwaysOnTop(next);
      } catch {
        // ignore
      }
    }
  };

  const handleMinimize = async () => {
    if (isTauriRuntime()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().minimize();
      } catch {
        // ignore
      }
    }
  };

  const handleToggleMaximize = async () => {
    if (isTauriRuntime()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().toggleMaximize();
      } catch {
        // ignore
      }
    }
  };

  const handleCloseWindow = async () => {
    if (isTauriRuntime()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
        return;
      } catch {
        // ignore
      }
    }
    window.close();
  };

  const renderTodoRow = (todo: TodoItem, dateKey: string, compact = false) => {
    const dot = priorityDotColor(todo.priority);
    const isSpan = Boolean(todo.endDate && todo.dueDate && todo.endDate > todo.dueDate);
    const isSpanStart = isSpan && todo.dueDate === dateKey;
    const isSpanEnd = isSpan && todo.endDate === dateKey;
    const isMobileCompact = compact && isMobileLayout;

    return (
      <div
        key={`${todo.id}-${dateKey}`}
        onClick={(e) => {
          e.stopPropagation();
          setEditingTodoId(todo.id);
        }}
        title={`${todo.title}${todo.dueTime ? ` (${todo.dueTime})` : ''}${isSpan ? ` · 跨天至 ${todo.endDate}` : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isMobileCompact ? 3 : compact ? 4 : 6,
          padding: isMobileCompact ? '1px 3px' : compact ? '2px 5px' : '4px 6px',
          borderRadius: isSpan
            ? `${isSpanStart ? 6 : 2}px ${isSpanEnd ? 6 : 2}px ${isSpanEnd ? 6 : 2}px ${isSpanStart ? 6 : 2}px`
            : isMobileCompact
              ? 4
              : 6,
          background: isSpan
            ? 'var(--accent-soft)'
            : isMobileCompact
              ? 'var(--bg-surface)'
              : 'transparent',
          borderLeft: isSpan && isSpanStart ? '2.5px solid var(--accent)' : undefined,
          cursor: 'pointer',
          minWidth: 0,
        }}
        className="dt-cal-todo-item"
      >
        {!isMobileCompact && (
          <button
            type="button"
            aria-label={todo.completed ? '标记未完成' : '标记完成'}
            onClick={(e) => {
              e.stopPropagation();
              toggleTodo(todo.id);
            }}
            style={{
              width: compact ? 13 : 15,
              height: compact ? 13 : 15,
              borderRadius: '50%',
              border: todo.completed ? 'none' : '1.4px solid var(--border-strong)',
              background: todo.completed ? 'var(--text-muted)' : 'transparent',
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              flexShrink: 0,
              cursor: 'pointer',
            }}
          >
            {todo.completed && <CheckIcon size={compact ? 8 : 9} />}
          </button>
        )}

        {(dot || isMobileCompact) && (
          <span
            style={{
              width: isMobileCompact ? 4.5 : compact ? 5 : 6.5,
              height: isMobileCompact ? 4.5 : compact ? 5 : 6.5,
              borderRadius: '50%',
              background: dot ?? (todo.completed ? 'var(--text-muted)' : 'var(--accent)'),
              flexShrink: 0,
            }}
          />
        )}

        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: isMobileCompact ? 10.5 : compact ? 11.5 : 12.5,
            lineHeight: isMobileCompact ? 1.35 : 1.4,
            color: todo.completed ? 'var(--text-completed)' : 'var(--text-primary)',
          }}
        >
          {todo.title}
        </span>

        {!compact && todo.dueTime && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {todo.dueTime}
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      className="dt-calendar-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-panel)',
        color: 'var(--text-primary)',
        borderRadius: standalone ? 12 : 0,
        overflow: 'hidden',
        border: standalone ? '1px solid var(--border)' : 'none',
      }}
    >
      {/* Standalone Desktop Window Titlebar */}
      {standalone && (
        <header
          data-tauri-drag-region
          style={{
            height: 40,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 10px 0 14px',
            background: 'var(--bg-header)',
            borderBottom: '1px solid var(--border)',
            userSelect: 'none',
          }}
        >
          <div
            data-tauri-drag-region
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13.5 }}
          >
            <CalendarIcon size={16} style={{ color: 'var(--accent)' }} />
            <span>日历视图</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
            <button
              type="button"
              title="导出日历待办"
              onClick={() => setShowExportMenu((v) => !v)}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 7,
                background: showExportMenu ? 'var(--accent-soft)' : 'transparent',
                color: 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <ExportIcon size={15} />
            </button>

            {showExportMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 88,
                  width: 148,
                  padding: 6,
                  borderRadius: 10,
                  background: 'var(--bg-popover)',
                  border: '1px solid var(--border)',
                  boxShadow: 'var(--shadow-popover)',
                  zIndex: 50,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {(
                  [
                    ['markdown', '导出 Markdown'],
                    ['html', '导出 HTML'],
                    ['docx', '导出 Word'],
                    ['pdf', '打印 / PDF'],
                    ['csv', '导出 CSV'],
                  ] as Array<[ClientExportFormat, string]>
                ).map(([fmt, label]) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => void handleExport(fmt)}
                    style={{
                      textAlign: 'left',
                      padding: '6px 9px',
                      border: 'none',
                      borderRadius: 7,
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      fontSize: 12.5,
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              title={pinned ? '取消置顶' : '窗口置顶'}
              onClick={() => void handleToggleWindowPin()}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 7,
                background: pinned ? 'var(--accent-soft)' : 'transparent',
                color: pinned ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <PinIcon size={14} />
            </button>

            <button
              type="button"
              title="最小化"
              onClick={() => void handleMinimize()}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 7,
                background: 'transparent',
                color: 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <MinimizeIcon size={14} />
            </button>

            <button
              type="button"
              title="最大化 / 还原"
              onClick={() => void handleToggleMaximize()}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 7,
                background: 'transparent',
                color: 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <MaximizeIcon size={13} />
            </button>

            <button
              type="button"
              title="关闭日历窗口"
              onClick={() => void handleCloseWindow()}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 7,
                background: 'transparent',
                color: 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </header>
      )}

      {/* Calendar Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-panel)',
          position: 'relative',
        }}
      >
        {/* Left: Stepper + Today + Unscheduled/Overdue live counters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              aria-label="上一周期"
              onClick={() => stepAnchor(-1)}
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                border: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <ChevronLeftIcon size={14} />
            </button>
            <span
              style={{
                fontWeight: 600,
                fontSize: isMobileLayout ? 13.5 : 15,
                letterSpacing: '-0.01em',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {rangeLabel}
            </span>
            <button
              type="button"
              aria-label="下一周期"
              onClick={() => stepAnchor(1)}
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                border: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <ChevronRightIcon size={14} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setAnchorDate(new Date())}
            style={{
              padding: '3px 11px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            今天
          </button>

          <button
            type="button"
            onClick={() => setDrawer((d) => (d === 'unscheduled' ? null : 'unscheduled'))}
            style={{
              padding: '3px 8px',
              borderRadius: 8,
              border: 'none',
              background: drawer === 'unscheduled' ? 'var(--accent-soft)' : 'transparent',
              color: drawer === 'unscheduled' ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            待安排 <strong style={{ color: 'var(--text-primary)' }}>{unscheduledTodos.length}</strong>
          </button>

          <button
            type="button"
            onClick={() => setDrawer((d) => (d === 'overdue' ? null : 'overdue'))}
            style={{
              padding: '3px 8px',
              borderRadius: 8,
              border: 'none',
              background: drawer === 'overdue' ? 'var(--danger-soft)' : 'transparent',
              color: overdueTodos.length > 0 ? 'var(--danger)' : 'var(--text-secondary)',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            逾期 <strong>{overdueTodos.length}</strong>
          </button>
        </div>

        {/* Right: View Switcher + Filter Popover */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
          <div
            style={{
              display: 'inline-flex',
              padding: 2,
              borderRadius: 9,
              background: 'var(--bg-header)',
              border: '1px solid var(--border)',
            }}
          >
            {(
              [
                ['day', '日视图'],
                ['week', '周视图'],
                ['month', '月视图'],
              ] as Array<[CalendarMode, string]>
            ).map(([m, label]) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 7,
                    border: 'none',
                    background: active ? 'var(--pill-active-bg)' : 'transparent',
                    color: active ? 'var(--pill-active-text)' : 'var(--text-secondary)',
                    fontWeight: active ? 600 : 500,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowFilter((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 10px',
              borderRadius: 9,
              border: `1px solid ${hasActiveFilters || showFilter ? 'var(--accent-border)' : 'var(--border)'}`,
              background: hasActiveFilters || showFilter ? 'var(--accent-soft)' : 'var(--bg-surface)',
              color: hasActiveFilters || showFilter ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            <FilterIcon size={13} />
            <span>筛选</span>
          </button>

          {showFilter && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                width: 248,
                padding: 12,
                borderRadius: 12,
                background: 'var(--bg-popover)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-popover)',
                zIndex: 45,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 13 }}>日历筛选</strong>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterListId('all');
                      setFilterPriority('all');
                      setFilterTag('all');
                      setShowCompleted(true);
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--accent)',
                      fontSize: 11.5,
                      cursor: 'pointer',
                    }}
                  >
                    重置筛选
                  </button>
                )}
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                <span style={{ color: 'var(--text-secondary)' }}>清单</span>
                <select
                  value={filterListId}
                  onChange={(e) => setFilterListId(e.target.value)}
                  style={{
                    padding: '5px 8px',
                    borderRadius: 7,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: 12.5,
                  }}
                >
                  <option value="all">全部清单</option>
                  <option value="__none__">普通待办</option>
                  {activeLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                <span style={{ color: 'var(--text-secondary)' }}>优先级</span>
                <select
                  value={filterPriority}
                  onChange={(e) => setFilterPriority(e.target.value as TodoPriority | 'all')}
                  style={{
                    padding: '5px 8px',
                    borderRadius: 7,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: 12.5,
                  }}
                >
                  <option value="all">全部优先级</option>
                  <option value="high">高优先级</option>
                  <option value="medium">中优先级</option>
                  <option value="low">低优先级</option>
                  <option value="none">无优先级</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                <span style={{ color: 'var(--text-secondary)' }}>标签</span>
                <select
                  value={filterTag}
                  onChange={(e) => setFilterTag(e.target.value)}
                  style={{
                    padding: '5px 8px',
                    borderRadius: 7,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: 12.5,
                  }}
                >
                  <option value="all">全部标签</option>
                  {allTags.map((tag) => (
                    <option key={tag} value={tag}>
                      #{tag}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(e) => setShowCompleted(e.target.checked)}
                />
                <span>显示已完成待办</span>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area + Optional Unscheduled / Overdue Drawer */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {drawer && (
          <aside
            style={{
              width: isMobileLayout ? '100%' : 250,
              flexShrink: 0,
              borderRight: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 10,
              position: isMobileLayout ? 'absolute' : 'relative',
              inset: isMobileLayout ? 0 : undefined,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 12px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-header)',
              }}
            >
              <strong style={{ fontSize: 13 }}>
                {drawer === 'unscheduled'
                  ? `待安排 (${unscheduledTodos.length})`
                  : `已逾期 (${overdueTodos.length})`}
              </strong>
              <button
                type="button"
                onClick={() => setDrawer(null)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 16,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(drawer === 'unscheduled' ? unscheduledTodos : overdueTodos).length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
                  {drawer === 'unscheduled' ? '暂无待安排待办' : '太棒了，没有逾期待办'}
                </div>
              ) : (
                (drawer === 'unscheduled' ? unscheduledTodos : overdueTodos).map((t) => (
                  <div
                    key={t.id}
                    style={{
                      padding: '7px 9px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-card)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                    }}
                  >
                    <div
                      onClick={() => setEditingTodoId(t.id)}
                      style={{
                        fontSize: 12.5,
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {priorityDotColor(t.priority) && (
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: priorityDotColor(t.priority)!,
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.title}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, color: drawer === 'overdue' ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {t.dueDate ? `原定 ${t.dueDate}` : '未设日期'}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateTodo(t.id, { dueDate: todayKey })}
                        style={{
                          padding: '2px 7px',
                          borderRadius: 6,
                          border: '1px solid var(--accent-border)',
                          background: 'var(--accent-soft)',
                          color: 'var(--accent-soft-text)',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        安排到今天
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}

        {/* WEEK VIEW */}
        {mode === 'week' && (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                borderBottom: '1px solid var(--border)',
                padding: '7px 0',
                flexShrink: 0,
              }}
            >
              {WEEKDAY_LABELS.map((wk) => (
                <div
                  key={wk}
                  style={{
                    textAlign: 'center',
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {wk}
                </div>
              ))}
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                overflowY: 'auto',
              }}
            >
              {weekRange.days.map((day, idx) => {
                const dateKey = formatDateKey(day);
                const isToday = dateKey === todayKey;
                const lunar = getLunarDayLabel(day.getFullYear(), day.getMonth() + 1, day.getDate());
                const dayTodos = sortDayTodos(filteredTodos.filter((t) => todoCoversDate(t, dateKey)));

                return (
                  <div
                    key={dateKey}
                    onClick={() => {
                      setQuickAddDateKey(dateKey);
                      setQuickAddTitle('');
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      minHeight: 360,
                      padding: '8px 6px 12px',
                      borderRight: idx < 6 ? '1px solid var(--border)' : 'none',
                      background: isToday ? 'var(--bg-header)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {/* Solar + Lunar Date Header */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        padding: '0 4px 8px',
                      }}
                    >
                      <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
                        <span
                          style={{
                            fontWeight: isToday ? 700 : 600,
                            fontSize: 13.5,
                            color: isToday ? 'var(--accent-soft-text)' : 'var(--text-primary)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {day.getDate()}
                        </span>
                        <span
                          style={{
                            fontSize: 11.5,
                            color: isToday ? 'var(--accent-soft-text)' : 'var(--text-muted)',
                          }}
                        >
                          {lunar}
                        </span>
                      </div>
                      <button
                        type="button"
                        title="在此日新建待办"
                        onClick={(e) => {
                          e.stopPropagation();
                          setQuickAddDateKey(dateKey);
                          setQuickAddTitle('');
                        }}
                        style={{
                          width: 20,
                          height: 20,
                          border: 'none',
                          borderRadius: 5,
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <PlusIcon size={12} />
                      </button>
                    </div>

                    {/* Tasks */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {dayTodos.map((todo) => renderTodoRow(todo, dateKey, false))}
                    </div>

                    {/* Inline Quick Add Input */}
                    {quickAddDateKey === dateKey && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ marginTop: 6 }}
                      >
                        <input
                          autoFocus
                          type="text"
                          value={quickAddTitle}
                          onChange={(e) => setQuickAddTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              handleQuickAddSubmit(dateKey);
                            } else if (e.key === 'Escape') {
                              setQuickAddDateKey(null);
                            }
                          }}
                          onBlur={() => {
                            if (quickAddTitle.trim()) {
                              handleQuickAddSubmit(dateKey);
                            } else {
                              setQuickAddDateKey(null);
                            }
                          }}
                          placeholder="输入待办 Enter 创建…"
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '5px 7px',
                            borderRadius: 7,
                            border: '1px solid var(--accent-border)',
                            background: 'var(--bg-input)',
                            color: 'var(--text-primary)',
                            fontSize: 12,
                            outline: 'none',
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* MONTH VIEW */}
        {mode === 'month' && (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                borderBottom: '1px solid var(--border)',
                padding: '6px 0',
                flexShrink: 0,
              }}
            >
              {WEEKDAY_LABELS.map((wk) => (
                <div
                  key={wk}
                  style={{
                    textAlign: 'center',
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {wk}
                </div>
              ))}
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                gridTemplateRows: 'repeat(6, minmax(84px, 1fr))',
                overflowY: 'auto',
              }}
            >
              {monthCells.map((cell, idx) => {
                const dayTodos = sortDayTodos(
                  filteredTodos.filter((t) => todoCoversDate(t, cell.dateKey)),
                );
                const maxShow = isMobileLayout ? 2 : 3;

                return (
                  <div
                    key={cell.dateKey}
                    onClick={() => {
                      setQuickAddDateKey(cell.dateKey);
                      setQuickAddTitle('');
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      padding: isMobileLayout ? '4px 3px 3px' : '5px 5px 4px',
                      borderRight: idx % 7 !== 6 ? '1px solid var(--border)' : 'none',
                      borderBottom: idx < 35 ? '1px solid var(--border)' : 'none',
                      background: cell.isToday ? 'var(--bg-header)' : 'transparent',
                      opacity: cell.inCurrentMonth ? 1 : 0.48,
                      cursor: 'pointer',
                      minWidth: 0,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: isMobileLayout ? 2 : 4,
                        marginBottom: isMobileLayout ? 2 : 3,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: cell.isToday ? 700 : 600,
                          fontSize: isMobileLayout ? 11.5 : 12.5,
                          color: cell.isToday ? 'var(--accent-soft-text)' : 'var(--text-primary)',
                        }}
                      >
                        {cell.dayOfMonth}
                      </span>
                      <span
                        style={{
                          fontSize: isMobileLayout ? 9.5 : 10.5,
                          color: cell.isToday ? 'var(--accent-soft-text)' : 'var(--text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cell.lunarLabel}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      {dayTodos.slice(0, maxShow).map((todo) => renderTodoRow(todo, cell.dateKey, true))}
                      {dayTodos.length > maxShow && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAnchorDate(cell.date);
                            setMode('day');
                          }}
                          style={{
                            textAlign: 'left',
                            padding: isMobileLayout ? '0 3px' : '1px 5px',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--accent-soft-text)',
                            fontSize: isMobileLayout ? 10 : 10.5,
                            fontWeight: 600,
                            lineHeight: 1.3,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            cursor: 'pointer',
                          }}
                        >
                          {isMobileLayout
                            ? `+${dayTodos.length - maxShow}项`
                            : `+${dayTodos.length - maxShow} 更多`}
                        </button>
                      )}
                    </div>

                    {quickAddDateKey === cell.dateKey && (
                      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 'auto', paddingTop: 3 }}>
                        <input
                          autoFocus
                          type="text"
                          value={quickAddTitle}
                          onChange={(e) => setQuickAddTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              handleQuickAddSubmit(cell.dateKey);
                            } else if (e.key === 'Escape') {
                              setQuickAddDateKey(null);
                            }
                          }}
                          onBlur={() => {
                            if (quickAddTitle.trim()) {
                              handleQuickAddSubmit(cell.dateKey);
                            } else {
                              setQuickAddDateKey(null);
                            }
                          }}
                          placeholder="新建待办…"
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '3px 5px',
                            borderRadius: 5,
                            border: '1px solid var(--accent-border)',
                            background: 'var(--bg-input)',
                            color: 'var(--text-primary)',
                            fontSize: 11,
                            outline: 'none',
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* DAY VIEW */}
        {mode === 'day' && (() => {
          const dateKey = formatDateKey(anchorDate);
          const dayTodos = sortDayTodos(filteredTodos.filter((t) => todoCoversDate(t, dateKey)));
          return (
            <div
              style={{
                flex: 1,
                minWidth: 0,
                overflowY: 'auto',
                padding: '14px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--accent-border)',
                  background: 'var(--bg-input)',
                }}
              >
                <PlusIcon size={15} style={{ color: 'var(--accent)' }} />
                <input
                  type="text"
                  value={quickAddDateKey === dateKey ? quickAddTitle : ''}
                  onFocus={() => setQuickAddDateKey(dateKey)}
                  onChange={(e) => {
                    setQuickAddDateKey(dateKey);
                    setQuickAddTitle(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleQuickAddSubmit(dateKey);
                    }
                  }}
                  placeholder={`为 ${dateKey} 添加待办，按 Enter 创建…`}
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--font-body-size)',
                  }}
                />
              </div>

              {dayTodos.length === 0 ? (
                <div
                  style={{
                    padding: '44px 16px',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: 13.5,
                  }}
                >
                  这一天暂无安排，可在上方输入框直接新建待办。
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {dayTodos.map((todo) => (
                    <div
                      key={todo.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      {renderTodoRow(todo, dateKey, false)}
                      {todo.tags.length > 0 && (
                        <div style={{ display: 'flex', gap: 5, paddingLeft: 24, marginTop: 4, flexWrap: 'wrap' }}>
                          {todo.tags.map((tag) => (
                            <span
                              key={tag}
                              style={{
                                fontSize: 11,
                                padding: '0 7px',
                                borderRadius: 999,
                                background: 'var(--tag-bg)',
                                border: '1px solid var(--tag-border)',
                                color: 'var(--tag-text)',
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default CalendarView;
