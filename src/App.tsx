import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { isTauriRuntime } from './api/tauri';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  ArrowLeftIcon,
  CalendarIcon,
  CloseIcon,
  ListIcon,
  PlusIcon,
  QuadrantIcon,
} from './components/Icons';
import { ListManagerModal } from './components/ListManagerModal';
import { MobileBottomNav, MobileTopHeader } from './components/MobileNav';
import { PanelHeader } from './components/PanelHeader';
import { ReminderModal } from './components/ReminderModal';
import { SideTabRail } from './components/SideTabRail';
import { TodoDetailModal } from './components/TodoDetailModal';
import { TodoView } from './components/TodoView';
import { DeskTagProvider, useDeskTagStore } from './store/useDeskTagStore';

const CalendarView = lazy(() => import('./components/CalendarView'));
const NoteLibraryView = lazy(() => import('./components/NoteLibraryView'));
const NoteView = lazy(() => import('./components/NoteView'));
const QuadrantView = lazy(() => import('./components/QuadrantView'));
const SearchVoiceModals = lazy(() => import('./components/SearchVoiceModals'));
const SettingsModal = lazy(() => import('./components/SettingsModal'));

type WindowRoute =
  | { kind: 'main' }
  | { kind: 'calendar' }
  | { kind: 'note'; noteId: string };

function parseWindowRoute(): WindowRoute {
  if (typeof window === 'undefined') return { kind: 'main' };
  const params = new URLSearchParams(window.location.search);
  const win = params.get('window');
  if (win === 'calendar') return { kind: 'calendar' };
  if (win === 'note') {
    const noteId = params.get('noteId') ?? '';
    return { kind: 'note', noteId };
  }
  return { kind: 'main' };
}

/**
 * Lightweight draggable + closeable fallback bar used for frameless standalone
 * windows (`calendar`, `note-*`) while hydrating state or loading lazy chunks.
 */
const StandaloneLoadingFallback: React.FC<{ title: string }> = ({ title }) => {
  const handleClose = async () => {
    if (isTauriRuntime()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
        return;
      } catch {
        // Fallback below
      }
    }
    window.close();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-panel)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
      }}
    >
      <header
        data-tauri-drag-region
        style={{
          height: 40,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px 0 14px',
          background: 'var(--bg-header)',
          borderBottom: '1px solid var(--border)',
          userSelect: 'none',
        }}
      >
        <span data-tauri-drag-region style={{ fontWeight: 600, fontSize: 13.5 }}>
          {title}
        </span>
        <button
          type="button"
          title="关闭窗口"
          aria-label="关闭窗口"
          onClick={() => void handleClose()}
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
          <CloseIcon size={14} />
        </button>
      </header>
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
      >
        正在加载…
      </div>
    </div>
  );
};

