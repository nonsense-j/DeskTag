export type HeadingLevel = 1 | 2 | 3;

export interface HeadingBlock {
  id: string;
  type: 'heading';
  level: HeadingLevel;
  text: string;
}

export interface TableBlock {
  id: string;
  type: 'table';
  rows: string[][];
}

export interface ParagraphBlock {
  id: string;
  type: 'paragraph';
  text: string;
}

export type TextNoteBlock = HeadingBlock | ParagraphBlock;
export type NoteBlock = HeadingBlock | TableBlock | ParagraphBlock;

export type CaretTarget = 'start' | 'end' | number;

export type ParsedSegment =
  | { kind: 'code'; content: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: Array<{ num: string; text: string }> }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'text'; lines: string[] };

export type ParagraphLineKind = 'code' | 'ul' | 'ol' | 'quote' | 'text';

export interface VisibleBlockEntry {
  block: NoteBlock;
  index: number;
  hidden: boolean;
  /** Normalized depth from active heading stack (0 = top-level, 1 = nested once, 2 = nested twice); null for non-headings */
  headingDepth: number | null;
  /** Normalized hierarchy depth for visual alignment: headings sit at headingDepth; body blocks sit at active headingStack.length */
  sectionDepth: number;
}

export interface BlockHierarchyLayout {
  indentPx: number;
  guideOffsetsPx: number[];
}

export interface EnterSplitResult {
  replacement: NoteBlock[];
  focusBlockId: string;
  caret: CaretTarget;
}

export interface BackspaceMergeResult {
  blocks: NoteBlock[];
  focusBlockId: string | null;
  caret: CaretTarget;
  focusTableCell?: 'first' | 'last';
}

export interface LiveTextUpdateResult {
  blocks: NoteBlock[];
  focusBlockId: string;
  caret?: CaretTarget;
  didSplit: boolean;
}

// ---------------------------------------------------------------------------
// Stable Block IDs
// ---------------------------------------------------------------------------

let blockIdCounter = 0;

