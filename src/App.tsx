import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  CalendarIcon,
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

/**
 * Scoped styles for DeskTag's view components (SettingsModal, WebDavSyncCard,
 * CalendarView, QuadrantView) harmonized 100% with the 11 Daibantie CSS tokens.
 */
const DT_VIEW_STYLES = `
.dt-settings-card {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-header);
  display: flex;
  flex-direction: column;
}
.dt-settings-card-title {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--text-primary);
}
.dt-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
}
.dt-setting-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
}
.dt-setting-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
  line-height: 1.45;
}
.dt-setting-divider {
  height: 1px;
  background: var(--border);
  margin: 10px 0;
}

/* Buttons */
.dt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 13px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 600;
  border: 1px solid transparent;
  transition: background-color 0.14s ease, border-color 0.14s ease, opacity 0.14s ease;
  white-space: nowrap;
  cursor: pointer;
}
.dt-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dt-btn-xs {
  padding: 4px 9px;
  font-size: 11.5px;
  border-radius: 7px;
}
.dt-btn-primary {
  background: var(--accent);
  color: var(--accent-text);
}
.dt-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}
.dt-btn-soft {
  background: var(--accent-soft);
  color: var(--accent-soft-text);
  border-color: var(--accent-border);
}
.dt-btn-soft:hover:not(:disabled) {
  filter: brightness(0.97);
}
.dt-btn-ghost {
  background: var(--bg-surface);
  color: var(--text-secondary);
  border-color: var(--border);
}
.dt-btn-ghost:hover:not(:disabled) {
  background: var(--bg-surface-hover);
  color: var(--text-primary);
}
.dt-btn-danger {
  background: var(--danger);
  color: #ffffff;
}
.dt-btn-danger-soft {
  background: var(--danger-soft);
  color: var(--danger);
  border-color: rgba(217, 77, 74, 0.35);
}
.dt-link-btn {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 11.5px;
  cursor: pointer;
  padding: 0;
}
.dt-icon-btn-xs {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  cursor: pointer;
  flex-shrink: 0;
}
.dt-icon-btn-xs:hover {
  background: var(--bg-surface-hover);
  color: var(--text-primary);
}

/* Inputs & Selects */
.dt-input,
.dt-select,
.dt-textarea {
  width: 100%;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: 12.5px;
  line-height: 1.45;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}
.dt-select {
  width: auto;
  min-width: 132px;
  cursor: pointer;
}
.dt-input:focus,
.dt-select:focus,
.dt-textarea:focus {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.dt-input.is-error {
  border-color: var(--danger);
}
.dt-input-with-action {
  position: relative;
  display: flex;
  align-items: center;
}
.dt-input-with-action .dt-input {
  padding-right: 36px;
}
.dt-input-eye {
  position: absolute;
  right: 6px;
  padding: 2px 6px;
  border-radius: 5px;
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}
.dt-input-eye:hover {
  background: var(--bg-surface-hover);
  color: var(--text-primary);
}

/* WebDAV Sync Card */
.dt-webdav-card {
  gap: 10px;
}
.dt-webdav-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.dt-webdav-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.dt-webdav-title-row {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}
.dt-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.dt-status-dot.is-pulsing {
  animation: dt-pulse 1.1s ease-in-out infinite;
}
@keyframes dt-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.82); }
}
.dt-e2ee-badge,
.dt-e2ee-badge-inline {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--accent-soft-text);
  font-size: 10.5px;
  font-weight: 600;
}
.dt-e2ee-badge-inline {
  margin-left: 6px;
}
.dt-webdav-subtitle {
  font-size: 12px;
  color: var(--text-muted);
  padding-left: 15px;
}
.dt-webdav-meta-sep {
  color: var(--text-muted);
  font-size: 11.5px;
}
.dt-webdav-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dt-webdav-banner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 9px;
  font-size: 12px;
  line-height: 1.5;
  flex-wrap: wrap;
}
.dt-webdav-banner.is-info {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text-secondary);
}
.dt-webdav-banner.is-success {
  background: rgba(91, 140, 90, 0.12);
  border: 1px solid rgba(91, 140, 90, 0.35);
  color: var(--success);
}
.dt-webdav-banner.is-warning {
  background: rgba(212, 154, 53, 0.12);
  border: 1px solid rgba(212, 154, 53, 0.38);
  color: var(--text-primary);
}
.dt-webdav-banner.is-error {
  background: var(--danger-soft);
  border: 1px solid rgba(217, 77, 74, 0.35);
  color: var(--danger);
}
.dt-webdav-banner-body {
  flex: 1;
  min-width: 180px;
}
.dt-webdav-banner-hint {
  font-size: 11.5px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.dt-webdav-banner-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.dt-webdav-form {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.dt-webdav-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}
.dt-field-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.dt-field-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
}
.dt-field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dt-field-hint {
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.45;
}
.dt-field-error {
  font-size: 11.5px;
  color: var(--danger);
  line-height: 1.45;
  font-weight: 500;
}
.dt-preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dt-chip {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.14s ease;
}
.dt-chip:hover {
  border-color: var(--accent-border);
  color: var(--text-primary);
}
.dt-chip.is-active {
  background: var(--pill-active-bg);
  border-color: var(--accent-border);
  color: var(--pill-active-text);
  font-weight: 600;
}
.dt-form-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.dt-form-grid-2-1 {
  display: grid;
  grid-template-columns: minmax(0, 2.2fr) minmax(0, 1fr);
  gap: 10px;
}
.dt-webdav-options-grid {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
}
.dt-check-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  font-size: 12.5px;
}
.dt-check-row input {
  margin-top: 3px;
}
.dt-check-row span {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dt-check-row small {
  font-size: 11.5px;
  color: var(--text-muted);
}
.dt-webdav-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dt-webdav-test-result {
  padding: 9px 11px;
  border-radius: 9px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.dt-webdav-test-result.is-ok {
  background: rgba(91, 140, 90, 0.11);
  border: 1px solid rgba(91, 140, 90, 0.35);
}
.dt-webdav-test-result.is-fail {
  background: var(--danger-soft);
  border: 1px solid rgba(217, 77, 74, 0.35);
}
.dt-webdav-test-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
  flex-wrap: wrap;
}
.dt-webdav-latency {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary);
}
.dt-webdav-test-msg {
  color: var(--text-secondary);
  word-break: break-word;
}
.dt-suggested-url-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 5px;
  border-top: 1px dashed var(--border-strong);
}
.dt-suggested-url-row code {
  font-size: 11.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-surface);
}
.dt-webdav-preview-box {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bg-surface);
  border: 1px solid var(--accent-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dt-webdav-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
}
.dt-webdav-preview-stats {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.dt-stat-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
}
.dt-stat-pill.is-up {
  background: var(--accent-soft);
  color: var(--accent-soft-text);
}
.dt-stat-pill.is-down {
  background: rgba(91, 140, 90, 0.14);
  color: var(--success);
}
.dt-stat-pill.is-conflict {
  background: var(--danger-soft);
  color: var(--danger);
}
.dt-webdav-preview-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 150px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dt-webdav-preview-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.dt-diff-tag {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 5px;
  font-weight: 600;
  flex-shrink: 0;
}
.dt-diff-tag.is-up { background: var(--accent-soft); color: var(--accent-soft-text); }
.dt-diff-tag.is-down { background: rgba(91, 140, 90, 0.15); color: var(--success); }
.dt-diff-tag.is-conflict { background: var(--danger-soft); color: var(--danger); }
.dt-diff-tag.is-muted { background: var(--tag-bg); color: var(--text-muted); }
.dt-diff-type {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.dt-diff-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dt-diff-more {
  font-size: 11.5px;
  color: var(--text-muted);
}
.dt-webdav-preview-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
.dt-webdav-preview-btns {
  display: flex;
  gap: 6px;
}
.dt-webdav-advanced {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px dashed var(--border-strong);
}
.dt-webdav-advanced-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dt-setup-box {
  padding: 9px 10px;
  border-radius: 9px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.dt-setup-textarea {
  font-family: monospace;
  font-size: 11.5px;
  resize: vertical;
}
.dt-import-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.dt-inline-confirm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}
.dt-inline-confirm-btns {
  display: flex;
  gap: 6px;
}

/* Hover Polish */
.dt-cal-todo-item:hover,
.dt-quadrant-task:hover {
  background: var(--bg-surface-hover) !important;
}

@media (max-width: 560px) {
  .dt-form-grid-2,
  .dt-form-grid-2-1 {
    grid-template-columns: 1fr;
  }
  .dt-import-row {
    flex-direction: column;
    align-items: stretch;
  }
}
`;

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

