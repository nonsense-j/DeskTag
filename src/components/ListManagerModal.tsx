import React, { useState } from 'react';
import { useDeskTagStore } from '../store/useDeskTagStore';
import { CloseIcon, PinIcon, PlusIcon, TrashIcon } from './Icons';

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

  if (!showListManager) return null;

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
    <div className="modal-overlay" onClick={() => setShowListManager(false)}>
      <div
        className="modal-card"
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="管理清单"
      >
        <div className="modal-header">
          <h3 className="modal-title">管理清单与侧边页签</h3>
          <button
            type="button"
            className="header-icon-btn"
            onClick={() => setShowListManager(false)}
            aria-label="关闭"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* Create List Card */}
          <div className="warm-card">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="field-input"
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
              <button type="button" className="btn btn-primary" onClick={handleCreate}>
                <PlusIcon size={14} />
                <span>新建</span>
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {LIST_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      background: c,
                      border: newColor === c ? '2px solid var(--text-primary)' : '2px solid transparent',
                    }}
                    aria-label={`选择颜色 ${c}`}
                  />
                ))}
              </div>
              <label className="nl-keep-raw-label">
                <input
                  type="checkbox"
                  checked={pinOnCreate}
                  onChange={(e) => setPinOnCreate(e.target.checked)}
                />
                <span>创建后固定到侧边</span>
              </label>
            </div>
          </div>

          {/* Existing Lists */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {activeLists.length === 0 ? (
              <div className="empty-hint-box">暂无自定义清单，可在上方新建</div>
            ) : (
              activeLists.map((list, idx) => {
                const count = activeTodos.filter((t) => t.listId === list.id).length;
                return (
                  <div
                    key={list.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-surface)',
                    }}
                  >
                    <input
                      type="color"
                      value={list.color}
                      onChange={(e) => updateList(list.id, { color: e.target.value })}
                      style={{
                        width: 22,
                        height: 22,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                      title="更改清单颜色"
                    />
                    <input
                      type="text"
                      value={list.name}
                      onChange={(e) => updateList(list.id, { name: e.target.value })}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: 'none',
                        background: 'transparent',
                        fontSize: 13.5,
                        fontWeight: 500,
                      }}
                    />
                    <span className="section-count-badge" title={`${count} 条待办`}>
                      {count}
                    </span>

                    <button
                      type="button"
                      className={`mini-icon-btn${list.pinnedToSide ? ' active' : ''}`}
                      style={
                        list.pinnedToSide
                          ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                          : undefined
                      }
                      onClick={() => toggleListPin(list.id)}
                      title={list.pinnedToSide ? '取消固定到侧边' : '固定到侧边页签'}
                    >
                      <PinIcon size={13.5} />
                    </button>

                    <button
                      type="button"
                      className="mini-icon-btn"
                      disabled={idx === 0}
                      onClick={() => moveList(idx, -1)}
                      title="上移"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="mini-icon-btn"
                      disabled={idx === activeLists.length - 1}
                      onClick={() => moveList(idx, 1)}
                      title="下移"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="mini-icon-btn danger"
                      onClick={() => {
                        deleteList(list.id);
                        showToast(`已删除清单「${list.name}」`);
                      }}
                      title="删除清单（其中待办将转为普通待办）"
                    >
                      <TrashIcon size={13.5} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowListManager(false)}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