export function createBlockId(): string {
  blockIdCounter += 1;
  return `blk_${Date.now().toString(36)}_${blockIdCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Heading & Raw Markdown Helpers (Typora-style Live Editing)
// ---------------------------------------------------------------------------

/**
 * Matches a single-line ATX heading (# / ## / ### followed by a single space).
 * Using a single space makes raw <-> HeadingBlock a lossless bijection while editing.
 */
const HEADING_LIVE_REGEX = /^(#{1,3}) ([^\n]*)$/;

/**
 * Matches an ATX heading line during document parsing (allows space or tab).
 */
const HEADING_PARSE_REGEX = /^(#{1,3})[ \t](.*)$/;

const CODE_FENCE_OPEN_REGEX = /^\s*```[^`]*$/;
const CODE_FENCE_CLOSE_REGEX = /^\s*```\s*$/;
const UL_LINE_REGEX = /^(\s*[-*•]\s+)(.*)$/;
const OL_LINE_REGEX = /^(\s*)(\d+)(\.\s+)(.*)$/;
const QUOTE_LINE_REGEX = /^(\s*>\s?)(.*)$/;

export function isFencedCodeParagraph(text: string): boolean {
  const firstLine = text.split('\n', 1)[0] ?? '';
  return CODE_FENCE_OPEN_REGEX.test(firstLine);
}

export function getParagraphLineKind(text: string): ParagraphLineKind {
  if (isFencedCodeParagraph(text)) return 'code';
  if (UL_LINE_REGEX.test(text)) return 'ul';
  if (OL_LINE_REGEX.test(text)) return 'ol';
  if (QUOTE_LINE_REGEX.test(text)) return 'quote';
  return 'text';
}

function isSingleFencedCodeBlock(raw: string): boolean {
  const lines = raw.split('\n');
  if (lines.length === 0 || !CODE_FENCE_OPEN_REGEX.test(lines[0])) {
    return false;
  }
  let closedAt = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (CODE_FENCE_CLOSE_REGEX.test(lines[i])) {
      closedAt = i;
      break;
    }
  }
  if (closedAt === -1) return true;
  for (let i = closedAt + 1; i < lines.length; i += 1) {
    if (lines[i].trim() !== '') return false;
  }
  return true;
}

export function getHeadingPrefix(level: HeadingLevel): string {
  return `${'#'.repeat(level)} `;
}

export function getTextBlockRawMarkdown(block: TextNoteBlock): string {
  if (block.type === 'heading') {
    return `${'#'.repeat(block.level)} ${block.text}`;
  }
  return block.text;
}

export function parseSingleLineHeading(
  raw: string,
): { level: HeadingLevel; text: string } | null {
  const match = HEADING_LIVE_REGEX.exec(raw);
  if (!match) return null;
  return {
    level: match[1].length as HeadingLevel,
    text: match[2],
  };
}

export function updateTextBlockFromRaw(
  block: TextNoteBlock,
  raw: string,
): TextNoteBlock {
  const parsed = parseSingleLineHeading(raw);
  if (parsed) {
    return {
      id: block.id,
      type: 'heading',
      level: parsed.level,
      text: parsed.text,
    };
  }
  return {
    id: block.id,
    type: 'paragraph',
    text: raw,
  };
}

/**
 * Updates a text block (heading or paragraph) from its live raw markdown string.
 * - For single-line edits, converts smoothly in-place while keeping the exact same `block.id`.
 * - For multi-line single fenced code blocks, stays cohesive in-place.
 * - For multi-line non-code edits (e.g. paste), immediately splits into individual
 *   line-granularity blocks (headings, tables, code fences, and per-line paragraphs)
 *   preserving caret placement cleanly.
 */
export function applyLiveTextBlockEdit(
  blocks: NoteBlock[],
  blockId: string,
  raw: string,
  caretOffset?: number,
  isComposing = false,
): LiveTextUpdateResult {
  const idx = blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) {
    return { blocks, focusBlockId: blockId, didSplit: false };
  }
  const target = blocks[idx];
  if (target.type === 'table') {
    return { blocks, focusBlockId: blockId, didSplit: false };
  }

  const normalizedRaw = raw.replace(/\r\n/g, '\n');

  // Single-line: lossless in-place heading <-> paragraph update preserving block.id
  if (!normalizedRaw.includes('\n')) {
    const updated = updateTextBlockFromRaw(target, normalizedRaw);
    const next = blocks.slice();
    next[idx] = updated;
    return { blocks: next, focusBlockId: blockId, didSplit: false };
  }

  // Multi-line while composing: keep in-place so IME composition is never interrupted
  if (isComposing) {
    const next = blocks.slice();
    next[idx] = { id: target.id, type: 'paragraph', text: normalizedRaw };
    return { blocks: next, focusBlockId: blockId, didSplit: false };
  }

  // Single fenced code block (open or closed with nothing after) stays cohesive in-place
  if (isSingleFencedCodeBlock(normalizedRaw)) {
    const next = blocks.slice();
    next[idx] = { id: target.id, type: 'paragraph', text: normalizedRaw };
    return { blocks: next, focusBlockId: blockId, didSplit: false };
  }

  // Multi-line paste / structured text -> split immediately into draggable blocks
  const parsedItems = parseRawBlocksWithRanges(normalizedRaw);
  const replacement: NoteBlock[] = parsedItems.map((item, i) => ({
    ...item.block,
    id: i === 0 ? target.id : createBlockId(),
  }));

  let focusIdx = replacement.length - 1;
  let focusCaret: CaretTarget = 'end';

  if (typeof caretOffset === 'number' && caretOffset >= 0) {
    const lines = normalizedRaw.split('\n');
    let activeLineIdx = lines.length - 1;
    let offsetInLine = lines[activeLineIdx]?.length ?? 0;
    let cursor = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const lineEnd = cursor + lines[i].length;
      if (caretOffset <= lineEnd) {
        activeLineIdx = i;
        offsetInLine = caretOffset - cursor;
        break;
      }
      cursor = lineEnd + 1;
    }

    let matchedIdx = -1;
    for (let i = 0; i < parsedItems.length; i += 1) {
      const item = parsedItems[i];
      if (activeLineIdx >= item.startLine && activeLineIdx <= item.endLine) {
        matchedIdx = i;
        break;
      }
      if (item.endLine < activeLineIdx) {
        matchedIdx = i;
      }
    }

    if (matchedIdx >= 0) {
      focusIdx = matchedIdx;
      const matchedItem = parsedItems[matchedIdx];
      const matchedBlock = replacement[matchedIdx];
      if (matchedBlock.type === 'table') {
        focusCaret = 'end';
      } else if (
        activeLineIdx >= matchedItem.startLine &&
        activeLineIdx <= matchedItem.endLine
      ) {
        if (matchedItem.startLine === matchedItem.endLine) {
          const maxLen = getTextBlockRawMarkdown(matchedBlock).length;
          focusCaret = Math.min(maxLen, offsetInLine);
        } else {
          let innerOffset = 0;
          for (let l = matchedItem.startLine; l < activeLineIdx; l += 1) {
            innerOffset += (lines[l]?.length ?? 0) + 1;
          }
          innerOffset += offsetInLine;
          const maxLen = getTextBlockRawMarkdown(matchedBlock).length;
          focusCaret = Math.min(maxLen, innerOffset);
        }
      } else {
        focusCaret = 'end';
      }
    }
  }

  const next = [
    ...blocks.slice(0, idx),
    ...replacement,
    ...blocks.slice(idx + 1),
  ];
  const focusBlock = replacement[focusIdx] ?? replacement[replacement.length - 1];
  return {
    blocks: next,
    focusBlockId: focusBlock.id,
    caret: focusCaret,
    didSplit: true,
  };
}

