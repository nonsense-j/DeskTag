import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowLeftRightIcon,
  AudioLinesIcon,
  BoldIcon,
  CheckIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CodeIcon,
  Columns3Icon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FileTextIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ItalicIcon,
  Link2Icon,
  ListIcon,
  ListTreeIcon,
  LockIcon,
  MinusIcon,
  PaperclipIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  QuoteIcon,
  Rows3Icon,
  SearchIcon,
  SendIcon,
  StickyNoteIcon,
  TableIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  isTauriRuntime,
  openAttachment,
  openNoteWindow,
  readAttachmentDataUrl,
  saveAttachment,
} from '../api/tauri';
import { cn } from '../lib/utils';
import { useDeskTagStore } from '../store/useDeskTagStore';
import type {
  AttachmentKind,
  AttachmentRef,
  ContentLink,
  TimelineEntry,
} from '../types/models';
import { exportDeskTagDocument } from '../utils/exporter';
import { formatTimeHMS, formatTimestampYMDHM, pad2 } from '../utils/lunar';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Card,
  CardDescription,
  CardFrame,
  CardFrameAction,
  CardFrameHeader,
  CardFrameTitle,
  CardHeader,
  CardPanel,
  CardTitle,
} from './ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './ui/empty';
import { Frame, FramePanel } from './ui/frame';
import { Input } from './ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group';
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from './ui/menu';
import {
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverTitle,
} from './ui/popover';
import { ScrollArea } from './ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { Textarea } from './ui/textarea';
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from './ui/toolbar';
import { Tooltip, TooltipPopup, TooltipTrigger } from './ui/tooltip';

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
        const sanitizeCell = (c: string) =>
          c.replace(/\r?\n+/g, ' ').replace(/\|/g, '｜');
        const header = `| ${blk.rows[0].map(sanitizeCell).join(' | ')} |`;
        const sep = `| ${new Array<string>(colCount).fill('---').join(' | ')} |`;
        const body = blk.rows
          .slice(1)
          .map((r) => `| ${r.map(sanitizeCell).join(' | ')} |`);
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

function formatTimeHM(date: Date = new Date()): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
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

function computeTableColumnWidths(rows: string[][]): number[] {
  const colCount = rows[0]?.length ?? 0;
  if (colCount === 0) return [];
  const weights = new Array<number>(colCount).fill(6);
  for (let c = 0; c < colCount; c += 1) {
    let maxLen = 0;
    for (const row of rows) {
      const len = (row[c] ?? '').trim().length;
      if (len > maxLen) maxLen = len;
    }
    weights[c] = 6 + Math.min(22, Math.max(3, maxLen));
  }
  const total = weights.reduce((sum, w) => sum + w, 0) || 1;
  return weights.map((w) => Math.round((w / total) * 1000) / 10);
}

// ---------------------------------------------------------------------------
// Safe Inline & Paragraph Markdown Renderer (for crisp non-editing view)
// ---------------------------------------------------------------------------

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null = pattern.exec(text);
  let key = 0;

  while (match !== null) {
    if (match.index > lastIdx) {
      nodes.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={`c-${key++}`}
          className="mx-0.5 inline-block rounded border border-border bg-muted px-1.5 py-px align-baseline font-mono text-[0.84em] leading-[1.4] text-foreground"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={`b-${key++}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={`i-${key++}`} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      nodes.push(token);
    }
    lastIdx = match.index + token.length;
    match = pattern.exec(text);
  }

  if (lastIdx < text.length) {
    nodes.push(text.slice(lastIdx));
  }
  return nodes;
}

type ParsedSegment =
  | { kind: 'code'; content: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: Array<{ num: string; text: string }> }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'text'; lines: string[] };

function parseParagraphSegments(text: string): ParsedSegment[] {
  const lines = text.split('\n');
  const segments: ParsedSegment[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^\s*```/.test(line)) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      segments.push({ kind: 'code', content: codeLines.join('\n') });
      continue;
    }

    // Bullet list
    const ulMatch = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (ulMatch) {
      const items: string[] = [ulMatch[1]];
      i += 1;
      while (i < lines.length) {
        const nextUl = /^\s*[-*•]\s+(.*)$/.exec(lines[i]);
        if (!nextUl) break;
        items.push(nextUl[1]);
        i += 1;
      }
      segments.push({ kind: 'ul', items });
      continue;
    }

    // Ordered list
    const olMatch = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (olMatch) {
      const items: Array<{ num: string; text: string }> = [
        { num: olMatch[1], text: olMatch[2] },
      ];
      i += 1;
      while (i < lines.length) {
        const nextOl = /^\s*(\d+)\.\s+(.*)$/.exec(lines[i]);
        if (!nextOl) break;
        items.push({ num: nextOl[1], text: nextOl[2] });
        i += 1;
      }
      segments.push({ kind: 'ol', items });
      continue;
    }

    // Blockquote
    const quoteMatch = /^\s*>\s?(.*)$/.exec(line);
    if (quoteMatch) {
      const qLines: string[] = [quoteMatch[1]];
      i += 1;
      while (i < lines.length) {
        const nextQ = /^\s*>\s?(.*)$/.exec(lines[i]);
        if (!nextQ) break;
        qLines.push(nextQ[1]);
        i += 1;
      }
      segments.push({ kind: 'quote', lines: qLines });
      continue;
    }

    // Plain text lines
    const textLines: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i])
    ) {
      textLines.push(lines[i]);
      i += 1;
    }
    segments.push({ kind: 'text', lines: textLines });
  }

  return segments;
}

