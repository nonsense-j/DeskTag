import {
  ArrowLeftIcon,
  CalendarIcon,
  LayoutGridIcon,
  ListTodoIcon,
  PlusIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { isTauriRuntime } from './api/tauri';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ListManagerModal } from './components/ListManagerModal';
import { MobileBottomNav, MobileTopHeader } from './components/MobileNav';
import { PanelHeader } from './components/PanelHeader';
import { PortalProvider } from './components/PortalContext';
import { ReminderModal } from './components/ReminderModal';
import { SideTabRail } from './components/SideTabRail';
import { TodoDetailModal } from './components/TodoDetailModal';
import { TodoView } from './components/TodoView';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Empty, EmptyContent, EmptyMedia, EmptyTitle } from './components/ui/empty';
import { SegmentedControl, SegmentedControlItem } from './components/ui/segmented-control';
import { Spinner } from './components/ui/spinner';
import { AnchoredToastProvider, ToastProvider } from './components/ui/toast';
import { TooltipProvider } from './components/ui/tooltip';
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
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
      <header
        data-tauri-drag-region
        className="flex h-10 shrink-0 select-none items-center justify-between border-b bg-sidebar px-3"
      >
        <span data-tauri-drag-region className="font-semibold text-sm text-foreground">
          {title}
        </span>
        <Button
          aria-label="关闭窗口"
          onClick={() => void handleClose()}
          size="icon-xs"
          title="关闭窗口"
          variant="ghost"
        >
          <XIcon aria-hidden="true" />
        </Button>
      </header>
      <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm">
        <Spinner className="size-4" />
        <span>正在加载…</span>
      </div>
    </div>
  );
};

