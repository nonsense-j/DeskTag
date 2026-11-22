/**
 * Pure TypeScript Chinese Lunar Calendar converter (1900–2100) + date utilities.
 * Zero external dependencies.
 */

// Standard astronomical lunar calendar table for years 1900–2100.
// Bits 0..3: leap month (0 if none)
// Bits 4..15: 12 months (1 = 30 days, 0 = 29 days, month 1 is bit 15)
// Bit 16: leap month days (1 = 30 days, 0 = 29 days)
const LUNAR_INFO: number[] = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520,
];

const LUNAR_MONTH_NAMES = [
  '正月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '冬月',
  '腊月',
];

const LUNAR_DAY_TENS = ['初', '十', '廿', '三'];
const LUNAR_DAY_ONES = ['日', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const LUNAR_FESTIVALS: Record<string, string> = {
  '1-1': '春节',
  '1-15': '元宵',
  '5-5': '端午',
  '7-7': '七夕',
  '8-15': '中秋',
  '9-9': '重阳',
  '12-8': '腊八',
};

const SOLAR_FESTIVALS: Record<string, string> = {
  '1-1': '元旦',
  '5-1': '劳动节',
  '10-1': '国庆',
};

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const JS_WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export interface LunarDateInfo {
  year: number;
  month: number;
  day: number;
  isLeap: boolean;
  monthLabel: string;
  dayLabel: string;
  festival: string | null;
  label: string;
}

function leapMonth(year: number): number {
  const info = LUNAR_INFO[year - 1900] ?? 0;
  return info & 0xf;
}

function leapDays(year: number): number {
  if (leapMonth(year) === 0) return 0;
  const info = LUNAR_INFO[year - 1900] ?? 0;
  return (info & 0x10000) !== 0 ? 30 : 29;
}

function monthDays(year: number, month: number): number {
  const info = LUNAR_INFO[year - 1900] ?? 0;
  return (info & (0x10000 >> month)) !== 0 ? 30 : 29;
}

function lunarYearDays(year: number): number {
  let sum = 348;
  const info = LUNAR_INFO[year - 1900] ?? 0;
  for (let bit = 0x8000; bit > 0x8; bit >>= 1) {
    if ((info & bit) !== 0) sum += 1;
  }
  return sum + leapDays(year);
}

function formatLunarDay(day: number): string {
  if (day === 10) return '初十';
  if (day === 20) return '二十';
  if (day === 30) return '三十';
  const tens = Math.floor(day / 10);
  const ones = day % 10;
  return `${LUNAR_DAY_TENS[tens] ?? ''}${LUNAR_DAY_ONES[ones] ?? ''}`;
}

export function solarToLunar(year: number, month: number, day: number): LunarDateInfo {
  if (year < 1900 || year > 2100) {
    return {
      year,
      month,
      day,
      isLeap: false,
      monthLabel: '',
      dayLabel: '',
      festival: null,
      label: '',
    };
  }

  const baseUtc = Date.UTC(1900, 0, 31);
  const targetUtc = Date.UTC(year, month - 1, day);
  let offset = Math.floor((targetUtc - baseUtc) / 86400000);

  if (offset < 0) {
    return {
      year: 1900,
      month: 1,
      day: 1,
      isLeap: false,
      monthLabel: '正月',
      dayLabel: '初一',
      festival: '春节',
      label: '春节',
    };
  }

  let lYear = 1900;
  let daysInYear = 0;
  for (; lYear < 2101 && offset > 0; lYear += 1) {
    daysInYear = lunarYearDays(lYear);
    if (offset < daysInYear) break;
    offset -= daysInYear;
  }

  const leap = leapMonth(lYear);
  let isLeap = false;
  let lMonth = 1;

  for (let m = 1; m <= 12; m += 1) {
    const regularDays = monthDays(lYear, m);
    if (offset < regularDays) {
      lMonth = m;
      isLeap = false;
      break;
    }
    offset -= regularDays;

    if (leap === m) {
      const lDays = leapDays(lYear);
      if (offset < lDays) {
        lMonth = m;
        isLeap = true;
        break;
      }
      offset -= lDays;
    }
  }

  const lDay = offset + 1;
  const rawMonthName = LUNAR_MONTH_NAMES[lMonth - 1] ?? `${lMonth}月`;
  const monthLabel = isLeap ? `闰${rawMonthName}` : rawMonthName;
  const dayLabel = formatLunarDay(lDay);

  const lunarFestKey = !isLeap ? `${lMonth}-${lDay}` : '';
  const solarFestKey = `${month}-${day}`;
  const festival = LUNAR_FESTIVALS[lunarFestKey] ?? SOLAR_FESTIVALS[solarFestKey] ?? null;

  const label = festival ?? (lDay === 1 ? monthLabel : dayLabel);

  return {
    year: lYear,
    month: lMonth,
    day: lDay,
    isLeap,
    monthLabel,
    dayLabel,
    festival,
    label,
  };
}

export function getLunarDayLabel(year: number, month: number, day: number): string {
  return solarToLunar(year, month, day).label;
}

// ---------------------------------------------------------------------------
// Date Formatting & Grid Helpers
// ---------------------------------------------------------------------------

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map((n) => Number.parseInt(n, 10));
  return new Date(y || 2026, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

export function getTodayKey(now: Date = new Date()): string {
  return formatDateKey(now);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return next;
}

export function diffDays(fromKey: string, toKey: string): number {
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey);
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86400000);
}

