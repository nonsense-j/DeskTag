import React, { useEffect, useMemo, useState } from 'react';
import { useDeskTagStore } from '../store/useDeskTagStore';
import type {
  ReminderFrequency,
  ReminderIntervalUnit,
  ReminderRule,
} from '../types/models';
import {
  WEEKDAY_LABELS,
  addDays,
  formatDateKey,
  formatTimestampYMDHM,
  pad2,
  parseDateKey,
} from '../utils/lunar';
import {
  computeNextReminders,
  createDefaultReminderRule,
  formatNextPreviewDate,
  formatReminderSummary,
} from '../utils/recurrence';
import {
  BellIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  PlusIcon,
} from './Icons';

function combineLocalDateAndTime(dateKey: string, timeStr: string): string {
  const d = parseDateKey(dateKey);
  const [hh, mm] = timeStr.split(':').map((n) => Number.parseInt(n, 10));
  const merged = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    Number.isFinite(hh) ? hh : 9,
    Number.isFinite(mm) ? mm : 0,
    0,
    0,
  );
  return merged.toISOString();
}

export const ReminderModal: React.FC = () => {
  const { reminderTodoId, activeTodos, setReminderTodoId, updateTodo, showToast } = useDeskTagStore();

  const todo = useMemo(
    () => (reminderTodoId ? activeTodos.find((t) => t.id === reminderTodoId) ?? null : null),
    [activeTodos, reminderTodoId],
  );

  const [draft, setDraft] = useState<ReminderRule>(() => createDefaultReminderRule());
  const [dateInput, setDateInput] = useState<string>(() => formatDateKey(new Date()));
  const [timeInput, setTimeInput] = useState<string>('09:00');
  const [editingAnchor, setEditingAnchor] = useState(false);
  const [expandPreview, setExpandPreview] = useState(false);

  // Sync draft when opening for a specific todo
  useEffect(() => {
    if (!todo) return;
    if (todo.reminderRule && todo.reminderRule.enabled) {
      const existing = {
        ...createDefaultReminderRule(),
        ...todo.reminderRule,
        times: todo.reminderRule.times.length > 0 ? [...todo.reminderRule.times] : ['09:00'],
      };
      setDraft(existing);
      const anchor = existing.nextAt ? new Date(existing.nextAt) : new Date();
      setDateInput(formatDateKey(anchor));
      setTimeInput(`${pad2(anchor.getHours())}:${pad2(anchor.getMinutes())}`);
    } else {
      const base = todo.dueDate ? parseDateKey(todo.dueDate) : new Date();
      const baseTime = todo.dueTime || `${pad2(Math.min(23, new Date().getHours() + 1))}:00`;
      const initial = createDefaultReminderRule(base, baseTime);
      setDraft(initial);
      setDateInput(formatDateKey(base));
      setTimeInput(baseTime);
    }
    setEditingAnchor(false);
    setExpandPreview(false);
  }, [todo]);

  const effectiveRule: ReminderRule = useMemo(
    () => ({
      ...draft,
      enabled: true,
      nextAt: combineLocalDateAndTime(dateInput, timeInput),
    }),
    [dateInput, draft, timeInput],
  );

  const upcomingList = useMemo(
    () => computeNextReminders(effectiveRule, expandPreview ? 12 : 4, new Date()),
    [effectiveRule, expandPreview],
  );

  if (!todo) return null;

  const isAdvanced = draft.mode === 'recurring';

  const applyQuickPick = (dateObj: Date) => {
    const dk = formatDateKey(dateObj);
    const tk = `${pad2(dateObj.getHours())}:${pad2(dateObj.getMinutes())}`;
    setDateInput(dk);
    setTimeInput(tk);
    setDraft((prev) => ({
      ...prev,
      mode: 'standard',
      times: [tk],
      nextAt: dateObj.toISOString(),
    }));
  };

  const quickPicks = (() => {
    const now = new Date();
    const picks: Array<{ label: string; date: Date }> = [
      { label: '15 分钟后', date: new Date(now.getTime() + 15 * 60000) },
      { label: '1 小时后', date: new Date(now.getTime() + 60 * 60000) },
      {
        label: '今天 18:00',
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0, 0),
      },
      {
        label: '明天 09:00',
        date: new Date(addDays(now, 1).getFullYear(), addDays(now, 1).getMonth(), addDays(now, 1).getDate(), 9, 0, 0, 0),
      },
    ];
    if (todo.dueDate) {
      const dd = parseDateKey(todo.dueDate);
      const [h, m] = (todo.dueTime || '09:00').split(':').map((n) => Number.parseInt(n, 10));
      picks.unshift({
        label: `按待办时间 (${todo.dueTime || '09:00'})`,
        date: new Date(dd.getFullYear(), dd.getMonth(), dd.getDate(), h || 9, m || 0, 0, 0),
      });
    }
    return picks;
  })();

  const toggleWeekday = (isoDay: number) => {
    setDraft((prev) => {
      const cur = prev.weekdays ?? [];
      const next = cur.includes(isoDay)
        ? cur.filter((d) => d !== isoDay)
        : [...cur, isoDay].sort((a, b) => a - b);
      return { ...prev, weekdays: next.length > 0 ? next : [isoDay] };
    });
  };

  const updateTimeSlot = (idx: number, val: string) => {
    setDraft((prev) => ({
      ...prev,
      times: prev.times.map((t, i) => (i === idx ? val : t)),
    }));
  };

  const removeTimeSlot = (idx: number) => {
    setDraft((prev) => {
      if (prev.times.length <= 1) return prev;
      return { ...prev, times: prev.times.filter((_, i) => i !== idx) };
    });
  };

  const addTimeSlot = () => {
    setDraft((prev) => {
      const last = prev.times[prev.times.length - 1] ?? '09:00';
      const [hRaw] = last.split(':');
      const nextH = (Number.parseInt(hRaw ?? '9', 10) + 2) % 24;
      const nextTime = `${pad2(nextH)}:00`;
      return { ...prev, times: [...prev.times, nextTime] };
    });
  };

  const handleSave = () => {
    const firstUpcoming = upcomingList[0];
    const finalRule: ReminderRule = {
      ...effectiveRule,
      enabled: true,
      nextAt:
        effectiveRule.mode === 'recurring' && firstUpcoming
          ? firstUpcoming.toISOString()
          : effectiveRule.nextAt,
      times:
        effectiveRule.mode === 'standard'
          ? [timeInput]
          : effectiveRule.times.filter(Boolean),
    };
    updateTodo(todo.id, { reminderRule: finalRule });
    setReminderTodoId(null);
    showToast('已更新提醒设置');
  };

  const handleClearReminder = () => {
    updateTodo(todo.id, { reminderRule: null });
    setReminderTodoId(null);
    showToast('已关闭该待办提醒');
  };

  return (
    <div className="modal-overlay" onClick={() => setReminderTodoId(null)}>
      <div
        className="modal-card"
        style={{ maxWidth: 468 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="设置提醒"
      >
        <div className="modal-header">
          <h3 className="modal-title">设置提醒</h3>
          <button
            type="button"
            className="header-icon-btn"
            onClick={() => setReminderTodoId(null)}
            aria-label="关闭"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="modal-body">
          {!isAdvanced ? (
            <>
              {/* Standard Reminder Mode */}
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                待办：<strong style={{ color: 'var(--text-primary)' }}>{todo.title}</strong>
              </div>

              <div>
                <span className="field-label">快捷选择</span>
                <div className="pill-group">
                  {quickPicks.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className="pill-option"
                      onClick={() => applyQuickPick(p.date)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-grid-2">
                <div>
                  <label className="field-label" htmlFor="rem-date">
                    提醒日期
                  </label>
                  <input
                    id="rem-date"
                    type="date"
                    className="field-input"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="rem-time">
                    提醒时间
                  </label>
                  <input
                    id="rem-time"
                    type="time"
                    className="field-input"
                    value={timeInput}
                    onChange={(e) => setTimeInput(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="button"
                className="reminder-current-card"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    mode: 'recurring',
                    times: prev.times.length > 0 ? prev.times : [timeInput],
                  }))
                }
              >
                <div className="reminder-current-left">
                  <span className="reminder-bell-badge">
                    <BellIcon size={16} />
                  </span>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                      高级循环提醒
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      支持每周多日、每日多时段、直到完成或限定次数
                    </div>
                  </div>
                </div>
                <ChevronRightIcon size={16} style={{ color: 'var(--text-muted)' }} />
              </button>
            </>
          ) : (
            <>
              {/* Advanced Recurring Reminder Mode */}
              <button
                type="button"
                className="reminder-back-link"
                onClick={() => setDraft((prev) => ({ ...prev, mode: 'standard' }))}
              >
                <ChevronLeftIcon size={14} />
                <span>返回常规提醒</span>
              </button>

              {/* Current Reminder Time Card */}
              <div className="reminder-current-card">
                <div className="reminder-current-left">
                  <span className="reminder-bell-badge">
                    <BellIcon size={17} />
                  </span>
                  <div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>当前提醒时间</div>
                    <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {formatTimestampYMDHM(effectiveRule.nextAt || new Date())}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => setEditingAnchor((v) => !v)}
                >
                  {editingAnchor ? '收起' : '修改'}
                </button>
              </div>

              {editingAnchor && (
                <div className="form-grid-2">
                  <input
                    type="date"
                    className="field-input"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                  />
                  <input
                    type="time"
                    className="field-input"
                    value={timeInput}
                    onChange={(e) => setTimeInput(e.target.value)}
                  />
                </div>
              )}

              {/* Frequency */}
              <div className="reminder-row">
                <span className="reminder-row-label">循环提醒</span>
                <div className="reminder-row-content">
                  <select
                    className="field-select"
                    style={{ width: 'auto', minWidth: 132 }}
                    value={draft.frequency}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        frequency: e.target.value as ReminderFrequency,
                      }))
                    }
                  >
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                    <option value="month_day">指定月份与日期</option>
                    <option value="custom">自定义间隔</option>
                  </select>
                </div>
              </div>

              {/* Weekly Weekday Pills */}
              {draft.frequency === 'weekly' && (
                <div className="reminder-row">
                  <span className="reminder-row-label">提醒星期</span>
                  <div className="reminder-row-content">
                    {WEEKDAY_LABELS.map((label, idx) => {
                      const dNum = idx + 1;
                      const selected = (draft.weekdays ?? []).includes(dNum);
                      return (
                        <button
                          key={label}
                          type="button"
                          className={`weekday-pill${selected ? ' selected' : ''}`}
                          onClick={() => toggleWeekday(dNum)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Month & Day Selector */}
              {draft.frequency === 'month_day' && (
                <div className="reminder-row">
                  <span className="reminder-row-label">月 / 日</span>
                  <div className="reminder-row-content">
                    <select
                      className="field-select"
                      style={{ width: 100 }}
                      value={draft.month ?? ''}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          month: e.target.value ? Number(e.target.value) : null,
                        }))
                      }
                    >
                      <option value="">每月</option>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>
                          {m} 月
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      className="field-input"
                      style={{ width: 82 }}
                      value={draft.day ?? 1}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          day: Math.max(1, Math.min(31, Number(e.target.value) || 1)),
                        }))
                      }
                    />
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>日</span>
                  </div>
                </div>
              )}

              {/* Custom Interval */}
              {draft.frequency === 'custom' && (
                <div className="reminder-row">
                  <span className="reminder-row-label">间隔周期</span>
                  <div className="reminder-row-content">
                    <span style={{ fontSize: 13 }}>每</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      className="field-input"
                      style={{ width: 76 }}
                      value={draft.intervalValue ?? 1}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          intervalValue: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                    />
                    <select
                      className="field-select"
                      style={{ width: 92 }}
                      value={draft.intervalUnit ?? 'days'}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          intervalUnit: e.target.value as ReminderIntervalUnit,
                        }))
                      }
                    >
                      <option value="hours">小时</option>
                      <option value="days">天</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Multi-times per day */}
              {!(draft.frequency === 'custom' && draft.intervalUnit === 'hours') && (
                <div className="reminder-row">
                  <span className="reminder-row-label">提醒时间</span>
                  <div className="reminder-row-content">
                    {draft.times.map((t, idx) => (
                      <div key={idx} className="time-chip-editor">
                        <input
                          type="time"
                          value={t}
                          onChange={(e) => updateTimeSlot(idx, e.target.value)}
                          aria-label={`提醒时间 ${idx + 1}`}
                        />
                        {draft.times.length > 1 && (
                          <button
                            type="button"
                            className="mini-icon-btn"
                            style={{ width: 18, height: 18 }}
                            onClick={() => removeTimeSlot(idx)}
                            aria-label="删除时间点"
                          >
                            <CloseIcon size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      style={{ width: 32, padding: 0 }}
                      onClick={addTimeSlot}
                      title="添加每日提醒时间点"
                      aria-label="添加时间点"
                    >
                      <PlusIcon size={14} />
                    </button>
                  </div>
                </div>
              )}

              {/* Stop Condition */}
              <div className="reminder-row">
                <span className="reminder-row-label">停止条件</span>
                <div className="reminder-row-content">
                  <button
                    type="button"
                    className={`pill-option${draft.stopCondition === 'until_complete' ? ' selected' : ''}`}
                    onClick={() => setDraft((prev) => ({ ...prev, stopCondition: 'until_complete' }))}
                  >
                    直到完成
                  </button>
                  <button
                    type="button"
                    className={`pill-option${draft.stopCondition === 'max_count' ? ' selected' : ''}`}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        stopCondition: 'max_count',
                        maxCount: prev.maxCount || 5,
                      }))
                    }
                  >
                    限定次数
                  </button>
                  {draft.stopCondition === 'max_count' && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        className="field-input"
                        style={{ width: 66, padding: '4px 8px' }}
                        value={draft.maxCount ?? 5}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            maxCount: Math.max(1, Number(e.target.value) || 1),
                          }))
                        }
                      />
                      <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>次</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Live Summary & Upcoming Preview Card */}
              <div className="reminder-preview-box">
                <div className="reminder-preview-summary">{formatReminderSummary(effectiveRule)}</div>
                <div className="reminder-preview-next">
                  <div style={{ flex: 1, lineHeight: 1.6 }}>
                    <span>接下来：</span>
                    {upcomingList.length > 0 ? (
                      upcomingList.map((d, i) => (
                        <span key={i} style={{ marginRight: 10 }}>
                          {formatNextPreviewDate(d)}
                        </span>
                      ))
                    ) : (
                      <span>暂无待触发时间</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="mini-icon-btn"
                    onClick={() => setExpandPreview((v) => !v)}
                    title={expandPreview ? '收起预览' : '展开更多触发时间'}
                  >
                    <ChevronDownIcon
                      size={14}
                      style={{ transform: expandPreview ? 'rotate(180deg)' : undefined }}
                    />
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Primary CTA */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn-primary btn-block" onClick={handleSave}>
              设置提醒
            </button>
            {todo.reminderRule?.enabled && (
              <button
                type="button"
                className="btn btn-outline btn-block"
                style={{ height: 34, fontSize: 13 }}
                onClick={handleClearReminder}
              >
                关闭提醒
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
