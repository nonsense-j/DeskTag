import { PlusIcon } from 'lucide-react';
import React from 'react';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useDeskTagStore, type ActiveTab } from '../store/useDeskTagStore';

interface RailTabItem {
  key: string;
  label: string;
  tab: ActiveTab;
  customWidth: number | null;
}

export const SideTabRail: React.FC = () => {
  const {
    activeLists,
    activeNotes,
    activeTab,
    device,
    dock,
    setActiveTab,
    addNote,
    expandPanel,
  } = useDeskTagStore();

  const orientation: 'left' | 'right' | 'top' = dock.mode.startsWith('left_')
    ? 'right'
    : dock.mode.startsWith('top_')
      ? 'top'
      : 'left';

  const isCollapsedOnly = dock.collapsed && dock.mode.endsWith('_tabs');

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
    const uniformW = Math.max(64, Math.min(110, device.uniformTabWidth || 68));
    if (device.tabWidthMode === 'uniform') {
      return { width: uniformW };
    }
    if (device.tabWidthMode === 'individual' && item.customWidth) {
      return { width: Math.max(52, Math.min(120, item.customWidth)) };
    }
    return { minWidth: 58, maxWidth: 112 };
  };

  const handleTabClick = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (dock.collapsed) {
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
    if (dock.collapsed) {
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
          <Tooltip key={item.key}>
            <TooltipTrigger
              render={
                <button
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center overflow-hidden whitespace-nowrap border not-dark:bg-clip-padding text-xs leading-tight tracking-tight transition-[background-color,color,box-shadow,border-color] duration-150 outline-none before:pointer-events-none before:absolute before:inset-0 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                    orientationShapeClass,
                    active
                      ? 'z-10 border-transparent bg-[var(--tab-active-bg)] font-semibold text-[var(--tab-active-text)] shadow-sm/10 before:shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] dark:before:shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
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
            <TooltipPopup
              portalProps={{ container: null }}
              side={tooltipSide}
              sideOffset={6}
            >
              {item.label}
            </TooltipPopup>
          </Tooltip>
        );
      })}

      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label="新建便签页签"
              className={cn(
                'relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center overflow-hidden border border-border bg-[var(--tab-inactive-bg)] not-dark:bg-clip-padding text-[var(--tab-inactive-text)] shadow-xs/5 transition-[background-color,color,box-shadow] duration-150 outline-none before:pointer-events-none before:absolute before:inset-0 before:shadow-[0_1px_--theme(--color-black/4%)] hover:bg-[var(--tab-inactive-hover-bg)] hover:text-foreground focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background dark:before:shadow-[0_-1px_--theme(--color-white/6%)]',
                orientationShapeClass,
                'min-h-8 py-1.5',
              )}
              onClick={handleQuickCreateNote}
              style={
                orientation === 'top'
                  ? { width: 34, padding: '5px 0' }
                  : {
                      width:
                        device.tabWidthMode === 'uniform'
                          ? Math.max(48, Math.min(110, device.uniformTabWidth || 66))
                          : 52,
                    }
              }
              type="button"
            />
          }
        >
          <PlusIcon aria-hidden="true" className="size-4 opacity-80" strokeWidth={1.85} />
        </TooltipTrigger>
        <TooltipPopup
          portalProps={{ container: null }}
          side={tooltipSide}
          sideOffset={6}
        >
          新建便签页签
        </TooltipPopup>
      </Tooltip>
    </aside>
  );
};