/** ISO weekday: 1 = Monday .. 7 = Sunday */
export function getIsoWeekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

export interface WeekRangeResult {
  start: Date;
  end: Date;
  startKey: string;
  endKey: string;
  days: Date[];
}

export function getWeekRange(anchor: Date = new Date()): WeekRangeResult {
  const isoDay = getIsoWeekday(anchor);
  const start = addDays(anchor, -(isoDay - 1));
  const days: Date[] = [];
  for (let i = 0; i < 7; i += 1) {
    days.push(addDays(start, i));
  }
  const end = days[6];
  return {
    start,
    end,
    startKey: formatDateKey(start),
    endKey: formatDateKey(end),
    days,
  };
}

export function getMonthRange(
  year: number,
  month: number,
): { start: Date; end: Date; startKey: string; endKey: string } {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    start,
    end,
    startKey: formatDateKey(start),
    endKey: formatDateKey(end),
  };
}

export interface MonthGridCell {
  date: Date;
  dateKey: string;
  dayOfMonth: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  lunarLabel: string;
}

export function getMonthGrid(year: number, month: number, now: Date = new Date()): MonthGridCell[] {
  const firstOfMonth = new Date(year, month - 1, 1);
  const offsetToMonday = getIsoWeekday(firstOfMonth) - 1;
  const gridStart = addDays(firstOfMonth, -offsetToMonday);
  const todayKey = formatDateKey(now);

  const cells: MonthGridCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = addDays(gridStart, i);
    const dateKey = formatDateKey(date);
    cells.push({
      date,
      dateKey,
      dayOfMonth: date.getDate(),
      inCurrentMonth: date.getMonth() === month - 1,
      isToday: dateKey === todayKey,
      lunarLabel: getLunarDayLabel(date.getFullYear(), date.getMonth() + 1, date.getDate()),
    });
  }
  return cells;
}

export function formatHeaderDate(date: Date = new Date()): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const wk = JS_WEEKDAY_CN[date.getDay()] ?? '';
  return `${m}月${d}日 ${wk}`;
}

export function formatWeekRangeLabel(start: Date, end: Date): string {
  const sy = start.getFullYear();
  const sm = pad2(start.getMonth() + 1);
  const sd = pad2(start.getDate());
  const ey = end.getFullYear();
  const em = pad2(end.getMonth() + 1);
  const ed = pad2(end.getDate());
  if (sy === ey) {
    return `${sy}/${sm}/${sd} — ${em}/${ed}`;
  }
  return `${sy}/${sm}/${sd} — ${ey}/${em}/${ed}`;
}

export function formatShortDueDate(
  dueDate: string | null,
  dueTime?: string | null,
  now: Date = new Date(),
): string {
  if (!dueDate) {
    return dueTime ?? '';
  }
  const todayKey = formatDateKey(now);
  const diff = diffDays(todayKey, dueDate);

  if (diff === 0) {
    return dueTime ? dueTime : '今天';
  }
  if (diff === 1) {
    return dueTime ? `明天 ${dueTime}` : '明天';
  }
  if (diff === -1) {
    return dueTime ? `昨天 ${dueTime}` : '昨天';
  }

  const parsed = parseDateKey(dueDate);
  const mmdd = `${parsed.getMonth() + 1}/${parsed.getDate()}`;
  return dueTime ? `${mmdd} ${dueTime}` : mmdd;
}

export function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return '未同步';
  const ts = Date.parse(isoString);
  if (Number.isNaN(ts)) return '刚刚';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 45) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return '昨天';
  if (diffDay < 7) return `${diffDay} 天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatTimeHMS(date: Date = new Date()): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatTimestampYMDHM(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
