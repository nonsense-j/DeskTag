import React, { useMemo, useState } from 'react';
import { useDeskTagStore } from '../store/useDeskTagStore';
import type { QuadrantId, TodoItem, TodoPriority } from '../types/models';
import {
  formatDateKey,
  formatShortDueDate,
  getMonthRange,
  getTodayKey,
  getWeekRange,
} from '../utils/lunar';
import { classifyTodoQuadrant } from '../utils/recurrence';
import {
  ArrowLeftIcon,
  CheckIcon,
  FilterIcon,
  PlusIcon,
  QuadrantIcon,
} from './Icons';

export interface QuadrantViewProps {
  /** When embedded inside Android's Views tab, hide the desktop "< 返回待办" button. */
  embedded?: boolean;
}

type ScopeFilter = 'today' | 'week' | 'month' | 'all';

interface QuadrantMeta {
  id: QuadrantId;
  code: string;
  title: string;
  subtitle: string;
  dotColor: string;
  tintBg: string;
  defaultPriority: TodoPriority;
  defaultUrgent: boolean;
}

const QUADRANTS: QuadrantMeta[] = [
  {
    id: 'q1',
    code: 'Q1',
    title: '重要且紧急',
    subtitle: '立即处理',
    dotColor: 'var(--priority-high)',
    tintBg: 'rgba(224, 85, 82, 0.08)',
    defaultPriority: 'high',
    defaultUrgent: true,
  },
  {
    id: 'q2',
    code: 'Q2',
    title: '重要不紧急',
    subtitle: '计划安排',
    dotColor: 'var(--priority-medium)',
    tintBg: 'rgba(212, 167, 65, 0.08)',
    defaultPriority: 'high',
    defaultUrgent: false,
  },
  {
    id: 'q3',
    code: 'Q3',
    title: '紧急不重要',
    subtitle: '快速推进',
    dotColor: 'var(--accent)',
    tintBg: 'rgba(232, 115, 75, 0.07)',
    defaultPriority: 'low',
    defaultUrgent: true,
  },
  {
    id: 'q4',
    code: 'Q4',
    title: '不重要不紧急',
    subtitle: '有空再做',
    dotColor: 'var(--priority-low)',
    tintBg: 'rgba(105, 152, 99, 0.07)',
    defaultPriority: 'none',
    defaultUrgent: false,
  },
];

const SCOPE_OPTIONS: Array<{ id: ScopeFilter; label: string }> = [
  { id: 'today', label: '今天' },
  { id: 'week', label: '本周' },
  { id: 'month', label: '本月' },
  { id: 'all', label: '全部' },
];

const PRIORITY_OPTIONS: Array<{ id: TodoPriority; label: string; color: string }> = [
  { id: 'high', label: '高优先级', color: 'var(--priority-high)' },
  { id: 'medium', label: '中优先级', color: 'var(--priority-medium)' },
  { id: 'low', label: '低优先级', color: 'var(--priority-low)' },
];

function priorityColor(priority: TodoPriority): string | null {
  if (priority === 'high') return 'var(--priority-high)';
  if (priority === 'medium') return 'var(--priority-medium)';
  if (priority === 'low') return 'var(--priority-low)';
  return null;
}

