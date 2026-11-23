import { GripVerticalIcon } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip';
import './noteEditor.css';
import type { BlockItemDragBindings, DropIndicatorRect } from './useBlockDragReorder';

/** Clearance from the left edge of a block wrapper to clear the 24px translucent drag dock + 2px hairline gap */
const DRAG_DOCK_CLEARANCE_PX = 26;
const DEFAULT_GUIDE_BLEED_PX = 3;

export interface BlockDragDockProps {
  /** Show the translucent left drag dock (typically `blockDrag.canReorder`) */
  visible: boolean;
  /** Gently accent the dock while any block is actively dragging or settling */
  isDragging?: boolean;
  /** Gently accent the dock while long-press arming */
  isArming?: boolean;
  className?: string;
}

export interface SortableBlockItemProps {
  /** Stable unique block ID */
  blockId: string;
  /** Per-item drag bindings returned by drag.getItemBindings(blockId, index) */
  dragBindings: BlockItemDragBindings;
  /** Vertical alignment of the left-gutter grip icon */
  handleAlign?: 'top' | 'center' | 'table';
  /** Horizontal indent in px applied to `.dt-sortable-content` so child blocks align beneath their parent heading text */
  indentPx?: number;
  /** X-offsets (in px relative to `.dt-sortable-content`'s unindented left origin) for subtle 1px vertical ancestor hierarchy guides */
  guideOffsetsPx?: readonly number[];
  /** Vertical top bleed in px for hierarchy guide stems (default: 3; increase for nested headings with top margin) */
  guideTopBleedPx?: number;
  /** Vertical bottom bleed in px for continuing hierarchy guide stems (default: 3; pass 0 to end flush at section bottom) */
  guideBottomBleedPx?: number;
  /** Count of outermost ancestor guide levels that continue into the next block; stems with index >= this value terminate flush at bottom: 0px (defaults to all guides) */
  guideContinuingDepth?: number;
  /** Optional ref forwarded to the root block wrapper (e.g. outline scroll target) */
  blockRef?: React.Ref<HTMLDivElement>;
  /** Optional className on the block wrapper */
  className?: string;
  /** Block content */
  children: React.ReactNode;
}

export interface BlockDropIndicatorProps {
  indicator: DropIndicatorRect | null;
  className?: string;
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
  } else {
    (ref as React.MutableRefObject<T | null>).current = value;
  }
}

function preserveFocusAfterReorder(activeEl: Element | null): void {
  if (!(activeEl instanceof HTMLElement)) return;
  const selStart =
    activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement
      ? activeEl.selectionStart
      : null;
  const selEnd =
    activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement
      ? activeEl.selectionEnd
      : null;

  window.requestAnimationFrame(() => {
    if (!activeEl.isConnected) return;
    if (document.activeElement !== activeEl) {
      activeEl.focus({ preventScroll: true });
      if (
        (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) &&
        selStart !== null &&
        selEnd !== null
      ) {
        try {
          activeEl.setSelectionRange(selStart, selEnd);
        } catch {
          // Ignore inputs that disallow selection range
        }
      }
    }
  });
}

export const BlockDragDock: React.FC<BlockDragDockProps> = ({
  visible,
  isDragging = false,
  isArming = false,
  className,
}) => (
  <div
    aria-hidden="true"
    data-slot="block-drag-dock"
    data-visible={visible ? 'true' : 'false'}
    data-dragging={isDragging ? 'true' : 'false'}
    data-arming={isArming ? 'true' : 'false'}
    className={cn('dt-block-drag-dock', className)}
  />
);

export const BlockDropIndicator: React.FC<BlockDropIndicatorProps> = ({
  indicator,
  className,
}) => {
  if (!indicator) return null;

  const indicatorLeft = Math.round(indicator.left + DRAG_DOCK_CLEARANCE_PX);
  const indicatorWidth = Math.max(
    40,
    Math.round(indicator.width - DRAG_DOCK_CLEARANCE_PX),
  );

  return (
    <div
      aria-hidden="true"
      data-slot="block-drop-indicator"
      className={cn('dt-block-drop-indicator', className)}
      style={{
        left: `${indicatorLeft}px`,
        width: `${indicatorWidth}px`,
        height: `${Math.max(24, Math.round(indicator.height))}px`,
        transform: `translate3d(0, ${Math.round(indicator.top)}px, 0)`,
      }}
    />
  );
};

