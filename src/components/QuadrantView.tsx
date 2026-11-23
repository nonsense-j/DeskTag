import {
  ArrowLeftIcon,
  CornerDownLeftIcon,
  LayoutGridIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Frame, FramePanel } from '@/components/ui/frame';
import { InputPrimitive } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from '@/components/ui/menu';
import {
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RadioGroupPrimitive, RadioPrimitive } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SegmentedControl, SegmentedControlItem } from '@/components/ui/segmented-control';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
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

export interface QuadrantViewProps {
  /** When embedded inside Android's Views tab, hide the desktop back button. */
  embedded?: boolean;
}

type ScopeFilter = 'today' | 'week' | 'month' | 'all';

interface QuadrantMeta {
  id: QuadrantId;
  code: string;
  title: string;
  subtitle: string;
  dotClassName: string;
  defaultPriority: TodoPriority;
  defaultUrgent: boolean;
}

const QUADRANTS: QuadrantMeta[] = [
  {
    id: 'q1',
    code: 'Q1',
    title: '重要且紧急',
    subtitle: '立即处理',
    dotClassName: 'bg-[var(--priority-high)]',
    defaultPriority: 'high',
    defaultUrgent: true,
  },
  {
    id: 'q2',
    code: 'Q2',
    title: '重要不紧急',
    subtitle: '计划安排',
    dotClassName: 'bg-[var(--priority-medium)]',
    defaultPriority: 'high',
    defaultUrgent: false,
  },
  {
    id: 'q3',
    code: 'Q3',
    title: '紧急不重要',
    subtitle: '快速推进',
    dotClassName: 'bg-orange-500 dark:bg-orange-400',
    defaultPriority: 'low',
    defaultUrgent: true,
  },
  {
    id: 'q4',
    code: 'Q4',
    title: '不重要不紧急',
    subtitle: '有空再做',
    dotClassName: 'bg-[var(--priority-low)]',
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

const URGENT_DAY_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 0, label: '仅今天' },
  { days: 1, label: '1 天内' },
  { days: 3, label: '3 天内' },
  { days: 7, label: '7 天内' },
];

const PRIORITY_OPTIONS: Array<{ id: TodoPriority; label: string; dotClassName: string }> = [
  { id: 'high', label: '高优先级', dotClassName: 'bg-[var(--priority-high)]' },
  { id: 'medium', label: '中优先级', dotClassName: 'bg-[var(--priority-medium)]' },
  { id: 'low', label: '低优先级', dotClassName: 'bg-[var(--priority-low)]' },
];

function priorityDotClass(priority: TodoPriority): string | null {
  if (priority === 'high') return 'bg-[var(--priority-high)]';
  if (priority === 'medium') return 'bg-[var(--priority-medium)]';
  if (priority === 'low') return 'bg-[var(--priority-low)]';
  return null;
}

