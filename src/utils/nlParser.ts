import type { ReminderRule, RepeatRule, TodoPriority } from '../types/models';
import { addDays, formatDateKey, getIsoWeekday, pad2 } from './lunar';

export type ParsedFieldKind = 'dueDate' | 'dueTime' | 'reminder' | 'priority' | 'repeat' | 'tag';

export interface ParsedField {
  kind: ParsedFieldKind;
  label: string;
  value: string;
  matchedText: string;
}

export interface ParsedTodoResult {
  rawTitle: string;
  cleanedTitle: string;
  hasMatches: boolean;
  matchedFields: ParsedField[];
  dueDate: string | null;
  dueTime: string | null;
  priority: TodoPriority | null;
  tags: string[];
  repeatRule: RepeatRule | null;
  reminderRule: ReminderRule | null;
}

const CN_WEEKDAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

const WEEKDAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function resolveWeekdayDate(targetIsoDay: number, now: Date, forceNextWeek: boolean): Date {
  const currentIso = getIsoWeekday(now);
  let delta = targetIsoDay - currentIso;
  if (forceNextWeek) {
    delta += 7;
  } else if (delta < 0) {
    delta += 7;
  }
  return addDays(now, delta);
}

function buildIsoFromDateAndTime(dateKey: string, timeStr: string): string {
  const [y, m, d] = dateKey.split('-').map((n) => Number.parseInt(n, 10));
  const [hh, mm] = timeStr.split(':').map((n) => Number.parseInt(n, 10));
  const local = new Date(y, (m || 1) - 1, d || 1, hh || 9, mm || 0, 0, 0);
  return local.toISOString();
}

