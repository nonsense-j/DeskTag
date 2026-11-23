import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  Clock,
  FileText,
  History,
  Lock,
  Mic,
  Search,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import { saveAttachment } from '../api/tauri';
import { useDeskTagStore } from '../store/useDeskTagStore';
import { formatDateKey, formatTimestampYMDHM, pad2 } from '../utils/lunar';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandDialogPopup,
  CommandDialogPrimitive,
  CommandFooter,
  CommandPanel,
} from '@/components/ui/command';
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Frame, FramePanel } from '@/components/ui/frame';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
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

// ---------------------------------------------------------------------------
// Highlight helper
// ---------------------------------------------------------------------------

function renderHighlighted(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < text.length) {
    const idx = lower.indexOf(qLower, cursor);
    if (idx === -1) {
      parts.push(text.slice(cursor));
      break;
    }
    if (idx > cursor) {
      parts.push(text.slice(cursor, idx));
    }
    parts.push(
      <mark
        key={key++}
        className="rounded-xs bg-dt-accent-soft px-0.5 font-medium text-dt-accent-soft-text"
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
  }
  return parts;
}

function buildSnippet(text: string, query: string, maxLen = 78): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  const q = query.trim().toLowerCase();
  const idx = q ? clean.toLowerCase().indexOf(q) : -1;
  if (idx <= 16) return `${clean.slice(0, maxLen)}…`;
  const start = Math.max(0, idx - 18);
  return `…${clean.slice(start, start + maxLen)}…`;
}

// ---------------------------------------------------------------------------
// 1. Global Search Modal (Ctrl+K 检索)
// ---------------------------------------------------------------------------

type SearchKind = 'todo' | 'note' | 'timeline';
type SearchFilterKind = 'all' | SearchKind;

interface SearchHit {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle: string;
  badge: string;
  completed?: boolean;
  locked?: boolean;
  todoId?: string;
  noteId?: string;
}

const SEARCH_FILTER_OPTIONS: Array<{ value: SearchFilterKind; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'todo', label: '待办' },
  { value: 'note', label: '便签' },
  { value: 'timeline', label: '时间轴' },
];

const GROUP_LABELS: Record<SearchKind, string> = {
  todo: '待办',
  note: '便签',
  timeline: '时间轴',
};