const FloatingToastPill: React.FC<{ message: string | null }> = ({ message }) => {
  if (!message) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute bottom-3 left-1/2 z-60 max-w-[calc(100%-24px)] -translate-x-1/2 truncate rounded-lg border bg-popover not-dark:bg-clip-padding px-3 py-1.5 font-medium text-popover-foreground text-xs shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
      role="status"
    >
      {message}
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

  // Scoped shell portal container (keeps Base UI overlays clipped cleanly inside rounded frameless window)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

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
        className={
          isMobileLayout
            ? 'flex h-full w-full items-center justify-center gap-2 bg-background text-muted-foreground text-sm'
            : 'flex h-full w-full items-center justify-center gap-2 rounded-[var(--radius-panel)] border bg-background text-muted-foreground text-sm shadow-xs/5'
        }
      >
        <Spinner className="size-4" />
        <span>正在加载 DeskTag…</span>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Route 1: Standalone Calendar Window (?window=calendar)
  // -------------------------------------------------------------------------
  if (route.kind === 'calendar') {
    return (
      <ErrorBoundary route="calendar" title="DeskTag — 日历视图">
        <div
          ref={setPortalContainer}
          className="isolate relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground"
        >
          <PortalProvider container={portalContainer}>
            <ToastProvider>
              <AnchoredToastProvider>
                <Suspense fallback={<StandaloneLoadingFallback title="日历视图" />}>
                  <CalendarView standalone />
                </Suspense>
                <TodoDetailModal />
                <ReminderModal />
                <FloatingToastPill message={toastMessage} />
              </AnchoredToastProvider>
            </ToastProvider>
          </PortalProvider>
        </div>
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
        <div
          ref={setPortalContainer}
          className="isolate relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground"
        >
          <PortalProvider container={portalContainer}>
            <ToastProvider>
              <AnchoredToastProvider>
                <Suspense fallback={<StandaloneLoadingFallback title="独立便签" />}>
                  <NoteView noteId={resolvedNoteId} standalone />
                </Suspense>
                <TodoDetailModal />
                <ReminderModal />
                <FloatingToastPill message={toastMessage} />
              </AnchoredToastProvider>
            </ToastProvider>
          </PortalProvider>
        </div>
      </ErrorBoundary>
    );
  }

  // Shared non-intrusive update banner (coss ui styled)
  const updateBannerNode =
    hasUnignoredUpdate && !updateBannerDismissed && updateResult ? (
      <div
        aria-live="polite"
        className="flex shrink-0 items-center justify-between gap-2 border-b bg-sidebar px-3 py-1.5 text-xs"
        role="status"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <SparklesIcon aria-hidden="true" className="size-3.5 shrink-0 text-primary opacity-80" />
          <span className="truncate font-medium text-foreground">发现新版本</span>
          <Badge size="sm" variant="info">
            v{updateResult.latestVersion}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button onClick={handleOpenSettingsAbout} size="xs" variant="default">
            查看更新
          </Button>
          <Button
            onClick={() => void skipUpdateVersion(updateResult.latestVersion)}
            size="xs"
            variant="ghost"
          >
            跳过
          </Button>
          <Button
            aria-label="关闭更新提示"
            onClick={dismissUpdateBanner}
            size="icon-xs"
            title="暂不提示"
            variant="ghost"
          >
            <XIcon aria-hidden="true" />
          </Button>
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
      <div
        ref={setPortalContainer}
        className="desktag-shell is-mobile isolate relative overflow-hidden"
      >
        <PortalProvider container={portalContainer}>
          <ToastProvider>
            <AnchoredToastProvider>
              <MobileTopHeader />

              {pullOffset > 12 && (
                <div
                  className="flex shrink-0 items-center justify-center border-b bg-sidebar font-medium text-primary text-xs"
                  style={{ height: Math.min(36, pullOffset) }}
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
                    <div className="flex min-h-0 flex-1 flex-col">
                      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b bg-background px-3 py-2">
                        {activeLists.map((list) => {
                          const active = mobileListId === list.id;
                          return (
                            <Button
                              key={list.id}
                              onClick={() => setMobileListId(list.id)}
                              size="xs"
                              variant={active ? 'default' : 'outline'}
                            >
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{ backgroundColor: list.color }}
                              />
                              <span>{list.name}</span>
                            </Button>
                          );
                        })}
                        <Button
                          className="border-dashed text-muted-foreground"
                          onClick={() => setShowListManager(true)}
                          size="xs"
                          variant="outline"
                        >
                          <PlusIcon aria-hidden="true" />
                          <span>管理清单</span>
                        </Button>
                      </div>
                      {mobileListId ? (
                        <TodoView listIdOverride={mobileListId} />
                      ) : (
                        <Empty>
                          <EmptyMedia variant="icon">
                            <ListTodoIcon aria-hidden="true" />
                          </EmptyMedia>
                          <EmptyTitle className="text-base">还没有自定义清单</EmptyTitle>
                          <EmptyContent>
                            <Button onClick={() => setShowListManager(true)} size="sm">
                              <PlusIcon aria-hidden="true" />
                              新建清单
                            </Button>
                          </EmptyContent>
                        </Empty>
                      )}
                    </div>
                  )}

                  {/* Mobile Tab 3: 便签 */}
                  {mobileSection === 'notes' && (
                    <div className="flex min-h-0 flex-1 flex-col">
                      {activeMobileNoteId ? (
                        <>
                          <div className="flex shrink-0 items-center border-b bg-sidebar px-2.5 py-1.5">
                            <Button
                              onClick={() => setActiveTab({ kind: 'note_library' })}
                              size="xs"
                              variant="ghost"
                            >
                              <ArrowLeftIcon aria-hidden="true" />
                              <span>返回便签库</span>
                            </Button>
                          </div>
                          <NoteView noteId={activeMobileNoteId} />
                        </>
                      ) : (
                        <>
                          {pinnedNotes.length > 0 && (
                            <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 pt-2 pb-1">
                              <span className="shrink-0 text-muted-foreground text-xs">置顶：</span>
                              {pinnedNotes.map((n) => (
                                <Badge
                                  key={n.id}
                                  render={
                                    <button
                                      onClick={() => setActiveTab({ kind: 'note', noteId: n.id })}
                                      type="button"
                                    />
                                  }
                                  variant="outline"
                                >
                                  {n.title || '便签'}
                                </Badge>
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
                    <div className="flex min-h-0 flex-1 flex-col">
                      <div className="flex shrink-0 justify-center border-b bg-sidebar px-3 py-2">
                        <SegmentedControl render={<nav aria-label="视图切换" />} size="sm">
                          <SegmentedControlItem
                            aria-current={mobileViewsSubTab === 'calendar' ? 'page' : undefined}
                            onClick={() => setMobileViewsSubTab('calendar')}
                          >
                            <CalendarIcon aria-hidden="true" />
                            <span>日历视图</span>
                          </SegmentedControlItem>
                          <SegmentedControlItem
                            aria-current={mobileViewsSubTab === 'quadrant' ? 'page' : undefined}
                            onClick={() => setMobileViewsSubTab('quadrant')}
                          >
                            <LayoutGridIcon aria-hidden="true" />
                            <span>四象限</span>
                          </SegmentedControlItem>
                        </SegmentedControl>
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
              <FloatingToastPill message={toastMessage} />
            </AnchoredToastProvider>
          </ToastProvider>
        </PortalProvider>
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
      {/* Protruding Folder-Style Side Tab Rail (outside PortalProvider so tab tooltips/menus are not clipped) */}
      <SideTabRail />

      {/* Main Rounded Panel Card + Scoped Overlay Portal Container */}
      <PortalProvider container={portalContainer}>
        <ToastProvider>
          <AnchoredToastProvider>
            {!isCollapsedTabsOnly && (
              <main
                ref={setPortalContainer}
                className="desktag-panel-card isolate relative overflow-hidden"
              >
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

                <FloatingToastPill message={toastMessage} />
              </main>
            )}

            {/* Modals (portal cleanly into <main> via PortalProvider) */}
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
          </AnchoredToastProvider>
        </ToastProvider>
      </PortalProvider>
    </div>
  );
};

export default function App() {
  const route = useMemo(() => parseWindowRoute(), []);
  return (
    <ErrorBoundary route={route.kind}>
      <TooltipProvider delay={300}>
        <DeskTagProvider>
          <DeskTagShell />
        </DeskTagProvider>
      </TooltipProvider>
    </ErrorBoundary>
  );
}
