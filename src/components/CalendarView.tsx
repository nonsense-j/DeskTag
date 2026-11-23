import {
  CalendarDaysIcon,
  CalendarPlusIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  DownloadIcon,
  FileCodeIcon,
  FileJsonIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FilterIcon,
  InboxIcon,
  MinusIcon,
  PinIcon,
  PlusIcon,
  PrinterIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Drawer,
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Frame, FramePanel } from '@/components/ui/frame';
import { Group, GroupSeparator } from '@/components/ui/group';
import { Input, InputPrimitive } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
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
import { isTauriRuntime } from '../api/tauri';
import { useDeskTagStore } from '../store/useDeskTagStore';
import type { TodoItem, TodoList, TodoPriority } from '../types/models';
import {
  exportDeskTagDocument,
  triggerBrowserDownload,
  type ClientExportFormat,
} from '../utils/exporter';
import {
  WEEKDAY_LABELS,
  addDays,
  diffDays,
  formatDateKey,
  formatWeekRangeLabel,
  getMonthGrid,
  getTodayKey,
  getWeekRange,
  pad2,
  parseDateKey,
  solarToLunar,
} from '../utils/lunar';

export interface CalendarViewProps {
  standalone?: boolean;
}

type CalendarMode = 'day' | 'week' | 'month';
type DrawerKind = 'unscheduled' | 'overdue' | null;
type CalendarExportFormat = ClientExportFormat | 'json' | 'ics';

interface WeekSpanSegment {
  todo: TodoItem;
  startCol: number; // 0..6
  endCol: number; // 0..6
  totalDays: number;
  clippedLeft: boolean;
  clippedRight: boolean;
}

const PRIORITY_FILTER_ITEMS: Array<{ label: string; value: TodoPriority | 'all' }> = [
  { label: '全部优先级', value: 'all' },
  { label: '高优先级', value: 'high' },
  { label: '中优先级', value: 'medium' },
  { label: '低优先级', value: 'low' },
  { label: '无优先级', value: 'none' },
];

function priorityDotClass(priority: TodoPriority): string | null {
  if (priority === 'high') return 'bg-[var(--priority-high)]';
  if (priority === 'medium') return 'bg-[var(--priority-medium)]';
  if (priority === 'low') return 'bg-[var(--priority-low)]';
  return null;
}

function getSpanTone(priority: TodoPriority): {
  pillClass: string;
  dotClass: string;
  badgeVariant: BadgeProps['variant'];
} {
  if (priority === 'high') {
    return {
      pillClass:
        'border-destructive/25 bg-destructive/8 hover:bg-destructive/12 dark:border-destructive/30 dark:bg-destructive/15 dark:hover:bg-destructive/20',
      dotClass: 'bg-[var(--priority-high)]',
      badgeVariant: 'error',
    };
  }
  if (priority === 'medium') {
    return {
      pillClass:
        'border-warning/30 bg-warning/10 hover:bg-warning/15 dark:border-warning/30 dark:bg-warning/15 dark:hover:bg-warning/20',
      dotClass: 'bg-[var(--priority-medium)]',
      badgeVariant: 'warning',
    };
  }
  if (priority === 'low') {
    return {
      pillClass:
        'border-success/25 bg-success/8 hover:bg-success/12 dark:border-success/30 dark:bg-success/15 dark:hover:bg-success/20',
      dotClass: 'bg-[var(--priority-low)]',
      badgeVariant: 'success',
    };
  }
  return {
    pillClass:
      'border-info/25 bg-info/8 hover:bg-info/12 dark:border-info/30 dark:bg-info/15 dark:hover:bg-info/20',
    dotClass: 'bg-info',
    badgeVariant: 'info',
  };
}

