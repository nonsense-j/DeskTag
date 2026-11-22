import React from 'react';
import type { SkinSwatch } from '../themes/skins';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  strokeWidth?: number;
}

const baseProps = (size: number, strokeWidth: number): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
});

/** Minimalist DeskTag mascot badge shown in the panel header and About card */
export const MascotAvatar: React.FC<IconProps> = ({ size = 24, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true" {...rest}>
    <circle cx="14" cy="14" r="13" fill="var(--accent-soft)" stroke="var(--accent-border)" strokeWidth="1.2" />
    {/* Ears */}
    <path
      d="M7.5 11.2L8.6 6.8C8.8 6.1 9.6 5.9 10.1 6.4L12.7 8.9"
      fill="var(--bg-surface)"
      stroke="var(--text-primary)"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M20.5 11.2L19.4 6.8C19.2 6.1 18.4 5.9 17.9 6.4L15.3 8.9"
      fill="var(--bg-surface)"
      stroke="var(--text-primary)"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Head */}
    <ellipse cx="14" cy="15.2" rx="7.6" ry="6.5" fill="var(--bg-surface)" stroke="var(--text-primary)" strokeWidth="1.4" />
    {/* Eyes */}
    <circle cx="11.3" cy="14.5" r="1.15" fill="var(--text-primary)" />
    <circle cx="16.7" cy="14.5" r="1.15" fill="var(--text-primary)" />
    {/* Cheeks */}
    <ellipse cx="9.2" cy="16.3" rx="1.3" ry="0.75" fill="var(--accent)" opacity="0.45" />
    <ellipse cx="18.8" cy="16.3" rx="1.3" ry="0.75" fill="var(--accent)" opacity="0.45" />
    {/* Smile */}
    <path d="M12.6 16.8C13.1 17.5 14.9 17.5 15.4 16.8" stroke="var(--text-primary)" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

/** Original DeskTag theme swatch badge: rounded paper tile with duo palette circles and corner tag tab */
export const SkinSwatchTile: React.FC<{ swatch: SkinSwatch; size?: number }> = ({
  swatch,
  size = 28,
}) => (
  <span
    className="skin-swatch-tile"
    style={{
      width: size,
      height: size,
      background: swatch.paper,
    }}
    aria-hidden="true"
  >
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <path d="M18 0H28V10L18 0Z" fill={swatch.accent} opacity="0.24" />
      <circle cx="11.5" cy="14.5" r="5.6" fill={swatch.accent} />
      <circle cx="18.2" cy="17.2" r="4.1" fill={swatch.ink} stroke={swatch.paper} strokeWidth="1.5" />
    </svg>
  </span>
);

export const AutoHideIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M5 7l4.5 5L5 17" />
    <path d="M10.5 7l4.5 5-4.5 5" />
    <line x1="19" y1="6" x2="19" y2="18" />
  </svg>
);

export const PinIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M15.5 4.5l4 4-3 3 .8 4.2-3.1-3.1-4.8 4.8-1.4 1.6 1.6-1.4 4.8-4.8-3.1-3.1 4.2.8 3-3z" />
    <path d="M9.5 14.5L5 19" />
  </svg>
);

export const BellIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M18 8a6 6 0 1 0-12 0c0 6.5-3 8.5-3 8.5h18s-3-2-3-8.5" />
    <path d="M10.3 20a2 2 0 0 0 3.4 0" />
  </svg>
);

export const ShirtSkinIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M8.5 4.5L5 6.5 3 10.5l3 1.5 1-2.2V19.5h10V9.8l1 2.2 3-1.5-2-4-3.5-2a3.5 3.5 0 0 1-7 0z" />
  </svg>
);

export const MoreIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

export const CloseIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.7, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </svg>
);

export const MinimizeIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.7, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const MaximizeIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <rect x="5" y="5" width="14" height="14" rx="2.2" />
  </svg>
);

export const CalendarIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <line x1="8" y1="3" x2="8" y2="6.5" />
    <line x1="16" y1="3" x2="16" y2="6.5" />
    <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
  </svg>
);

export const QuadrantIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
  </svg>
);

export const SendIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M21 3L10 14" />
    <path d="M21 3l-6.5 18-4.5-7-7-4.5L21 3z" />
  </svg>
);

