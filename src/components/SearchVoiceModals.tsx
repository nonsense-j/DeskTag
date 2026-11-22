import React, { useEffect, useMemo, useRef, useState } from 'react';
import { saveAttachment } from '../api/tauri';
import { useDeskTagStore } from '../store/useDeskTagStore';
import { formatDateKey, formatTimestampYMDHM, pad2 } from '../utils/lunar';
import {
  AudioIcon,
  CheckIcon,
  CloseIcon,
  MicIcon,
  NoteIcon,
  SearchIcon,
  TimelineIcon,
} from './Icons';

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
        style={{
          background: 'var(--accent-soft)',
          color: 'var(--accent-soft-text)',
          borderRadius: 3,
          padding: '0 2px',
        }}
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
// 1. Global Search Modal (检索)
// ---------------------------------------------------------------------------

interface SearchHit {
  id: string;
  kind: 'todo' | 'note' | 'timeline';
  title: string;
  subtitle: string;
  badge: string;
  completed?: boolean;
  todoId?: string;
  noteId?: string;
}

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
  const [filterKind, setFilterKind] = useState<'all' | 'todo' | 'note' | 'timeline'>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);

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
            badge: todo.completed ? '已完成待办' : '待办',
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
              ? '🔒 隐私分组已锁定'
              : buildSnippet(note.content || '空白便签', query),
            badge: '普通便签',
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
              subtitle: '🔒 隐私分组已锁定',
              badge: '时间轴',
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
            if (!q) break; // when browsing empty query, show only latest entry per timeline
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

  if (!showSearch) return null;

  return (
    <div
      onClick={() => setShowSearch(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 16, 12, 0.36)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '56px 14px 16px',
        zIndex: 90,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 460,
          maxHeight: '76vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 14,
          background: 'var(--bg-popover)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-popover)',
          overflow: 'hidden',
        }}
      >
        {/* Search Input Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '11px 14px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-header)',
          }}
        >
          <SearchIcon size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((i) => Math.min(results.length - 1, i + 1));
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
            placeholder="检索待办、子任务、标签、便签与时间轴… (Ctrl+K)"
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: 13.5,
            }}
          />
          <button
            type="button"
            aria-label="关闭检索"
            onClick={() => setShowSearch(false)}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              padding: 2,
            }}
          >
            <CloseIcon size={15} />
          </button>
        </div>

        {/* Scope Filter Pills */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '7px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-panel)',
          }}
        >
          {(
            [
              ['all', '全部'],
              ['todo', '待办'],
              ['note', '普通便签'],
              ['timeline', '时间轴'],
            ] as const
          ).map(([k, label]) => {
            const active = filterKind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setFilterKind(k)}
                style={{
                  padding: '3px 9px',
                  borderRadius: 999,
                  border: 'none',
                  background: active ? 'var(--pill-active-bg)' : 'transparent',
                  color: active ? 'var(--pill-active-text)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
            {results.length} 条结果
          </span>
        </div>

        {/* Results List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {results.length === 0 ? (
            <div style={{ padding: '28px 12px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
              没有找到包含「{query}」的内容
            </div>
          ) : (
            results.map((hit, idx) => {
              const active = idx === selectedIndex;
              return (
                <button
                  key={hit.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => handleOpenHit(hit)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 9,
                    border: `1px solid ${active ? 'var(--accent-border)' : 'transparent'}`,
                    background: active ? 'var(--bg-surface-hover)' : 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 9,
                  }}
                >
                  <span style={{ marginTop: 2, color: 'var(--accent)', flexShrink: 0 }}>
                    {hit.kind === 'todo' ? (
                      <CheckIcon size={14} />
                    ) : hit.kind === 'timeline' ? (
                      <TimelineIcon size={14} />
                    ) : (
                      <NoteIcon size={14} />
                    )}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          color: hit.completed ? 'var(--text-completed)' : 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {renderHighlighted(hit.title, query)}
                      </span>
                      <span
                        style={{
                          fontSize: 10.5,
                          padding: '1px 6px',
                          borderRadius: 999,
                          background: 'var(--tag-bg)',
                          color: 'var(--tag-text)',
                          flexShrink: 0,
                        }}
                      >
                        {hit.badge}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {renderHighlighted(hit.subtitle, query)}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
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

      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const chosenMime =
        preferredTypes.find((t) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t)) ??
        'audio/webm';
      setAudioMime(chosenMime);

      const recorder = new MediaRecorder(stream, chosenMime ? { mimeType: chosenMime } : undefined);
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
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
      // Create a companion timeline entry if none, or attach to todo directly
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

  if (!showVoiceModal) return null;

  const timerText = `${pad2(Math.floor(elapsedSec / 60))}:${pad2(elapsedSec % 60)}`;

  return (
    <div
      onClick={() => {
        if (!recording) setShowVoiceModal(false);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 16, 12, 0.38)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 90,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 370,
          borderRadius: 14,
          background: 'var(--bg-popover)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-popover)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '11px 14px',
            background: 'var(--bg-header)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 14 }}>
            <MicIcon size={16} style={{ color: 'var(--accent)' }} />
            <span>快速录音</span>
          </div>
          <button
            type="button"
            aria-label="关闭录音"
            onClick={() => {
              if (recording) stopRecording();
              setShowVoiceModal(false);
            }}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
            }}
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Waveform + Timer */}
          <div
            style={{
              padding: '14px 12px',
              borderRadius: 12,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                height: 44,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {levels.map((lv, i) => (
                <span
                  key={i}
                  style={{
                    width: 4,
                    height: recording ? `${Math.max(16, lv)}%` : '22%',
                    borderRadius: 999,
                    background: recording ? 'var(--accent)' : 'var(--border-strong)',
                    transition: 'height 80ms ease',
                  }}
                />
              ))}
            </div>

            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: recording ? 'var(--accent)' : 'var(--text-primary)',
              }}
            >
              {timerText}
            </div>

            <button
              type="button"
              onClick={() => (recording ? stopRecording() : void startRecording())}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 18px',
                borderRadius: 999,
                border: 'none',
                background: recording ? 'var(--danger)' : 'var(--accent)',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <MicIcon size={14} />
              <span>{recording ? '停止录音' : audioBlob ? '重新录制' : '开始录音'}</span>
            </button>
          </div>

          {errorMsg && (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 9,
                background: 'var(--danger-soft)',
                color: 'var(--danger)',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {errorMsg}
            </div>
          )}

          {/* Playback & Save Destination */}
          {audioUrl && !recording && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AudioIcon size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <audio controls src={audioUrl} style={{ width: '100%', height: 32 }} />
              </div>

              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="输入语音标题或说明…"
                style={{
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />

              {timelineNotes.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>目标时间轴：</span>
                  <select
                    value={targetTimelineId}
                    onChange={(e) => setTargetTimelineId(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '4px 8px',
                      borderRadius: 7,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                    }}
                  >
                    <option value="__auto__">{timelineNotes[0].title || '默认时间轴'}</option>
                    {timelineNotes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.title || '未命名时间轴'}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveToTodo()}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    borderRadius: 9,
                    border: '1px solid var(--accent-border)',
                    background: 'var(--accent-soft)',
                    color: 'var(--accent-soft-text)',
                    fontWeight: 600,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  存为今日待办
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveToTimeline()}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    borderRadius: 9,
                    border: 'none',
                    background: 'var(--accent)',
                    color: 'var(--accent-text)',
                    fontWeight: 600,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  {saving ? '保存中…' : '追加到时间轴'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const SearchVoiceModals: React.FC = () => (
  <>
    <SearchModal />
    <VoiceRecordModal />
  </>
);

export default SearchVoiceModals;
