export interface SkinSwatch {
  paper: string;
  accent: string;
  ink: string;
}

export interface SkinColors {
  panelBg: string;
  headerBg: string;
  surfaceBg: string;
  surfaceHover: string;
  inputBg: string;
  cardBg: string;
  popoverBg: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textCompleted: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  accentSoftText: string;
  accentBorder: string;
  accentText: string;
  activeTabBg: string;
  activeTabText: string;
  inactiveTabBg: string;
  inactiveTabText: string;
  inactiveTabHoverBg: string;
  activePillBg: string;
  activePillText: string;
  priorityHigh: string;
  priorityMedium: string;
  priorityLow: string;
  progressBorder: string;
  progressFill: string;
  progressText: string;
  tagBg: string;
  tagBorder: string;
  tagText: string;
  danger: string;
  dangerSoft: string;
  success: string;
  warning: string;
  shadow: string;
  shadowStrong: string;
}

export interface SkinDefinition {
  id: string;
  name: string;
  mode: 'light' | 'dark';
  swatch: SkinSwatch;
  colors: SkinColors;
}

export interface FontOption {
  id: string;
  label: string;
  stack: string;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'system',
    label: '系统默认',
    stack:
      "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  },
  {
    id: 'yahei',
    label: '微软雅黑',
    stack: "'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', sans-serif",
  },
  {
    id: 'pingfang',
    label: '苹方 / 思源黑体',
    stack: "'PingFang SC', 'Noto Sans SC', 'Source Han Sans SC', 'Segoe UI', sans-serif",
  },
  {
    id: 'serif',
    label: '温润宋体 / 衬线',
    stack: "'Songti SC', 'Noto Serif SC', 'STSong', 'SimSun', Georgia, serif",
  },
  {
    id: 'kai',
    label: '手写楷体',
    stack: "'Kaiti SC', 'STKaiti', 'KaiTi', 'BiauKai', serif",
  },
  {
    id: 'mono',
    label: '等宽清晰',
    stack: "'Cascadia Mono', 'JetBrains Mono', 'SF Mono', Consolas, 'Microsoft YaHei', monospace",
  },
];

export function getFontFamilyStack(fontId: string): string {
  const found = FONT_OPTIONS.find((f) => f.id === fontId);
  if (found) return found.stack;
  if (fontId && fontId !== 'system') return fontId;
  return FONT_OPTIONS[0].stack;
}

/**
 * 12 DeskTag skins (10 light + 2 dark).
 * Default skin (index 0): `ink-minimal` (authentic pure `@coss/style` neutral light).
 * Dark skins: `coss-dark` (authentic pure `@coss/style` dark) & `midnight-ember`.
 */
