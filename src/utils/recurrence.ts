import type {
  QuadrantId,
  QuadrantRules,
  ReminderRule,
  RepeatRule,
  TodoItem,
} from '../types/models';
import { addDays, diffDays, formatDateKey, getIsoWeekday, pad2, parseDateKey } from './lunar';

const WEEKDAY_CN: Record<number, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
};

export function createDefaultReminderRule(baseDate: Date = new Date(), timeStr?: string): ReminderRule {
  const defaultHour = Math.min(23, baseDate.getHours() + 1);
  const hhmm = timeStr || `${pad2(defaultHour)}:00`;
  const [hh, mm] = hhmm.split(':').map((n) => Number.parseInt(n, 10));
  const next = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    Number.isFinite(hh) ? hh : defaultHour,
    Number.isFinite(mm) ? mm : 0,
    0,
    0,
  );
  return {
    enabled: true,
    nextAt: next.toISOString(),
    mode: 'standard',
    frequency: 'weekly',
    weekdays: [getIsoWeekday(next)],
    month: next.getMonth() + 1,
    day: next.getDate(),
    intervalValue: 1,
    intervalUnit: 'days',
    times: [hhmm],
    stopCondition: 'until_complete',
    maxCount: 5,
    triggeredCount: 0,
    lastTriggeredAt: null,
  };
}

function parseTimeParts(hhmm: string): { h: number; m: number } {
  const [hRaw, mRaw] = hhmm.split(':');
  const h = Math.max(0, Math.min(23, Number.parseInt(hRaw ?? '9', 10) || 0));
  const m = Math.max(0, Math.min(59, Number.parseInt(mRaw ?? '0', 10) || 0));
  return { h, m };
}

function normalizeSortedTimes(times: string[]): string[] {
  const valid = times
    .map((t) => t.trim())
    .filter((t) => /^\d{1,2}:\d{2}$/.test(t))
    .map((t) => {
      const { h, m } = parseTimeParts(t);
      return `${pad2(h)}:${pad2(m)}`;
    });
  const unique = Array.from(new Set(valid));
  unique.sort();
  return unique.length > 0 ? unique : ['09:00'];
}

/**
 * Computes the next `count` upcoming trigger timestamps for a ReminderRule.
 */
export function computeNextReminders(
  rule: ReminderRule,
  count: number = 6,
  fromDate: Date = new Date(),
): Date[] {
  if (!rule.enabled || count <= 0) return [];

  const maxAllowed =
    rule.stopCondition === 'max_count' && rule.maxCount != null
      ? Math.max(0, rule.maxCount - rule.triggeredCount)
      : count;
  const limit = Math.min(count, maxAllowed);
  if (limit <= 0) return [];

  const baseStart =
    rule.nextAt && !Number.isNaN(Date.parse(rule.nextAt))
      ? new Date(Math.max(Date.parse(rule.nextAt), fromDate.getTime()))
      : new Date(fromDate.getTime());

  if (rule.mode === 'standard') {
    if (!rule.nextAt || Number.isNaN(Date.parse(rule.nextAt))) return [];
    return [new Date(rule.nextAt)];
  }

  const times = normalizeSortedTimes(rule.times);
  const results: Date[] = [];

  if (rule.frequency === 'daily') {
    const startDay = new Date(baseStart.getFullYear(), baseStart.getMonth(), baseStart.getDate());
    for (let dayOffset = 0; dayOffset < 60 && results.length < limit; dayOffset += 1) {
      const day = addDays(startDay, dayOffset);
      for (const t of times) {
        const { h, m } = parseTimeParts(t);
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
        if (candidate.getTime() >= baseStart.getTime() - 1000) {
          results.push(candidate);
          if (results.length >= limit) break;
        }
      }
    }
    return results;
  }

  if (rule.frequency === 'weekly') {
    const activeWeekdays =
      rule.weekdays && rule.weekdays.length > 0
        ? new Set(rule.weekdays)
        : new Set([getIsoWeekday(baseStart)]);
    const startDay = new Date(baseStart.getFullYear(), baseStart.getMonth(), baseStart.getDate());
    for (let dayOffset = 0; dayOffset < 120 && results.length < limit; dayOffset += 1) {
      const day = addDays(startDay, dayOffset);
      if (!activeWeekdays.has(getIsoWeekday(day))) continue;
      for (const t of times) {
        const { h, m } = parseTimeParts(t);
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
        if (candidate.getTime() >= baseStart.getTime() - 1000) {
          results.push(candidate);
          if (results.length >= limit) break;
        }
      }
    }
    return results;
  }

  if (rule.frequency === 'month_day') {
    const targetDay = Math.max(1, Math.min(31, rule.day ?? baseStart.getDate()));
    const targetMonth = rule.month; // 1..12 or null = every month
    let cursorYear = baseStart.getFullYear();
    let cursorMonth = targetMonth != null ? targetMonth - 1 : baseStart.getMonth();

    for (let step = 0; step < 48 && results.length < limit; step += 1) {
      const daysInMonth = new Date(cursorYear, cursorMonth + 1, 0).getDate();
      const clampedDay = Math.min(targetDay, daysInMonth);
      for (const t of times) {
        const { h, m } = parseTimeParts(t);
        const candidate = new Date(cursorYear, cursorMonth, clampedDay, h, m, 0, 0);
        if (candidate.getTime() >= baseStart.getTime() - 1000) {
          results.push(candidate);
          if (results.length >= limit) break;
        }
      }
      if (targetMonth != null) {
        cursorYear += 1;
      } else {
        cursorMonth += 1;
        if (cursorMonth > 11) {
          cursorMonth = 0;
          cursorYear += 1;
        }
      }
    }
    return results;
  }

  // custom interval (hours or days)
  const intervalVal = Math.max(1, rule.intervalValue ?? 1);
  const unit = rule.intervalUnit ?? 'days';
  let cursor = new Date(baseStart.getTime());

  if (unit === 'hours') {
    for (let i = 0; i < limit; i += 1) {
      results.push(new Date(cursor.getTime()));
      cursor = new Date(cursor.getTime() + intervalVal * 3600 * 1000);
    }
    return results;
  }

  // custom days with multiple times per day
  const startDay = new Date(baseStart.getFullYear(), baseStart.getMonth(), baseStart.getDate());
  for (let step = 0; step < 120 && results.length < limit; step += 1) {
    const day = addDays(startDay, step * intervalVal);
    for (const t of times) {
      const { h, m } = parseTimeParts(t);
      const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
      if (candidate.getTime() >= baseStart.getTime() - 1000) {
        results.push(candidate);
        if (results.length >= limit) break;
      }
    }
  }
  return results;
}

