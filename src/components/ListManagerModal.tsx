import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Check, ListTodo, Pin, Plus, Trash2 } from 'lucide-react';
import { useDeskTagStore } from '../store/useDeskTagStore';
import type { TodoList } from '../types/models';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import { Frame, FramePanel } from '@/components/ui/frame';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';

const LIST_COLOR_PALETTE = [
  '#df6542',
  '#c6922d',
  '#4e7e57',
  '#4a8fbc',
  '#c07a84',
  '#956242',
  '#6f7fa8',
  '#7d6448',
];

export const ListManagerModal: React.FC = () => {
  const {
    showListManager,
    activeLists,
    activeTodos,
    setShowListManager,
    addList,
    updateList,
    deleteList,
    toggleListPin,
    reorderLists,
    showToast,
  } = useDeskTagStore();

  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(LIST_COLOR_PALETTE[0]);
  const [pinOnCreate, setPinOnCreate] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<{ list: TodoList; count: number } | null>(
    null,
  );

  const handleCreate = () => {
    const clean = newName.trim();
    if (!clean) return;
    addList(clean, newColor, pinOnCreate);
    setNewName('');
    showToast(`已创建清单「${clean}」`);
  };

  const moveList = (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= activeLists.length) return;
    const ids = activeLists.map((l) => l.id);
    const [moved] = ids.splice(idx, 1);
    ids.splice(targetIdx, 0, moved);
    reorderLists(ids);
  };

  return (
    <>
      <Dialog
        open={showListManager}
        onOpenChange={(open) => setShowListManager(open)}
      >
        <DialogPopup
          className="max-h-[min(86vh,580px)] max-w-[468px] overflow-hidden"
          closeProps={{ 'aria-label': '关闭管理清单' }}
        >
          <DialogHeader className="shrink-0 px-4 pt-3.5 pb-2">
            <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold">
              <ListTodo className="size-4 text-muted-foreground" />
              <span>管理清单与侧边页签</span>
            </DialogTitle>
          </DialogHeader>

          <DialogPanel className="flex flex-col gap-3 px-4 pt-1 pb-4">
            {/* Create List Frame */}
            <Frame>
              <FramePanel className="flex flex-col gap-3 p-3.5">
                <InputGroup>
                  <InputGroupInput
                    size="sm"
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreate();
                      }
                    }}
                    placeholder="输入新清单名称，如 工作项目 / 学习计划"
                  />
                  <InputGroupAddon align="inline-end">
                    <Button
                      size="xs"
                      variant="default"
                      disabled={!newName.trim()}
                      onClick={handleCreate}
                    >
                      <Plus className="size-3.5" />
                      <span>新建</span>
                    </Button>
                  </InputGroupAddon>
                </InputGroup>

                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-1.5" role="radiogroup" aria-label="选择清单颜色">
                    {LIST_COLOR_PALETTE.map((c) => {
                      const active = newColor.toLowerCase() === c.toLowerCase();
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewColor(c)}
                          aria-label={`选择颜色 ${c}`}
                          aria-pressed={active}
                          className={cn(
                            'inline-flex size-4.5 cursor-pointer items-center justify-center rounded-full transition-transform outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            active && 'scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-card',
                          )}
                          style={{ backgroundColor: c }}
                        >
                          {active && <Check className="size-2.5 text-white drop-shadow-xs" />}
                        </button>
                      );
                    })}
                  </div>

                  <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
                    <span>创建后固定到侧边</span>
                    <Switch
                      checked={pinOnCreate}
                      onCheckedChange={setPinOnCreate}
                      aria-label="创建后固定到侧边"
                    />
                  </label>
                </div>
              </FramePanel>
            </Frame>

            {/* Existing Lists Frame */}
            <Frame>
              {activeLists.length === 0 ? (
                <FramePanel className="py-7 text-center text-xs text-muted-foreground">
                  暂无自定义清单，可在上方新建
                </FramePanel>
              ) : (
                <FramePanel className="divide-y divide-border p-0">
                  {activeLists.map((list, idx) => {
                    const count = activeTodos.filter((t) => t.listId === list.id).length;
                    return (
                      <div
                        key={list.id}
                        className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-accent/40"
                      >
                        {/* Color Dot Picker Popover */}
                        <Popover>
                          <PopoverTrigger
                            render={
                              <button
                                type="button"
                                title="更改清单颜色"
                                aria-label={`更改清单 ${list.name} 颜色`}
                                className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border/80 shadow-xs/5 transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring outline-none"
                                style={{ backgroundColor: list.color }}
                              />
                            }
                          />
                          <PopoverPopup side="bottom" align="start" className="w-48">
                            <div className="flex flex-col gap-2.5">
                              <span className="text-xs font-medium text-foreground">
                                选择清单颜色
                              </span>
                              <div className="grid grid-cols-4 gap-2">
                                {LIST_COLOR_PALETTE.map((c) => {
                                  const selected =
                                    list.color.toLowerCase() === c.toLowerCase();
                                  return (
                                    <button
                                      key={c}
                                      type="button"
                                      onClick={() => updateList(list.id, { color: c })}
                                      aria-label={`设为颜色 ${c}`}
                                      className={cn(
                                        'inline-flex size-6 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-105',
                                        selected &&
                                          'ring-2 ring-foreground ring-offset-2 ring-offset-popover',
                                      )}
                                      style={{ backgroundColor: c }}
                                    >
                                      {selected && (
                                        <Check className="size-3 text-white drop-shadow-xs" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                              <Separator />
                              <label className="flex cursor-pointer items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span>自定义色值</span>
                                <input
                                  type="color"
                                  value={list.color}
                                  onChange={(e) =>
                                    updateList(list.id, { color: e.target.value })
                                  }
                                  className="h-5 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                                />
                              </label>
                            </div>
                          </PopoverPopup>
                        </Popover>

                        {/* Inline Editable Name */}
                        <input
                          type="text"
                          value={list.name}
                          onChange={(e) => updateList(list.id, { name: e.target.value })}
                          aria-label="清单名称"
                          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-foreground outline-none focus-visible:underline"
                        />

                        <Badge
                          variant="secondary"
                          size="sm"
                          className="shrink-0 tabular-nums"
                          title={`${count} 条待办`}
                        >
                          {count}
                        </Badge>

                        {/* Pin to Side Button */}
                        <Button
                          size="icon-xs"
                          variant={list.pinnedToSide ? 'secondary' : 'ghost'}
                          aria-pressed={list.pinnedToSide}
                          onClick={() => toggleListPin(list.id)}
                          title={list.pinnedToSide ? '取消固定到侧边' : '固定到侧边页签'}
                          aria-label={list.pinnedToSide ? '取消固定到侧边' : '固定到侧边页签'}
                          className={cn(
                            list.pinnedToSide
                              ? 'text-dt-accent-soft-text bg-dt-accent-soft border border-dt-accent-border'
                              : 'text-muted-foreground',
                          )}
                        >
                          <Pin className="size-3.5" />
                        </Button>

                        {/* Reorder Controls */}
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          disabled={idx === 0}
                          onClick={() => moveList(idx, -1)}
                          title="上移"
                          aria-label="上移清单"
                        >
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          disabled={idx === activeLists.length - 1}
                          onClick={() => moveList(idx, 1)}
                          title="下移"
                          aria-label="下移清单"
                        >
                          <ArrowDown className="size-3.5" />
                        </Button>

                        {/* Delete Trigger */}
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => setPendingDelete({ list, count })}
                          title="删除清单（其中待办将转为普通待办）"
                          aria-label={`删除清单 ${list.name}`}
                          className="text-muted-foreground hover:text-destructive-foreground"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </FramePanel>
              )}
            </Frame>
          </DialogPanel>

          <DialogFooter className="shrink-0 px-4 py-2.5">
            <DialogClose render={<Button size="sm" variant="default" />}>完成</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* Delete Confirmation AlertDialog */}
      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">
              确认删除清单「{pendingDelete?.list.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              {pendingDelete && pendingDelete.count > 0
                ? `该清单下包含 ${pendingDelete.count} 条待办，删除后这些待办将被保留并转为普通待办。`
                : '删除后该清单及其侧边页签将被移除，此操作无法撤销。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button size="sm" variant="ghost" />}>取消</AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (!pendingDelete) return;
                    deleteList(pendingDelete.list.id);
                    showToast(`已删除清单「${pendingDelete.list.name}」`);
                    setPendingDelete(null);
                  }}
                />
              }
            >
              确认删除
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
};
