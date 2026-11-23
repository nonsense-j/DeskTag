import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClock,
  ArrowDown,
  ArrowUp,
  ImagePlus,
  Link2,
  Plus,
  Repeat,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import * as api from '../api/tauri';
import { useDeskTagStore } from '../store/useDeskTagStore';
import type {
  AttachmentRef,
  ContentLink,
  RepeatFrequency,
  RepeatRule,
  TodoPriority,
} from '../types/models';
import { WEEKDAY_LABELS } from '../utils/lunar';
import { formatReminderSummary, formatRepeatSummary } from '../utils/recurrence';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardFrame,
  CardFrameAction,
  CardFrameHeader,
  CardFrameTitle,
  CardPanel,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Progress, ProgressIndicator, ProgressTrack } from '@/components/ui/progress';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const PRIORITY_OPTIONS: Array<{ value: TodoPriority; label: string; color?: string }> = [
  { value: 'none', label: '无' },
  { value: 'low', label: '低', color: 'var(--priority-low)' },
  { value: 'medium', label: '中', color: 'var(--priority-medium)' },
  { value: 'high', label: '高', color: 'var(--priority-high)' },
];

const REPEAT_FREQ_OPTIONS: Array<{ value: RepeatFrequency; label: string }> = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' },
  { value: 'custom', label: '自定义天数' },
];

const NO_LIST_SENTINEL = '__none__';

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

