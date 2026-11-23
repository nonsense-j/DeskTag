import { PlusIcon } from 'lucide-react';
import React, { useLayoutEffect, useRef } from 'react';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useDeskTagStore, type ActiveTab } from '../store/useDeskTagStore';

interface RailTabItem {
  key: string;
  label: string;
  tab: ActiveTab;
  customWidth: number | null;
}

export interface SideTabRailProps {
  onRailMetricsChange?: (metrics: { width: number; height: number }) => void;
}

export const SideTabRail: React.FC<SideTabRailProps> = ({ onRailMetricsChange }) => {
  const {
    activeLists,
    activeNotes,
    activeTab,
    device,
    dock,
    dockTransition,
    setActiveTab,
    addNote,
    expandPanel,
  } = useDeskTagStore();

  const railRef = useRef<HTMLElement | null>(null);

  const orientation: 'left' | 'right' | 'top' = dock.mode.startsWith('left_')
    ? 'right'
    : dock.mode.startsWith('top_')
      ? 'top'
      : 'left';

  const isCollapsedOnly = dock.collapsed && dock.mode.endsWith('_tabs');
  const isTransitioning = dockTransition !== 'idle';

  // Match Rust's effective_tab_width: device.uniform_tab_width.clamp(48, 120)
  const uniformW = Math.max(48, Math.min(120, device.uniformTabWidth || 64));

  // Build ordered tabs: 待办 -> pinned lists -> pinned notes -> 便签库 -> +
  const pinnedLists = activeLists.filter((l) => l.pinnedToSide);
  const pinnedNotes = activeNotes.filter((n) => n.pinnedToSide);

  const middleTabs: RailTabItem[] = [
    ...pinnedLists.map((list) => ({
      key: `list:${list.id}`,
      label: list.name,
      tab: { kind: 'list', listId: list.id } as ActiveTab,
      customWidth: list.tabWidth,
    })),
    ...pinnedNotes.map((note) => ({
      key: `note:${note.id}`,
      label: note.title || '便签',
      tab: { kind: 'note', noteId: note.id } as ActiveTab,
      customWidth: note.tabWidth,
    })),
  ];

  // Respect maxVisibleTabs (reserve 2 slots for 待办 & 便签库)
  const maxMiddle = Math.max(0, (device.maxVisibleTabs || 8) - 2);
  const visibleMiddle = middleTabs.slice(0, maxMiddle);

  const tabs: RailTabItem[] = [
    { key: 'todo', label: '待办', tab: { kind: 'todo' }, customWidth: null },
    ...visibleMiddle,
    { key: 'note_library', label: '便签库', tab: { kind: 'note_library' }, customWidth: null },
  ];

  const tabsSignature = tabs
    .map((t) => `${t.key}:${t.label}:${t.customWidth ?? ''}`)
    .join('|');

  // Measure actual rail cross-axis size for pixel-exact slide offset across uniform/individual/auto modes
  useLayoutEffect(() => {
    if (!onRailMetricsChange) return;
    const el = railRef.current;
    if (!el) return;

    const measure = () => {
      let measuredWidth = uniformW;
      let measuredHeight = 32;

      if (orientation === 'top') {
        if (!isCollapsedOnly) {
          measuredHeight = el.offsetHeight || 32;
        } else {
          const buttons = Array.from(el.querySelectorAll<HTMLElement>('button'));
          const maxH = buttons.reduce((acc, btn) => Math.max(acc, btn.offsetHeight), 0);
          if (maxH > 0) measuredHeight = maxH;
        }
      } else if (device.tabWidthMode === 'uniform') {
        measuredWidth = uniformW;
      } else if (!isCollapsedOnly) {
        measuredWidth = el.offsetWidth || uniformW;
      } else {
        const buttons = Array.from(el.querySelectorAll<HTMLElement>('button'));
        const maxW = buttons.reduce((acc, btn) => Math.max(acc, btn.offsetWidth), 0);
        if (maxW > 0) measuredWidth = maxW;
      }

      onRailMetricsChange({ width: measuredWidth, height: measuredHeight });
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const buttons = Array.from(el.querySelectorAll<HTMLElement>('button'));
    for (const btn of buttons) {
      observer.observe(btn);
    }
    return () => observer.disconnect();
  }, [
    onRailMetricsChange,
    orientation,
    isCollapsedOnly,
    device.tabWidthMode,
    uniformW,
    tabsSignature,
  ]);

  const isTabActive = (tab: ActiveTab): boolean => {
    if (tab.kind !== activeTab.kind) return false;
    if (tab.kind === 'list' && activeTab.kind === 'list') return tab.listId === activeTab.listId;
    if (tab.kind === 'note' && activeTab.kind === 'note') return tab.noteId === activeTab.noteId;
    return true;
  };

  const getTabStyle = (item: RailTabItem): React.CSSProperties => {
    if (orientation === 'top') {
      return { maxWidth: 112 };
    }
    if (device.tabWidthMode === 'uniform') {
      return { width: uniformW };
    }
    if (device.tabWidthMode === 'individual' && item.customWidth) {
      return { width: Math.max(48, Math.min(120, item.customWidth)) };
    }
    return { minWidth: 58, maxWidth: 112 };
  };

  const handleTabClick = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (dock.collapsed || dockTransition === 'collapsing') {
      void expandPanel();
    }
  };

  const handleQuickCreateNote = () => {
    const created = addNote({
      title: '新便签',
      kind: 'normal',
      pinnedToSide: true,
    });
    setActiveTab({ kind: 'note', noteId: created.id });
    if (dock.collapsed || dockTransition === 'collapsing') {
      void expandPanel();
    }
  };

  const orientationShapeClass =
    orientation === 'left'
      ? 'rounded-l-[10px] rounded-r-none border-r-0 min-h-9 px-1.5 py-1.5 before:rounded-l-[9px]'
      : orientation === 'right'
        ? 'rounded-r-[10px] rounded-l-none border-l-0 min-h-9 px-1.5 py-1.5 before:rounded-r-[9px]'
        : 'rounded-b-[10px] rounded-t-none border-t-0 min-h-8 px-3.5 py-1.5 before:rounded-b-[9px]';

  const tooltipSide =
    orientation === 'left' ? 'right' : orientation === 'right' ? 'left' : 'bottom';

  return (
    <aside
      ref={railRef}
      aria-label="侧边页签栏"
      className={cn(
        'side-tab-rail',
        `orientation-${orientation}`,
        isCollapsedOnly && 'collapsed-only',
      )}
    >
      {tabs.map((item) => {
        const active = isTabActive(item.tab);
        return (
          <Tooltip key={item.key} disabled={isTransitioning}>
            <TooltipTrigger
              render={
                <button
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'side-tab-item relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center overflow-hidden whitespace-nowrap border not-dark:bg-clip-padding text-xs leading-tight tracking-tight outline-none before:pointer-events-none before:absolute before:inset-0 focus-visible:z-20',
                    orientationShapeClass,
                    active
                      ? 'is-active z-10 border-transparent bg-[var(--tab-active-bg)] font-semibold text-[var(--tab-active-text)] shadow-sm/10 before:shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] dark:before:shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
                      : 'border-border bg-[var(--tab-inactive-bg)] font-medium text-[var(--tab-inactive-text)] shadow-xs/5 before:shadow-[0_1px_--theme(--color-black/4%)] hover:bg-[var(--tab-inactive-hover-bg)] hover:text-foreground dark:before:shadow-[0_-1px_--theme(--color-white/6%)]',
                  )}
                  onClick={() => handleTabClick(item.tab)}
                  style={getTabStyle(item)}
                  type="button"
                />
              }
            >
              <span className="max-w-full truncate">{item.label}</span>
            </TooltipTrigger>
            {!isTransitioning && (
              <TooltipPopup
                portalProps={{ container: null }}
                side={tooltipSide}
                sideOffset={6}
              >
                {item.label}
              </TooltipPopup>
            )}
          </Tooltip>
        );
      })}

      <Tooltip disabled={isTransitioning}>
        <TooltipTrigger
          render={
            <button
              aria-label="新建便签页签"
              className={cn(
                'side-tab-item side-tab-add relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center overflow-hidden border border-border bg-[var(--tab-inactive-bg)] not-dark:bg-clip-padding text-[var(--tab-inactive-text)] shadow-xs/5 outline-none before:pointer-events-none before:absolute before:inset-0 before:shadow-[0_1px_--theme(--color-black/4%)] hover:bg-[var(--tab-inactive-hover-bg)] hover:text-foreground focus-visible:z-20 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]',
                orientationShapeClass,
                'min-h-8 py-1.5',
              )}
              onClick={handleQuickCreateNote}
              style={
                orientation === 'top'
                  ? { width: 34, padding: '5px 0' }
                  : {
                      width: device.tabWidthMode === 'uniform' ? uniformW : 52,
                    }
              }
              type="button"
            />
          }
        >
          <PlusIcon aria-hidden="true" className="size-4 opacity-80" strokeWidth={1.85} />
        </TooltipTrigger>
        {!isTransitioning && (
          <TooltipPopup
            portalProps={{ container: null }}
            side={tooltipSide}
            sideOffset={6}
          >
            新建便签页签
          </TooltipPopup>
        )}
      </Tooltip>
    </aside>
  );
};
