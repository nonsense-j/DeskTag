import React, { useEffect, useMemo, useState } from 'react';
import { Bell, BellOff, ChevronDown, Clock, Plus, X } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Frame, FramePanel } from '@/components/ui/frame';
import { Input } from '@/components/ui/input';
import { RadioGroupPrimitive, RadioPrimitive } from '@/components/ui/radio-group';
import { SegmentedControl, SegmentedControlItem } from '@/components/ui/segmented-control';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const FREQUENCY_OPTIONS: Array<{ value: ReminderFrequency; label: string }> = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'month_day', label: '指定月份与日期' },
  { value: 'custom', label: '自定义间隔' },
];

const INTERVAL_UNIT_OPTIONS: Array<{ value: ReminderIntervalUnit; label: string }> = [
  { value: 'hours', label: '小时' },
  { value: 'days', label: '天' },
];

const MONTH_OPTIONS = [
  { value: 'every', label: '每月' },
  ...Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1} 月`,
  })),
];

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
  const { reminderTodoId, activeTodos, setReminderTodoId, updateTodo, showToast } =
    useDeskTagStore();

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

  const quickPicks = useMemo(() => {
    const now = new Date();
    const tomorrow = addDays(now, 1);
    const picks: Array<{ label: string; date: Date }> = [
      { label: '15 分钟后', date: new Date(now.getTime() + 15 * 60000) },
      { label: '1 小时后', date: new Date(now.getTime() + 60 * 60000) },
      {
        label: '今天 18:00',
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0, 0),
      },
      {
        label: '明天 09:00',
        date: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 0, 0, 0),
      },
    ];
    if (todo?.dueDate) {
      const dd = parseDateKey(todo.dueDate);
      const [h, m] = (todo.dueTime || '09:00').split(':').map((n) => Number.parseInt(n, 10));
      picks.unshift({
        label: `按待办时间 (${todo.dueTime || '09:00'})`,
        date: new Date(dd.getFullYear(), dd.getMonth(), dd.getDate(), h || 9, m || 0, 0, 0),
      });
    }
    return picks;
  }, [todo]);

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
    if (!todo) return;
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
    if (!todo) return;
    updateTodo(todo.id, { reminderRule: null });
    setReminderTodoId(null);
    showToast('已关闭该待办提醒');
  };

  const activeMode = draft.mode === 'recurring' ? 'recurring' : 'standard';

  return (
    <Dialog
      open={Boolean(todo)}
      onOpenChange={(open) => {
        if (!open) setReminderTodoId(null);
      }}
    >
      <DialogPopup
        className="max-h-[min(86vh,600px)] max-w-[468px] overflow-hidden"
        closeProps={{ 'aria-label': '关闭提醒设置' }}
      >
        <DialogHeader className="shrink-0 px-4 pt-3.5 pb-2">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold">
            <Bell className="size-4 text-muted-foreground" />
            <span>设置提醒</span>
          </DialogTitle>
          {todo && (
            <DialogDescription className="truncate text-xs">
              待办：{todo.title || '未命名待办'}
            </DialogDescription>
          )}
        </DialogHeader>

        {todo && (
          <>
            <DialogPanel className="flex flex-col gap-3 px-4 pt-1 pb-4">
              <Tabs
                value={activeMode}
                onValueChange={(val) => {
                  if (val === 'standard') {
                    setDraft((prev) => ({ ...prev, mode: 'standard' }));
                  } else if (val === 'recurring') {
                    setDraft((prev) => ({
                      ...prev,
                      mode: 'recurring',
                      times: prev.times.length > 0 ? prev.times : [timeInput],
                    }));
                  }
                }}
                className="gap-3"
              >
                <TabsList variant="default" size="sm" className="w-full">
                  <TabsTab value="standard" className="flex-1 text-xs">
                    快捷提醒
                  </TabsTab>
                  <TabsTab value="recurring" className="flex-1 text-xs">
                    高级重复
                  </TabsTab>
                </TabsList>

                {/* Tab 1: Quick Standard Reminder */}
                <TabsPanel value="standard" className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">快捷选择</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {quickPicks.map((p) => (
                        <Button
                          key={p.label}
                          size="sm"
                          variant="outline"
                          onClick={() => applyQuickPick(p.date)}
                          className="justify-start gap-1.5 text-xs font-normal"
                        >
                          <Clock className="size-3.5 text-muted-foreground" />
                          <span className="truncate">{p.label}</span>
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <Field>
                      <FieldLabel className="text-xs">提醒日期</FieldLabel>
                      <Input
                        size="sm"
                        type="date"
                        value={dateInput}
                        onChange={(e) => setDateInput(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs">提醒时间</FieldLabel>
                      <Input
                        size="sm"
                        type="time"
                        value={timeInput}
                        onChange={(e) => setTimeInput(e.target.value)}
                      />
                    </Field>
                  </div>

                  {/* Next Trigger Preview Alert */}
                  <Alert variant="info" className="px-3 py-2.5">
                    <Bell className="size-3.5" />
                    <AlertTitle className="text-xs font-semibold">下次提醒时间</AlertTitle>
                    <AlertDescription className="text-xs tabular-nums text-foreground/90">
                      {formatTimestampYMDHM(effectiveRule.nextAt || new Date())}
                    </AlertDescription>
                  </Alert>
                </TabsPanel>

                {/* Tab 2: Advanced Recurring Reminder */}
                <TabsPanel value="recurring" className="flex flex-col gap-3">
                  {/* Anchor Time Card */}
                  <Frame>
                    <FramePanel className="flex flex-col gap-2.5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground">
                            <Bell className="size-3.5" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[11px] text-muted-foreground">起始参考时间</div>
                            <div className="text-[13px] font-semibold tabular-nums text-foreground">
                              {formatTimestampYMDHM(effectiveRule.nextAt || new Date())}
                            </div>
                          </div>
                        </div>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => setEditingAnchor((v) => !v)}
                        >
                          {editingAnchor ? '收起' : '修改'}
                        </Button>
                      </div>

                      {editingAnchor && (
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <Input
                            size="sm"
                            type="date"
                            aria-label="起始日期"
                            value={dateInput}
                            onChange={(e) => setDateInput(e.target.value)}
                          />
                          <Input
                            size="sm"
                            type="time"
                            aria-label="起始时间"
                            value={timeInput}
                            onChange={(e) => setTimeInput(e.target.value)}
                          />
                        </div>
                      )}
                    </FramePanel>
                  </Frame>

                  {/* Rules Frame */}
                  <Frame>
                    <FramePanel className="flex flex-col gap-3 p-3.5">
                      {/* Frequency */}
                      <div className="flex items-center justify-between gap-3">
                        <span className="shrink-0 text-xs font-medium text-foreground">
                          循环频率
                        </span>
                        <Select
                          items={FREQUENCY_OPTIONS}
                          value={draft.frequency}
                          onValueChange={(val) => {
                            if (val !== null) {
                              setDraft((prev) => ({
                                ...prev,
                                frequency: val as ReminderFrequency,
                              }));
                            }
                          }}
                        >
                          <SelectTrigger size="sm" className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectPopup align="end" alignItemWithTrigger={false}>
                            {FREQUENCY_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                      </div>

                      {/* Weekly Weekday Multi-Toggle */}
                      {draft.frequency === 'weekly' && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-xs font-medium text-muted-foreground">
                            提醒星期
                          </span>
                          <ToggleGroup
                            multiple
                            value={(draft.weekdays ?? []).map(String)}
                            onValueChange={(vals) => {
                              const nums = vals
                                .map((v) => Number(v))
                                .filter((n) => Number.isFinite(n))
                                .sort((a, b) => a - b);
                              if (nums.length > 0) {
                                setDraft((prev) => ({ ...prev, weekdays: nums }));
                              }
                            }}
                            className="flex w-full flex-wrap gap-1"
                          >
                            {WEEKDAY_LABELS.map((label, idx) => (
                              <ToggleGroupItem
                                key={label}
                                value={String(idx + 1)}
                                size="sm"
                                className="h-7 min-w-9 flex-1 border-input bg-background px-1.5 text-xs data-pressed:border-primary data-pressed:bg-primary data-pressed:text-primary-foreground dark:bg-input/32 dark:data-pressed:bg-primary"
                              >
                                {label}
                              </ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                        </div>
                      )}

                      {/* Month & Day Selector */}
                      {draft.frequency === 'month_day' && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="shrink-0 text-xs font-medium text-foreground">
                            月 / 日
                          </span>
                          <div className="flex items-center gap-2">
                            <Select
                              items={MONTH_OPTIONS}
                              value={draft.month ? String(draft.month) : 'every'}
                              onValueChange={(val) => {
                                if (val !== null) {
                                  setDraft((prev) => ({
                                    ...prev,
                                    month: val === 'every' ? null : Number(val),
                                  }));
                                }
                              }}
                            >
                              <SelectTrigger size="sm" className="w-24">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectPopup align="end" alignItemWithTrigger={false}>
                                {MONTH_OPTIONS.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectPopup>
                            </Select>
                            <Input
                              size="sm"
                              type="number"
                              min={1}
                              max={31}
                              aria-label="日期"
                              className="w-18"
                              value={draft.day ?? 1}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  day: Math.max(1, Math.min(31, Number(e.target.value) || 1)),
                                }))
                              }
                            />
                            <span className="text-xs text-muted-foreground">日</span>
                          </div>
                        </div>
                      )}

                      {/* Custom Interval */}
                      {draft.frequency === 'custom' && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="shrink-0 text-xs font-medium text-foreground">
                            间隔周期
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">每</span>
                            <Input
                              size="sm"
                              type="number"
                              min={1}
                              max={365}
                              aria-label="间隔数值"
                              className="w-18"
                              value={draft.intervalValue ?? 1}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  intervalValue: Math.max(1, Number(e.target.value) || 1),
                                }))
                              }
                            />
                            <Select
                              items={INTERVAL_UNIT_OPTIONS}
                              value={draft.intervalUnit ?? 'days'}
                              onValueChange={(val) => {
                                if (val !== null) {
                                  setDraft((prev) => ({
                                    ...prev,
                                    intervalUnit: val as ReminderIntervalUnit,
                                  }));
                                }
                              }}
                            >
                              <SelectTrigger size="sm" className="w-22">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectPopup align="end" alignItemWithTrigger={false}>
                                {INTERVAL_UNIT_OPTIONS.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectPopup>
                            </Select>
                          </div>
                        </div>
                      )}

                      {/* Multi-Time Slots per Day */}
                      {!(draft.frequency === 'custom' && draft.intervalUnit === 'hours') && (
                        <>
                          <Separator />
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium text-foreground">
                                每日提醒时段
                              </span>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={addTimeSlot}
                                className="h-6 px-1.5 text-xs"
                              >
                                <Plus className="size-3" />
                                <span>添加时段</span>
                              </Button>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {draft.times.map((t, idx) => (
                                <div
                                  key={idx}
                                  className="inline-flex items-center gap-1 rounded-lg border border-input bg-background px-2 py-1 shadow-xs/5 dark:bg-input/32"
                                >
                                  <input
                                    type="time"
                                    value={t}
                                    onChange={(e) => updateTimeSlot(idx, e.target.value)}
                                    aria-label={`提醒时间 ${idx + 1}`}
                                    className="bg-transparent text-xs font-medium tabular-nums text-foreground outline-none"
                                  />
                                  {draft.times.length > 1 && (
                                    <Button
                                      size="icon-xs"
                                      variant="ghost"
                                      className="size-4.5 rounded-sm text-muted-foreground hover:text-foreground"
                                      onClick={() => removeTimeSlot(idx)}
                                      aria-label="删除时间点"
                                    >
                                      <X className="size-3" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      )}

                      <Separator />

                      {/* Stop Condition */}
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-medium text-foreground">停止条件</span>
                          <SegmentedControl
                            size="sm"
                            aria-label="停止条件"
                            render={
                              <RadioGroupPrimitive
                                value={draft.stopCondition}
                                onValueChange={(val) => {
                                  if (val === 'until_complete') {
                                    setDraft((prev) => ({
                                      ...prev,
                                      stopCondition: 'until_complete',
                                    }));
                                  } else if (val === 'max_count') {
                                    setDraft((prev) => ({
                                      ...prev,
                                      stopCondition: 'max_count',
                                      maxCount: prev.maxCount || 5,
                                    }));
                                  }
                                }}
                              />
                            }
                          >
                            <SegmentedControlItem
                              render={<RadioPrimitive.Root value="until_complete" />}
                            >
                              直到完成
                            </SegmentedControlItem>
                            <SegmentedControlItem
                              render={<RadioPrimitive.Root value="max_count" />}
                            >
                              限定次数
                            </SegmentedControlItem>
                          </SegmentedControl>
                        </div>

                        {draft.stopCondition === 'max_count' && (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-muted-foreground">最多提醒</span>
                            <Input
                              size="sm"
                              type="number"
                              min={1}
                              max={999}
                              aria-label="最大提醒次数"
                              className="w-20"
                              value={draft.maxCount ?? 5}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  maxCount: Math.max(1, Number(e.target.value) || 1),
                                }))
                              }
                            />
                            <span className="text-xs text-muted-foreground">次后停止</span>
                          </div>
                        )}
                      </div>
                    </FramePanel>
                  </Frame>

                  {/* Live Summary & Upcoming Preview Alert */}
                  <Alert variant="info" className="px-3 py-2.5">
                    <Bell className="size-3.5" />
                    <AlertTitle className="text-xs font-semibold">
                      {formatReminderSummary(effectiveRule)}
                    </AlertTitle>
                    <AlertDescription className="gap-1.5 text-xs">
                      {upcomingList.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1 pt-0.5">
                          <span className="text-muted-foreground">接下来：</span>
                          {upcomingList.map((d, i) => (
                            <Badge
                              key={i}
                              variant="secondary"
                              size="sm"
                              className="tabular-nums font-normal"
                            >
                              {formatNextPreviewDate(d)}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span>暂无待触发时间</span>
                      )}
                    </AlertDescription>
                    <AlertAction>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => setExpandPreview((v) => !v)}
                        title={expandPreview ? '收起预览' : '展开更多触发时间'}
                        aria-label={expandPreview ? '收起预览' : '展开更多触发时间'}
                      >
                        <ChevronDown
                          className={cn(
                            'size-3.5 transition-transform duration-150',
                            expandPreview && 'rotate-180',
                          )}
                        />
                      </Button>
                    </AlertAction>
                  </Alert>
                </TabsPanel>
              </Tabs>
            </DialogPanel>

            <DialogFooter className="shrink-0 justify-between px-4 py-2.5">
              <div>
                {todo.reminderRule?.enabled && (
                  <Button
                    size="sm"
                    variant="destructive-outline"
                    onClick={handleClearReminder}
                  >
                    <BellOff className="size-3.5" />
                    <span>关闭提醒</span>
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <DialogClose render={<Button size="sm" variant="ghost" />}>取消</DialogClose>
                <Button size="sm" variant="default" onClick={handleSave}>
                  保存提醒
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
};
