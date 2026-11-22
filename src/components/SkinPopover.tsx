import React from 'react';
import { useDeskTagStore } from '../store/useDeskTagStore';
import { SKINS } from '../themes/skins';
import { SkinSwatchTile } from './Icons';

export const SkinPopover: React.FC = () => {
  const { data, platform, updateSyncedSettings, setShowSkinPopover } = useDeskTagStore();
  const currentSkinId = data.settings.skinId;
  const opacityPct = Math.round((data.settings.opacity ?? 1) * 100);

  return (
    <>
      <div className="popover-backdrop" onClick={() => setShowSkinPopover(false)} />
      <div className="floating-popover skin-popover" role="dialog" aria-label="切换皮肤">
        <div className="popover-header-row">
          <span className="popover-title">外观皮肤（11 款）</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>即时预览</span>
        </div>

        <div className="skin-grid-2col">
          {SKINS.map((skin) => {
            const selected = skin.id === currentSkinId;
            return (
              <button
                key={skin.id}
                type="button"
                className={`skin-option-btn${selected ? ' selected' : ''}`}
                onClick={() => updateSyncedSettings({ skinId: skin.id })}
              >
                <SkinSwatchTile swatch={skin.swatch} size={28} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {skin.name}
                </span>
              </button>
            );
          })}
        </div>

        {!platform.isMobile && (
          <div className="opacity-slider-row">
            <span>透明度</span>
            <input
              type="range"
              min={40}
              max={100}
              step={1}
              value={opacityPct}
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                updateSyncedSettings({ opacity: v });
              }}
              aria-label="面板透明度"
            />
            <span className="opacity-value">{opacityPct}%</span>
          </div>
        )}
      </div>
    </>
  );
};