function isTodoOverdue(todo: TodoItem, todayKey: string): boolean {
  if (todo.completed || !todo.dueDate) return false;
  const endKey = todo.endDate && todo.endDate >= todo.dueDate ? todo.endDate : todo.dueDate;
  return endKey < todayKey;
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
    deleteTodo,
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

  // Subtle list settle on scope/filter switch (skip initial mount to avoid double-stacking with App view entrance)
  const matrixFilterKey = `${scope}:${listFilter}:${showCompleted}`;
  const initialFilterKeyRef = useRef(matrixFilterKey);
  const hasSwitchedFilterRef = useRef(false);
  if (matrixFilterKey !== initialFilterKeyRef.current) {
    hasSwitchedFilterRef.current = true;
  }
  const animateFilterSwitch = hasSwitchedFilterRef.current;

  const now = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => getTodayKey(now), [now]);
  const weekRange = useMemo(() => getWeekRange(now), [now]);
  const monthRange = useMemo(() => getMonthRange(now.getFullYear(), now.getMonth() + 1), [now]);

  const listSelectItems = useMemo(
    () => [
      { label: '全部清单', value: 'all', color: null as string | null },
      { label: '普通待办', value: '__none__', color: null as string | null },
      ...activeLists.map((l) => ({ label: l.name, value: l.id, color: l.color })),
    ],
    [activeLists],
  );

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

  const handleDeleteTodo = (todoId: string) => {
    deleteTodo(todoId);
    showToast('已删除待办');
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
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* Compact Single-Row Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-background px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {!embedded && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="返回待办"
                    onClick={() => setShowQuadrant(false)}
                    size="icon-sm"
                    variant="outline"
                  />
                }
              >
                <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="bottom">返回待办</TooltipPopup>
            </Tooltip>
          )}

          <SegmentedControl
            render={
              <RadioGroupPrimitive
                aria-label="四象限时间范围"
                onValueChange={(value) => {
                  if (
                    value === 'today' ||
                    value === 'week' ||
                    value === 'month' ||
                    value === 'all'
                  ) {
                    handleScopeChange(value);
                  }
                }}
                value={scope}
              />
            }
            size="sm"
          >
            {SCOPE_OPTIONS.map((opt) => (
              <SegmentedControlItem
                key={opt.id}
                render={<RadioPrimitive.Root value={opt.id} />}
              >
                {opt.label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Select
            items={listSelectItems}
            onValueChange={(val) => {
              if (typeof val === 'string') setListFilter(val);
            }}
            value={listFilter}
          >
            <SelectTrigger
              aria-label="按清单筛选"
              className="w-auto min-w-[90px] max-w-[132px]"
              size="sm"
            >
              <SelectValue placeholder="全部清单" />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {listSelectItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    {item.color && (
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                    )}
                    <span className="truncate">{item.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>

          <Popover onOpenChange={setShowRulesPopover} open={showRulesPopover}>
            <PopoverTrigger
              render={
                <Button
                  aria-label="显示选项与归类规则"
                  className="relative"
                  size="icon-sm"
                  title="显示与归类规则"
                  variant={showRulesPopover ? 'secondary' : 'outline'}
                />
              }
            >
              <SlidersHorizontalIcon aria-hidden="true" className="size-3.5" />
              {!showCompleted && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 size-1.5 rounded-full bg-dt-accent"
                />
              )}
            </PopoverTrigger>

            <PopoverPopup align="end" className="w-72" sideOffset={6}>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-1.5">
                  <LayoutGridIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  <PopoverTitle className="text-sm">四象限设置与归类规则</PopoverTitle>
                </div>

                {/* Show Completed Switch */}
                <Label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg bg-muted/60 px-2.5 py-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-xs text-foreground">含已完成待办</span>
                    <span className="font-normal text-[11px] text-muted-foreground">
                      在象限矩阵中保留已勾选任务
                    </span>
                  </div>
                  <Switch
                    checked={showCompleted}
                    onCheckedChange={(checked) => setShowCompleted(checked)}
                  />
                </Label>

                <Separator />

                {/* Urgency Threshold */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-medium text-xs text-foreground">「紧急」判定</span>
                  <span className="text-[11px] text-muted-foreground">
                    截止日期在未来 N 天内（含已逾期任务）
                  </span>
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    {URGENT_DAY_OPTIONS.map((opt) => {
                      const active = rules.urgentWithinDays === opt.days;
                      return (
                        <Button
                          key={opt.days}
                          onClick={() => handleUrgentDaysChange(opt.days)}
                          size="xs"
                          variant={active ? 'default' : 'outline'}
                        >
                          {opt.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                {/* Importance Priority Checklist */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-medium text-xs text-foreground">「重要」判定</span>
                  <span className="text-[11px] text-muted-foreground">包含以下优先级的待办</span>
                  <div className="mt-0.5 flex flex-col gap-1">
                    {PRIORITY_OPTIONS.map((p) => {
                      const checked = rules.importantPriorities.includes(p.id);
                      return (
                        <Label
                          key={p.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-accent"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => handleToggleImportantPriority(p.id)}
                          />
                          <span className={cn('size-2 shrink-0 rounded-full', p.dotClassName)} />
                          <span className="font-normal text-foreground">{p.label}</span>
                        </Label>
                      );
                    })}
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>拖拽或菜单移动将手动固定象限</span>
                  {overriddenCount > 0 && (
                    <Button
                      className="shrink-0"
                      onClick={handleResetOverrides}
                      size="xs"
                      variant="ghost"
                    >
                      <RotateCcwIcon aria-hidden="true" className="size-3" />
                      <span>重置 ({overriddenCount})</span>
                    </Button>
                  )}
                </div>
              </div>
            </PopoverPopup>
          </Popover>
        </div>
      </div>

      {/* 2x2 Concentric Frame Quadrant Matrix */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        <div
          className={cn(
            'grid gap-2.5',
            isMobileLayout
              ? 'grid-cols-1 auto-rows-[minmax(200px,auto)]'
              : 'min-h-full grid-cols-2 auto-rows-[minmax(220px,1fr)]',
          )}
        >
          {QUADRANTS.map((qMeta) => {
            const items = grouped[qMeta.id];
            const pendingCount = items.filter((t) => !t.completed).length;
            const isDropTarget = dragOverQuadrant === qMeta.id;
            const quickValue = quickInputs[qMeta.id];

            return (
              <Frame
                key={qMeta.id}
                aria-label={qMeta.title}
                className={cn(
                  'min-h-0 transition-[background-color,border-color,box-shadow] duration-[120ms] ease-[var(--dt-ease)]',
                  isDropTarget && 'border-dt-accent/50 bg-dt-accent-soft/55 ring-2 ring-dt-accent/25',
                )}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    if (dragOverQuadrant === qMeta.id) {
                      setDragOverQuadrant(null);
                    }
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverQuadrant !== qMeta.id) {
                    setDragOverQuadrant(qMeta.id);
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
                role="region"
              >
                {/* Quadrant Outer Frame Header */}
                <div className="flex shrink-0 items-center justify-between gap-1.5 px-2.5 py-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={cn('size-2 shrink-0 rounded-full', qMeta.dotClassName)} />
                    <span className="truncate font-semibold text-xs text-foreground">
                      {qMeta.title}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {qMeta.subtitle}
                    </span>
                  </div>
                  <Badge
                    className="bg-background/85 font-medium text-muted-foreground tabular-nums"
                    size="sm"
                    variant="outline"
                  >
                    {pendingCount}
                  </Badge>
                </div>

                {/* Inner FramePanel: Scrollable Task List + Bottom Inline Quick Add */}
                <FramePanel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
                  <ScrollArea
                    className="min-h-0 flex-1 [&_[data-slot=scroll-area-content]]:flex [&_[data-slot=scroll-area-content]]:min-h-full [&_[data-slot=scroll-area-content]]:flex-col"
                    scrollFade
                  >
                    {items.length === 0 ? (
                      <div
                        key={matrixFilterKey}
                        className={cn(
                          'flex min-h-[110px] flex-1 flex-col items-center justify-center px-3 py-6 text-center text-muted-foreground/75 text-xs',
                          animateFilterSwitch && 'dt-view-enter',
                        )}
                      >
                        <span>暂无待办 · 拖拽至此或下方添加</span>
                      </div>
                    ) : (
                      <div
                        key={matrixFilterKey}
                        className={cn(
                          'divide-y divide-border/70',
                          animateFilterSwitch && 'dt-view-enter',
                        )}
                      >
                        {items.map((todo) => {
                          const pDotClass = priorityDotClass(todo.priority);
                          const dueLabel = formatShortDueDate(todo.dueDate, todo.dueTime, now);
                          const overdue = isTodoOverdue(todo, todayKey);
                          const subTotal = todo.subtasks.length;
                          const subDone = todo.subtasks.filter((s) => s.completed).length;
                          const hasMetaRow =
                            todo.tags.length > 0 || subTotal > 0 || Boolean(dueLabel);

                          return (
                            <div
                              key={todo.id}
                              className={cn(
                                'group relative flex cursor-grab flex-col gap-1.5 px-2.5 py-2 transition-[background-color,opacity,transform] duration-[120ms] ease-[var(--dt-ease)] hover:bg-accent/60 active:cursor-grabbing',
                                draggedTodoId === todo.id && 'scale-[0.985] bg-accent opacity-50',
                              )}
                              draggable
                              onDragEnd={() => {
                                setDraggedTodoId(null);
                                setDragOverQuadrant(null);
                              }}
                              onDragStart={(e) => {
                                setDraggedTodoId(todo.id);
                                e.dataTransfer.setData('text/plain', todo.id);
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                            >
                              {/* Top Line: Top-Aligned Checkbox + Priority Dot + Readable 2-Line Title + Hover Menu */}
                              <div className="flex min-w-0 items-start gap-1.5">
                                <div
                                  className="mt-0.5 shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Checkbox
                                    aria-label={todo.completed ? '标记未完成' : '标记完成'}
                                    checked={todo.completed}
                                    className="size-3.5"
                                    onCheckedChange={() => toggleTodo(todo.id)}
                                  />
                                </div>

                                {pDotClass && (
                                  <span
                                    aria-hidden="true"
                                    className={cn(
                                      'mt-[7px] size-1.5 shrink-0 rounded-full',
                                      pDotClass,
                                      todo.completed && 'opacity-50',
                                    )}
                                  />
                                )}

                                <button
                                  className={cn(
                                    'line-clamp-2 min-w-0 flex-1 break-words text-left text-[12.5px] leading-[1.45] transition-colors',
                                    todo.completed
                                      ? 'text-muted-foreground/70 line-through'
                                      : 'font-medium text-foreground',
                                  )}
                                  onClick={() => setEditingTodoId(todo.id)}
                                  title={todo.title}
                                  type="button"
                                >
                                  {todo.title}
                                </button>

                                <Menu>
                                  <MenuTrigger
                                    render={
                                      <Button
                                        aria-label="更多操作"
                                        className="-mt-0.5 -me-1 size-5.5 shrink-0 text-muted-foreground opacity-45 transition-opacity hover:text-foreground group-focus-within:opacity-100 group-hover:opacity-100 data-popup-open:bg-accent data-popup-open:text-foreground data-popup-open:opacity-100 pointer-coarse:opacity-100"
                                        onClick={(e) => e.stopPropagation()}
                                        size="icon-xs"
                                        variant="ghost"
                                      />
                                    }
                                  >
                                    <MoreHorizontalIcon aria-hidden="true" className="size-3.5" />
                                  </MenuTrigger>
                                  <MenuPopup align="end" className="w-40" sideOffset={4}>
                                    <MenuGroup>
                                      <MenuGroupLabel>移动象限</MenuGroupLabel>
                                      {QUADRANTS.filter((other) => other.id !== qMeta.id).map(
                                        (other) => (
                                          <MenuItem
                                            key={other.id}
                                            onClick={() => handleMoveToQuadrant(todo.id, other.id)}
                                          >
                                            <span
                                              aria-hidden="true"
                                              className={cn(
                                                'size-2 shrink-0 rounded-full',
                                                other.dotClassName,
                                              )}
                                            />
                                            <span className="truncate text-xs">{other.title}</span>
                                            <MenuShortcut>{other.code}</MenuShortcut>
                                          </MenuItem>
                                        ),
                                      )}
                                    </MenuGroup>
                                    <MenuSeparator />
                                    <MenuItem onClick={() => setEditingTodoId(todo.id)}>
                                      <PencilIcon aria-hidden="true" className="size-3.5" />
                                      <span className="text-xs">编辑详情</span>
                                    </MenuItem>
                                    <MenuItem
                                      onClick={() => handleDeleteTodo(todo.id)}
                                      variant="destructive"
                                    >
                                      <Trash2Icon aria-hidden="true" className="size-3.5" />
                                      <span className="text-xs">删除</span>
                                    </MenuItem>
                                  </MenuPopup>
                                </Menu>
                              </div>

                              {/* Bottom Metadata Row: Compact Tags + Progress % + Due Time / Overdue Badge */}
                              {hasMetaRow && (
                                <div className="flex min-w-0 items-center justify-between gap-1.5 ps-5">
                                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                                    {todo.tags.slice(0, 2).map((tag) => (
                                      <Badge
                                        key={tag}
                                        className="max-w-[76px] truncate font-normal text-muted-foreground"
                                        size="sm"
                                        variant="secondary"
                                      >
                                        {tag}
                                      </Badge>
                                    ))}
                                    {todo.tags.length > 2 && (
                                      <span className="text-[10px] text-muted-foreground/75">
                                        +{todo.tags.length - 2}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex shrink-0 items-center gap-1.5">
                                    {subTotal > 0 && (
                                      <span className="font-medium text-[10.5px] text-muted-foreground tabular-nums">
                                        {Math.round((subDone / subTotal) * 100)}%
                                      </span>
                                    )}
                                    {dueLabel &&
                                      (overdue ? (
                                        <Badge
                                          className="tabular-nums"
                                          size="sm"
                                          variant="error"
                                        >
                                          {dueLabel}
                                        </Badge>
                                      ) : (
                                        <span className="text-[10.5px] text-muted-foreground tabular-nums">
                                          {dueLabel}
                                        </span>
                                      ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>

                  {/* Bottom Inline Quick Add */}
                  <div className="flex shrink-0 items-center gap-1.5 border-t bg-card px-2.5 py-1.5">
                    <PlusIcon
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-muted-foreground/75"
                    />
                    <InputPrimitive
                      aria-label={`添加至${qMeta.title}`}
                      className="h-6 min-w-0 flex-1 bg-transparent text-foreground text-xs outline-none placeholder:text-muted-foreground/70"
                      onChange={(e) =>
                        setQuickInputs((prev) => ({ ...prev, [qMeta.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          handleQuickAdd(qMeta);
                        }
                      }}
                      placeholder={`添加至${qMeta.title}…`}
                      type="text"
                      value={quickValue}
                    />
                    {quickValue.trim().length > 0 && (
                      <Button
                        aria-label="确认添加"
                        className="dt-pop-in size-5.5 shrink-0"
                        onClick={() => handleQuickAdd(qMeta)}
                        size="icon-xs"
                        variant="ghost"
                      >
                        <CornerDownLeftIcon aria-hidden="true" className="size-3" />
                      </Button>
                    )}
                  </div>
                </FramePanel>
              </Frame>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default QuadrantView;