/**
 * Handles Enter inside a focused ParagraphBlock:
 * - Fenced code blocks stay one cohesive block (inserts '\n' inside the fence).
 * - Bullet lists (`- ` / `* ` / `• `), ordered lists (`1. `), and blockquotes (`> `):
 *   empty marker exits cleanly to an empty plain paragraph; non-empty splits at caret
 *   and continues the marker (incrementing ordered list numbers) on the new block below.
 * - Plain text splits at caret into two independent draggable blocks immediately.
 */
export function splitParagraphOnEnter(
  block: ParagraphBlock,
  selectionStart: number,
  selectionEnd: number,
): EnterSplitResult {
  const raw = block.text;
  const start = Math.max(0, Math.min(raw.length, selectionStart));
  const end = Math.max(start, Math.min(raw.length, selectionEnd));

  // Fenced code blocks stay one cohesive block
  if (isFencedCodeParagraph(raw)) {
    const nextText = `${raw.slice(0, start)}\n${raw.slice(end)}`;
    return {
      replacement: [{ ...block, text: nextText }],
      focusBlockId: block.id,
      caret: start + 1,
    };
  }

  const handlePrefixedLine = (
    prefixLen: number,
    body: string,
    nextPrefix: string,
  ): EnterSplitResult => {
    // Entire line selected -> replace with empty paragraph
    if (start === 0 && end === raw.length) {
      return {
        replacement: [{ id: block.id, type: 'paragraph', text: '' }],
        focusBlockId: block.id,
        caret: 0,
      };
    }

    // Empty marker line (e.g. "- ", "1. ", "> ") -> exit list/quote into plain empty paragraph
    if (body.trim().length === 0 && start === end) {
      return {
        replacement: [{ id: block.id, type: 'paragraph', text: '' }],
        focusBlockId: block.id,
        caret: 0,
      };
    }

    // Collapsed caret at index 0 (before marker): insert empty paragraph above, keep item intact
    if (start === 0 && end === 0) {
      return {
        replacement: [
          { id: createBlockId(), type: 'paragraph', text: '' },
          block,
        ],
        focusBlockId: block.id,
        caret: 0,
      };
    }

    // Caret or selection starts inside prefix: raw split without losing text
    if (start < prefixLen) {
      const firstBlock = updateTextBlockFromRaw(block, raw.slice(0, start));
      const secondBlock = updateTextBlockFromRaw(
        { id: createBlockId(), type: 'paragraph', text: '' },
        raw.slice(end),
      );
      return {
        replacement: [firstBlock, secondBlock],
        focusBlockId: secondBlock.id,
        caret: 0,
      };
    }

    // Split at or after prefix and continue marker on the new block below
    const firstBlock: ParagraphBlock = {
      ...block,
      text: raw.slice(0, start),
    };
    const secondBlock: ParagraphBlock = {
      id: createBlockId(),
      type: 'paragraph',
      text: `${nextPrefix}${raw.slice(end)}`,
    };
    return {
      replacement: [firstBlock, secondBlock],
      focusBlockId: secondBlock.id,
      caret: nextPrefix.length,
    };
  };

  const ulMatch = UL_LINE_REGEX.exec(raw);
  if (ulMatch) {
    const prefix = ulMatch[1];
    const body = ulMatch[2];
    return handlePrefixedLine(prefix.length, body, prefix);
  }

  const olMatch = OL_LINE_REGEX.exec(raw);
  if (olMatch) {
    const indent = olMatch[1];
    const num = parseInt(olMatch[2], 10);
    const sep = olMatch[3];
    const body = olMatch[4];
    const prefixLen = indent.length + olMatch[2].length + sep.length;
    const nextPrefix = `${indent}${num + 1}${sep}`;
    return handlePrefixedLine(prefixLen, body, nextPrefix);
  }

  const quoteMatch = QUOTE_LINE_REGEX.exec(raw);
  if (quoteMatch) {
    const rawPrefix = quoteMatch[1];
    const body = quoteMatch[2];
    const nextPrefix = rawPrefix.endsWith(' ') ? rawPrefix : `${rawPrefix} `;
    return handlePrefixedLine(rawPrefix.length, body, nextPrefix);
  }

  // Plain paragraph line: split at caret into two independent blocks
  const beforeText = raw.slice(0, start);
  const afterText = raw.slice(end);
  const firstBlock = updateTextBlockFromRaw(block, beforeText);
  const secondBlock = updateTextBlockFromRaw(
    { id: createBlockId(), type: 'paragraph', text: '' },
    afterText,
  );
  return {
    replacement: [firstBlock, secondBlock],
    focusBlockId: secondBlock.id,
    caret: 0,
  };
}

/**
 * Handles Enter inside a focused HeadingBlock (in Typora raw mode `## Title`).
 * Splits text cleanly at caret without ever leaving broken `#` syntax behind.
 */
