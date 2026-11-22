import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isTauriRuntime,
  openAttachment,
  openNoteWindow,
  readAttachmentDataUrl,
  saveAttachment,
} from '../api/tauri';
import { useDeskTagStore } from '../store/useDeskTagStore';
import type {
  AttachmentKind,
  AttachmentRef,
  ContentLink,
  TimelineEntry,
} from '../types/models';
import { exportDeskTagDocument } from '../utils/exporter';
import { formatTimeHMS, formatTimestampYMDHM } from '../utils/lunar';
import {
  ArrowLeftIcon,
  AudioIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  EditIcon,
  ExportIcon,
  FileIcon,
  ImageIcon,
  LinkIcon,
  LockIcon,
  MinimizeIcon,
  NoteIcon,
  OutlineIcon,
  PinIcon,
  PlusIcon,
  PopoutIcon,
  SendIcon,
  TableIcon,
  TimelineIcon,
  TrashIcon,
} from './Icons';

export interface NoteViewProps {
  noteId: string;
  standalone?: boolean;
}

// ---------------------------------------------------------------------------
// Structured Markdown Block Parser & Serializer (headings, tables, paragraphs)
// ---------------------------------------------------------------------------

type NoteBlock =
  | { id: string; type: 'heading'; level: 1 | 2 | 3; text: string }
  | { id: string; type: 'table'; rows: string[][] }
  | { id: string; type: 'paragraph'; text: string };

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const cleaned = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const parts = cleaned.split('|').map((s) => s.trim());
  return parts.length >= 2 && parts.every((p) => /^:?-{2,}:?$/.test(p));
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function parseContentToBlocks(markdown: string): NoteBlock[] {
  const rawLines = (markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: NoteBlock[] = [];
  let paraBuf: string[] = [];
  let idx = 0;
  let blockSeq = 0;

  const flushPara = () => {
    if (paraBuf.length === 0) return;
    const text = paraBuf.join('\n').trimEnd();
    if (text.length > 0) {
      blocks.push({ id: `blk_${blockSeq++}`, type: 'paragraph', text });
    }
    paraBuf = [];
  };

  while (idx < rawLines.length) {
    const line = rawLines[idx];

    // Heading (#, ##, ###)
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushPara();
      const level = Math.min(3, headingMatch[1].length) as 1 | 2 | 3;
      blocks.push({
        id: `blk_${blockSeq++}`,
        type: 'heading',
        level,
        text: headingMatch[2],
      });
      idx += 1;
      continue;
    }

    // Pipe Table (header + separator + body rows)
    if (
      line.includes('|') &&
      idx + 1 < rawLines.length &&
      isTableSeparatorLine(rawLines[idx + 1])
    ) {
      flushPara();
      const headerCells = splitTableRow(line);
      const colCount = Math.max(2, headerCells.length);
      const normalize = (cells: string[]) => {
        const out = cells.slice(0, colCount);
        while (out.length < colCount) out.push('');
        return out;
      };
      const rows: string[][] = [normalize(headerCells)];
      idx += 2;
      while (idx < rawLines.length && rawLines[idx].trim().includes('|')) {
        rows.push(normalize(splitTableRow(rawLines[idx])));
        idx += 1;
      }
      if (rows.length < 2) {
        rows.push(new Array<string>(colCount).fill(''));
      }
      blocks.push({ id: `blk_${blockSeq++}`, type: 'table', rows });
      continue;
    }

    // Blank line splits paragraphs
    if (line.trim() === '') {
      flushPara();
      idx += 1;
      continue;
    }

    paraBuf.push(line);
    idx += 1;
  }

  flushPara();

  if (blocks.length === 0) {
    blocks.push({ id: 'blk_0', type: 'paragraph', text: '' });
  }
  return blocks;
}

function serializeBlocksToMarkdown(blocks: NoteBlock[]): string {
  return blocks
    .map((blk) => {
      if (blk.type === 'heading') {
        return `${'#'.repeat(blk.level)} ${blk.text}`;
      }
      if (blk.type === 'table') {
        if (blk.rows.length === 0) return '';
        const colCount = Math.max(1, blk.rows[0].length);
        const header = `| ${blk.rows[0].map((c) => c.replace(/\|/g, '｜')).join(' | ')} |`;
        const sep = `| ${new Array<string>(colCount).fill('---').join(' | ')} |`;
        const body = blk.rows
          .slice(1)
          .map((r) => `| ${r.map((c) => c.replace(/\|/g, '｜')).join(' | ')} |`);
        return [header, sep, ...body].join('\n');
      }
      return blk.text;
    })
    .filter((s, i, arr) => s.length > 0 || (arr.length === 1 && i === 0))
    .join('\n\n');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function countVisibleChars(text: string): number {
  return text.replace(/\s+/g, '').length;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] ?? '' : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

// Lazy inline attachment preview for image or audio
const AttachmentMedia: React.FC<{
  att: AttachmentRef;
  onRemove?: () => void;
}> = ({ att, onRemove }) => {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let active = true;
    if (att.kind === 'image' || att.kind === 'audio') {
      void readAttachmentDataUrl(att.relativePath, att.mime)
        .then((url) => {
          if (active) setDataUrl(url);
        })
        .catch(() => {
          // ignore
        });
    }
    return () => {
      active = false;
    };
  }, [att.relativePath, att.mime, att.kind]);

  if (att.kind === 'image') {
    return (
      <div
        style={{
          position: 'relative',
          display: 'inline-block',
          maxWidth: '100%',
          borderRadius: 9,
          overflow: 'hidden',
          border: '1px solid var(--border)',
          background: 'var(--bg-surface)',
        }}
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={att.name}
            onClick={() => void openAttachment(att.relativePath)}
            style={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: 240,
              objectFit: 'contain',
              cursor: 'pointer',
            }}
          />
        ) : (
          <div style={{ padding: '16px 20px', fontSize: 12, color: 'var(--text-muted)' }}>
            加载图片：{att.name}…
          </div>
        )}
        {onRemove && (
          <button
            type="button"
            title="移除图片"
            onClick={onRemove}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(0,0,0,0.55)',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            ×
          </button>
        )}
      </div>
    );
  }

  if (att.kind === 'audio') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderRadius: 9,
          border: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          flexWrap: 'wrap',
        }}
      >
        <AudioIcon size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{att.name}</span>
        {dataUrl ? (
          <audio controls src={dataUrl} style={{ height: 28, maxWidth: 220 }} />
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatFileSize(att.size)}</span>
        )}
        {onRemove && (
          <button
            type="button"
            title="移除音频"
            onClick={onRemove}
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            ×
          </button>
        )}
      </div>
    );
  }

  // File attachment chip
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 8px',
        borderRadius: 7,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        fontSize: 12.5,
      }}
    >
      <FileIcon size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <button
        type="button"
        onClick={() => void openAttachment(att.relativePath)}
        style={{
          border: 'none',
          background: 'transparent',
          padding: 0,
          color: 'var(--accent)',
          fontSize: 12.5,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        {att.name}
      </button>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
        {formatFileSize(att.size)}
      </span>
      {onRemove && (
        <button
          type="button"
          title="移除附件"
          onClick={onRemove}
          style={{
            border: 'none',
            background: 'transparent',
            padding: '0 2px',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </span>
  );
};

// Auto-growing textarea helper
const AutoTextarea: React.FC<{
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus?: () => void;
  placeholder?: string;
  style?: React.CSSProperties;
}> = ({ value, onChange, onKeyDown, onFocus, placeholder, style }) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(24, el.scrollHeight)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      placeholder={placeholder}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        border: 'none',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        background: 'transparent',
        fontFamily: 'inherit',
        ...style,
      }}
    />
  );
};