export const SearchModal: React.FC = () => {
  const {
    showSearch,
    setShowSearch,
    activeTodos,
    activeNotes,
    activeNoteGroups,
    unlockedGroupIds,
    isMobileLayout,
    setActiveTab,
    setShowQuadrant,
    setMobileSection,
    setEditingTodoId,
  } = useDeskTagStore();

  const [query, setQuery] = useState('');
  const [filterKind, setFilterKind] = useState<SearchFilterKind>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (showSearch) {
      setSelectedIndex(0);
    }
  }, [showSearch, query, filterKind]);

  const lockedGroupIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of activeNoteGroups) {
      if (g.locked && !unlockedGroupIds.has(g.id)) {
        set.add(g.id);
      }
    }
    return set;
  }, [activeNoteGroups, unlockedGroupIds]);

  const results = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    const hits: SearchHit[] = [];

    if (filterKind === 'all' || filterKind === 'todo') {
      for (const todo of activeTodos) {
        const titleMatch = !q || todo.title.toLowerCase().includes(q);
        const notesMatch = q && todo.notes.toLowerCase().includes(q);
        const tagMatch = q && todo.tags.some((tag) => tag.toLowerCase().includes(q));
        const subMatch = q
          ? todo.subtasks.find((s) => s.title.toLowerCase().includes(q))
          : undefined;

        if (titleMatch || notesMatch || tagMatch || subMatch) {
          let subtitle = '';
          if (subMatch) {
            subtitle = `子任务：${subMatch.title}`;
          } else if (notesMatch) {
            subtitle = buildSnippet(todo.notes, query);
          } else if (todo.tags.length > 0) {
            subtitle = todo.tags.map((t) => `#${t}`).join(' ');
          } else if (todo.dueDate) {
            subtitle = `截止 ${todo.dueDate}${todo.dueTime ? ` ${todo.dueTime}` : ''}`;
          } else {
            subtitle = '待办事项';
          }

          hits.push({
            id: `todo_${todo.id}`,
            kind: 'todo',
            title: todo.title,
            subtitle,
            badge: todo.completed ? '已完成' : '待办',
            completed: todo.completed,
            todoId: todo.id,
          });
        }
      }
    }

    if (filterKind === 'all' || filterKind === 'note') {
      for (const note of activeNotes) {
        if (note.kind !== 'normal') continue;
        const locked = Boolean(note.groupId && lockedGroupIds.has(note.groupId));
        const titleMatch = !q || note.title.toLowerCase().includes(q);
        const bodyMatch = !locked && q && note.content.toLowerCase().includes(q);
        if (titleMatch || bodyMatch) {
          hits.push({
            id: `note_${note.id}`,
            kind: 'note',
            title: note.title || '未命名便签',
            subtitle: locked
              ? '隐私分组已锁定'
              : buildSnippet(note.content || '空白便签', query),
            badge: '普通便签',
            locked,
            noteId: note.id,
          });
        }
      }
    }

    if (filterKind === 'all' || filterKind === 'timeline') {
      for (const note of activeNotes) {
        if (note.kind !== 'timeline') continue;
        const locked = Boolean(note.groupId && lockedGroupIds.has(note.groupId));
        const titleMatch = !q || note.title.toLowerCase().includes(q);
        if (locked) {
          if (titleMatch) {
            hits.push({
              id: `tl_note_${note.id}`,
              kind: 'timeline',
              title: note.title || '时间轴便签',
              subtitle: '隐私分组已锁定',
              badge: '时间轴',
              locked: true,
              noteId: note.id,
            });
          }
          continue;
        }
        let matchedAnyEntry = false;
        for (const entry of note.timelineEntries) {
          if (!q || entry.content.toLowerCase().includes(q)) {
            matchedAnyEntry = true;
            hits.push({
              id: `tl_${note.id}_${entry.id}`,
              kind: 'timeline',
              title: `${note.title || '时间轴'} · ${formatTimestampYMDHM(entry.createdAt)}`,
              subtitle: buildSnippet(entry.content, query),
              badge: '时间轴记录',
              noteId: note.id,
            });
            if (!q) break;
          }
        }
        if (!matchedAnyEntry && titleMatch) {
          hits.push({
            id: `tl_note_${note.id}`,
            kind: 'timeline',
            title: note.title || '时间轴便签',
            subtitle: `${note.timelineEntries.length} 条记录`,
            badge: '时间轴',
            noteId: note.id,
          });
        }
      }
    }

    return hits.slice(0, 40);
  }, [activeTodos, activeNotes, lockedGroupIds, query, filterKind]);

  // Group results by kind while preserving exact flat indices for keyboard navigation
  const groupedSections = useMemo(() => {
    const sections: Array<{
      kind: SearchKind;
      label: string;
      items: Array<{ hit: SearchHit; flatIndex: number }>;
    }> = [];
    const byKind = new Map<SearchKind, Array<{ hit: SearchHit; flatIndex: number }>>();
    results.forEach((hit, flatIndex) => {
      const bucket = byKind.get(hit.kind);
      if (bucket) {
        bucket.push({ hit, flatIndex });
      } else {
        byKind.set(hit.kind, [{ hit, flatIndex }]);
      }
    });
    (['todo', 'note', 'timeline'] as SearchKind[]).forEach((kind) => {
      const items = byKind.get(kind);
      if (items && items.length > 0) {
        sections.push({ kind, label: GROUP_LABELS[kind], items });
      }
    });
    return sections;
  }, [results]);

  // Keep highlighted row visible when navigating with keyboard
  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleOpenHit = (hit: SearchHit) => {
    setShowSearch(false);
    setQuery('');
    if (hit.kind === 'todo' && hit.todoId) {
      setShowQuadrant(false);
      setActiveTab({ kind: 'todo' });
      if (isMobileLayout) setMobileSection('todo');
      setEditingTodoId(hit.todoId);
    } else if (hit.noteId) {
      setShowQuadrant(false);
      setActiveTab({ kind: 'note', noteId: hit.noteId });
      if (isMobileLayout) setMobileSection('notes');
    }
  };

  return (
    <CommandDialog open={showSearch} onOpenChange={setShowSearch}>
      <CommandDialogPopup className="max-h-[min(78vh,480px)] max-w-[464px] overflow-hidden">
        <CommandDialogPrimitive.Title className="sr-only">
          全局检索
        </CommandDialogPrimitive.Title>

        {/* Search Input Header */}
        <div className="shrink-0 px-2.5 pt-2 pb-1.5">
          <InputGroup className="border-transparent bg-transparent shadow-none before:hidden has-[input:focus-visible]:border-transparent has-[input:focus-visible]:ring-0 dark:bg-transparent">
            <InputGroupInput
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSelectedIndex((i) => (results.length > 0 ? Math.min(results.length - 1, i + 1) : 0));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSelectedIndex((i) => Math.max(0, i - 1));
                } else if (e.key === 'Enter' && results[selectedIndex]) {
                  e.preventDefault();
                  handleOpenHit(results[selectedIndex]);
                } else if (e.key === 'Escape') {
                  setShowSearch(false);
                }
              }}
              placeholder="检索待办、子任务、标签、便签与时间轴…"
              aria-label="全局检索"
              className="[&_input]:text-sm"
            />
            <InputGroupAddon align="inline-start">
              <Search className="size-4 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end" className="gap-1.5">
              {query && (
                <>
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label="清空搜索词"
                    className="h-5 px-1.5 text-[11px] font-normal text-muted-foreground hover:text-foreground"
                    onClick={() => setQuery('')}
                  >
                    清空
                  </Button>
                  <span aria-hidden="true" className="h-3.5 w-px bg-border" />
                </>
              )}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="关闭检索"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setShowSearch(false)}
              >
                <X className="size-4" />
              </Button>
            </InputGroupAddon>
          </InputGroup>

          {/* Scope Filter Segmented Control + Result Count */}
          <div className="mt-1 flex items-center justify-between gap-2 px-1 pb-1">
            <SegmentedControl
              size="sm"
              aria-label="检索范围"
              render={
                <RadioGroupPrimitive
                  value={filterKind}
                  onValueChange={(val) => {
                    if (typeof val === 'string') setFilterKind(val as SearchFilterKind);
                  }}
                />
              }
            >
              {SEARCH_FILTER_OPTIONS.map((opt) => (
                <SegmentedControlItem
                  key={opt.value}
                  className="px-2 text-xs"
                  render={<RadioPrimitive.Root value={opt.value} />}
                >
                  {opt.label}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
            <Badge variant="secondary" size="sm" className="shrink-0 tabular-nums">
              {results.length} 条结果
            </Badge>
          </div>
        </div>

        {/* Categorized Results Panel */}
        <CommandPanel className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ScrollArea overscrollContain scrollFade className="min-h-0 flex-1">
            <div className="flex flex-col gap-2 p-2">
              {results.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-1.5 py-9 text-center">
                  <Search className="size-5 text-muted-foreground/50" />
                  <p className="text-xs text-muted-foreground">
                    {query.trim() ? `没有找到包含「${query.trim()}」的内容` : '暂无可检索内容'}
                  </p>
                </div>
              ) : (
                groupedSections.map((section) => (
                  <div key={section.kind} className="flex flex-col gap-0.5">
                    <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                      {section.label}
                    </div>
                    {section.items.map(({ hit, flatIndex }) => {
                      const active = flatIndex === selectedIndex;
                      return (
                        <button
                          key={hit.id}
                          ref={(node) => {
                            itemRefs.current[flatIndex] = node;
                          }}
                          type="button"
                          onMouseEnter={() => setSelectedIndex(flatIndex)}
                          onClick={() => handleOpenHit(hit)}
                          className={cn(
                            'flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors outline-none',
                            active
                              ? 'bg-accent text-accent-foreground'
                              : 'text-foreground hover:bg-accent/60',
                          )}
                        >
                          <span className="mt-0.5 shrink-0 text-muted-foreground">
                            {hit.kind === 'todo' ? (
                              <CheckCircle2
                                className={cn(
                                  'size-3.5',
                                  hit.completed ? 'text-muted-foreground/60' : 'text-foreground/75',
                                )}
                              />
                            ) : hit.kind === 'timeline' ? (
                              <History className="size-3.5 text-foreground/75" />
                            ) : (
                              <FileText className="size-3.5 text-foreground/75" />
                            )}
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={cn(
                                  'truncate text-[13px] font-medium',
                                  hit.completed && 'text-muted-foreground line-through',
                                )}
                              >
                                {renderHighlighted(hit.title, query)}
                              </span>
                              <Badge
                                variant={hit.completed ? 'secondary' : 'outline'}
                                size="sm"
                                className="shrink-0"
                              >
                                {hit.badge}
                              </Badge>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                              {hit.locked && <Lock className="size-3 shrink-0" />}
                              <span className="truncate">
                                {renderHighlighted(hit.subtitle, query)}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CommandPanel>

        {/* Footer with Kbd Navigation Hints */}
        <CommandFooter className="shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <KbdGroup>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
              </KbdGroup>
              <span>切换</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd>
              <span>打开</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Esc</Kbd>
              <span>关闭</span>
            </span>
          </div>
          <Kbd className="px-1.5 font-mono text-[10.5px]">Ctrl+K</Kbd>
        </CommandFooter>
      </CommandDialogPopup>
    </CommandDialog>
  );
};

// ---------------------------------------------------------------------------
// 2. Quick Voice Recording Modal (快速录音)
// ---------------------------------------------------------------------------

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = typeof reader.result === 'string' ? reader.result : '';
      resolve(s.includes(',') ? s.split(',')[1] ?? '' : s);
    };
    reader.onerror = () => reject(reader.error ?? new Error('音频编码失败'));
    reader.readAsDataURL(blob);
  });
}

export const VoiceRecordModal: React.FC = () => {
  const {
    showVoiceModal,
    setShowVoiceModal,
    activeNotes,
    isMobileLayout,
    addTodo,
    addNote,
    addTimelineEntry,
    setActiveTab,
    setMobileSection,
    setEditingTodoId,
    showToast,
  } = useDeskTagStore();

  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => new Array<number>(16).fill(18));
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioMime, setAudioMime] = useState<string>('audio/webm');
  const [caption, setCaption] = useState('');
  const [targetTimelineId, setTargetTimelineId] = useState<string>('__auto__');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const timelineNotes = useMemo(
    () => activeNotes.filter((n) => n.kind === 'timeline'),
    [activeNotes],
  );

  const timelineSelectItems = useMemo(
    () =>
      timelineNotes.length > 0
        ? [
            { value: '__auto__', label: `${timelineNotes[0].title || '默认时间轴'}（默认）` },
            ...timelineNotes.map((n) => ({
              value: n.id,
              label: n.title || '未命名时间轴',
            })),
          ]
        : [],
    [timelineNotes],
  );

  const cleanupMedia = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  };

  useEffect(() => {
    if (!showVoiceModal) {
      cleanupMedia();
      setRecording(false);
    } else {
      const now = new Date();
      setCaption(`语音备忘 ${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
      setErrorMsg(null);
    }
    return () => {
      cleanupMedia();
    };
  }, [showVoiceModal]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    setErrorMsg(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setAudioBlob(null);
    setElapsedSec(0);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function' ||
      typeof MediaRecorder === 'undefined'
    ) {
      setErrorMsg('当前环境不支持麦克风录音（缺少 MediaRecorder 或 getUserMedia 权限）。');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ];
      const chosenMime =
        preferredTypes.find(
          (t) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t),
        ) ?? 'audio/webm';
      setAudioMime(chosenMime);

      const recorder = new MediaRecorder(
        stream,
        chosenMime ? { mimeType: chosenMime } : undefined,
      );
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const finalMime = recorder.mimeType || chosenMime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: finalMime });
        setAudioMime(finalMime);
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setRecording(false);
        cleanupMedia();
      };

      recorder.start(200);
      setRecording(true);

      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
      }, 250);

      // Live audio waveform visualization
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          src.connect(analyser);
          const bins = new Uint8Array(analyser.frequencyBinCount);
          const tickWave = () => {
            analyser.getByteFrequencyData(bins);
            const nextLevels: number[] = [];
            for (let i = 0; i < 16; i += 1) {
              const v = bins[i] ?? 0;
              nextLevels.push(Math.max(14, Math.min(100, Math.round((v / 255) * 100))));
            }
            setLevels(nextLevels);
            rafRef.current = window.requestAnimationFrame(tickWave);
          };
          tickWave();
        }
      } catch {
        // Fallback gentle pulse handled silently
      }
    } catch (err) {
      cleanupMedia();
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`无法访问麦克风：${msg}。请检查系统麦克风设备与录音权限。`);
    }
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop();
    } else {
      setRecording(false);
      cleanupMedia();
    }
  };

  const persistAudioAttachment = async () => {
    if (!audioBlob) throw new Error('尚未录制音频');
    const base64Data = await blobToBase64(audioBlob);
    const ext = audioMime.includes('ogg') ? 'ogg' : audioMime.includes('mp4') ? 'm4a' : 'webm';
    const stamp = formatTimestampYMDHM(new Date()).replace(/[/: ]/g, '-');
    return saveAttachment({
      name: `voice-${stamp}.${ext}`,
      mime: audioMime,
      kind: 'audio',
      base64Data,
    });
  };

  const handleSaveToTodo = async () => {
    if (!audioBlob) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const att = await persistAudioAttachment();
      const title = caption.trim() || '语音待办';
      const created = addTodo({
        title,
        dueDate: formatDateKey(new Date()),
        notes: `🎙️ 语音备忘 (${Math.max(1, elapsedSec)}s) · 附件：${att.name}`,
        noteImages: [att],
        tags: ['语音'],
      });
      setShowVoiceModal(false);
      setAudioBlob(null);
      setEditingTodoId(created.id);
      showToast('已将语音备忘保存为今日待办');
    } catch (err) {
      setErrorMsg(`保存失败：${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveToTimeline = async () => {
    if (!audioBlob) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const att = await persistAudioAttachment();
      let noteId = targetTimelineId;
      if (noteId === '__auto__' || !timelineNotes.some((n) => n.id === noteId)) {
        if (timelineNotes.length > 0) {
          noteId = timelineNotes[0].id;
        } else {
          const createdNote = addNote({ title: '随手记', kind: 'timeline', pinnedToSide: true });
          noteId = createdNote.id;
        }
      }
      addTimelineEntry(
        noteId,
        `${caption.trim() || '语音记录'}（${Math.max(1, elapsedSec)} 秒）`,
        [att],
      );
      setShowVoiceModal(false);
      setAudioBlob(null);
      setActiveTab({ kind: 'note', noteId });
      if (isMobileLayout) setMobileSection('notes');
      showToast('已将语音追加到时间轴便签');
    } catch (err) {
      setErrorMsg(`保存失败：${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCloseVoice = () => {
    if (recording) stopRecording();
    setShowVoiceModal(false);
  };

  const timerText = `${pad2(Math.floor(elapsedSec / 60))}:${pad2(elapsedSec % 60)}`;

  return (
    <Dialog
      open={showVoiceModal}
      onOpenChange={(open) => {
        if (!open && !recording) {
          setShowVoiceModal(false);
        }
      }}
    >
      <DialogPopup
        showCloseButton={false}
        className="max-w-[392px] overflow-hidden"
      >
        <DialogHeader className="flex-row items-center justify-between px-4 pt-3.5 pb-2">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold">
            <Mic className="size-4 text-muted-foreground" />
            <span>快速录音</span>
          </DialogTitle>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="关闭录音"
            onClick={handleCloseVoice}
          >
            <X className="size-4" />
          </Button>
        </DialogHeader>

        <DialogPanel className="flex flex-col gap-3 px-4 pt-1 pb-4">
          {/* Waveform Visualizer inside FramePanel */}
          <Frame>
            <FramePanel className="flex flex-col items-center gap-3 py-4 px-3">
              {/* Recording Status & Timer Badge */}
              <Badge
                variant={recording ? 'error' : 'secondary'}
                size="lg"
                className="gap-1.5 rounded-full px-3 font-mono tabular-nums"
              >
                <span
                  className={cn(
                    'inline-block size-2 rounded-full',
                    recording ? 'bg-destructive animate-pulse' : 'bg-muted-foreground/50',
                  )}
                  aria-hidden="true"
                />
                <span>{timerText}</span>
              </Badge>

              {/* 16-bar Live Waveform */}
              <div
                className="flex h-12 items-center gap-1"
                aria-hidden="true"
              >
                {levels.map((lv, i) => (
                  <span
                    key={i}
                    className={cn(
                      'w-1 rounded-full transition-[height,background-color] duration-75',
                      recording ? 'bg-dt-accent' : 'bg-muted-foreground/25',
                    )}
                    style={{
                      height: recording ? `${Math.max(16, lv)}%` : '22%',
                    }}
                  />
                ))}
              </div>

              <Button
                size="sm"
                variant={recording ? 'destructive' : 'default'}
                onClick={() => (recording ? stopRecording() : void startRecording())}
                className="rounded-full px-5"
              >
                {recording ? <Square className="size-3.5" /> : <Mic className="size-3.5" />}
                <span>{recording ? '停止录音' : audioBlob ? '重新录制' : '开始录音'}</span>
              </Button>
            </FramePanel>
          </Frame>

          {errorMsg && (
            <Alert variant="error" className="px-3 py-2">
              <AlertCircle className="size-3.5" />
              <AlertDescription className="text-xs text-destructive-foreground">
                {errorMsg}
              </AlertDescription>
            </Alert>
          )}

          {/* Playback & Save Destination */}
          {audioUrl && !recording && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-coss-frame-well px-3 py-2">
                <Volume2 className="size-4 shrink-0 text-muted-foreground" />
                <audio controls src={audioUrl} className="h-8 w-full" />
              </div>

              <Field>
                <FieldLabel className="text-xs">语音说明</FieldLabel>
                <Input
                  size="sm"
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="输入语音标题或说明…"
                />
              </Field>

              {timelineNotes.length > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    目标时间轴
                  </span>
                  <Select
                    items={timelineSelectItems}
                    value={targetTimelineId}
                    onValueChange={(val) => {
                      if (val !== null) setTargetTimelineId(val);
                    }}
                  >
                    <SelectTrigger size="sm" className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {timelineSelectItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              )}

              <div className="flex items-center gap-2 pt-0.5">
                <Button
                  size="sm"
                  variant="outline"
                  loading={saving}
                  onClick={() => void handleSaveToTodo()}
                  className="flex-1 text-xs"
                >
                  <CheckSquare className="size-3.5" />
                  <span>保存为待办</span>
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  loading={saving}
                  onClick={() => void handleSaveToTimeline()}
                  className="flex-1 text-xs"
                >
                  <Clock className="size-3.5" />
                  <span>保存到时间轴</span>
                </Button>
              </div>
            </div>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
};

export const SearchVoiceModals: React.FC = () => (
  <>
    <SearchModal />
    <VoiceRecordModal />
  </>
);

export default SearchVoiceModals;