const DeskTagShell: React.FC = () => {
  const {
    loading,
    device,
    dock,
    isMobileLayout,
    activeTab,
    activeLists,
    activeNotes,
    showQuadrant,
    mobileSection,
    mobileViewsSubTab,
    editingTodoId,
    reminderTodoId,
    showListManager,
    showSettings,
    showSearch,
    showVoiceModal,
    toastMessage,
    webdavStatus,
    updateResult,
    updateBannerDismissed,
    hasUnignoredUpdate,
    setActiveTab,
    setMobileSection,
    setMobileViewsSubTab,
    setEditingTodoId,
    setReminderTodoId,
    setShowListManager,
    setShowSettings,
    setShowSearch,
    setShowVoiceModal,
    closeAllPopovers,
    triggerWebdavSyncNow,
    refreshWebdav,
    checkForUpdates,
    skipUpdateVersion,
    dismissUpdateBanner,
  } = useDeskTagStore();

  const route = useMemo(() => parseWindowRoute(), []);

  // Settings initial tab override (e.g. jump directly to About from update banner / menu)
  const [settingsInitialTab, setSettingsInitialTab] = useState<'about' | undefined>(undefined);

  // Mobile lists selection + pull-to-sync state
  const [mobileListId, setMobileListId] = useState<string | null>(null);
  const [pullOffset, setPullOffset] = useState(0);
  const touchStartYRef = useRef<number | null>(null);
  const mobileBodyRef = useRef<HTMLDivElement | null>(null);
  const startupUpdateCheckedRef = useRef(false);

  // Reset initialTab override once Settings closes
  useEffect(() => {
    const settingsVisible = showSettings || (isMobileLayout && mobileSection === 'settings');
    if (!settingsVisible && settingsInitialTab !== undefined) {
      setSettingsInitialTab(undefined);
    }
  }, [showSettings, isMobileLayout, mobileSection, settingsInitialTab]);

  // 4-second delayed silent startup update check on the main window only (once per session)
  useEffect(() => {
    if (route.kind !== 'main' || loading || startupUpdateCheckedRef.current) return;
    if (device.autoCheckUpdates === false) return;
    const timer = window.setTimeout(() => {
      if (startupUpdateCheckedRef.current) return;
      startupUpdateCheckedRef.current = true;
      void checkForUpdates({ force: false, silent: true });
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [route.kind, loading, device.autoCheckUpdates, checkForUpdates]);

  // Keep mobileListId valid if lists change
  useEffect(() => {
    if (mobileListId && !activeLists.some((l) => l.id === mobileListId)) {
      setMobileListId(activeLists[0]?.id ?? null);
    } else if (!mobileListId && activeLists.length > 0) {
      setMobileListId(activeLists[0].id);
    }
  }, [activeLists, mobileListId]);

  // Global keyboard shortcuts: Ctrl/Cmd+K for Search, Escape to close active modals/popovers
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearch(!showSearch);
        return;
      }

      if (e.key === 'Escape') {
        if (showSearch) {
          setShowSearch(false);
        } else if (showVoiceModal) {
          setShowVoiceModal(false);
        } else if (reminderTodoId) {
          setReminderTodoId(null);
        } else if (editingTodoId) {
          setEditingTodoId(null);
        } else if (showListManager) {
          setShowListManager(false);
        } else if (showSettings) {
          setShowSettings(false);
        } else {
          closeAllPopovers();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    showSearch,
    showVoiceModal,
    reminderTodoId,
    editingTodoId,
    showListManager,
    showSettings,
    setShowSearch,
    setShowVoiceModal,
    setReminderTodoId,
    setEditingTodoId,
    setShowListManager,
    setShowSettings,
    closeAllPopovers,
  ]);

  // Android / resume visibility sync refresh
  useEffect(() => {
    const onVisChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshWebdav();
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [refreshWebdav]);

  const handleOpenSettingsAbout = () => {
    setSettingsInitialTab('about');
    if (isMobileLayout) {
      setShowSettings(false, 'about');
      setMobileSection('settings');
    } else {
      setShowSettings(true, 'about');
    }
  };

  // Loading placeholder
  if (loading) {
    if (route.kind === 'calendar') {
      return <StandaloneLoadingFallback title="日历视图" />;
    }
    if (route.kind === 'note') {
      return <StandaloneLoadingFallback title="独立便签" />;
    }
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-panel)',
          color: 'var(--text-muted)',
          borderRadius: isMobileLayout ? 0 : 14,
          border: isMobileLayout ? 'none' : '1px solid var(--border)',
          fontSize: 13,
        }}
      >
        正在加载 DeskTag…
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Route 1: Standalone Calendar Window (?window=calendar)
  // -------------------------------------------------------------------------
  if (route.kind === 'calendar') {
    return (
      <ErrorBoundary route="calendar" title="DeskTag — 日历视图">
        <Suspense fallback={<StandaloneLoadingFallback title="日历视图" />}>
          <CalendarView standalone />
        </Suspense>
        <TodoDetailModal />
        <ReminderModal />
        {toastMessage && <div className="desktag-toast">{toastMessage}</div>}
      </ErrorBoundary>
    );
  }

  // -------------------------------------------------------------------------
  // Route 2: Standalone Pop-Out Note Window (?window=note&noteId=...)
  // -------------------------------------------------------------------------
  if (route.kind === 'note') {
    const resolvedNoteId = route.noteId || activeNotes[0]?.id || '';
    return (
      <ErrorBoundary route="note" title="DeskTag — 独立便签">
        <Suspense fallback={<StandaloneLoadingFallback title="独立便签" />}>
          <NoteView noteId={resolvedNoteId} standalone />
        </Suspense>
        <TodoDetailModal />
        <ReminderModal />
        {toastMessage && <div className="desktag-toast">{toastMessage}</div>}
      </ErrorBoundary>
    );
  }

  // Shared non-intrusive update banner (shown at top of panel body when an unignored update exists)
  const updateBannerNode =
    hasUnignoredUpdate && !updateBannerDismissed && updateResult ? (
      <div className="dt-update-banner" role="status" aria-live="polite">
        <span className="dt-update-banner-text">发现新版本 v{updateResult.latestVersion}</span>
        <div className="dt-update-banner-actions">
          <button
            type="button"
            className="dt-btn dt-btn-primary dt-btn-xs"
            onClick={handleOpenSettingsAbout}
          >
            查看更新
          </button>
          <button
            type="button"
            className="dt-link-btn"
            onClick={() => void skipUpdateVersion(updateResult.latestVersion)}
          >
            跳过此版本
          </button>
          <button
            type="button"
            className="dt-icon-btn-xs"
            title="暂不提示"
            aria-label="关闭更新提示"
            onClick={dismissUpdateBanner}
          >
            ×
          </button>
        </div>
      </div>
    ) : null;

  // -------------------------------------------------------------------------
  // Route 3: Mobile / Android Touch-First Shell
  // -------------------------------------------------------------------------
  if (isMobileLayout) {
    const pinnedNotes = activeNotes.filter((n) => n.pinnedToSide);
    const activeMobileNoteId = activeTab.kind === 'note' ? activeTab.noteId : null;

    const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
      if ((mobileBodyRef.current?.scrollTop ?? 0) <= 0 && e.touches.length === 1) {
        touchStartYRef.current = e.touches[0].clientY;
      } else {
        touchStartYRef.current = null;
      }
    };

    const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
      if (touchStartYRef.current === null || e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - touchStartYRef.current;
      if (dy > 0 && dy < 110) {
        setPullOffset(Math.round(dy * 0.55));
      }
    };

    const handleTouchEnd = () => {
      if (pullOffset >= 44 && webdavStatus.configured) {
        void triggerWebdavSyncNow();
      }
      touchStartYRef.current = null;
      setPullOffset(0);
    };

    return (
      <div className="desktag-shell is-mobile">
        <MobileTopHeader />

        {pullOffset > 12 && (
          <div
            style={{
              height: Math.min(36, pullOffset),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11.5,
              color: 'var(--accent)',
              background: 'var(--bg-header)',
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
            }}
          >
            {webdavStatus.configured
              ? pullOffset >= 44
                ? '松开立即触发 WebDAV 同步'
                : '下拉同步云端数据…'
              : '可在「设置 → 数据与同步」配置 WebDAV'}
          </div>
        )}

        <div
          ref={mobileBodyRef}
          className="desktag-panel-body"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {updateBannerNode}

          <Suspense fallback={null}>
            {/* Mobile Tab 1: 待办 */}
            {mobileSection === 'todo' && (showQuadrant ? <QuadrantView /> : <TodoView />)}

            {/* Mobile Tab 2: 清单 */}
            {mobileSection === 'lists' && (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 12px',
                    overflowX: 'auto',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--bg-panel)',
                    flexShrink: 0,
                  }}
                >
                  {activeLists.map((list) => {
                    const active = mobileListId === list.id;
                    return (
                      <button
                        key={list.id}
                        type="button"
                        onClick={() => setMobileListId(list.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '5px 11px',
                          borderRadius: 999,
                          border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
                          background: active ? 'var(--pill-active-bg)' : 'var(--bg-surface)',
                          color: active ? 'var(--pill-active-text)' : 'var(--text-secondary)',
                          fontWeight: active ? 600 : 500,
                          fontSize: 12.5,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: list.color,
                          }}
                        />
                        <span>{list.name}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setShowListManager(true)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '5px 10px',
                      borderRadius: 999,
                      border: '1px dashed var(--border-strong)',
                      color: 'var(--text-muted)',
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <PlusIcon size={12} />
                    <span>管理清单</span>
                  </button>
                </div>
                {mobileListId ? (
                  <TodoView listIdOverride={mobileListId} />
                ) : (
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                      color: 'var(--text-muted)',
                      fontSize: 13,
                    }}
                  >
                    <ListIcon size={24} />
                    <span>还没有自定义清单</span>
                    <button
                      type="button"
                      className="dt-btn dt-btn-primary"
                      onClick={() => setShowListManager(true)}
                    >
                      新建清单
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Mobile Tab 3: 便签 */}
            {mobileSection === 'notes' && (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {activeMobileNoteId ? (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '6px 12px',
                        background: 'var(--bg-header)',
                        borderBottom: '1px solid var(--border)',
                        flexShrink: 0,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveTab({ kind: 'note_library' })}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          color: 'var(--accent)',
                          fontSize: 12.5,
                          fontWeight: 600,
                        }}
                      >
                        <ArrowLeftIcon size={14} />
                        <span>返回便签库</span>
                      </button>
                    </div>
                    <NoteView noteId={activeMobileNoteId} />
                  </>
                ) : (
                  <>
                    {pinnedNotes.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '8px 12px 4px',
                          overflowX: 'auto',
                          flexShrink: 0,
                        }}
                      >
                        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          置顶：
                        </span>
                        {pinnedNotes.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => setActiveTab({ kind: 'note', noteId: n.id })}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 999,
                              border: '1px solid var(--accent-border)',
                              background: 'var(--accent-soft)',
                              color: 'var(--accent-soft-text)',
                              fontSize: 12,
                              fontWeight: 500,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {n.title || '便签'}
                          </button>
                        ))}
                      </div>
                    )}
                    <NoteLibraryView
                      onOpenNote={(id) => setActiveTab({ kind: 'note', noteId: id })}
                    />
                  </>
                )}
              </div>
            )}

            {/* Mobile Tab 4: 视图 (Calendar + Quadrants) */}
            {mobileSection === 'views' && (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--bg-header)',
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      display: 'inline-flex',
                      padding: 2,
                      borderRadius: 9,
                      background: 'var(--bg-panel)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setMobileViewsSubTab('calendar')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '4px 14px',
                        borderRadius: 7,
                        background:
                          mobileViewsSubTab === 'calendar' ? 'var(--pill-active-bg)' : 'transparent',
                        color:
                          mobileViewsSubTab === 'calendar'
                            ? 'var(--pill-active-text)'
                            : 'var(--text-secondary)',
                        fontWeight: mobileViewsSubTab === 'calendar' ? 600 : 500,
                        fontSize: 12.5,
                      }}
                    >
                      <CalendarIcon size={13} />
                      <span>日历视图</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileViewsSubTab('quadrant')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '4px 14px',
                        borderRadius: 7,
                        background:
                          mobileViewsSubTab === 'quadrant' ? 'var(--pill-active-bg)' : 'transparent',
                        color:
                          mobileViewsSubTab === 'quadrant'
                            ? 'var(--pill-active-text)'
                            : 'var(--text-secondary)',
                        fontWeight: mobileViewsSubTab === 'quadrant' ? 600 : 500,
                        fontSize: 12.5,
                      }}
                    >
                      <QuadrantIcon size={13} />
                      <span>四象限</span>
                    </button>
                  </div>
                </div>

                {mobileViewsSubTab === 'calendar' ? <CalendarView /> : <QuadrantView embedded />}
              </div>
            )}

            {/* Mobile Tab 5: 设置 (Inline Settings with WebDAV 1-paste setup) */}
            {mobileSection === 'settings' && (
              <SettingsModal inline initialTab={settingsInitialTab} />
            )}
          </Suspense>
        </div>

        <MobileBottomNav />

        {/* Shared Modals */}
        <TodoDetailModal />
        <ReminderModal />
        <ListManagerModal />
        {(showSearch || showVoiceModal) && (
          <Suspense fallback={null}>
            <SearchVoiceModals />
          </Suspense>
        )}
        {mobileSection !== 'settings' && showSettings && (
          <Suspense fallback={null}>
            <SettingsModal initialTab={settingsInitialTab} />
          </Suspense>
        )}
        {toastMessage && <div className="desktag-toast">{toastMessage}</div>}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Route 4: Desktop Edge-Docked Main Panel Shell
  // -------------------------------------------------------------------------
  const dockDirectionClass = dock.mode.startsWith('left_')
    ? 'dock-left'
    : dock.mode.startsWith('top_')
      ? 'dock-top'
      : 'dock-right';

  const isCollapsedTabsOnly = dock.collapsed && dock.mode.endsWith('_tabs');

  return (
    <div
      className={`desktag-shell ${dockDirectionClass}${isCollapsedTabsOnly ? ' is-collapsed' : ''}`}
    >
      {/* Protruding Folder-Style Side Tab Rail */}
      <SideTabRail />

      {/* Main Rounded Panel Card (hidden smoothly when collapsed to protruding tabs only) */}
      {!isCollapsedTabsOnly && (
        <main className="desktag-panel-card">
          <PanelHeader onOpenSettingsAbout={handleOpenSettingsAbout} />

          <div className="desktag-panel-body">
            {updateBannerNode}

            <Suspense fallback={null}>
              {showQuadrant ? (
                <QuadrantView />
              ) : activeTab.kind === 'todo' ? (
                <TodoView />
              ) : activeTab.kind === 'list' ? (
                <TodoView listIdOverride={activeTab.listId} />
              ) : activeTab.kind === 'note' ? (
                <NoteView noteId={activeTab.noteId} />
              ) : (
                <NoteLibraryView />
              )}
            </Suspense>
          </div>
        </main>
      )}

      {/* Modals & Toast */}
      <TodoDetailModal />
      <ReminderModal />
      <ListManagerModal />
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal initialTab={settingsInitialTab} />
        </Suspense>
      )}
      {(showSearch || showVoiceModal) && (
        <Suspense fallback={null}>
          <SearchVoiceModals />
        </Suspense>
      )}
      {toastMessage && <div className="desktag-toast">{toastMessage}</div>}
    </div>
  );
};

export default function App() {
  const route = useMemo(() => parseWindowRoute(), []);
  return (
    <ErrorBoundary route={route.kind}>
      <DeskTagProvider>
        <DeskTagShell />
      </DeskTagProvider>
    </ErrorBoundary>
  );
}