export function splitHeadingOnEnter(
  block: HeadingBlock,
  selectionStart: number,
  selectionEnd: number,
): EnterSplitResult {
  const raw = getTextBlockRawMarkdown(block);
  const prefixLen = block.level + 1;
  const start = Math.max(0, Math.min(raw.length, selectionStart));
  const end = Math.max(start, Math.min(raw.length, selectionEnd));

  // If the entire heading raw text is selected, Enter clears it into a paragraph
  if (start === 0 && end === raw.length) {
    return {
      replacement: [{ id: block.id, type: 'paragraph', text: '' }],
      focusBlockId: block.id,
      caret: 0,
    };
  }

  // Selection spans across or inside the `#` prefix
  if (start !== end && start < prefixLen) {
    const before = raw.slice(0, start);
    const after = raw.slice(end);
    if (before.length === 0) {
      const nextBlock = updateTextBlockFromRaw(
        { id: createBlockId(), type: 'paragraph', text: '' },
        after,
      );
      return {
        replacement: [
          { id: block.id, type: 'paragraph', text: '' },
          nextBlock,
        ],
        focusBlockId: nextBlock.id,
        caret: 0,
      };
    }
    const firstBlock = updateTextBlockFromRaw(block, before);
    const secondBlock = updateTextBlockFromRaw(
      { id: createBlockId(), type: 'paragraph', text: '' },
      after,
    );
    return {
      replacement: [firstBlock, secondBlock],
      focusBlockId: secondBlock.id,
      caret: 0,
    };
  }

  // Collapsed caret at index 0 (before `#`): insert empty paragraph above, keep heading intact
  if (start === 0 && end === 0) {
    return {
      replacement: [
        { id: createBlockId(), type: 'paragraph', text: '' },
        block,
      ],
      focusBlockId: block.id,
      caret: 0,
    };
  }

  // Collapsed caret inside `#` prefix (e.g. `#|# Title` or `##| Title`):
  // keep heading intact and create an empty paragraph below
  if (start < prefixLen) {
    const newPara: ParagraphBlock = {
      id: createBlockId(),
      type: 'paragraph',
      text: '',
    };
    return {
      replacement: [block, newPara],
      focusBlockId: newPara.id,
      caret: 0,
    };
  }

  // Collapsed caret right after `## ` with non-empty title (`## |Title`):
  // insert empty paragraph above instead of leaving an orphaned empty heading
  if (start === prefixLen && end === prefixLen && block.text.length > 0) {
    return {
      replacement: [
        { id: createBlockId(), type: 'paragraph', text: '' },
        block,
      ],
      focusBlockId: block.id,
      caret: prefixLen,
    };
  }

  // Normal split inside or at end of heading text
  const beforeText = raw.slice(prefixLen, start);
  const afterText = raw.slice(end);
  const updatedHeading: HeadingBlock = {
    ...block,
    text: beforeText,
  };
  const nextPara: ParagraphBlock = {
    id: createBlockId(),
    type: 'paragraph',
    text: afterText,
  };
  return {
    replacement: [updatedHeading, nextPara],
    focusBlockId: nextPara.id,
    caret: 0,
  };
}

/**
 * Handles Backspace when caret is collapsed at index 0 of a text block.
 * - Empty paragraph -> deletes block and focuses end of previous visible block
 *   (entering Typora raw mode if the previous block is a heading).
 * - Non-empty paragraph after heading -> merges first line into heading at exact caret offset.
 * - Non-empty paragraph after paragraph -> merges paragraphs cleanly at exact caret offset.
 * - Heading at index 0 (before `#`) -> merges cleanly into preceding text block without data loss.
 */