export const SKINS: SkinDefinition[] = [
  {
    id: 'ink-minimal',
    name: '素墨极简',
    mode: 'light',
    swatch: { paper: '#ffffff', accent: '#262626', ink: '#737373' },
    colors: {
      panelBg: '#ffffff',
      headerBg: '#fafafa',
      surfaceBg: '#ffffff',
      surfaceHover: '#f5f5f5',
      inputBg: '#ffffff',
      cardBg: '#ffffff',
      popoverBg: '#ffffff',
      border: 'rgba(0, 0, 0, 0.08)',
      borderStrong: 'rgba(0, 0, 0, 0.14)',
      textPrimary: '#262626',
      textSecondary: '#525252',
      textMuted: '#737373',
      textCompleted: '#a3a3a3',
      accent: '#262626',
      accentHover: '#171717',
      accentSoft: '#f5f5f5',
      accentSoftText: '#262626',
      accentBorder: 'rgba(0, 0, 0, 0.14)',
      accentText: '#fafafa',
      activeTabBg: '#262626',
      activeTabText: '#fafafa',
      inactiveTabBg: '#f5f5f5',
      inactiveTabText: '#525252',
      inactiveTabHoverBg: '#ebebeb',
      activePillBg: '#262626',
      activePillText: '#fafafa',
      priorityHigh: '#ef4444',
      priorityMedium: '#f59e0b',
      priorityLow: '#10b981',
      progressBorder: '#525252',
      progressFill: 'rgba(38, 38, 38, 0.14)',
      progressText: '#404040',
      tagBg: '#f5f5f5',
      tagBorder: 'rgba(0, 0, 0, 0.08)',
      tagText: '#525252',
      danger: '#ef4444',
      dangerSoft: 'rgba(239, 68, 68, 0.08)',
      success: '#10b981',
      warning: '#f59e0b',
      shadow: '0 8px 28px rgba(0, 0, 0, 0.07)',
      shadowStrong: '0 14px 38px rgba(0, 0, 0, 0.12)',
    },
  },
  {
    id: 'morning-linen',
    name: '晨光亚麻',
    mode: 'light',
    swatch: { paper: '#fcfbf7', accent: '#df6542', ink: '#4e7e57' },
    colors: {
      panelBg: '#fcfbf7',
      headerBg: '#f5f2ea',
      surfaceBg: '#ffffff',
      surfaceHover: '#f4efe7',
      inputBg: '#ffffff',
      cardBg: '#ffffff',
      popoverBg: '#fffefb',
      border: '#e2ded2',
      borderStrong: '#cfc9ba',
      textPrimary: '#2c2824',
      textSecondary: '#625b53',
      textMuted: '#928b82',
      textCompleted: '#a8a198',
      accent: '#df6542',
      accentHover: '#cb5331',
      accentSoft: '#f9e6de',
      accentSoftText: '#b54524',
      accentBorder: '#e8ad99',
      accentText: '#ffffff',
      activeTabBg: '#df6542',
      activeTabText: '#ffffff',
      inactiveTabBg: '#f4ded4',
      inactiveTabText: '#724435',
      inactiveTabHoverBg: '#edd0c3',
      activePillBg: '#f9e6de',
      activePillText: '#b54524',
      priorityHigh: '#d94d4a',
      priorityMedium: '#cf9e36',
      priorityLow: '#4e7e57',
      progressBorder: '#66948a',
      progressFill: 'rgba(102, 148, 138, 0.24)',
      progressText: '#3d6960',
      tagBg: '#f4ede6',
      tagBorder: '#e4d5c8',
      tagText: '#715445',
      danger: '#d44643',
      dangerSoft: '#fceae9',
      success: '#4e7e57',
      warning: '#cf932e',
      shadow: '0 8px 28px rgba(44, 38, 30, 0.11)',
      shadowStrong: '0 14px 38px rgba(44, 38, 30, 0.17)',
    },
  },
  {
    id: 'kraft-journal',
    name: '牛皮手账',
    mode: 'light',
    swatch: { paper: '#f6f2ea', accent: '#7d6448', ink: '#647360' },
    colors: {
      panelBg: '#f6f2ea',
      headerBg: '#ece6da',
      surfaceBg: '#fbf9f4',
      surfaceHover: '#ede7db',
      inputBg: '#fcfaf6',
      cardBg: '#fbf9f4',
      popoverBg: '#fcfaf5',
      border: '#d6cebe',
      borderStrong: '#c2b8a4',
      textPrimary: '#332d26',
      textSecondary: '#645b4f',
      textMuted: '#918678',
      textCompleted: '#a89e90',
      accent: '#7d6448',
      accentHover: '#6a543b',
      accentSoft: '#ebe3d8',
      accentSoftText: '#5c4630',
      accentBorder: '#c2b09b',
      accentText: '#ffffff',
      activeTabBg: '#7d6448',
      activeTabText: '#ffffff',
      inactiveTabBg: '#dfd7c8',
      inactiveTabText: '#554736',
      inactiveTabHoverBg: '#d4cab6',
      activePillBg: '#ebe3d8',
      activePillText: '#5c4630',
      priorityHigh: '#d64c49',
      priorityMedium: '#cc9c38',
      priorityLow: '#647360',
      progressBorder: '#647360',
      progressFill: 'rgba(100, 115, 96, 0.24)',
      progressText: '#475744',
      tagBg: '#ede6db',
      tagBorder: '#d7cdbc',
      tagText: '#625241',
      danger: '#c74643',
      dangerSoft: '#f8e5e4',
      success: '#5e7859',
      warning: '#c28b32',
      shadow: '0 8px 28px rgba(51, 45, 38, 0.12)',
      shadowStrong: '0 14px 38px rgba(51, 45, 38, 0.18)',
    },
  },
  {
    id: 'apricot-cloud',
    name: '晴云杏桃',
    mode: 'light',
    swatch: { paper: '#fcf7f2', accent: '#d98962', ink: '#6f886b' },
    colors: {
      panelBg: '#fcf7f2',
      headerBg: '#f6eee5',
      surfaceBg: '#fffdfb',
      surfaceHover: '#f4eae1',
      inputBg: '#fffefc',
      cardBg: '#fffdfb',
      popoverBg: '#fffdfb',
      border: '#e5d5c8',
      borderStrong: '#d4bfae',
      textPrimary: '#342c27',
      textSecondary: '#6a5b52',
      textMuted: '#99897f',
      textCompleted: '#b0a197',
      accent: '#d98962',
      accentHover: '#c6754e',
      accentSoft: '#f8e9e0',
      accentSoftText: '#9c4f2c',
      accentBorder: '#e5b8a0',
      accentText: '#ffffff',
      activeTabBg: '#d98962',
      activeTabText: '#ffffff',
      inactiveTabBg: '#f3dfd4',
      inactiveTabText: '#724a36',
      inactiveTabHoverBg: '#ecd1c2',
      activePillBg: '#f8e9e0',
      activePillText: '#9c4f2c',
      priorityHigh: '#da4f4c',
      priorityMedium: '#cf9f39',
      priorityLow: '#6f886b',
      progressBorder: '#6f886b',
      progressFill: 'rgba(111, 136, 107, 0.24)',
      progressText: '#4c6449',
      tagBg: '#f5ebe4',
      tagBorder: '#e5d3c6',
      tagText: '#745647',
      danger: '#d44845',
      dangerSoft: '#fceae9',
      success: '#64825f',
      warning: '#cc9236',
      shadow: '0 8px 28px rgba(52, 44, 39, 0.11)',
      shadowStrong: '0 14px 38px rgba(52, 44, 39, 0.17)',
    },
  },
  {
    id: 'bamboo-dew',
    name: '竹影青露',
    mode: 'light',
    swatch: { paper: '#f4f5ee', accent: '#5e8a62', ink: '#a8905e' },
    colors: {
      panelBg: '#f4f5ee',
      headerBg: '#eaede2',
      surfaceBg: '#fbfcf8',
      surfaceHover: '#e8ece0',
      inputBg: '#fcfdf9',
      cardBg: '#fbfcf8',
      popoverBg: '#fcfdf9',
      border: '#d3d9c8',
      borderStrong: '#bec7b0',
      textPrimary: '#2a3129',
      textSecondary: '#586356',
      textMuted: '#869183',
      textCompleted: '#9da69a',
      accent: '#5e8a62',
      accentHover: '#4d7751',
      accentSoft: '#e4ede2',
      accentSoftText: '#385e3c',
      accentBorder: '#acc4ae',
      accentText: '#ffffff',
      activeTabBg: '#5e8a62',
      activeTabText: '#ffffff',
      inactiveTabBg: '#d8e3d5',
      inactiveTabText: '#3b573e',
      inactiveTabHoverBg: '#cad9c6',
      activePillBg: '#e4ede2',
      activePillText: '#385e3c',
      priorityHigh: '#d64c49',
      priorityMedium: '#c4963c',
      priorityLow: '#5e8a62',
      progressBorder: '#5e8a62',
      progressFill: 'rgba(94, 138, 98, 0.24)',
      progressText: '#3b613f',
      tagBg: '#e9ede1',
      tagBorder: '#cfd8c2',
      tagText: '#4c624b',
      danger: '#cc4845',
      dangerSoft: '#f9e7e6',
      success: '#507d55',
      warning: '#a8905e',
      shadow: '0 8px 28px rgba(42, 49, 41, 0.11)',
      shadowStrong: '0 14px 38px rgba(42, 49, 41, 0.17)',
    },
  },
  {
    id: 'amber-tea',
    name: '琥珀乌龙',
    mode: 'light',
    swatch: { paper: '#fbf5ec', accent: '#d68638', ink: '#3b3126' },
    colors: {
      panelBg: '#fbf5ec',
      headerBg: '#f4eadb',
      surfaceBg: '#fffcf7',
      surfaceHover: '#f2e6d5',
      inputBg: '#fffdfa',
      cardBg: '#fffcf7',
      popoverBg: '#fffcf8',
      border: '#e2d4bf',
      borderStrong: '#cfbe9f',
      textPrimary: '#3b3126',
      textSecondary: '#6b5c4b',
      textMuted: '#998976',
      textCompleted: '#afa18f',
      accent: '#d68638',
      accentHover: '#c07328',
      accentSoft: '#f7ead6',
      accentSoftText: '#945415',
      accentBorder: '#e2bc8e',
      accentText: '#ffffff',
      activeTabBg: '#d68638',
      activeTabText: '#ffffff',
      inactiveTabBg: '#f2dfc4',
      inactiveTabText: '#724a20',
      inactiveTabHoverBg: '#ebd2ae',
      activePillBg: '#f7ead6',
      activePillText: '#945415',
      priorityHigh: '#d94d4a',
      priorityMedium: '#d68638',
      priorityLow: '#5a8858',
      progressBorder: '#6e9790',
      progressFill: 'rgba(110, 151, 144, 0.24)',
      progressText: '#426b64',
      tagBg: '#f4e9d8',
      tagBorder: '#e2d0b4',
      tagText: '#745432',
      danger: '#d44845',
      dangerSoft: '#fceae9',
      success: '#588556',
      warning: '#cc8229',
      shadow: '0 8px 28px rgba(59, 49, 38, 0.12)',
      shadowStrong: '0 14px 38px rgba(59, 49, 38, 0.18)',
    },
  },
  {
    id: 'roasted-mocha',
    name: '烘焙摩卡',
    mode: 'light',
    swatch: { paper: '#f5efe8', accent: '#956242', ink: '#312922' },
    colors: {
      panelBg: '#f5efe8',
      headerBg: '#ebe3d8',
      surfaceBg: '#fbf8f4',
      surfaceHover: '#eae0d4',
      inputBg: '#fcfaf7',
      cardBg: '#fbf8f4',
      popoverBg: '#fcf9f5',
      border: '#d9ccb9',
      borderStrong: '#c5b49e',
      textPrimary: '#312922',
      textSecondary: '#635649',
      textMuted: '#908274',
      textCompleted: '#a89b8e',
      accent: '#956242',
      accentHover: '#805134',
      accentSoft: '#ece2d8',
      accentSoftText: '#6f4226',
      accentBorder: '#c9aa94',
      accentText: '#ffffff',
      activeTabBg: '#956242',
      activeTabText: '#ffffff',
      inactiveTabBg: '#e4d3c4',
      inactiveTabText: '#5e3c26',
      inactiveTabHoverBg: '#dac4b1',
      activePillBg: '#ece2d8',
      activePillText: '#6f4226',
      priorityHigh: '#d44b48',
      priorityMedium: '#cc9b3a',
      priorityLow: '#5e8458',
      progressBorder: '#75928c',
      progressFill: 'rgba(117, 146, 140, 0.24)',
      progressText: '#476560',
      tagBg: '#ece3d8',
      tagBorder: '#d8c8b6',
      tagText: '#694a34',
      danger: '#cb4744',
      dangerSoft: '#f8e5e4',
      success: '#5c8154',
      warning: '#c28632',
      shadow: '0 8px 28px rgba(49, 41, 34, 0.12)',
      shadowStrong: '0 14px 38px rgba(49, 41, 34, 0.18)',
    },
  },
  {
    id: 'sakura-dusk',
    name: '暮色樱云',
    mode: 'light',
    swatch: { paper: '#faf4f3', accent: '#c07a84', ink: '#3a2d30' },
    colors: {
      panelBg: '#faf4f3',
      headerBg: '#f4e9ea',
      surfaceBg: '#fffcfd',
      surfaceHover: '#f2e6e7',
      inputBg: '#fffdfd',
      cardBg: '#fffcfd',
      popoverBg: '#fffcfd',
      border: '#e5d4d6',
      borderStrong: '#d4bcc0',
      textPrimary: '#3a2d30',
      textSecondary: '#6d5a5f',
      textMuted: '#9c8a8f',
      textCompleted: '#b2a1a6',
      accent: '#c07a84',
      accentHover: '#ac6670',
      accentSoft: '#f5e4e6',
      accentSoftText: '#8f4350',
      accentBorder: '#dfb5bc',
      accentText: '#ffffff',
      activeTabBg: '#c07a84',
      activeTabText: '#ffffff',
      inactiveTabBg: '#f1dce0',
      inactiveTabText: '#724149',
      inactiveTabHoverBg: '#e9cdd2',
      activePillBg: '#f5e4e6',
      activePillText: '#8f4350',
      priorityHigh: '#d64c4d',
      priorityMedium: '#ce9e3c',
      priorityLow: '#5e8a64',
      progressBorder: '#7d969d',
      progressFill: 'rgba(125, 150, 157, 0.24)',
      progressText: '#49636b',
      tagBg: '#f4e8ea',
      tagBorder: '#e3cfd3',
      tagText: '#764e56',
      danger: '#cf484a',
      dangerSoft: '#fbe8e9',
      success: '#5c8762',
      warning: '#c88e3a',
      shadow: '0 8px 28px rgba(58, 45, 48, 0.11)',
      shadowStrong: '0 14px 38px rgba(58, 45, 48, 0.17)',
    },
  },
  {
    id: 'ginkgo-gold',
    name: '银杏微光',
    mode: 'light',
    swatch: { paper: '#fbf8ee', accent: '#c6922d', ink: '#383124' },
    colors: {
      panelBg: '#fbf8ee',
      headerBg: '#f4eee0',
      surfaceBg: '#fffdf8',
      surfaceHover: '#f1e9d6',
      inputBg: '#fffefa',
      cardBg: '#fffdf8',
      popoverBg: '#fffdf9',
      border: '#e1d7bd',
      borderStrong: '#cec09d',
      textPrimary: '#383124',
      textSecondary: '#685e49',
      textMuted: '#968b75',
      textCompleted: '#ada38e',
      accent: '#c6922d',
      accentHover: '#b17f1f',
      accentSoft: '#f5edd4',
      accentSoftText: '#835b10',
      accentBorder: '#dec587',
      accentText: '#ffffff',
      activeTabBg: '#c6922d',
      activeTabText: '#ffffff',
      inactiveTabBg: '#f2e1b6',
      inactiveTabText: '#694e18',
      inactiveTabHoverBg: '#ead49d',
      activePillBg: '#f5edd4',
      activePillText: '#835b10',
      priorityHigh: '#d94d4a',
      priorityMedium: '#c6922d',
      priorityLow: '#5a8756',
      progressBorder: '#6f9790',
      progressFill: 'rgba(111, 151, 144, 0.24)',
      progressText: '#436b64',
      tagBg: '#f3ecd9',
      tagBorder: '#dfd2b2',
      tagText: '#6c582e',
      danger: '#d44845',
      dangerSoft: '#fceae9',
      success: '#5a8655',
      warning: '#bd861d',
      shadow: '0 8px 28px rgba(56, 49, 36, 0.11)',
      shadowStrong: '0 14px 38px rgba(56, 49, 36, 0.17)',
    },
  },
  {
    id: 'glacier-mist',
    name: '冰川海雾',
    mode: 'light',
    swatch: { paper: '#f9fcff', accent: '#73b4de', ink: '#2c4459' },
    colors: {
      panelBg: '#f9fcff',
      headerBg: '#e4f2fc',
      surfaceBg: '#ffffff',
      surfaceHover: '#edf6fd',
      inputBg: '#ffffff',
      cardBg: '#ffffff',
      popoverBg: '#ffffff',
      border: '#c4dce9',
      borderStrong: '#a7c8dc',
      textPrimary: '#24384a',
      textSecondary: '#50687d',
      textMuted: '#7f97ab',
      textCompleted: '#9badbc',
      accent: '#4a8fbc',
      accentHover: '#3a7da9',
      accentSoft: '#e2f1fb',
      accentSoftText: '#215375',
      accentBorder: '#9bc7e3',
      accentText: '#ffffff',
      activeTabBg: '#73b4de',
      activeTabText: '#1c3244',
      inactiveTabBg: '#d4ecfa',
      inactiveTabText: '#2c4c66',
      inactiveTabHoverBg: '#c0e2f7',
      activePillBg: '#e2f1fb',
      activePillText: '#215375',
      priorityHigh: '#d94d4a',
      priorityMedium: '#cf9e36',
      priorityLow: '#4f8c67',
      progressBorder: '#609ec7',
      progressFill: 'rgba(96, 158, 199, 0.24)',
      progressText: '#2a5f82',
      tagBg: '#ebf5fc',
      tagBorder: '#c6dff0',
      tagText: '#355e7a',
      danger: '#d44845',
      dangerSoft: '#fceae9',
      success: '#4a8b65',
      warning: '#c88e2e',
      shadow: '0 8px 28px rgba(36, 56, 74, 0.11)',
      shadowStrong: '0 14px 38px rgba(36, 56, 74, 0.17)',
    },
  },
  {
    id: 'coss-dark',
    name: '极夜纯粹',
    mode: 'dark',
    swatch: { paper: '#121212', accent: '#f5f5f5', ink: '#737373' },
    colors: {
      panelBg: '#121212',
      headerBg: '#141414',
      surfaceBg: '#171717',
      surfaceHover: '#1f1f1f',
      inputBg: '#171717',
      cardBg: '#171717',
      popoverBg: '#171717',
      border: 'rgba(255, 255, 255, 0.06)',
      borderStrong: 'rgba(255, 255, 255, 0.12)',
      textPrimary: '#f5f5f5',
      textSecondary: '#a3a3a3',
      textMuted: '#737373',
      textCompleted: '#525252',
      accent: '#f5f5f5',
      accentHover: '#e5e5e5',
      accentSoft: 'rgba(255, 255, 255, 0.08)',
      accentSoftText: '#f5f5f5',
      accentBorder: 'rgba(255, 255, 255, 0.14)',
      accentText: '#262626',
      activeTabBg: '#f5f5f5',
      activeTabText: '#171717',
      inactiveTabBg: '#1c1c1c',
      inactiveTabText: '#a3a3a3',
      inactiveTabHoverBg: '#262626',
      activePillBg: 'rgba(255, 255, 255, 0.12)',
      activePillText: '#f5f5f5',
      priorityHigh: '#f87171',
      priorityMedium: '#fbbf24',
      priorityLow: '#34d399',
      progressBorder: '#a3a3a3',
      progressFill: 'rgba(255, 255, 255, 0.16)',
      progressText: '#d4d4d4',
      tagBg: 'rgba(255, 255, 255, 0.06)',
      tagBorder: 'rgba(255, 255, 255, 0.08)',
      tagText: '#d4d4d4',
      danger: '#f87171',
      dangerSoft: 'rgba(239, 68, 68, 0.16)',
      success: '#34d399',
      warning: '#fbbf24',
      shadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
      shadowStrong: '0 16px 44px rgba(0, 0, 0, 0.65)',
    },
  },
  {
    id: 'midnight-ember',
    name: '暗夜余烬',
    mode: 'dark',
    swatch: { paper: '#23201d', accent: '#e09b42', ink: '#f2ece4' },
    colors: {
      panelBg: '#23201d',
      headerBg: '#2b2723',
      surfaceBg: '#2f2a25',
      surfaceHover: '#39332d',
      inputBg: '#1c1917',
      cardBg: '#2f2a25',
      popoverBg: '#2d2823',
      border: '#50473e',
      borderStrong: '#665b50',
      textPrimary: '#f2ece4',
      textSecondary: '#c4b8ac',
      textMuted: '#8f8377',
      textCompleted: '#70655b',
      accent: '#e09b42',
      accentHover: '#eba852',
      accentSoft: '#3f3422',
      accentSoftText: '#f5be70',
      accentBorder: '#8c6934',
      accentText: '#201c18',
      activeTabBg: '#e09b42',
      activeTabText: '#201c18',
      inactiveTabBg: '#47361d',
      inactiveTabText: '#e8c796',
      inactiveTabHoverBg: '#594424',
      activePillBg: '#3f3422',
      activePillText: '#f5be70',
      priorityHigh: '#eb6c69',
      priorityMedium: '#e3b552',
      priorityLow: '#7fb078',
      progressBorder: '#7faea8',
      progressFill: 'rgba(127, 174, 168, 0.25)',
      progressText: '#a8cfc9',
      tagBg: '#37302a',
      tagBorder: '#52483e',
      tagText: '#d6c6b6',
      danger: '#eb6c69',
      dangerSoft: 'rgba(235, 108, 105, 0.18)',
      success: '#7bb074',
      warning: '#e0a244',
      shadow: '0 10px 30px rgba(0, 0, 0, 0.44)',
      shadowStrong: '0 16px 42px rgba(0, 0, 0, 0.58)',
    },
  },
];

