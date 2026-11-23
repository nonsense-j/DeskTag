import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import {
  type CaretTarget,
  type HeadingBlock,
  type HeadingLevel,
  type TextNoteBlock,
  getTextBlockRawMarkdown,
  isFencedCodeParagraph,
  parseParagraphSegments,
} from './markdownBlocks';

// ---------------------------------------------------------------------------
// Safe Inline Markdown Renderer (bold, italic, inline code, strikethrough)
// ---------------------------------------------------------------------------

export function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*)/g;
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
          className="mx-0.5 inline-block rounded border border-border bg-muted px-1.5 py-px align-baseline font-mono text-[0.84em] font-normal leading-[1.4] text-foreground"
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
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      nodes.push(
        <del key={`s-${key++}`} className="text-muted-foreground line-through">
          {token.slice(2, -2)}
        </del>,
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

// ---------------------------------------------------------------------------
// Rich Paragraph Display (unfocused rendered state for paragraphs)
// ---------------------------------------------------------------------------

export const RichParagraphDisplay: React.FC<{
  text: string;
  onActivate: () => void;
}> = ({ text, onActivate }) => {
  const segments = useMemo(() => parseParagraphSegments(text), [text]);
  const activatedOnDownRef = useRef(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        activatedOnDownRef.current = true;
        onActivate();
      }}
      onClick={() => {
        if (activatedOnDownRef.current) {
          activatedOnDownRef.current = false;
          return;
        }
        onActivate();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
      className="group -mx-[4px] cursor-text rounded-md px-[4px] py-0.5 text-[length:var(--font-body-size)] leading-[1.65] text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-col gap-1">
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
              <ul key={idx} className="flex flex-col gap-1">
                {seg.items.map((item, liIdx) => (
                  <li key={liIdx} className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-muted-foreground/55"
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
              <ol key={idx} className="flex flex-col gap-1">
                {seg.items.map((item, liIdx) => (
                  <li key={liIdx} className="flex items-start gap-2">
                    <span className="min-w-4 shrink-0 text-right font-medium text-muted-foreground text-xs leading-[1.85] tabular-nums">
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
                className="border-dt-accent/55 border-l-2 py-0.5 pl-3 text-muted-foreground"
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
// Caret & Visual Line Helpers (accurate across CJK wrapping & narrow panels)
// ---------------------------------------------------------------------------

function isCaretOnEdgeVisualLine(
  el: HTMLTextAreaElement,
  edge: 'first' | 'last',
): boolean {
  if (el.selectionStart !== el.selectionEnd) return false;
  const pos = el.selectionStart;
  const val = el.value;
  if (val.length === 0) return true;

  if (edge === 'first' && val.slice(0, pos).includes('\n')) {
    return false;
  }
  if (edge === 'last' && val.slice(pos).includes('\n')) {
    return false;
  }

  const cs = window.getComputedStyle(el);
  const fontSize = parseFloat(cs.fontSize) || 14;
  const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.5;
  const paddingY =
    (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const contentHeight = el.scrollHeight - paddingY;

  // Fast O(1) path for single visual line (most headings & short paragraphs)
  if (contentHeight <= lineHeight * 1.65) {
    return true;
  }

  if (edge === 'first' && pos === 0) return true;
  if (edge === 'last' && pos === val.length) return true;

  // Offscreen mirror measurement for wrapped multi-visual-line blocks
  const paddingX =
    (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const innerWidth = Math.max(20, el.clientWidth - paddingX);
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  mirror.style.position = 'fixed';
  mirror.style.top = '-9999px';
  mirror.style.left = '-9999px';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.boxSizing = 'content-box';
  mirror.style.width = `${innerWidth}px`;
  mirror.style.fontFamily = cs.fontFamily;
  mirror.style.fontSize = cs.fontSize;
  mirror.style.fontWeight = cs.fontWeight;
  mirror.style.lineHeight = cs.lineHeight;
  mirror.style.letterSpacing = cs.letterSpacing;
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordBreak = 'break-word';
  mirror.style.overflowWrap = 'break-word';

  const beforeNode = document.createTextNode(val.slice(0, pos));
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  const afterNode = document.createTextNode(val.slice(pos));

  mirror.appendChild(beforeNode);
  mirror.appendChild(marker);
  mirror.appendChild(afterNode);
  document.body.appendChild(mirror);

  try {
    if (edge === 'first') {
      return marker.offsetTop < lineHeight * 0.6;
    }
    const markerBottom = marker.offsetTop + marker.offsetHeight;
    return mirror.scrollHeight - markerBottom < lineHeight * 0.6;
  } finally {
    mirror.remove();
  }
}

interface CaretPositionLike {
  offsetNode: Node | null;
  offset: number;
}

function estimateRenderedHeadingCaret(
  e: React.MouseEvent<HTMLElement>,
  container: HTMLElement | null,
  block: HeadingBlock,
): CaretTarget {
  if (!container || block.text.length === 0) return 'end';
  // If heading has inline markdown syntax, rendered offset diverges from raw markdown
  if (/[`*~]/.test(block.text)) return 'end';

  try {
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => CaretPositionLike | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    let targetNode: Node | null = null;
    let targetOffset = 0;

    if (typeof doc.caretPositionFromPoint === 'function') {
      const pos = doc.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos) {
        targetNode = pos.offsetNode;
        targetOffset = pos.offset;
      }
    } else if (typeof doc.caretRangeFromPoint === 'function') {
      const range = doc.caretRangeFromPoint(e.clientX, e.clientY);
      if (range) {
        targetNode = range.startContainer;
        targetOffset = range.startOffset;
      }
    }

    if (!targetNode || !container.contains(targetNode)) {
      return 'end';
    }

    // Sum text lengths of text nodes inside container up to targetNode
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let total = 0;
    let current = walker.nextNode();
    while (current) {
      if (current === targetNode) {
        const prefixLen = block.level + 1;
        return Math.min(
          prefixLen + block.text.length,
          prefixLen + total + targetOffset,
        );
      }
      total += current.textContent?.length ?? 0;
      current = walker.nextNode();
    }
    return 'end';
  } catch {
    return 'end';
  }
}

// ---------------------------------------------------------------------------
// Typography Helpers (1:1 visual parity between rendered & Typora source edit)
// ---------------------------------------------------------------------------

function getHeadingTypographyClass(level: HeadingLevel): string {
  if (level === 1) return 'text-[18px] font-bold tracking-tight leading-[1.35]';
  if (level === 2) return 'text-[15px] font-bold leading-[1.35]';
  return 'text-[13.5px] font-semibold leading-[1.35]';
}

function getHeadingChevronOffsetClass(
  level: HeadingLevel,
  compact: boolean,
): string {
  if (level === 1) return compact ? 'mt-[7px]' : 'mt-[6px]';
  if (level === 2) return compact ? 'mt-[5px]' : 'mt-[4px]';
  return compact ? 'mt-[4px]' : 'mt-[3px]';
}

// ---------------------------------------------------------------------------
// Unified TyporaTextBlock (Headings & Paragraphs — zero DOM unmount on toggle)
// ---------------------------------------------------------------------------

export interface FocusRequest {
  token: number;
  caret: CaretTarget;
}

export interface TyporaTextBlockProps {
  block: TextNoteBlock;
  isFocused: boolean;
  focusRequest?: FocusRequest | null;
  isCollapsed?: boolean;
  /** Compact narrow-viewport hierarchy mode (chevron slot 16px instead of 20px) */
  compactHierarchy?: boolean;
  onFocusDirect: (blockId: string) => void;
  onActivate: (blockId: string, caret?: CaretTarget) => void;
  onBlurBlock: (blockId: string) => void;
  onRawChange: (
    blockId: string,
    raw: string,
    caretOffset: number | undefined,
    isComposing: boolean,
  ) => void;
  onHeadingEnter: (
    blockId: string,
    selectionStart: number,
    selectionEnd: number,
  ) => void;
  onParagraphEnter: (
    blockId: string,
    selectionStart: number,
    selectionEnd: number,
  ) => void;
  onParagraphCtrlEnter: (blockId: string) => void;
  onBackspaceAtStart: (blockId: string) => void;
  onNavigateVertical: (blockId: string, direction: 'up' | 'down') => void;
  onToggleCollapse?: (blockId: string) => void;
}

export const TyporaTextBlock: React.FC<TyporaTextBlockProps> = ({
  block,
  isFocused,
  focusRequest = null,
  isCollapsed = false,
  compactHierarchy = false,
  onFocusDirect,
  onActivate,
  onBlurBlock,
  onRawChange,
  onHeadingEnter,
  onParagraphEnter,
  onParagraphCtrlEnter,
  onBackspaceAtStart,
  onNavigateVertical,
  onToggleCollapse,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const renderedHeadingRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);
  const lastAppliedTokenRef = useRef<number>(-1);
  const headingActivatedOnDownRef = useRef(false);

  const isHeading = block.type === 'heading';
  const headingLevel: HeadingLevel | null = isHeading ? block.level : null;
  const rawValue = getTextBlockRawMarkdown(block);
  const showEditor = isFocused || (!isHeading && block.text.trim().length === 0);

  const syncHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(22, el.scrollHeight)}px`;
  }, []);

  useLayoutEffect(() => {
    if (showEditor) {
      syncHeight();
    }
  }, [rawValue, block.type, headingLevel, showEditor, syncHeight]);

  useEffect(() => {
    if (!showEditor) return;
    const el = textareaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showEditor, syncHeight]);

  useEffect(() => {
    headingActivatedOnDownRef.current = false;
  }, [showEditor]);

  // Apply explicit programmatic focus + caret position cleanly
  useLayoutEffect(() => {
    if (!isFocused || !focusRequest) return;
    if (lastAppliedTokenRef.current === focusRequest.token) return;
    const el = textareaRef.current;
    if (!el) return;

    lastAppliedTokenRef.current = focusRequest.token;
    el.focus();
    const len = el.value.length;
    let pos = len;
    if (focusRequest.caret === 'start') {
      pos = 0;
    } else if (focusRequest.caret === 'end') {
      pos = len;
    } else {
      pos = Math.max(0, Math.min(len, focusRequest.caret));
    }
    el.setSelectionRange(pos, pos);
  }, [isFocused, focusRequest]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition guard (Chinese / Japanese / Korean input methods)
    if (
      e.nativeEvent.isComposing ||
      isComposingRef.current ||
      e.keyCode === 229
    ) {
      return;
    }

    const el = e.currentTarget;

    // Escape renders immediately by blurring
    if (e.key === 'Escape') {
      e.preventDefault();
      el.blur();
      return;
    }

    // Enter handling
    if (e.key === 'Enter') {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        onParagraphCtrlEnter(block.id);
        return;
      }
      if (isHeading && !e.altKey) {
        e.preventDefault();
        onHeadingEnter(block.id, el.selectionStart, el.selectionEnd);
        return;
      }
      if (!isHeading && !e.altKey) {
        // Fenced code blocks keep native Enter to insert '\n' inside the code block
        if (isFencedCodeParagraph(block.text)) {
          return;
        }
        e.preventDefault();
        onParagraphEnter(block.id, el.selectionStart, el.selectionEnd);
        return;
      }
    }

    // Backspace at caret position 0 (collapsed selection)
    if (
      e.key === 'Backspace' &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      el.selectionStart === 0 &&
      el.selectionEnd === 0
    ) {
      // Only intercept at index 0 when there is no selection; inside `## ` prefix
      // (selectionStart > 0), native textarea Backspace edits `#` syntax naturally.
      e.preventDefault();
      onBackspaceAtStart(block.id);
      return;
    }

    // Cross-block vertical arrow navigation (leave Alt+Arrow free for drag-reorder a11y)
    if (
      (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      const edge = e.key === 'ArrowUp' ? 'first' : 'last';
      if (isCaretOnEdgeVisualLine(el, edge)) {
        e.preventDefault();
        onNavigateVertical(block.id, e.key === 'ArrowUp' ? 'up' : 'down');
      }
    }
  };

  const typographyClass = isHeading
    ? getHeadingTypographyClass(block.level)
    : 'text-[length:var(--font-body-size)] font-normal leading-[1.65]';

  return (
    <div
      data-block-id={block.id}
      data-block-type={block.type}
      data-heading-level={headingLevel ?? undefined}
      data-editing={isFocused ? 'true' : 'false'}
      className={cn(
        'dt-typora-block flex items-start',
        compactHierarchy ? 'gap-[2px]' : 'gap-[4px]',
        isHeading && 'dt-note-heading-row',
      )}
    >
      {/* Keep collapse chevron at slot 0 so slot 1 (<div className="min-w-0 flex-1">)
          and its inner <textarea> NEVER unmount across heading <-> paragraph transitions.
          Explicit px sizing (16+4=20px standard, 14+2=16px compact) stays locked to
          child indentPx across all Settings bodyFontSize values (12px–18px). */}
      {isHeading ? (
        <button
          type="button"
          aria-label={isCollapsed ? '展开此节内容' : '折叠此节内容'}
          title={isCollapsed ? '展开此节内容' : '折叠此节内容'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse?.(block.id);
          }}
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 transition-colors hover:bg-accent',
            compactHierarchy ? 'size-[14px]' : 'size-[16px]',
            getHeadingChevronOffsetClass(block.level, compactHierarchy),
            isCollapsed
              ? 'text-dt-accent'
              : 'text-muted-foreground/75 hover:text-foreground',
          )}
        >
          {isCollapsed ? (
            <ChevronRightIcon
              className={compactHierarchy ? 'size-[12px]' : 'size-[14px]'}
              aria-hidden="true"
            />
          ) : (
            <ChevronDownIcon
              className={compactHierarchy ? 'size-[12px]' : 'size-[14px]'}
              aria-hidden="true"
            />
          )}
        </button>
      ) : null}

      <div className="min-w-0 flex-1">
        {showEditor ? (
          <div
            className={cn(
              'relative -mx-[4px] flex items-start gap-1.5 rounded-md px-[4px] py-0.5 transition-colors',
              isFocused && isHeading && 'bg-accent/55 ring-1 ring-border/70',
              isFocused && !isHeading && 'bg-accent/30',
            )}
          >
            <textarea
              ref={textareaRef}
              rows={1}
              cols={1}
              value={rawValue}
              aria-label={isHeading ? `编辑 ${block.level} 级标题` : '编辑段落'}
              onFocus={() => onFocusDirect(block.id)}
              onBlur={() => {
                isComposingRef.current = false;
                onBlurBlock(block.id);
              }}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={(e) => {
                isComposingRef.current = false;
                onRawChange(
                  block.id,
                  e.currentTarget.value,
                  e.currentTarget.selectionStart ?? undefined,
                  false,
                );
              }}
              onChange={(e) => {
                const composing =
                  isComposingRef.current ||
                  (e.nativeEvent as InputEvent | undefined)?.isComposing === true;
                onRawChange(
                  block.id,
                  e.target.value,
                  e.target.selectionStart ?? undefined,
                  composing,
                );
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                isHeading
                  ? `${'#'.repeat(block.level)} 标题 ${block.level}`
                  : '输入正文，输入 # 创建标题，输入 @ 关联待办或便签…'
              }
              className={cn(
                'block w-full min-w-0 flex-1 resize-none overflow-hidden border-none bg-transparent p-0 font-[inherit] text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/55',
                typographyClass,
              )}
            />
            {isHeading && isFocused ? (
              <span
                aria-hidden="true"
                className="pointer-events-none mt-[0.25em] shrink-0 select-none rounded border border-border/70 bg-background/80 px-1 py-px font-mono text-[10px] font-medium leading-tight text-muted-foreground"
              >
                H{block.level}
              </span>
            ) : null}
          </div>
        ) : isHeading ? (
          <div className="flex items-center gap-1.5">
            <div
              ref={renderedHeadingRef}
              role="button"
              tabIndex={0}
              aria-label={`${block.level} 级标题：${block.text || '未命名标题'}，点击编辑 Markdown 源码`}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                headingActivatedOnDownRef.current = true;
                const caret = estimateRenderedHeadingCaret(
                  e,
                  renderedHeadingRef.current,
                  block,
                );
                onActivate(block.id, caret);
              }}
              onClick={(e) => {
                if (headingActivatedOnDownRef.current) {
                  headingActivatedOnDownRef.current = false;
                  return;
                }
                const caret = estimateRenderedHeadingCaret(
                  e,
                  renderedHeadingRef.current,
                  block,
                );
                onActivate(block.id, caret);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onActivate(block.id, 'end');
                }
              }}
              className={cn(
                '-mx-[4px] min-w-0 flex-1 cursor-text rounded-md px-[4px] py-0.5 break-words text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                typographyClass,
              )}
            >
              {block.text.length > 0 ? (
                renderInlineMarkdown(block.text)
              ) : (
                <span className="font-normal text-muted-foreground/45">
                  标题 {block.level}
                </span>
              )}
            </div>
            {isCollapsed && (
              <Badge variant="secondary" size="sm" className="shrink-0">
                已折叠
              </Badge>
            )}
          </div>
        ) : (
          <RichParagraphDisplay
            text={block.text}
            onActivate={() => onActivate(block.id, 'end')}
          />
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Table Cell Auto-Growing Textarea (IME-safe + vertical block navigation)
// ---------------------------------------------------------------------------

export interface CellAutoTextareaProps {
  value: string;
  onChange: (next: string) => void;
  onFocus?: () => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  textareaRef?: (el: HTMLTextAreaElement | null) => void;
  placeholder?: string;
  className?: string;
}

export const CellAutoTextarea: React.FC<CellAutoTextareaProps> = ({
  value,
  onChange,
  onFocus,
  onNavigateUp,
  onNavigateDown,
  textareaRef,
  placeholder,
  className,
}) => {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      textareaRef?.(el);
    },
    [textareaRef],
  );

  const syncHeight = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(20, el.scrollHeight)}px`;
  }, []);

  useLayoutEffect(() => {
    syncHeight();
  }, [value, syncHeight]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncHeight]);

  return (
    <textarea
      ref={setRef}
      rows={1}
      cols={1}
      value={value}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value.replace(/\r?\n/g, ' '))}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
          return;
        }
        if (
          e.key === 'ArrowUp' &&
          !e.shiftKey &&
          !e.altKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          onNavigateUp &&
          isCaretOnEdgeVisualLine(e.currentTarget, 'first')
        ) {
          e.preventDefault();
          onNavigateUp();
          return;
        }
        if (
          e.key === 'ArrowDown' &&
          !e.shiftKey &&
          !e.altKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          onNavigateDown &&
          isCaretOnEdgeVisualLine(e.currentTarget, 'last')
        ) {
          e.preventDefault();
          onNavigateDown();
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