export function mergeOrRemoveOnBackspaceAtStart(
  blocks: NoteBlock[],
  blockIndex: number,
  hiddenBlockIds: ReadonlySet<string> = new Set(),
): BackspaceMergeResult | null {
  if (blockIndex < 0 || blockIndex >= blocks.length) return null;
  const curr = blocks[blockIndex];
  if (curr.type === 'table') return null;

  // Find nearest previous visible block
  let prevVisibleIdx = -1;
  for (let i = blockIndex - 1; i >= 0; i -= 1) {
    if (!hiddenBlockIds.has(blocks[i].id)) {
      prevVisibleIdx = i;
      break;
    }
  }

  // Case 1: Empty paragraph
  if (curr.type === 'paragraph' && curr.text === '') {
    if (blocks.length <= 1) return null;

    if (prevVisibleIdx >= 0) {
      const prev = blocks[prevVisibleIdx];
      const nextBlocks = [
        ...blocks.slice(0, blockIndex),
        ...blocks.slice(blockIndex + 1),
      ];
      if (prev.type === 'table') {
        return {
          blocks: nextBlocks,
          focusBlockId: prev.id,
          caret: 'end',
          focusTableCell: 'last',
        };
      }
      return {
        blocks: nextBlocks,
        focusBlockId: prev.id,
        caret: 'end',
      };
    }

    // Empty paragraph is the very first block; remove it and focus the next visible block
    let nextVisibleIdx = -1;
    for (let i = blockIndex + 1; i < blocks.length; i += 1) {
      if (!hiddenBlockIds.has(blocks[i].id)) {
        nextVisibleIdx = i;
        break;
      }
    }
    if (nextVisibleIdx >= 0) {
      const nextBlk = blocks[nextVisibleIdx];
      const nextBlocks = [
        ...blocks.slice(0, blockIndex),
        ...blocks.slice(blockIndex + 1),
      ];
      return {
        blocks: nextBlocks,
        focusBlockId: nextBlk.id,
        caret: 'start',
        focusTableCell: nextBlk.type === 'table' ? 'first' : undefined,
      };
    }
    return null;
  }

  // No previous visible block to merge into
  if (prevVisibleIdx < 0) return null;

  // Never silently merge text across a collapsed section boundary
  if (prevVisibleIdx !== blockIndex - 1) {
    const prev = blocks[prevVisibleIdx];
    return {
      blocks,
      focusBlockId: prev.id,
      caret: 'end',
      focusTableCell: prev.type === 'table' ? 'last' : undefined,
    };
  }

  const prev = blocks[blockIndex - 1];
  if (prev.type === 'table') {
    return null;
  }

  // Case 2: Non-empty paragraph merging into previous block
  if (curr.type === 'paragraph') {
    if (prev.type === 'heading') {
      const prevRawLen = getTextBlockRawMarkdown(prev).length;
      const nlIdx = curr.text.indexOf('\n');
      if (nlIdx === -1) {
        const merged: HeadingBlock = {
          ...prev,
          text: prev.text + curr.text,
        };
        return {
          blocks: [
            ...blocks.slice(0, blockIndex - 1),
            merged,
            ...blocks.slice(blockIndex + 1),
          ],
          focusBlockId: prev.id,
          caret: prevRawLen,
        };
      }
      const firstLine = curr.text.slice(0, nlIdx);
      const rest = curr.text.slice(nlIdx + 1);
      const merged: HeadingBlock = {
        ...prev,
        text: prev.text + firstLine,
      };
      const remaining: ParagraphBlock = {
        ...curr,
        text: rest,
      };
      return {
        blocks: [
          ...blocks.slice(0, blockIndex - 1),
          merged,
          remaining,
          ...blocks.slice(blockIndex + 1),
        ],
        focusBlockId: prev.id,
        caret: prevRawLen,
      };
    }

    // prev is paragraph
    if (prev.text === '') {
      // Drop the empty paragraph above while keeping current paragraph & its ID intact
      return {
        blocks: [
          ...blocks.slice(0, blockIndex - 1),
          curr,
          ...blocks.slice(blockIndex + 1),
        ],
        focusBlockId: curr.id,
        caret: 0,
      };
    }

    // Never glue text into or out of a fenced code block (avoids corrupting ``` fences)
    if (isFencedCodeParagraph(prev.text) || isFencedCodeParagraph(curr.text)) {
      return {
        blocks,
        focusBlockId: prev.id,
        caret: 'end',
      };
    }

    const mergeOffset = prev.text.length;
    const merged: ParagraphBlock = {
      ...prev,
      text: prev.text + curr.text,
    };
    return {
      blocks: [
        ...blocks.slice(0, blockIndex - 1),
        merged,
        ...blocks.slice(blockIndex + 1),
      ],
      focusBlockId: prev.id,
      caret: mergeOffset,
    };
  }

  // Case 3: Heading with caret at index 0 (before first `#`)
  if (prev.type === 'paragraph') {
    if (prev.text === '') {
      // Remove empty paragraph above; heading stays intact
      return {
        blocks: [
          ...blocks.slice(0, blockIndex - 1),
          curr,
          ...blocks.slice(blockIndex + 1),
        ],
        focusBlockId: curr.id,
        caret: 0,
      };
    }
    const mergeOffset = prev.text.length;
    const merged: ParagraphBlock = {
      ...prev,
      text: prev.text + curr.text,
    };
    return {
      blocks: [
        ...blocks.slice(0, blockIndex - 1),
        merged,
        ...blocks.slice(blockIndex + 1),
      ],
      focusBlockId: prev.id,
      caret: mergeOffset,
    };
  }

  // prev is heading, curr is heading
  const prevRawLen = getTextBlockRawMarkdown(prev).length;
  const merged: HeadingBlock = {
    ...prev,
    text: prev.text + curr.text,
  };
  return {
    blocks: [
      ...blocks.slice(0, blockIndex - 1),
      merged,
      ...blocks.slice(blockIndex + 1),
    ],
    focusBlockId: prev.id,
    caret: prevRawLen,
  };
}

/**
 * Toolbar H1/H2/H3 helper:
 * - On a heading with the SAME level -> toggles back to paragraph (same ID).
 * - On a heading with a DIFFERENT level -> switches level (same ID).
 * - On a paragraph -> converts (first line if multi-line) to heading (same ID).
 * - On a table -> inserts a new heading AFTER the table (never overwrites table).
 */