/** Backwards-compatibility map from v1.0.0 theme IDs to DeskTag v1.0.1+ original theme IDs. */
const LEGACY_SKIN_ID_ALIASES: Record<string, string> = {
  'warm-order': 'morning-linen',
  'paper-companion': 'kraft-journal',
  'modern-warm': 'apricot-cloud',
  'matcha-calm': 'bamboo-dew',
  'honey-apricot': 'amber-tea',
  'caramel-latte': 'roasted-mocha',
  'rose-mist': 'sakura-dusk',
  'butter-chestnut': 'ginkgo-gold',
  'sea-salt-blue': 'glacier-mist',
  'minimal-fresh': 'ink-minimal',
  'dark-heal': 'midnight-ember',
};

export function getSkinById(id: string): SkinDefinition {
  const resolvedId = LEGACY_SKIN_ID_ALIASES[id] ?? id;
  return SKINS.find((s) => s.id === resolvedId) ?? SKINS[0];
}

export function applySkinToDocument(
  skin: SkinDefinition,
  opacity: number,
  fontFamily: string,
  bodyFontSize: number,
  uiFontSize: number,
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const c = skin.colors;
  const isDark = skin.mode === 'dark';
  const isPureNeutralLight = skin.id === 'ink-minimal';
  const isPureNeutralDark = skin.id === 'coss-dark';

  root.setAttribute('data-skin', skin.id);
  root.setAttribute('data-theme', skin.mode);
  root.classList.toggle('dark', isDark);
  root.style.colorScheme = isDark ? 'dark' : 'light';

  const clampedOpacity = Math.max(0.4, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
  const clampedBody = Math.max(11, Math.min(20, Math.round(bodyFontSize || 14)));
  const clampedUi = Math.max(11, Math.min(18, Math.round(uiFontSize || 13)));

  // Hairline translucent borders & subtle surface tints matched to each skin's hue
  const cossBorder = isPureNeutralLight
    ? 'rgba(0, 0, 0, 0.08)'
    : isPureNeutralDark
      ? 'rgba(255, 255, 255, 0.06)'
      : isDark
        ? `color-mix(in srgb, ${c.textPrimary} 11%, transparent)`
        : `color-mix(in srgb, ${c.textPrimary} 10%, transparent)`;

  const cossInput = isPureNeutralLight
    ? 'rgba(0, 0, 0, 0.10)'
    : isPureNeutralDark
      ? 'rgba(255, 255, 255, 0.08)'
      : isDark
        ? `color-mix(in srgb, ${c.textPrimary} 15%, transparent)`
        : `color-mix(in srgb, ${c.textPrimary} 13%, transparent)`;

  const cossSubtleTint = isPureNeutralLight
    ? 'rgba(0, 0, 0, 0.04)'
    : isPureNeutralDark
      ? 'rgba(255, 255, 255, 0.04)'
      : isDark
        ? `color-mix(in srgb, ${c.textPrimary} 6%, transparent)`
        : `color-mix(in srgb, ${c.textPrimary} 4.5%, transparent)`;

  const cossMutedForeground = isPureNeutralLight
    ? 'color-mix(in srgb, #737373 90%, #000000)'
    : isPureNeutralDark
      ? 'color-mix(in srgb, #737373 90%, #ffffff)'
      : `color-mix(in srgb, ${c.textSecondary} 72%, ${c.textMuted})`;

  const cossRing = isPureNeutralLight
    ? '#a3a3a3'
    : isPureNeutralDark
      ? '#737373'
      : c.accentBorder;

  const cossDestructive = isPureNeutralLight
    ? '#ef4444'
    : isPureNeutralDark
      ? 'color-mix(in srgb, #ef4444 90%, #ffffff)'
      : c.danger;

  const cossDestructiveFg = isPureNeutralLight
    ? '#b91c1c'
    : isPureNeutralDark
      ? '#f87171'
      : isDark
        ? `color-mix(in srgb, ${c.danger} 78%, #ffffff)`
        : `color-mix(in srgb, ${c.danger} 82%, #000000)`;

  const cossSuccess = isPureNeutralLight || isPureNeutralDark ? '#10b981' : c.success;
  const cossSuccessFg = isPureNeutralLight
    ? '#047857'
    : isPureNeutralDark
      ? '#34d399'
      : isDark
        ? `color-mix(in srgb, ${c.success} 78%, #ffffff)`
        : `color-mix(in srgb, ${c.success} 82%, #000000)`;

  const cossWarning = isPureNeutralLight || isPureNeutralDark ? '#f59e0b' : c.warning;
  const cossWarningFg = isPureNeutralLight
    ? '#b45309'
    : isPureNeutralDark
      ? '#fbbf24'
      : isDark
        ? `color-mix(in srgb, ${c.warning} 78%, #ffffff)`
        : `color-mix(in srgb, ${c.warning} 82%, #000000)`;

  const cossInfo = '#3b82f6';
  const cossInfoFg = isDark ? '#60a5fa' : '#1d4ed8';

  const cossSidebarBorder = isPureNeutralLight
    ? 'rgba(0, 0, 0, 0.06)'
    : isPureNeutralDark
      ? 'rgba(255, 255, 255, 0.05)'
      : `color-mix(in srgb, ${c.textPrimary} 8%, transparent)`;

  const cossSidebarFg = isPureNeutralLight
    ? 'color-mix(in srgb, #262626 64%, #fafafa)'
    : isPureNeutralDark
      ? 'color-mix(in srgb, #f5f5f5 64%, #141414)'
      : c.textSecondary;

  const cossFrameWell = isPureNeutralLight
    ? 'rgba(0, 0, 0, 0.032)'
    : isPureNeutralDark
      ? 'rgba(255, 255, 255, 0.032)'
      : isDark
        ? `color-mix(in srgb, ${c.headerBg} 82%, #000000)`
        : `color-mix(in srgb, ${c.headerBg} 76%, ${c.panelBg})`;

  const vars: Record<string, string> = {
    // --- coss ui semantic tokens ---
    '--background': c.panelBg,
    '--foreground': c.textPrimary,
    '--card': c.cardBg,
    '--card-foreground': c.textPrimary,
    '--popover': c.popoverBg,
    '--popover-foreground': c.textPrimary,
    '--primary': c.accent,
    '--primary-foreground': c.accentText,
    '--secondary': cossSubtleTint,
    '--secondary-foreground': c.textPrimary,
    '--muted': cossSubtleTint,
    '--muted-foreground': cossMutedForeground,
    '--accent': cossSubtleTint,
    '--accent-foreground': c.textPrimary,
    '--border': cossBorder,
    '--input': cossInput,
    '--ring': cossRing,
    '--destructive': cossDestructive,
    '--destructive-foreground': cossDestructiveFg,
    '--info': cossInfo,
    '--info-foreground': cossInfoFg,
    '--success': cossSuccess,
    '--success-foreground': cossSuccessFg,
    '--warning': cossWarning,
    '--warning-foreground': cossWarningFg,
    '--sidebar': c.headerBg,
    '--sidebar-foreground': cossSidebarFg,
    '--sidebar-border': cossSidebarBorder,
    '--sidebar-accent': cossSubtleTint,
    '--sidebar-accent-foreground': c.textPrimary,
    '--sidebar-primary': c.accent,
    '--sidebar-primary-foreground': c.accentText,
    '--sidebar-ring': cossRing,
    '--coss-frame-well': cossFrameWell,

    // --- DeskTag brand & domain tokens (no collision with coss --accent) ---
    '--dt-accent': c.accent,
    '--dt-accent-hover': c.accentHover,
    '--dt-accent-soft': c.accentSoft,
    '--dt-accent-soft-text': c.accentSoftText,
    '--dt-accent-border': c.accentBorder,
    '--dt-accent-text': c.accentText,

    // --- Legacy DeskTag tokens kept intact during migration ---
    '--skin-paper': skin.swatch.paper,
    '--skin-accent': skin.swatch.accent,
    '--skin-ink': skin.swatch.ink,
    '--bg-panel': c.panelBg,
    '--bg-header': c.headerBg,
    '--bg-surface': c.surfaceBg,
    '--bg-surface-hover': c.surfaceHover,
    '--bg-input': c.inputBg,
    '--bg-card': c.cardBg,
    '--bg-popover': c.popoverBg,
    '--border-strong': c.borderStrong,
    '--text-primary': c.textPrimary,
    '--text-secondary': c.textSecondary,
    '--text-muted': c.textMuted,
    '--text-completed': c.textCompleted,
    '--accent-hover': c.accentHover,
    '--accent-soft': c.accentSoft,
    '--accent-soft-text': c.accentSoftText,
    '--accent-border': c.accentBorder,
    '--accent-text': c.accentText,
    '--tab-active-bg': c.activeTabBg,
    '--tab-active-text': c.activeTabText,
    '--tab-inactive-bg': c.inactiveTabBg,
    '--tab-inactive-text': c.inactiveTabText,
    '--tab-inactive-hover-bg': c.inactiveTabHoverBg,
    '--pill-active-bg': c.activePillBg,
    '--pill-active-text': c.activePillText,
    '--priority-high': c.priorityHigh,
    '--priority-medium': c.priorityMedium,
    '--priority-low': c.priorityLow,
    '--progress-border': c.progressBorder,
    '--progress-fill': c.progressFill,
    '--progress-text': c.progressText,
    '--tag-bg': c.tagBg,
    '--tag-border': c.tagBorder,
    '--tag-text': c.tagText,
    '--danger': c.danger,
    '--danger-soft': c.dangerSoft,
    '--shadow-panel': c.shadow,
    '--shadow-popover': c.shadowStrong,
    '--panel-opacity': String(clampedOpacity),
    '--font-family': getFontFamilyStack(fontFamily),
    '--font-body-size': `${clampedBody}px`,
    '--font-ui-size': `${clampedUi}px`,
  };

  for (const [key, val] of Object.entries(vars)) {
    root.style.setProperty(key, val);
  }
}
