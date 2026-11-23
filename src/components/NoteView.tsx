import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowLeftRightIcon,
  AudioLinesIcon,
  BoldIcon,
  CheckIcon,
  CheckSquareIcon,
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  BlockDragDock,
  BlockDropIndicator,
  SortableBlockItem,
} from './note/SortableBlockItem';
import {
  CellAutoTextarea,
  type FocusRequest,
  TyporaTextBlock,
} from './note/TyporaBlockComponents';
import {
  type CaretTarget,
  type HeadingLevel,
  type NoteBlock,
  applyHeadingFormatToBlocks,
  applyLiveTextBlockEdit,
  computeBlockHierarchyLayout,
  computeBlockVisibility,
  computeTableColumnWidths,
  createBlockId,
  getTextBlockRawMarkdown,
  isFencedCodeParagraph,
  mergeOrRemoveOnBackspaceAtStart,
  normalizeParagraphOnBlur,
  parseContentToBlocks,
  pruneCollapsedHeadings,
  reorderVisibleBlocks,
  serializeBlocksToMarkdown,
  splitHeadingOnEnter,
  splitParagraphOnEnter,
  uncollapseAncestorsOfBlock,
} from './note/markdownBlocks';
import { useBlockDragReorder } from './note/useBlockDragReorder';
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
  const blocksRef = useRef<NoteBlock[]>(blocks);
  blocksRef.current = blocks;

  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const focusedBlockIdRef = useRef<string | null>(focusedBlockId);
  focusedBlockIdRef.current = focusedBlockId;

  const [focusRequest, setFocusRequest] = useState<{
    blockId: string;
    request: FocusRequest;
  } | null>(null);
  const focusTokenRef = useRef(0);
  const lastActiveBlockIdRef = useRef<string | null>(null);
  const [collapsedHeadings, setCollapsedHeadings] = useState<Set<string>>(() => new Set());
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const lastNoteIdRef = useRef<string | null>(note?.id ?? null);
  const lastSerializedRef = useRef<string>(note?.content ?? '');
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tableCellRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Sync incoming external changes (e.g., WebDAV sync or switching notes)
  useEffect(() => {
    if (!note) return;
    if (note.id !== lastNoteIdRef.current) {
      lastNoteIdRef.current = note.id;
      lastSerializedRef.current = note.content;
      const nextBlocks = parseContentToBlocks(note.content);
      blocksRef.current = nextBlocks;
      setBlocks(nextBlocks);
      setCollapsedHeadings(new Set());
      setFocusedBlockId(null);
      setFocusRequest(null);
      setActiveHeadingId(null);
      lastActiveBlockIdRef.current = null;
      return;
    }
    if (note.content !== lastSerializedRef.current) {
      lastSerializedRef.current = note.content;
      setBlocks((prev) => {
        const nextBlocks = parseContentToBlocks(note.content, prev);
        blocksRef.current = nextBlocks;
        return nextBlocks;
      });
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
      blocksRef.current = nextBlocks;
      setBlocks(nextBlocks);
      setCollapsedHeadings(
        (prev) => pruneCollapsedHeadings(nextBlocks, prev) ?? prev,
      );
      if (!note) return;
      const serialized = serializeBlocksToMarkdown(nextBlocks);
      lastSerializedRef.current = serialized;
      updateNote(note.id, { content: serialized });
    },
    [note, updateNote],
  );

  const ensureBlockVisible = useCallback(
    (nextBlocks: readonly NoteBlock[], targetBlockId: string) => {
      setCollapsedHeadings(
        (prev) => uncollapseAncestorsOfBlock(nextBlocks, prev, targetBlockId) ?? prev,
      );
    },
    [],
  );

  // Compute headings, collapsed visibility & visible block list
  const headings = useMemo(
    () => blocks.filter((b): b is Extract<NoteBlock, { type: 'heading' }> => b.type === 'heading'),
    [blocks],
  );

  const blockVisibility = useMemo(
    () => computeBlockVisibility(blocks, collapsedHeadings),
    [blocks, collapsedHeadings],
  );

  const hiddenBlockIds = useMemo(() => {
    const hidden = new Set<string>();
    for (const entry of blockVisibility) {
      if (entry.hidden) hidden.add(entry.block.id);
    }
    return hidden;
  }, [blockVisibility]);

  const visibleEntries = useMemo(
    () => blockVisibility.filter((entry) => !entry.hidden),
    [blockVisibility],
  );

  const visibleBlockIds = useMemo(
    () => visibleEntries.map((entry) => entry.block.id),
    [visibleEntries],
  );

  const handleReorderVisibleBlocks = useCallback(
    (fromVisibleIdx: number, toVisibleIdx: number) => {
      const next = reorderVisibleBlocks(
        blocksRef.current,
        collapsedHeadings,
        fromVisibleIdx,
        toVisibleIdx,
      );
      if (next !== blocksRef.current) {
        commitBlocks(next);
      }
    },
    [collapsedHeadings, commitBlocks],
  );

  const blockDrag = useBlockDragReorder({
    itemIds: visibleBlockIds,
    onReorder: handleReorderVisibleBlocks,
  });

  const dragPhaseRef = useRef(blockDrag.phase);
  dragPhaseRef.current = blockDrag.phase;

  // Responsive hierarchy step: 20px on standard widths, 16px on very narrow panes (< 420px)
  const [noteBodyEl, setNoteBodyEl] = useState<HTMLDivElement | null>(null);
  const [compactHierarchy, setCompactHierarchy] = useState(false);

  const setBlocksContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      blockDrag.containerRef(node);
      setNoteBodyEl(node);
    },
    [blockDrag.containerRef],
  );

  useEffect(() => {
    if (!noteBodyEl) return;
    const updateWidth = () => {
      const width = noteBodyEl.clientWidth;
      if (width > 0) {
        setCompactHierarchy(width < 420);
      }
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(noteBodyEl);
    return () => ro.disconnect();
  }, [noteBodyEl]);

  const hierarchyStepPx = compactHierarchy ? 16 : 20;

  const trailingIndentPx = useMemo(() => {
    const last = visibleEntries[visibleEntries.length - 1];
    if (!last) return 0;
    if (
      last.block.type === 'heading' &&
      !collapsedHeadings.has(last.block.id)
    ) {
      return (last.sectionDepth + 1) * hierarchyStepPx;
    }
    return last.sectionDepth * hierarchyStepPx;
  }, [visibleEntries, collapsedHeadings, hierarchyStepPx]);

  const toggleHeadingCollapse = useCallback((headingId: string) => {
    setCollapsedHeadings((prev) => {
      const next = new Set(prev);
      if (next.has(headingId)) next.delete(headingId);
      else next.add(headingId);
      return next;
    });
  }, []);

  const scrollToHeading = (headingId: string) => {
    setActiveHeadingId(headingId);
    if (hiddenBlockIds.has(headingId)) {
      ensureBlockVisible(blocksRef.current, headingId);
      window.requestAnimationFrame(() => {
        blockRefs.current[headingId]?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
      return;
    }
    const el = blockRefs.current[headingId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const focusTextBlock = useCallback((blockId: string, caret: CaretTarget = 'end') => {
    focusTokenRef.current += 1;
    setFocusedBlockId(blockId);
    lastActiveBlockIdRef.current = blockId;
    setFocusRequest({
      blockId,
      request: { token: focusTokenRef.current, caret },
    });
    const blk = blocksRef.current.find((b) => b.id === blockId);
    if (blk?.type === 'heading') {
      setActiveHeadingId(blockId);
    }
  }, []);

  const focusTableCell = useCallback(
    (
      blockId: string,
      position: 'first' | 'last' | { row: number; col: number },
      caret: 'start' | 'end' = 'start',
    ) => {
      const tbl = blocksRef.current.find((b) => b.id === blockId);
      if (!tbl || tbl.type !== 'table' || tbl.rows.length === 0) return;
      const lastRow = tbl.rows.length - 1;
      const lastCol = Math.max(0, (tbl.rows[lastRow]?.length ?? 1) - 1);
      const row =
        position === 'first' ? 0 : position === 'last' ? lastRow : position.row;
      const col =
        position === 'first' ? 0 : position === 'last' ? lastCol : position.col;
      setFocusedBlockId(blockId);
      lastActiveBlockIdRef.current = blockId;
      setFocusRequest(null);
      const key = `${blockId}:${row}:${col}`;
      window.requestAnimationFrame(() => {
        const el = tableCellRefs.current[key];
        if (!el) return;
        el.focus();
        const pos = caret === 'end' ? el.value.length : 0;
        el.setSelectionRange(pos, pos);
      });
    },
    [],
  );

  const handleFocusDirect = useCallback((blockId: string) => {
    setFocusedBlockId(blockId);
    lastActiveBlockIdRef.current = blockId;
    const blk = blocksRef.current.find((b) => b.id === blockId);
    if (blk?.type === 'heading') {
      setActiveHeadingId(blockId);
    }
  }, []);

  const handleActivateBlock = useCallback(
    (blockId: string, caret: CaretTarget = 'end') => {
      const prevFocused = focusedBlockIdRef.current;
      if (
        prevFocused &&
        prevFocused !== blockId &&
        dragPhaseRef.current === 'idle'
      ) {
        const normalized = normalizeParagraphOnBlur(
          blocksRef.current,
          prevFocused,
        );
        if (normalized !== blocksRef.current) {
          commitBlocks(normalized);
        }
      }
      focusTextBlock(blockId, caret);
    },
    [commitBlocks, focusTextBlock],
  );

  const handleBlurBlock = useCallback(
    (blockId: string) => {
      setFocusedBlockId((prev) => (prev === blockId ? null : prev));
      if (dragPhaseRef.current === 'idle') {
        const normalized = normalizeParagraphOnBlur(blocksRef.current, blockId);
        if (normalized !== blocksRef.current) {
          commitBlocks(normalized);
        }
      }
    },
    [commitBlocks],
  );

  // Typora live-edit text block mutation (headings & paragraphs)
  const handleRawBlockChange = useCallback(
    (
      blockId: string,
      raw: string,
      caretOffset: number | undefined,
      isComposing: boolean,
    ) => {
      const current = blocksRef.current;
      const prevBlock = current.find((b) => b.id === blockId);
      const prevRaw =
        prevBlock && prevBlock.type !== 'table'
          ? getTextBlockRawMarkdown(prevBlock)
          : '';

      // Detect newly typed "@" trigger (avoid popping up while backspacing)
      if (!isComposing && raw.length > prevRaw.length) {
        const checkPos =
          typeof caretOffset === 'number' ? caretOffset : raw.length;
        const prefixBeforeCaret = raw.slice(0, checkPos);
        if (/(?:^|\s)@$/.test(prefixBeforeCaret)) {
          setReplacingLinkTargetId(null);
          setLinkSearch('');
          setShowLinkPicker(true);
        }
      }

      const result = applyLiveTextBlockEdit(
        current,
        blockId,
        raw,
        caretOffset,
        isComposing,
      );
      commitBlocks(result.blocks);

      const updatedBlock = result.blocks.find(
        (b) => b.id === result.focusBlockId,
      );
      if (updatedBlock?.type === 'heading') {
        setActiveHeadingId(updatedBlock.id);
      }

      if (result.didSplit) {
        ensureBlockVisible(result.blocks, result.focusBlockId);
        if (updatedBlock?.type === 'table') {
          focusTableCell(result.focusBlockId, 'last', 'end');
        } else {
          focusTextBlock(result.focusBlockId, result.caret ?? 'end');
        }
      }
    },
    [commitBlocks, ensureBlockVisible, focusTableCell, focusTextBlock],
  );

  const handleHeadingEnter = useCallback(
    (blockId: string, selectionStart: number, selectionEnd: number) => {
      const current = blocksRef.current;
      const idx = current.findIndex((b) => b.id === blockId);
      if (idx < 0) return;
      const blk = current[idx];
      if (blk.type !== 'heading') return;

      const split = splitHeadingOnEnter(blk, selectionStart, selectionEnd);
      const next = [
        ...current.slice(0, idx),
        ...split.replacement,
        ...current.slice(idx + 1),
      ];
      commitBlocks(next);
      ensureBlockVisible(next, split.focusBlockId);
      focusTextBlock(split.focusBlockId, split.caret);
    },
    [commitBlocks, ensureBlockVisible, focusTextBlock],
  );

  const handleParagraphEnter = useCallback(
    (blockId: string, selectionStart: number, selectionEnd: number) => {
      const current = blocksRef.current;
      const idx = current.findIndex((b) => b.id === blockId);
      if (idx < 0) return;
      const blk = current[idx];
      if (blk.type !== 'paragraph') return;

      const split = splitParagraphOnEnter(blk, selectionStart, selectionEnd);
      const next = [
        ...current.slice(0, idx),
        ...split.replacement,
        ...current.slice(idx + 1),
      ];
      commitBlocks(next);
      ensureBlockVisible(next, split.focusBlockId);
      focusTextBlock(split.focusBlockId, split.caret);
    },
    [commitBlocks, ensureBlockVisible, focusTextBlock],
  );

  const handleParagraphCtrlEnter = useCallback(
    (blockId: string) => {
      const newBlock: NoteBlock = {
        id: createBlockId(),
        type: 'paragraph',
        text: '',
      };
      const current = blocksRef.current;
      const idx = current.findIndex((b) => b.id === blockId);
      const pos = idx >= 0 ? idx + 1 : current.length;
      const next = [...current.slice(0, pos), newBlock, ...current.slice(pos)];
      commitBlocks(next);
      ensureBlockVisible(next, newBlock.id);
      focusTextBlock(newBlock.id, 'start');
    },
    [commitBlocks, ensureBlockVisible, focusTextBlock],
  );

  const handleBackspaceAtStart = useCallback(
    (blockId: string) => {
      const current = blocksRef.current;
      const idx = current.findIndex((b) => b.id === blockId);
      if (idx < 0) return;
      const res = mergeOrRemoveOnBackspaceAtStart(current, idx, hiddenBlockIds);
      if (!res) return;

      if (res.blocks !== current) {
        commitBlocks(res.blocks);
      }
      if (!res.focusBlockId) {
        setFocusedBlockId(null);
        return;
      }
      if (res.focusTableCell) {
        focusTableCell(
          res.focusBlockId,
          res.focusTableCell,
          res.focusTableCell === 'last' ? 'end' : 'start',
        );
      } else {
        focusTextBlock(res.focusBlockId, res.caret);
      }
    },
    [commitBlocks, focusTableCell, focusTextBlock, hiddenBlockIds],
  );

  const handleNavigateVertical = useCallback(
    (blockId: string, direction: 'up' | 'down') => {
      const visIdx = visibleEntries.findIndex((e) => e.block.id === blockId);
      if (visIdx < 0) return;
      const targetVisIdx = direction === 'up' ? visIdx - 1 : visIdx + 1;
      if (targetVisIdx < 0 || targetVisIdx >= visibleEntries.length) return;
      const target = visibleEntries[targetVisIdx].block;
      if (target.type === 'table') {
        focusTableCell(
          target.id,
          direction === 'up' ? 'last' : 'first',
          direction === 'up' ? 'end' : 'start',
        );
      } else {
        focusTextBlock(target.id, direction === 'up' ? 'end' : 'start');
      }
    },
    [focusTableCell, focusTextBlock, visibleEntries],
  );

  const insertBlockAfter = (afterId: string | null, newBlock: NoteBlock) => {
    const current = blocksRef.current;
    const idx = afterId
      ? current.findIndex((b) => b.id === afterId)
      : current.length - 1;
    const pos = idx >= 0 ? idx + 1 : current.length;
    const next = [...current.slice(0, pos), newBlock, ...current.slice(pos)];
    commitBlocks(next);
    ensureBlockVisible(next, newBlock.id);
    if (newBlock.type === 'table') {
      focusTableCell(newBlock.id, 'first', 'start');
    } else {
      focusTextBlock(newBlock.id, 'start');
    }
  };

  const removeBlock = (blockId: string) => {
    const current = blocksRef.current;
    if (current.length <= 1) {
      const fallback: NoteBlock = { id: blockId, type: 'paragraph', text: '' };
      commitBlocks([fallback]);
      focusTextBlock(fallback.id, 'start');
      return;
    }
    const visIdx = visibleEntries.findIndex((e) => e.block.id === blockId);
    const neighbor =
      visIdx > 0
        ? visibleEntries[visIdx - 1]?.block
        : visibleEntries[visIdx + 1]?.block ?? null;
    commitBlocks(current.filter((b) => b.id !== blockId));
    if (neighbor) {
      if (neighbor.type === 'table') {
        focusTableCell(neighbor.id, visIdx > 0 ? 'last' : 'first');
      } else {
        focusTextBlock(neighbor.id, visIdx > 0 ? 'end' : 'start');
      }
    } else if (focusedBlockIdRef.current === blockId) {
      setFocusedBlockId(null);
    }
  };

  const resolveActiveBlockId = useCallback(
    (list: readonly NoteBlock[], focused: string | null): string | undefined => {
      if (focused && list.some((b) => b.id === focused)) return focused;
      const last = lastActiveBlockIdRef.current;
      if (last && list.some((b) => b.id === last)) return last;
      return list[list.length - 1]?.id;
    },
    [],
  );

  const activeFormatBlock = useMemo(() => {
    const targetId = resolveActiveBlockId(blocks, focusedBlockId);
    return targetId ? blocks.find((b) => b.id === targetId) ?? null : null;
  }, [blocks, focusedBlockId, resolveActiveBlockId]);

  const applyFormatAction = (
    kind: 'h1' | 'h2' | 'h3' | 'bold' | 'italic' | 'list' | 'quote' | 'code',
  ) => {
    const current = blocksRef.current;
    const targetId = resolveActiveBlockId(current, focusedBlockIdRef.current);
    if (!targetId) return;

    if (kind === 'h1' || kind === 'h2' || kind === 'h3') {
      const level: HeadingLevel = kind === 'h1' ? 1 : kind === 'h2' ? 2 : 3;
      const res = applyHeadingFormatToBlocks(current, targetId, level);
      commitBlocks(res.blocks);
      ensureBlockVisible(res.blocks, res.focusBlockId);
      focusTextBlock(res.focusBlockId, res.caret);
      return;
    }

    const idx = current.findIndex((b) => b.id === targetId);
    if (idx < 0) return;
    const target = current[idx];

    if (kind === 'bold' || kind === 'italic') {
      if (target.type === 'table') return;
      const snippet = kind === 'bold' ? '**加粗文字**' : '*斜体文字*';
      const next = current.slice();
      next[idx] = {
        ...target,
        text: target.text ? `${target.text} ${snippet}` : snippet,
      };
      commitBlocks(next);
      ensureBlockVisible(next, target.id);
      focusTextBlock(target.id, 'end');
      return;
    }

    if (kind === 'code') {
      const codeTemplate = '```\n\n```';
      if (target.type === 'paragraph' && target.text.trim().length === 0) {
        const next = current.slice();
        next[idx] = { id: target.id, type: 'paragraph', text: codeTemplate };
        commitBlocks(next);
        ensureBlockVisible(next, target.id);
        focusTextBlock(target.id, 4);
        return;
      }
      const newCodeBlock: NoteBlock = {
        id: createBlockId(),
        type: 'paragraph',
        text: codeTemplate,
      };
      const next = [
        ...current.slice(0, idx + 1),
        newCodeBlock,
        ...current.slice(idx + 1),
      ];
      commitBlocks(next);
      ensureBlockVisible(next, newCodeBlock.id);
      focusTextBlock(newCodeBlock.id, 4);
      return;
    }

    // list or quote: never overwrite a heading, table, or fenced code block;
    // toggle prefix on plain/list/quote paragraphs cleanly for line-granularity blocks
    const marker = kind === 'list' ? '- ' : '> ';
    if (
      target.type === 'heading' ||
      target.type === 'table' ||
      isFencedCodeParagraph(target.text)
    ) {
      const newBlock: NoteBlock = {
        id: createBlockId(),
        type: 'paragraph',
        text: marker,
      };
      const next = [
        ...current.slice(0, idx + 1),
        newBlock,
        ...current.slice(idx + 1),
      ];
      commitBlocks(next);
      ensureBlockVisible(next, newBlock.id);
      focusTextBlock(newBlock.id, 'end');
      return;
    }

    const next = current.slice();
    const trimmed = target.text;
    let nextText: string;
    if (kind === 'list') {
      nextText = /^\s*[-*•]\s+/.test(trimmed)
        ? trimmed.replace(/^\s*[-*•]\s+/, '')
        : `${marker}${trimmed}`;
    } else {
      nextText = /^\s*>\s?/.test(trimmed)
        ? trimmed.replace(/^\s*>\s?/, '')
        : `${marker}${trimmed}`;
    }
    next[idx] = { id: target.id, type: 'paragraph', text: nextText };
    commitBlocks(next);
    ensureBlockVisible(next, target.id);
    focusTextBlock(target.id, 'end');
  };

  const handleInsertTable = () => {
    const tbl: NoteBlock = {
      id: createBlockId(),
      type: 'table',
      rows: [
        ['事项', '负责人', '状态'],
        ['待补充', '', '进行中'],
      ],
    };
    insertBlockAfter(focusedBlockIdRef.current ?? lastActiveBlockIdRef.current, tbl);
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
        <div className="dt-reveal flex shrink-0 flex-wrap items-center gap-1 border-b bg-coss-frame-well px-3.5 py-1.5">
          {(
            [
              ['h1', 'H1', Heading1Icon, 1],
              ['h2', 'H2', Heading2Icon, 2],
              ['h3', 'H3', Heading3Icon, 3],
              ['bold', '加粗', BoldIcon, null],
              ['italic', '斜体', ItalicIcon, null],
              ['list', '列表', ListIcon, null],
              ['quote', '引用', QuoteIcon, null],
              ['code', '代码', CodeIcon, null],
            ] as const
          ).map(([action, label, IconComp, headingLvl]) => {
            const isActiveHeading =
              headingLvl !== null &&
              activeFormatBlock?.type === 'heading' &&
              activeFormatBlock.level === headingLvl;
            return (
              <Button
                key={action}
                size="xs"
                variant="outline"
                aria-pressed={headingLvl !== null ? isActiveHeading : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFormatAction(action)}
                className={cn(
                  'gap-1 text-foreground',
                  isActiveHeading &&
                    'border-dt-accent-border bg-dt-accent-soft text-dt-accent-soft-text',
                )}
              >
                <IconComp className="size-3" aria-hidden="true" />
                <span>{label}</span>
              </Button>
            );
          })}
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
          <ScrollArea className="flex-1 [&_[data-slot=scroll-area-content]]:flex [&_[data-slot=scroll-area-content]]:min-h-full [&_[data-slot=scroll-area-content]]:flex-col">
            <div
              ref={setBlocksContainerRef}
              className="relative flex flex-1 flex-col gap-[4px] pt-4 pr-7 pb-8 pl-[32px]"
            >
              <BlockDragDock
                visible={blockDrag.canReorder}
                isDragging={blockDrag.isDraggingAny}
                isArming={blockDrag.phase === 'arming'}
              />
              <BlockDropIndicator indicator={blockDrag.dropIndicator} />

              {visibleEntries.map((entry, visibleIndex) => {
                const { block } = entry;
                const dragBindings = blockDrag.getItemBindings(block.id, visibleIndex);
                const handleAlign =
                  block.type === 'heading'
                    ? 'center'
                    : block.type === 'table'
                      ? 'table'
                      : 'top';

                const nextSectionDepth =
                  visibleEntries[visibleIndex + 1]?.sectionDepth ?? 0;
                const { indentPx, guideOffsetsPx } = computeBlockHierarchyLayout(
                  entry,
                  hierarchyStepPx,
                );
                // Explicit px margins keep guide stem bleeds locked at every Settings bodyFontSize (12px–18px)
                const blockSpacingClass =
                  block.type === 'heading' && visibleIndex > 0
                    ? block.level === 1
                      ? 'mt-[12px]'
                      : 'mt-[8px]'
                    : block.type === 'table'
                      ? 'my-[4px]'
                      : undefined;
                const guideTopBleedPx =
                  block.type === 'heading' && visibleIndex > 0
                    ? block.level === 1
                      ? 14
                      : 10
                    : block.type === 'table'
                      ? 6
                      : 3;
                const guideBottomBleedPx = block.type === 'table' ? 6 : 3;

                if (block.type === 'table') {
                  const headerRow = block.rows[0] ?? [];
                  const bodyRows = block.rows.slice(1);
                  const colCount = headerRow.length;
                  const dataRowCount = bodyRows.length;
                  const colWidths = computeTableColumnWidths(block.rows);

                  return (
                    <SortableBlockItem
                      key={block.id}
                      blockId={block.id}
                      dragBindings={dragBindings}
                      handleAlign={handleAlign}
                      indentPx={indentPx}
                      guideOffsetsPx={guideOffsetsPx}
                      guideTopBleedPx={guideTopBleedPx}
                      guideBottomBleedPx={guideBottomBleedPx}
                      guideContinuingDepth={nextSectionDepth}
                      className={blockSpacingClass}
                      blockRef={(el) => {
                        blockRefs.current[block.id] = el;
                      }}
                    >
                      <CardFrame>
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
                                    textareaRef={(el) => {
                                      tableCellRefs.current[`${block.id}:0:${cIdx}`] = el;
                                    }}
                                    onFocus={() => handleFocusDirect(block.id)}
                                    onChange={(val) => updateTableCell(block.id, 0, cIdx, val)}
                                    onNavigateUp={() => handleNavigateVertical(block.id, 'up')}
                                    onNavigateDown={() => {
                                      if (block.rows.length > 1) {
                                        focusTableCell(block.id, { row: 1, col: cIdx }, 'start');
                                      } else {
                                        handleNavigateVertical(block.id, 'down');
                                      }
                                    }}
                                    className="font-medium text-muted-foreground"
                                  />
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {bodyRows.map((row, bodyIdx) => {
                              const rIdx = bodyIdx + 1;
                              const isLastRow = rIdx === block.rows.length - 1;
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
                                        textareaRef={(el) => {
                                          tableCellRefs.current[`${block.id}:${rIdx}:${cIdx}`] = el;
                                        }}
                                        onFocus={() => handleFocusDirect(block.id)}
                                        onChange={(val) =>
                                          updateTableCell(block.id, rIdx, cIdx, val)
                                        }
                                        onNavigateUp={() => {
                                          focusTableCell(
                                            block.id,
                                            { row: rIdx - 1, col: cIdx },
                                            'end',
                                          );
                                        }}
                                        onNavigateDown={() => {
                                          if (!isLastRow) {
                                            focusTableCell(
                                              block.id,
                                              { row: rIdx + 1, col: cIdx },
                                              'start',
                                            );
                                          } else {
                                            handleNavigateVertical(block.id, 'down');
                                          }
                                        }}
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
                    </SortableBlockItem>
                  );
                }

                // Unified Typora-style Heading & Paragraph Block
                const isFocused = focusedBlockId === block.id;
                const activeFocusReq =
                  isFocused && focusRequest?.blockId === block.id
                    ? focusRequest.request
                    : null;

                return (
                  <SortableBlockItem
                    key={block.id}
                    blockId={block.id}
                    dragBindings={dragBindings}
                    handleAlign={handleAlign}
                    indentPx={indentPx}
                    guideOffsetsPx={guideOffsetsPx}
                    guideTopBleedPx={guideTopBleedPx}
                    guideBottomBleedPx={guideBottomBleedPx}
                    guideContinuingDepth={nextSectionDepth}
                    className={blockSpacingClass}
                    blockRef={(el) => {
                      blockRefs.current[block.id] = el;
                    }}
                  >
                    <TyporaTextBlock
                      block={block}
                      isFocused={isFocused}
                      focusRequest={activeFocusReq}
                      isCollapsed={
                        block.type === 'heading' && collapsedHeadings.has(block.id)
                      }
                      compactHierarchy={compactHierarchy}
                      onFocusDirect={handleFocusDirect}
                      onActivate={handleActivateBlock}
                      onBlurBlock={handleBlurBlock}
                      onRawChange={handleRawBlockChange}
                      onHeadingEnter={handleHeadingEnter}
                      onParagraphEnter={handleParagraphEnter}
                      onParagraphCtrlEnter={handleParagraphCtrlEnter}
                      onBackspaceAtStart={handleBackspaceAtStart}
                      onNavigateVertical={handleNavigateVertical}
                      onToggleCollapse={toggleHeadingCollapse}
                    />
                  </SortableBlockItem>
                );
              })}

              {/* Add new paragraph subtle trigger aligned with trailing section indent */}
              <div
                className="pt-1.5"
                style={
                  trailingIndentPx > 0
                    ? { paddingLeft: `${trailingIndentPx}px` }
                    : undefined
                }
              >
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    insertBlockAfter(blocks[blocks.length - 1]?.id ?? null, {
                      id: createBlockId(),
                      type: 'paragraph',
                      text: '',
                    })
                  }
                  className="-ml-1.5 text-muted-foreground hover:text-foreground"
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
                        'h-[2.5px] cursor-pointer rounded-full border-none p-0 transition-[background-color,opacity,transform] duration-[120ms] ease-[var(--dt-ease)]',
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
                <div className="dt-pop-in mt-1 flex max-h-64 w-46 flex-col gap-0.5 overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg/5">
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
                      <Card className="min-w-0 flex-1 gap-2 rounded-xl p-3 transition-[border-color,box-shadow] duration-[120ms] ease-[var(--dt-ease)] before:rounded-[calc(var(--radius-xl)-1px)] hover:border-ring/35">
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