const RichParagraphDisplay: React.FC<{
  text: string;
  onActivate: () => void;
}> = ({ text, onActivate }) => {
  const segments = useMemo(() => parseParagraphSegments(text), [text]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
      className="group -mx-1.5 cursor-text rounded-md px-1.5 py-0.5 text-[length:var(--font-body-size)] leading-[1.7] text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-col gap-1.5">
        {segments.map((seg, idx) => {
          if (seg.kind === 'code') {
            return (
              <pre
                key={idx}
                className="overflow-x-auto rounded-lg border bg-coss-frame-well px-3 py-2 font-mono text-xs leading-relaxed text-foreground"
              >
                <code>{seg.content}</code>
              </pre>
            );
          }
          if (seg.kind === 'ul') {
            return (
              <ul key={idx} className="flex flex-col gap-1.5 pl-0.5">
                {seg.items.map((item, liIdx) => (
                  <li key={liIdx} className="flex items-start gap-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-[0.62em] size-1.5 shrink-0 rounded-full bg-muted-foreground/55"
                    />
                    <span className="min-w-0 flex-1 break-words">
                      {renderInlineMarkdown(item)}
                    </span>
                  </li>
                ))}
              </ul>
            );
          }
          if (seg.kind === 'ol') {
            return (
              <ol key={idx} className="flex flex-col gap-1.5 pl-0.5">
                {seg.items.map((item, liIdx) => (
                  <li key={liIdx} className="flex items-start gap-2">
                    <span className="min-w-4 shrink-0 text-right font-medium text-muted-foreground text-xs leading-[1.9] tabular-nums">
                      {item.num}.
                    </span>
                    <span className="min-w-0 flex-1 break-words">
                      {renderInlineMarkdown(item.text)}
                    </span>
                  </li>
                ))}
              </ol>
            );
          }
          if (seg.kind === 'quote') {
            return (
              <blockquote
                key={idx}
                className="border-dt-accent/50 border-l-2 py-0.5 pl-3 text-muted-foreground"
              >
                {seg.lines.map((qLine, qIdx) => (
                  <p key={qIdx} className="break-words">
                    {renderInlineMarkdown(qLine)}
                  </p>
                ))}
              </blockquote>
            );
          }
          return (
            <div key={idx} className="flex flex-col gap-0.5">
              {seg.lines.map((tLine, tIdx) => (
                <p key={tIdx} className="break-words whitespace-pre-wrap">
                  {renderInlineMarkdown(tLine)}
                </p>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Lazy Inline Attachment Preview (Image / Audio / File)
// ---------------------------------------------------------------------------

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
      <div className="group/img relative inline-block max-w-full overflow-hidden rounded-xl border bg-card shadow-xs/5">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={att.name}
            onClick={() => void openAttachment(att.relativePath)}
            className="block max-h-60 max-w-full cursor-pointer object-contain"
          />
        ) : (
          <div className="px-4 py-3 text-muted-foreground text-xs">
            加载图片：{att.name}…
          </div>
        )}
        {onRemove && (
          <Button
            aria-label="移除图片"
            title="移除图片"
            size="icon-xs"
            variant="outline"
            onClick={onRemove}
            className="absolute top-1.5 right-1.5 size-6 rounded-full bg-background/90 backdrop-blur-xs"
          >
            <XIcon className="size-3" aria-hidden="true" />
          </Button>
        )}
      </div>
    );
  }

  if (att.kind === 'audio') {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-2.5 py-1.5 shadow-xs/5">
        <AudioLinesIcon
          className="size-4 shrink-0 text-dt-accent"
          aria-hidden="true"
        />
        <span className="max-w-44 truncate text-foreground text-xs font-medium">
          {att.name}
        </span>
        {dataUrl ? (
          <audio controls src={dataUrl} className="h-7 max-w-52" />
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {formatFileSize(att.size)}
          </span>
        )}
        {onRemove && (
          <Button
            aria-label="移除音频"
            title="移除音频"
            size="icon-xs"
            variant="ghost"
            onClick={onRemove}
            className="ms-auto text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1 text-xs shadow-2xs">
      <FileTextIcon
        className="size-3.5 shrink-0 text-dt-accent"
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={() => void openAttachment(att.relativePath)}
        className="max-w-48 cursor-pointer truncate border-none bg-transparent p-0 font-medium text-foreground hover:underline underline-offset-2"
      >
        {att.name}
      </button>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {formatFileSize(att.size)}
      </span>
      {onRemove && (
        <button
          type="button"
          aria-label="移除附件"
          title="移除附件"
          onClick={onRemove}
          className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <XIcon className="size-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Auto-growing Textareas (for paragraphs & wrapping table cells)
// ---------------------------------------------------------------------------

const AutoTextarea: React.FC<{
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}> = ({
  value,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  placeholder,
  autoFocus = false,
  className,
}) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const syncHeight = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(24, el.scrollHeight)}px`;
  }, []);

  useLayoutEffect(() => {
    syncHeight();
  }, [value, syncHeight]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(syncHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncHeight]);

  useEffect(() => {
    if (autoFocus && ref.current) {
      const el = ref.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [autoFocus]);

  return (
    <textarea
      ref={ref}
      rows={1}
      cols={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={placeholder}
      className={cn(
        'block w-full min-w-0 resize-none overflow-hidden border-none bg-transparent py-0.5 font-[inherit] text-[length:var(--font-body-size)] leading-[1.7] text-foreground outline-none placeholder:text-muted-foreground/60',
        className,
      )}
    />
  );
};

const CellAutoTextarea: React.FC<{
  value: string;
  onChange: (next: string) => void;
  onFocus?: () => void;
  placeholder?: string;
  className?: string;
}> = ({ value, onChange, onFocus, placeholder, className }) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const syncHeight = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(20, el.scrollHeight)}px`;
  }, []);

  useLayoutEffect(() => {
    syncHeight();
  }, [value, syncHeight]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(syncHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncHeight]);

  return (
    <textarea
      ref={ref}
      rows={1}
      cols={1}
      value={value}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value.replace(/\r?\n/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      className={cn(
        'block w-full min-w-0 resize-none overflow-hidden whitespace-pre-wrap break-words border-none bg-transparent p-0 font-[inherit] text-xs leading-[1.55] outline-none placeholder:text-muted-foreground/45',
        className,
      )}
    />
  );
};

// ---------------------------------------------------------------------------
// Main NoteView Component
// ---------------------------------------------------------------------------

export const NoteView: React.FC<NoteViewProps> = ({ noteId, standalone = false }) => {
  const {
    data,
    platform,
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
  const [showOutline, setShowOutline] = useState(true);
  const [outlineHover, setOutlineHover] = useState(false);
  const [standalonePinned, setStandalonePinned] = useState(false);

  // Anchor element for '@' link picker Popover
  const [headerEl, setHeaderEl] = useState<HTMLDivElement | null>(null);

  // Structured block state for normal note
  const [blocks, setBlocks] = useState<NoteBlock[]>(() =>
    parseContentToBlocks(note?.content ?? ''),
  );
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const lastActiveBlockIdRef = useRef<string | null>(null);
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
      setFocusedBlockId(null);
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

  const markBlockFocused = (blockId: string) => {
    setFocusedBlockId(blockId);
    lastActiveBlockIdRef.current = blockId;
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
    markBlockFocused(newBlock.id);
  };

  const removeBlock = (blockId: string) => {
    if (blocks.length <= 1) {
      commitBlocks([{ id: blockId, type: 'paragraph', text: '' }]);
      return;
    }
    commitBlocks(blocks.filter((b) => b.id !== blockId));
    if (focusedBlockId === blockId) {
      setFocusedBlockId(null);
    }
  };

  const applyFormatAction = (
    kind: 'h1' | 'h2' | 'h3' | 'bold' | 'italic' | 'list' | 'quote' | 'code',
  ) => {
    const targetId =
      focusedBlockId ?? lastActiveBlockIdRef.current ?? blocks[blocks.length - 1]?.id;
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
    markBlockFocused(targetId);
  };

  const handleInsertTable = () => {
    const tbl: NoteBlock = {
      id: `blk_${Date.now().toString(36)}`,
      type: 'table',
      rows: [
        ['事项', '负责人', '状态'],
        ['待补充', '', '进行中'],
      ],
    };
    insertBlockAfter(focusedBlockId ?? lastActiveBlockIdRef.current, tbl);
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
  const handleFileUpload = async (
    files: FileList | null,
    forcedKind?: AttachmentKind,
    forTimeline = false,
  ) => {
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

  const isWindowsStandalone = standalone && platform.platform === 'windows';
  const shellClassName = cn(
    'dt-note-view relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground',
    standalone && !isWindowsStandalone && 'rounded-xl border',
  );

  const renderStandaloneTitlebar = (titleText: string, kind: 'normal' | 'timeline' = 'normal') => (
    <header
      data-tauri-drag-region
      className="flex h-9.5 shrink-0 select-none items-center justify-between border-b bg-sidebar pr-2 pl-3.5"
    >
      <div
        data-tauri-drag-region
        className="flex min-w-0 items-center gap-2 font-semibold text-foreground text-xs"
      >
        {kind === 'timeline' ? (
          <ClockIcon className="size-3.5 shrink-0 text-dt-accent" aria-hidden="true" />
        ) : (
          <StickyNoteIcon className="size-3.5 shrink-0 text-dt-accent" aria-hidden="true" />
        )}
        <span data-tauri-drag-region className="truncate">
          {titleText}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={standalonePinned ? '取消置顶' : '窗口置顶'}
                size="icon-xs"
                variant="ghost"
                onClick={() => void handleToggleStandalonePin()}
                className={cn(
                  standalonePinned && 'bg-dt-accent-soft text-dt-accent-soft-text',
                )}
              />
            }
          >
            <PinIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup>{standalonePinned ? '取消置顶' : '窗口置顶'}</TooltipPopup>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="最小化"
                size="icon-xs"
                variant="ghost"
                onClick={() => void handleStandaloneMinimize()}
              />
            }
          >
            <MinusIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup>最小化</TooltipPopup>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="关闭窗口"
                size="icon-xs"
                variant="ghost"
                onClick={() => void handleStandaloneClose()}
              />
            }
          >
            <XIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup>关闭窗口</TooltipPopup>
        </Tooltip>
      </div>
    </header>
  );

  // Missing note state
  if (!note) {
    return (
      <div className={shellClassName}>
        {standalone && renderStandaloneTitlebar('独立便签')}
        <Empty className="py-12">
          <EmptyMedia variant="icon">
            <StickyNoteIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle className="text-base">未找到该便签</EmptyTitle>
            <EmptyDescription>该便签可能已被删除或尚未同步。</EmptyDescription>
          </EmptyHeader>
          {standalone && (
            <EmptyContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleStandaloneClose()}
              >
                关闭窗口
              </Button>
            </EmptyContent>
          )}
        </Empty>
      </div>
    );
  }

  // Privacy-lock unlock gate
  if (isGroupLocked && noteGroup) {
    return (
      <div className={shellClassName}>
        {standalone && renderStandaloneTitlebar(note.title || '独立便签', note.kind)}
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="w-full max-w-xs rounded-2xl">
            <CardHeader className="items-center text-center">
              <div className="mb-1 flex size-10 items-center justify-center rounded-xl border bg-coss-frame-well text-dt-accent">
                <LockIcon className="size-4.5" aria-hidden="true" />
              </div>
              <CardTitle className="text-sm">
                分组「{noteGroup.name}」已启用隐私锁
              </CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                输入 4–6 位数字密码后即可查看和编辑「{note.title || '未命名便签'}」
              </CardDescription>
            </CardHeader>
            <CardPanel className="flex flex-col gap-3">
              <form
                onSubmit={(e) => void handleUnlockGroup(e)}
                className="flex items-center gap-2"
              >
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError(null);
                  }}
                  placeholder="输入分组 PIN"
                  className="flex-1 text-center [&_[data-slot=input]]:text-center [&_[data-slot=input]]:tracking-[0.22em]"
                />
                <Button type="submit" size="default">
                  解锁
                </Button>
              </form>
              {pinError && (
                <Alert variant="error" className="py-2">
                  <AlertCircleIcon className="size-4" aria-hidden="true" />
                  <AlertDescription className="text-destructive-foreground">
                    {pinError}
                  </AlertDescription>
                </Alert>
              )}
            </CardPanel>
          </Card>
        </div>
      </div>
    );
  }

  const updatedDate = new Date(note.updatedAt || Date.now());
  const savedShortClock = formatTimeHM(updatedDate);
  const savedExactClock = formatTimeHMS(updatedDate);
  const totalCharCount =
    note.kind === 'normal'
      ? countVisibleChars(note.content)
      : note.timelineEntries.reduce((sum, e) => sum + countVisibleChars(e.content), 0);

  const noteImages = note.attachments.filter((a) => a.kind === 'image');
  const noteOtherAttachments = note.attachments.filter((a) => a.kind !== 'image');

  return (
    <div className={shellClassName}>
      {/* Hidden file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFileUpload(e.target.files, 'image', false);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFileUpload(e.target.files, undefined, false);
          e.target.value = '';
        }}
      />
      <input
        ref={timelineFileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFileUpload(e.target.files, undefined, true);
          e.target.value = '';
        }}
      />

      {/* Standalone Window Titlebar */}
      {standalone && renderStandaloneTitlebar(note.title || '独立便签', note.kind)}

      {/* Note Toolbar Header */}
      <div
        ref={setHeaderEl}
        className="relative flex shrink-0 items-center justify-between gap-2 border-b bg-background px-3.5 py-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {navHistory.length > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={navigateBack}
                    className="shrink-0 gap-1"
                  />
                }
              >
                <ArrowLeftIcon className="size-3" aria-hidden="true" />
                <span>返回</span>
              </TooltipTrigger>
              <TooltipPopup>
                返回 {navHistory[navHistory.length - 1]?.label ?? ''}
              </TooltipPopup>
            </Tooltip>
          )}

          <input
            type="text"
            value={note.title}
            onChange={(e) => updateNote(note.id, { title: e.target.value })}
            placeholder="未命名便签"
            aria-label="便签标题"
            className="field-sizing-content min-w-14 max-w-[calc(100%-78px)] truncate border-none bg-transparent p-0 font-bold text-[15px] leading-tight text-foreground outline-none placeholder:text-muted-foreground/55"
          />

          <span
            title={`最后保存于 ${savedExactClock}`}
            className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
          >
            已保存 {savedShortClock}
          </span>
        </div>

        {/* Right coss Toolbar */}
        <Toolbar className="shrink-0 gap-0.5 rounded-lg p-0.5 shadow-2xs">
          <ToolbarGroup className="gap-0.5">
            {note.kind === 'normal' && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToolbarButton
                      aria-label="文本格式工具栏"
                      aria-pressed={showFormatBar}
                      render={
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => setShowFormatBar((v) => !v)}
                          className={cn(
                            'font-serif font-semibold text-[13px]',
                            showFormatBar
                              ? 'bg-accent text-foreground'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        />
                      }
                    />
                  }
                >
                  A
                </TooltipTrigger>
                <TooltipPopup>文本格式工具栏</TooltipPopup>
              </Tooltip>
            )}

            <Menu>
              <MenuTrigger
                render={
                  <ToolbarButton
                    aria-label="插入内容或切换模式"
                    render={
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title="插入内容 / 切换模式"
                        className="text-muted-foreground hover:text-foreground"
                      />
                    }
                  />
                }
              >
                <PlusIcon aria-hidden="true" />
              </MenuTrigger>
              <MenuPopup align="end" sideOffset={6} className="min-w-44">
                <MenuGroup>
                  {note.kind === 'normal' && (
                    <MenuItem onClick={handleInsertTable}>
                      <TableIcon aria-hidden="true" />
                      <span>插入表格</span>
                    </MenuItem>
                  )}
                  <MenuItem
                    onClick={() => {
                      if (note.kind === 'timeline') timelineFileRef.current?.click();
                      else imageInputRef.current?.click();
                    }}
                  >
                    <ImageIcon aria-hidden="true" />
                    <span>插入图片</span>
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      if (note.kind === 'timeline') timelineFileRef.current?.click();
                      else fileInputRef.current?.click();
                    }}
                  >
                    <PaperclipIcon aria-hidden="true" />
                    <span>插入文件附件</span>
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setReplacingLinkTargetId(null);
                      setLinkSearch('');
                      setShowLinkPicker(true);
                    }}
                  >
                    <Link2Icon aria-hidden="true" />
                    <span>@ 关联待办 / 便签</span>
                  </MenuItem>
                </MenuGroup>
                <MenuSeparator />
                <MenuItem
                  onClick={() => {
                    const nextKind = note.kind === 'normal' ? 'timeline' : 'normal';
                    updateNote(note.id, { kind: nextKind });
                    showToast(
                      nextKind === 'timeline' ? '已切换为时间轴便签' : '已切换为普通便签',
                    );
                  }}
                >
                  {note.kind === 'normal' ? (
                    <ClockIcon aria-hidden="true" />
                  ) : (
                    <StickyNoteIcon aria-hidden="true" />
                  )}
                  <span>
                    {note.kind === 'normal' ? '切换为时间轴便签' : '切换为普通便签'}
                  </span>
                </MenuItem>
              </MenuPopup>
            </Menu>

            {note.kind === 'normal' && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToolbarButton
                      aria-label={showOutline ? '隐藏右侧文档大纲' : '显示右侧文档大纲'}
                      aria-pressed={showOutline}
                      render={
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => setShowOutline((v) => !v)}
                          className={cn(
                            showOutline
                              ? 'bg-accent text-foreground'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        />
                      }
                    />
                  }
                >
                  <ListTreeIcon aria-hidden="true" />
                </TooltipTrigger>
                <TooltipPopup>
                  {showOutline ? '隐藏右侧文档大纲' : '显示右侧文档大纲'}
                </TooltipPopup>
              </Tooltip>
            )}
          </ToolbarGroup>

          <ToolbarSeparator orientation="vertical" className="mx-0.5 my-1" />

          <ToolbarGroup className="gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToolbarButton
                    aria-label={
                      note.pinnedToSide ? '取消固定到侧边页签' : '固定到侧边页签'
                    }
                    aria-pressed={note.pinnedToSide}
                    render={
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => {
                          toggleNotePin(note.id);
                          showToast(
                            note.pinnedToSide ? '已取消固定到侧边页签' : '已固定到侧边页签',
                          );
                        }}
                        className={cn(
                          note.pinnedToSide
                            ? 'bg-dt-accent-soft text-dt-accent-soft-text'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      />
                    }
                  />
                }
              >
                <PinIcon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipPopup>
                {note.pinnedToSide ? '取消固定到侧边页签' : '固定到侧边页签'}
              </TooltipPopup>
            </Tooltip>

            {!standalone ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToolbarButton
                      aria-label="独立窗口打开"
                      render={
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => {
                            void openNoteWindow(note.id).catch((err) => {
                              showToast(
                                `打开独立便签失败：${err instanceof Error ? err.message : String(err)}`,
                              );
                            });
                          }}
                          className="text-muted-foreground hover:text-foreground"
                        />
                      }
                    />
                  }
                >
                  <ExternalLinkIcon aria-hidden="true" />
                </TooltipTrigger>
                <TooltipPopup>独立窗口打开</TooltipPopup>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToolbarButton
                      aria-label="导出当前便签 (Markdown)"
                      render={
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() =>
                            void exportDeskTagDocument(data, 'markdown', { noteId: note.id })
                              .then((r) => showToast(r.message))
                              .catch((err) => {
                                showToast(
                                  `导出失败：${err instanceof Error ? err.message : String(err)}`,
                                );
                              })
                          }
                          className="text-muted-foreground hover:text-foreground"
                        />
                      }
                    />
                  }
                >
                  <DownloadIcon aria-hidden="true" />
                </TooltipTrigger>
                <TooltipPopup>导出当前便签 (Markdown)</TooltipPopup>
              </Tooltip>
            )}
          </ToolbarGroup>
        </Toolbar>
      </div>

      {/* Formatting Toolbar (when 'A' is active in normal mode) */}
      {note.kind === 'normal' && showFormatBar && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-coss-frame-well px-3.5 py-1.5">
          {(
            [
              ['h1', 'H1', Heading1Icon],
              ['h2', 'H2', Heading2Icon],
              ['h3', 'H3', Heading3Icon],
              ['bold', '加粗', BoldIcon],
              ['italic', '斜体', ItalicIcon],
              ['list', '列表', ListIcon],
              ['quote', '引用', QuoteIcon],
              ['code', '代码', CodeIcon],
            ] as const
          ).map(([action, label, IconComp]) => (
            <Button
              key={action}
              size="xs"
              variant="outline"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyFormatAction(action)}
              className="gap-1 text-foreground"
            >
              <IconComp className="size-3" aria-hidden="true" />
              <span>{label}</span>
            </Button>
          ))}
        </div>
      )}

      {/* Bidirectional '@' Content Links Strip */}
      {note.links.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-background px-3.5 py-2">
          <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
            <Link2Icon className="size-3.5 opacity-75" aria-hidden="true" />
            <span>关联</span>
          </span>
          {note.links.map((link) => (
            <Badge
              key={`${link.targetType}-${link.targetId}`}
              variant="outline"
              className="group/chip h-6 max-w-full gap-1 rounded-md bg-card px-2 font-normal text-foreground shadow-2xs transition-colors hover:border-ring/50"
            >
              {link.targetType === 'todo' ? (
                <CheckSquareIcon
                  className="size-3 shrink-0 text-info"
                  aria-hidden="true"
                />
              ) : (
                <StickyNoteIcon
                  className="size-3 shrink-0 text-warning"
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                onClick={() => openContentLink(link)}
                className="max-w-56 cursor-pointer truncate border-none bg-transparent p-0 text-left font-medium text-xs text-foreground hover:underline underline-offset-2"
              >
                {link.label}
              </button>
              <button
                type="button"
                aria-label="替换关联对象"
                title="替换关联对象"
                onClick={() => {
                  setReplacingLinkTargetId(link.targetId);
                  setLinkSearch('');
                  setShowLinkPicker(true);
                }}
                className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-55 transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100"
              >
                <ArrowLeftRightIcon className="size-2.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="取消关联"
                title="取消关联"
                onClick={() => removeContentLink('note', note.id, link.targetId)}
                className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-65 transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100"
              >
                <XIcon className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* '@' Searchable Content Link Picker Popover */}
      <Popover
        open={showLinkPicker}
        onOpenChange={(open) => {
          setShowLinkPicker(open);
          if (!open) {
            setReplacingLinkTargetId(null);
            setLinkSearch('');
          }
        }}
      >
        <PopoverPopup
          anchor={headerEl}
          align="start"
          alignOffset={14}
          side="bottom"
          sideOffset={6}
          className="w-80 max-w-[calc(100%-28px)]"
        >
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <PopoverTitle className="text-xs font-semibold">
                {replacingLinkTargetId ? '替换 @ 关联内容' : '选择要 @ 关联的待办或便签'}
              </PopoverTitle>
              <PopoverClose
                render={
                  <Button
                    aria-label="关闭关联选择器"
                    size="icon-xs"
                    variant="ghost"
                    className="-me-1"
                  />
                }
              >
                <XIcon aria-hidden="true" />
              </PopoverClose>
            </div>

            <InputGroup>
              <InputGroupAddon align="inline-start">
                <SearchIcon className="size-3.5" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                size="sm"
                autoFocus
                type="text"
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
                placeholder="搜索待办或便签标题…"
              />
            </InputGroup>

            <div className="-mx-1 flex max-h-48 flex-col gap-0.5 overflow-y-auto px-1">
              {linkCandidates.length === 0 ? (
                <div className="py-5 text-center text-muted-foreground text-xs">
                  没有匹配的待办或便签
                </div>
              ) : (
                linkCandidates.map((cand) => (
                  <button
                    key={`${cand.targetType}-${cand.targetId}`}
                    type="button"
                    onClick={() => handleSelectLinkCandidate(cand)}
                    className="flex cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-2 py-1.5 text-left text-foreground text-xs transition-colors hover:bg-accent"
                  >
                    {cand.targetType === 'note' ? (
                      <StickyNoteIcon
                        className="size-3.5 shrink-0 text-warning"
                        aria-hidden="true"
                      />
                    ) : (
                      <CheckSquareIcon
                        className="size-3.5 shrink-0 text-info"
                        aria-hidden="true"
                      />
                    )}
                    <Badge variant="secondary" size="sm" className="shrink-0">
                      {cand.targetType === 'note' ? '便签' : '待办'}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate">{cand.label}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </PopoverPopup>
      </Popover>

      {/* ================================================================= */}
      {/* MODE A: NORMAL STRUCTURED RICH NOTE                               */}
      {/* ================================================================= */}
      {note.kind === 'normal' && (
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-2.5 pt-4 pr-7 pb-8 pl-5">
              {visibleBlocks.map(({ block, hidden }) => {
                if (hidden) return null;

                if (block.type === 'heading') {
                  const isCollapsed = collapsedHeadings.has(block.id);
                  const headingSizeClass =
                    block.level === 1
                      ? 'text-[18px] font-bold tracking-tight mt-0.5'
                      : block.level === 2
                        ? 'text-[15px] font-bold mt-1.5'
                        : 'text-[13.5px] font-semibold mt-1';
                  return (
                    <div
                      key={block.id}
                      ref={(el) => {
                        blockRefs.current[block.id] = el;
                      }}
                      className={cn(
                        'dt-note-heading-row -ml-4.5 flex items-center gap-1',
                        block.level === 1 ? 'mt-0.5' : 'mt-1.5',
                      )}
                    >
                      <button
                        type="button"
                        aria-label={isCollapsed ? '展开此节内容' : '折叠此节内容'}
                        title={isCollapsed ? '展开此节内容' : '折叠此节内容'}
                        onClick={() => toggleHeadingCollapse(block.id)}
                        className={cn(
                          'inline-flex size-4.5 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 transition-colors hover:bg-accent',
                          isCollapsed ? 'text-dt-accent' : 'text-muted-foreground/75 hover:text-foreground',
                        )}
                      >
                        {isCollapsed ? (
                          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronDownIcon className="size-3.5" aria-hidden="true" />
                        )}
                      </button>

                      <input
                        type="text"
                        value={block.text}
                        onFocus={() => {
                          markBlockFocused(block.id);
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
                        className={cn(
                          'min-w-0 flex-1 border-none bg-transparent p-0 leading-[1.35] text-foreground outline-none placeholder:text-muted-foreground/50',
                          headingSizeClass,
                        )}
                      />

                      {isCollapsed && (
                        <Badge variant="secondary" size="sm" className="shrink-0">
                          已折叠
                        </Badge>
                      )}
                    </div>
                  );
                }

                if (block.type === 'table') {
                  const headerRow = block.rows[0] ?? [];
                  const bodyRows = block.rows.slice(1);
                  const colCount = headerRow.length;
                  const dataRowCount = bodyRows.length;
                  const colWidths = computeTableColumnWidths(block.rows);

                  return (
                    <CardFrame key={block.id} className="my-1">
                      <CardFrameHeader className="items-center gap-x-2 border-b border-border/70 px-3 py-2">
                        <CardFrameTitle className="flex min-w-0 items-center gap-1.5 font-medium text-muted-foreground text-xs">
                          <TableIcon
                            className="size-3.5 shrink-0 opacity-75"
                            aria-hidden="true"
                          />
                          <span className="truncate tabular-nums">
                            表格 · {colCount} 列 × {dataRowCount} 行
                          </span>
                        </CardFrameTitle>

                        <CardFrameAction className="flex items-center gap-1">
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => mutateTable(block.id, 'addRow')}
                            className="h-5.5 px-1.5 text-[11px]"
                          >
                            + 行
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => mutateTable(block.id, 'addCol')}
                            className="h-5.5 px-1.5 text-[11px]"
                          >
                            + 列
                          </Button>
                          <Menu>
                            <MenuTrigger
                              render={
                                <Button
                                  aria-label="表格更多操作"
                                  size="icon-xs"
                                  variant="ghost"
                                  className="size-5.5 text-muted-foreground hover:text-foreground"
                                />
                              }
                            >
                              <EllipsisIcon className="size-3.5" aria-hidden="true" />
                            </MenuTrigger>
                            <MenuPopup align="end" sideOffset={4}>
                              <MenuItem
                                disabled={block.rows.length <= 2}
                                onClick={() => mutateTable(block.id, 'delRow')}
                              >
                                <Rows3Icon aria-hidden="true" />
                                <span>删除末行 (- 行)</span>
                              </MenuItem>
                              <MenuItem
                                disabled={colCount <= 2}
                                onClick={() => mutateTable(block.id, 'delCol')}
                              >
                                <Columns3Icon aria-hidden="true" />
                                <span>删除末列 (- 列)</span>
                              </MenuItem>
                              <MenuSeparator />
                              <MenuItem
                                variant="destructive"
                                onClick={() => removeBlock(block.id)}
                              >
                                <Trash2Icon aria-hidden="true" />
                                <span>删除表格</span>
                              </MenuItem>
                            </MenuPopup>
                          </Menu>
                        </CardFrameAction>
                      </CardFrameHeader>

                      <Table
                        variant="card"
                        className={cn(
                          'w-full table-fixed text-xs',
                          colCount > 4 && 'min-w-[440px]',
                        )}
                      >
                        <colgroup>
                          {colWidths.map((pct, cIdx) => (
                            <col key={cIdx} style={{ width: `${pct}%` }} />
                          ))}
                        </colgroup>
                        <TableHeader>
                          <TableRow className="border-b-0">
                            {headerRow.map((cell, cIdx) => (
                              <TableHead
                                key={cIdx}
                                className="h-auto whitespace-normal border-r border-border/50 px-2.5 py-2 align-top font-medium text-muted-foreground text-xs last:border-r-0"
                              >
                                <CellAutoTextarea
                                  value={cell}
                                  placeholder={`列 ${cIdx + 1}`}
                                  onFocus={() => markBlockFocused(block.id)}
                                  onChange={(val) => updateTableCell(block.id, 0, cIdx, val)}
                                  className="font-medium text-muted-foreground"
                                />
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bodyRows.map((row, bodyIdx) => {
                            const rIdx = bodyIdx + 1;
                            return (
                              <TableRow key={rIdx}>
                                {row.map((cell, cIdx) => (
                                  <TableCell
                                    key={cIdx}
                                    className="whitespace-normal border-r border-border/50 px-2.5 py-2 align-top last:border-r-0"
                                  >
                                    <CellAutoTextarea
                                      value={cell}
                                      placeholder="—"
                                      onFocus={() => markBlockFocused(block.id)}
                                      onChange={(val) =>
                                        updateTableCell(block.id, rIdx, cIdx, val)
                                      }
                                      className={
                                        cIdx === 0
                                          ? 'font-semibold text-foreground'
                                          : 'text-foreground/90'
                                      }
                                    />
                                  </TableCell>
                                ))}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardFrame>
                  );
                }

                // Paragraph / list / quote / code block
                const isEditingBlock =
                  focusedBlockId === block.id || block.text.trim().length === 0;

                return (
                  <div key={block.id}>
                    {isEditingBlock ? (
                      <AutoTextarea
                        value={block.text}
                        autoFocus={focusedBlockId === block.id}
                        onFocus={() => markBlockFocused(block.id)}
                        onBlur={() => {
                          if (focusedBlockId === block.id) {
                            setFocusedBlockId(null);
                          }
                        }}
                        onChange={(val) => updateBlockText(block.id, val)}
                        onKeyDown={(e) => {
                          if (e.key === 'Backspace' && block.text === '' && blocks.length > 1) {
                            e.preventDefault();
                            removeBlock(block.id);
                          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            insertBlockAfter(block.id, {
                              id: `blk_${Date.now().toString(36)}`,
                              type: 'paragraph',
                              text: '',
                            });
                          }
                        }}
                        placeholder="输入正文，输入 # 创建标题，输入 @ 关联待办或便签…"
                      />
                    ) : (
                      <RichParagraphDisplay
                        text={block.text}
                        onActivate={() => markBlockFocused(block.id)}
                      />
                    )}
                  </div>
                );
              })}

              {/* Add new paragraph subtle trigger */}
              <div className="pt-1">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    insertBlockAfter(blocks[blocks.length - 1]?.id ?? null, {
                      id: `blk_${Date.now().toString(36)}`,
                      type: 'paragraph',
                      text: '',
                    })
                  }
                  className="text-muted-foreground hover:text-foreground"
                >
                  <PlusIcon className="size-3" aria-hidden="true" />
                  <span>新段落</span>
                </Button>
              </div>

              {/* File & Audio Attachment Chips */}
              {noteOtherAttachments.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
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
                <div className="mt-1 flex flex-wrap gap-2.5">
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
          </ScrollArea>

          {/* Floating Right-Side Document Outline (Notion-style ticks + hover popover) */}
          {showOutline && headings.length > 0 && (
            <div
              onMouseEnter={() => setOutlineHover(true)}
              onMouseLeave={() => setOutlineHover(false)}
              className="absolute top-4 right-2.5 z-20 flex flex-col items-end"
            >
              <div className="flex cursor-pointer flex-col items-end gap-1.5 px-1 py-1.5">
                {headings.map((h, i) => {
                  const active = (activeHeadingId ?? headings[0]?.id) === h.id;
                  const widthClass =
                    h.level === 1 ? 'w-3.5' : h.level === 2 ? 'w-2.5' : 'w-2';
                  return (
                    <button
                      key={`${h.id}-${i}`}
                      type="button"
                      aria-label={h.text || '未命名标题'}
                      title={h.text}
                      onClick={() => scrollToHeading(h.id)}
                      className={cn(
                        'h-[2.5px] cursor-pointer rounded-full border-none p-0 transition-all duration-150',
                        widthClass,
                        active
                          ? 'bg-foreground/80'
                          : 'bg-foreground/15 hover:bg-foreground/40',
                      )}
                    />
                  );
                })}
              </div>

              {outlineHover && (
                <div className="mt-1 flex max-h-64 w-46 flex-col gap-0.5 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg/5">
                  <div className="px-2 py-1 font-medium text-[11px] text-muted-foreground">
                    文档大纲
                  </div>
                  {headings.map((h) => {
                    const active = (activeHeadingId ?? headings[0]?.id) === h.id;
                    const indentClass =
                      h.level === 1 ? 'pl-2' : h.level === 2 ? 'pl-4' : 'pl-6';
                    return (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => scrollToHeading(h.id)}
                        className={cn(
                          'cursor-pointer truncate rounded-md border-none py-1 pr-2 text-left text-xs transition-colors',
                          indentClass,
                          active
                            ? 'bg-accent font-semibold text-foreground'
                            : 'bg-transparent text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                        )}
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Quick Composer inside concentric Frame */}
          <div className="shrink-0 border-b bg-background px-3.5 py-2.5">
            <Frame className="rounded-xl p-1">
              <FramePanel className="flex flex-col gap-2 rounded-lg p-2.5">
                <Textarea
                  size="sm"
                  value={timelineDraft}
                  onChange={(e) => setTimelineDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleAddTimelineEntry();
                    }
                  }}
                  placeholder="随手记一条进展、灵感或会议要点… (Ctrl+Enter 记录)"
                  className="border-none bg-transparent shadow-none ring-0 before:hidden [&_[data-slot=textarea]]:min-h-12 [&_[data-slot=textarea]]:px-1 [&_[data-slot=textarea]]:py-0.5 [&_[data-slot=textarea]]:text-[length:var(--font-body-size)]"
                />

                {timelineAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {timelineAttachments.map((att) => (
                      <AttachmentMedia
                        key={att.id}
                        att={att}
                        onRemove={() =>
                          setTimelineAttachments((prev) =>
                            prev.filter((a) => a.id !== att.id),
                          )
                        }
                      />
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 border-t pt-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => timelineFileRef.current?.click()}
                  >
                    <ImageIcon className="size-3.5" aria-hidden="true" />
                    <span>图片 / 文件 / 音频</span>
                  </Button>

                  <Button
                    size="xs"
                    variant="default"
                    onClick={handleAddTimelineEntry}
                    disabled={!timelineDraft.trim() && timelineAttachments.length === 0}
                  >
                    <SendIcon className="size-3" aria-hidden="true" />
                    <span>记录</span>
                  </Button>
                </div>
              </FramePanel>
            </Frame>
          </div>

          {/* Chronological Timeline Stream */}
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-3 px-4 pt-3.5 pb-6">
              {note.timelineEntries.length === 0 ? (
                <Empty className="py-12">
                  <EmptyMedia variant="icon">
                    <ClockIcon aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle className="text-base">暂无时间轴记录</EmptyTitle>
                    <EmptyDescription>
                      在上方输入框随手写下第一条进展、灵感或会议要点吧。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                note.timelineEntries.map((entry, idx) => {
                  const linkedTodo = entry.linkedTodoId
                    ? activeTodos.find((t) => t.id === entry.linkedTodoId) ?? null
                    : null;
                  const isEditing = editingEntryId === entry.id;
                  const isLast = idx === note.timelineEntries.length - 1;

                  return (
                    <div key={entry.id} className="relative flex gap-3">
                      {/* Left timeline dot + connector */}
                      <div className="flex shrink-0 flex-col items-center pt-2">
                        <span className="size-2 rounded-full bg-dt-accent ring-3 ring-background" />
                        {!isLast && (
                          <span className="mt-1.5 w-px flex-1 bg-border" />
                        )}
                      </div>

                      {/* Concentric Entry Card */}
                      <Card className="min-w-0 flex-1 gap-2 rounded-xl p-3 before:rounded-[calc(var(--radius-xl)-1px)]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge
                            variant="secondary"
                            size="sm"
                            className="font-normal text-muted-foreground tabular-nums"
                          >
                            {formatTimestampYMDHM(entry.createdAt)}
                          </Badge>

                          <div className="flex items-center gap-1">
                            {linkedTodo ? (
                              <Badge
                                variant="outline"
                                size="default"
                                render={
                                  <button
                                    type="button"
                                    onClick={() => setEditingTodoId(linkedTodo.id)}
                                  />
                                }
                                className="border-dt-accent-border bg-dt-accent-soft text-dt-accent-soft-text"
                              >
                                <CheckIcon className="size-3" aria-hidden="true" />
                                <span>已关联待办</span>
                              </Badge>
                            ) : (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => convertTimelineEntryToTodo(note.id, entry.id)}
                                className="h-5.5 px-2 text-[11px]"
                              >
                                转为待办
                              </Button>
                            )}

                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    aria-label="编辑记录"
                                    size="icon-xs"
                                    variant="ghost"
                                    onClick={() => {
                                      setEditingEntryId(entry.id);
                                      setEditingEntryText(entry.content);
                                    }}
                                    className="size-6 text-muted-foreground hover:text-foreground"
                                  />
                                }
                              >
                                <PencilIcon className="size-3" aria-hidden="true" />
                              </TooltipTrigger>
                              <TooltipPopup>编辑记录</TooltipPopup>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    aria-label="删除记录"
                                    size="icon-xs"
                                    variant="ghost"
                                    onClick={() => deleteTimelineEntry(note.id, entry.id)}
                                    className="size-6 text-muted-foreground hover:text-destructive-foreground"
                                  />
                                }
                              >
                                <Trash2Icon className="size-3" aria-hidden="true" />
                              </TooltipTrigger>
                              <TooltipPopup>删除记录</TooltipPopup>
                            </Tooltip>
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="flex flex-col gap-2">
                            <Textarea
                              size="sm"
                              autoFocus
                              value={editingEntryText}
                              onChange={(e) => setEditingEntryText(e.target.value)}
                              className="[&_[data-slot=textarea]]:text-[length:var(--font-body-size)]"
                            />
                            <div className="flex justify-end gap-1.5">
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => setEditingEntryId(null)}
                              >
                                取消
                              </Button>
                              <Button
                                size="xs"
                                variant="default"
                                onClick={() => handleSaveEntryEdit(entry)}
                              >
                                保存
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap break-words text-[length:var(--font-body-size)] leading-relaxed text-foreground">
                            {entry.content}
                          </div>
                        )}

                        {entry.attachments.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-1.5">
                            {entry.attachments.map((att) => (
                              <AttachmentMedia key={att.id} att={att} />
                            ))}
                          </div>
                        )}
                      </Card>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Subtle Footer Bar */}
      <footer className="flex h-8 shrink-0 items-center justify-between border-t bg-background px-3.5 text-[11.5px] text-muted-foreground tabular-nums">
        <span className="truncate">
          {noteGroup ? noteGroup.name : '未分组'}
          {note.kind === 'normal'
            ? ` · ${headings.length} 节大纲`
            : ` · ${note.timelineEntries.length} 条记录`}
        </span>
        <span className="shrink-0">{totalCharCount} 字</span>
      </footer>
    </div>
  );
};

export default NoteView;
