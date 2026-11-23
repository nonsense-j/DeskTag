import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';

export type DragPhase = 'idle' | 'arming' | 'dragging' | 'settling';

export interface DropIndicatorRect {
  /** Top offset in px relative to the sortable list container */
  top: number;
  /** Left offset in px relative to the sortable list container */
  left: number;
  /** Width in px matching the dragged block */
  width: number;
  /** Height in px matching the dragged block */
  height: number;
}

export interface ReorderMeta {
  activeId: string;
  overId: string;
}

export interface UseBlockDragReorderOptions {
  /** Ordered IDs of currently visible/rendered blocks */
  itemIds: readonly string[];
  /** Called once drop settle completes and the index actually changed */
  onReorder: (fromIndex: number, toIndex: number, meta: ReorderMeta) => void;
  /** Disable reordering entirely (also auto-disabled when itemIds.length <= 1) */
  disabled?: boolean;
  /** Long-press delay in ms on the left gutter edge (default: 190) */
  longPressMs?: number;
  /** Pointer movement threshold in px before direct grip drag activates (default: 4) */
  dragThresholdPx?: number;
}

export interface BlockItemDragBindings {
  /** Attach to the block root DOM node (merged with any external blockRef) */
  ref: (el: HTMLDivElement | null) => void;
  /** True while long-press arming on this block */
  isArmed: boolean;
  /** True while this block is actively lifted and following the pointer */
  isDragging: boolean;
  /** True while this block is gliding into its landing slot */
  isSettling: boolean;
  /** True when ANY block in the list is actively dragging or settling */
  isAnyDragging: boolean;
  /** True when reordering is enabled and there are at least 2 blocks */
  canDrag: boolean;
  /** Current index of this block in itemIds */
  index: number;
  /** Total draggable block count */
  totalCount: number;
  /** Inline GPU-composited transform / zIndex / CSS variable styles */
  style: React.CSSProperties;
  /** PointerDown handler for the full-height left gutter rail (long-press to lift) */
  onGutterPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  /** PointerDown handler for the grip icon button (4px direct drag or long-press) */
  onHandlePointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  /** Move this block up (-1) or down (+1) via keyboard shortcut */
  moveBy: (delta: -1 | 1) => boolean;
}

export interface UseBlockDragReorderReturn {
  /** Attach to the flex-col container wrapping all SortableBlockItem children */
  containerRef: React.RefCallback<HTMLDivElement>;
  /** Current overall drag phase */
  phase: DragPhase;
  /** Currently active (arming/dragging/settling) block ID, or null */
  activeId: string | null;
  /** Projected target index during drag, or null */
  targetIndex: number | null;
  /** True while dragging or settling */
  isDraggingAny: boolean;
  /** True when at least 2 items exist and reordering is not disabled */
  canReorder: boolean;
  /** Landing slot rect for <BlockDropIndicator /> inside the container */
  dropIndicator: DropIndicatorRect | null;
  /** Returns per-item drag bindings to pass to <SortableBlockItem /> */
  getItemBindings: (blockId: string, index: number) => BlockItemDragBindings;
  /** Programmatically cancel an active drag and restore original order */
  cancelDrag: () => void;
}

interface ItemSnapshot {
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  marginTop: number;
  marginBottom: number;
}

interface DragRenderState {
  phase: DragPhase;
  activeId: string | null;
  fromIndex: number | null;
  targetIndex: number | null;
  draggedStep: number;
  dropIndicator: DropIndicatorRect | null;
  settleOffsetY: number;
}

interface ActiveSession {
  mode: 'handle' | 'gutter';
  phase: Exclude<DragPhase, 'idle'>;
  pointerId: number;
  pointerType: string;
  captureEl: HTMLElement | null;
  blockId: string;
  fromIndex: number;
  targetIndex: number;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  startScrollTop: number;
  scrollEl: HTMLElement | null;
  rects: ItemSnapshot[];
  rowGap: number;
  draggedStep: number;
  minOffsetY: number;
  maxOffsetY: number;
  currentOffsetY: number;
  longPressTimer: number | null;
  settleTimer: number | null;
  autoScrollRaf: number | null;
  remeasureRaf: number | null;
  blurredOnStart: boolean;
  touchLockAttached: boolean;
}

const DEFAULT_LONG_PRESS_MS = 190;
const DEFAULT_DRAG_THRESHOLD_PX = 4;
const CANCEL_HOLD_MOVE_PX = 8;
const SETTLE_DURATION_MS = 165;
const DRAG_SCALE = 1.01;
const DRAG_LIFT_X_PX = 2;
const AUTO_SCROLL_EDGE_PX = 48;
const AUTO_SCROLL_MAX_SPEED = 11;
const OVERSCROLL_BUFFER_PX = 24;