export const ChevronDownIcon: React.FC<IconProps> = ({ size = 14, strokeWidth = 1.75, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const ChevronRightIcon: React.FC<IconProps> = ({ size = 14, strokeWidth = 1.75, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const ChevronLeftIcon: React.FC<IconProps> = ({ size = 14, strokeWidth = 1.75, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

export const ArrowLeftIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.7, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M19 12H5" />
    <path d="M11 6l-6 6 6 6" />
  </svg>
);

export const CheckIcon: React.FC<IconProps> = ({ size = 13, strokeWidth = 2.2, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M4.5 12.5l5 5 10-10.5" />
  </svg>
);

export const AlarmIcon: React.FC<IconProps> = ({ size = 14, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <circle cx="12" cy="13" r="7.5" />
    <path d="M12 9.5V13l2.5 1.8" />
    <path d="M5 4.5L3 6.5" />
    <path d="M19 4.5l2 2" />
  </svg>
);

export const PlusIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.75, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const TrashIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M4 6.5h16" />
    <path d="M9.5 6.5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
    <path d="M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13" />
    <line x1="10" y1="11" x2="10" y2="16.5" />
    <line x1="14" y1="11" x2="14" y2="16.5" />
  </svg>
);

export const SearchIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <circle cx="10.8" cy="10.8" r="6.8" />
    <line x1="16" y1="16" x2="20.5" y2="20.5" />
  </svg>
);

export const MicIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <rect x="9" y="3.5" width="6" height="10.5" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <line x1="12" y1="18" x2="12" y2="21" />
    <line x1="8.5" y1="21" x2="15.5" y2="21" />
  </svg>
);

export const SettingsIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 0 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a1.9 1.9 0 0 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 0 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a1.9 1.9 0 0 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 0 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 .9-1.5V3a1.9 1.9 0 0 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 0 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5.9H21a1.9 1.9 0 0 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </svg>
);

export const CloudSyncIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M6.5 18.5h11a4 4 0 0 0 .8-7.9A5.5 5.5 0 0 0 7.6 8.8 4.2 4.2 0 0 0 6.5 18.5z" />
    <path d="M10 13.5l2-2 2 2" />
    <line x1="12" y1="11.5" x2="12" y2="16" />
  </svg>
);

export const ExportIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M12 4v11" />
    <path d="M7.5 10.5L12 15l4.5-4.5" />
    <path d="M4.5 17v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </svg>
);

export const PopoutIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <rect x="4" y="8" width="11" height="11" rx="2" />
    <path d="M9 8V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2" />
  </svg>
);

export const LockIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.2" />
    <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
  </svg>
);

export const UnlockIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.2" />
    <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.7-1.4" />
  </svg>
);

export const FolderIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M3.5 6.5a2 2 0 0 1 2-2h4.2l2 2h6.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11z" />
  </svg>
);

export const FileIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M6 3.5h8l4.5 4.5V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z" />
    <path d="M14 3.5V8h4.5" />
  </svg>
);

export const ImageIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
    <circle cx="9" cy="9.5" r="1.5" />
    <path d="M20.5 15.5l-4.5-4.5-6 6-2.5-2.5L3.5 18.5" />
  </svg>
);

export const TableIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
    <line x1="3.5" y1="14.5" x2="20.5" y2="14.5" />
    <line x1="9.5" y1="9.5" x2="9.5" y2="19.5" />
    <line x1="15" y1="9.5" x2="15" y2="19.5" />
  </svg>
);

export const OutlineIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <line x1="4" y1="6.5" x2="20" y2="6.5" />
    <line x1="8" y1="12" x2="20" y2="12" />
    <line x1="8" y1="17.5" x2="17" y2="17.5" />
  </svg>
);

export const LinkIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l2.4-2.4a4.5 4.5 0 0 0-6.4-6.4L11 6.6" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0L5.2 12.4a4.5 4.5 0 0 0 6.4 6.4L13 17.4" />
  </svg>
);

export const UndoIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 1 1 0 11H11" />
  </svg>
);

export const RefreshIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" />
    <path d="M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" />
    <path d="M20 20v-4h-4" />
  </svg>
);

export const CopyIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M5.5 15.5h-1a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5h9a1.5 1.5 0 0 1 1.5 1.5v1" />
  </svg>
);

export const FilterIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M4 5.5h16l-6.2 7.2v5.3l-3.6 1.8v-7.1L4 5.5z" />
  </svg>
);

export const TagIcon: React.FC<IconProps> = ({ size = 14, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M20 13.5l-6.5 6.5a2 2 0 0 1-2.8 0L4 13.3V4h9.3l6.7 6.7a2 2 0 0 1 0 2.8z" />
    <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const ClockIcon: React.FC<IconProps> = ({ size = 14, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const ListIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <line x1="8" y1="6.5" x2="20" y2="6.5" />
    <line x1="8" y1="12" x2="20" y2="12" />
    <line x1="8" y1="17.5" x2="20" y2="17.5" />
    <circle cx="4.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="17.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const RepeatIcon: React.FC<IconProps> = ({ size = 14, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M17 3l3 3-3 3" />
    <path d="M4 11V9a3 3 0 0 1 3-3h13" />
    <path d="M7 21l-3-3 3-3" />
    <path d="M20 13v2a3 3 0 0 1-3 3H4" />
  </svg>
);

export const SparklesIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3z" />
    <path d="M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
  </svg>
);

export const EditIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M15.5 4.5l4 4L9 19H5v-4L15.5 4.5z" />
  </svg>
);

export const NoteIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <path d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v10.5L15 20H6a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 6 3.5z" />
    <path d="M15 20v-4.5h4.5" />
    <line x1="8" y1="9" x2="16" y2="9" />
    <line x1="8" y1="13" x2="13" y2="13" />
  </svg>
);

export const TimelineIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <line x1="7" y1="4.5" x2="7" y2="19.5" />
    <circle cx="7" cy="7.5" r="2" fill="var(--bg-panel)" />
    <circle cx="7" cy="15.5" r="2" fill="var(--bg-panel)" />
    <line x1="12" y1="7.5" x2="20" y2="7.5" />
    <line x1="12" y1="15.5" x2="19" y2="15.5" />
  </svg>
);

export const AudioIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.65, ...rest }) => (
  <svg {...baseProps(size, strokeWidth)} {...rest}>
    <line x1="4" y1="10" x2="4" y2="14" />
    <line x1="8" y1="7" x2="8" y2="17" />
    <line x1="12" y1="4.5" x2="12" y2="19.5" />
    <line x1="16" y1="7.5" x2="16" y2="16.5" />
    <line x1="20" y1="10" x2="20" y2="14" />
  </svg>
);