const DeskTagShell: React.FC = () => {
  const {
    loading,
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
    setActiveTab,
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
  } = useDeskTagStore();

  const route = useMemo(() => parseWindowRoute(), []);

  // Mobile lists selection + pull-to-sync state
  const [mobileListId, setMobileListId] = useState<string | null>(null);
  const [pullOffset, setPullOffset] = useState(0);
  const touchStartYRef = useRef<number | null>(null);
  const mobileBodyRef = useRef<HTMLDivElement | null>(null);

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

  // Loading placeholder
  if (loading) {
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
        正在加载 DeskTag 待办贴…
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Route 1: Standalone Calendar Window (?window=calendar)
  // -------------------------------------------------------------------------
  if (route.kind === 'calendar') {
    return (
      <>
        <style>{DT_VIEW_STYLES}</style>
        <Suspense fallback={null}>
          <CalendarView standalone />
        </Suspense>
        <TodoDetailModal />
        <ReminderModal />
        {toastMessage && <div className="desktag-toast">{toastMessage}</div>}
      </>
    );
  }

  // -------------------------------------------------------------------------
  // Route 2: Standalone Pop-Out Note Window (?window=note&noteId=...)
  // -------------------------------------------------------------------------
  if (route.kind === 'note') {
    const resolvedNoteId = route.noteId || activeNotes[0]?.id || '';
    return (
      <>
        <style>{DT_VIEW_STYLES}</style>
        <Suspense fallback={null}>
          <NoteView noteId={resolvedNoteId} standalone />
        </Suspense>
        <TodoDetailModal />
        <ReminderModal />
        {toastMessage && <div className="desktag-toast">{toastMessage}</div>}
      </>
    );
  }

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
        <style>{DT_VIEW_STYLES}</style>
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
            {mobileSection === 'settings' && <SettingsModal inline />}
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
            <SettingsModal />
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
      <style>{DT_VIEW_STYLES}</style>

      {/* Protruding Folder-Style Side Tab Rail */}
      <SideTabRail />

      {/* Main Rounded Panel Card (hidden smoothly when collapsed to protruding tabs only) */}
      {!isCollapsedTabsOnly && (
        <main className="desktag-panel-card">
          <PanelHeader />

          <div className="desktag-panel-body">
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
          <SettingsModal />
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
  return (
    <DeskTagProvider>
      <DeskTagShell />
    </DeskTagProvider>
  );
}