export function formatNextPreviewDate(date: Date): string {
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatReminderSummary(rule: ReminderRule | null): string {
  if (!rule || !rule.enabled) return '未设置提醒';

  if (rule.mode === 'standard') {
    if (!rule.nextAt || Number.isNaN(Date.parse(rule.nextAt))) return '常规提醒';
    const d = new Date(rule.nextAt);
    return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  const timesLabel = normalizeSortedTimes(rule.times).join('、');
  const stopLabel =
    rule.stopCondition === 'max_count' && rule.maxCount
      ? `限定 ${rule.maxCount} 次`
      : '直到完成';

  if (rule.frequency === 'daily') {
    return `每天 ${timesLabel} · ${stopLabel}`;
  }

  if (rule.frequency === 'weekly') {
    const sorted = [...(rule.weekdays ?? [])].sort((a, b) => a - b);
    const daysText =
      sorted.length === 7
        ? '每天'
        : sorted.length > 0
          ? `每周${sorted.map((d) => WEEKDAY_CN[d] ?? '').join('、')}`
          : '每周';
    return `${daysText} ${timesLabel} · ${stopLabel}`;
  }

  if (rule.frequency === 'month_day') {
    const mPart = rule.month ? `每年 ${rule.month} 月 ` : '每月 ';
    const dPart = `${rule.day ?? 1} 日`;
    return `${mPart}${dPart} ${timesLabel} · ${stopLabel}`;
  }

  const val = Math.max(1, rule.intervalValue ?? 1);
  if (rule.intervalUnit === 'hours') {
    return `每 ${val} 小时 · ${stopLabel}`;
  }
  return `每 ${val} 天 ${timesLabel} · ${stopLabel}`;
}

export function formatReminderChipLabel(
  rule: ReminderRule | null,
  now: Date = new Date(),
): string {
  if (!rule || !rule.enabled) return '';
  let target: Date | null = null;
  if (rule.nextAt && !Number.isNaN(Date.parse(rule.nextAt))) {
    target = new Date(rule.nextAt);
  } else {
    const upcoming = computeNextReminders(rule, 1, now);
    target = upcoming[0] ?? null;
  }
  if (!target) return rule.times[0] ?? '提醒';

  const todayKey = formatDateKey(now);
  const targetKey = formatDateKey(target);
  const hhmm = `${pad2(target.getHours())}:${pad2(target.getMinutes())}`;
  if (targetKey === todayKey) return hhmm;
  const diff = diffDays(todayKey, targetKey);
  if (diff === 1) return `明天 ${hhmm}`;
  return `${target.getMonth() + 1}/${target.getDate()} ${hhmm}`;
}

export function formatRepeatSummary(rule: RepeatRule | null): string {
  if (!rule || !rule.enabled) return '不重复';
  const interval = Math.max(1, rule.interval || 1);
  if (rule.frequency === 'daily') {
    return interval === 1 ? '每天' : `每 ${interval} 天`;
  }
  if (rule.frequency === 'weekly') {
    const sorted = [...(rule.weekdays ?? [])].sort((a, b) => a - b);
    if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) {
      return '工作日';
    }
    const dayStr = sorted.map((d) => WEEKDAY_CN[d] ?? '').join('、');
    if (interval === 1) {
      return dayStr ? `每${dayStr}` : '每周';
    }
    return dayStr ? `每 ${interval} 周 (${dayStr})` : `每 ${interval} 周`;
  }
  if (rule.frequency === 'monthly') {
    return interval === 1 ? '每月' : `每 ${interval} 个月`;
  }
  if (rule.frequency === 'yearly') {
    return interval === 1 ? '每年' : `每 ${interval} 年`;
  }
  return `每 ${interval} 天`;
}

export function computeNextRepeatDueDate(
  currentDueDate: string | null,
  rule: RepeatRule,
  now: Date = new Date(),
): string | null {
  if (!rule.enabled) return null;
  const base = currentDueDate ? parseDateKey(currentDueDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const interval = Math.max(1, rule.interval || 1);
  let next: Date;

  if (rule.frequency === 'daily' || rule.frequency === 'custom') {
    next = addDays(base, interval);
  } else if (rule.frequency === 'weekly') {
    const weekdays = [...(rule.weekdays ?? [])].sort((a, b) => a - b);
    if (weekdays.length > 0) {
      const currentIso = getIsoWeekday(base);
      const laterThisWeek = weekdays.find((w) => w > currentIso);
      if (laterThisWeek !== undefined && interval === 1) {
        next = addDays(base, laterThisWeek - currentIso);
      } else {
        const firstNextWeek = weekdays[0];
        const daysToNextMonday = 8 - currentIso + (interval - 1) * 7;
        next = addDays(base, daysToNextMonday + (firstNextWeek - 1));
      }
    } else {
      next = addDays(base, 7 * interval);
    }
  } else if (rule.frequency === 'monthly') {
    const targetDay = base.getDate();
    const targetMonthIndex = base.getMonth() + interval;
    const tentativeYear = base.getFullYear() + Math.floor(targetMonthIndex / 12);
    const tentativeMonth = targetMonthIndex % 12;
    const maxDay = new Date(tentativeYear, tentativeMonth + 1, 0).getDate();
    next = new Date(tentativeYear, tentativeMonth, Math.min(targetDay, maxDay));
  } else {
    const targetYear = base.getFullYear() + interval;
    const maxDay = new Date(targetYear, base.getMonth() + 1, 0).getDate();
    next = new Date(targetYear, base.getMonth(), Math.min(base.getDate(), maxDay));
  }

  const nextKey = formatDateKey(next);
  if (rule.endDate && nextKey > rule.endDate) {
    return null;
  }
  return nextKey;
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generates the next Todo occurrence when completing a repeating todo.
 */
export function spawnNextRepeatTodo(todo: TodoItem, now: Date = new Date()): TodoItem | null {
  if (!todo.repeatRule || !todo.repeatRule.enabled) return null;
  const nextDueDate = computeNextRepeatDueDate(todo.dueDate, todo.repeatRule, now);
  if (!nextDueDate) return null;

  const nowIso = now.toISOString();

  // Preserve multi-day span duration if present
  let nextEndDate: string | null = null;
  if (todo.dueDate && todo.endDate) {
    const span = diffDays(todo.dueDate, todo.endDate);
    if (span > 0) {
      nextEndDate = formatDateKey(addDays(parseDateKey(nextDueDate), span));
    }
  }

  // Shift reminder to the new due date if enabled
  let nextReminder: ReminderRule | null = null;
  if (todo.reminderRule && todo.reminderRule.enabled) {
    const timeStr = todo.reminderRule.times[0] ?? todo.dueTime ?? '09:00';
    const { h, m } = parseTimeParts(timeStr);
    const d = parseDateKey(nextDueDate);
    const remDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
    nextReminder = {
      ...todo.reminderRule,
      nextAt: remDate.toISOString(),
      triggeredCount: 0,
      lastTriggeredAt: null,
    };
  }

  return {
    ...todo,
    id: generateId('todo'),
    completed: false,
    completedAt: null,
    dueDate: nextDueDate,
    endDate: nextEndDate,
    subtasks: todo.subtasks.map((st) => ({
      ...st,
      id: generateId('sub'),
      completed: false,
      updatedAt: nowIso,
    })),
    reminderRule: nextReminder,
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
  };
}

/**
 * Classifies a todo into Q1..Q4 based on override or QuadrantRules.
 */
export function classifyTodoQuadrant(
  todo: TodoItem,
  rules: QuadrantRules,
  now: Date = new Date(),
): QuadrantId {
  if (todo.quadrantOverride) return todo.quadrantOverride;
  const important = rules.importantPriorities.includes(todo.priority);
  const todayKey = formatDateKey(now);
  let urgent = false;
  if (todo.dueDate) {
    const daysAway = diffDays(todayKey, todo.dueDate);
    urgent = daysAway <= rules.urgentWithinDays;
  }
  if (important && urgent) return 'q1';
  if (important && !urgent) return 'q2';
  if (!important && urgent) return 'q3';
  return 'q4';
}