export function applyHeadingFormatToBlocks(
  blocks: NoteBlock[],
  targetId: string,
  level: HeadingLevel,
): { blocks: NoteBlock[]; focusBlockId: string; caret: CaretTarget } {
  const idx = blocks.findIndex((b) => b.id === targetId);
  if (idx < 0) {
    return { blocks, focusBlockId: targetId, caret: 'end' };
  }
  const target = blocks[idx];

  if (target.type === 'table') {
    const newHeading: HeadingBlock = {
      id: createBlockId(),
      type: 'heading',
      level,
      text: '',
    };
    const next = [
      ...blocks.slice(0, idx + 1),
      newHeading,
      ...blocks.slice(idx + 1),
    ];
    return {
      blocks: next,
      focusBlockId: newHeading.id,
      caret: 'end',
    };
  }

  if (target.type === 'heading') {
    const next = blocks.slice();
    if (target.level === level) {
      next[idx] = {
        id: target.id,
        type: 'paragraph',
        text: target.text,
      };
    } else {
      next[idx] = {
        ...target,
        level,
      };
    }
    return {
      blocks: next,
      focusBlockId: target.id,
      caret: 'end',
    };
  }

  // Paragraph -> Heading
  const nlIdx = target.text.indexOf('\n');
  if (nlIdx === -1) {
    const next = blocks.slice();
    next[idx] = {
      id: target.id,
      type: 'heading',
      level,
      text: target.text,
    };
    return {
      blocks: next,
      focusBlockId: target.id,
      caret: 'end',
    };
  }

  const firstLine = target.text.slice(0, nlIdx);
  const rest = target.text.slice(nlIdx + 1);
  const heading: HeadingBlock = {
    id: target.id,
    type: 'heading',
    level,
    text: firstLine,
  };
  const remainder: ParagraphBlock = {
    id: createBlockId(),
    type: 'paragraph',
    text: rest,
  };
  const next = [
    ...blocks.slice(0, idx),
    heading,
    remainder,
    ...blocks.slice(idx + 1),
  ];
  return {
    blocks: next,
    focusBlockId: heading.id,
    caret: 'end',
  };
}

/**
 * Normalizes a multi-line paragraph on blur if it contains multiple lines outside
 * a single fenced code block (e.g. text entered during IME composition).
 * Preserves the original block's ID on the first resulting block.
 */
export function normalizeParagraphOnBlur(
  blocks: NoteBlock[],
  blockId: string,
): NoteBlock[] {
  const idx = blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return blocks;
  const target = blocks[idx];
  if (target.type !== 'paragraph') return blocks;
  if (!target.text.includes('\n')) return blocks;
  if (isSingleFencedCodeBlock(target.text)) return blocks;

  const parsed = parseContentToBlocks(target.text);
  if (
    parsed.length === 1 &&
    parsed[0].type === 'paragraph' &&
    parsed[0].text === target.text
  ) {
    return blocks;
  }

  const normalized = parsed.map((blk, i) =>
    i === 0 ? { ...blk, id: target.id } : blk,
  );
  return [
    ...blocks.slice(0, idx),
    ...normalized,
    ...blocks.slice(idx + 1),
  ];
}

// ---------------------------------------------------------------------------
// Heading Visibility, Hierarchy Depths & Collapsed-Section-Aware Block Reorder
// ---------------------------------------------------------------------------

export function computeBlockVisibility(
  blocks: readonly NoteBlock[],
  collapsedHeadings: ReadonlySet<string>,
): VisibleBlockEntry[] {
  const out: VisibleBlockEntry[] = [];
  const headingStack: number[] = [];
  let collapsedLevel: number | null = null;

  for (let i = 0; i < blocks.length; i += 1) {
    const blk = blocks[i];
    if (blk.type === 'heading') {
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1] >= blk.level
      ) {
        headingStack.pop();
      }
      const headingDepth = headingStack.length;
      headingStack.push(blk.level);

      if (collapsedLevel !== null && blk.level <= collapsedLevel) {
        collapsedLevel = null;
      }
      const hidden = collapsedLevel !== null;
      out.push({
        block: blk,
        index: i,
        hidden,
        headingDepth,
        sectionDepth: headingDepth,
      });
      if (!hidden && collapsedHeadings.has(blk.id)) {
        collapsedLevel = blk.level;
      }
    } else {
      out.push({
        block: blk,
        index: i,
        hidden: collapsedLevel !== null,
        headingDepth: null,
        sectionDepth: headingStack.length,
      });
    }
  }
  return out;
}

export function computeBlockHierarchyLayout(
  entry: Pick<VisibleBlockEntry, 'sectionDepth'>,
  stepPx = 20,
  chevronCenterOffsetPx = stepPx <= 16 ? 6 : 7,
): BlockHierarchyLayout {
  const depth = Math.max(0, entry.sectionDepth);
  const indentPx = depth * stepPx;
  const guideOffsetsPx: number[] = [];
  for (let k = 0; k < depth; k += 1) {
    guideOffsetsPx.push(k * stepPx + chevronCenterOffsetPx);
  }
  return { indentPx, guideOffsetsPx };
}

/**
 * Removes any collapsed-heading IDs that are hiding `targetBlockId`.
 * Returns `null` when `targetBlockId` is already visible (avoiding unnecessary state updates).
 */
