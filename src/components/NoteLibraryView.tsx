import React, { useMemo, useState } from 'react';
import { openNoteWindow } from '../api/tauri';
import { useDeskTagStore } from '../store/useDeskTagStore';
import type { NoteGroup, NoteItem, NoteKind } from '../types/models';
import { formatRelativeTime } from '../utils/lunar';
import {
  EditIcon,
  FolderIcon,
  LockIcon,
  NoteIcon,
  PinIcon,
  PlusIcon,
  PopoutIcon,
  SearchIcon,
  TimelineIcon,
  TrashIcon,
  UnlockIcon,
} from './Icons';

export interface NoteLibraryViewProps {
  /** Optional override when selecting a note (e.g. mobile notes drill-down). */
  onOpenNote?: (noteId: string) => void;
}

type KindFilter = 'all' | NoteKind;
type PinModalMode =
  | { type: 'set'; group: NoteGroup }
  | { type: 'unlock'; group: NoteGroup }
  | { type: 'remove'; group: NoteGroup }
  | null;

function noteExcerpt(note: NoteItem): string {
  if (note.kind === 'timeline') {
    const first = note.timelineEntries[0];
    if (!first) return '暂无时间轴记录';
    return `${note.timelineEntries.length} 条记录 · ${first.content.replace(/\s+/g, ' ').slice(0, 70)}`;
  }
  const clean = note.content
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, 84) : '空白便签';
}

