import React from 'react';
import { useDeskTagStore, type ActiveTab } from '../store/useDeskTagStore';
import { PlusIcon } from './Icons';

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

  return (
    <aside
      className={`side-tab-rail orientation-${orientation}${isCollapsedOnly ? ' collapsed-only' : ''}`}
      aria-label="侧边页签栏"
    >
      {tabs.map((item) => {
        const active = isTabActive(item.tab);
        return (
          <button
            key={item.key}
            type="button"
            className={`side-tab-btn${active ? ' active' : ''}`}
            style={getTabStyle(item)}
            onClick={() => handleTabClick(item.tab)}
            title={item.label}
          >
            <span className="side-tab-label">{item.label}</span>
          </button>
        );
      })}

      <button
        type="button"
        className="side-tab-btn add-tab-btn"
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
        onClick={handleQuickCreateNote}
        title="新建便签页签"
        aria-label="新建便签页签"
      >
        <PlusIcon size={15} />
      </button>
    </aside>
  );
};
