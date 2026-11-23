import {
  AlarmClockIcon,
  CheckIcon,
  ChevronDownIcon,
  LayoutGridIcon,
  ListTodoIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  RepeatIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import { Frame, FramePanel } from '@/components/ui/frame';
import { InputGroup, InputGroupAddon, InputGroupTextarea } from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from '@/components/ui/menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SegmentedControl, SegmentedControlItem } from '@/components/ui/segmented-control';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
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

const PRIORITY_LABEL: Record<Exclude<TodoPriority, 'none'>, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const PRIORITY_COLOR_VAR: Record<Exclude<TodoPriority, 'none'>, string> = {
  high: 'var(--priority-high)',
  medium: 'var(--priority-medium)',
  low: 'var(--priority-low)',
};

const SORT_LABELS: Record<string, string> = {
  manual: '手动排序',
  priority: '按优先级',
  due_date: '按截止时间',
  created_at: '按创建时间',
  updated_at: '按更新时间',
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

  // Expand the first incomplete todo with subtasks on initial render for clarity
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
  }, [
    activeTodos,
    effectiveListId,
    monthRange.endKey,
    monthRange.startKey,
    todoScope,
    todayKey,
    weekRange.endKey,
    weekRange.startKey,
  ]);

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
      dueDate:
        useNl && nlParsed.dueDate !== null ? nlParsed.dueDate : defaultDueDateForCurrentScope(),
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
    ? `添加到「${activeListObj.name}」，支持自然语言识别日期与标签…`
    : todoScope === 'today'
      ? '添加今日待办，支持自然语言识别日期与标签…'
      : todoScope === 'week'
        ? '添加本周待办，支持自然语言识别日期与标签…'
        : todoScope === 'month'
          ? '添加本月待办，支持自然语言识别日期与标签…'
          : '添加待安排事项，支持自然语言识别日期与标签…';

  const sortLabel = SORT_LABELS[data.settings.sortBy] ?? '手动排序';

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

  const getNlBadgeVariant = (kind: string): 'info' | 'warning' | 'success' | 'outline' | 'secondary' => {
    if (kind === 'dueDate' || kind === 'dueTime' || kind === 'date' || kind === 'time') return 'info';
    if (kind === 'priority') return 'warning';
    if (kind === 'repeat' || kind === 'reminder') return 'success';
    if (kind === 'tag' || kind === 'tags') return 'outline';
    return 'secondary';
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
        className={cn(
          'group/todo relative px-2.5 py-2.5 transition-colors hover:bg-accent/60',
          todo.completed && 'opacity-72 hover:opacity-90',
        )}
        onTouchEnd={() => handleTouchEnd(todo.id)}
        onTouchMove={(e) => handleTouchMove(todo.id, e)}
        onTouchStart={(e) => handleTouchStart(todo.id, e)}
        style={
          translateX !== 0
            ? { transform: `translateX(${translateX}px)`, transition: 'none' }
            : undefined
        }
      >
        {/* Main Task Row — strict top alignment (items-start + h-5 first-line optical box) */}
        <div className="flex items-start gap-1.5">
          {/* Expand chevron slot */}
          <div className="flex h-5 w-4 shrink-0 items-center justify-center">
            {hasSubtasks ? (
              <button
                aria-expanded={isExpanded}
                aria-label={isExpanded ? '收起子任务' : '展开子任务'}
                className="inline-flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(todo.id);
                }}
                type="button"
              >
                <ChevronDownIcon
                  aria-hidden="true"
                  className={cn(
                    'size-3.5 transition-transform duration-150',
                    !isExpanded && '-rotate-90',
                  )}
                  strokeWidth={2}
                />
              </button>
            ) : (
              <span aria-hidden="true" className="w-4" />
            )}
          </div>

          {/* Square-rounded coss Checkbox */}
          <div className="flex h-5 shrink-0 items-center">
            <Checkbox
              aria-label={todo.completed ? '标记为未完成' : '标记为已完成'}
              checked={todo.completed}
              className={cn(
                'size-[15px] rounded-[4px]',
                todo.completed && 'opacity-80',
              )}
              onCheckedChange={() => toggleTodo(todo.id)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {/* Main content column */}
          <div
            className="min-w-0 flex-1 cursor-pointer pl-1 outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setEditingTodoId(todo.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setEditingTodoId(todo.id);
              }
            }}
            role="button"
            tabIndex={0}
          >
            {/* Line 1: Index + Priority dot + Title (strictly aligned to first line) */}
            <div className="flex items-start gap-1.5">
              {data.settings.autoNumbering && (
                <span className="inline-flex h-5 shrink-0 items-center text-[13px] font-medium text-muted-foreground tabular-nums">
                  {index + 1}.
                </span>
              )}
              {todo.priority !== 'none' && !todo.completed && (
                <span className="inline-flex h-5 shrink-0 items-center">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: PRIORITY_COLOR_VAR[todo.priority] }}
                    title={`优先级：${PRIORITY_LABEL[todo.priority]}`}
                  />
                </span>
              )}
              <span
                className={cn(
                  'min-w-0 flex-1 break-words text-[var(--font-body-size)] leading-5',
                  todo.completed
                    ? 'font-normal text-muted-foreground line-through'
                    : 'font-medium text-foreground',
                )}
              >
                {todo.title}
              </span>
            </div>

            {/* Line 2: Metadata (Reminder / Repeat / Hairline List Pill / Soft Neutral Tag Pills) */}
            {showMetaLine && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {reminderChip && (
                  <button
                    className="inline-flex cursor-pointer items-center gap-1 rounded px-0.5 text-[11px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(e) => {
                      e.stopPropagation();
                      setReminderTodoId(todo.id);
                    }}
                    title="点击修改提醒"
                    type="button"
                  >
                    <AlarmClockIcon aria-hidden="true" className="size-3 opacity-80" strokeWidth={1.85} />
                    <span className="tabular-nums">{reminderChip}</span>
                  </button>
                )}

                {repeatChip && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                    title="重复待办"
                  >
                    <RepeatIcon aria-hidden="true" className="size-3 opacity-80" strokeWidth={1.85} />
                    <span>{repeatChip}</span>
                  </span>
                )}

                {listBadge && (
                  <span className="inline-flex h-4.5 items-center gap-1.5 rounded-md border border-border bg-card px-1.5 text-[11px] font-medium text-foreground/80 shadow-2xs">
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: listBadge.color }}
                    />
                    <span className="max-w-28 truncate">{listBadge.name}</span>
                  </span>
                )}

                {todo.tags.map((tag) => (
                  <Badge
                    key={tag}
                    className="h-4.5 rounded-md px-1.5 text-[11px] font-normal text-muted-foreground"
                    size="sm"
                    variant="secondary"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Right side: slim progress + due time / overdue badge, smoothly swapping to hover actions on desktop */}
          <div className="flex h-5 shrink-0 items-center gap-2 pl-1.5">
            {hasSubtasks && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5',
                  !isMobileLayout && 'group-hover/todo:hidden',
                )}
                title={`子任务进度 ${doneSubCount}/${todo.subtasks.length}`}
              >
                <span className="h-1 w-9 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary/60 transition-[width] duration-200"
                    style={{ width: `${progressPct}%` }}
                  />
                </span>
                <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                  {progressPct}%
                </span>
              </span>
            )}

            {dueLabel &&
              (isOverdue ? (
                <Badge
                  className={cn(
                    'h-5 rounded-md px-1.5 text-[11px] font-medium tabular-nums',
                    !isMobileLayout && 'group-hover/todo:hidden',
                  )}
                  size="sm"
                  variant="error"
                >
                  {dueLabel}
                </Badge>
              ) : (
                <span
                  className={cn(
                    'text-[11.5px] font-medium text-muted-foreground tabular-nums',
                    !isMobileLayout && 'group-hover/todo:hidden',
                  )}
                >
                  {dueLabel}
                </span>
              ))}

            {!isMobileLayout && (
              <div className="hidden items-center gap-0.5 group-hover/todo:inline-flex">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label="设置提醒"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReminderTodoId(todo.id);
                        }}
                        size="icon-xs"
                        variant="ghost"
                      />
                    }
                  >
                    <AlarmClockIcon aria-hidden="true" strokeWidth={1.75} />
                  </TooltipTrigger>
                  <TooltipPopup side="top">设置提醒</TooltipPopup>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label="编辑详情"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingTodoId(todo.id);
                        }}
                        size="icon-xs"
                        variant="ghost"
                      />
                    }
                  >
                    <PencilIcon aria-hidden="true" strokeWidth={1.75} />
                  </TooltipTrigger>
                  <TooltipPopup side="top">编辑详情</TooltipPopup>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label="删除"
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTodo(todo.id);
                        }}
                        size="icon-xs"
                        variant="ghost"
                      />
                    }
                  >
                    <Trash2Icon aria-hidden="true" strokeWidth={1.75} />
                  </TooltipTrigger>
                  <TooltipPopup side="top">删除</TooltipPopup>
                </Tooltip>
              </div>
            )}
          </div>
        </div>

        {/* Clean Indented Subtasks */}
        {hasSubtasks && isExpanded && (
          <div className="mt-2 flex flex-col gap-1.5 pl-10">
            {todo.subtasks.map((sub, sIdx) => (
              <div
                key={sub.id}
                className="flex items-start gap-2 text-xs leading-4.5"
              >
                <div className="flex h-4.5 shrink-0 items-center">
                  <Checkbox
                    aria-label={sub.completed ? '取消完成子任务' : '完成子任务'}
                    checked={sub.completed}
                    className={cn(
                      'size-3.5 rounded-[3.5px]',
                      sub.completed && 'opacity-75',
                    )}
                    onCheckedChange={() => toggleSubtask(todo.id, sub.id)}
                  />
                </div>
                {data.settings.autoNumbering && (
                  <span className="inline-flex h-4.5 shrink-0 items-center text-[11.5px] text-muted-foreground/80 tabular-nums">
                    {index + 1}.{sIdx + 1}
                  </span>
                )}
                <span
                  className={cn(
                    'min-w-0 flex-1 cursor-pointer break-words leading-4.5 transition-colors hover:text-foreground',
                    sub.completed
                      ? 'text-muted-foreground/75 line-through'
                      : 'text-foreground/85',
                  )}
                  onClick={() => setEditingTodoId(todo.id)}
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
    <section
      aria-label="待办视图"
      className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-3 pb-3.5"
    >
      {/* Scope Bar or Dedicated List Header */}
      {isDedicatedListTab && activeListObj ? (
        <div className="flex shrink-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: activeListObj.color }}
            />
            <span className="truncate text-[15px] font-semibold text-foreground">
              {activeListObj.name}
            </span>
            <Badge className="tabular-nums" size="sm" variant="secondary">
              {incompleteTodos.length}
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              onClick={() => toggleListPin(activeListObj.id)}
              size="sm"
              title={activeListObj.pinnedToSide ? '取消固定到侧边页签' : '固定到侧边页签'}
              variant={activeListObj.pinnedToSide ? 'secondary' : 'outline'}
            >
              <PinIcon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
              <span className="text-xs">{activeListObj.pinnedToSide ? '已固定' : '固定侧边'}</span>
            </Button>
            <Button
              onClick={() => setShowQuadrant(true)}
              size="sm"
              title="切换至四象限视图"
              variant="outline"
            >
              <LayoutGridIcon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
              <span className="text-xs">四象限</span>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 items-center justify-between gap-2">
          <SegmentedControl
            className="min-w-0 max-w-full overflow-x-auto"
            render={<div aria-label="待办时间范围" role="navigation" />}
            size="sm"
          >
            {scopeButtons.map((s) => (
              <SegmentedControlItem
                key={s.id}
                aria-current={todoScope === s.id ? 'page' : undefined}
                className="px-2.5 aria-[current=page]:font-semibold aria-[current=page]:text-dt-accent-soft-text"
                onClick={() => {
                  setTodoScope(s.id);
                  setSelectedListId(null);
                  setShowListMenu(false);
                }}
              >
                <span>{s.label}</span>
                {s.dot && (
                  <span
                    className="-mt-2 -ml-0.5 size-1.5 shrink-0 rounded-full bg-destructive"
                    title={`${unscheduledCount} 条待安排`}
                  />
                )}
              </SegmentedControlItem>
            ))}

            {/* Lists Menu integrated into scope strip */}
            <Menu onOpenChange={setShowListMenu} open={showListMenu}>
              <MenuTrigger
                render={
                  <SegmentedControlItem
                    aria-current={todoScope === 'list' ? 'page' : undefined}
                    className="gap-1 px-2.5 aria-[current=page]:font-semibold aria-[current=page]:text-dt-accent-soft-text"
                  />
                }
              >
                <span className="max-w-20 truncate">
                  {activeListObj ? activeListObj.name : '清单'}
                </span>
                <ChevronDownIcon aria-hidden="true" className="size-3 opacity-75" strokeWidth={2} />
              </MenuTrigger>

              <MenuPopup align="start" className="w-52" side="bottom" sideOffset={6}>
                {activeLists.length === 0 ? (
                  <div className="px-2.5 py-2 text-xs text-muted-foreground">暂无自定义清单</div>
                ) : (
                  <MenuGroup>
                    {activeLists.map((list) => {
                      const count = activeTodos.filter(
                        (t) => !t.completed && t.listId === list.id,
                      ).length;
                      const isSelected = todoScope === 'list' && selectedListId === list.id;
                      return (
                        <MenuItem
                          key={list.id}
                          onClick={() => {
                            setTodoScope('list');
                            setSelectedListId(list.id);
                            setShowListMenu(false);
                          }}
                        >
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: list.color }}
                          />
                          <span className="flex-1 truncate">{list.name}</span>
                          {isSelected && (
                            <CheckIcon
                              aria-hidden="true"
                              className="size-3.5 text-dt-accent-soft-text"
                              strokeWidth={2.25}
                            />
                          )}
                          <MenuShortcut className="tabular-nums">{count}</MenuShortcut>
                        </MenuItem>
                      );
                    })}
                  </MenuGroup>
                )}
                <MenuSeparator />
                <MenuGroup>
                  <MenuItem
                    onClick={() => {
                      setShowListMenu(false);
                      setShowListManager(true);
                    }}
                  >
                    <ListTodoIcon aria-hidden="true" strokeWidth={1.75} />
                    <span>管理清单与侧边固定…</span>
                  </MenuItem>
                </MenuGroup>
              </MenuPopup>
            </Menu>
          </SegmentedControl>

          <Button
            className="shrink-0 gap-1.5 text-xs"
            onClick={() => setShowQuadrant(true)}
            size="sm"
            title="切换至四象限视图"
            variant="outline"
          >
            <LayoutGridIcon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            <span>四象限</span>
          </Button>
        </div>
      )}

      {/* Quick Create InputGroup + Live NL Recognition Strip */}
      <div className="relative shrink-0">
        <InputGroup className="rounded-xl bg-card **:[textarea]:max-h-28 **:[textarea]:min-h-9 **:[textarea]:py-2 **:[textarea]:text-[var(--font-ui-size)] **:[textarea]:leading-5">
          <InputGroupTextarea
            aria-label="添加待办"
            onChange={(e) => {
              setInputText(e.target.value);
              if (nlDismissedFor && e.target.value !== nlDismissedFor) {
                setNlDismissedFor(null);
              }
            }}
            onKeyDown={handleInputKeyDown}
            onPaste={handleInputPaste}
            placeholder={placeholderText}
            ref={inputRef}
            rows={1}
            value={inputText}
          />
          <InputGroupAddon align="inline-end" className="gap-1.5 pe-1.5 has-[>button]:me-0">
            {!isMobileLayout && (
              <Kbd
                className="h-5.5 min-w-5.5 border border-border bg-muted/80 text-[11px]"
                title="Enter 创建，Shift+Enter 换行"
              >
                ↵
              </Kbd>
            )}
            <Button
              aria-label="创建待办"
              className={cn(
                'size-7 rounded-md transition-opacity',
                !inputText.trim() && 'opacity-75 hover:opacity-100',
              )}
              onClick={() => handleSubmitTodo(true)}
              size="icon-xs"
              title="创建待办 (Enter)"
              variant="default"
            >
              <SendIcon aria-hidden="true" className="size-3.5" strokeWidth={1.85} />
            </Button>
          </InputGroupAddon>
        </InputGroup>

        {/* Live Smart Natural-Language Recognition Popover */}
        {showNlPopover && nlParsed && (
          <div
            aria-label="智能文本识别"
            className="absolute inset-x-0 top-full z-30 mt-1.5 flex flex-col gap-2.5 rounded-xl border bg-popover not-dark:bg-clip-padding p-3 text-popover-foreground shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
            role="region"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <SparklesIcon aria-hidden="true" className="size-3.5 text-dt-accent" strokeWidth={1.85} />
                <span>已识别待办信息</span>
              </span>
              <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">
                标题：{keepRawTitle ? nlParsed.rawTitle : nlParsed.cleanedTitle}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {nlParsed.matchedFields.map((field, idx) => (
                <Badge
                  key={`${field.kind}-${idx}`}
                  size="default"
                  variant={getNlBadgeVariant(field.kind)}
                >
                  <span className="font-semibold">{field.label}</span>
                  <span>{field.value}</span>
                </Badge>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
              <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                <Checkbox
                  checked={keepRawTitle}
                  className="size-3.5 rounded-[3.5px]"
                  onCheckedChange={(checked) => setKeepRawTitle(Boolean(checked))}
                />
                <span>保留标题原文</span>
              </label>

              <div className="flex items-center gap-1.5">
                <Button
                  onClick={() => setNlDismissedFor(inputText)}
                  size="xs"
                  variant="outline"
                >
                  取消识别
                </Button>
                <Button onClick={() => handleSubmitTodo(true)} size="xs" variant="default">
                  确认采用
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Grouped Todo List inside ScrollArea with Concentric Frame + FramePanel */}
      <ScrollArea className="-mx-4 min-h-0 flex-1 px-4" scrollFade>
        <div className="flex flex-col gap-3 pb-2">
          {/* Incomplete Section */}
          <Frame>
            <Collapsible onOpenChange={setIncompleteOpen} open={incompleteOpen}>
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <CollapsibleTrigger className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-0.5 py-0.5 text-xs font-semibold text-foreground/85 transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  <ChevronDownIcon
                    aria-hidden="true"
                    className={cn(
                      'size-3.5 text-muted-foreground transition-transform duration-150',
                      !incompleteOpen && '-rotate-90',
                    )}
                    strokeWidth={2}
                  />
                  <span>未完成</span>
                  <Badge
                    className="h-4.5 min-w-5 rounded-md bg-card px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums"
                    size="sm"
                    variant="outline"
                  >
                    {incompleteTodos.length}
                  </Badge>
                </CollapsibleTrigger>

                <span className="text-[11px] text-muted-foreground/80">{sortLabel}</span>
              </div>

              <CollapsiblePanel>
                <FramePanel className="overflow-hidden p-0">
                  {incompleteTodos.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                      {activeListObj
                        ? `「${activeListObj.name}」暂无待办，在上方输入即可快速记录`
                        : '这一时段暂无未完成待办，享受清爽专注时刻'}
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {incompleteTodos.map((todo, idx) => renderTodoItem(todo, idx))}
                    </div>
                  )}
                </FramePanel>
              </CollapsiblePanel>
            </Collapsible>
          </Frame>

          {/* Completed Section */}
          {completedTodos.length > 0 && (
            <Frame>
              <Collapsible onOpenChange={setCompletedOpen} open={completedOpen}>
                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                  <CollapsibleTrigger className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-0.5 py-0.5 text-xs font-semibold text-foreground/85 transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronDownIcon
                      aria-hidden="true"
                      className={cn(
                        'size-3.5 text-muted-foreground transition-transform duration-150',
                        !completedOpen && '-rotate-90',
                      )}
                      strokeWidth={2}
                    />
                    <span>已完成</span>
                    <Badge
                      className="h-4.5 min-w-5 rounded-md bg-card px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums"
                      size="sm"
                      variant="outline"
                    >
                      {completedTodos.length}
                    </Badge>
                  </CollapsibleTrigger>
                </div>

                <CollapsiblePanel>
                  <FramePanel className="overflow-hidden p-0">
                    <div className="divide-y divide-border">
                      {completedTodos.map((todo, idx) => renderTodoItem(todo, idx))}
                    </div>
                  </FramePanel>
                </CollapsiblePanel>
              </Collapsible>
            </Frame>
          )}

          {isDedicatedListTab && (
            <div className="pt-1 text-center">
              <Button
                className="text-muted-foreground"
                onClick={() => setActiveTab({ kind: 'todo' })}
                size="xs"
                variant="ghost"
              >
                返回全部待办
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Batch Multi-line Paste coss Dialog */}
      <Dialog
        onOpenChange={(open) => {
          if (!open) setBatchLines(null);
        }}
        open={Boolean(batchLines)}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              检测到多行文本（{batchLines?.length ?? 0} 条）
            </DialogTitle>
            <DialogDescription className="text-xs">
              选择要批量拆分为独立待办的条目（自动支持智能识别日期/标签）：
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="max-h-72">
            <div className="flex flex-col gap-1.5">
              {(batchLines ?? []).map((line, idx) => (
                <label
                  key={`${idx}-${line.slice(0, 12)}`}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent/50"
                >
                  <div className="flex h-5 shrink-0 items-center">
                    <Checkbox
                      checked={batchSelected[idx] ?? true}
                      onCheckedChange={(checked) =>
                        setBatchSelected((prev) =>
                          prev.map((val, i) => (i === idx ? Boolean(checked) : val)),
                        )
                      }
                    />
                  </div>
                  <span className="min-w-0 flex-1 break-words leading-5">{line}</span>
                </label>
              ))}
            </div>
          </DialogPanel>

          <DialogFooter className="justify-between">
            <Button onClick={handleMergeBatchAsSingle} size="sm" variant="outline">
              合并为 1 条待办
            </Button>
            <div className="flex items-center gap-2">
              <Button onClick={() => setBatchLines(null)} size="sm" variant="ghost">
                取消
              </Button>
              <Button onClick={handleConfirmBatchCreate} size="sm" variant="default">
                <PlusIcon aria-hidden="true" className="size-3.5" strokeWidth={2} />
                <span>批量创建 ({batchSelected.filter(Boolean).length})</span>
              </Button>
            </div>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </section>
  );
};