export const NoteLibraryView: React.FC<NoteLibraryViewProps> = ({ onOpenNote }) => {
  const {
    activeNotes,
    activeNoteGroups,
    unlockedGroupIds,
    platform,
    setActiveTab,
    addNote,
    updateNote,
    deleteNote,
    toggleNotePin,
    addNoteGroup,
    updateNoteGroup,
    deleteNoteGroup,
    lockNoteGroup,
    unlockNoteGroup,
    relockNoteGroup,
    removeNoteGroupLock,
    showToast,
  } = useDeskTagStore();

  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all'); // 'all' | '__ungrouped__' | group.id

  // Group CRUD UI state
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameGroupDraft, setRenameGroupDraft] = useState('');

  // Privacy Lock PIN modal state
  const [pinModal, setPinModal] = useState<PinModalMode>(null);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [pinErr, setPinErr] = useState<string | null>(null);

  const groupMap = useMemo(
    () => new Map(activeNoteGroups.map((g) => [g.id, g])),
    [activeNoteGroups],
  );

  const selectedGroup = useMemo(
    () =>
      selectedGroupId !== 'all' && selectedGroupId !== '__ungrouped__'
        ? groupMap.get(selectedGroupId) ?? null
        : null,
    [selectedGroupId, groupMap],
  );

  const isGroupCurrentlyLocked = (group: NoteGroup | null | undefined): boolean => {
    if (!group || !group.locked) return false;
    return !unlockedGroupIds.has(group.id);
  };

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activeNotes.filter((n) => {
      if (kindFilter !== 'all' && n.kind !== kindFilter) return false;
      if (selectedGroupId === '__ungrouped__') {
        if (n.groupId !== null) return false;
      } else if (selectedGroupId !== 'all') {
        if (n.groupId !== selectedGroupId) return false;
      }
      if (!q) return true;
      const grp = n.groupId ? groupMap.get(n.groupId) : null;
      const locked = isGroupCurrentlyLocked(grp);
      if (n.title.toLowerCase().includes(q)) return true;
      if (locked) return false;
      if (n.content.toLowerCase().includes(q)) return true;
      return n.timelineEntries.some((e) => e.content.toLowerCase().includes(q));
    });
  }, [activeNotes, kindFilter, selectedGroupId, query, groupMap, unlockedGroupIds]);

  const handleOpenNote = (note: NoteItem) => {
    const grp = note.groupId ? groupMap.get(note.groupId) : null;
    if (isGroupCurrentlyLocked(grp) && grp) {
      setPin1('');
      setPin2('');
      setPinErr(null);
      setPinModal({ type: 'unlock', group: grp });
      return;
    }
    if (onOpenNote) {
      onOpenNote(note.id);
    } else {
      setActiveTab({ kind: 'note', noteId: note.id });
    }
  };

  const handleCreateNote = (kind: NoteKind) => {
    const targetGroupId =
      selectedGroupId !== 'all' && selectedGroupId !== '__ungrouped__' ? selectedGroupId : null;
    const created = addNote({
      kind,
      title: kind === 'timeline' ? '时间轴便签' : '新建便签',
      groupId: targetGroupId,
    });
    if (onOpenNote) {
      onOpenNote(created.id);
    } else {
      setActiveTab({ kind: 'note', noteId: created.id });
    }
  };

  const handleCreateGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    const grp = addNoteGroup(name);
    setSelectedGroupId(grp.id);
    setNewGroupName('');
    setCreatingGroup(false);
    showToast(`已创建分组「${grp.name}」`);
  };

  const handleSaveRenameGroup = (group: NoteGroup) => {
    const name = renameGroupDraft.trim();
    if (name && name !== group.name) {
      updateNoteGroup(group.id, { name });
      showToast(`分组已重命名为「${name}」`);
    }
    setRenamingGroupId(null);
  };

  const handleDeleteGroup = (group: NoteGroup) => {
    deleteNoteGroup(group.id);
    if (selectedGroupId === group.id) {
      setSelectedGroupId('all');
    }
    showToast(`已删除分组「${group.name}」，分组内便签已移至未分组`);
  };

  const handleSubmitPinModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinModal) return;

    if (pinModal.type === 'set') {
      if (!/^\d{4,6}$/.test(pin1.trim())) {
        setPinErr('请输入 4 至 6 位数字密码');
        return;
      }
      if (pin1.trim() !== pin2.trim()) {
        setPinErr('两次输入的密码不一致');
        return;
      }
      await lockNoteGroup(pinModal.group.id, pin1.trim());
      setPinModal(null);
      showToast(`已为分组「${pinModal.group.name}」开启隐私锁`);
      return;
    }

    if (pinModal.type === 'unlock') {
      const ok = await unlockNoteGroup(pinModal.group.id, pin1.trim());
      if (!ok) {
        setPinErr('密码错误，请重试');
        return;
      }
      setPinModal(null);
      showToast(`已解锁分组「${pinModal.group.name}」`);
      return;
    }

    // remove lock
    const ok = await removeNoteGroupLock(pinModal.group.id, pin1.trim());
    if (!ok) {
      setPinErr('原密码错误，无法关闭隐私锁');
      return;
    }
    setPinModal(null);
    showToast(`已关闭分组「${pinModal.group.name}」隐私锁`);
  };

  const selectedGroupLocked = isGroupCurrentlyLocked(selectedGroup);

  return (
    <div
      className="dt-note-library"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-panel)',
        color: 'var(--text-primary)',
        position: 'relative',
      }}
    >
      {/* Top Search & Create Bar */}
      <div
        style={{
          padding: '10px 14px 8px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              borderRadius: 9,
              border: '1px solid var(--border)',
              background: 'var(--bg-input)',
            }}
          >
            <SearchIcon size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索便签标题或正文…"
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--text-primary)',
                fontSize: 12.5,
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                ×
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => handleCreateNote('normal')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 10px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--accent-text)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <PlusIcon size={13} />
            <span>普通便签</span>
          </button>

          <button
            type="button"
            onClick={() => handleCreateNote('timeline')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 9px',
              borderRadius: 8,
              border: '1px solid var(--accent-border)',
              background: 'var(--accent-soft)',
              color: 'var(--accent-soft-text)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <TimelineIcon size={13} />
            <span>时间轴</span>
          </button>
        </div>

        {/* Kind Filter Pills */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'inline-flex', gap: 4 }}>
            {(
              [
                ['all', '全部'],
                ['normal', '普通便签'],
                ['timeline', '时间轴便签'],
              ] as Array<[KindFilter, string]>
            ).map(([k, label]) => {
              const active = kindFilter === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  style={{
                    padding: '3px 9px',
                    borderRadius: 999,
                    border: 'none',
                    background: active ? 'var(--pill-active-bg)' : 'transparent',
                    color: active ? 'var(--pill-active-text)' : 'var(--text-secondary)',
                    fontWeight: active ? 600 : 500,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            共 {filteredNotes.length} 篇
          </span>
        </div>

        {/* Note Groups Horizontal Strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            overflowX: 'auto',
            paddingBottom: 2,
          }}
        >
          <button
            type="button"
            onClick={() => setSelectedGroupId('all')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 9px',
              borderRadius: 8,
              border: `1px solid ${selectedGroupId === 'all' ? 'var(--accent-border)' : 'var(--border)'}`,
              background: selectedGroupId === 'all' ? 'var(--accent-soft)' : 'var(--bg-surface)',
              color: selectedGroupId === 'all' ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
              fontSize: 12,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            全部分组
          </button>

          <button
            type="button"
            onClick={() => setSelectedGroupId('__ungrouped__')}
            style={{
              padding: '4px 9px',
              borderRadius: 8,
              border: `1px solid ${selectedGroupId === '__ungrouped__' ? 'var(--accent-border)' : 'var(--border)'}`,
              background: selectedGroupId === '__ungrouped__' ? 'var(--accent-soft)' : 'var(--bg-surface)',
              color: selectedGroupId === '__ungrouped__' ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
              fontSize: 12,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            未分组
          </button>

          {activeNoteGroups.map((grp) => {
            const active = selectedGroupId === grp.id;
            const lockedNow = isGroupCurrentlyLocked(grp);
            return (
              <button
                key={grp.id}
                type="button"
                onClick={() => setSelectedGroupId(grp.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 9px',
                  borderRadius: 8,
                  border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
                  background: active ? 'var(--accent-soft)' : 'var(--bg-surface)',
                  color: active ? 'var(--accent-soft-text)' : 'var(--text-secondary)',
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                {grp.locked ? (
                  lockedNow ? (
                    <LockIcon size={12} />
                  ) : (
                    <UnlockIcon size={12} />
                  )
                ) : (
                  <FolderIcon size={12} />
                )}
                <span>{grp.name}</span>
              </button>
            );
          })}

          {creatingGroup ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input
                autoFocus
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateGroup();
                  else if (e.key === 'Escape') setCreatingGroup(false);
                }}
                placeholder="分组名称…"
                style={{
                  width: 96,
                  padding: '3px 7px',
                  borderRadius: 7,
                  border: '1px solid var(--accent-border)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={handleCreateGroup}
                style={{
                  padding: '3px 7px',
                  borderRadius: 7,
                  border: 'none',
                  background: 'var(--accent)',
                  color: 'var(--accent-text)',
                  fontSize: 11.5,
                  cursor: 'pointer',
                }}
              >
                确定
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreatingGroup(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '4px 8px',
                borderRadius: 8,
                border: '1px dashed var(--border-strong)',
                background: 'transparent',
                color: 'var(--text-muted)',
                fontSize: 12,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              <PlusIcon size={12} />
              <span>新建分组</span>
            </button>
          )}
        </div>

        {/* Selected Group Management & Privacy Lock Bar */}
        {selectedGroup && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
              padding: '6px 10px',
              borderRadius: 9,
              background: 'var(--bg-header)',
              border: '1px solid var(--border)',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {renamingGroupId === selectedGroup.id ? (
                <>
                  <input
                    autoFocus
                    type="text"
                    value={renameGroupDraft}
                    onChange={(e) => setRenameGroupDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRenameGroup(selectedGroup);
                      else if (e.key === 'Escape') setRenamingGroupId(null);
                    }}
                    style={{
                      padding: '2px 6px',
                      borderRadius: 6,
                      border: '1px solid var(--accent-border)',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveRenameGroup(selectedGroup)}
                    style={{
                      padding: '2px 7px',
                      borderRadius: 6,
                      border: 'none',
                      background: 'var(--accent)',
                      color: 'var(--accent-text)',
                      fontSize: 11.5,
                      cursor: 'pointer',
                    }}
                  >
                    保存
                  </button>
                </>
              ) : (
                <>
                  <strong style={{ fontSize: 12.5 }}>{selectedGroup.name}</strong>
                  {selectedGroup.locked && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: '1px 6px',
                        borderRadius: 999,
                        background: selectedGroupLocked ? 'var(--danger-soft)' : 'var(--accent-soft)',
                        color: selectedGroupLocked ? 'var(--danger)' : 'var(--accent-soft-text)',
                      }}
                    >
                      {selectedGroupLocked ? '隐私锁已锁定' : '隐私锁已解锁'}
                    </span>
                  )}
                </>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {!selectedGroup.locked ? (
                <button
                  type="button"
                  onClick={() => {
                    setPin1('');
                    setPin2('');
                    setPinErr(null);
                    setPinModal({ type: 'set', group: selectedGroup });
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 8px',
                    borderRadius: 7,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-surface)',
                    color: 'var(--text-secondary)',
                    fontSize: 11.5,
                    cursor: 'pointer',
                  }}
                >
                  <LockIcon size={12} />
                  <span>设置隐私锁</span>
                </button>
              ) : selectedGroupLocked ? (
                <button
                  type="button"
                  onClick={() => {
                    setPin1('');
                    setPinErr(null);
                    setPinModal({ type: 'unlock', group: selectedGroup });
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 9px',
                    borderRadius: 7,
                    border: 'none',
                    background: 'var(--accent)',
                    color: 'var(--accent-text)',
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <UnlockIcon size={12} />
                  <span>解锁分组</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      relockNoteGroup(selectedGroup.id);
                      showToast(`已重新锁定分组「${selectedGroup.name}」`);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 8px',
                      borderRadius: 7,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-surface)',
                      color: 'var(--text-secondary)',
                      fontSize: 11.5,
                      cursor: 'pointer',
                    }}
                  >
                    <LockIcon size={12} />
                    <span>重新锁定</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPin1('');
                      setPinErr(null);
                      setPinModal({ type: 'remove', group: selectedGroup });
                    }}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 7,
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      fontSize: 11.5,
                      cursor: 'pointer',
                    }}
                  >
                    取消隐私锁
                  </button>
                </>
              )}

              <button
                type="button"
                title="重命名分组"
                onClick={() => {
                  setRenamingGroupId(selectedGroup.id);
                  setRenameGroupDraft(selectedGroup.name);
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  padding: 3,
                }}
              >
                <EditIcon size={13} />
              </button>
              <button
                type="button"
                title="删除分组"
                onClick={() => handleDeleteGroup(selectedGroup)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--danger)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  padding: 3,
                }}
              >
                <TrashIcon size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Note List / Locked Group Gate */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        {selectedGroup && selectedGroupLocked ? (
          <div
            style={{
              padding: '44px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <LockIcon size={20} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              「{selectedGroup.name}」内容已隐藏保护
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              该分组共有 {filteredNotes.length} 篇便签，输入密码解锁后可浏览
            </div>
            <button
              type="button"
              onClick={() => {
                setPin1('');
                setPinErr(null);
                setPinModal({ type: 'unlock', group: selectedGroup });
              }}
              style={{
                marginTop: 4,
                padding: '6px 16px',
                borderRadius: 9,
                border: 'none',
                background: 'var(--accent)',
                color: 'var(--accent-text)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              输入密码解锁
            </button>
          </div>
        ) : filteredNotes.length === 0 ? (
          <div
            style={{
              padding: '44px 16px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            {query ? '没有找到匹配的便签' : '这里还没有便签，点击上方按钮新建一篇吧。'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredNotes.map((note) => {
              const grp = note.groupId ? groupMap.get(note.groupId) : null;
              const locked = isGroupCurrentlyLocked(grp);

              return (
                <article
                  key={note.id}
                  onClick={() => handleOpenNote(note)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 11,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    transition: 'border-color 140ms ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      {note.kind === 'timeline' ? (
                        <TimelineIcon size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      ) : (
                        <NoteIcon size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      )}
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 13.5,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {note.title || '未命名便签'}
                      </span>
                      {grp && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            fontSize: 10.5,
                            padding: '1px 6px',
                            borderRadius: 999,
                            background: 'var(--tag-bg)',
                            border: '1px solid var(--tag-border)',
                            color: 'var(--tag-text)',
                            flexShrink: 0,
                          }}
                        >
                          {locked && <LockIcon size={10} />}
                          {grp.name}
                        </span>
                      )}
                    </div>

                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}
                    >
                      <button
                        type="button"
                        title={note.pinnedToSide ? '取消固定到侧边' : '固定到侧边页签'}
                        onClick={() => {
                          toggleNotePin(note.id);
                          showToast(note.pinnedToSide ? '已取消固定到侧边' : '已固定到侧边页签');
                        }}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 7,
                          border: 'none',
                          background: note.pinnedToSide ? 'var(--accent-soft)' : 'transparent',
                          color: note.pinnedToSide ? 'var(--accent-soft-text)' : 'var(--text-muted)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <PinIcon size={13} />
                      </button>

                      {!platform.isMobile && !locked && (
                        <button
                          type="button"
                          title="独立窗口打开"
                          onClick={() => void openNoteWindow(note.id)}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 7,
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--text-muted)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                          }}
                        >
                          <PopoutIcon size={13} />
                        </button>
                      )}

                      <button
                        type="button"
                        title="删除便签"
                        onClick={() => {
                          deleteNote(note.id);
                          showToast('已删除便签');
                        }}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 7,
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <TrashIcon size={13} />
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: 12,
                      color: locked ? 'var(--text-muted)' : 'var(--text-secondary)',
                      fontStyle: locked ? 'italic' : 'normal',
                      lineHeight: 1.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {locked ? '🔒 此便签位于已锁定隐私分组中，点击解锁后查看' : noteExcerpt(note)}
                  </div>

                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      fontSize: 11,
                      color: 'var(--text-muted)',
                    }}
                  >
                    <span>
                      {note.kind === 'timeline' ? '时间轴' : '普通便签'} · 更新于{' '}
                      {formatRelativeTime(note.updatedAt)}
                      {note.attachments.length > 0 ? ` · ${note.attachments.length} 附件` : ''}
                    </span>
                    <select
                      aria-label="移动到分组"
                      value={note.groupId ?? ''}
                      onChange={(e) =>
                        updateNote(note.id, { groupId: e.target.value || null })
                      }
                      style={{
                        padding: '1px 6px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-surface)',
                        color: 'var(--text-secondary)',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      <option value="">未分组</option>
                      {activeNoteGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Privacy Lock PIN Modal */}
      {pinModal && (
        <div
          onClick={() => setPinModal(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20, 16, 12, 0.38)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 80,
            padding: 16,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => void handleSubmitPinModal(e)}
            style={{
              width: '100%',
              maxWidth: 320,
              padding: 18,
              borderRadius: 14,
              background: 'var(--bg-popover)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-popover)',
              display: 'flex',
              flexDirection: 'column',
              gap: 11,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 14.5 }}>
              <LockIcon size={16} style={{ color: 'var(--accent)' }} />
              <span>
                {pinModal.type === 'set'
                  ? `为「${pinModal.group.name}」设置隐私锁`
                  : pinModal.type === 'unlock'
                    ? `解锁分组「${pinModal.group.name}」`
                    : `取消「${pinModal.group.name}」隐私锁`}
              </span>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {pinModal.type === 'set'
                ? '设置 4–6 位数字密码（本地 SHA-256 哈希存储），锁定时将隐藏该分组所有便签内容。'
                : '请输入该分组的 4–6 位数字隐私锁密码。'}
            </div>

            <input
              autoFocus
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin1}
              onChange={(e) => {
                setPin1(e.target.value);
                setPinErr(null);
              }}
              placeholder={pinModal.type === 'set' ? '输入 4–6 位数字密码' : '输入密码'}
              style={{
                padding: '8px 10px',
                borderRadius: 9,
                border: '1px solid var(--border)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 15,
                textAlign: 'center',
                letterSpacing: '0.25em',
              }}
            />

            {pinModal.type === 'set' && (
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin2}
                onChange={(e) => {
                  setPin2(e.target.value);
                  setPinErr(null);
                }}
                placeholder="再次确认数字密码"
                style={{
                  padding: '8px 10px',
                  borderRadius: 9,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: 15,
                  textAlign: 'center',
                  letterSpacing: '0.25em',
                }}
              />
            )}

            {pinErr && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{pinErr}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setPinModal(null)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                type="submit"
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--accent)',
                  color: 'var(--accent-text)',
                  fontWeight: 600,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                确认
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default NoteLibraryView;