export function parseTodoText(input: string, now: Date = new Date()): ParsedTodoResult {
  const rawTitle = input.trim();
  if (!rawTitle) {
    return {
      rawTitle: '',
      cleanedTitle: '',
      hasMatches: false,
      matchedFields: [],
      dueDate: null,
      dueTime: null,
      priority: null,
      tags: [],
      repeatRule: null,
      reminderRule: null,
    };
  }

  let working = rawTitle;
  const matchedFields: ParsedField[] = [];
  let dueDate: string | null = null;
  let dueTime: string | null = null;
  let priority: TodoPriority | null = null;
  const tags: string[] = [];
  let repeatRule: RepeatRule | null = null;
  let wantsReminder = false;
  let reminderOffsetMinutes = 0;

  const consume = (pattern: RegExp, onMatch: (m: RegExpExecArray) => boolean): void => {
    const m = pattern.exec(working);
    if (!m) return;
    if (onMatch(m)) {
      working = `${working.slice(0, m.index)} ${working.slice(m.index + m[0].length)}`;
    }
  };

  // 1. Tags: #工作 #项目
  const tagRegex = /#([\u4e00-\u9fa5A-Za-z0-9_-]{1,20})/g;
  const tagMatches = [...working.matchAll(tagRegex)];
  for (const m of tagMatches) {
    const tagName = m[1];
    if (tagName && !tags.includes(tagName)) {
      tags.push(tagName);
      matchedFields.push({
        kind: 'tag',
        label: '标签',
        value: `#${tagName}`,
        matchedText: m[0],
      });
    }
  }
  if (tagMatches.length > 0) {
    working = working.replace(tagRegex, ' ');
  }

  // 2. Recurrence rules (check BEFORE single weekday dates so "每周一" is recurrence, not just date)
  consume(
    /(每天|每日|every\s*day|daily)/i,
    (m) => {
      repeatRule = { enabled: true, frequency: 'daily', interval: 1, weekdays: [], endDate: null };
      matchedFields.push({ kind: 'repeat', label: '重复', value: '每天', matchedText: m[0] });
      return true;
    },
  );

  if (!repeatRule) {
    consume(
      /(每个?工作日|工作日|weekdays?)/i,
      (m) => {
        repeatRule = {
          enabled: true,
          frequency: 'weekly',
          interval: 1,
          weekdays: [1, 2, 3, 4, 5],
          endDate: null,
        };
        matchedFields.push({ kind: 'repeat', label: '重复', value: '工作日', matchedText: m[0] });
        return true;
      },
    );
  }

  if (!repeatRule) {
    consume(
      /每周(?:星期)?([一二三四五六日天])/,
      (m) => {
        const wk = CN_WEEKDAY_MAP[m[1]];
        if (!wk) return false;
        repeatRule = {
          enabled: true,
          frequency: 'weekly',
          interval: 1,
          weekdays: [wk],
          endDate: null,
        };
        const nextDate = resolveWeekdayDate(wk, now, false);
        if (!dueDate) {
          dueDate = formatDateKey(nextDate);
        }
        matchedFields.push({
          kind: 'repeat',
          label: '重复',
          value: `每${WEEKDAY_NAMES[wk]}`,
          matchedText: m[0],
        });
        return true;
      },
    );
  }

  if (!repeatRule) {
    consume(
      /每月(\d{1,2})[号日]/,
      (m) => {
        const dayNum = Number.parseInt(m[1], 10);
        if (dayNum < 1 || dayNum > 31) return false;
        repeatRule = {
          enabled: true,
          frequency: 'monthly',
          interval: 1,
          weekdays: [],
          endDate: null,
        };
        const candidate = new Date(now.getFullYear(), now.getMonth(), dayNum);
        if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
          candidate.setMonth(candidate.getMonth() + 1);
        }
        if (!dueDate) {
          dueDate = formatDateKey(candidate);
        }
        matchedFields.push({
          kind: 'repeat',
          label: '重复',
          value: `每月${dayNum}日`,
          matchedText: m[0],
        });
        return true;
      },
    );
  }

  if (!repeatRule) {
    consume(
      /(每周|每月|每年|weekly|monthly)/i,
      (m) => {
        const raw = m[1].toLowerCase();
        const freq =
          raw === '每月' || raw === 'monthly'
            ? 'monthly'
            : raw === '每年'
              ? 'yearly'
              : 'weekly';
        repeatRule = {
          enabled: true,
          frequency: freq,
          interval: 1,
          weekdays: freq === 'weekly' ? [getIsoWeekday(now)] : [],
          endDate: null,
        };
        matchedFields.push({
          kind: 'repeat',
          label: '重复',
          value: freq === 'monthly' ? '每月' : freq === 'yearly' ? '每年' : '每周',
          matchedText: m[0],
        });
        return true;
      },
    );
  }

  // 3. Priority
  const priorityMatchers: Array<{ re: RegExp; level: TodoPriority; label: string }> = [
    { re: /(非常重要|重要且紧急|高优先级|高优|紧急|重要|!高|!!|(?:\b[Pp]1\b))/, level: 'high', label: '高优先级' },
    { re: /(中优先级|中优|!中|(?:\b[Pp]2\b))/, level: 'medium', label: '中优先级' },
    { re: /(低优先级|低优|!低|(?:\b[Pp]3\b))/, level: 'low', label: '低优先级' },
  ];
  for (const pm of priorityMatchers) {
    if (priority) break;
    consume(pm.re, (m) => {
      priority = pm.level;
      matchedFields.push({ kind: 'priority', label: '优先级', value: pm.label, matchedText: m[0] });
      return true;
    });
  }

  // 4. Reminder triggers
  consume(/提前(\d{1,3})分钟提醒(?:我)?/, (m) => {
    wantsReminder = true;
    reminderOffsetMinutes = Number.parseInt(m[1], 10) || 0;
    matchedFields.push({
      kind: 'reminder',
      label: '提醒',
      value: `提前${reminderOffsetMinutes}分钟`,
      matchedText: m[0],
    });
    return true;
  });

  if (!wantsReminder) {
    consume(/(提醒我|设置提醒|提醒|remind\s*me|remind)/i, (m) => {
      wantsReminder = true;
      matchedFields.push({ kind: 'reminder', label: '提醒', value: '开启提醒', matchedText: m[0] });
      return true;
    });
  }

  // 5. Dates (explicit ISO / Chinese date / relative / weekday)
  consume(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, (m) => {
    const y = Number.parseInt(m[1], 10);
    const mo = Number.parseInt(m[2], 10);
    const d = Number.parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    dueDate = `${y}-${pad2(mo)}-${pad2(d)}`;
    matchedFields.push({ kind: 'dueDate', label: '日期', value: dueDate, matchedText: m[0] });
    return true;
  });

  if (!dueDate) {
    consume(/(\d{1,2})月(\d{1,2})[日号]?/, (m) => {
      const mo = Number.parseInt(m[1], 10);
      const d = Number.parseInt(m[2], 10);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
      let year = now.getFullYear();
      const candidate = new Date(year, mo - 1, d);
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (candidate.getTime() < todayStart.getTime() - 86400000 * 30) {
        year += 1;
      }
      dueDate = `${year}-${pad2(mo)}-${pad2(d)}`;
      matchedFields.push({ kind: 'dueDate', label: '日期', value: `${mo}月${d}日`, matchedText: m[0] });
      return true;
    });
  }

  if (!dueDate) {
    consume(/(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/, (m) => {
      const mo = Number.parseInt(m[1], 10);
      const d = Number.parseInt(m[2], 10);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
      const year = now.getFullYear();
      dueDate = `${year}-${pad2(mo)}-${pad2(d)}`;
      matchedFields.push({ kind: 'dueDate', label: '日期', value: `${mo}/${d}`, matchedText: m[0] });
      return true;
    });
  }

  if (!dueDate) {
    consume(/(大后天|后天|明天|明日|明早|明晚|今天|今日|今早|今晚|tomorrow|today)/i, (m) => {
      const token = m[1].toLowerCase();
      let offset = 0;
      let display = '今天';
      if (token === '大后天') {
        offset = 3;
        display = '大后天';
      } else if (token === '后天') {
        offset = 2;
        display = '后天';
      } else if (token === '明天' || token === '明日' || token === '明早' || token === '明晚' || token === 'tomorrow') {
        offset = 1;
        display = '明天';
      } else {
        offset = 0;
        display = '今天';
      }
      dueDate = formatDateKey(addDays(now, offset));
      matchedFields.push({ kind: 'dueDate', label: '日期', value: `${display} (${dueDate.slice(5)})`, matchedText: m[0] });

      // Keep period hint for time parsing if token was 明早/明晚/今早/今晚
      if (token === '明早' || token === '今早') {
        working = `${working.slice(0, m.index)} 早上 ${working.slice(m.index + m[0].length)}`;
        return false;
      }
      if (token === '明晚' || token === '今晚') {
        working = `${working.slice(0, m.index)} 晚上 ${working.slice(m.index + m[0].length)}`;
        return false;
      }
      return true;
    });
  }

  if (!dueDate) {
    consume(/(下周|下星期|本周|这周|周|星期)([一二三四五六日天])/, (m) => {
      const prefix = m[1];
      const wk = CN_WEEKDAY_MAP[m[2]];
      if (!wk) return false;
      const forceNext = prefix === '下周' || prefix === '下星期';
      const resolved = resolveWeekdayDate(wk, now, forceNext);
      dueDate = formatDateKey(resolved);
      matchedFields.push({
        kind: 'dueDate',
        label: '日期',
        value: `${forceNext ? '下' : ''}${WEEKDAY_NAMES[wk]} (${dueDate.slice(5)})`,
        matchedText: m[0],
      });
      return true;
    });
  }

  // 6. Times (HH:mm, Chinese 下午3点半, English 3:30pm)
  consume(/(上午|早上|早|清晨|中午|下午|傍晚|晚上)?\s*(\d{1,2}):(\d{2})\s*(am|pm)?/i, (m) => {
    const period = m[1] ?? '';
    let hh = Number.parseInt(m[2], 10);
    const mm = Number.parseInt(m[3], 10);
    const ampm = (m[4] ?? '').toLowerCase();
    if (hh > 23 || mm > 59) return false;
    if ((period === '下午' || period === '傍晚' || period === '晚上' || ampm === 'pm') && hh < 12) {
      hh += 12;
    } else if ((period === '中午') && hh >= 1 && hh <= 5) {
      hh += 12;
    } else if (ampm === 'am' && hh === 12) {
      hh = 0;
    }
    dueTime = `${pad2(hh)}:${pad2(mm)}`;
    matchedFields.push({ kind: 'dueTime', label: '时段', value: dueTime, matchedText: m[0].trim() });
    return true;
  });

  if (!dueTime) {
    consume(/(上午|早上|早|清晨|中午|下午|傍晚|晚上)?\s*(\d{1,2})点(?:(半)|(\d{1,2})分?)?/, (m) => {
      const period = m[1] ?? '';
      let hh = Number.parseInt(m[2], 10);
      const isHalf = Boolean(m[3]);
      const mm = isHalf ? 30 : m[4] ? Number.parseInt(m[4], 10) : 0;
      if (hh > 23 || mm > 59) return false;
      if ((period === '下午' || period === '傍晚' || period === '晚上') && hh < 12) {
        hh += 12;
      } else if (period === '中午' && hh >= 1 && hh <= 5) {
        hh += 12;
      }
      dueTime = `${pad2(hh)}:${pad2(mm)}`;
      matchedFields.push({ kind: 'dueTime', label: '时段', value: dueTime, matchedText: m[0].trim() });
      return true;
    });
  }

  if (!dueTime) {
    consume(/\b(\d{1,2})\s*(am|pm)\b/i, (m) => {
      let hh = Number.parseInt(m[1], 10);
      const ampm = m[2].toLowerCase();
      if (hh < 1 || hh > 12) return false;
      if (ampm === 'pm' && hh < 12) hh += 12;
      if (ampm === 'am' && hh === 12) hh = 0;
      dueTime = `${pad2(hh)}:00`;
      matchedFields.push({ kind: 'dueTime', label: '时段', value: dueTime, matchedText: m[0] });
      return true;
    });
  }

  // Clean stray period keywords left over if 明早/今晚 was combined without an explicit hour
  working = working.replace(/\s+/g, ' ').replace(/^[，,、。\s]+|[，,、。\s]+$/g, '').trim();

  // Build ReminderRule if requested
  let reminderRule: ReminderRule | null = null;
  if (wantsReminder) {
    const remDate = dueDate ?? formatDateKey(now);
    const remTime = dueTime ?? `${pad2(Math.min(23, now.getHours() + 1))}:00`;
    let nextDateObj = new Date(buildIsoFromDateAndTime(remDate, remTime));
    if (reminderOffsetMinutes > 0) {
      nextDateObj = new Date(nextDateObj.getTime() - reminderOffsetMinutes * 60000);
    }
    const finalTimeStr = `${pad2(nextDateObj.getHours())}:${pad2(nextDateObj.getMinutes())}`;
    reminderRule = {
      enabled: true,
      nextAt: nextDateObj.toISOString(),
      mode: 'standard',
      frequency: 'daily',
      weekdays: [],
      month: null,
      day: null,
      intervalValue: null,
      intervalUnit: null,
      times: [finalTimeStr],
      stopCondition: 'until_complete',
      maxCount: null,
      triggeredCount: 0,
      lastTriggeredAt: null,
    };
  }

  const cleanedTitle = working.length > 0 ? working : rawTitle;

  return {
    rawTitle,
    cleanedTitle,
    hasMatches: matchedFields.length > 0,
    matchedFields,
    dueDate,
    dueTime,
    priority,
    tags,
    repeatRule,
    reminderRule,
  };
}

/**
 * Splits multi-line pasted text into clean todo titles, stripping list prefixes.
 */
export function parseBatchLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•·]\s+/, '')
        .replace(/^\[[ xX✓]?\]\s*/, '')
        .replace(/^\d+[.、)\]]\s+/, '')
        .trim(),
    )
    .filter((line) => line.length > 0);
}
