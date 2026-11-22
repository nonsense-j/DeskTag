import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  AlarmIcon,
  CheckIcon,
  CloseIcon,
  ImageIcon,
  LinkIcon,
  PlusIcon,
  RepeatIcon,
  TagIcon,
  TrashIcon,
} from './Icons';

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

    // Drop stale entries if images were removed while editing
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

  if (!todo) return null;

  const handleAddTag = () => {
    const clean = newTag.trim().replace(/^#/, '');
    if (!clean) return;
    if (!todo.tags.includes(clean)) {
      updateTodo(todo.id, { tags: [...todo.tags, clean] });
    }
    setNewTag('');
  };

  const handleRemoveTag = (tag: string) => {
    updateTodo(todo.id, { tags: todo.tags.filter((t) => t !== tag) });
  };

  const handleAddSubtask = () => {
    const clean = newSubtaskTitle.trim();
    if (!clean) return;
    addSubtask(todo.id, clean);
    setNewSubtaskTitle('');
  };

  const handleMoveSubtask = (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= todo.subtasks.length) return;
    const ids = todo.subtasks.map((s) => s.id);
    const [moved] = ids.splice(idx, 1);
    ids.splice(targetIdx, 0, moved);
    reorderSubtasks(todo.id, ids);
  };

  const handleUploadTodoImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const repeatRule: RepeatRule = todo.repeatRule ?? {
    enabled: false,
    frequency: 'daily',
    interval: 1,
    weekdays: [1, 3, 5],
    endDate: null,
  };

  const updateRepeat = (patch: Partial<RepeatRule>) => {
    updateTodo(todo.id, { repeatRule: { ...repeatRule, ...patch } });
  };

  const toggleRepeatWeekday = (dayNum: number) => {
    const cur = repeatRule.weekdays ?? [];
    const next = cur.includes(dayNum)
      ? cur.filter((d) => d !== dayNum)
      : [...cur, dayNum].sort((a, b) => a - b);
    updateRepeat({ weekdays: next.length > 0 ? next : [dayNum] });
  };

  // Search candidates for @ content linking
  const linkCandidates: ContentLink[] = [
    ...activeTodos
      .filter((t) => t.id !== todo.id)
      .map((t) => ({ targetType: 'todo' as const, targetId: t.id, label: t.title })),
    ...activeNotes.map((n) => ({
      targetType: 'note' as const,
      targetId: n.id,
      label: n.title || '未命名便签',
    })),
  ].filter((c) =>
    linkQuery.trim() ? c.label.toLowerCase().includes(linkQuery.trim().toLowerCase()) : true,
  );

  const handleSelectContentLink = (candidate: ContentLink) => {
    if (replacingLinkTargetId) {
      replaceContentLink('todo', todo.id, replacingLinkTargetId, candidate);
      setReplacingLinkTargetId(null);
    } else {
      addContentLink('todo', todo.id, candidate);
    }
    setShowLinkPicker(false);
    setLinkQuery('');
  };

  return (
    <div className="modal-overlay" onClick={() => setEditingTodoId(null)}>
      <div
        className="modal-card wide"
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="待办详情"
      >
        <div className="modal-header">
          <h3 className="modal-title">待办详情</h3>
          <button
            type="button"
            className="header-icon-btn"
            onClick={() => setEditingTodoId(null)}
            aria-label="关闭"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* Title + Complete Checkbox */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className={`todo-checkbox${todo.completed ? ' checked' : ''}`}
              style={{ marginTop: 0 }}
              onClick={() => toggleTodo(todo.id)}
              aria-label="切换完成状态"
            >
              {todo.completed && <CheckIcon size={11} strokeWidth={2.6} />}
            </button>
            <input
              type="text"
              className="field-input"
              style={{ fontWeight: 600, fontSize: 15 }}
              value={todo.title}
              onChange={(e) => updateTodo(todo.id, { title: e.target.value })}
              placeholder="待办标题"
            />
          </div>

          {/* Priority & List */}
          <div className="form-grid-2">
            <div>
              <span className="field-label">优先级</span>
              <div className="pill-group">
                {PRIORITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`pill-option${todo.priority === opt.value ? ' selected' : ''}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px' }}
                    onClick={() => updateTodo(todo.id, { priority: opt.value })}
                  >
                    {opt.color && (
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: opt.color,
                        }}
                      />
                    )}
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="field-label" htmlFor="detail-list-select">
                所属清单
              </label>
              <select
                id="detail-list-select"
                className="field-select"
                value={todo.listId ?? ''}
                onChange={(e) => updateTodo(todo.id, { listId: e.target.value || null })}
              >
                <option value="">普通待办（无清单）</option>
                {activeLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dates & Time (Single / Multi-day Span) */}
          <div className="form-grid-2">
            <div>
              <label className="field-label" htmlFor="detail-due-date">
                安排日期
              </label>
              <input
                id="detail-due-date"
                type="date"
                className="field-input"
                value={todo.dueDate ?? ''}
                onChange={(e) => updateTodo(todo.id, { dueDate: e.target.value || null })}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="detail-due-time">
                时间
              </label>
              <input
                id="detail-due-time"
                type="time"
                className="field-input"
                value={todo.dueTime ?? ''}
                onChange={(e) => updateTodo(todo.id, { dueTime: e.target.value || null })}
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="detail-end-date">
              跨天结束日期（可选，用于日历跨天展示）
            </label>
            <input
              id="detail-end-date"
              type="date"
              className="field-input"
              value={todo.endDate ?? ''}
              min={todo.dueDate ?? undefined}
              onChange={(e) => updateTodo(todo.id, { endDate: e.target.value || null })}
            />
          </div>

          {/* Reminder & Repeat Cards */}
          <div className="warm-card" style={{ gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlarmIcon size={15} style={{ color: 'var(--accent)' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>提醒设置</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {formatReminderSummary(todo.reminderRule)}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {todo.reminderRule?.enabled && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => updateTodo(todo.id, { reminderRule: null })}
                  >
                    清除
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-soft"
                  onClick={() => setReminderTodoId(todo.id)}
                >
                  {todo.reminderRule?.enabled ? '修改提醒' : '设置提醒'}
                </button>
              </div>
            </div>

            <div className="menu-divider" style={{ margin: '2px 0' }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <RepeatIcon size={15} style={{ color: 'var(--accent)' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>重复待办</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {formatRepeatSummary(todo.repeatRule)}（完成后自动生成下一次）
                  </div>
                </div>
              </div>
              <button
                type="button"
                className={`toggle-switch${repeatRule.enabled ? ' on' : ''}`}
                onClick={() => updateRepeat({ enabled: !repeatRule.enabled })}
                aria-label="开关重复待办"
              >
                <span className="toggle-switch-knob" />
              </button>
            </div>

            {repeatRule.enabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
                <div className="form-grid-2">
                  <select
                    className="field-select"
                    value={repeatRule.frequency}
                    onChange={(e) =>
                      updateRepeat({ frequency: e.target.value as RepeatFrequency })
                    }
                  >
                    {REPEAT_FREQ_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      间隔
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      className="field-input"
                      value={repeatRule.interval}
                      onChange={(e) =>
                        updateRepeat({ interval: Math.max(1, Number(e.target.value) || 1) })
                      }
                    />
                  </div>
                </div>

                {repeatRule.frequency === 'weekly' && (
                  <div className="pill-group">
                    {WEEKDAY_LABELS.map((label, idx) => {
                      const dNum = idx + 1;
                      const sel = repeatRule.weekdays.includes(dNum);
                      return (
                        <button
                          key={label}
                          type="button"
                          className={`weekday-pill${sel ? ' selected' : ''}`}
                          style={{ height: 28, minWidth: 38, fontSize: 12 }}
                          onClick={() => toggleRepeatWeekday(dNum)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div>
                  <label className="field-label" htmlFor="repeat-end-date">
                    重复截止日期（留空表示持续重复）
                  </label>
                  <input
                    id="repeat-end-date"
                    type="date"
                    className="field-input"
                    value={repeatRule.endDate ?? ''}
                    onChange={(e) => updateRepeat({ endDate: e.target.value || null })}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Tags */}
          <div>
            <span className="field-label">标签</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
              {todo.tags.map((tag) => (
                <span key={tag} className="tag-pill" style={{ gap: 5 }}>
                  <TagIcon size={11} />
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    style={{ color: 'var(--text-muted)', display: 'inline-flex' }}
                    aria-label={`移除标签 ${tag}`}
                  >
                    <CloseIcon size={11} />
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                className="field-input"
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
              <button type="button" className="btn btn-soft" onClick={handleAddTag}>
                添加
              </button>
            </div>
          </div>

          {/* Notes + Inline Images */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <label className="field-label" htmlFor="detail-notes" style={{ marginBottom: 0 }}>
                详细备注
              </label>
              <button
                type="button"
                className="text-link-btn"
                onClick={() => todoImgInputRef.current?.click()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <ImageIcon size={13.5} />
                <span>插入图片</span>
              </button>
              <input
                ref={todoImgInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => void handleUploadTodoImage(e)}
              />
            </div>
            <textarea
              id="detail-notes"
              className="field-textarea"
              value={todo.notes}
              onChange={(e) => updateTodo(todo.id, { notes: e.target.value })}
              placeholder="补充任务背景、细节或检查点..."
            />

            {todo.noteImages.length > 0 && (
              <div className="inline-image-grid">
                {todo.noteImages.map((img) => {
                  const src = imageUrls[img.relativePath];
                  return (
                    <div key={img.id} className="inline-image-thumb">
                      {src ? (
                        <img
                          src={src}
                          alt={img.name}
                          onClick={() => setPreviewImgUrl(src)}
                        />
                      ) : (
                        <div style={{ fontSize: 10, padding: 6, color: 'var(--text-muted)' }}>
                          {img.name}
                        </div>
                      )}
                      <button
                        type="button"
                        className="inline-image-remove"
                        onClick={() =>
                          updateTodo(todo.id, {
                            noteImages: todo.noteImages.filter((x) => x.id !== img.id),
                          })
                        }
                        aria-label="删除图片"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Subtasks */}
          <div>
            <span className="field-label">
              子任务 ({todo.subtasks.filter((s) => s.completed).length}/{todo.subtasks.length})
            </span>
            <input
              ref={subImgInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => void handleUploadSubtaskImage(e)}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {todo.subtasks.map((sub, idx) => {
                const isOpen = expandedSubId === sub.id;
                return (
                  <div
                    key={sub.id}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 9,
                      padding: '6px 8px',
                      background: 'var(--bg-surface)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <button
                        type="button"
                        className={`todo-checkbox${sub.completed ? ' checked' : ''}`}
                        style={{ width: 16, height: 16, marginTop: 0 }}
                        onClick={() => toggleSubtask(todo.id, sub.id)}
                      >
                        {sub.completed && <CheckIcon size={10} strokeWidth={2.6} />}
                      </button>
                      <input
                        type="text"
                        value={sub.title}
                        onChange={(e) => updateSubtask(todo.id, sub.id, { title: e.target.value })}
                        style={{
                          flex: 1,
                          border: 'none',
                          background: 'transparent',
                          fontSize: 13,
                          color: sub.completed ? 'var(--text-completed)' : 'var(--text-primary)',
                        }}
                      />
                      <button
                        type="button"
                        className="mini-icon-btn"
                        onClick={() => setExpandedSubId(isOpen ? null : sub.id)}
                        title="子任务备注与图片"
                      >
                        <ImageIcon size={13} />
                      </button>
                      <button
                        type="button"
                        className="mini-icon-btn"
                        onClick={() => handleMoveSubtask(idx, -1)}
                        disabled={idx === 0}
                        title="上移"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="mini-icon-btn"
                        onClick={() => handleMoveSubtask(idx, 1)}
                        disabled={idx === todo.subtasks.length - 1}
                        title="下移"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="mini-icon-btn danger"
                        onClick={() => deleteSubtask(todo.id, sub.id)}
                        title="删除子任务"
                      >
                        <TrashIcon size={13} />
                      </button>
                    </div>

                    {isOpen && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                        <textarea
                          className="field-textarea"
                          style={{ minHeight: 52, fontSize: 12.5 }}
                          value={sub.notes}
                          onChange={(e) => updateSubtask(todo.id, sub.id, { notes: e.target.value })}
                          placeholder="子任务备注..."
                        />
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                            子任务图片可随文档一并导出
                          </span>
                          <button
                            type="button"
                            className="text-link-btn"
                            onClick={() => {
                              subImgTargetIdRef.current = sub.id;
                              subImgInputRef.current?.click();
                            }}
                          >
                            + 添加图片
                          </button>
                        </div>
                        {sub.noteImages.length > 0 && (
                          <div className="inline-image-grid">
                            {sub.noteImages.map((img) => {
                              const src = imageUrls[img.relativePath];
                              return (
                                <div key={img.id} className="inline-image-thumb" style={{ width: 56, height: 56 }}>
                                  {src && (
                                    <img
                                      src={src}
                                      alt={img.name}
                                      onClick={() => setPreviewImgUrl(src)}
                                    />
                                  )}
                                  <button
                                    type="button"
                                    className="inline-image-remove"
                                    onClick={() =>
                                      updateSubtask(todo.id, sub.id, {
                                        noteImages: sub.noteImages.filter((x) => x.id !== img.id),
                                      })
                                    }
                                  >
                                    ×
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

            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                className="field-input"
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
              <button type="button" className="btn btn-soft" onClick={handleAddSubtask}>
                <PlusIcon size={14} />
              </button>
            </div>
          </div>

          {/* @ Content Links */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="field-label" style={{ marginBottom: 0 }}>
                @ 内容关联（待办 / 便签）
              </span>
              <button
                type="button"
                className="text-link-btn"
                onClick={() => {
                  setReplacingLinkTargetId(null);
                  setShowLinkPicker((v) => !v);
                }}
              >
                + 添加关联
              </button>
            </div>

            {todo.links.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
                {todo.links.map((link) => (
                  <div
                    key={`${link.targetType}:${link.targetId}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px 9px',
                      borderRadius: 8,
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <button
                      type="button"
                      className="content-link-chip"
                      onClick={() => openContentLink(link)}
                    >
                      <LinkIcon size={13} />
                      <span>
                        [{link.targetType === 'note' ? '便签' : '待办'}] {link.label}
                      </span>
                    </button>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="text-link-btn muted"
                        onClick={() => {
                          setReplacingLinkTargetId(link.targetId);
                          setShowLinkPicker(true);
                        }}
                      >
                        替换
                      </button>
                      <button
                        type="button"
                        className="text-link-btn muted"
                        onClick={() => removeContentLink('todo', todo.id, link.targetId)}
                      >
                        解除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showLinkPicker && (
              <div className="warm-card warm-card-surface" style={{ padding: 10, gap: 8 }}>
                <input
                  type="text"
                  className="field-input"
                  value={linkQuery}
                  onChange={(e) => setLinkQuery(e.target.value)}
                  placeholder={replacingLinkTargetId ? '搜索要替换的目标待办或便签...' : '搜索要关联的待办或便签...'}
                  autoFocus
                />
                <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {linkCandidates.slice(0, 12).map((cand) => (
                    <button
                      key={`${cand.targetType}:${cand.targetId}`}
                      type="button"
                      className="menu-item-btn"
                      onClick={() => handleSelectContentLink(cand)}
                    >
                      <span className="tag-pill" style={{ fontSize: 10.5 }}>
                        {cand.targetType === 'note' ? '便签' : '待办'}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cand.label}
                      </span>
                    </button>
                  ))}
                  {linkCandidates.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 6 }}>无匹配项</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="btn btn-danger-soft"
            onClick={() => {
              deleteTodo(todo.id);
              showToast('已删除待办');
            }}
          >
            <TrashIcon size={14} />
            <span>删除待办</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setEditingTodoId(null)}>
            完成
          </button>
        </div>
      </div>

      {/* Lightbox Image Preview */}
      {previewImgUrl && (
        <div
          className="modal-overlay"
          style={{ zIndex: 110 }}
          onClick={() => setPreviewImgUrl(null)}
        >
          <img
            src={previewImgUrl}
            alt="图片预览"
            style={{
              maxWidth: '90vw',
              maxHeight: '88vh',
              borderRadius: 12,
              boxShadow: 'var(--shadow-popover)',
            }}
          />
        </div>
      )}
    </div>
  );
};
