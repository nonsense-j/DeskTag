import { CheckIcon, MoonIcon, SunIcon } from 'lucide-react';
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useDeskTagStore } from '../store/useDeskTagStore';
import { SKINS, getSkinById, type SkinDefinition } from '../themes/skins';
import { SkinSwatchTile } from './Icons';

export interface SkinPopoverProps {
  /** Trigger element passed to PopoverTrigger `render` (childless button element) */
  trigger?: React.ReactElement;
  /** Content rendered inside the trigger element */
  children?: React.ReactNode;
  /** Optional desktop hover tooltip text */
  tooltipLabel?: string;
}

const LIGHT_SKINS = SKINS.filter((s) => s.mode === 'light');
const DARK_SKINS = SKINS.filter((s) => s.mode === 'dark');

export const SkinPopover: React.FC<SkinPopoverProps> = ({
  trigger,
  children,
  tooltipLabel,
}) => {
  const {
    data,
    platform,
    showSkinPopover,
    updateSyncedSettings,
    setShowSkinPopover,
    closeAllPopovers,
  } = useDeskTagStore();

  const currentSkinId = getSkinById(data.settings.skinId).id;
  const opacityPct = Math.round((data.settings.opacity ?? 1) * 100);

  const handleOpenChange = (open: boolean) => {
    if (open) {
      closeAllPopovers();
      setShowSkinPopover(true);
    } else {
      setShowSkinPopover(false);
    }
  };

  const renderSkinCard = (skin: SkinDefinition) => {
    const selected = skin.id === currentSkinId;
    return (
      <button
        key={skin.id}
        type="button"
        onClick={() => updateSyncedSettings({ skinId: skin.id })}
        aria-pressed={selected}
        className={cn(
          'group relative flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-popover',
          selected
            ? 'border-dt-accent bg-dt-accent-soft font-semibold text-dt-accent-soft-text shadow-xs/5'
            : 'border-border bg-card font-medium text-foreground hover:border-dt-accent-border/70 hover:bg-accent',
        )}
      >
        <SkinSwatchTile swatch={skin.swatch} size={24} />
        <span className="min-w-0 flex-1 truncate">{skin.name}</span>
        {selected && (
          <CheckIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-dt-accent-soft-text"
            strokeWidth={2.25}
          />
        )}
      </button>
    );
  };

  const headingNode = trigger ? (
    <PopoverTitle className="text-sm font-semibold text-foreground">外观皮肤</PopoverTitle>
  ) : (
    <span className="text-sm font-semibold text-foreground">外观皮肤</span>
  );

  const bodyContent = (
    <div className="flex flex-col">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {headingNode}
          <Badge size="sm" variant="secondary" className="tabular-nums">
            {SKINS.length} 款
          </Badge>
        </div>
        <span className="text-[11px] text-muted-foreground">即时预览</span>
      </div>

      <div className="flex h-[328px] max-h-[calc(100vh-220px)] min-h-[180px] flex-col">
        <ScrollArea className="-mx-1 flex-1 px-1" scrollFade>
          <div className="flex flex-col gap-3 pb-1.5">
            {/* Light Themes Group */}
            <section aria-label="浅色主题" className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between px-0.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <SunIcon aria-hidden="true" className="size-3 opacity-80" strokeWidth={1.85} />
                  <span>浅色主题</span>
                </span>
                <span className="text-[11px] text-muted-foreground/80 tabular-nums">
                  {LIGHT_SKINS.length}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {LIGHT_SKINS.map(renderSkinCard)}
              </div>
            </section>

            {/* Dark Themes Group */}
            <section aria-label="暗夜主题" className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between px-0.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <MoonIcon aria-hidden="true" className="size-3 opacity-80" strokeWidth={1.85} />
                  <span>暗夜主题</span>
                </span>
                <span className="text-[11px] text-muted-foreground/80 tabular-nums">
                  {DARK_SKINS.length}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {DARK_SKINS.map(renderSkinCard)}
              </div>
            </section>
          </div>
        </ScrollArea>
      </div>

      {!platform.isMobile && (
        <>
          <Separator className="my-2.5" />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">面板透明度</span>
              <Badge size="sm" variant="secondary" className="tabular-nums">
                {opacityPct}%
              </Badge>
            </div>
            <Slider
              getAriaLabel={() => '面板透明度'}
              max={100}
              min={40}
              onValueChange={(val) => {
                const next = Array.isArray(val) ? val[0] : val;
                if (typeof next === 'number' && Number.isFinite(next)) {
                  updateSyncedSettings({ opacity: next / 100 });
                }
              }}
              step={1}
              value={opacityPct}
            />
          </div>
        </>
      )}
    </div>
  );

  // Fallback standalone mode if rendered without an explicit trigger
  if (!trigger) {
    return (
      <>
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowSkinPopover(false)}
        />
        <div
          aria-label="切换皮肤"
          className="absolute top-12 right-3 z-50 w-[324px] max-w-[calc(100%-24px)] rounded-xl border bg-popover not-dark:bg-clip-padding p-3.5 text-popover-foreground shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
          role="dialog"
        >
          {bodyContent}
        </div>
      </>
    );
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={showSkinPopover}>
      {tooltipLabel ? (
        <Tooltip disabled={showSkinPopover}>
          <TooltipTrigger render={<PopoverTrigger render={trigger} />}>
            {children}
          </TooltipTrigger>
          <TooltipPopup side="bottom">{tooltipLabel}</TooltipPopup>
        </Tooltip>
      ) : (
        <PopoverTrigger render={trigger}>{children}</PopoverTrigger>
      )}

      <PopoverPopup
        align="end"
        aria-label="切换皮肤与透明度"
        className="w-[324px] max-w-[calc(100vw-24px)]"
        side="bottom"
        sideOffset={6}
      >
        {bodyContent}
      </PopoverPopup>
    </Popover>
  );
};