export const QuadrantView: React.FC<QuadrantViewProps> = ({ embedded = false }) => {
  const {
    data,
    activeTodos,
    activeLists,
    isMobileLayout,
    setShowQuadrant,
    setEditingTodoId,
    addTodo,
    updateTodo,
    toggleTodo,
    updateSyncedSettings,
    showToast,
  } = useDeskTagStore();

  const rules = data.settings.quadrantRules;
  const initialScope: ScopeFilter =
    rules.scope === 'today' || rules.scope === 'week' || rules.scope === 'month' || rules.scope === 'all'
      ? rules.scope
      : 'all';

  const [scope, setScope] = useState<ScopeFilter>(initialScope);
  const [listFilter, setListFilter] = useState<string>('all');
  const [showCompleted, setShowCompleted] = useState<boolean>(true);
  const [showRulesPopover, setShowRulesPopover] = useState<boolean>(false);
  const [quickInputs, setQuickInputs] = useState<Record<QuadrantId, string>>({
    q1: '',
    q2: '',
    q3: '',
    q4: '',
  });
  const [draggedTodoId, setDraggedTodoId] = useState<string | null>(null);
  const [dragOverQuadrant, setDragOverQuadrant] = useState<QuadrantId | null>(null);

  const now = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => getTodayKey(now), [now]);
  const weekRange = useMemo(() => getWeekRange(now), [now]);
  const monthRange = useMemo(() => getMonthRange(now.getFullYear(), now.getMonth() + 1), [now]);

  const handleScopeChange = (nextScope: ScopeFilter) => {
    setScope(nextScope);
    updateSyncedSettings({
      quadrantRules: {
        ...rules,
        scope: nextScope,
      },
    });
  };

  const filteredTodos = useMemo(() => {
    return activeTodos.filter((t) => {
      if (!showCompleted && t.completed) return false;
      if (listFilter !== 'all') {
        if (listFilter === '__none__') {
          if (t.listId !== null) return false;
        } else if (t.listId !== listFilter) {
          return false;
        }
      }
      if (scope === 'all') return true;
      if (!t.dueDate) return false;
      const endKey = t.endDate && t.endDate >= t.dueDate ? t.endDate : t.dueDate;
      if (scope === 'today') {
        return t.dueDate <= todayKey && endKey >= todayKey;
      }
      if (scope === 'week') {
        return t.dueDate <= weekRange.endKey && endKey >= weekRange.startKey;
      }
      // month
      return t.dueDate <= monthRange.endKey && endKey >= monthRange.startKey;
    });
  }, [activeTodos, showCompleted, listFilter, scope, todayKey, weekRange, monthRange]);

  const grouped = useMemo(() => {
    const map: Record<QuadrantId, TodoItem[]> = { q1: [], q2: [], q3: [], q4: [] };
    for (const todo of filteredTodos) {
      const q = classifyTodoQuadrant(todo, rules, now);
      map[q].push(todo);
    }
    const prioWeight: Record<TodoPriority, number> = { high: 3, medium: 2, low: 1, none: 0 };
    for (const q of ['q1', 'q2', 'q3', 'q4'] as QuadrantId[]) {
      map[q].sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        if (prioWeight[b.priority] !== prioWeight[a.priority]) {
          return prioWeight[b.priority] - prioWeight[a.priority];
        }
        return (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99');
      });
    }
    return map;
  }, [filteredTodos, rules, now]);

  const overriddenCount = useMemo(
    () => activeTodos.filter((t) => t.quadrantOverride !== null).length,
    [activeTodos],
  );

  const handleQuickAdd = (qMeta: QuadrantMeta) => {
    const text = quickInputs[qMeta.id].trim();
    if (!text) return;
    const dueDate =
      qMeta.defaultUrgent || scope === 'today'
        ? todayKey
        : scope === 'week'
          ? weekRange.endKey
          : scope === 'month'
            ? formatDateKey(now)
            : null;
    addTodo({
      title: text,
      priority: qMeta.defaultPriority,
      dueDate,
      listId: listFilter !== 'all' && listFilter !== '__none__' ? listFilter : null,
      quadrantOverride: qMeta.id,
    });
    setQuickInputs((prev) => ({ ...prev, [qMeta.id]: '' }));
  };

  const handleMoveToQuadrant = (todoId: string, target: QuadrantId) => {
    updateTodo(todoId, { quadrantOverride: target });
  };

  const handleToggleImportantPriority = (prio: TodoPriority) => {
    const exists = rules.importantPriorities.includes(prio);
    const next = exists
      ? rules.importantPriorities.filter((p) => p !== prio)
      : [...rules.importantPriorities, prio];
    updateSyncedSettings({
      quadrantRules: {
        ...rules,
        importantPriorities: next,
      },
    });
  };

  const handleUrgentDaysChange = (days: number) => {
    updateSyncedSettings({
      quadrantRules: {
        ...rules,
        urgentWithinDays: Math.max(0, Math.min(30, days)),
      },
    });
  };

  const handleResetOverrides = () => {
    for (const todo of activeTodos) {
      if (todo.quadrantOverride !== null) {
        updateTodo(todo.id, { quadrantOverride: null });
      }
    }
    showToast('已重置所有手动象限归类');
  };

  return (
    <div
      className="dt-quadrant-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-panel)',
        color: 'var(--text-primary)',
      }}
    >
      {/* Header Toolbar */}
      <div
        className="dt-quadrant-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          padding: '10px 14px 8px',
          borderBottom: '1px solid var(--border)',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {!embedded && (
            <button
              type="button"
              onClick={() => setShowQuadrant(false)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 9px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
                fontSize: 'calc(var(--font-ui-size) - 1px)',
                cursor: 'pointer',
              }}
            >
              <ArrowLeftIcon size={13} />
              <span>返回待办</span>
            </button>
          )}

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {SCOPE_OPTIONS.map((opt) => {
              const active = scope === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleScopeChange(opt.id)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: 'none',
                    background: active ? 'var(--pill-active-bg)' : 'transparent',
                    color: active ? 'var(--pill-active-text)' : 'var(--text-secondary)',
                    fontWeight: active ? 600 : 500,
                    fontSize: 'var(--font-ui-size)',
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <select
            aria-label="按清单筛选"
            value={listFilter}
            onChange={(e) => setListFilter(e.target.value)}
            style={{
              padding: '3px 8px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
              fontSize: 'calc(var(--font-ui-size) - 1px)',
              cursor: 'pointer',
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
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            style={{
              padding: '4px 8px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: showCompleted ? 'var(--bg-surface)' : 'var(--accent-soft)',
              color: showCompleted ? 'var(--text-secondary)' : 'var(--accent-soft-text)',
              fontSize: 'calc(var(--font-ui-size) - 1px)',
              cursor: 'pointer',
            }}
          >
            {showCompleted ? '含已完成' : '仅未完成'}
          </button>

          <button
            type="button"
            onClick={() => setShowRulesPopover((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 9px',
              borderRadius: 8,
              border: `1px solid ${showRulesPopover ? 'var(--accent-border)' : 'var(--border)'}`,
              background: showRulesPopover ? 'var(--accent-soft)' : 'var(--bg-surface)',
              color: showRulesPopover ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
              fontSize: 'calc(var(--font-ui-size) - 1px)',
              cursor: 'pointer',
            }}
          >
            <FilterIcon size={13} />
            <span>归类规则</span>
          </button>

          {showRulesPopover && (
            <div
              className="dt-popover"
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                width: 264,
                padding: 12,
                borderRadius: 12,
                background: 'var(--bg-popover)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-popover)',
                zIndex: 40,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <QuadrantIcon size={14} />
                  <span>四象限自动归类规则</span>
                </strong>
                <button
                  type="button"
                  onClick={() => setShowRulesPopover(false)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: 15,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>

              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 5 }}>
                  「紧急」判定：截止日期在未来 N 天内（含逾期）
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {[
                    { d: 0, label: '仅今天' },
                    { d: 1, label: '1 天内' },
                    { d: 3, label: '3 天内' },
                    { d: 7, label: '7 天内' },
                  ].map((opt) => {
                    const active = rules.urgentWithinDays === opt.d;
                    return (
                      <button
                        key={opt.d}
                        type="button"
                        onClick={() => handleUrgentDaysChange(opt.d)}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 999,
                          border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
                          background: active ? 'var(--accent-soft)' : 'var(--bg-surface)',
                          color: active ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 5 }}>
                  「重要」判定：包含以下优先级
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {PRIORITY_OPTIONS.map((p) => {
                    const checked = rules.importantPriorities.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 7,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleImportantPriority(p.id)}
                        />
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: p.color,
                            display: 'inline-block',
                          }}
                        />
                        <span>{p.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  borderTop: '1px solid var(--border)',
                  paddingTop: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                }}
              >
                <span>拖拽或快捷移动将手动固定象限</span>
                {overriddenCount > 0 && (
                  <button
                    type="button"
                    onClick={handleResetOverrides}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--accent)',
                      fontSize: 11,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    重置 ({overriddenCount})
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2x2 Quadrant Grid */}
      <div
        className="dt-quadrant-grid"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 12,
          display: 'grid',
          gridTemplateColumns: isMobileLayout ? '1fr' : 'repeat(2, minmax(0, 1fr))',
          gridAutoRows: isMobileLayout ? 'minmax(190px, auto)' : 'minmax(220px, 1fr)',
          gap: 10,
        }}
      >
        {QUADRANTS.map((qMeta) => {
          const items = grouped[qMeta.id];
          const pendingCount = items.filter((t) => !t.completed).length;
          const isDropTarget = dragOverQuadrant === qMeta.id;

          return (
            <section
              key={qMeta.id}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOverQuadrant !== qMeta.id) {
                  setDragOverQuadrant(qMeta.id);
                }
              }}
              onDragLeave={() => {
                if (dragOverQuadrant === qMeta.id) {
                  setDragOverQuadrant(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const droppedId = e.dataTransfer.getData('text/plain') || draggedTodoId;
                setDragOverQuadrant(null);
                setDraggedTodoId(null);
                if (droppedId) {
                  handleMoveToQuadrant(droppedId, qMeta.id);
                }
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                borderRadius: 12,
                background: 'var(--bg-card)',
                border: isDropTarget ? '1.5px dashed var(--accent)' : '1px solid var(--border)',
                boxShadow: isDropTarget ? '0 0 0 3px var(--accent-soft)' : 'none',
                overflow: 'hidden',
                transition: 'border-color 140ms ease, box-shadow 140ms ease',
              }}
            >
              {/* Quadrant Card Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 11px',
                  background: qMeta.tintBg,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: qMeta.dotColor,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{qMeta.title}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{qMeta.subtitle}</span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '1px 7px',
                    borderRadius: 999,
                    background: 'var(--bg-surface)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {pendingCount}
                </span>
              </div>

              {/* Inline Quick Add */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 9px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--bg-surface)',
                }}
              >
                <PlusIcon size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                  type="text"
                  value={quickInputs[qMeta.id]}
                  onChange={(e) =>
                    setQuickInputs((prev) => ({ ...prev, [qMeta.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleQuickAdd(qMeta);
                    }
                  }}
                  placeholder={`添加到${qMeta.title}…`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                  }}
                />
              </div>

              {/* Task Items */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  padding: '6px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {items.length === 0 ? (
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      padding: 16,
                    }}
                  >
                    暂无待办 · 可拖拽任务到此处
                  </div>
                ) : (
                  items.map((todo) => {
                    const pColor = priorityColor(todo.priority);
                    const dueLabel = formatShortDueDate(todo.dueDate, todo.dueTime, now);
                    const subTotal = todo.subtasks.length;
                    const subDone = todo.subtasks.filter((s) => s.completed).length;

                    return (
                      <div
                        key={todo.id}
                        draggable
                        onDragStart={(e) => {
                          setDraggedTodoId(todo.id);
                          e.dataTransfer.setData('text/plain', todo.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          setDraggedTodoId(null);
                          setDragOverQuadrant(null);
                        }}
                        className="dt-quadrant-task"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          padding: '6px 7px',
                          borderRadius: 8,
                          background: draggedTodoId === todo.id ? 'var(--accent-soft)' : 'var(--bg-surface)',
                          border: '1px solid transparent',
                          cursor: 'grab',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <button
                            type="button"
                            aria-label={todo.completed ? '标记未完成' : '标记完成'}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTodo(todo.id);
                            }}
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              border: todo.completed ? 'none' : '1.5px solid var(--border-strong)',
                              background: todo.completed ? 'var(--text-muted)' : 'transparent',
                              color: '#ffffff',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: 0,
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            {todo.completed && <CheckIcon size={10} />}
                          </button>

                          {pColor && (
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: pColor,
                                flexShrink: 0,
                              }}
                            />
                          )}

                          <button
                            type="button"
                            onClick={() => setEditingTodoId(todo.id)}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              textAlign: 'left',
                              border: 'none',
                              background: 'transparent',
                              padding: 0,
                              color: todo.completed ? 'var(--text-completed)' : 'var(--text-primary)',
                              fontSize: 'calc(var(--font-body-size) - 1px)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              cursor: 'pointer',
                            }}
                            title={todo.title}
                          >
                            {todo.title}
                          </button>

                          {subTotal > 0 && (
                            <span
                              style={{
                                fontSize: 10,
                                padding: '0 5px',
                                borderRadius: 999,
                                border: '1px solid var(--progress-border)',
                                background: 'var(--progress-fill)',
                                color: 'var(--progress-text)',
                                flexShrink: 0,
                              }}
                            >
                              {Math.round((subDone / subTotal) * 100)}%
                            </span>
                          )}

                          {dueLabel && (
                            <span
                              style={{
                                fontSize: 11,
                                color: 'var(--text-muted)',
                                flexShrink: 0,
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {dueLabel}
                            </span>
                          )}
                        </div>

                        {/* Quick-move Quadrant Pills */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingLeft: 22,
                            gap: 4,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                            {todo.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                style={{
                                  fontSize: 10,
                                  padding: '0 5px',
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
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                            {QUADRANTS.filter((other) => other.id !== qMeta.id).map((other) => (
                              <button
                                key={other.id}
                                type="button"
                                title={`移动到 ${other.title}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveToQuadrant(todo.id, other.id);
                                }}
                                style={{
                                  padding: '1px 4px',
                                  borderRadius: 4,
                                  border: '1px solid var(--border)',
                                  background: 'transparent',
                                  color: 'var(--text-muted)',
                                  fontSize: 10,
                                  cursor: 'pointer',
                                  lineHeight: 1.2,
                                }}
                              >
                                {other.code}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default QuadrantView;
