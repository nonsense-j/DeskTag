import {
  AlertCircleIcon,
  ClockIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FolderIcon,
  FolderInputIcon,
  LockIcon,
  PaperclipIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  StickyNoteIcon,
  Trash2Icon,
  UnlockIcon,
  XIcon,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { openNoteWindow } from '../api/tauri';
import { cn } from '../lib/utils';
import { useDeskTagStore } from '../store/useDeskTagStore';
import type { NoteGroup, NoteItem, NoteKind } from '../types/models';
import { formatRelativeTime } from '../utils/lunar';
import { Alert, AlertDescription } from './ui/alert';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from './ui/card';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from './ui/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './ui/empty';
import { Input } from './ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group';
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from './ui/menu';
import { ScrollArea } from './ui/scroll-area';
import { SegmentedControl, SegmentedControlItem } from './ui/segmented-control';
import { Tooltip, TooltipPopup, TooltipTrigger } from './ui/tooltip';

export interface NoteLibraryViewProps {
  /** Optional override when selecting a note (e.g. mobile notes drill-down). */
  onOpenNote?: (noteId: string) => void;
}

type KindFilter = 'all' | NoteKind;
type PinModalState =
  | { type: 'set'; group: NoteGroup }
  | { type: 'unlock'; group: NoteGroup }
  | { type: 'remove'; group: NoteGroup };

function stripMarkdownSyntax(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    // Remove markdown table separator rows like | --- | :---: | ---: |
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/gm, ' ')
    // Remove fenced code block delimiters
    .replace(/^\s*```[^\n]*$/gm, ' ')
    // Strip heading markers (#, ##, ###)
    .replace(/^\s*#{1,6}\s+/gm, '')
    // Strip blockquote prefixes
    .replace(/^\s*>\s?/gm, '')
    // Strip unordered & ordered list prefixes
    .replace(/^\s*[-*+•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    // Replace pipe characters from table rows with clean middle-dot / space separators
    .replace(/^\s*\|\s*|\s*\|\s*$/gm, '')
    .replace(/\s*\|\s*/g, ' · ')
    // Strip inline code, bold, italic, and strikethrough markers
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    // Collapse whitespace and duplicate separators
    .replace(/(\s*·\s*){2,}/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

function noteExcerpt(note: NoteItem): string {
  if (note.kind === 'timeline') {
    const first = note.timelineEntries[0];
    if (!first) return '暂无时间轴记录';
    const clean = stripMarkdownSyntax(first.content);
    return `${note.timelineEntries.length} 条记录 · ${clean.slice(0, 120)}`;
  }
  const clean = stripMarkdownSyntax(note.content);
  return clean ? clean.slice(0, 140) : '空白便签';
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

  // Create Group Dialog state
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // Rename Group Dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamingGroup, setRenamingGroup] = useState<NoteGroup | null>(null);
  const [renameGroupDraft, setRenameGroupDraft] = useState('');

  // Privacy Lock PIN Dialog state
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinModal, setPinModal] = useState<PinModalState | null>(null);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [pinErr, setPinErr] = useState<string | null>(null);

  // Destructive confirmation AlertDialogs
  const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<NoteGroup | null>(null);
  const [deleteNoteOpen, setDeleteNoteOpen] = useState(false);
  const [deletingNote, setDeletingNote] = useState<NoteItem | null>(null);

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

  const openPinDialog = (next: PinModalState) => {
    setPin1('');
    setPin2('');
    setPinErr(null);
    setPinModal(next);
    setPinDialogOpen(true);
  };

  const handleOpenNote = (note: NoteItem) => {
    const grp = note.groupId ? groupMap.get(note.groupId) : null;
    if (isGroupCurrentlyLocked(grp) && grp) {
      openPinDialog({ type: 'unlock', group: grp });
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

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    const grp = addNoteGroup(name);
    setSelectedGroupId(grp.id);
    setNewGroupName('');
    setCreateGroupOpen(false);
    showToast(`已创建分组「${grp.name}」`);
  };

  const handleSaveRenameGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingGroup) return;
    const name = renameGroupDraft.trim();
    if (name && name !== renamingGroup.name) {
      updateNoteGroup(renamingGroup.id, { name });
      showToast(`分组已重命名为「${name}」`);
    }
    setRenameDialogOpen(false);
  };

  const handleConfirmDeleteGroup = () => {
    if (!deletingGroup) return;
    deleteNoteGroup(deletingGroup.id);
    if (selectedGroupId === deletingGroup.id) {
      setSelectedGroupId('all');
    }
    showToast(`已删除分组「${deletingGroup.name}」，分组内便签已移至未分组`);
    setDeleteGroupOpen(false);
  };

  const handleConfirmDeleteNote = () => {
    if (!deletingNote) return;
    deleteNote(deletingNote.id);
    showToast('已删除便签');
    setDeleteNoteOpen(false);
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
      setPinDialogOpen(false);
      showToast(`已为分组「${pinModal.group.name}」开启隐私锁`);
      return;
    }

    if (pinModal.type === 'unlock') {
      const ok = await unlockNoteGroup(pinModal.group.id, pin1.trim());
      if (!ok) {
        setPinErr('密码错误，请重试');
        return;
      }
      setPinDialogOpen(false);
      showToast(`已解锁分组「${pinModal.group.name}」`);
      return;
    }

    // remove lock
    const ok = await removeNoteGroupLock(pinModal.group.id, pin1.trim());
    if (!ok) {
      setPinErr('原密码错误，无法关闭隐私锁');
      return;
    }
    setPinDialogOpen(false);
    showToast(`已关闭分组「${pinModal.group.name}」隐私锁`);
  };

  const selectedGroupLocked = isGroupCurrentlyLocked(selectedGroup);

  return (
    <div className="dt-note-library relative flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* Compact 2-Row Header */}
      <div className="flex shrink-0 flex-col gap-2 border-b bg-background px-3.5 py-2.5">
        {/* Row 1: Search InputGroup + Primary & Outline Create Buttons */}
        <div className="flex items-center gap-1.5">
          <InputGroup className="flex-1">
            <InputGroupAddon align="inline-start">
              <SearchIcon className="size-3.5" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              size="sm"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索便签标题或正文…"
              aria-label="搜索便签"
            />
            {query && (
              <InputGroupAddon align="inline-end">
                <Button
                  aria-label="清空搜索"
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => setQuery('')}
                  className="size-5 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-3" aria-hidden="true" />
                </Button>
              </InputGroupAddon>
            )}
          </InputGroup>

          <Button
            size="sm"
            variant="default"
            onClick={() => handleCreateNote('normal')}
            className="shrink-0"
          >
            <PlusIcon className="size-3.5" aria-hidden="true" />
            <span>便签</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => handleCreateNote('timeline')}
            className="shrink-0"
          >
            <ClockIcon className="size-3.5" aria-hidden="true" />
            <span>时间轴</span>
          </Button>
        </div>

        {/* Row 2: Compact Kind SegmentedControl + Horizontal Group Strip + Count */}
        <div className="flex min-w-0 items-center gap-2">
          <SegmentedControl
            size="sm"
            role="radiogroup"
            aria-label="便签类型筛选"
            className="shrink-0"
          >
            {(
              [
                ['all', '全部'],
                ['normal', '普通'],
                ['timeline', '时间轴'],
              ] as Array<[KindFilter, string]>
            ).map(([k, label]) => {
              const active = kindFilter === k;
              return (
                <SegmentedControlItem
                  key={k}
                  size="sm"
                  role="radio"
                  aria-checked={active}
                  data-pressed={active ? '' : undefined}
                  onClick={() => setKindFilter(k)}
                  className="h-6 px-2 text-xs"
                >
                  {label}
                </SegmentedControlItem>
              );
            })}
          </SegmentedControl>

          <ScrollArea
            scrollFade
            clampContentMinWidth={false}
            className="h-7.5 min-w-0 flex-1"
          >
            <div className="flex w-max items-center gap-1 py-0.5">
              <button
                type="button"
                onClick={() => setSelectedGroupId('all')}
                className={cn(
                  'inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 text-xs whitespace-nowrap transition-colors',
                  selectedGroupId === 'all'
                    ? 'border-dt-accent-border bg-dt-accent-soft font-medium text-dt-accent-soft-text'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                全部分组
              </button>

              <button
                type="button"
                onClick={() => setSelectedGroupId('__ungrouped__')}
                className={cn(
                  'inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 text-xs whitespace-nowrap transition-colors',
                  selectedGroupId === '__ungrouped__'
                    ? 'border-dt-accent-border bg-dt-accent-soft font-medium text-dt-accent-soft-text'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
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
                    className={cn(
                      'inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 text-xs whitespace-nowrap transition-colors',
                      active
                        ? 'border-dt-accent-border bg-dt-accent-soft font-medium text-dt-accent-soft-text'
                        : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {grp.locked ? (
                      lockedNow ? (
                        <LockIcon className="size-3 shrink-0 opacity-80" aria-hidden="true" />
                      ) : (
                        <UnlockIcon className="size-3 shrink-0 opacity-80" aria-hidden="true" />
                      )
                    ) : (
                      <FolderIcon className="size-3 shrink-0 opacity-75" aria-hidden="true" />
                    )}
                    <span>{grp.name}</span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  setNewGroupName('');
                  setCreateGroupOpen(true);
                }}
                className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-dashed border-border bg-transparent px-2 text-muted-foreground text-xs whitespace-nowrap transition-colors hover:border-ring/50 hover:bg-accent hover:text-foreground"
              >
                <PlusIcon className="size-3" aria-hidden="true" />
                <span>分组</span>
              </button>
            </div>
          </ScrollArea>

          <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
            共 {filteredNotes.length} 篇
          </span>
        </div>

        {/* Selected Group Management & Privacy Lock Strip (only when a specific group is active) */}
        {selectedGroup && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-coss-frame-well px-2.5 py-1.5 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold text-foreground">
                {selectedGroup.name}
              </span>
              {selectedGroup.locked && (
                <Badge
                  variant={selectedGroupLocked ? 'error' : 'success'}
                  size="sm"
                >
                  {selectedGroupLocked ? '隐私锁已锁定' : '隐私锁已解锁'}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {!selectedGroup.locked ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => openPinDialog({ type: 'set', group: selectedGroup })}
                >
                  <LockIcon className="size-3" aria-hidden="true" />
                  <span>设置隐私锁</span>
                </Button>
              ) : selectedGroupLocked ? (
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => openPinDialog({ type: 'unlock', group: selectedGroup })}
                >
                  <UnlockIcon className="size-3" aria-hidden="true" />
                  <span>解锁分组</span>
                </Button>
              ) : (
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      relockNoteGroup(selectedGroup.id);
                      showToast(`已重新锁定分组「${selectedGroup.name}」`);
                    }}
                  >
                    <LockIcon className="size-3" aria-hidden="true" />
                    <span>重新锁定</span>
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => openPinDialog({ type: 'remove', group: selectedGroup })}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    取消隐私锁
                  </Button>
                </>
              )}

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label="重命名分组"
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => {
                        setRenamingGroup(selectedGroup);
                        setRenameGroupDraft(selectedGroup.name);
                        setRenameDialogOpen(true);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    />
                  }
                >
                  <PencilIcon className="size-3.5" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipPopup>重命名分组</TooltipPopup>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label="删除分组"
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => {
                        setDeletingGroup(selectedGroup);
                        setDeleteGroupOpen(true);
                      }}
                      className="text-muted-foreground hover:text-destructive-foreground"
                    />
                  }
                >
                  <Trash2Icon className="size-3.5" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipPopup>删除分组</TooltipPopup>
              </Tooltip>
            </div>
          </div>
        )}
      </div>

      {/* Main Note List / Locked Group Gate */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {selectedGroup && selectedGroupLocked ? (
            <div className="flex items-center justify-center py-8">
              <Card className="w-full max-w-xs rounded-2xl">
                <CardHeader className="items-center text-center">
                  <div className="mb-1 flex size-10 items-center justify-center rounded-xl border bg-coss-frame-well text-dt-accent">
                    <LockIcon className="size-4.5" aria-hidden="true" />
                  </div>
                  <CardTitle className="text-sm">
                    「{selectedGroup.name}」内容已隐藏保护
                  </CardTitle>
                  <CardDescription className="text-xs leading-relaxed">
                    该分组共有 {filteredNotes.length} 篇便签，输入密码解锁后可浏览
                  </CardDescription>
                </CardHeader>
                <CardPanel className="flex justify-center pt-0">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => openPinDialog({ type: 'unlock', group: selectedGroup })}
                  >
                    <UnlockIcon className="size-3.5" aria-hidden="true" />
                    <span>输入密码解锁</span>
                  </Button>
                </CardPanel>
              </Card>
            </div>
          ) : filteredNotes.length === 0 ? (
            <Empty className="py-12">
              <EmptyMedia variant="icon">
                <StickyNoteIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle className="text-base">
                  {query ? '没有找到匹配的便签' : '这里还没有便签'}
                </EmptyTitle>
                <EmptyDescription>
                  {query
                    ? '换个关键词试试，或清空搜索条件查看全部便签。'
                    : '新建一篇普通结构化便签，或使用时间轴记录碎片灵感。'}
                </EmptyDescription>
              </EmptyHeader>
              {!query && (
                <EmptyContent className="flex-row justify-center gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => handleCreateNote('normal')}
                  >
                    <PlusIcon className="size-3.5" aria-hidden="true" />
                    <span>新建便签</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCreateNote('timeline')}
                  >
                    <ClockIcon className="size-3.5" aria-hidden="true" />
                    <span>新建时间轴</span>
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredNotes.map((note) => {
                const grp = note.groupId ? groupMap.get(note.groupId) : null;
                const locked = isGroupCurrentlyLocked(grp);

                return (
                  <Card
                    key={note.id}
                    render={<article />}
                    onClick={() => handleOpenNote(note)}
                    className="group/card cursor-pointer gap-1.5 rounded-xl border bg-card p-3 shadow-xs/5 transition-colors before:rounded-[calc(var(--radius-xl)-1px)] hover:border-ring/40"
                  >
                    {/* Card Top Row: Kind Icon + Title + Group Badge + Subtle Actions */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {note.kind === 'timeline' ? (
                          <ClockIcon
                            className="size-3.5 shrink-0 text-dt-accent"
                            aria-hidden="true"
                          />
                        ) : (
                          <StickyNoteIcon
                            className="size-3.5 shrink-0 text-dt-accent"
                            aria-hidden="true"
                          />
                        )}
                        <span className="truncate font-semibold text-[13.5px] text-foreground">
                          {note.title || '未命名便签'}
                        </span>
                        {grp && (
                          <Badge
                            variant="secondary"
                            size="sm"
                            className="shrink-0 gap-1 text-muted-foreground"
                          >
                            {locked && (
                              <LockIcon className="size-2.5" aria-hidden="true" />
                            )}
                            <span>{grp.name}</span>
                          </Badge>
                        )}
                      </div>

                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex shrink-0 items-center gap-0.5"
                      >
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                aria-label={
                                  note.pinnedToSide ? '取消固定到侧边' : '固定到侧边页签'
                                }
                                size="icon-xs"
                                variant="ghost"
                                onClick={() => {
                                  toggleNotePin(note.id);
                                  showToast(
                                    note.pinnedToSide
                                      ? '已取消固定到侧边'
                                      : '已固定到侧边页签',
                                  );
                                }}
                                className={cn(
                                  'transition-opacity',
                                  note.pinnedToSide
                                    ? 'bg-dt-accent-soft text-dt-accent-soft-text opacity-100'
                                    : 'text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100',
                                )}
                              />
                            }
                          >
                            <PinIcon className="size-3.5" aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipPopup>
                            {note.pinnedToSide ? '取消固定到侧边' : '固定到侧边页签'}
                          </TooltipPopup>
                        </Tooltip>

                        {!platform.isMobile && !locked && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  aria-label="独立窗口打开"
                                  size="icon-xs"
                                  variant="ghost"
                                  onClick={() => {
                                    void openNoteWindow(note.id).catch((err) => {
                                      showToast(
                                        `打开独立便签失败：${err instanceof Error ? err.message : String(err)}`,
                                      );
                                    });
                                  }}
                                  className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100"
                                />
                              }
                            >
                              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                            </TooltipTrigger>
                            <TooltipPopup>独立窗口打开</TooltipPopup>
                          </Tooltip>
                        )}

                        <Menu>
                          <MenuTrigger
                            render={
                              <Button
                                aria-label="便签操作菜单"
                                size="icon-xs"
                                variant="ghost"
                                className="text-muted-foreground hover:text-foreground"
                              />
                            }
                          >
                            <EllipsisIcon className="size-3.5" aria-hidden="true" />
                          </MenuTrigger>
                          <MenuPopup align="end" sideOffset={4} className="min-w-40">
                            <MenuSub>
                              <MenuSubTrigger>
                                <FolderInputIcon aria-hidden="true" />
                                <span>移动到分组</span>
                              </MenuSubTrigger>
                              <MenuSubPopup className="min-w-36">
                                <MenuRadioGroup
                                  value={note.groupId ?? '__none__'}
                                  onValueChange={(value) => {
                                    const nextGroupId =
                                      value === '__none__' ? null : String(value);
                                    updateNote(note.id, { groupId: nextGroupId });
                                    const targetName = nextGroupId
                                      ? groupMap.get(nextGroupId)?.name ?? '目标分组'
                                      : '未分组';
                                    showToast(`已移动到「${targetName}」`);
                                  }}
                                >
                                  <MenuRadioItem value="__none__">未分组</MenuRadioItem>
                                  {activeNoteGroups.map((g) => (
                                    <MenuRadioItem key={g.id} value={g.id}>
                                      <span className="inline-flex items-center gap-1.5">
                                        <span className="truncate">{g.name}</span>
                                        {g.locked && (
                                          <LockIcon
                                            className="size-3 shrink-0 opacity-65"
                                            aria-hidden="true"
                                          />
                                        )}
                                      </span>
                                    </MenuRadioItem>
                                  ))}
                                </MenuRadioGroup>
                              </MenuSubPopup>
                            </MenuSub>

                            <MenuItem
                              onClick={() => {
                                toggleNotePin(note.id);
                                showToast(
                                  note.pinnedToSide
                                    ? '已取消固定到侧边'
                                    : '已固定到侧边页签',
                                );
                              }}
                            >
                              <PinIcon aria-hidden="true" />
                              <span>
                                {note.pinnedToSide ? '取消固定到侧边' : '固定到侧边页签'}
                              </span>
                            </MenuItem>

                            {!platform.isMobile && !locked && (
                              <MenuItem
                                onClick={() => {
                                  void openNoteWindow(note.id).catch((err) => {
                                    showToast(
                                      `打开独立便签失败：${err instanceof Error ? err.message : String(err)}`,
                                    );
                                  });
                                }}
                              >
                                <ExternalLinkIcon aria-hidden="true" />
                                <span>独立窗口打开</span>
                              </MenuItem>
                            )}

                            <MenuSeparator />

                            <MenuItem
                              variant="destructive"
                              onClick={() => {
                                setDeletingNote(note);
                                setDeleteNoteOpen(true);
                              }}
                            >
                              <Trash2Icon aria-hidden="true" />
                              <span>删除便签</span>
                            </MenuItem>
                          </MenuPopup>
                        </Menu>
                      </div>
                    </div>

                    {/* Clean 2-Line Excerpt */}
                    <p
                      className={cn(
                        'line-clamp-2 text-xs leading-relaxed',
                        locked
                          ? 'flex items-center gap-1.5 italic text-muted-foreground'
                          : 'text-muted-foreground',
                      )}
                    >
                      {locked ? (
                        <>
                          <LockIcon className="size-3 shrink-0" aria-hidden="true" />
                          <span>此便签位于已锁定隐私分组中，点击解锁后查看</span>
                        </>
                      ) : (
                        noteExcerpt(note)
                      )}
                    </p>

                    {/* Footer Metadata Row */}
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate tabular-nums">
                        {note.kind === 'timeline' ? '时间轴' : '普通便签'} · 更新于{' '}
                        {formatRelativeTime(note.updatedAt)}
                      </span>
                      {note.attachments.length > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
                          <PaperclipIcon className="size-3 opacity-75" aria-hidden="true" />
                          <span>{note.attachments.length}</span>
                        </span>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Create Group Dialog */}
      <Dialog open={createGroupOpen} onOpenChange={setCreateGroupOpen}>
        <DialogPopup className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base">新建分组</DialogTitle>
            <DialogDescription className="text-xs">
              为便签建立分类目录，创建后可单独开启隐私锁保护。
            </DialogDescription>
          </DialogHeader>
          <form className="contents" onSubmit={handleCreateGroup}>
            <DialogPanel>
              <Input
                autoFocus
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="输入分组名称…"
                aria-label="分组名称"
              />
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button size="sm" variant="ghost" />}>
                取消
              </DialogClose>
              <Button size="sm" type="submit" disabled={!newGroupName.trim()}>
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      {/* Rename Group Dialog */}
      <Dialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        onOpenChangeComplete={(open) => {
          if (!open) setRenamingGroup(null);
        }}
      >
        <DialogPopup className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base">重命名分组</DialogTitle>
            <DialogDescription className="text-xs">
              修改分组「{renamingGroup?.name ?? ''}」的显示名称。
            </DialogDescription>
          </DialogHeader>
          <form className="contents" onSubmit={handleSaveRenameGroup}>
            <DialogPanel>
              <Input
                autoFocus
                type="text"
                value={renameGroupDraft}
                onChange={(e) => setRenameGroupDraft(e.target.value)}
                placeholder="输入新的分组名称…"
                aria-label="新分组名称"
              />
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button size="sm" variant="ghost" />}>
                取消
              </DialogClose>
              <Button size="sm" type="submit" disabled={!renameGroupDraft.trim()}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      {/* Privacy Lock PIN Dialog */}
      <Dialog
        open={pinDialogOpen}
        onOpenChange={setPinDialogOpen}
        onOpenChangeComplete={(open) => {
          if (!open) {
            setPinModal(null);
            setPin1('');
            setPin2('');
            setPinErr(null);
          }
        }}
      >
        <DialogPopup className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <LockIcon className="size-4 text-dt-accent" aria-hidden="true" />
              <span>
                {pinModal?.type === 'set'
                  ? `为「${pinModal.group.name}」设置隐私锁`
                  : pinModal?.type === 'unlock'
                    ? `解锁分组「${pinModal.group.name}」`
                    : `取消「${pinModal?.group.name ?? ''}」隐私锁`}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {pinModal?.type === 'set'
                ? '设置 4–6 位数字密码（本地 SHA-256 哈希存储），锁定时将隐藏该分组所有便签内容。'
                : '请输入该分组的 4–6 位数字隐私锁密码。'}
            </DialogDescription>
          </DialogHeader>

          <form className="contents" onSubmit={(e) => void handleSubmitPinModal(e)}>
            <DialogPanel className="flex flex-col gap-2.5">
              <Input
                autoFocus
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin1}
                onChange={(e) => {
                  setPin1(e.target.value);
                  setPinErr(null);
                }}
                placeholder={
                  pinModal?.type === 'set' ? '输入 4–6 位数字密码' : '输入密码'
                }
                aria-label="数字密码"
                className="[&_[data-slot=input]]:text-center [&_[data-slot=input]]:tracking-[0.25em]"
              />

              {pinModal?.type === 'set' && (
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin2}
                  onChange={(e) => {
                    setPin2(e.target.value);
                    setPinErr(null);
                  }}
                  placeholder="再次确认数字密码"
                  aria-label="确认数字密码"
                  className="[&_[data-slot=input]]:text-center [&_[data-slot=input]]:tracking-[0.25em]"
                />
              )}

              {pinErr && (
                <Alert variant="error" className="py-2">
                  <AlertCircleIcon className="size-4" aria-hidden="true" />
                  <AlertDescription className="text-destructive-foreground">
                    {pinErr}
                  </AlertDescription>
                </Alert>
              )}
            </DialogPanel>

            <DialogFooter>
              <DialogClose render={<Button size="sm" variant="ghost" />}>
                取消
              </DialogClose>
              <Button size="sm" type="submit">
                确认
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      {/* Delete Group AlertDialog */}
      <AlertDialog
        open={deleteGroupOpen}
        onOpenChange={setDeleteGroupOpen}
        onOpenChangeComplete={(open) => {
          if (!open) setDeletingGroup(null);
        }}
      >
        <AlertDialogPopup className="max-w-xs">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">
              删除分组「{deletingGroup?.name ?? ''}」？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              删除分组不会删除里面的便签，该分组下的所有便签将自动移至「未分组」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button size="sm" variant="outline" />}>
              取消
            </AlertDialogClose>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleConfirmDeleteGroup}
            >
              确认删除
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      {/* Delete Note AlertDialog */}
      <AlertDialog
        open={deleteNoteOpen}
        onOpenChange={setDeleteNoteOpen}
        onOpenChangeComplete={(open) => {
          if (!open) setDeletingNote(null);
        }}
      >
        <AlertDialogPopup className="max-w-xs">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">删除这篇便签？</AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              将永久删除「{deletingNote?.title || '未命名便签'}」及其内容记录，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button size="sm" variant="outline" />}>
              取消
            </AlertDialogClose>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleConfirmDeleteNote}
            >
              确认删除
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
};

export default NoteLibraryView;