export const TodoDetailModal: React.FC = () => {
  const {
    editingTodoId,
    activeTodos,
    activeLists,
    activeNotes,
    setEditingTodoId,
    setReminderTodoId,
    updateTodo,
    toggleTodo,
    deleteTodo,
    addSubtask,
    updateSubtask,
    toggleSubtask,
    deleteSubtask,
    reorderSubtasks,
    addContentLink,
    replaceContentLink,
    removeContentLink,
    openContentLink,
    showToast,
  } = useDeskTagStore();

  const todo = useMemo(
    () => (editingTodoId ? activeTodos.find((t) => t.id === editingTodoId) ?? null : null),
    [activeTodos, editingTodoId],
  );

  const [newTag, setNewTag] = useState('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [expandedSubId, setExpandedSubId] = useState<string | null>(null);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [replacingLinkTargetId, setReplacingLinkTargetId] = useState<string | null>(null);
  const [linkQuery, setLinkQuery] = useState('');
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [previewImgUrl, setPreviewImgUrl] = useState<string | null>(null);

  const todoImgInputRef = useRef<HTMLInputElement | null>(null);
  const subImgInputRef = useRef<HTMLInputElement | null>(null);
  const subImgTargetIdRef = useRef<string | null>(null);
  const loadedImageKeysRef = useRef<Set<string>>(new Set());

  // Release cached base64 image URLs whenever the modal closes or switches todos
  useEffect(() => {
    loadedImageKeysRef.current.clear();
    setImageUrls({});
    setPreviewImgUrl(null);
    setShowLinkPicker(false);
    setReplacingLinkTargetId(null);
    setLinkQuery('');
    setExpandedSubId(null);
  }, [editingTodoId]);

  // Hydrate data URLs for all attached images in todo & subtasks
  useEffect(() => {
    if (!todo) return;
    let cancelled = false;
    const refs: AttachmentRef[] = [
      ...todo.noteImages,
      ...todo.subtasks.flatMap((s) => s.noteImages),
    ];
    const activePaths = new Set(refs.map((r) => r.relativePath));

    let pruned = false;
    for (const key of Array.from(loadedImageKeysRef.current)) {
      if (!activePaths.has(key)) {
        loadedImageKeysRef.current.delete(key);
        pruned = true;
      }
    }
    if (pruned) {
      setImageUrls((prev) => {
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (activePaths.has(k)) next[k] = v;
        }
        return next;
      });
    }

    const pending = refs.filter((ref) => !loadedImageKeysRef.current.has(ref.relativePath));
    if (pending.length === 0) return;

    (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        pending.map(async (ref) => {
          try {
            const url = await api.readAttachmentDataUrl(ref.relativePath, ref.mime);
            if (url) {
              loadedImageKeysRef.current.add(ref.relativePath);
              next[ref.relativePath] = url;
            }
          } catch {
            // ignore
          }
        }),
      );
      if (!cancelled && Object.keys(next).length > 0) {
        setImageUrls((prev) => ({ ...prev, ...next }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [todo]);

  const listSelectItems = useMemo(
    () => [
      { value: NO_LIST_SENTINEL, label: '普通待办（无清单）' },
      ...activeLists.map((list) => ({ value: list.id, label: list.name })),
    ],
    [activeLists],
  );

  // Search candidates for @ content linking
  const linkCandidates = useMemo<ContentLink[]>(() => {
    if (!todo) return [];
    const q = linkQuery.trim().toLowerCase();
    return [
      ...activeTodos
        .filter((t) => t.id !== todo.id)
        .map((t) => ({ targetType: 'todo' as const, targetId: t.id, label: t.title })),
      ...activeNotes.map((n) => ({
        targetType: 'note' as const,
        targetId: n.id,
        label: n.title || '未命名便签',
      })),
    ].filter((c) => (q ? c.label.toLowerCase().includes(q) : true));
  }, [activeNotes, activeTodos, linkQuery, todo]);

  const repeatRule: RepeatRule = todo?.repeatRule ?? {
    enabled: false,
    frequency: 'daily',
    interval: 1,
    weekdays: [1, 3, 5],
    endDate: null,
  };

  const handleAddTag = () => {
    if (!todo) return;
    const clean = newTag.trim().replace(/^#/, '');
    if (!clean) return;
    if (!todo.tags.includes(clean)) {
      updateTodo(todo.id, { tags: [...todo.tags, clean] });
    }
    setNewTag('');
  };

  const handleRemoveTag = (tag: string) => {
    if (!todo) return;
    updateTodo(todo.id, { tags: todo.tags.filter((t) => t !== tag) });
  };

  const handleAddSubtask = () => {
    if (!todo) return;
    const clean = newSubtaskTitle.trim();
    if (!clean) return;
    addSubtask(todo.id, clean);
    setNewSubtaskTitle('');
  };

  const handleMoveSubtask = (idx: number, dir: -1 | 1) => {
    if (!todo) return;
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= todo.subtasks.length) return;
    const ids = todo.subtasks.map((s) => s.id);
    const [moved] = ids.splice(idx, 1);
    ids.splice(targetIdx, 0, moved);
    reorderSubtasks(todo.id, ids);
  };

  const handleUploadTodoImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!todo) return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const base64Data = await fileToBase64(file);
      const saved = await api.saveAttachment({
        name: file.name,
        mime: file.type || 'image/png',
        kind: 'image',
        base64Data,
      });
      loadedImageKeysRef.current.add(saved.relativePath);
      setImageUrls((prev) => ({ ...prev, [saved.relativePath]: base64Data }));
      updateTodo(todo.id, { noteImages: [...todo.noteImages, saved] });
    } catch (err) {
      showToast(`图片上传失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleUploadSubtaskImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!todo) return;
    const file = e.target.files?.[0];
    const subId = subImgTargetIdRef.current;
    e.target.value = '';
    if (!file || !subId) return;
    const targetSub = todo.subtasks.find((s) => s.id === subId);
    if (!targetSub) return;
    try {
      const base64Data = await fileToBase64(file);
      const saved = await api.saveAttachment({
        name: file.name,
        mime: file.type || 'image/png',
        kind: 'image',
        base64Data,
      });
      loadedImageKeysRef.current.add(saved.relativePath);
      setImageUrls((prev) => ({ ...prev, [saved.relativePath]: base64Data }));
      updateSubtask(todo.id, subId, { noteImages: [...targetSub.noteImages, saved] });
    } catch (err) {
      showToast(`子任务图片上传失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const updateRepeat = (patch: Partial<RepeatRule>) => {
    if (!todo) return;
    updateTodo(todo.id, { repeatRule: { ...repeatRule, ...patch } });
  };

  const handleSelectContentLink = (candidate: ContentLink) => {
    if (!todo) return;
    if (replacingLinkTargetId) {
      replaceContentLink('todo', todo.id, replacingLinkTargetId, candidate);
      setReplacingLinkTargetId(null);
    } else {
      addContentLink('todo', todo.id, candidate);
    }
    setShowLinkPicker(false);
    setLinkQuery('');
  };

  const completedSubCount = todo ? todo.subtasks.filter((s) => s.completed).length : 0;
  const subProgressPercent =
    todo && todo.subtasks.length > 0
      ? Math.round((completedSubCount / todo.subtasks.length) * 100)
      : 0;

  return (
    <>
      <Dialog
        open={Boolean(todo)}
        onOpenChange={(open) => {
          if (!open) setEditingTodoId(null);
        }}
      >
        <DialogPopup
          className="max-h-[min(88vh,620px)] max-w-[520px] overflow-hidden"
          closeProps={{ 'aria-label': '关闭待办详情' }}
        >
          <DialogHeader className="shrink-0 px-4 pt-3.5 pb-2">
            <DialogTitle className="text-[15px] font-semibold">待办详情</DialogTitle>
          </DialogHeader>

          {todo && (
            <>
              <DialogPanel className="flex flex-col gap-3.5 px-4 pt-1 pb-4">
                {/* Title + Complete Checkbox */}
                <div className="flex items-center gap-2.5">
                  <Checkbox
                    checked={todo.completed}
                    onCheckedChange={() => toggleTodo(todo.id)}
                    aria-label="切换完成状态"
                    className="size-4.5"
                  />
                  <Input
                    type="text"
                    value={todo.title}
                    onChange={(e) => updateTodo(todo.id, { title: e.target.value })}
                    placeholder="待办标题"
                    className={cn(
                      'flex-1 [&_input]:text-[15px] [&_input]:font-semibold',
                      todo.completed && '[&_input]:text-muted-foreground [&_input]:line-through',
                    )}
                  />
                </div>

                {/* Priority & List */}
                <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
                  <Field>
                    <FieldLabel className="text-xs">优先级</FieldLabel>
                    <SegmentedControl
                      size="sm"
                      className="w-full"
                      aria-label="优先级"
                      render={
                        <RadioGroupPrimitive
                          value={todo.priority}
                          onValueChange={(val) => {
                            if (typeof val === 'string') {
                              updateTodo(todo.id, { priority: val as TodoPriority });
                            }
                          }}
                        />
                      }
                    >
                      {PRIORITY_OPTIONS.map((opt) => (
                        <SegmentedControlItem
                          key={opt.value}
                          className="grow gap-1"
                          render={<RadioPrimitive.Root value={opt.value} />}
                        >
                          {opt.color && (
                            <span
                              className="inline-block size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: opt.color }}
                              aria-hidden="true"
                            />
                          )}
                          <span>{opt.label}</span>
                        </SegmentedControlItem>
                      ))}
                    </SegmentedControl>
                  </Field>

                  <Field>
                    <FieldLabel className="text-xs">所属清单</FieldLabel>
                    <Select
                      items={listSelectItems}
                      value={todo.listId ?? NO_LIST_SENTINEL}
                      onValueChange={(val) => {
                        if (val !== null) {
                          updateTodo(todo.id, {
                            listId: val === NO_LIST_SENTINEL ? null : val,
                          });
                        }
                      }}
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup alignItemWithTrigger={false}>
                        <SelectItem value={NO_LIST_SENTINEL}>普通待办（无清单）</SelectItem>
                        {activeLists.map((list) => (
                          <SelectItem key={list.id} value={list.id}>
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="inline-block size-2 shrink-0 rounded-full"
                                style={{ backgroundColor: list.color }}
                                aria-hidden="true"
                              />
                              <span className="truncate">{list.name}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </Field>
                </div>

                {/* Dates & Time (Single / Multi-day Span) */}
                <div className="grid grid-cols-2 gap-2.5">
                  <Field>
                    <FieldLabel className="text-xs">安排日期</FieldLabel>
                    <Input
                      size="sm"
                      type="date"
                      value={todo.dueDate ?? ''}
                      onChange={(e) => updateTodo(todo.id, { dueDate: e.target.value || null })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel className="text-xs">时间</FieldLabel>
                    <Input
                      size="sm"
                      type="time"
                      value={todo.dueTime ?? ''}
                      onChange={(e) => updateTodo(todo.id, { dueTime: e.target.value || null })}
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel className="text-xs">
                    跨天结束日期（可选，用于日历跨天展示）
                  </FieldLabel>
                  <Input
                    size="sm"
                    type="date"
                    value={todo.endDate ?? ''}
                    min={todo.dueDate ?? undefined}
                    onChange={(e) => updateTodo(todo.id, { endDate: e.target.value || null })}
                  />
                </Field>

                {/* Reminder & Repeat CardFrame */}
                <CardFrame>
                  <Card>
                    <CardPanel className="flex flex-col gap-3 p-3.5">
                      {/* Reminder Summary Row */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground">
                            <AlarmClock className="size-3.5" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-foreground">提醒设置</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {formatReminderSummary(todo.reminderRule)}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {todo.reminderRule?.enabled && (
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => updateTodo(todo.id, { reminderRule: null })}
                            >
                              清除
                            </Button>
                          )}
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setReminderTodoId(todo.id)}
                          >
                            {todo.reminderRule?.enabled ? '修改提醒' : '设置提醒'}
                          </Button>
                        </div>
                      </div>

                      <Separator />

                      {/* Repeat Todo Row */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground">
                            <Repeat className="size-3.5" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-foreground">重复待办</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {formatRepeatSummary(todo.repeatRule)}（完成后自动生成下一次）
                            </div>
                          </div>
                        </div>
                        <Switch
                          checked={repeatRule.enabled}
                          onCheckedChange={(checked) => updateRepeat({ enabled: checked })}
                          aria-label="开关重复待办"
                        />
                      </div>

                      {repeatRule.enabled && (
                        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-coss-frame-well p-3">
                          <div className="grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2">
                            <Select
                              items={REPEAT_FREQ_OPTIONS}
                              value={repeatRule.frequency}
                              onValueChange={(val) => {
                                if (val !== null) {
                                  updateRepeat({ frequency: val as RepeatFrequency });
                                }
                              }}
                            >
                              <SelectTrigger size="sm" className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectPopup alignItemWithTrigger={false}>
                                {REPEAT_FREQ_OPTIONS.map((f) => (
                                  <SelectItem key={f.value} value={f.value}>
                                    {f.label}
                                  </SelectItem>
                                ))}
                              </SelectPopup>
                            </Select>

                            <div className="flex items-center gap-2">
                              <span className="shrink-0 text-xs text-muted-foreground">间隔</span>
                              <Input
                                size="sm"
                                type="number"
                                min={1}
                                max={365}
                                value={repeatRule.interval}
                                onChange={(e) =>
                                  updateRepeat({
                                    interval: Math.max(1, Number(e.target.value) || 1),
                                  })
                                }
                              />
                            </div>
                          </div>

                          {repeatRule.frequency === 'weekly' && (
                            <ToggleGroup
                              multiple
                              value={repeatRule.weekdays.map(String)}
                              onValueChange={(vals) => {
                                const nums = vals
                                  .map((v) => Number(v))
                                  .filter((n) => Number.isFinite(n))
                                  .sort((a, b) => a - b);
                                if (nums.length > 0) {
                                  updateRepeat({ weekdays: nums });
                                }
                              }}
                              className="flex w-full flex-wrap gap-1"
                            >
                              {WEEKDAY_LABELS.map((label, idx) => (
                                <ToggleGroupItem
                                  key={label}
                                  value={String(idx + 1)}
                                  size="sm"
                                  className="h-7 min-w-9 flex-1 border-input bg-background px-2 text-xs data-pressed:border-primary data-pressed:bg-primary data-pressed:text-primary-foreground dark:bg-input/32 dark:data-pressed:bg-primary"
                                >
                                  {label}
                                </ToggleGroupItem>
                              ))}
                            </ToggleGroup>
                          )}

                          <Field>
                            <FieldLabel className="text-xs">
                              重复截止日期（留空表示持续重复）
                            </FieldLabel>
                            <Input
                              size="sm"
                              type="date"
                              value={repeatRule.endDate ?? ''}
                              onChange={(e) =>
                                updateRepeat({ endDate: e.target.value || null })
                              }
                            />
                          </Field>
                        </div>
                      )}
                    </CardPanel>
                  </Card>
                </CardFrame>

                {/* Tags */}
                <Field>
                  <FieldLabel className="text-xs">标签</FieldLabel>
                  {todo.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {todo.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="h-6 gap-1 rounded-md px-2 pe-1 text-xs"
                        >
                          <Tag className="size-3 text-muted-foreground" />
                          <span>{tag}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(tag)}
                            className="inline-flex size-4 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                            aria-label={`移除标签 ${tag}`}
                          >
                            <X className="size-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <InputGroup>
                    <InputGroupInput
                      size="sm"
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                      placeholder="输入标签名回车添加，如 工作 / 项目"
                    />
                    <InputGroupAddon align="inline-end">
                      <Button size="xs" variant="secondary" onClick={handleAddTag}>
                        添加
                      </Button>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>

                {/* Notes + Inline Images */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="detail-notes"
                      className="text-xs font-medium text-foreground"
                    >
                      详细备注
                    </label>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => todoImgInputRef.current?.click()}
                      className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <ImagePlus className="size-3.5" />
                      <span>插入图片</span>
                    </Button>
                    <input
                      ref={todoImgInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => void handleUploadTodoImage(e)}
                    />
                  </div>
                  <Textarea
                    id="detail-notes"
                    size="sm"
                    value={todo.notes}
                    onChange={(e) => updateTodo(todo.id, { notes: e.target.value })}
                    placeholder="补充任务背景、细节或检查点..."
                  />

                  {todo.noteImages.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {todo.noteImages.map((img) => {
                        const src = imageUrls[img.relativePath];
                        return (
                          <div
                            key={img.id}
                            className="group relative size-16 overflow-hidden rounded-lg border border-border bg-coss-frame-well"
                          >
                            {src ? (
                              <img
                                src={src}
                                alt={img.name}
                                className="size-full cursor-zoom-in object-cover"
                                onClick={() => setPreviewImgUrl(src)}
                              />
                            ) : (
                              <div className="flex size-full items-center justify-center p-1 text-center text-[10px] text-muted-foreground">
                                {img.name}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                updateTodo(todo.id, {
                                  noteImages: todo.noteImages.filter((x) => x.id !== img.id),
                                })
                              }
                              aria-label="删除图片"
                              className="absolute top-1 right-1 inline-flex size-4 cursor-pointer items-center justify-center rounded-full bg-background/85 text-foreground shadow-xs backdrop-blur-xs hover:bg-destructive hover:text-white"
                            >
                              <X className="size-2.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Subtasks CardFrame */}
                <CardFrame>
                  <CardFrameHeader className="items-center gap-x-2 py-2.5 px-3.5">
                    <div className="flex items-center gap-2">
                      <CardFrameTitle className="text-[13px]">子任务</CardFrameTitle>
                      <Badge variant="secondary" size="sm" className="tabular-nums">
                        {completedSubCount}/{todo.subtasks.length}
                      </Badge>
                    </div>
                    {todo.subtasks.length > 0 && (
                      <CardFrameAction className="items-center gap-2">
                        <div className="w-16">
                          <Progress value={subProgressPercent}>
                            <ProgressTrack className="h-1">
                              <ProgressIndicator />
                            </ProgressTrack>
                          </Progress>
                        </div>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {subProgressPercent}%
                        </span>
                      </CardFrameAction>
                    )}
                  </CardFrameHeader>

                  <Card>
                    <CardPanel className="flex flex-col gap-2 p-3">
                      <input
                        ref={subImgInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void handleUploadSubtaskImage(e)}
                      />

                      {todo.subtasks.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          {todo.subtasks.map((sub, idx) => {
                            const isOpen = expandedSubId === sub.id;
                            const hasExtra = Boolean(sub.notes.trim() || sub.noteImages.length > 0);
                            return (
                              <div
                                key={sub.id}
                                className="rounded-xl border border-border bg-background/60 px-2.5 py-1.5"
                              >
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    checked={sub.completed}
                                    onCheckedChange={() => toggleSubtask(todo.id, sub.id)}
                                    aria-label={`切换子任务 ${sub.title}`}
                                  />
                                  <input
                                    type="text"
                                    value={sub.title}
                                    onChange={(e) =>
                                      updateSubtask(todo.id, sub.id, { title: e.target.value })
                                    }
                                    className={cn(
                                      'min-w-0 flex-1 bg-transparent text-[13px] outline-none',
                                      sub.completed
                                        ? 'text-muted-foreground line-through'
                                        : 'text-foreground',
                                    )}
                                  />
                                  <div className="flex shrink-0 items-center gap-0.5">
                                    <Button
                                      size="icon-xs"
                                      variant={isOpen || hasExtra ? 'secondary' : 'ghost'}
                                      onClick={() => setExpandedSubId(isOpen ? null : sub.id)}
                                      title="子任务备注与图片"
                                      aria-label="子任务备注与图片"
                                    >
                                      <ImagePlus className="size-3.5" />
                                    </Button>
                                    <Button
                                      size="icon-xs"
                                      variant="ghost"
                                      disabled={idx === 0}
                                      onClick={() => handleMoveSubtask(idx, -1)}
                                      title="上移"
                                      aria-label="上移子任务"
                                    >
                                      <ArrowUp className="size-3.5" />
                                    </Button>
                                    <Button
                                      size="icon-xs"
                                      variant="ghost"
                                      disabled={idx === todo.subtasks.length - 1}
                                      onClick={() => handleMoveSubtask(idx, 1)}
                                      title="下移"
                                      aria-label="下移子任务"
                                    >
                                      <ArrowDown className="size-3.5" />
                                    </Button>
                                    <Button
                                      size="icon-xs"
                                      variant="ghost"
                                      onClick={() => deleteSubtask(todo.id, sub.id)}
                                      title="删除子任务"
                                      aria-label="删除子任务"
                                      className="text-muted-foreground hover:text-destructive-foreground"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  </div>
                                </div>

                                {isOpen && (
                                  <div className="mt-2 flex flex-col gap-2 border-t border-dashed border-border pt-2">
                                    <Textarea
                                      size="sm"
                                      value={sub.notes}
                                      onChange={(e) =>
                                        updateSubtask(todo.id, sub.id, { notes: e.target.value })
                                      }
                                      placeholder="子任务备注..."
                                      className="[&_textarea]:min-h-12 [&_textarea]:text-xs"
                                    />
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[11px] text-muted-foreground">
                                        子任务图片可随文档一并导出
                                      </span>
                                      <Button
                                        size="xs"
                                        variant="ghost"
                                        onClick={() => {
                                          subImgTargetIdRef.current = sub.id;
                                          subImgInputRef.current?.click();
                                        }}
                                      >
                                        <Plus className="size-3" />
                                        <span>添加图片</span>
                                      </Button>
                                    </div>
                                    {sub.noteImages.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5">
                                        {sub.noteImages.map((img) => {
                                          const src = imageUrls[img.relativePath];
                                          return (
                                            <div
                                              key={img.id}
                                              className="relative size-14 overflow-hidden rounded-lg border border-border bg-coss-frame-well"
                                            >
                                              {src && (
                                                <img
                                                  src={src}
                                                  alt={img.name}
                                                  className="size-full cursor-zoom-in object-cover"
                                                  onClick={() => setPreviewImgUrl(src)}
                                                />
                                              )}
                                              <button
                                                type="button"
                                                aria-label="删除子任务图片"
                                                onClick={() =>
                                                  updateSubtask(todo.id, sub.id, {
                                                    noteImages: sub.noteImages.filter(
                                                      (x) => x.id !== img.id,
                                                    ),
                                                  })
                                                }
                                                className="absolute top-0.5 right-0.5 inline-flex size-4 cursor-pointer items-center justify-center rounded-full bg-background/85 text-foreground shadow-xs hover:bg-destructive hover:text-white"
                                              >
                                                <X className="size-2.5" />
                                              </button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <InputGroup>
                        <InputGroupInput
                          size="sm"
                          type="text"
                          value={newSubtaskTitle}
                          onChange={(e) => setNewSubtaskTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddSubtask();
                            }
                          }}
                          placeholder="添加子任务，按 Enter 确认"
                        />
                        <InputGroupAddon align="inline-end">
                          <Button
                            size="icon-xs"
                            variant="secondary"
                            onClick={handleAddSubtask}
                            aria-label="添加子任务"
                          >
                            <Plus className="size-3.5" />
                          </Button>
                        </InputGroupAddon>
                      </InputGroup>
                    </CardPanel>
                  </Card>
                </CardFrame>

                {/* @ Content Links CardFrame */}
                <CardFrame>
                  <CardFrameHeader className="items-center py-2.5 px-3.5">
                    <CardFrameTitle className="flex items-center gap-1.5 text-[13px]">
                      <Link2 className="size-3.5 text-muted-foreground" />
                      <span>@ 内容关联</span>
                    </CardFrameTitle>
                    <CardFrameAction>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setReplacingLinkTargetId(null);
                          setShowLinkPicker((v) => !v);
                        }}
                      >
                        <Plus className="size-3" />
                        <span>添加关联</span>
                      </Button>
                    </CardFrameAction>
                  </CardFrameHeader>

                  {(todo.links.length > 0 || showLinkPicker) && (
                    <Card>
                      <CardPanel className="flex flex-col gap-2 p-3">
                        {todo.links.length > 0 && (
                          <div className="flex flex-col gap-1.5">
                            {todo.links.map((link) => (
                              <div
                                key={`${link.targetType}:${link.targetId}`}
                                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-1.5"
                              >
                                <button
                                  type="button"
                                  onClick={() => openContentLink(link)}
                                  className="inline-flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-xs font-medium text-foreground hover:underline"
                                >
                                  <Badge variant="outline" size="sm" className="shrink-0">
                                    {link.targetType === 'note' ? '便签' : '待办'}
                                  </Badge>
                                  <span className="truncate">{link.label}</span>
                                </button>
                                <div className="flex shrink-0 items-center gap-1">
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    className="h-5.5 px-1.5 text-[11px] text-muted-foreground"
                                    onClick={() => {
                                      setReplacingLinkTargetId(link.targetId);
                                      setShowLinkPicker(true);
                                    }}
                                  >
                                    替换
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    className="h-5.5 px-1.5 text-[11px] text-muted-foreground hover:text-destructive-foreground"
                                    onClick={() =>
                                      removeContentLink('todo', todo.id, link.targetId)
                                    }
                                  >
                                    解除
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {showLinkPicker && (
                          <div className="flex flex-col gap-2 rounded-xl border border-border bg-coss-frame-well p-2.5">
                            <Input
                              size="sm"
                              type="text"
                              value={linkQuery}
                              onChange={(e) => setLinkQuery(e.target.value)}
                              placeholder={
                                replacingLinkTargetId
                                  ? '搜索要替换的目标待办或便签...'
                                  : '搜索要关联的待办或便签...'
                              }
                              autoFocus
                            />
                            <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
                              {linkCandidates.slice(0, 12).map((cand) => (
                                <button
                                  key={`${cand.targetType}:${cand.targetId}`}
                                  type="button"
                                  onClick={() => handleSelectContentLink(cand)}
                                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
                                >
                                  <Badge variant="secondary" size="sm" className="shrink-0">
                                    {cand.targetType === 'note' ? '便签' : '待办'}
                                  </Badge>
                                  <span className="truncate">{cand.label}</span>
                                </button>
                              ))}
                              {linkCandidates.length === 0 && (
                                <div className="px-2 py-2 text-center text-xs text-muted-foreground">
                                  无匹配项
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </CardPanel>
                    </Card>
                  )}
                </CardFrame>
              </DialogPanel>

              <DialogFooter className="shrink-0 justify-between px-4 py-2.5">
                <AlertDialog>
                  <AlertDialogTrigger
                    render={<Button size="sm" variant="destructive-outline" />}
                  >
                    <Trash2 className="size-3.5" />
                    <span>删除待办</span>
                  </AlertDialogTrigger>
                  <AlertDialogPopup>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-base">确认删除待办？</AlertDialogTitle>
                      <AlertDialogDescription className="text-xs">
                        将删除「{todo.title || '未命名待办'}」及其子任务与附件记录，此操作无法撤销。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogClose render={<Button size="sm" variant="ghost" />}>
                        取消
                      </AlertDialogClose>
                      <AlertDialogClose
                        render={
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              deleteTodo(todo.id);
                              showToast('已删除待办');
                            }}
                          />
                        }
                      >
                        确认删除
                      </AlertDialogClose>
                    </AlertDialogFooter>
                  </AlertDialogPopup>
                </AlertDialog>

                <DialogClose render={<Button size="sm" variant="default" />}>完成</DialogClose>
              </DialogFooter>
            </>
          )}
        </DialogPopup>
      </Dialog>

      {/* Lightbox Image Preview Dialog */}
      <Dialog
        open={Boolean(previewImgUrl)}
        onOpenChange={(open) => {
          if (!open) setPreviewImgUrl(null);
        }}
      >
        <DialogPopup
          className="w-auto max-w-[92%] overflow-hidden border-border/80 bg-popover/95 p-2"
          closeProps={{ 'aria-label': '关闭图片预览' }}
        >
          {previewImgUrl && (
            <img
              src={previewImgUrl}
              alt="图片预览"
              className="max-h-[76vh] max-w-full rounded-xl object-contain"
            />
          )}
        </DialogPopup>
      </Dialog>
    </>
  );
};