export function uncollapseAncestorsOfBlock(
  blocks: readonly NoteBlock[],
  collapsedHeadings: ReadonlySet<string>,
  targetBlockId: string,
): Set<string> | null {
  if (collapsedHeadings.size === 0) return null;
  let next: Set<string> | null = null;
  let currentSet: ReadonlySet<string> = collapsedHeadings;

  // At most 3 heading nesting levels (H1 -> H2 -> H3)
  for (let pass = 0; pass < 4; pass += 1) {
    let collapsedLevel: number | null = null;
    let collapsingHeadingId: string | null = null;
    let culpritId: string | null = null;

    for (const blk of blocks) {
      if (blk.type === 'heading') {
        if (collapsedLevel !== null && blk.level <= collapsedLevel) {
          collapsedLevel = null;
          collapsingHeadingId = null;
        }
        const hidden = collapsedLevel !== null;
        if (blk.id === targetBlockId) {
          if (hidden) culpritId = collapsingHeadingId;
          break;
        }
        if (!hidden && currentSet.has(blk.id)) {
          collapsedLevel = blk.level;
          collapsingHeadingId = blk.id;
        }
      } else if (blk.id === targetBlockId) {
        if (collapsedLevel !== null) culpritId = collapsingHeadingId;
        break;
      }
    }

    if (!culpritId) break;
    if (!next) next = new Set(collapsedHeadings);
    next.delete(culpritId);
    currentSet = next;
  }

  return next;
}

/**
 * Drops stale IDs from `collapsedHeadings` that are no longer headings in `blocks`
 * (e.g. after downgrading a collapsed heading to a paragraph or deleting it).
 * Returns `null` when nothing needs to be pruned.
 */
export function pruneCollapsedHeadings(
  blocks: readonly NoteBlock[],
  collapsedHeadings: ReadonlySet<string>,
): Set<string> | null {
  if (collapsedHeadings.size === 0) return null;
  const headingIds = new Set<string>();
  for (const blk of blocks) {
    if (blk.type === 'heading') headingIds.add(blk.id);
  }
  let next: Set<string> | null = null;
  for (const id of collapsedHeadings) {
    if (!headingIds.has(id)) {
      if (!next) next = new Set(collapsedHeadings);
      next.delete(id);
    }
  }
  return next;
}

/**
 * Reorders blocks using indices from the visible (non-hidden) list.
 * If a collapsed heading is moved, its hidden child blocks move atomically with it.
 */
export function reorderVisibleBlocks(
  blocks: NoteBlock[],
  collapsedHeadings: ReadonlySet<string>,
  fromVisibleIdx: number,
  toVisibleIdx: number,
): NoteBlock[] {
  if (fromVisibleIdx === toVisibleIdx) return blocks;

  const entries = computeBlockVisibility(blocks, collapsedHeadings);
  const groups: NoteBlock[][] = [];
  for (const entry of entries) {
    if (!entry.hidden) {
      groups.push([entry.block]);
    } else if (groups.length > 0) {
      groups[groups.length - 1].push(entry.block);
    } else {
      groups.push([entry.block]);
    }
  }

  if (
    fromVisibleIdx < 0 ||
    fromVisibleIdx >= groups.length ||
    toVisibleIdx < 0 ||
    toVisibleIdx >= groups.length
  ) {
    return blocks;
  }

  const nextGroups = groups.slice();
  const [moved] = nextGroups.splice(fromVisibleIdx, 1);
  nextGroups.splice(toVisibleIdx, 0, moved);
  return nextGroups.flat();
}

// ---------------------------------------------------------------------------
// Structured Markdown Block Parser & Serializer (headings, tables, paragraphs)
// ---------------------------------------------------------------------------

export function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const cleaned = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const parts = cleaned.split('|').map((s) => s.trim());
  return parts.length >= 2 && parts.every((p) => /^:?-{2,}:?$/.test(p));
}

export function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function blockFingerprint(block: NoteBlock): string {
  if (block.type === 'heading') {
    return `h:${block.level}:${block.text}`;
  }
  if (block.type === 'paragraph') {
    return `p:${block.text}`;
  }
  return `t:${block.rows.map((r) => r.join('\x1f')).join('\x1e')}`;
}

interface ParsedBlockWithRange {
  block: NoteBlock;
  startLine: number;
  endLine: number;
}

