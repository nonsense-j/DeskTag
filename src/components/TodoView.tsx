import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDeskTagStore, type TodoScope } from '../store/useDeskTagStore';
import type { TodoItem, TodoPriority } from '../types/models';
import {
  diffDays,
  formatDateKey,
  formatShortDueDate,
  getMonthRange,
  getTodayKey,
  getWeekRange,
} from '../utils/lunar';
import { parseBatchLines, parseTodoText } from '../utils/nlParser';
import { formatReminderChipLabel, formatRepeatSummary } from '../utils/recurrence';
import {
  AlarmIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  EditIcon,
  ListIcon,
  PinIcon,
  PlusIcon,
  QuadrantIcon,
  RepeatIcon,
  SendIcon,
  SparklesIcon,
  TrashIcon,
} from './Icons';

export interface TodoViewProps {
  /** Optional explicit list filter (e.g. when opened from a pinned side tab or mobile Lists tab) */
  listIdOverride?: string | null;
}

const PRIORITY_WEIGHT: Record<TodoPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

export const TodoView: React.FC<TodoViewProps> = ({ listIdOverride }) => {
  const {
    data,
    activeTodos,
    activeLists,
    activeTab,
    todoScope,
    selectedListId,
    isMobileLayout,
    quickAddFocusTrigger,
    setTodoScope,
    setSelectedListId,
    setShowQuadrant,
    setEditingTodoId,
    setReminderTodoId,
    setShowListManager,
    setActiveTab,
    addTodo,
    addTodosBatch,
    toggleTodo,
    deleteTodo,
    toggleSubtask,
    toggleListPin,
    showToast,
  } = useDeskTagStore();

  const effectiveListId =
    listIdOverride !== undefined
      ? listIdOverride
      : activeTab.kind === 'list'
        ? activeTab.listId
        : todoScope === 'list'
          ? selectedListId
          : null;

  const isDedicatedListTab = activeTab.kind === 'list' || listIdOverride != null;
  const activeListObj = useMemo(
    () => (effectiveListId ? activeLists.find((l) => l.id === effectiveListId) ?? null : null),
    [activeLists, effectiveListId],
  );

  // Quick-add input state
  const [inputText, setInputText] = useState('');
  const [nlDismissedFor, setNlDismissedFor] = useState<string | null>(null);
  const [keepRawTitle, setKeepRawTitle] = useState(false);
  const [batchLines, setBatchLines] = useState<string[] | null>(null);
  const [batchSelected, setBatchSelected] = useState<boolean[]>([]);
  const [showListMenu, setShowListMenu] = useState(false);
  const [incompleteOpen, setIncompleteOpen] = useState(true);
  const [completedOpen, setCompletedOpen] = useState(true);
  const [expandedTodoIds, setExpandedTodoIds] = useState<Record<string, boolean>>({});
  const [swipeState, setSwipeState] = useState<{ id: string; dx: number } | null>(null);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const touchStartRef = useRef<{ id: string; x: number; y: number } | null>(null);

  // Focus input on global quick-add hotkey event
  useEffect(() => {
    if (quickAddFocusTrigger > 0) {
      inputRef.current?.focus();
    }
  }, [quickAddFocusTrigger]);

  // Expand the first incomplete todo with subtasks on initial render for warm visual clarity
  useEffect(() => {
    setExpandedTodoIds((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const firstWithSubs = activeTodos.find((t) => !t.completed && t.subtasks.length > 0);
      return firstWithSubs ? { [firstWithSubs.id]: true } : prev;
    });
  }, [activeTodos]);

  const now = new Date();
  const todayKey = getTodayKey(now);
  const weekRange = getWeekRange(now);
  const monthRange = getMonthRange(now.getFullYear(), now.getMonth() + 1);

  const unscheduledCount = useMemo(
    () => activeTodos.filter((t) => !t.completed && !t.dueDate).length,
    [activeTodos],
  );

  // Filter todos by current scope or list
  const filteredTodos = useMemo(() => {
    return activeTodos.filter((todo) => {
      if (effectiveListId) {
        return todo.listId === effectiveListId;
      }
      if (todoScope === 'unscheduled') {
        return !todo.dueDate;
      }
      if (todoScope === 'today') {
        if (!todo.dueDate) return false;
        const endKey = todo.endDate && todo.endDate >= todo.dueDate ? todo.endDate : todo.dueDate;
        // Include today's tasks, multi-day tasks spanning today, and overdue incomplete tasks
        if (todo.dueDate <= todayKey && endKey >= todayKey) return true;
        if (!todo.completed && todo.dueDate < todayKey) return true;
        return false;
      }
      if (todoScope === 'week') {
        if (!todo.dueDate) return false;
        const endKey = todo.endDate && todo.endDate >= todo.dueDate ? todo.endDate : todo.dueDate;
        return todo.dueDate <= weekRange.endKey && endKey >= weekRange.startKey;
      }
      if (todoScope === 'month') {
        if (!todo.dueDate) return false;
        const endKey = todo.endDate && todo.endDate >= todo.dueDate ? todo.endDate : todo.dueDate;
        return todo.dueDate <= monthRange.endKey && endKey >= monthRange.startKey;
      }
      return true;
    });
  }, [activeTodos, effectiveListId, monthRange.endKey, monthRange.startKey, todoScope, todayKey, weekRange.endKey, weekRange.startKey]);

  // Sort according to synced settings
  const sortedTodos = useMemo(() => {
    const sortBy = data.settings.sortBy;
    const copy = [...filteredTodos];
    copy.sort((a, b) => {
      if (sortBy === 'priority') {
        const diff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
        if (diff !== 0) return diff;
      } else if (sortBy === 'due_date') {
        const da = a.dueDate ? `${a.dueDate} ${a.dueTime ?? '99:99'}` : '9999-99-99';
        const db = b.dueDate ? `${b.dueDate} ${b.dueTime ?? '99:99'}` : '9999-99-99';
        if (da !== db) return da.localeCompare(db);
      } else if (sortBy === 'created_at') {
        return b.createdAt.localeCompare(a.createdAt);
      } else if (sortBy === 'updated_at') {
        return b.updatedAt.localeCompare(a.updatedAt);
      }
      return a.sortOrder - b.sortOrder;
    });
    return copy;
  }, [data.settings.sortBy, filteredTodos]);

  const incompleteTodos = useMemo(() => sortedTodos.filter((t) => !t.completed), [sortedTodos]);
  const completedTodos = useMemo(() => sortedTodos.filter((t) => t.completed), [sortedTodos]);

  // Live Natural-Language text recognition
  const nlParsed = useMemo(() => {
    if (!data.settings.smartTextRecognition) return null;
    if (!inputText.trim()) return null;
    const parsed = parseTodoText(inputText, new Date());
    return parsed.hasMatches ? parsed : null;
  }, [data.settings.smartTextRecognition, inputText]);

  const showNlPopover = Boolean(nlParsed && nlDismissedFor !== inputText);

  const defaultDueDateForCurrentScope = (): string | null => {
    if (effectiveListId) return null;
    if (todoScope === 'today' || todoScope === 'week' || todoScope === 'month') {
      return formatDateKey(new Date());
    }
    return null;
  };

  const handleSubmitTodo = (useRecognition: boolean = true) => {
    const trimmed = inputText.trim();
    if (!trimmed) return;

    const lines = parseBatchLines(trimmed);
    if (lines.length > 1) {
      setBatchLines(lines);
      setBatchSelected(lines.map(() => true));
      return;
    }

    const useNl = useRecognition && showNlPopover && nlParsed !== null;
    const finalTitle = useNl
      ? keepRawTitle
        ? nlParsed.rawTitle
        : nlParsed.cleanedTitle
      : trimmed;

    addTodo({
      title: finalTitle,
      dueDate: useNl && nlParsed.dueDate !== null ? nlParsed.dueDate : defaultDueDateForCurrentScope(),
      dueTime: useNl ? nlParsed.dueTime : null,
      priority: useNl && nlParsed.priority ? nlParsed.priority : 'none',
      tags: useNl ? nlParsed.tags : [],
      repeatRule: useNl ? nlParsed.repeatRule : null,
      reminderRule: useNl ? nlParsed.reminderRule : null,
      listId: effectiveListId,
    });

    setInputText('');
    setNlDismissedFor(null);
    setKeepRawTitle(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitTodo(true);
    }
  };

  const handleInputPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (pasted && pasted.includes('\n')) {
      const lines = parseBatchLines(pasted);
      if (lines.length > 1) {
        e.preventDefault();
        setBatchLines(lines);
        setBatchSelected(lines.map(() => true));
      }
    }
  };

  const handleConfirmBatchCreate = () => {
    if (!batchLines) return;
    const chosen = batchLines.filter((_, i) => batchSelected[i]);
    if (chosen.length === 0) {
      setBatchLines(null);
      return;
    }
    const baseDue = defaultDueDateForCurrentScope();
    const items = chosen.map((line) => {
      if (data.settings.smartTextRecognition) {
        const p = parseTodoText(line, new Date());
        if (p.hasMatches) {
          return {
            title: p.cleanedTitle,
            dueDate: p.dueDate ?? baseDue,
            dueTime: p.dueTime,
            priority: p.priority ?? ('none' as TodoPriority),
            tags: p.tags,
            repeatRule: p.repeatRule,
            reminderRule: p.reminderRule,
            listId: effectiveListId,
          };
        }
      }
      return {
        title: line,
        dueDate: baseDue,
        listId: effectiveListId,
      };
    });
    const created = addTodosBatch(items);
    setBatchLines(null);
    setInputText('');
    showToast(`已批量创建 ${created.length} 条待办`);
  };

  const handleMergeBatchAsSingle = () => {
    if (!batchLines) return;
    const first = batchLines[0] ?? '新待办';
    const rest = batchLines.slice(1).join('\n');
    addTodo({
      title: first,
      notes: rest,
      dueDate: defaultDueDateForCurrentScope(),
      listId: effectiveListId,
    });
    setBatchLines(null);
    setInputText('');
    showToast('已合并为 1 条待办');
  };

  const toggleExpand = (id: string) => {
    setExpandedTodoIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const listNameById = useMemo(
    () => new Map(activeLists.map((l) => [l.id, l])),
    [activeLists],
  );

  const placeholderText = activeListObj
    ? `添加到「${activeListObj.name}」 Enter 创建，Shift+Enter 换行`
    : todoScope === 'today'
      ? '添加今日待办 Enter 创建，Shift+Enter 换行'
      : todoScope === 'week'
        ? '添加本周待办 Enter 创建，Shift+Enter 换行'
        : todoScope === 'month'
          ? '添加本月待办 Enter 创建，Shift+Enter 换行'
          : '添加待安排事项 Enter 创建，Shift+Enter 换行';

  const handleTouchStart = (id: string, e: React.TouchEvent) => {
    if (!isMobileLayout) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = { id, x: touch.clientX, y: touch.clientY };
  };

  const handleTouchMove = (id: string, e: React.TouchEvent) => {
    if (!isMobileLayout || !touchStartRef.current || touchStartRef.current.id !== id) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);
    if (Math.abs(dx) > 14 && Math.abs(dx) > dy) {
      setSwipeState({ id, dx: Math.max(-88, Math.min(88, dx)) });
    }
  };

  const handleTouchEnd = (id: string) => {
    if (!touchStartRef.current || touchStartRef.current.id !== id) return;
    if (swipeState && swipeState.id === id) {
      if (swipeState.dx > 56) {
        toggleTodo(id);
      } else if (swipeState.dx < -56) {
        deleteTodo(id);
        showToast('已删除待办');
      }
    }
    touchStartRef.current = null;
    setSwipeState(null);
  };

  const renderTodoItem = (todo: TodoItem, index: number) => {
    const hasSubtasks = todo.subtasks.length > 0;
    const isExpanded = Boolean(expandedTodoIds[todo.id]);
    const doneSubCount = todo.subtasks.filter((s) => s.completed).length;
    const progressPct = hasSubtasks ? Math.round((doneSubCount / todo.subtasks.length) * 100) : 0;

    const dueLabel = formatShortDueDate(todo.dueDate, todo.dueTime, now);
    const isOverdue = !todo.completed && Boolean(todo.dueDate && diffDays(todayKey, todo.dueDate) < 0);
    const reminderChip = formatReminderChipLabel(todo.reminderRule, now);
    const repeatChip = todo.repeatRule?.enabled ? formatRepeatSummary(todo.repeatRule) : '';
    const listBadge = !effectiveListId && todo.listId ? listNameById.get(todo.listId) : null;

    const showMetaLine =
      data.settings.showDetailsInList &&
      (Boolean(reminderChip) || todo.tags.length > 0 || Boolean(repeatChip) || Boolean(listBadge));

    const translateX = swipeState?.id === todo.id ? swipeState.dx : 0;

    return (
      <div
        key={todo.id}
        className={`todo-item-wrap${todo.completed ? ' completed' : ''}`}
        onTouchStart={(e) => handleTouchStart(todo.id, e)}
        onTouchMove={(e) => handleTouchMove(todo.id, e)}
        onTouchEnd={() => handleTouchEnd(todo.id)}
        style={
          translateX !== 0
            ? { transform: `translateX(${translateX}px)`, transition: 'none' }
            : undefined
        }
      >
        <div className="todo-row">
          {/* Expand chevron slot */}
          {hasSubtasks ? (
            <button
              type="button"
              className="todo-expand-slot"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(todo.id);
              }}
              aria-label={isExpanded ? '收起子任务' : '展开子任务'}
            >
              {isExpanded ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
            </button>
          ) : (
            <span className="todo-expand-slot" aria-hidden="true" />
          )}

          {/* Circular Checkbox */}
          <button
            type="button"
            className={`todo-checkbox${todo.completed ? ' checked' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleTodo(todo.id);
            }}
            aria-label={todo.completed ? '标记为未完成' : '标记为已完成'}
          >
            {todo.completed && <CheckIcon size={11} strokeWidth={2.6} />}
          </button>

          {/* Main content column */}
          <div
            className="todo-content-col"
            onClick={() => setEditingTodoId(todo.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setEditingTodoId(todo.id);
              }
            }}
          >
            <div className="todo-line-1">
              {data.settings.autoNumbering && (
                <span className="todo-index-num">{index + 1}.</span>
              )}
              {todo.priority !== 'none' && !todo.completed && (
                <span className={`priority-dot ${todo.priority}`} title={`优先级：${todo.priority}`} />
              )}
              <span className="todo-title-text">{todo.title}</span>

              {hasSubtasks && (
                <span className="progress-capsule" title={`子任务进度 ${doneSubCount}/${todo.subtasks.length}`}>
                  <span className="progress-capsule-fill" style={{ width: `${progressPct}%` }} />
                  <span className="progress-capsule-label">{progressPct}%</span>
                </span>
              )}
            </div>

            {showMetaLine && (
              <div className="todo-meta-row">
                {reminderChip && (
                  <button
                    type="button"
                    className="reminder-chip"
                    onClick={(e) => {
                      e.stopPropagation();
                      setReminderTodoId(todo.id);
                    }}
                    title="点击修改提醒"
                  >
                    <AlarmIcon size={12.5} />
                    <span>{reminderChip}</span>
                  </button>
                )}

                {repeatChip && (
                  <span className="repeat-chip" title="重复待办">
                    <RepeatIcon size={11.5} />
                    <span>{repeatChip}</span>
                  </span>
                )}

                {todo.tags.map((tag) => (
                  <span key={tag} className="tag-pill">
                    {tag}
                  </span>
                ))}

                {listBadge && (
                  <span className="tag-pill" style={{ gap: 5 }}>
                    <span className="list-color-dot" style={{ background: listBadge.color, width: 6, height: 6 }} />
                    {listBadge.name}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Right side: due time + hover quick actions */}
          <div className="todo-right-col">
            {dueLabel && (
              <span className={`todo-due-label hide-on-hover${isOverdue ? ' overdue' : ''}`}>
                {dueLabel}
              </span>
            )}
            <div className="todo-hover-actions">
              <button
                type="button"
                className="mini-icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setReminderTodoId(todo.id);
                }}
                title="设置提醒"
                aria-label="设置提醒"
              >
                <AlarmIcon size={14} />
              </button>
              <button
                type="button"
                className="mini-icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingTodoId(todo.id);
                }}
                title="编辑详情"
                aria-label="编辑详情"
              >
                <EditIcon size={13.5} />
              </button>
              <button
                type="button"
                className="mini-icon-btn danger"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteTodo(todo.id);
                }}
                title="删除"
                aria-label="删除"
              >
                <TrashIcon size={13.5} />
              </button>
            </div>
          </div>
        </div>

        {/* Subtasks */}
        {hasSubtasks && isExpanded && (
          <div className="subtasks-list">
            {todo.subtasks.map((sub, sIdx) => (
              <div
                key={sub.id}
                className={`subtask-row${sub.completed ? ' completed' : ''}`}
              >
                <button
                  type="button"
                  className={`todo-checkbox${sub.completed ? ' checked' : ''}`}
                  onClick={() => toggleSubtask(todo.id, sub.id)}
                  aria-label={sub.completed ? '取消完成子任务' : '完成子任务'}
                >
                  {sub.completed && <CheckIcon size={10} strokeWidth={2.6} />}
                </button>
                {data.settings.autoNumbering && (
                  <span className="todo-index-num" style={{ fontSize: '12.5px' }}>
                    {index + 1}.{sIdx + 1}
                  </span>
                )}
                <span
                  className="subtask-title"
                  onClick={() => setEditingTodoId(todo.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {sub.title}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const scopeButtons: Array<{ id: TodoScope; label: string; dot?: boolean }> = [
    { id: 'today', label: '今天' },
    { id: 'week', label: '本周' },
    { id: 'month', label: '本月' },
    { id: 'unscheduled', label: '待安排', dot: unscheduledCount > 0 },
  ];

  return (
    <section className="todo-view" aria-label="待办视图">
      {/* Scope Bar or Dedicated List Header */}
      {isDedicatedListTab && activeListObj ? (
        <div className="todo-scope-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="list-color-dot" style={{ background: activeListObj.color, width: 10, height: 10 }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {activeListObj.name}
            </span>
            <span className="section-count-badge">{incompleteTodos.length}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => toggleListPin(activeListObj.id)}
              title={activeListObj.pinnedToSide ? '取消固定到侧边页签' : '固定到侧边页签'}
            >
              <PinIcon size={13} />
              <span>{activeListObj.pinnedToSide ? '已固定' : '固定侧边'}</span>
            </button>
            <button
              type="button"
              className="quadrant-toggle-btn"
              onClick={() => setShowQuadrant(true)}
            >
              <QuadrantIcon size={14} />
              <span>四象限</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="todo-scope-bar">
          <div className="todo-scope-tabs">
            {scopeButtons.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`scope-pill-btn${todoScope === s.id ? ' active' : ''}`}
                onClick={() => {
                  setTodoScope(s.id);
                  setSelectedListId(null);
                  setShowListMenu(false);
                }}
              >
                <span>{s.label}</span>
                {s.dot && <span className="unscheduled-dot" title={`${unscheduledCount} 条待安排`} />}
              </button>
            ))}

            {/* Lists Dropdown */}
            <div className="list-dropdown-wrap">
              <button
                type="button"
                className={`scope-pill-btn${todoScope === 'list' ? ' active' : ''}`}
                onClick={() => setShowListMenu((v) => !v)}
              >
                <span>{activeListObj ? activeListObj.name : '清单'}</span>
                <ChevronDownIcon size={13} />
              </button>

              {showListMenu && (
                <>
                  <div className="popover-backdrop" onClick={() => setShowListMenu(false)} />
                  <div className="list-dropdown-menu" role="menu">
                    {activeLists.length === 0 ? (
                      <div style={{ padding: '10px', fontSize: 12, color: 'var(--text-muted)' }}>
                        暂无自定义清单
                      </div>
                    ) : (
                      activeLists.map((list) => {
                        const count = activeTodos.filter(
                          (t) => !t.completed && t.listId === list.id,
                        ).length;
                        return (
                          <button
                            key={list.id}
                            type="button"
                            className="menu-item-btn"
                            onClick={() => {
                              setTodoScope('list');
                              setSelectedListId(list.id);
                              setShowListMenu(false);
                            }}
                          >
                            <span className="list-color-dot" style={{ background: list.color }} />
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {list.name}
                            </span>
                            <span className="menu-shortcut">{count}</span>
                          </button>
                        );
                      })
                    )}
                    <div className="menu-divider" />
                    <button
                      type="button"
                      className="menu-item-btn"
                      onClick={() => {
                        setShowListMenu(false);
                        setShowListManager(true);
                      }}
                    >
                      <ListIcon size={14} />
                      <span>管理清单与侧边固定...</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            className="quadrant-toggle-btn"
            onClick={() => setShowQuadrant(true)}
            title="切换至四象限视图"
          >
            <QuadrantIcon size={14} />
            <span>四象限</span>
          </button>
        </div>
      )}

      {/* Quick Create Input */}
      <div className="quick-add-wrapper">
        <div className="quick-add-box">
          <textarea
            ref={inputRef}
            className="quick-add-textarea"
            rows={1}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              if (nlDismissedFor && e.target.value !== nlDismissedFor) {
                setNlDismissedFor(null);
              }
            }}
            onKeyDown={handleInputKeyDown}
            onPaste={handleInputPaste}
            placeholder={placeholderText}
          />
          <button
            type="button"
            className={`quick-add-send-btn${inputText.trim() ? ' ready' : ''}`}
            onClick={() => handleSubmitTodo(true)}
            title="创建待办 (Enter)"
            aria-label="创建待办"
          >
            <SendIcon size={15} />
          </button>
        </div>

        {/* Live Smart Natural-Language Recognition Popover */}
        {showNlPopover && nlParsed && (
          <div className="nl-popover" role="region" aria-label="智能文本识别">
            <div className="nl-popover-head">
              <span className="nl-popover-head-left">
                <SparklesIcon size={13.5} />
                <span>已识别待办信息</span>
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                标题：{keepRawTitle ? nlParsed.rawTitle : nlParsed.cleanedTitle}
              </span>
            </div>

            <div className="nl-chips-row">
              {nlParsed.matchedFields.map((field, idx) => (
                <span key={`${field.kind}-${idx}`} className="nl-field-chip">
                  <strong>{field.label}</strong> {field.value}
                </span>
              ))}
            </div>

            <div className="nl-popover-actions">
              <label className="nl-keep-raw-label">
                <input
                  type="checkbox"
                  checked={keepRawTitle}
                  onChange={(e) => setKeepRawTitle(e.target.checked)}
                />
                <span>保留标题原文</span>
              </label>

              <div className="nl-btn-group">
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => setNlDismissedFor(inputText)}
                >
                  取消识别
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => handleSubmitTodo(true)}
                >
                  确认采用
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Grouped Todo List */}
      <div className="todo-scroll-area">
        {/* Incomplete Section */}
        <div>
          <button
            type="button"
            className="todo-section-header"
            onClick={() => setIncompleteOpen((v) => !v)}
          >
            {incompleteOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
            <span>未完成</span>
            <span className="section-count-badge">{incompleteTodos.length}</span>
          </button>

          {incompleteOpen && (
            <div className="todo-group-list">
              {incompleteTodos.length === 0 ? (
                <div className="empty-hint-box" style={{ padding: '20px 12px' }}>
                  {activeListObj
                    ? `「${activeListObj.name}」暂无待办，在上方输入即可快速记录`
                    : '这一时段暂无未完成待办，享受清爽专注时刻'}
                </div>
              ) : (
                incompleteTodos.map((todo, idx) => renderTodoItem(todo, idx))
              )}
            </div>
          )}
        </div>

        {/* Completed Section */}
        {completedTodos.length > 0 && (
          <div>
            <button
              type="button"
              className="todo-section-header"
              onClick={() => setCompletedOpen((v) => !v)}
            >
              {completedOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
              <span>已完成</span>
              <span className="section-count-badge">{completedTodos.length}</span>
            </button>

            {completedOpen && (
              <div className="todo-group-list">
                {completedTodos.map((todo, idx) => renderTodoItem(todo, idx))}
              </div>
            )}
          </div>
        )}

        {isDedicatedListTab && (
          <div style={{ marginTop: 8, textAlign: 'center' }}>
            <button
              type="button"
              className="text-link-btn muted"
              onClick={() => setActiveTab({ kind: 'todo' })}
            >
              返回全部待办
            </button>
          </div>
        )}
      </div>

      {/* Batch Multi-line Paste Modal */}
      {batchLines && (
        <div className="modal-overlay" onClick={() => setBatchLines(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="批量创建待办">
            <div className="modal-header">
              <h3 className="modal-title">检测到多行文本（{batchLines.length} 条）</h3>
              <button
                type="button"
                className="header-icon-btn"
                onClick={() => setBatchLines(null)}
                aria-label="关闭"
              >
                <CloseIcon size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ gap: 8 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                选择要批量拆分为独立待办的条目（自动支持智能识别日期/标签）：
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                {batchLines.map((line, idx) => (
                  <label
                    key={`${idx}-${line.slice(0, 12)}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 9px',
                      borderRadius: 8,
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={batchSelected[idx] ?? true}
                      onChange={(e) =>
                        setBatchSelected((prev) =>
                          prev.map((val, i) => (i === idx ? e.target.checked : val)),
                        )
                      }
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span style={{ flex: 1, wordBreak: 'break-word' }}>{line}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="btn btn-outline" onClick={handleMergeBatchAsSingle}>
                合并为 1 条待办
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-outline" onClick={() => setBatchLines(null)}>
                  取消
                </button>
                <button type="button" className="btn btn-primary" onClick={handleConfirmBatchCreate}>
                  <PlusIcon size={14} />
                  <span>批量创建 ({batchSelected.filter(Boolean).length})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