export const SortableBlockItem: React.FC<SortableBlockItemProps> = ({
  blockId,
  dragBindings,
  handleAlign = 'top',
  indentPx = 0,
  guideOffsetsPx,
  guideTopBleedPx = DEFAULT_GUIDE_BLEED_PX,
  guideBottomBleedPx = DEFAULT_GUIDE_BLEED_PX,
  guideContinuingDepth,
  blockRef,
  className,
  children,
}) => {
  const {
    ref: dragRef,
    isArmed,
    isDragging,
    isSettling,
    isAnyDragging,
    canDrag,
    index,
    totalCount,
    style,
    onGutterPointerDown,
    onHandlePointerDown,
    moveBy,
  } = dragBindings;

  // Always-controlled tooltip state avoids controlled/uncontrolled Base UI warnings
  // and ensures tooltips vanish immediately upon arming or dragging.
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const suppressTooltip = isArmed || isAnyDragging;
  const resolvedTooltipOpen = !suppressTooltip && tooltipOpen;

  const setMergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      dragRef(node);
      assignRef(blockRef, node);
    },
    [dragRef, blockRef],
  );

  const dragState: 'idle' | 'arming' | 'dragging' | 'settling' = isDragging
    ? 'dragging'
    : isSettling
      ? 'settling'
      : isArmed
        ? 'arming'
        : 'idle';

  const isSiblingAnim = isAnyDragging && !isDragging && !isSettling;

  const handleAlignClass =
    handleAlign === 'center'
      ? 'top-1/2 -translate-y-1/2'
      : handleAlign === 'table'
        ? 'top-2.5'
        : 'top-[3px]';

  const safeIndentPx =
    typeof indentPx === 'number' && Number.isFinite(indentPx) && indentPx > 0
      ? indentPx
      : 0;
  const safeTopBleed =
    typeof guideTopBleedPx === 'number' && Number.isFinite(guideTopBleedPx)
      ? guideTopBleedPx
      : DEFAULT_GUIDE_BLEED_PX;
  const safeBottomBleed =
    typeof guideBottomBleedPx === 'number' && Number.isFinite(guideBottomBleedPx)
      ? guideBottomBleedPx
      : DEFAULT_GUIDE_BLEED_PX;
  const guideCount = guideOffsetsPx?.length ?? 0;
  const continuingDepth =
    typeof guideContinuingDepth === 'number' && Number.isFinite(guideContinuingDepth)
      ? Math.max(0, Math.floor(guideContinuingDepth))
      : guideCount;
  const hasGuides = guideCount > 0;

  const handleGripPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      setTooltipOpen(false);
      onHandlePointerDown(e);
    },
    [onHandlePointerDown],
  );

  const handleRailPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      setTooltipOpen(false);
      onGutterPointerDown(e);
    },
    [onGutterPointerDown],
  );

  // Keyboard shortcut Alt+ArrowUp / Alt+ArrowDown anywhere inside the block
  const handleWrapperKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!canDrag || e.nativeEvent.isComposing) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const activeEl = document.activeElement;
          const delta: -1 | 1 = e.key === 'ArrowUp' ? -1 : 1;
          if (moveBy(delta)) {
            e.preventDefault();
            preserveFocusAfterReorder(activeEl);
          }
        }
      }
    },
    [canDrag, moveBy],
  );

  // Keyboard reordering directly on the focused grip handle
  const handleGripKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!canDrag || e.nativeEvent.isComposing) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const btn = e.currentTarget;
        const delta: -1 | 1 = e.key === 'ArrowUp' ? -1 : 1;
        if (moveBy(delta)) {
          e.preventDefault();
          e.stopPropagation();
          preserveFocusAfterReorder(btn);
        }
      }
    },
    [canDrag, moveBy],
  );

  return (
    <div
      ref={setMergedRef}
      data-sortable-block={blockId}
      data-block-id={blockId}
      data-block-index={index}
      data-drag-state={dragState}
      data-any-dragging={isAnyDragging ? 'true' : undefined}
      data-sibling-anim={isSiblingAnim ? 'true' : undefined}
      data-indent-px={safeIndentPx > 0 ? safeIndentPx : undefined}
      onKeyDown={handleWrapperKeyDown}
      style={style}
      className={cn(
        'dt-sortable-block group/block -ml-[32px] pl-[32px]',
        className,
      )}
    >
      {/* Dedicated left gutter: aligned directly over the 24px translucent drag dock */}
      {canDrag && (
        <div
          data-block-drag-gutter=""
          onPointerDown={handleRailPointerDown}
          onContextMenu={(e) => {
            if (isArmed || isDragging) e.preventDefault();
          }}
          className="dt-block-gutter"
        >
          <span aria-hidden="true" className="dt-block-arm-rail" />

          <Tooltip
            open={resolvedTooltipOpen}
            onOpenChange={(nextOpen) => {
              setTooltipOpen(suppressTooltip ? false : nextOpen);
            }}
          >
            <TooltipTrigger
              render={
                <button
                  type="button"
                  data-block-drag-handle=""
                  aria-label={`拖拽或长按左侧调整顺序（当前第 ${index + 1} / ${totalCount} 块，按 ↑/↓ 或 Alt+↑/↓ 可移动）`}
                  aria-roledescription="可拖拽排序块"
                  onPointerDown={handleGripPointerDown}
                  onKeyDown={handleGripKeyDown}
                  className={cn('dt-block-grip-btn', handleAlignClass)}
                />
              }
            >
              <GripVerticalIcon className="size-3.5" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipPopup side="top" align="start" sideOffset={6}>
              拖拽或长按左侧调整顺序
            </TooltipPopup>
          </Tooltip>
        </div>
      )}

      {/* Block content stays 100% isolated from drag initiation, with optional hierarchy indentation & tree stems */}
      <div
        className="dt-sortable-content relative min-w-0"
        style={safeIndentPx > 0 ? { paddingLeft: `${safeIndentPx}px` } : undefined}
      >
        {hasGuides && guideOffsetsPx && (
          <div aria-hidden="true" className="dt-block-hierarchy-guides">
            {guideOffsetsPx.map((offsetPx, guideIdx) => {
              const bottomOffset = guideIdx < continuingDepth ? -safeBottomBleed : 0;
              return (
                <span
                  key={guideIdx}
                  data-guide-level={guideIdx}
                  className="dt-block-hierarchy-guide"
                  style={{
                    left: `${offsetPx}px`,
                    top: `${-safeTopBleed}px`,
                    bottom: `${bottomOffset}px`,
                  }}
                />
              );
            })}
          </div>
        )}
        {children}
      </div>
    </div>
  );
};