function isMultiDaySpan(todo: TodoItem): boolean {
  return Boolean(todo.dueDate && todo.endDate && todo.endDate > todo.dueDate);
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

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function formatIcsDateCompact(dateKey: string): string {
  return dateKey.replace(/-/g, '');
}

function buildIcsCalendar(todos: TodoItem[]): string {
  const now = new Date();
  const dtStamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DeskTag//Calendar Export//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const todo of todos) {
    if (!todo.dueDate) continue;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${todo.id}@desktag.local`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`SUMMARY:${escapeIcsText(todo.title)}`);
    if (todo.notes.trim()) {
      lines.push(`DESCRIPTION:${escapeIcsText(todo.notes.trim())}`);
    }

    const isSpan = isMultiDaySpan(todo);
    if (!isSpan && todo.dueTime && /^\d{2}:\d{2}$/.test(todo.dueTime)) {
      const [hh, mm] = todo.dueTime.split(':').map((v) => Number.parseInt(v, 10) || 0);
      const startDate = parseDateKey(todo.dueDate);
      const endDate = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        startDate.getDate(),
        hh + 1,
        mm,
        0,
      );
      lines.push(`DTSTART:${formatIcsDateCompact(todo.dueDate)}T${pad2(hh)}${pad2(mm)}00`);
      lines.push(
        `DTEND:${formatIcsDateCompact(formatDateKey(endDate))}T${pad2(endDate.getHours())}${pad2(endDate.getMinutes())}00`,
      );
    } else {
      const endKey = todo.endDate && todo.endDate >= todo.dueDate ? todo.endDate : todo.dueDate;
      const exclusiveEnd = formatDateKey(addDays(parseDateKey(endKey), 1));
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDateCompact(todo.dueDate)}`);
      lines.push(`DTEND;VALUE=DATE:${formatIcsDateCompact(exclusiveEnd)}`);
    }

    lines.push(`STATUS:${todo.completed ? 'COMPLETED' : 'CONFIRMED'}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

function buildJsonExport(todos: TodoItem[], lists: TodoList[]): string {
  const listMap = new Map(lists.map((l) => [l.id, l.name]));
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      count: todos.length,
      todos: todos.map((t) => ({
        id: t.id,
        title: t.title,
        completed: t.completed,
        priority: t.priority,
        dueDate: t.dueDate,
        dueTime: t.dueTime,
        endDate: t.endDate,
        list: t.listId ? (listMap.get(t.listId) ?? null) : null,
        tags: t.tags,
        notes: t.notes,
        subtasks: t.subtasks.map((s) => ({ title: s.title, completed: s.completed })),
      })),
    },
    null,
    2,
  );
}

export const CalendarView: React.FC<CalendarViewProps> = ({ standalone = false }) => {
  const {
    data,
    platform,
    activeTodos,
    activeLists,
    isMobileLayout,
    setEditingTodoId,
    addTodo,
    updateTodo,
    toggleTodo,
    showToast,
  } = useDeskTagStore();

  const isWindowsOpaqueStandalone =
    standalone && isTauriRuntime() && platform.platform === 'windows';

  const [mode, setMode] = useState<CalendarMode>(isMobileLayout ? 'month' : 'week');
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [navAnim, setNavAnim] = useState<'none' | 'next' | 'prev' | 'fade'>('none');
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [pinned, setPinned] = useState(false);

  // Filter popover state
  const [showFilter, setShowFilter] = useState(false);
  const [filterListId, setFilterListId] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<TodoPriority | 'all'>('all');
  const [filterTag, setFilterTag] = useState<string>('all');
  const [showCompleted, setShowCompleted] = useState<boolean>(true);

  // Quick-add on clicked day
  const [quickAddDateKey, setQuickAddDateKey] = useState<string | null>(null);
  const [quickAddTitle, setQuickAddTitle] = useState('');

  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => getTodayKey(today), [today]);

  const listMap = useMemo(() => {
    const map = new Map<string, TodoList>();
    for (const l of activeLists) map.set(l.id, l);
    return map;
  }, [activeLists]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of activeTodos) {
      for (const tag of t.tags ?? []) set.add(tag);
    }
    return Array.from(set).sort();
  }, [activeTodos]);

  const listFilterItems = useMemo(
    () => [
      { label: '全部清单', value: 'all', color: null as string | null },
      { label: '普通待办', value: '__none__', color: null as string | null },
      ...activeLists.map((l) => ({ label: l.name, value: l.id, color: l.color })),
    ],
    [activeLists],
  );

  const tagFilterItems = useMemo(
    () => [
      { label: '全部标签', value: 'all' },
      ...allTags.map((tag) => ({ label: `#${tag}`, value: tag })),
    ],
    [allTags],
  );

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
      if (filterTag !== 'all' && !(t.tags ?? []).includes(filterTag)) return false;
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

  // Pack overlapping multi-day spans into horizontal tracks for Week View
  const { weekSpanTracks, weekSpanCoveredCols } = useMemo(() => {
    const prioWeight: Record<TodoPriority, number> = { high: 3, medium: 2, low: 1, none: 0 };
    const segments: WeekSpanSegment[] = [];

    for (const todo of filteredTodos) {
      if (!isMultiDaySpan(todo) || !todo.dueDate || !todo.endDate) continue;
      if (todo.dueDate > weekRange.endKey || todo.endDate < weekRange.startKey) continue;

      const startCol =
        todo.dueDate <= weekRange.startKey ? 0 : diffDays(weekRange.startKey, todo.dueDate);
      const endCol =
        todo.endDate >= weekRange.endKey ? 6 : diffDays(weekRange.startKey, todo.endDate);
      const totalDays = diffDays(todo.dueDate, todo.endDate) + 1;

      segments.push({
        todo,
        startCol: Math.max(0, Math.min(6, startCol)),
        endCol: Math.max(0, Math.min(6, endCol)),
        totalDays,
        clippedLeft: todo.dueDate < weekRange.startKey,
        clippedRight: todo.endDate > weekRange.endKey,
      });
    }

    segments.sort((a, b) => {
      if (a.startCol !== b.startCol) return a.startCol - b.startCol;
      const spanA = a.endCol - a.startCol;
      const spanB = b.endCol - b.startCol;
      if (spanB !== spanA) return spanB - spanA;
      return prioWeight[b.todo.priority] - prioWeight[a.todo.priority];
    });

    const tracks: WeekSpanSegment[][] = [];
    const trackEnds: number[] = [];
    const coveredCols = new Set<number>();

    for (const seg of segments) {
      for (let c = seg.startCol; c <= seg.endCol; c += 1) {
        coveredCols.add(c);
      }
      let placed = false;
      for (let t = 0; t < tracks.length; t += 1) {
        if (trackEnds[t] < seg.startCol) {
          tracks[t].push(seg);
          trackEnds[t] = seg.endCol;
          placed = true;
          break;
        }
      }
      if (!placed) {
        tracks.push([seg]);
        trackEnds.push(seg.endCol);
      }
    }

    return { weekSpanTracks: tracks, weekSpanCoveredCols: coveredCols };
  }, [filteredTodos, weekRange]);

  const activeFilterCount =
    (filterListId !== 'all' ? 1 : 0) +
    (filterPriority !== 'all' ? 1 : 0) +
    (filterTag !== 'all' ? 1 : 0) +
    (!showCompleted ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  const resetFilters = () => {
    setFilterListId('all');
    setFilterPriority('all');
    setFilterTag('all');
    setShowCompleted(true);
  };

  const stepAnchor = (delta: number) => {
    setNavAnim(delta > 0 ? 'next' : 'prev');
    setAnchorDate((prev) => {
      if (mode === 'day') return addDays(prev, delta);
      if (mode === 'week') return addDays(prev, delta * 7);
      return new Date(prev.getFullYear(), prev.getMonth() + delta, 1);
    });
  };

  const navAnimClass =
    navAnim === 'next'
      ? 'dt-slide-next'
      : navAnim === 'prev'
        ? 'dt-slide-prev'
        : navAnim === 'fade'
          ? 'dt-view-enter'
          : undefined;

  const standaloneLunarSubtitle = useMemo(() => {
    const lunar = solarToLunar(
      anchorDate.getFullYear(),
      anchorDate.getMonth() + 1,
      anchorDate.getDate(),
    );
    return `${anchorDate.getFullYear()} 年 ${anchorDate.getMonth() + 1} 月 · 农历${lunar.monthLabel}`;
  }, [anchorDate]);

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

  const handleExport = async (format: CalendarExportFormat) => {
    try {
      if (format === 'json') {
        const filename = `desktag-calendar-${todayKey}.json`;
        triggerBrowserDownload(
          filename,
          buildJsonExport(activeTodos, activeLists),
          'application/json;charset=utf-8',
        );
        showToast(`已导出 JSON：${filename}`);
        return;
      }
      if (format === 'ics') {
        const filename = `desktag-calendar-${todayKey}.ics`;
        triggerBrowserDownload(
          filename,
          buildIcsCalendar(activeTodos),
          'text/calendar;charset=utf-8',
        );
        showToast(`已导出 iCalendar：${filename}`);
        return;
      }
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

  const renderExportMenuItems = () => (
    <>
      <MenuGroup>
        <MenuGroupLabel>导出日程数据</MenuGroupLabel>
        <MenuItem onClick={() => void handleExport('markdown')}>
          <FileTextIcon aria-hidden="true" className="size-3.5" />
          <span className="text-xs">导出 Markdown</span>
        </MenuItem>
        <MenuItem onClick={() => void handleExport('csv')}>
          <FileSpreadsheetIcon aria-hidden="true" className="size-3.5" />
          <span className="text-xs">导出 CSV</span>
        </MenuItem>
        <MenuItem onClick={() => void handleExport('json')}>
          <FileJsonIcon aria-hidden="true" className="size-3.5" />
          <span className="text-xs">导出 JSON</span>
        </MenuItem>
        <MenuItem onClick={() => void handleExport('ics')}>
          <CalendarDaysIcon aria-hidden="true" className="size-3.5" />
          <span className="text-xs">导出 iCalendar (.ics)</span>
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup>
        <MenuGroupLabel>文档与打印</MenuGroupLabel>
        <MenuItem onClick={() => void handleExport('html')}>
          <FileCodeIcon aria-hidden="true" className="size-3.5" />
          <span className="text-xs">导出 HTML</span>
        </MenuItem>
        <MenuItem onClick={() => void handleExport('docx')}>
          <FileTextIcon aria-hidden="true" className="size-3.5" />
          <span className="text-xs">导出 Word</span>
        </MenuItem>
        <MenuItem onClick={() => void handleExport('pdf')}>
          <PrinterIcon aria-hidden="true" className="size-3.5" />
          <span className="text-xs">打印 / PDF</span>
        </MenuItem>
      </MenuGroup>
    </>
  );

  const renderWeekTaskCard = (todo: TodoItem, mutedCompleted = false) => {
    const pDot = priorityDotClass(todo.priority);
    const subTotal = todo.subtasks.length;
    const subDone = todo.subtasks.filter((s) => s.completed).length;
    const subPct = subTotal > 0 ? Math.round((subDone / subTotal) * 100) : null;
    const listInfo = todo.listId ? listMap.get(todo.listId) : undefined;
    const tagLabel = listInfo?.name ?? todo.tags[0] ?? null;

    return (
      <div
        key={todo.id}
        className={cn(
          'group flex cursor-pointer flex-col gap-1.5 rounded-lg border p-2',
          mutedCompleted
            ? 'border-border/70 bg-muted/50 opacity-85 transition-[background-color,opacity] duration-[120ms] ease-[var(--dt-ease)] hover:opacity-100'
            : 'dt-card-lift bg-card not-dark:bg-clip-padding shadow-xs/5 hover:border-ring/45 hover:bg-accent/40',
        )}
        onClick={(e) => {
          e.stopPropagation();
          setEditingTodoId(todo.id);
        }}
        title={todo.title}
      >
        <div className="flex min-w-0 items-start gap-1.5">
          <div className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              aria-label={todo.completed ? '标记未完成' : '标记完成'}
              checked={todo.completed}
              className="size-3.5"
              onCheckedChange={() => toggleTodo(todo.id)}
            />
          </div>
          <span
            className={cn(
              'line-clamp-2 min-w-0 flex-1 break-words text-xs leading-[1.45]',
              todo.completed
                ? 'text-muted-foreground line-through'
                : 'font-medium text-foreground',
            )}
          >
            {todo.title}
          </span>
        </div>

        {/* Bottom Metadata Row */}
        {mutedCompleted ? (
          todo.dueTime && (
            <div className="ps-5 text-[10.5px] text-muted-foreground tabular-nums">
              {todo.dueTime}
            </div>
          )
        ) : (
          <div className="flex min-w-0 items-center justify-between gap-1 ps-5">
            <div className="flex min-w-0 items-center gap-1">
              {pDot && <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', pDot)} />}
              <span className="truncate text-[10.5px] text-muted-foreground tabular-nums">
                {todo.dueTime || '全天'}
              </span>
            </div>

            {subPct !== null ? (
              <Badge className="shrink-0 tabular-nums" size="sm" variant="success">
                {subPct}%
              </Badge>
            ) : tagLabel ? (
              <Badge
                className="max-w-[68px] shrink-0 truncate font-normal text-muted-foreground"
                size="sm"
                variant="secondary"
              >
                {tagLabel}
              </Badge>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  const renderMonthTodoChip = (todo: TodoItem, dateKey: string) => {
    const pDot = priorityDotClass(todo.priority);
    const isSpan = isMultiDaySpan(todo);
    const isSpanStart = isSpan && todo.dueDate === dateKey;
    const isSpanEnd = isSpan && todo.endDate === dateKey;
    const tone = getSpanTone(todo.priority);

    return (
      <button
        key={`${todo.id}-${dateKey}`}
        className={cn(
          'dt-pressable flex w-full min-w-0 items-center gap-1 text-left',
          isMobileLayout ? 'px-1 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-[11px]',
          isSpan
            ? cn(
                'border',
                tone.pillClass,
                isSpanStart ? 'rounded-s-md' : 'rounded-s-none border-s-0',
                isSpanEnd ? 'rounded-e-md' : 'rounded-e-none border-e-0',
              )
            : 'rounded-md border border-border/60 bg-card hover:border-ring/40 hover:bg-accent/60',
          todo.completed && 'opacity-60',
        )}
        onClick={(e) => {
          e.stopPropagation();
          setEditingTodoId(todo.id);
        }}
        title={`${todo.title}${todo.dueTime ? ` (${todo.dueTime})` : ''}${isSpan ? ` · 跨天至 ${todo.endDate}` : ''}`}
        type="button"
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            pDot ?? (isSpan ? tone.dotClass : 'bg-muted-foreground/50'),
          )}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate leading-tight',
            todo.completed ? 'text-muted-foreground line-through' : 'font-medium text-foreground',
          )}
        >
          {todo.title}
        </span>
        {!isMobileLayout && !isSpan && todo.dueTime && (
          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
            {todo.dueTime}
          </span>
        )}
      </button>
    );
  };

  const drawerItems = drawer === 'overdue' ? overdueTodos : unscheduledTodos;

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground',
        standalone && !isWindowsOpaqueStandalone && 'rounded-xl border',
      )}
    >
      {/* Standalone Frameless Window Titlebar */}
      {standalone && (
        <header
          className="flex h-10 shrink-0 select-none items-center justify-between gap-3 border-b bg-sidebar px-3.5"
          data-tauri-drag-region
        >
          <div className="flex min-w-0 items-center gap-2" data-tauri-drag-region>
            <CalendarDaysIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-foreground/80"
            />
            <span
              className="shrink-0 font-semibold text-[13px] tracking-tight text-foreground"
              data-tauri-drag-region
            >
              日历视图
            </span>
            <span
              className="truncate text-muted-foreground text-xs"
              data-tauri-drag-region
            >
              {standaloneLunarSubtitle}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label="导出日历待办"
                    size="icon-xs"
                    title="导出日历待办"
                    variant="ghost"
                  />
                }
              >
                <DownloadIcon aria-hidden="true" className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end" className="w-44" sideOffset={4}>
                {renderExportMenuItems()}
              </MenuPopup>
            </Menu>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={pinned ? '取消置顶' : '窗口置顶'}
                    aria-pressed={pinned}
                    className={cn(pinned && 'border-input bg-accent text-foreground')}
                    onClick={() => void handleToggleWindowPin()}
                    size="icon-xs"
                    variant={pinned ? 'outline' : 'ghost'}
                  />
                }
              >
                <PinIcon
                  aria-hidden="true"
                  className={cn('size-3.5', pinned && 'text-dt-accent')}
                />
              </TooltipTrigger>
              <TooltipPopup side="bottom">{pinned ? '取消置顶' : '窗口置顶'}</TooltipPopup>
            </Tooltip>

            <Separator className="mx-1 h-3.5" orientation="vertical" />

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="最小化"
                    onClick={() => void handleMinimize()}
                    size="icon-xs"
                    variant="ghost"
                  />
                }
              >
                <MinusIcon aria-hidden="true" className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="bottom">最小化</TooltipPopup>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="最大化或还原"
                    onClick={() => void handleToggleMaximize()}
                    size="icon-xs"
                    variant="ghost"
                  />
                }
              >
                <SquareIcon aria-hidden="true" className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="bottom">最大化 / 还原</TooltipPopup>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="关闭日历窗口"
                    className="hover:bg-destructive/10 hover:text-destructive-foreground"
                    onClick={() => void handleCloseWindow()}
                    size="icon-xs"
                    variant="ghost"
                  />
                }
              >
                <XIcon aria-hidden="true" className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="bottom">关闭窗口</TooltipPopup>
            </Tooltip>
          </div>
        </header>
      )}

      {/* Crisp Calendar Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-3.5 py-2">
        {/* Left: Date Group Navigator + Range Label + Semantic Counters */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Group aria-label="日期周期导航">
            <Button
              aria-label="上一周期"
              onClick={() => stepAnchor(-1)}
              size="icon-sm"
              variant="outline"
            >
              <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
            </Button>
            <GroupSeparator />
            <Button
              className="px-2.5 text-xs"
              onClick={() => {
                setNavAnim('fade');
                setAnchorDate(new Date());
              }}
              size="sm"
              variant="outline"
            >
              今天
            </Button>
            <GroupSeparator />
            <Button
              aria-label="下一周期"
              onClick={() => stepAnchor(1)}
              size="icon-sm"
              variant="outline"
            >
              <ChevronRightIcon aria-hidden="true" className="size-3.5" />
            </Button>
          </Group>

          <h2
            className={cn(
              'font-semibold tracking-tight text-foreground tabular-nums',
              isMobileLayout ? 'text-xs' : 'text-sm',
            )}
          >
            {rangeLabel}
          </h2>

          <div className="flex items-center gap-1.5">
            <Badge
              className="dt-pressable h-6 rounded-md px-2 text-xs font-medium tabular-nums"
              render={
                <button
                  onClick={() => setDrawer((d) => (d === 'unscheduled' ? null : 'unscheduled'))}
                  type="button"
                />
              }
              size="lg"
              variant={drawer === 'unscheduled' ? 'default' : 'secondary'}
            >
              <span>待安排</span>
              <span className="font-semibold">{unscheduledTodos.length}</span>
            </Badge>

            <Badge
              className="dt-pressable h-6 rounded-md px-2 text-xs font-medium tabular-nums"
              render={
                <button
                  onClick={() => setDrawer((d) => (d === 'overdue' ? null : 'overdue'))}
                  type="button"
                />
              }
              size="lg"
              variant={
                drawer === 'overdue'
                  ? 'destructive'
                  : overdueTodos.length > 0
                    ? 'error'
                    : 'secondary'
              }
            >
              {overdueTodos.length > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 rounded-full',
                    drawer === 'overdue' ? 'bg-white' : 'bg-destructive',
                  )}
                />
              )}
              <span>逾期</span>
              <span className="font-semibold">{overdueTodos.length}</span>
            </Badge>
          </div>
        </div>

        {/* Right: Segmented View Switcher + Filter Popover + Export Menu */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <SegmentedControl
            render={
              <RadioGroupPrimitive
                aria-label="日历视图切换"
                onValueChange={(val) => {
                  if (val === 'day' || val === 'week' || val === 'month') {
                    setNavAnim('fade');
                    setMode(val);
                  }
                }}
                value={mode}
              />
            }
            size="sm"
          >
            <SegmentedControlItem render={<RadioPrimitive.Root value="day" />}>
              日视图
            </SegmentedControlItem>
            <SegmentedControlItem render={<RadioPrimitive.Root value="week" />}>
              周视图
            </SegmentedControlItem>
            <SegmentedControlItem render={<RadioPrimitive.Root value="month" />}>
              月视图
            </SegmentedControlItem>
          </SegmentedControl>

          <Popover onOpenChange={setShowFilter} open={showFilter}>
            <PopoverTrigger
              render={
                <Button
                  className="text-xs"
                  size="sm"
                  variant={hasActiveFilters || showFilter ? 'secondary' : 'outline'}
                />
              }
            >
              <FilterIcon aria-hidden="true" className="size-3.5" />
              <span>筛选</span>
              {activeFilterCount > 0 && (
                <Badge className="px-1 tabular-nums" size="sm" variant="default">
                  {activeFilterCount}
                </Badge>
              )}
            </PopoverTrigger>

            <PopoverPopup align="end" className="w-64" sideOffset={6}>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <PopoverTitle className="text-sm">日历筛选</PopoverTitle>
                  {hasActiveFilters && (
                    <Button onClick={resetFilters} size="xs" variant="ghost">
                      <RotateCcwIcon aria-hidden="true" className="size-3" />
                      <span>重置</span>
                    </Button>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-muted-foreground text-xs">清单</Label>
                  <Select
                    items={listFilterItems}
                    onValueChange={(v) => {
                      if (typeof v === 'string') setFilterListId(v);
                    }}
                    value={filterListId}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue placeholder="全部清单" />
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      {listFilterItems.map((item) => (
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
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-muted-foreground text-xs">优先级</Label>
                  <Select
                    items={PRIORITY_FILTER_ITEMS}
                    onValueChange={(v) => {
                      if (
                        v === 'all' ||
                        v === 'high' ||
                        v === 'medium' ||
                        v === 'low' ||
                        v === 'none'
                      ) {
                        setFilterPriority(v);
                      }
                    }}
                    value={filterPriority}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue placeholder="全部优先级" />
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      {PRIORITY_FILTER_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-muted-foreground text-xs">标签</Label>
                  <Select
                    items={tagFilterItems}
                    onValueChange={(v) => {
                      if (typeof v === 'string') setFilterTag(v);
                    }}
                    value={filterTag}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue placeholder="全部标签" />
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      {tagFilterItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>

                <Separator />

                <Label className="flex w-full cursor-pointer items-center justify-between gap-3">
                  <span className="font-medium text-xs text-foreground">显示已完成待办</span>
                  <Switch
                    checked={showCompleted}
                    onCheckedChange={(checked) => setShowCompleted(checked)}
                  />
                </Label>
              </div>
            </PopoverPopup>
          </Popover>

          <Menu>
            <MenuTrigger
              render={<Button className="text-xs" size="sm" variant="outline" />}
            >
              <DownloadIcon aria-hidden="true" className="size-3.5" />
              <span>导出</span>
            </MenuTrigger>
            <MenuPopup align="end" className="w-44" sideOffset={4}>
              {renderExportMenuItems()}
            </MenuPopup>
          </Menu>
        </div>
      </div>

      {/* Main Calendar Canvas */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* WEEK VIEW (Flagship 960x660 with Continuous Multi-Day Span Lane & 2-Line Cards) */}
        {mode === 'week' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden">
            <div
              key={`week:${weekRange.startKey}`}
              className={cn(
                'flex min-h-0 flex-1 flex-col',
                isMobileLayout ? 'min-w-[680px]' : 'w-full min-w-0',
                navAnimClass,
              )}
            >
              {/* 7-Column Unified Day Header Strip */}
              <div className="grid shrink-0 grid-cols-7 border-b bg-background">
                {weekRange.days.map((day, idx) => {
                  const dateKey = formatDateKey(day);
                  const isToday = dateKey === todayKey;
                  const lunarInfo = solarToLunar(
                    day.getFullYear(),
                    day.getMonth() + 1,
                    day.getDate(),
                  );
                  const lunarDisplay = isToday
                    ? lunarInfo.festival ?? `${lunarInfo.monthLabel}${lunarInfo.dayLabel}`
                    : lunarInfo.label;

                  return (
                    <div
                      key={dateKey}
                      className={cn(
                        'relative flex items-center justify-between gap-1 border-r px-2.5 py-2 last:border-r-0',
                        isToday &&
                          'bg-coss-frame-well/70 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary',
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex shrink-0 items-center justify-center font-semibold tabular-nums',
                            isToday
                              ? 'size-7 rounded-full bg-primary text-primary-foreground text-xs shadow-xs/5'
                              : 'text-foreground text-sm',
                          )}
                        >
                          {day.getDate()}
                        </span>
                        <div className="flex min-w-0 flex-col leading-tight">
                          <span
                            className={cn(
                              'truncate text-[11px]',
                              isToday
                                ? 'font-semibold text-foreground'
                                : 'font-medium text-muted-foreground',
                            )}
                          >
                            {isToday ? `${WEEKDAY_LABELS[idx]}·今` : WEEKDAY_LABELS[idx]}
                          </span>
                          <span
                            className={cn(
                              'truncate text-[10.5px]',
                              lunarInfo.festival
                                ? 'font-medium text-dt-accent-soft-text'
                                : 'text-muted-foreground/85',
                            )}
                          >
                            {lunarDisplay}
                          </span>
                        </div>
                      </div>

                      <Button
                        aria-label={`在 ${dateKey} 添加日程`}
                        className="size-5.5 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setQuickAddDateKey(dateKey);
                          setQuickAddTitle('');
                        }}
                        size="icon-xs"
                        title="在此日新建待办"
                        variant={isToday ? 'outline' : 'ghost'}
                      >
                        <PlusIcon aria-hidden="true" className="size-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>

              {/* Continuous Multi-Day Span Lane */}
              {weekSpanTracks.length > 0 && (
                <div className="relative shrink-0 border-b bg-coss-frame-well/55 py-1.5">
                  {/* Subtle 7-column hairline backdrop */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 grid grid-cols-7"
                  >
                    {weekRange.days.map((d) => (
                      <div
                        key={formatDateKey(d)}
                        className="border-r border-border/60 last:border-r-0"
                      />
                    ))}
                  </div>

                  <div className="relative z-1 flex flex-col gap-1">
                    {weekSpanTracks.map((track, trackIdx) => (
                      <div key={trackIdx} className="grid grid-cols-7 items-center">
                        {track.map((seg) => {
                          const tone = getSpanTone(seg.todo.priority);
                          return (
                            <button
                              key={seg.todo.id}
                              className={cn(
                                'dt-pressable flex min-w-0 items-center gap-1.5 border px-2 py-1 text-left text-xs shadow-xs/5',
                                tone.pillClass,
                                seg.clippedLeft
                                  ? 'ms-0 rounded-s-none border-s-0'
                                  : 'ms-1.5 rounded-s-lg',
                                seg.clippedRight
                                  ? 'me-0 rounded-e-none border-e-0'
                                  : 'me-1.5 rounded-e-lg',
                                seg.todo.completed && 'opacity-60',
                              )}
                              onClick={() => setEditingTodoId(seg.todo.id)}
                              style={{
                                gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}`,
                              }}
                              title={`${seg.todo.title} (${seg.todo.dueDate} — ${seg.todo.endDate} · ${seg.totalDays}天)`}
                              type="button"
                            >
                              <span
                                aria-hidden="true"
                                className={cn('size-1.5 shrink-0 rounded-full', tone.dotClass)}
                              />
                              <span
                                className={cn(
                                  'min-w-0 flex-1 truncate font-medium text-xs text-foreground',
                                  seg.todo.completed && 'text-muted-foreground line-through',
                                )}
                              >
                                {seg.todo.title}
                              </span>
                              {seg.todo.dueTime && (
                                <span className="shrink-0 text-[10.5px] text-muted-foreground tabular-nums">
                                  {seg.todo.dueTime}
                                </span>
                              )}
                              <Badge
                                className="shrink-0 tabular-nums"
                                size="sm"
                                variant={tone.badgeVariant}
                              >
                                {seg.totalDays}天
                              </Badge>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 7-Column Single-Day Task Columns */}
              <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-content]]:flex [&_[data-slot=scroll-area-content]]:min-h-full [&_[data-slot=scroll-area-content]]:flex-col">
                <div className="grid flex-1 grid-cols-7">
                  {weekRange.days.map((day, idx) => {
                    const dateKey = formatDateKey(day);
                    const isToday = dateKey === todayKey;
                    const singleDayTodos = sortDayTodos(
                      filteredTodos.filter(
                        (t) => !isMultiDaySpan(t) && todoCoversDate(t, dateKey),
                      ),
                    );
                    const pendingTodos = singleDayTodos.filter((t) => !t.completed);
                    const completedTodos = singleDayTodos.filter((t) => t.completed);
                    const hasSpanOnDay = weekSpanCoveredCols.has(idx);
                    const isEmpty =
                      pendingTodos.length === 0 &&
                      completedTodos.length === 0 &&
                      quickAddDateKey !== dateKey;

                    return (
                      <div
                        key={dateKey}
                        className={cn(
                          'group/daycol flex min-h-[340px] flex-col gap-2 border-r p-2 transition-colors last:border-r-0',
                          isToday && 'bg-coss-frame-well/45',
                        )}
                        onClick={() => {
                          setQuickAddDateKey(dateKey);
                          setQuickAddTitle('');
                        }}
                      >
                        {/* Pending 2-Line Task Cards */}
                        {pendingTodos.length > 0 && (
                          <div className="flex flex-col gap-2">
                            {pendingTodos.map((todo) => renderWeekTaskCard(todo, false))}
                          </div>
                        )}

                        {/* Collapsible Completed Section */}
                        {completedTodos.length > 0 && (
                          <Collapsible
                            className="flex flex-col gap-1.5 pt-1"
                            defaultOpen
                          >
                            <CollapsibleTrigger
                              className="flex w-full items-center gap-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="shrink-0 tabular-nums">
                                已完成 {completedTodos.length}
                              </span>
                              <span className="h-px flex-1 bg-border" />
                              <ChevronDownIcon
                                aria-hidden="true"
                                className="dt-chevron size-3 shrink-0 [[data-panel-open]_&]:rotate-180"
                              />
                            </CollapsibleTrigger>
                            <CollapsiblePanel>
                              <div className="flex flex-col gap-1.5">
                                {completedTodos.map((todo) => renderWeekTaskCard(todo, true))}
                              </div>
                            </CollapsiblePanel>
                          </Collapsible>
                        )}

                        {/* Subtle Empty / Span-Covered Hint */}
                        {isEmpty && (
                          <div className="flex flex-1 items-start justify-center px-1 pt-5 text-center text-[11px] text-muted-foreground/60">
                            {hasSpanOnDay ? '含跨天日程进行中' : '暂无安排'}
                          </div>
                        )}

                        {/* Inline Quick Add or Subtle Dashed Add Trigger */}
                        {quickAddDateKey === dateKey ? (
                          <div
                            className="dt-pop-in mt-auto pt-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Input
                              autoFocus
                              onBlur={() => {
                                if (quickAddTitle.trim()) {
                                  handleQuickAddSubmit(dateKey);
                                } else {
                                  setQuickAddDateKey(null);
                                }
                              }}
                              onChange={(e) => setQuickAddTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                  e.preventDefault();
                                  handleQuickAddSubmit(dateKey);
                                } else if (e.key === 'Escape') {
                                  setQuickAddDateKey(null);
                                }
                              }}
                              placeholder="输入日程 Enter 创建…"
                              size="sm"
                              type="text"
                              value={quickAddTitle}
                            />
                          </div>
                        ) : (
                          <Button
                            className={cn(
                              'mt-auto w-full border-dashed text-muted-foreground transition-opacity hover:text-foreground',
                              isToday
                                ? 'opacity-100'
                                : 'opacity-0 focus-visible:opacity-100 group-hover/daycol:opacity-100 pointer-coarse:opacity-100',
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              setQuickAddDateKey(dateKey);
                              setQuickAddTitle('');
                            }}
                            size="xs"
                            variant="outline"
                          >
                            <PlusIcon aria-hidden="true" className="size-3" />
                            <span>{isToday ? '添加今日日程' : '添加日程'}</span>
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        {/* MONTH VIEW */}
        {mode === 'month' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="grid shrink-0 grid-cols-7 border-b bg-sidebar/60 py-1.5">
              {WEEKDAY_LABELS.map((wk) => (
                <div
                  key={wk}
                  className="text-center font-medium text-muted-foreground text-xs"
                >
                  {wk}
                </div>
              ))}
            </div>

            <div
              key={`month:${anchorDate.getFullYear()}-${anchorDate.getMonth() + 1}`}
              className={cn(
                'grid min-h-0 flex-1 grid-cols-7 grid-rows-[repeat(6,minmax(88px,1fr))] overflow-y-auto',
                navAnimClass,
              )}
            >
              {monthCells.map((cell, idx) => {
                const dayTodos = sortDayTodos(
                  filteredTodos.filter((t) => todoCoversDate(t, cell.dateKey)),
                );
                const maxShow = isMobileLayout ? 2 : 3;
                const lunarInfo = solarToLunar(
                  cell.date.getFullYear(),
                  cell.date.getMonth() + 1,
                  cell.date.getDate(),
                );

                return (
                  <div
                    key={cell.dateKey}
                    className={cn(
                      'group/mcell flex min-w-0 cursor-pointer flex-col overflow-hidden border-r border-b transition-[background-color,box-shadow] duration-[120ms] ease-[var(--dt-ease)] hover:bg-accent/35',
                      isMobileLayout ? 'p-1' : 'p-1.5',
                      idx % 7 === 6 && 'border-r-0',
                      idx >= 35 && 'border-b-0',
                      cell.isToday && 'bg-coss-frame-well/65',
                      !cell.inCurrentMonth && 'bg-muted/25',
                      quickAddDateKey === cell.dateKey && 'bg-accent/45 ring-1 ring-inset ring-ring/40',
                    )}
                    onClick={() => {
                      setQuickAddDateKey(cell.dateKey);
                      setQuickAddTitle('');
                    }}
                  >
                    {/* Date + Lunar Header */}
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center justify-center font-semibold tabular-nums',
                          cell.isToday
                            ? 'size-5.5 rounded-full bg-primary text-primary-foreground text-[11px]'
                            : cn(
                                isMobileLayout ? 'text-[11px]' : 'text-xs',
                                cell.inCurrentMonth
                                  ? 'text-foreground'
                                  : 'text-muted-foreground/55',
                              ),
                        )}
                      >
                        {cell.dayOfMonth}
                      </span>
                      <span
                        className={cn(
                          'truncate',
                          isMobileLayout ? 'text-[9.5px]' : 'text-[10.5px]',
                          lunarInfo.festival && cell.inCurrentMonth
                            ? 'font-medium text-dt-accent-soft-text'
                            : cell.inCurrentMonth
                              ? 'text-muted-foreground'
                              : 'text-muted-foreground/45',
                        )}
                      >
                        {cell.lunarLabel}
                      </span>
                    </div>

                    {/* Task Chips */}
                    <div className="flex min-w-0 flex-col gap-1">
                      {dayTodos.slice(0, maxShow).map((todo) => renderMonthTodoChip(todo, cell.dateKey))}
                      {dayTodos.length > maxShow && (
                        <button
                          className="truncate px-1 text-left font-medium text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setNavAnim('fade');
                            setAnchorDate(cell.date);
                            setMode('day');
                          }}
                          type="button"
                        >
                          {isMobileLayout
                            ? `+${dayTodos.length - maxShow}项`
                            : `+${dayTodos.length - maxShow} 更多`}
                        </button>
                      )}
                    </div>

                    {/* Inline Quick Add */}
                    {quickAddDateKey === cell.dateKey && (
                      <div
                        className="dt-pop-in mt-auto pt-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Input
                          autoFocus
                          onBlur={() => {
                            if (quickAddTitle.trim()) {
                              handleQuickAddSubmit(cell.dateKey);
                            } else {
                              setQuickAddDateKey(null);
                            }
                          }}
                          onChange={(e) => setQuickAddTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              handleQuickAddSubmit(cell.dateKey);
                            } else if (e.key === 'Escape') {
                              setQuickAddDateKey(null);
                            }
                          }}
                          placeholder="新建待办…"
                          size="sm"
                          type="text"
                          value={quickAddTitle}
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
        {mode === 'day' &&
          (() => {
            const dateKey = formatDateKey(anchorDate);
            const dayTodos = sortDayTodos(
              filteredTodos.filter((t) => todoCoversDate(t, dateKey)),
            );
            const pendingDayTodos = dayTodos.filter((t) => !t.completed);
            const completedDayTodos = dayTodos.filter((t) => t.completed);
            const dayInputValue = quickAddDateKey === dateKey ? quickAddTitle : '';

            const renderDayRow = (todo: TodoItem) => {
              const pDot = priorityDotClass(todo.priority);
              const isSpan = isMultiDaySpan(todo);
              const spanDays =
                isSpan && todo.dueDate && todo.endDate
                  ? diffDays(todo.dueDate, todo.endDate) + 1
                  : 0;
              const subTotal = todo.subtasks.length;
              const subDone = todo.subtasks.filter((s) => s.completed).length;
              const listInfo = todo.listId ? listMap.get(todo.listId) : undefined;

              return (
                <div
                  key={todo.id}
                  className="flex cursor-pointer flex-col gap-1.5 px-3 py-2.5 transition-colors hover:bg-accent/55"
                  onClick={() => setEditingTodoId(todo.id)}
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={todo.completed ? '标记未完成' : '标记完成'}
                        checked={todo.completed}
                        onCheckedChange={() => toggleTodo(todo.id)}
                      />
                    </div>
                    {pDot && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'mt-[7px] size-1.5 shrink-0 rounded-full',
                          pDot,
                          todo.completed && 'opacity-50',
                        )}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          'line-clamp-2 break-words text-sm leading-[1.45]',
                          todo.completed
                            ? 'text-muted-foreground line-through'
                            : 'font-medium text-foreground',
                        )}
                      >
                        {todo.title}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {isSpan && (
                        <Badge size="sm" variant={getSpanTone(todo.priority).badgeVariant}>
                          跨天 · {spanDays}天
                        </Badge>
                      )}
                      {todo.dueTime && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground text-xs tabular-nums">
                          <ClockIcon aria-hidden="true" className="size-3" />
                          {todo.dueTime}
                        </span>
                      )}
                    </div>
                  </div>

                  {(listInfo || todo.tags.length > 0 || subTotal > 0) && (
                    <div className="flex flex-wrap items-center gap-1.5 ps-6.5">
                      {listInfo && (
                        <Badge size="sm" variant="outline">
                          <span
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: listInfo.color }}
                          />
                          <span>{listInfo.name}</span>
                        </Badge>
                      )}
                      {subTotal > 0 && (
                        <Badge className="tabular-nums" size="sm" variant="success">
                          子任务 {subDone}/{subTotal}
                        </Badge>
                      )}
                      {todo.tags.map((tag) => (
                        <Badge
                          key={tag}
                          className="font-normal text-muted-foreground"
                          size="sm"
                          variant="secondary"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              );
            };

            return (
              <ScrollArea className="min-h-0 flex-1" scrollFade>
                <div
                  key={`day:${dateKey}`}
                  className={cn('mx-auto flex w-full max-w-2xl flex-col gap-3.5 p-4', navAnimClass)}
                >
                  {/* Inline Quick Add */}
                  <div className="flex items-center gap-2 rounded-xl border bg-card p-1.5 ps-3 shadow-xs/5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/24">
                    <PlusIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <InputPrimitive
                      aria-label={`为 ${dateKey} 添加日程`}
                      className="h-7 min-w-0 flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground/72"
                      onChange={(e) => {
                        setQuickAddDateKey(dateKey);
                        setQuickAddTitle(e.target.value);
                      }}
                      onFocus={() => setQuickAddDateKey(dateKey)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          handleQuickAddSubmit(dateKey);
                        }
                      }}
                      placeholder={`为 ${dateKey} 添加日程，按 Enter 创建…`}
                      type="text"
                      value={dayInputValue}
                    />
                    <Button
                      disabled={!dayInputValue.trim()}
                      onClick={() => handleQuickAddSubmit(dateKey)}
                      size="sm"
                      variant="default"
                    >
                      添加
                    </Button>
                  </div>

                  {dayTodos.length === 0 ? (
                    <Empty className="py-14">
                      <EmptyMedia variant="icon">
                        <CalendarDaysIcon aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle className="text-base">这一天暂无安排</EmptyTitle>
                      <EmptyDescription>
                        在上方输入框中输入标题并按 Enter，即可快速创建日程。
                      </EmptyDescription>
                    </Empty>
                  ) : (
                    <>
                      {pendingDayTodos.length > 0 && (
                        <Frame>
                          <div className="flex items-center justify-between px-3 py-1.5">
                            <span className="font-semibold text-muted-foreground text-xs">
                              待处理日程
                            </span>
                            <Badge className="tabular-nums" size="sm" variant="outline">
                              {pendingDayTodos.length}
                            </Badge>
                          </div>
                          <FramePanel className="divide-y divide-border overflow-hidden p-0">
                            {pendingDayTodos.map(renderDayRow)}
                          </FramePanel>
                        </Frame>
                      )}

                      {completedDayTodos.length > 0 && (
                        <Collapsible defaultOpen>
                          <Frame>
                            <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground">
                              <span className="font-semibold text-xs tabular-nums">
                                已完成 ({completedDayTodos.length})
                              </span>
                              <ChevronDownIcon
                                aria-hidden="true"
                                className="dt-chevron size-3.5 [[data-panel-open]_&]:rotate-180"
                              />
                            </CollapsibleTrigger>
                            <CollapsiblePanel>
                              <FramePanel className="divide-y divide-border overflow-hidden p-0 opacity-80">
                                {completedDayTodos.map(renderDayRow)}
                              </FramePanel>
                            </CollapsiblePanel>
                          </Frame>
                        </Collapsible>
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>
            );
          })()}
      </div>

      {/* Unscheduled / Overdue Coss Drawer */}
      <Drawer
        onOpenChange={(open) => {
          if (!open) setDrawer(null);
        }}
        open={drawer !== null}
        position={isMobileLayout ? 'bottom' : 'left'}
      >
        <DrawerPopup
          className={isMobileLayout ? 'max-h-[80%]' : 'max-w-[308px]'}
          showBar={isMobileLayout}
          showCloseButton
        >
          <DrawerHeader className="gap-2.5 border-b px-4 pt-4 pb-3">
            <div className="flex flex-col gap-1 pe-6">
              <DrawerTitle className="text-base">
                {drawer === 'overdue' ? '已逾期待办' : '待安排待办'}
              </DrawerTitle>
              <DrawerDescription className="text-xs">
                {drawer === 'overdue'
                  ? '一键重新排期至今天，或点击查看详情'
                  : '尚未设置日期的待办事项，可快速安排至今天'}
              </DrawerDescription>
            </div>

            <SegmentedControl
              className="w-full"
              render={
                <RadioGroupPrimitive
                  aria-label="切换待安排或已逾期"
                  onValueChange={(val) => {
                    if (val === 'unscheduled' || val === 'overdue') setDrawer(val);
                  }}
                  value={drawer ?? 'unscheduled'}
                />
              }
              size="sm"
            >
              <SegmentedControlItem
                className="grow"
                render={<RadioPrimitive.Root value="unscheduled" />}
              >
                待安排 ({unscheduledTodos.length})
              </SegmentedControlItem>
              <SegmentedControlItem
                className="grow"
                render={<RadioPrimitive.Root value="overdue" />}
              >
                已逾期 ({overdueTodos.length})
              </SegmentedControlItem>
            </SegmentedControl>
          </DrawerHeader>

          <DrawerPanel className="p-3">
            {drawerItems.length === 0 ? (
              <Empty className="py-10">
                <EmptyMedia variant="icon">
                  <InboxIcon aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle className="text-sm">
                  {drawer === 'overdue' ? '没有逾期待办' : '暂无待安排待办'}
                </EmptyTitle>
                <EmptyDescription className="text-xs">
                  {drawer === 'overdue'
                    ? '所有日程都已按期推进，保持节奏。'
                    : '所有未完成待办均已安排具体日期。'}
                </EmptyDescription>
              </Empty>
            ) : (
              <div className="flex flex-col gap-2">
                {drawerItems.map((todo) => {
                  const pDot = priorityDotClass(todo.priority);
                  return (
                    <div
                      key={todo.id}
                      className="dt-card-lift flex flex-col gap-2 rounded-xl border bg-card p-2.5 shadow-xs/5 hover:border-ring/45"
                    >
                      <button
                        className="flex min-w-0 items-start gap-2 text-left"
                        onClick={() => {
                          setDrawer(null);
                          setEditingTodoId(todo.id);
                        }}
                        type="button"
                      >
                        {pDot && (
                          <span
                            aria-hidden="true"
                            className={cn('mt-[6px] size-1.5 shrink-0 rounded-full', pDot)}
                          />
                        )}
                        <span className="line-clamp-2 min-w-0 flex-1 break-words font-medium text-foreground text-xs leading-[1.45]">
                          {todo.title}
                        </span>
                      </button>

                      <div className="flex items-center justify-between gap-2">
                        {drawer === 'overdue' && todo.dueDate ? (
                          <Badge className="tabular-nums" size="sm" variant="error">
                            原定 {todo.dueDate}
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">未设日期</span>
                        )}

                        <Button
                          onClick={() => {
                            updateTodo(todo.id, { dueDate: todayKey });
                            showToast('已安排到今天');
                          }}
                          size="xs"
                          variant="outline"
                        >
                          <CalendarPlusIcon aria-hidden="true" className="size-3" />
                          <span>安排到今天</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DrawerPanel>
        </DrawerPopup>
      </Drawer>
    </div>
  );
};

export default CalendarView;