function parseRawBlocksWithRanges(markdown: string): ParsedBlockWithRange[] {
  const rawLines = (markdown || '').replace(/\r\n/g, '\n').split('\n');
  const items: ParsedBlockWithRange[] = [];
  let idx = 0;

  while (idx < rawLines.length) {
    const line = rawLines[idx];

    // 1. Fenced code block (``` ... ```) stays ONE cohesive paragraph block
    if (CODE_FENCE_OPEN_REGEX.test(line)) {
      const startLine = idx;
      const codeLines: string[] = [line];
      idx += 1;
      while (idx < rawLines.length) {
        const nextLine = rawLines[idx];
        codeLines.push(nextLine);
        idx += 1;
        if (CODE_FENCE_CLOSE_REGEX.test(nextLine)) {
          break;
        }
      }
      items.push({
        block: { id: '', type: 'paragraph', text: codeLines.join('\n') },
        startLine,
        endLine: idx - 1,
      });
      continue;
    }

    // 2. ATX Heading (#, ##, ###)
    const headingMatch = HEADING_PARSE_REGEX.exec(line);
    if (headingMatch) {
      const level = Math.min(3, headingMatch[1].length) as HeadingLevel;
      items.push({
        block: {
          id: '',
          type: 'heading',
          level,
          text: headingMatch[2],
        },
        startLine: idx,
        endLine: idx,
      });
      idx += 1;
      continue;
    }

    // 3. Pipe Table (header + separator + contiguous rows containing '|')
    if (
      line.includes('|') &&
      idx + 1 < rawLines.length &&
      isTableSeparatorLine(rawLines[idx + 1])
    ) {
      const startLine = idx;
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
      items.push({
        block: { id: '', type: 'table', rows },
        startLine,
        endLine: idx - 1,
      });
      continue;
    }

    // 4. Blank line simply separates blocks
    if (line.trim() === '') {
      idx += 1;
      continue;
    }

    // 5. Every non-blank line outside fenced code & tables becomes its own independent paragraph block
    items.push({
      block: { id: '', type: 'paragraph', text: line },
      startLine: idx,
      endLine: idx,
    });
    idx += 1;
  }

  if (items.length === 0) {
    items.push({
      block: { id: '', type: 'paragraph', text: '' },
      startLine: 0,
      endLine: 0,
    });
  }

  return items;
}

export function parseContentToBlocks(
  markdown: string,
  previousBlocks?: readonly NoteBlock[],
): NoteBlock[] {
  const rawBlocks = parseRawBlocksWithRanges(markdown).map((item) => item.block);

  // Assign stable IDs (reusing matching previous block IDs on same-note external sync)
  const reusableIds = new Map<string, string[]>();
  if (previousBlocks) {
    for (const prev of previousBlocks) {
      const fp = blockFingerprint(prev);
      const list = reusableIds.get(fp);
      if (list) list.push(prev.id);
      else reusableIds.set(fp, [prev.id]);
    }
  }

  return rawBlocks.map((blk) => {
    const fp = blockFingerprint(blk);
    const bucket = reusableIds.get(fp);
    const id = bucket && bucket.length > 0 ? bucket.shift()! : createBlockId();
    return { ...blk, id };
  });
}

interface SerializedChunk {
  text: string;
  tightKind: 'ul' | 'ol' | 'quote' | null;
}

export function serializeBlocksToMarkdown(blocks: readonly NoteBlock[]): string {
  const chunks: SerializedChunk[] = [];

  for (const blk of blocks) {
    if (blk.type === 'heading') {
      chunks.push({
        text: `${'#'.repeat(blk.level)} ${blk.text}`,
        tightKind: null,
      });
      continue;
    }
    if (blk.type === 'table') {
      if (blk.rows.length === 0) continue;
      const colCount = Math.max(1, blk.rows[0].length);
      const sanitizeCell = (c: string) =>
        c.replace(/\r?\n+/g, ' ').replace(/\|/g, '｜');
      const header = `| ${blk.rows[0].map(sanitizeCell).join(' | ')} |`;
      const sep = `| ${new Array<string>(colCount).fill('---').join(' | ')} |`;
      const body = blk.rows
        .slice(1)
        .map((r) => `| ${r.map(sanitizeCell).join(' | ')} |`);
      chunks.push({
        text: [header, sep, ...body].join('\n'),
        tightKind: null,
      });
      continue;
    }

    if (blk.text.length === 0) continue;
    const isSingleLine = !blk.text.includes('\n');
    const kind = isSingleLine ? getParagraphLineKind(blk.text) : 'text';
    const tightKind =
      kind === 'ul' || kind === 'ol' || kind === 'quote' ? kind : null;
    chunks.push({ text: blk.text, tightKind });
  }

  if (chunks.length === 0) return '';

  let out = chunks[0].text;
  for (let i = 1; i < chunks.length; i += 1) {
    const prev = chunks[i - 1];
    const curr = chunks[i];
    const joiner =
      prev.tightKind !== null && prev.tightKind === curr.tightKind
        ? '\n'
        : '\n\n';
    out += joiner + curr.text;
  }
  return out;
}

export function computeTableColumnWidths(rows: string[][]): number[] {
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
// Paragraph Segment Parser (code blocks, lists, blockquotes, text)
// ---------------------------------------------------------------------------

export function parseParagraphSegments(text: string): ParsedSegment[] {
  const lines = text.split('\n');
  const segments: ParsedSegment[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (CODE_FENCE_OPEN_REGEX.test(line)) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !CODE_FENCE_CLOSE_REGEX.test(lines[i])) {
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
      !CODE_FENCE_OPEN_REGEX.test(lines[i]) &&
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