const IDLE_STATE: DragRenderState = {
  phase: 'idle',
  activeId: null,
  fromIndex: null,
  targetIndex: null,
  draggedStep: 0,
  dropIndicator: null,
  settleOffsetY: 0,
};

function findScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node && node !== document.documentElement) {
    if (node.getAttribute('data-slot') === 'scroll-area-viewport') {
      return node;
    }
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function parsePx(raw: string | null | undefined): number {
  const value = parseFloat(raw ?? '');
  return Number.isFinite(value) ? value : 0;
}

/**
 * Measure an item's untransformed layout geometry and vertical margins relative
 * to the positioned list container. Using offsetTop/offsetLeft/offsetWidth/offsetHeight
 * avoids scale/translate distortion from arming/dragging transforms.
 */
function measureItemLayoutRect(
  el: HTMLElement,
  containerEl: HTMLElement,
  containerRect: DOMRect,
): Omit<ItemSnapshot, 'id' | 'bottom'> {
  const cs = window.getComputedStyle(el);
  const marginTop = parsePx(cs.marginTop);
  const marginBottom = parsePx(cs.marginBottom);

  if (el.offsetParent === containerEl) {
    return {
      top: el.offsetTop,
      left: el.offsetLeft,
      width: el.offsetWidth,
      height: el.offsetHeight,
      marginTop,
      marginBottom,
    };
  }
  const rect = el.getBoundingClientRect();
  return {
    top: rect.top - containerRect.top - containerEl.clientTop,
    left: rect.left - containerRect.left - containerEl.clientLeft,
    width: rect.width,
    height: rect.height,
    marginTop,
    marginBottom,
  };
}

/**
 * Read the flex container's vertical row-gap (falling back to measured gap
 * between the first two items if row-gap is "normal").
 */
function measureContainerRowGap(
  containerEl: HTMLElement,
  rects: readonly ItemSnapshot[],
): number {
  const parsed = parseFloat(window.getComputedStyle(containerEl).rowGap);
  if (Number.isFinite(parsed)) {
    return Math.max(0, parsed);
  }
  if (rects.length >= 2) {
    const inferred =
      rects[1].top - rects[0].bottom - rects[0].marginBottom - rects[1].marginTop;
    if (Number.isFinite(inferred)) {
      return Math.max(0, inferred);
    }
  }
  return 0;
}

/**
 * Exact outer vertical space occupied by the dragged item in a flex-column
 * container (its own top/bottom margins + border-box height + container row-gap).
 * Every displaced sibling shifts by exactly +/- this amount regardless of each
 * sibling's own top/bottom margins (e.g. heading mt-3 vs compact single-line gap-1).
 */
function computeDraggedOuterStep(
  fromIndex: number,
  rects: readonly ItemSnapshot[],
  rowGap: number,
): number {
  const dragged = rects[fromIndex];
  if (!dragged) return 0;
  return Math.max(
    0,
    dragged.marginTop + dragged.height + dragged.marginBottom + rowGap,
  );
}

/**
 * Blur any active input/textarea inside the note editor container so focused
 * blocks transition to their rendered layout height before/as drag begins.
 */
function blurActiveEditorInContainer(containerEl: HTMLElement | null): boolean {
  if (!containerEl) return false;
  const activeEl = document.activeElement;
  if (
    activeEl instanceof HTMLElement &&
    (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') &&
    containerEl.contains(activeEl)
  ) {
    activeEl.blur();
    return true;
  }
  return false;
}

/**
 * Compute the exact border-box `top` where the dragged item lands at `targetIndex`
 * in a flex-column container with heterogeneous per-item top/bottom margins.
 * Anchoring directly to `rects[targetIndex]` guarantees zero cumulative rounding
 * error and zero post-drop layout jump across mixed headings, single-line blocks,
 * and tall tables.
 */
function computeLandingTop(
  fromIndex: number,
  targetIndex: number,
  rects: readonly ItemSnapshot[],
): number {
  const dragged = rects[fromIndex];
  const target = rects[targetIndex];
  if (!dragged || !target) return dragged?.top ?? 0;
  if (targetIndex === fromIndex) return dragged.top;
  if (targetIndex > fromIndex) {
    return (
      target.bottom +
      target.marginBottom -
      dragged.height -
      dragged.marginBottom
    );
  }
  return target.top - target.marginTop + dragged.marginTop;
}

/**
 * Compute target index using the exact 1D Voronoi midpoints between adjacent
 * landing slots `computeLandingTop(fromIndex, i, rects)`. This accounts for
 * arbitrary variable heights AND variable per-block top/bottom margins with
 * zero oscillation or jump.
 */
function computeTargetIndex(
  fromIndex: number,
  dragOffsetY: number,
  rects: readonly ItemSnapshot[],
): number {
  const dragged = rects[fromIndex];
  if (!dragged || rects.length <= 1) return fromIndex;

  const draggedTop = dragged.top + dragOffsetY;
  let nextTarget = fromIndex;

  if (dragOffsetY > 0) {
    let prevLandingTop = dragged.top;
    for (let i = fromIndex + 1; i < rects.length; i += 1) {
      const candidateTop = Math.max(
        prevLandingTop,
        computeLandingTop(fromIndex, i, rects),
      );
      const midpoint = (prevLandingTop + candidateTop) * 0.5;
      if (draggedTop > midpoint) {
        nextTarget = i;
        prevLandingTop = candidateTop;
      } else {
        break;
      }
    }
  } else if (dragOffsetY < 0) {
    let prevLandingTop = dragged.top;
    for (let i = fromIndex - 1; i >= 0; i -= 1) {
      const candidateTop = Math.min(
        prevLandingTop,
        computeLandingTop(fromIndex, i, rects),
      );
      const midpoint = (prevLandingTop + candidateTop) * 0.5;
      if (draggedTop < midpoint) {
        nextTarget = i;
        prevLandingTop = candidateTop;
      } else {
        break;
      }
    }
  }
  return nextTarget;
}

export function useBlockDragReorder(
  options: UseBlockDragReorderOptions,
): UseBlockDragReorderReturn {
  const {
    itemIds,
    onReorder,
    disabled = false,
    longPressMs = DEFAULT_LONG_PRESS_MS,
    dragThresholdPx = DEFAULT_DRAG_THRESHOLD_PX,
  } = options;

  const canReorder = !disabled && itemIds.length > 1;

  const [state, setState] = useState<DragRenderState>(IDLE_STATE);

  const containerElRef = useRef<HTMLDivElement | null>(null);
  const itemElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const itemRefCallbacksRef = useRef<Map<string, (el: HTMLDivElement | null) => void>>(
    new Map(),
  );
  const sessionRef = useRef<ActiveSession | null>(null);

  // Fresh refs to avoid stale closures inside active window listeners & timers
  const itemIdsRef = useRef<readonly string[]>(itemIds);
  itemIdsRef.current = itemIds;

  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const canReorderRef = useRef(canReorder);
  canReorderRef.current = canReorder;

  const longPressMsRef = useRef(longPressMs);
  longPressMsRef.current = longPressMs;

  const dragThresholdPxRef = useRef(dragThresholdPx);
  dragThresholdPxRef.current = dragThresholdPx;

  const containerRef = useCallback<React.RefCallback<HTMLDivElement>>((node) => {
    containerElRef.current = node;
  }, []);

  const preventTouchScroll = useCallback((ev: TouchEvent) => {
    if (ev.cancelable) {
      ev.preventDefault();
    }
  }, []);

  // Forward-declared ref for mutually recursive listener cleanup
  const detachWindowListenersRef = useRef<() => void>(() => {});

  const releasePointerCaptureSafe = useCallback((session: ActiveSession) => {
    const el = session.captureEl;
    if (!el) return;
    try {
      if (el.hasPointerCapture(session.pointerId)) {
        el.releasePointerCapture(session.pointerId);
      }
    } catch {
      // Ignore if pointer already ended or element detached
    }
  }, []);

  const stopAutoScroll = useCallback((session: ActiveSession) => {
    if (session.autoScrollRaf !== null) {
      window.cancelAnimationFrame(session.autoScrollRaf);
      session.autoScrollRaf = null;
    }
  }, []);

  const cleanupSessionResources = useCallback(
    (session: ActiveSession) => {
      if (session.longPressTimer !== null) {
        window.clearTimeout(session.longPressTimer);
        session.longPressTimer = null;
      }
      if (session.settleTimer !== null) {
        window.clearTimeout(session.settleTimer);
        session.settleTimer = null;
      }
      if (session.remeasureRaf !== null) {
        window.cancelAnimationFrame(session.remeasureRaf);
        session.remeasureRaf = null;
      }
      stopAutoScroll(session);
      detachWindowListenersRef.current();
      if (session.touchLockAttached) {
        window.removeEventListener('touchmove', preventTouchScroll);
        session.touchLockAttached = false;
      }
      releasePointerCaptureSafe(session);
    },
    [preventTouchScroll, releasePointerCaptureSafe, stopAutoScroll],
  );

  const abortToIdle = useCallback(() => {
    const session = sessionRef.current;
    if (session) {
      cleanupSessionResources(session);
      const draggedEl = itemElementsRef.current.get(session.blockId);
      if (draggedEl) {
        draggedEl.style.transform = '';
      }
      sessionRef.current = null;
    }
    setState((prev) => (prev.phase === 'idle' ? prev : IDLE_STATE));
  }, [cleanupSessionResources]);

  const updateDragPosition = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.phase !== 'dragging') return;

    const scrollDelta = session.scrollEl
      ? session.scrollEl.scrollTop - session.startScrollTop
      : 0;
    const rawOffsetY = session.lastClientY - session.startClientY + scrollDelta;
    const clampedY = Math.max(
      session.minOffsetY,
      Math.min(session.maxOffsetY, rawOffsetY),
    );
    session.currentOffsetY = clampedY;

    // Direct GPU transform update for 60-120fps tracking without React re-renders
    const draggedEl = itemElementsRef.current.get(session.blockId);
    if (draggedEl) {
      draggedEl.style.transform = `translate3d(${DRAG_LIFT_X_PX}px, ${clampedY}px, 0) scale(${DRAG_SCALE})`;
    }

    const nextTarget = computeTargetIndex(session.fromIndex, clampedY, session.rects);
    if (nextTarget !== session.targetIndex) {
      session.targetIndex = nextTarget;
      const landingTop = computeLandingTop(
        session.fromIndex,
        nextTarget,
        session.rects,
      );
      const draggedRect = session.rects[session.fromIndex];
      setState((prev) => ({
        ...prev,
        targetIndex: nextTarget,
        dropIndicator: draggedRect
          ? {
              top: landingTop,
              left: draggedRect.left,
              width: draggedRect.width,
              height: draggedRect.height,
            }
          : null,
      }));
    }
  }, []);

  const computeAutoScrollDelta = useCallback((session: ActiveSession): number => {
    const scrollEl = session.scrollEl;
    if (!scrollEl) return 0;

    const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
    if (maxScroll <= 0) return 0;

    const vpRect = scrollEl.getBoundingClientRect();
    const y = session.lastClientY;

    if (y < vpRect.top + AUTO_SCROLL_EDGE_PX && scrollEl.scrollTop > 0) {
      const ratio = Math.min(1, (vpRect.top + AUTO_SCROLL_EDGE_PX - y) / AUTO_SCROLL_EDGE_PX);
      return -Math.max(1, Math.round(ratio * ratio * AUTO_SCROLL_MAX_SPEED));
    }
    if (y > vpRect.bottom - AUTO_SCROLL_EDGE_PX && scrollEl.scrollTop < maxScroll) {
      const ratio = Math.min(
        1,
        (y - (vpRect.bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX,
      );
      return Math.max(1, Math.round(ratio * ratio * AUTO_SCROLL_MAX_SPEED));
    }
    return 0;
  }, []);

  const ensureAutoScrollLoop = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.phase !== 'dragging') return;
    if (session.autoScrollRaf !== null) return;
    if (computeAutoScrollDelta(session) === 0) return;

    const step = () => {
      const cur = sessionRef.current;
      if (!cur || cur.phase !== 'dragging' || !cur.scrollEl) {
        if (cur) cur.autoScrollRaf = null;
        return;
      }

      const delta = computeAutoScrollDelta(cur);
      if (delta === 0) {
        cur.autoScrollRaf = null;
        return;
      }

      const before = cur.scrollEl.scrollTop;
      cur.scrollEl.scrollTop = before + delta;
      if (cur.scrollEl.scrollTop !== before) {
        updateDragPosition();
      }

      cur.autoScrollRaf = window.requestAnimationFrame(step);
    };

    session.autoScrollRaf = window.requestAnimationFrame(step);
  }, [computeAutoScrollDelta, updateDragPosition]);

  const finishDrag = useCallback(
    (shouldCommit: boolean) => {
      const session = sessionRef.current;
      if (!session) return;

      if (session.phase === 'arming') {
        abortToIdle();
        return;
      }
      if (session.phase !== 'dragging') {
        return;
      }

      // Stop active pointer/scroll tracking while preserving settle timer slot
      if (session.longPressTimer !== null) {
        window.clearTimeout(session.longPressTimer);
        session.longPressTimer = null;
      }
      if (session.remeasureRaf !== null) {
        window.cancelAnimationFrame(session.remeasureRaf);
        session.remeasureRaf = null;
      }
      stopAutoScroll(session);
      detachWindowListenersRef.current();
      if (session.touchLockAttached) {
        window.removeEventListener('touchmove', preventTouchScroll);
        session.touchLockAttached = false;
      }
      releasePointerCaptureSafe(session);

      const fromIdx = session.fromIndex;
      const finalTarget = shouldCommit ? session.targetIndex : fromIdx;
      const landingTop = computeLandingTop(fromIdx, finalTarget, session.rects);
      const settleDeltaY = landingTop - (session.rects[fromIdx]?.top ?? 0);
      const activeId = session.blockId;
      const overId = session.rects[finalTarget]?.id ?? activeId;
      const settleMs = prefersReducedMotion() ? 0 : SETTLE_DURATION_MS;

      const completeSettle = () => {
        if (sessionRef.current !== session) return;
        session.settleTimer = null;
        sessionRef.current = null;
        setState(IDLE_STATE);
        if (shouldCommit && fromIdx !== finalTarget) {
          onReorderRef.current(fromIdx, finalTarget, { activeId, overId });
        }
      };

      if (settleMs === 0) {
        completeSettle();
        return;
      }

      session.phase = 'settling';
      session.targetIndex = finalTarget;
      session.currentOffsetY = settleDeltaY;

      setState({
        phase: 'settling',
        activeId,
        fromIndex: fromIdx,
        targetIndex: finalTarget,
        draggedStep: session.draggedStep,
        dropIndicator: null,
        settleOffsetY: settleDeltaY,
      });

      session.settleTimer = window.setTimeout(completeSettle, settleMs);
    },
    [abortToIdle, preventTouchScroll, releasePointerCaptureSafe, stopAutoScroll],
  );

  const activateDrag = useCallback(
    (reanchorToCurrent: boolean) => {
      const session = sessionRef.current;
      if (!session || session.phase !== 'arming') return;

      if (session.longPressTimer !== null) {
        window.clearTimeout(session.longPressTimer);
        session.longPressTimer = null;
      }

      const containerEl = containerElRef.current;
      const ids = itemIdsRef.current;
      if (!containerEl || ids.length <= 1 || !canReorderRef.current) {
        abortToIdle();
        return;
      }

      const snapshotAllRects = (
        container: HTMLDivElement,
        orderedIds: readonly string[],
      ): ItemSnapshot[] | null => {
        const containerRect = container.getBoundingClientRect();
        const out: ItemSnapshot[] = [];
        for (const id of orderedIds) {
          const el = itemElementsRef.current.get(id);
          if (!el) return null;
          const m = measureItemLayoutRect(el, container, containerRect);
          out.push({
            id,
            top: m.top,
            left: m.left,
            width: m.width,
            height: m.height,
            bottom: m.top + m.height,
            marginTop: m.marginTop,
            marginBottom: m.marginBottom,
          });
        }
        return out;
      };

      const blurredNow = blurActiveEditorInContainer(containerEl);
      window.getSelection()?.removeAllRanges();

      const rects = snapshotAllRects(containerEl, ids);
      if (!rects) {
        abortToIdle();
        return;
      }

      const fromIdx = ids.indexOf(session.blockId);
      if (fromIdx < 0 || fromIdx >= rects.length) {
        abortToIdle();
        return;
      }

      const rowGap = measureContainerRowGap(containerEl, rects);
      const draggedStep = computeDraggedOuterStep(fromIdx, rects, rowGap);
      const firstLandingTop = computeLandingTop(fromIdx, 0, rects);
      const lastLandingTop = computeLandingTop(fromIdx, rects.length - 1, rects);
      const minOffsetY = firstLandingTop - rects[fromIdx].top - OVERSCROLL_BUFFER_PX;
      const maxOffsetY = lastLandingTop - rects[fromIdx].top + OVERSCROLL_BUFFER_PX;

      // Capture pointer for resilient tracking across viewport edges
      if (session.captureEl) {
        try {
          session.captureEl.setPointerCapture(session.pointerId);
        } catch {
          // Synthetic pointer events or detached target: window listeners still track
        }
      }

      // Gentle haptic pulse on touch devices
      if (
        session.pointerType === 'touch' &&
        typeof navigator !== 'undefined' &&
        typeof navigator.vibrate === 'function'
      ) {
        try {
          navigator.vibrate(10);
        } catch {
          // Ignore unsupported environments
        }
      }

      // Prevent native touch scroll once lift activates
      if (session.pointerType === 'touch' && !session.touchLockAttached) {
        window.addEventListener('touchmove', preventTouchScroll, { passive: false });
        session.touchLockAttached = true;
      }

      const scrollEl = findScrollableAncestor(containerEl);
      session.scrollEl = scrollEl;
      session.startScrollTop = scrollEl ? scrollEl.scrollTop : 0;
      if (reanchorToCurrent) {
        session.startClientY = session.lastClientY;
      }
      session.fromIndex = fromIdx;
      session.targetIndex = fromIdx;
      session.rects = rects;
      session.rowGap = rowGap;
      session.draggedStep = draggedStep;
      session.minOffsetY = minOffsetY;
      session.maxOffsetY = maxOffsetY;
      session.currentOffsetY = 0;
      session.phase = 'dragging';

      setState({
        phase: 'dragging',
        activeId: session.blockId,
        fromIndex: fromIdx,
        targetIndex: fromIdx,
        draggedStep: session.draggedStep,
        dropIndicator: {
          top: rects[fromIdx].top,
          left: rects[fromIdx].left,
          width: rects[fromIdx].width,
          height: rects[fromIdx].height,
        },
        settleOffsetY: 0,
      });

      if (!reanchorToCurrent) {
        updateDragPosition();
      }
      ensureAutoScrollLoop();

      // If an editor was blurred on pointerdown/activateDrag, re-measure on the next
      // animation frame (after React commits rendered block heights, e.g. textarea ->
      // RichParagraphDisplay) so dropIndicator & sibling displacement stay pixel-exact.
      if (session.blurredOnStart || blurredNow) {
        session.remeasureRaf = window.requestAnimationFrame(() => {
          session.remeasureRaf = null;
          if (sessionRef.current !== session || session.phase !== 'dragging') return;
          const liveContainer = containerElRef.current;
          const liveIds = itemIdsRef.current;
          if (!liveContainer || liveIds.length !== session.rects.length) return;

          const freshRects = snapshotAllRects(liveContainer, liveIds);
          if (!freshRects) return;

          const freshRowGap = measureContainerRowGap(liveContainer, freshRects);
          const changed =
            Math.abs(freshRowGap - session.rowGap) > 0.5 ||
            freshRects.some((r, i) => {
              const prev = session.rects[i];
              return (
                !prev ||
                Math.abs(r.height - prev.height) > 0.5 ||
                Math.abs(r.top - prev.top) > 0.5 ||
                Math.abs(r.marginTop - prev.marginTop) > 0.5 ||
                Math.abs(r.marginBottom - prev.marginBottom) > 0.5
              );
            });
          if (!changed) return;

          const idx = session.fromIndex;
          const freshStep = computeDraggedOuterStep(idx, freshRects, freshRowGap);
          const freshFirstLandingTop = computeLandingTop(idx, 0, freshRects);
          const freshLastLandingTop = computeLandingTop(
            idx,
            freshRects.length - 1,
            freshRects,
          );

          session.rects = freshRects;
          session.rowGap = freshRowGap;
          session.draggedStep = freshStep;
          session.minOffsetY =
            freshFirstLandingTop - freshRects[idx].top - OVERSCROLL_BUFFER_PX;
          session.maxOffsetY =
            freshLastLandingTop - freshRects[idx].top + OVERSCROLL_BUFFER_PX;

          const clampedY = Math.max(
            session.minOffsetY,
            Math.min(session.maxOffsetY, session.currentOffsetY),
          );
          session.currentOffsetY = clampedY;
          const nextTarget = computeTargetIndex(idx, clampedY, freshRects);
          session.targetIndex = nextTarget;
          const landingTop = computeLandingTop(idx, nextTarget, freshRects);
          const draggedRect = freshRects[idx];

          setState((prev) => ({
            ...prev,
            targetIndex: nextTarget,
            draggedStep: session.draggedStep,
            dropIndicator: draggedRect
              ? {
                  top: landingTop,
                  left: draggedRect.left,
                  width: draggedRect.width,
                  height: draggedRect.height,
                }
              : null,
          }));
          updateDragPosition();
        });
      }
    },
    [abortToIdle, ensureAutoScrollLoop, preventTouchScroll, updateDragPosition],
  );

  // Window event handlers bound only while arming or dragging
  const handleWindowPointerMove = useCallback(
    (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || e.pointerId !== session.pointerId) return;

      session.lastClientX = e.clientX;
      session.lastClientY = e.clientY;

      if (session.phase === 'arming') {
        const dx = e.clientX - session.startClientX;
        const dy = e.clientY - session.startClientY;
        const dist = Math.hypot(dx, dy);

        if (session.mode === 'handle') {
          if (dist >= dragThresholdPxRef.current) {
            activateDrag(false);
          }
        } else if (dist > CANCEL_HOLD_MOVE_PX) {
          // Moved before long-press completed -> user intended scroll or tap, not lift
          abortToIdle();
        }
        return;
      }

      if (session.phase === 'dragging') {
        updateDragPosition();
        ensureAutoScrollLoop();
      }
    },
    [abortToIdle, activateDrag, ensureAutoScrollLoop, updateDragPosition],
  );

  const handleWindowPointerUp = useCallback(
    (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || e.pointerId !== session.pointerId) return;

      if (session.phase === 'arming') {
        abortToIdle();
      } else if (session.phase === 'dragging') {
        finishDrag(true);
      }
    },
    [abortToIdle, finishDrag],
  );

  const handleWindowPointerCancel = useCallback(
    (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || e.pointerId !== session.pointerId) return;

      if (session.phase === 'arming') {
        abortToIdle();
      } else if (session.phase === 'dragging') {
        finishDrag(false);
      }
    },
    [abortToIdle, finishDrag],
  );

  const handleWindowKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (session.phase === 'arming') {
          abortToIdle();
        } else if (session.phase === 'dragging') {
          finishDrag(false);
        }
      }
    },
    [abortToIdle, finishDrag],
  );

  const handleWindowBlur = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.phase === 'arming') {
      abortToIdle();
    } else if (session.phase === 'dragging') {
      finishDrag(false);
    }
  }, [abortToIdle, finishDrag]);

  const attachWindowListeners = useCallback(() => {
    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);
    window.addEventListener('keydown', handleWindowKeyDown, true);
    window.addEventListener('blur', handleWindowBlur);
  }, [
    handleWindowBlur,
    handleWindowKeyDown,
    handleWindowPointerCancel,
    handleWindowPointerMove,
    handleWindowPointerUp,
  ]);

  const detachWindowListeners = useCallback(() => {
    window.removeEventListener('pointermove', handleWindowPointerMove);
    window.removeEventListener('pointerup', handleWindowPointerUp);
    window.removeEventListener('pointercancel', handleWindowPointerCancel);
    window.removeEventListener('keydown', handleWindowKeyDown, true);
    window.removeEventListener('blur', handleWindowBlur);
  }, [
    handleWindowBlur,
    handleWindowKeyDown,
    handleWindowPointerCancel,
    handleWindowPointerMove,
    handleWindowPointerUp,
  ]);

  detachWindowListenersRef.current = detachWindowListeners;

  // Cancel any in-flight drag if the list structure changes externally (e.g. note switch / WebDAV sync)
  const itemIdsSignature = itemIds.join('\0');
  const prevSignatureRef = useRef(itemIdsSignature);
  useEffect(() => {
    if (prevSignatureRef.current !== itemIdsSignature) {
      prevSignatureRef.current = itemIdsSignature;
      if (sessionRef.current !== null) {
        abortToIdle();
      }
    }
  }, [itemIdsSignature, abortToIdle]);

  // Cancel if disabled toggles on mid-drag
  useEffect(() => {
    if (!canReorder && sessionRef.current !== null) {
      abortToIdle();
    }
  }, [canReorder, abortToIdle]);

  // Prune stale cached ref callbacks for deleted block IDs
  useEffect(() => {
    const liveIds = new Set(itemIds);
    for (const key of itemRefCallbacksRef.current.keys()) {
      if (!liveIds.has(key)) {
        itemRefCallbacksRef.current.delete(key);
        itemElementsRef.current.delete(key);
      }
    }
  }, [itemIdsSignature, itemIds]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      const session = sessionRef.current;
      if (session) {
        cleanupSessionResources(session);
        sessionRef.current = null;
      }
    };
  }, [cleanupSessionResources]);

  const startPointerSession = useCallback(
    (
      mode: 'handle' | 'gutter',
      blockId: string,
      index: number,
      e: React.PointerEvent<HTMLElement>,
    ) => {
      if (!canReorderRef.current) return;
      if (sessionRef.current !== null) return;
      if (!e.isPrimary) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      const resolvedIndex =
        itemIdsRef.current[index] === blockId
          ? index
          : itemIdsRef.current.indexOf(blockId);
      if (resolvedIndex < 0) return;

      e.stopPropagation();
      // Prevent unwanted text selection when initiating drag with mouse/pen
      if (e.pointerType !== 'touch') {
        e.preventDefault();
      }

      // Blur any focused editor immediately on gutter/handle pointerdown so
      // rendered heights settle before lift measurement (and track for rAF re-measure).
      const blurredOnStart = blurActiveEditorInContainer(containerElRef.current);

      const session: ActiveSession = {
        mode,
        phase: 'arming',
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        captureEl: e.currentTarget,
        blockId,
        fromIndex: resolvedIndex,
        targetIndex: resolvedIndex,
        startClientX: e.clientX,
        startClientY: e.clientY,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
        startScrollTop: 0,
        scrollEl: null,
        rects: [],
        rowGap: 0,
        draggedStep: 0,
        minOffsetY: 0,
        maxOffsetY: 0,
        currentOffsetY: 0,
        longPressTimer: null,
        settleTimer: null,
        autoScrollRaf: null,
        remeasureRaf: null,
        blurredOnStart,
        touchLockAttached: false,
      };

      sessionRef.current = session;
      attachWindowListeners();

      session.longPressTimer = window.setTimeout(() => {
        activateDrag(true);
      }, longPressMsRef.current);

      setState({
        phase: 'arming',
        activeId: blockId,
        fromIndex: resolvedIndex,
        targetIndex: resolvedIndex,
        draggedStep: 0,
        dropIndicator: null,
        settleOffsetY: 0,
      });
    },
    [activateDrag, attachWindowListeners],
  );

  const cancelDrag = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.phase === 'arming') {
      abortToIdle();
    } else if (session.phase === 'dragging') {
      finishDrag(false);
    }
  }, [abortToIdle, finishDrag]);

  const moveBlockBy = useCallback((blockId: string, delta: -1 | 1): boolean => {
    if (!canReorderRef.current || sessionRef.current !== null) return false;
    const ids = itemIdsRef.current;
    const fromIdx = ids.indexOf(blockId);
    const toIdx = fromIdx + delta;
    if (fromIdx < 0 || toIdx < 0 || toIdx >= ids.length) return false;
    onReorderRef.current(fromIdx, toIdx, {
      activeId: blockId,
      overId: ids[toIdx],
    });
    return true;
  }, []);

  const getItemRefCallback = useCallback((blockId: string) => {
    let cb = itemRefCallbacksRef.current.get(blockId);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        if (el) {
          itemElementsRef.current.set(blockId, el);
        } else {
          itemElementsRef.current.delete(blockId);
        }
      };
      itemRefCallbacksRef.current.set(blockId, cb);
    }
    return cb;
  }, []);

  const isDraggingAny = state.phase === 'dragging' || state.phase === 'settling';

  const getItemBindings = useCallback(
    (blockId: string, index: number): BlockItemDragBindings => {
      const isActive = state.activeId === blockId;
      const isArmed = isActive && state.phase === 'arming';
      const isDragging = isActive && state.phase === 'dragging';
      const isSettling = isActive && state.phase === 'settling';

      let style: React.CSSProperties;

      if (isDragging) {
        const y = sessionRef.current?.currentOffsetY ?? 0;
        style = {
          transform: `translate3d(${DRAG_LIFT_X_PX}px, ${y}px, 0) scale(${DRAG_SCALE})`,
          zIndex: 30,
          willChange: 'transform',
        };
      } else if (isSettling) {
        style = {
          transform: `translate3d(0, ${state.settleOffsetY}px, 0) scale(1)`,
          zIndex: 30,
          willChange: 'transform',
        };
      } else if (
        isDraggingAny &&
        state.fromIndex !== null &&
        state.targetIndex !== null &&
        index !== state.fromIndex
      ) {
        let shiftY = 0;
        if (state.fromIndex < state.targetIndex) {
          if (index > state.fromIndex && index <= state.targetIndex) {
            shiftY = -state.draggedStep;
          }
        } else if (state.fromIndex > state.targetIndex) {
          if (index >= state.targetIndex && index < state.fromIndex) {
            shiftY = state.draggedStep;
          }
        }
        style = {
          transform: `translate3d(0, ${shiftY}px, 0)`,
          willChange: 'transform',
        };
      } else if (isArmed) {
        style = {
          ['--dt-arm-ms' as string]: `${longPressMs}ms`,
        };
      } else {
        style = {};
      }

      return {
        ref: getItemRefCallback(blockId),
        isArmed,
        isDragging,
        isSettling,
        isAnyDragging: isDraggingAny,
        canDrag: canReorder,
        index,
        totalCount: itemIds.length,
        style,
        onGutterPointerDown: (e) => startPointerSession('gutter', blockId, index, e),
        onHandlePointerDown: (e) => startPointerSession('handle', blockId, index, e),
        moveBy: (delta) => moveBlockBy(blockId, delta),
      };
    },
    [
      canReorder,
      getItemRefCallback,
      isDraggingAny,
      itemIds.length,
      longPressMs,
      moveBlockBy,
      startPointerSession,
      state.activeId,
      state.draggedStep,
      state.fromIndex,
      state.phase,
      state.settleOffsetY,
      state.targetIndex,
    ],
  );

  return useMemo(
    () => ({
      containerRef,
      phase: state.phase,
      activeId: state.activeId,
      targetIndex: state.targetIndex,
      isDraggingAny,
      canReorder,
      dropIndicator: state.dropIndicator,
      getItemBindings,
      cancelDrag,
    }),
    [
      cancelDrag,
      canReorder,
      containerRef,
      getItemBindings,
      isDraggingAny,
      state.activeId,
      state.dropIndicator,
      state.phase,
      state.targetIndex,
    ],
  );
}