export const NoteView: React.FC<NoteViewProps> = ({ noteId, standalone = false }) => {
  const {
    data,
    activeNotes,
    activeTodos,
    activeNoteGroups,
    unlockedGroupIds,
    navHistory,
    updateNote,
    toggleNotePin,
    addTimelineEntry,
    updateTimelineEntry,
    deleteTimelineEntry,
    convertTimelineEntryToTodo,
    addContentLink,
    replaceContentLink,
    removeContentLink,
    openContentLink,
    navigateBack,
    unlockNoteGroup,
    setEditingTodoId,
    showToast,
  } = useDeskTagStore();

  const note = useMemo(
    () => activeNotes.find((n) => n.id === noteId) ?? null,
    [activeNotes, noteId],
  );

  const noteGroup = useMemo(
    () => (note?.groupId ? activeNoteGroups.find((g) => g.id === note.groupId) ?? null : null),
    [note?.groupId, activeNoteGroups],
  );

  const isGroupLocked = Boolean(
    noteGroup && noteGroup.locked && !unlockedGroupIds.has(noteGroup.id),
  );

  // Privacy lock PIN prompt
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  // Toolbar & overlays
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [showOutline, setShowOutline] = useState(true);
  const [outlineHover, setOutlineHover] = useState(false);
  const [standalonePinned, setStandalonePinned] = useState(false);

  // Structured block state for normal note
  const [blocks, setBlocks] = useState<NoteBlock[]>(() =>
    parseContentToBlocks(note?.content ?? ''),
  );
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [collapsedHeadings, setCollapsedHeadings] = useState<Set<string>>(() => new Set());
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const lastSerializedRef = useRef<string>(note?.content ?? '');
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Sync incoming external changes (e.g., WebDAV sync or switching notes)
  useEffect(() => {
    if (!note) return;
    if (note.content !== lastSerializedRef.current) {
      lastSerializedRef.current = note.content;
      setBlocks(parseContentToBlocks(note.content));
      setCollapsedHeadings(new Set());
    }
  }, [note?.id, note?.content]);

  // '@' Link Picker
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [replacingLinkTargetId, setReplacingLinkTargetId] = useState<string | null>(null);

  // File pickers
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timelineFileRef = useRef<HTMLInputElement | null>(null);

  // Timeline composer state
  const [timelineDraft, setTimelineDraft] = useState('');
  const [timelineAttachments, setTimelineAttachments] = useState<AttachmentRef[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingEntryText, setEditingEntryText] = useState('');

  const commitBlocks = useCallback(
    (nextBlocks: NoteBlock[]) => {
      setBlocks(nextBlocks);
      if (!note) return;
      const serialized = serializeBlocksToMarkdown(nextBlocks);
      lastSerializedRef.current = serialized;
      updateNote(note.id, { content: serialized });
    },
    [note, updateNote],
  );

  // Compute headings & collapsed visibility
  const headings = useMemo(
    () => blocks.filter((b): b is Extract<NoteBlock, { type: 'heading' }> => b.type === 'heading'),
    [blocks],
  );

  const visibleBlocks = useMemo(() => {
    const out: Array<{ block: NoteBlock; hidden: boolean }> = [];
    let collapsedLevel: number | null = null;
    for (const blk of blocks) {
      if (blk.type === 'heading') {
        if (collapsedLevel !== null && blk.level <= collapsedLevel) {
          collapsedLevel = null;
        }
        const hidden = collapsedLevel !== null;
        out.push({ block: blk, hidden });
        if (!hidden && collapsedHeadings.has(blk.id)) {
          collapsedLevel = blk.level;
        }
      } else {
        out.push({ block: blk, hidden: collapsedLevel !== null });
      }
    }
    return out;
  }, [blocks, collapsedHeadings]);

  const toggleHeadingCollapse = (headingId: string) => {
    setCollapsedHeadings((prev) => {
      const next = new Set(prev);
      if (next.has(headingId)) next.delete(headingId);
      else next.add(headingId);
      return next;
    });
  };

  const scrollToHeading = (headingId: string) => {
    setActiveHeadingId(headingId);
    const el = blockRefs.current[headingId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Block mutations
  const updateBlockText = (blockId: string, text: string) => {
    // Detect "@" trigger at end of text
    if (text.endsWith('@') || /(?:^|\s)@$/.test(text)) {
      setReplacingLinkTargetId(null);
      setLinkSearch('');
      setShowLinkPicker(true);
    }

    const next = blocks.map((b) => {
      if (b.id !== blockId) return b;
      if (b.type === 'paragraph') {
        const hm = /^(#{1,3})\s+(.*)$/.exec(text);
        if (hm) {
          return {
            id: b.id,
            type: 'heading' as const,
            level: hm[1].length as 1 | 2 | 3,
            text: hm[2],
          };
        }
        return { ...b, text };
      }
      if (b.type === 'heading') {
        return { ...b, text };
      }
      return b;
    });
    commitBlocks(next);
  };

  const insertBlockAfter = (afterId: string | null, newBlock: NoteBlock) => {
    const idx = afterId ? blocks.findIndex((b) => b.id === afterId) : blocks.length - 1;
    const pos = idx >= 0 ? idx + 1 : blocks.length;
    const next = [...blocks.slice(0, pos), newBlock, ...blocks.slice(pos)];
    commitBlocks(next);
    setFocusedBlockId(newBlock.id);
  };

  const removeBlock = (blockId: string) => {
    if (blocks.length <= 1) {
      commitBlocks([{ id: blockId, type: 'paragraph', text: '' }]);
      return;
    }
    commitBlocks(blocks.filter((b) => b.id !== blockId));
  };

  const applyFormatAction = (
    kind: 'h1' | 'h2' | 'h3' | 'bold' | 'italic' | 'list' | 'quote' | 'code',
  ) => {
    const targetId = focusedBlockId ?? blocks[blocks.length - 1]?.id;
    if (!targetId) return;
    const next = blocks.map((b) => {
      if (b.id !== targetId) return b;
      if (kind === 'h1' || kind === 'h2' || kind === 'h3') {
        const level = kind === 'h1' ? 1 : kind === 'h2' ? 2 : 3;
        const txt = b.type === 'table' ? '标题' : b.text;
        return { id: b.id, type: 'heading' as const, level: level as 1 | 2 | 3, text: txt };
      }
      if (b.type === 'table') return b;
      if (kind === 'bold') return { ...b, text: b.text ? `${b.text} **加粗文字**` : '**加粗文字**' };
      if (kind === 'italic') return { ...b, text: b.text ? `${b.text} *斜体文字*` : '*斜体文字*' };
      if (kind === 'list') {
        const prefix = b.text && !b.text.endsWith('\n') ? '\n- ' : '- ';
        return { id: b.id, type: 'paragraph' as const, text: `${b.text}${prefix}` };
      }
      if (kind === 'quote') {
        const prefix = b.text && !b.text.endsWith('\n') ? '\n> ' : '> ';
        return { id: b.id, type: 'paragraph' as const, text: `${b.text}${prefix}` };
      }
      const prefix = b.text && !b.text.endsWith('\n') ? '\n```\n\n```' : '```\n\n```';
      return { id: b.id, type: 'paragraph' as const, text: `${b.text}${prefix}` };
    });
    commitBlocks(next);
  };

  const handleInsertTable = () => {
    setShowInsertMenu(false);
    const tbl: NoteBlock = {
      id: `blk_${Date.now().toString(36)}`,
      type: 'table',
      rows: [
        ['事项', '负责人', '状态'],
        ['待补充', '', '进行中'],
      ],
    };
    insertBlockAfter(focusedBlockId, tbl);
  };

  const updateTableCell = (blockId: string, rIdx: number, cIdx: number, val: string) => {
    const next = blocks.map((b) => {
      if (b.id !== blockId || b.type !== 'table') return b;
      const rows = b.rows.map((row, ri) =>
        ri === rIdx ? row.map((cell, ci) => (ci === cIdx ? val : cell)) : row,
      );
      return { ...b, rows };
    });
    commitBlocks(next);
  };

  const mutateTable = (blockId: string, op: 'addRow' | 'delRow' | 'addCol' | 'delCol') => {
    const next = blocks.map((b) => {
      if (b.id !== blockId || b.type !== 'table') return b;
      const cols = b.rows[0]?.length ?? 3;
      if (op === 'addRow') {
        return { ...b, rows: [...b.rows, new Array<string>(cols).fill('')] };
      }
      if (op === 'delRow' && b.rows.length > 2) {
        return { ...b, rows: b.rows.slice(0, -1) };
      }
      if (op === 'addCol') {
        return { ...b, rows: b.rows.map((r, ri) => [...r, ri === 0 ? `列 ${cols + 1}` : '']) };
      }
      if (op === 'delCol' && cols > 2) {
        return { ...b, rows: b.rows.map((r) => r.slice(0, -1)) };
      }
      return b;
    });
    commitBlocks(next);
  };

  // File & Image upload handlers
  const handleFileUpload = async (files: FileList | null, forcedKind?: AttachmentKind, forTimeline = false) => {
    if (!files || files.length === 0 || !note) return;
    const added: AttachmentRef[] = [];
    for (const file of Array.from(files)) {
      try {
        const base64Data = await readFileAsBase64(file);
        const kind: AttachmentKind =
          forcedKind ??
          (file.type.startsWith('image/')
            ? 'image'
            : file.type.startsWith('audio/')
              ? 'audio'
              : 'file');
        const att = await saveAttachment({
          name: file.name,
          mime: file.type || 'application/octet-stream',
          kind,
          base64Data,
        });
        added.push(att);
      } catch (err) {
        showToast(`附件保存失败：${String(err)}`);
      }
    }
    if (added.length === 0) return;
    if (forTimeline) {
      setTimelineAttachments((prev) => [...prev, ...added]);
    } else {
      updateNote(note.id, { attachments: [...note.attachments, ...added] });
      showToast(`已添加 ${added.length} 个附件`);
    }
  };

  const handleRemoveNoteAttachment = (attId: string) => {
    if (!note) return;
    updateNote(note.id, {
      attachments: note.attachments.filter((a) => a.id !== attId),
    });
  };

  // '@' Link Picker items
  const linkCandidates = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    const todoOpts: ContentLink[] = activeTodos
      .filter((t) => !q || t.title.toLowerCase().includes(q))
      .slice(0, 12)
      .map((t) => ({ targetType: 'todo', targetId: t.id, label: t.title }));
    const noteOpts: ContentLink[] = activeNotes
      .filter((n) => n.id !== note?.id && (!q || n.title.toLowerCase().includes(q)))
      .slice(0, 12)
      .map((n) => ({ targetType: 'note', targetId: n.id, label: n.title || '未命名便签' }));
    return [...noteOpts, ...todoOpts];
  }, [activeTodos, activeNotes, linkSearch, note?.id]);

  const handleSelectLinkCandidate = (link: ContentLink) => {
    if (!note) return;
    if (replacingLinkTargetId) {
      replaceContentLink('note', note.id, replacingLinkTargetId, link);
      showToast(`已将关联替换为「${link.label}」`);
    } else {
      addContentLink('note', note.id, link);
      showToast(`已关联「${link.label}」`);
    }
    setShowLinkPicker(false);
    setReplacingLinkTargetId(null);
    setLinkSearch('');
  };

  // Timeline submit
  const handleAddTimelineEntry = () => {
    if (!note) return;
    const text = timelineDraft.trim();
    if (!text && timelineAttachments.length === 0) return;
    addTimelineEntry(note.id, text || '(附件记录)', timelineAttachments);
    setTimelineDraft('');
    setTimelineAttachments([]);
  };

  const handleSaveEntryEdit = (entry: TimelineEntry) => {
    if (!note) return;
    updateTimelineEntry(note.id, entry.id, { content: editingEntryText.trim() || entry.content });
    setEditingEntryId(null);
    setEditingEntryText('');
  };

  // Standalone window controls
  const handleToggleStandalonePin = async () => {
    const next = !standalonePinned;
    setStandalonePinned(next);
    if (isTauriRuntime()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().setAlwaysOnTop(next);
      } catch {
        // ignore
      }
    }
  };

  const handleStandaloneMinimize = async () => {
    if (isTauriRuntime()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().minimize();
      } catch {
        // ignore
      }
    }
  };

  const handleStandaloneClose = async () => {
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

  const handleUnlockGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteGroup) return;
    const ok = await unlockNoteGroup(noteGroup.id, pinInput);
    if (!ok) {
      setPinError('密码不正确，请重试');
    } else {
      setPinError(null);
      setPinInput('');
    }
  };

  if (!note) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 13.5,
          padding: 24,
        }}
      >
        未找到该便签（可能已被删除）。
      </div>
    );
  }

  if (isGroupLocked && noteGroup) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 28,
          background: 'var(--bg-panel)',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LockIcon size={22} />
        </div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>分组「{noteGroup.name}」已启用隐私锁</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          输入 4–6 位密码后即可查看和编辑「{note.title || '未命名便签'}」
        </div>
        <form
          onSubmit={(e) => void handleUnlockGroup(e)}
          style={{ display: 'flex', gap: 8, marginTop: 4 }}
        >
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pinInput}
            onChange={(e) => {
              setPinInput(e.target.value);
              setPinError(null);
            }}
            placeholder="输入分组 PIN"
            style={{
              width: 150,
              padding: '7px 10px',
              borderRadius: 9,
              border: '1px solid var(--border)',
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              fontSize: 14,
              textAlign: 'center',
              letterSpacing: '0.2em',
            }}
          />
          <button
            type="submit"
            style={{
              padding: '7px 14px',
              borderRadius: 9,
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--accent-text)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            解锁
          </button>
        </form>
        {pinError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{pinError}</div>}
      </div>
    );
  }

  const savedClock = formatTimeHMS(new Date(note.updatedAt || Date.now()));
  const totalCharCount =
    note.kind === 'normal'
      ? countVisibleChars(note.content)
      : note.timelineEntries.reduce((sum, e) => sum + countVisibleChars(e.content), 0);

  const noteImages = note.attachments.filter((a) => a.kind === 'image');
  const noteOtherAttachments = note.attachments.filter((a) => a.kind !== 'image');

  return (
    <div
      className="dt-note-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-panel)',
        color: 'var(--text-primary)',
        position: 'relative',
        borderRadius: standalone ? 12 : 0,
        overflow: 'hidden',
        border: standalone ? '1px solid var(--border)' : 'none',
      }}
    >
      {/* Hidden file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleFileUpload(e.target.files, 'image', false);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleFileUpload(e.target.files, undefined, false);
          e.target.value = '';
        }}
      />
      <input
        ref={timelineFileRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleFileUpload(e.target.files, undefined, true);
          e.target.value = '';
        }}
      />

      {/* Standalone Window Titlebar */}
      {standalone && (
        <header
          data-tauri-drag-region
          style={{
            height: 38,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px 0 14px',
            background: 'var(--bg-header)',
            borderBottom: '1px solid var(--border)',
            userSelect: 'none',
          }}
        >
          <div
            data-tauri-drag-region
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600 }}
          >
            {note.kind === 'timeline' ? (
              <TimelineIcon size={15} style={{ color: 'var(--accent)' }} />
            ) : (
              <NoteIcon size={15} style={{ color: 'var(--accent)' }} />
            )}
            <span>{note.title || '独立便签'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              type="button"
              title={standalonePinned ? '取消置顶' : '窗口置顶'}
              onClick={() => void handleToggleStandalonePin()}
              style={{
                width: 26,
                height: 26,
                border: 'none',
                borderRadius: 6,
                background: standalonePinned ? 'var(--accent-soft)' : 'transparent',
                color: standalonePinned ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <PinIcon size={14} />
            </button>
            <button
              type="button"
              title="最小化"
              onClick={() => void handleStandaloneMinimize()}
              style={{
                width: 26,
                height: 26,
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <MinimizeIcon size={14} />
            </button>
            <button
              type="button"
              title="关闭窗口"
              onClick={() => void handleStandaloneClose()}
              style={{
                width: 26,
                height: 26,
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </header>
      )}

      {/* Note Sub-header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '9px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-panel)',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          {navHistory.length > 0 && (
            <button
              type="button"
              title={`返回 ${navHistory[navHistory.length - 1]?.label ?? ''}`}
              onClick={navigateBack}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '2px 7px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
                fontSize: 11.5,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <ArrowLeftIcon size={12} />
              <span>返回</span>
            </button>
          )}
          <input
            type="text"
            value={note.title}
            onChange={(e) => updateNote(note.id, { title: e.target.value })}
            placeholder="未命名便签"
            style={{
              flex: '0 1 180px',
              minWidth: 72,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: 15,
              fontWeight: 700,
              padding: 0,
            }}
          />
          <span
            style={{
              fontSize: 11.5,
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            已保存 {savedClock}
          </span>
        </div>

        {/* 5 Right Toolbar Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
          {note.kind === 'normal' && (
            <button
              type="button"
              title="文本格式工具栏"
              onClick={() => {
                setShowFormatBar((v) => !v);
                setShowInsertMenu(false);
              }}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 7,
                background: showFormatBar ? 'var(--accent-soft)' : 'transparent',
                color: showFormatBar ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontFamily: 'Georgia, serif',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              A
            </button>
          )}

          <button
            type="button"
            title="插入内容 / 切换模式"
            onClick={() => {
              setShowInsertMenu((v) => !v);
              setShowFormatBar(false);
            }}
            style={{
              width: 28,
              height: 28,
              border: 'none',
              borderRadius: 7,
              background: showInsertMenu ? 'var(--accent-soft)' : 'transparent',
              color: showInsertMenu ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <PlusIcon size={15} />
          </button>

          {note.kind === 'normal' && (
            <button
              type="button"
              title={showOutline ? '隐藏右侧文档大纲' : '显示右侧文档大纲'}
              onClick={() => setShowOutline((v) => !v)}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 7,
                background: showOutline ? 'var(--accent-soft)' : 'transparent',
                color: showOutline ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <OutlineIcon size={15} />
            </button>
          )}

          <button
            type="button"
            title={note.pinnedToSide ? '取消固定到侧边页签' : '固定到侧边页签'}
            onClick={() => {
              toggleNotePin(note.id);
              showToast(note.pinnedToSide ? '已取消固定到侧边页签' : '已固定到侧边页签');
            }}
            style={{
              width: 28,
              height: 28,
              border: 'none',
              borderRadius: 7,
              background: note.pinnedToSide ? 'var(--accent-soft)' : 'transparent',
              color: note.pinnedToSide ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <PinIcon size={14} />
          </button>

          {!standalone ? (
            <button
              type="button"
              title="独立窗口打开"
              onClick={() => void openNoteWindow(note.id)}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 7,
                background: 'transparent',
                color: 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <PopoutIcon size={14} />
            </button>
          ) : (
            <button
              type="button"
              title="导出当前便签 (Markdown)"
              onClick={() =>
                void exportDeskTagDocument(data, 'markdown', { noteId: note.id }).then((r) =>
                  showToast(r.message),
                )
              }
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 7,
                background: 'transparent',
                color: 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <ExportIcon size={14} />
            </button>
          )}

          {/* Insert Menu Popover */}
          {showInsertMenu && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 36,
                width: 176,
                padding: 6,
                borderRadius: 11,
                background: 'var(--bg-popover)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-popover)',
                zIndex: 45,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              {note.kind === 'normal' && (
                <button
                  type="button"
                  onClick={handleInsertTable}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 9px',
                    border: 'none',
                    borderRadius: 7,
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  <TableIcon size={14} />
                  <span>插入表格</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowInsertMenu(false);
                  if (note.kind === 'timeline') timelineFileRef.current?.click();
                  else imageInputRef.current?.click();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 9px',
                  border: 'none',
                  borderRadius: 7,
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                <ImageIcon size={14} />
                <span>插入图片</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowInsertMenu(false);
                  if (note.kind === 'timeline') timelineFileRef.current?.click();
                  else fileInputRef.current?.click();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 9px',
                  border: 'none',
                  borderRadius: 7,
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                <FileIcon size={14} />
                <span>插入文件附件</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowInsertMenu(false);
                  setReplacingLinkTargetId(null);
                  setLinkSearch('');
                  setShowLinkPicker(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 9px',
                  border: 'none',
                  borderRadius: 7,
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                <LinkIcon size={14} />
                <span>@ 关联待办 / 便签</span>
              </button>

              <div style={{ height: 1, background: 'var(--border)', margin: '3px 4px' }} />

              <button
                type="button"
                onClick={() => {
                  setShowInsertMenu(false);
                  const nextKind = note.kind === 'normal' ? 'timeline' : 'normal';
                  updateNote(note.id, { kind: nextKind });
                  showToast(nextKind === 'timeline' ? '已切换为时间轴便签' : '已切换为普通便签');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 9px',
                  border: 'none',
                  borderRadius: 7,
                  background: 'transparent',
                  color: 'var(--accent)',
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                {note.kind === 'normal' ? <TimelineIcon size={14} /> : <NoteIcon size={14} />}
                <span>{note.kind === 'normal' ? '切换为时间轴便签' : '切换为普通便签'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Formatting Toolbar (when 'A' is active in normal mode) */}
      {note.kind === 'normal' && showFormatBar && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexWrap: 'wrap',
            padding: '6px 14px',
            background: 'var(--bg-header)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          {(
            [
              ['h1', 'H1'],
              ['h2', 'H2'],
              ['h3', 'H3'],
              ['bold', 'B'],
              ['italic', 'I'],
              ['list', '• 列表'],
              ['quote', '❝ 引用'],
              ['code', '</> 代码'],
            ] as const
          ).map(([action, label]) => (
            <button
              key={action}
              type="button"
              onClick={() => applyFormatAction(action)}
              style={{
                padding: '3px 8px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontSize: 12,
                fontWeight: action === 'bold' || action.startsWith('h') ? 700 : 500,
                fontStyle: action === 'italic' ? 'italic' : 'normal',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Bidirectional '@' Content Links Strip */}
      {note.links.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '7px 18px',
            borderBottom: '1px dashed var(--border)',
            background: 'var(--bg-panel)',
            fontSize: 12.5,
            flexShrink: 0,
          }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>相关记录：</span>
          {note.links.map((link) => (
            <span
              key={`${link.targetType}-${link.targetId}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '1px 6px',
                borderRadius: 6,
                background: 'var(--accent-soft)',
              }}
            >
              <button
                type="button"
                onClick={() => openContentLink(link)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  color: 'var(--accent)',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {link.label}
              </button>
              <button
                type="button"
                title="替换关联对象"
                onClick={() => {
                  setReplacingLinkTargetId(link.targetId);
                  setLinkSearch('');
                  setShowLinkPicker(true);
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: '0 2px',
                  color: 'var(--text-muted)',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                ⇄
              </button>
              <button
                type="button"
                title="取消关联"
                onClick={() => removeContentLink('note', note.id, link.targetId)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: '0 2px',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* '@' Searchable Content Link Picker Overlay */}
      {showLinkPicker && (
        <div
          style={{
            position: 'absolute',
            top: standalone ? 92 : 52,
            left: 16,
            right: 16,
            maxWidth: 360,
            padding: 10,
            borderRadius: 12,
            background: 'var(--bg-popover)',
            border: '1px solid var(--accent-border)',
            boxShadow: 'var(--shadow-popover)',
            zIndex: 55,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 12.5 }}>
              {replacingLinkTargetId ? '替换 @ 关联内容' : '选择要 @ 关联的待办或便签'}
            </strong>
            <button
              type="button"
              onClick={() => {
                setShowLinkPicker(false);
                setReplacingLinkTargetId(null);
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 15,
              }}
            >
              ×
            </button>
          </div>
          <input
            autoFocus
            type="text"
            value={linkSearch}
            onChange={(e) => setLinkSearch(e.target.value)}
            placeholder="搜索待办或便签标题…"
            style={{
              padding: '6px 9px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              fontSize: 12.5,
              outline: 'none',
            }}
          />
          <div style={{ maxHeight: 190, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {linkCandidates.length === 0 ? (
              <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                没有匹配的待办或便签
              </div>
            ) : (
              linkCandidates.map((cand) => (
                <button
                  key={`${cand.targetType}-${cand.targetId}`}
                  type="button"
                  onClick={() => handleSelectLinkCandidate(cand)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '6px 8px',
                    borderRadius: 7,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    textAlign: 'left',
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      fontSize: 10.5,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: cand.targetType === 'note' ? 'var(--accent-soft)' : 'var(--tag-bg)',
                      color: cand.targetType === 'note' ? 'var(--accent-soft-text)' : 'var(--tag-text)',
                      flexShrink: 0,
                    }}
                  >
                    {cand.targetType === 'note' ? '便签' : '待办'}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cand.label}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODE A: NORMAL STRUCTURED RICH NOTE                               */}
      {/* ================================================================= */}
      {note.kind === 'normal' && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            position: 'relative',
            display: 'flex',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflowY: 'auto',
              padding: '16px 26px 40px 22px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {visibleBlocks.map(({ block, hidden }) => {
              if (hidden) return null;

              if (block.type === 'heading') {
                const isCollapsed = collapsedHeadings.has(block.id);
                const fontSize = block.level === 1 ? 19 : block.level === 2 ? 16 : 14.5;
                return (
                  <div
                    key={block.id}
                    ref={(el) => {
                      blockRefs.current[block.id] = el;
                    }}
                    className="dt-note-heading-row"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      marginLeft: -18,
                      marginTop: block.level === 1 ? 4 : 6,
                    }}
                  >
                    <button
                      type="button"
                      title={isCollapsed ? '展开此节内容' : '折叠此节内容'}
                      onClick={() => toggleHeadingCollapse(block.id)}
                      style={{
                        width: 18,
                        height: 22,
                        border: 'none',
                        background: 'transparent',
                        color: isCollapsed ? 'var(--accent)' : 'var(--text-muted)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        padding: 0,
                        flexShrink: 0,
                      }}
                    >
                      {isCollapsed ? <ChevronRightIcon size={13} /> : <ChevronDownIcon size={13} />}
                    </button>
                    <input
                      type="text"
                      value={block.text}
                      onFocus={() => {
                        setFocusedBlockId(block.id);
                        setActiveHeadingId(block.id);
                      }}
                      onChange={(e) => updateBlockText(block.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          insertBlockAfter(block.id, {
                            id: `blk_${Date.now().toString(36)}`,
                            type: 'paragraph',
                            text: '',
                          });
                        } else if (e.key === 'Backspace' && block.text === '') {
                          e.preventDefault();
                          removeBlock(block.id);
                        }
                      }}
                      placeholder={`标题 ${block.level}`}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        color: 'var(--text-primary)',
                        fontSize,
                        fontWeight: 700,
                        lineHeight: 1.4,
                        padding: 0,
                      }}
                    />
                    {isCollapsed && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: '0 6px',
                          borderRadius: 999,
                          background: 'var(--accent-soft)',
                          color: 'var(--accent-soft-text)',
                        }}
                      >
                        已折叠
                      </span>
                    )}
                  </div>
                );
              }

              if (block.type === 'table') {
                return (
                  <div
                    key={block.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      margin: '4px 0',
                    }}
                  >
                    <div style={{ overflowX: 'auto' }}>
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          border: '1px solid var(--border-strong)',
                          borderRadius: 6,
                          fontSize: 'calc(var(--font-body-size) - 1px)',
                        }}
                      >
                        <tbody>
                          {block.rows.map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              style={{
                                background: rIdx === 0 ? 'var(--bg-header)' : 'var(--bg-surface)',
                              }}
                            >
                              {row.map((cell, cIdx) => (
                                <td
                                  key={cIdx}
                                  style={{
                                    border: '1px solid var(--border)',
                                    padding: '5px 8px',
                                    fontWeight: rIdx === 0 ? 600 : 400,
                                  }}
                                >
                                  <input
                                    type="text"
                                    value={cell}
                                    onFocus={() => setFocusedBlockId(block.id)}
                                    onChange={(e) =>
                                      updateTableCell(block.id, rIdx, cIdx, e.target.value)
                                    }
                                    style={{
                                      width: '100%',
                                      minWidth: 48,
                                      border: 'none',
                                      outline: 'none',
                                      background: 'transparent',
                                      color: 'var(--text-primary)',
                                      fontWeight: rIdx === 0 ? 600 : 400,
                                      fontSize: 'inherit',
                                    }}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                      <button
                        type="button"
                        onClick={() => mutateTable(block.id, 'addRow')}
                        style={{
                          padding: '2px 7px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--bg-surface)',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                        }}
                      >
                        + 行
                      </button>
                      <button
                        type="button"
                        onClick={() => mutateTable(block.id, 'addCol')}
                        style={{
                          padding: '2px 7px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--bg-surface)',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                        }}
                      >
                        + 列
                      </button>
                      {block.rows.length > 2 && (
                        <button
                          type="button"
                          onClick={() => mutateTable(block.id, 'delRow')}
                          style={{
                            padding: '2px 7px',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            background: 'transparent',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          - 行
                        </button>
                      )}
                      {(block.rows[0]?.length ?? 0) > 2 && (
                        <button
                          type="button"
                          onClick={() => mutateTable(block.id, 'delCol')}
                          style={{
                            padding: '2px 7px',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            background: 'transparent',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          - 列
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeBlock(block.id)}
                        style={{
                          marginLeft: 'auto',
                          padding: '2px 7px',
                          borderRadius: 6,
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--danger)',
                          cursor: 'pointer',
                        }}
                      >
                        删除表格
                      </button>
                    </div>
                  </div>
                );
              }

              // Paragraph / list / quote / code block
              return (
                <div key={block.id}>
                  <AutoTextarea
                    value={block.text}
                    onFocus={() => setFocusedBlockId(block.id)}
                    onChange={(val) => updateBlockText(block.id, val)}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && block.text === '' && blocks.length > 1) {
                        e.preventDefault();
                        removeBlock(block.id);
                      } else if (
                        e.key === 'Enter' &&
                        (e.ctrlKey || e.metaKey)
                      ) {
                        e.preventDefault();
                        insertBlockAfter(block.id, {
                          id: `blk_${Date.now().toString(36)}`,
                          type: 'paragraph',
                          text: '',
                        });
                      }
                    }}
                    placeholder="输入正文，输入 # 创建标题，输入 @ 关联待办或便签…"
                    style={{
                      color: 'var(--text-primary)',
                      fontSize: 'var(--font-body-size)',
                      lineHeight: 1.7,
                    }}
                  />
                </div>
              );
            })}

            {/* Add new paragraph click-zone */}
            <button
              type="button"
              onClick={() =>
                insertBlockAfter(blocks[blocks.length - 1]?.id ?? null, {
                  id: `blk_${Date.now().toString(36)}`,
                  type: 'paragraph',
                  text: '',
                })
              }
              style={{
                alignSelf: 'flex-start',
                padding: '3px 8px',
                borderRadius: 6,
                border: '1px dashed var(--border)',
                background: 'transparent',
                color: 'var(--text-muted)',
                fontSize: 11.5,
                cursor: 'pointer',
                marginTop: 4,
              }}
            >
              + 新段落
            </button>

            {/* File & Audio Attachment Chips */}
            {noteOtherAttachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {noteOtherAttachments.map((att) => (
                  <AttachmentMedia
                    key={att.id}
                    att={att}
                    onRemove={() => handleRemoveNoteAttachment(att.id)}
                  />
                ))}
              </div>
            )}

            {/* Inline Images */}
            {noteImages.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
                {noteImages.map((img) => (
                  <AttachmentMedia
                    key={img.id}
                    att={img}
                    onRemove={() => handleRemoveNoteAttachment(img.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Floating Right-Side Document Outline */}
          {showOutline && headings.length > 0 && (
            <div
              onMouseEnter={() => setOutlineHover(true)}
              onMouseLeave={() => setOutlineHover(false)}
              style={{
                position: 'absolute',
                top: 18,
                right: 10,
                zIndex: 20,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
              }}
            >
              {/* Minimal outline indicator bars */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: 6,
                  padding: '6px 4px',
                  cursor: 'pointer',
                }}
              >
                {headings.map((h, i) => {
                  const active = (activeHeadingId ?? headings[0]?.id) === h.id;
                  const width = h.level === 1 ? 18 : h.level === 2 ? 13 : 9;
                  return (
                    <button
                      key={`${h.id}-${i}`}
                      type="button"
                      title={h.text}
                      onClick={() => scrollToHeading(h.id)}
                      style={{
                        width,
                        height: 3,
                        borderRadius: 999,
                        border: 'none',
                        padding: 0,
                        background: active ? 'var(--accent)' : 'var(--border-strong)',
                        cursor: 'pointer',
                        transition: 'background 140ms ease, width 140ms ease',
                      }}
                    />
                  );
                })}
              </div>

              {/* Expanded Outline Popover on Hover */}
              {outlineHover && (
                <div
                  style={{
                    marginTop: 4,
                    width: 176,
                    maxHeight: 260,
                    overflowY: 'auto',
                    padding: 8,
                    borderRadius: 10,
                    background: 'var(--bg-popover)',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-popover)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '0 4px 4px' }}>
                    文档大纲
                  </div>
                  {headings.map((h) => {
                    const active = (activeHeadingId ?? headings[0]?.id) === h.id;
                    return (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => scrollToHeading(h.id)}
                        style={{
                          textAlign: 'left',
                          padding: `4px 6px 4px ${(h.level - 1) * 10 + 6}px`,
                          borderRadius: 6,
                          border: 'none',
                          background: active ? 'var(--accent-soft)' : 'transparent',
                          color: active ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
                          fontWeight: active ? 600 : 400,
                          fontSize: 12,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                        }}
                      >
                        {h.text || '未命名标题'}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* MODE B: TIMELINE NOTE (时间轴便签)                                 */}
      {/* ================================================================= */}
      {note.kind === 'timeline' && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Quick Composer */}
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              flexShrink: 0,
            }}
          >
            <textarea
              rows={2}
              value={timelineDraft}
              onChange={(e) => setTimelineDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleAddTimelineEntry();
                }
              }}
              placeholder="随手记一条进展、灵感或会议要点… (Ctrl+Enter 记录)"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '7px 10px',
                borderRadius: 9,
                border: '1px solid var(--border)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 'var(--font-body-size)',
                fontFamily: 'inherit',
                resize: 'vertical',
                outline: 'none',
              }}
            />

            {timelineAttachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {timelineAttachments.map((att) => (
                  <AttachmentMedia
                    key={att.id}
                    att={att}
                    onRemove={() =>
                      setTimelineAttachments((prev) => prev.filter((a) => a.id !== att.id))
                    }
                  />
                ))}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  onClick={() => timelineFileRef.current?.click()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    borderRadius: 7,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-panel)',
                    color: 'var(--text-secondary)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  <ImageIcon size={13} />
                  <span>图片 / 文件 / 音频</span>
                </button>
              </div>
              <button
                type="button"
                onClick={handleAddTimelineEntry}
                disabled={!timelineDraft.trim() && timelineAttachments.length === 0}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--accent)',
                  color: 'var(--accent-text)',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: !timelineDraft.trim() && timelineAttachments.length === 0 ? 0.5 : 1,
                }}
              >
                <SendIcon size={13} />
                <span>记录</span>
              </button>
            </div>
          </div>

          {/* Chronological Timeline Stream */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '14px 16px 36px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {note.timelineEntries.length === 0 ? (
              <div
                style={{
                  padding: '36px 16px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 13,
                }}
              >
                还没有时间轴记录，在上方写下第一条吧。
              </div>
            ) : (
              note.timelineEntries.map((entry) => {
                const linkedTodo = entry.linkedTodoId
                  ? activeTodos.find((t) => t.id === entry.linkedTodoId) ?? null
                  : null;
                const isEditing = editingEntryId === entry.id;

                return (
                  <div
                    key={entry.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      position: 'relative',
                    }}
                  >
                    {/* Left timeline dot + line */}
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        paddingTop: 5,
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: 'var(--accent)',
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          width: 1.5,
                          background: 'var(--border)',
                          marginTop: 4,
                        }}
                      />
                    </div>

                    {/* Entry Card */}
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '9px 12px',
                        borderRadius: 10,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11.5,
                            color: 'var(--text-muted)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {formatTimestampYMDHM(entry.createdAt)}
                        </span>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {linkedTodo ? (
                            <button
                              type="button"
                              onClick={() => setEditingTodoId(linkedTodo.id)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '2px 8px',
                                borderRadius: 999,
                                border: '1px solid var(--accent-border)',
                                background: 'var(--accent-soft)',
                                color: 'var(--accent-soft-text)',
                                fontSize: 11,
                                cursor: 'pointer',
                              }}
                            >
                              <CheckIcon size={10} />
                              <span>已关联待办</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => convertTimelineEntryToTodo(note.id, entry.id)}
                              style={{
                                padding: '2px 8px',
                                borderRadius: 999,
                                border: '1px solid var(--border)',
                                background: 'var(--bg-surface)',
                                color: 'var(--text-secondary)',
                                fontSize: 11,
                                cursor: 'pointer',
                              }}
                            >
                              转为待办
                            </button>
                          )}

                          <button
                            type="button"
                            title="编辑记录"
                            onClick={() => {
                              setEditingEntryId(entry.id);
                              setEditingEntryText(entry.content);
                            }}
                            style={{
                              width: 22,
                              height: 22,
                              border: 'none',
                              borderRadius: 5,
                              background: 'transparent',
                              color: 'var(--text-muted)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                            }}
                          >
                            <EditIcon size={12} />
                          </button>
                          <button
                            type="button"
                            title="删除记录"
                            onClick={() => deleteTimelineEntry(note.id, entry.id)}
                            style={{
                              width: 22,
                              height: 22,
                              border: 'none',
                              borderRadius: 5,
                              background: 'transparent',
                              color: 'var(--text-muted)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                            }}
                          >
                            <TrashIcon size={12} />
                          </button>
                        </div>
                      </div>

                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <textarea
                            rows={2}
                            autoFocus
                            value={editingEntryText}
                            onChange={(e) => setEditingEntryText(e.target.value)}
                            style={{
                              width: '100%',
                              boxSizing: 'border-box',
                              padding: '6px 8px',
                              borderRadius: 7,
                              border: '1px solid var(--accent-border)',
                              background: 'var(--bg-input)',
                              color: 'var(--text-primary)',
                              fontSize: 'var(--font-body-size)',
                              fontFamily: 'inherit',
                            }}
                          />
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              onClick={() => setEditingEntryId(null)}
                              style={{
                                padding: '3px 9px',
                                borderRadius: 6,
                                border: '1px solid var(--border)',
                                background: 'transparent',
                                color: 'var(--text-secondary)',
                                fontSize: 12,
                                cursor: 'pointer',
                              }}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveEntryEdit(entry)}
                              style={{
                                padding: '3px 9px',
                                borderRadius: 6,
                                border: 'none',
                                background: 'var(--accent)',
                                color: 'var(--accent-text)',
                                fontSize: 12,
                                cursor: 'pointer',
                              }}
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            fontSize: 'var(--font-body-size)',
                            lineHeight: 1.65,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {entry.content}
                        </div>
                      )}

                      {entry.attachments.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                          {entry.attachments.map((att) => (
                            <AttachmentMedia key={att.id} att={att} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Bottom-right live character counter */}
      <div
        style={{
          position: 'absolute',
          right: 14,
          bottom: 8,
          fontSize: 11.5,
          color: 'var(--text-muted)',
          background: 'var(--bg-panel)',
          padding: '2px 6px',
          borderRadius: 6,
          pointerEvents: 'none',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {note.kind === 'timeline'
          ? `${note.timelineEntries.length} 条 · ${totalCharCount} 字`
          : `${totalCharCount} 字`}
      </div>
    </div>
  );
};

export default NoteView;
