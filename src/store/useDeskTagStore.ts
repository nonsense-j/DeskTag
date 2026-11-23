import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api/tauri';
import { applySkinToDocument, getSkinById } from '../themes/skins';
import {
  type AppData,
  type AttachmentRef,
  type ContentLink,
  type DeviceSettings,
  type DockMode,
  type DockState,
  type NoteGroup,
  type NoteItem,
  type NotificationItem,
  type PlatformInfo,
  type SubtaskItem,
  type SyncExecutionResult,
  type SyncedSettings,
  type TimelineEntry,
  type TodoItem,
  type TodoList,
  type UpdateCheckResult,
  type UpdateDownloadProgress,
  type UpdateInstallResult,
  type WebDavConfigView,
  type WebDavStatusView,
  createDefaultAppData,
  createDefaultDeviceSettings,
} from '../types/models';
import { addDays, formatDateKey, pad2 } from '../utils/lunar';
import { spawnNextRepeatTodo } from '../utils/recurrence';

export type ActiveTab =
  | { kind: 'todo' }
  | { kind: 'list'; listId: string }
  | { kind: 'note'; noteId: string }
  | { kind: 'note_library' };

export type TodoScope = 'today' | 'week' | 'month' | 'unscheduled' | 'list';

export type MobileSection = 'todo' | 'lists' | 'notes' | 'views' | 'settings';

export type SettingsTabId = 'general' | 'panel' | 'personalize' | 'shortcuts' | 'data' | 'about';

export type DockTransitionPhase = 'idle' | 'expanding' | 'collapsing';

interface DockTransitionEventPayload {
  phase: DockTransitionPhase;
  mode: DockMode;
}

export interface NavHistoryEntry {
  activeTab: ActiveTab;
  showQuadrant: boolean;
  editingTodoId: string | null;
  label: string;
}

const SEED_FLAG_KEY = 'desktag_starter_seeded_v1';

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function hashPin(pin: string): Promise<string> {
  const input = `desktag_pin_v1:${pin.trim()}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Simple deterministic fallback for non-secure contexts
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv_${(h >>> 0).toString(16)}`;
}

function buildStarterData(base: AppData): AppData {
  const now = new Date();
  const nowIso = now.toISOString();
  const todayKey = formatDateKey(now);
  const tomorrowKey = formatDateKey(addDays(now, 1));
  const remTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 30, 0, 0);

  const listDevId = 'list_dev_starter';
  const listPersonalId = 'list_personal_starter';
  const noteGuideId = 'note_guide_starter';
  const noteIdeasId = 'note_ideas_starter';
  const groupGuideId = 'group_guide_starter';

  const lists: TodoList[] = [
    {
      id: listDevId,
      name: '研发工作',
      color: '#df6542',
      icon: null,
      pinnedToSide: true,
      tabWidth: null,
      sortOrder: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
    {
      id: listPersonalId,
      name: '个人事务',
      color: '#4e7e57',
      icon: null,
      pinnedToSide: true,
      tabWidth: null,
      sortOrder: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
  ];

  const todos: TodoItem[] = [
    {
      id: 'todo_starter_1',
      title: '熟悉 DeskTag 桌面贴边与快捷键',
      notes: '可按 Alt+Shift+D 快速展开/收起面板，或在「设置 → 面板设置」中自由切换左侧、右侧与顶部贴边模式。',
      noteImages: [],
      completed: false,
      completedAt: null,
      priority: 'high',
      dueDate: todayKey,
      dueTime: '10:00',
      endDate: null,
      listId: listDevId,
      tags: ['上手', '效率'],
      subtasks: [
        {
          id: 'sub_starter_1_1',
          title: '尝试点击右上角开启自动收起',
          notes: '',
          noteImages: [],
          completed: true,
          sortOrder: 0,
          updatedAt: nowIso,
        },
        {
          id: 'sub_starter_1_2',
          title: '用 Ctrl+K 打开全局检索',
          notes: '',
          noteImages: [],
          completed: false,
          sortOrder: 1,
          updatedAt: nowIso,
        },
      ],
      repeatRule: null,
      reminderRule: null,
      quadrantOverride: null,
      links: [{ targetType: 'note', targetId: noteGuideId, label: 'DeskTag 快速上手' }],
      sortOrder: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
    {
      id: 'todo_starter_2',
      title: '在设置中配置 WebDAV 端到端加密同步',
      notes: '在「设置 → 数据与同步」中填入坚果云、Nextcloud 或自建 WebDAV 地址，开启 AES-256-GCM 端到端加密跨端同步。',
      noteImages: [],
      completed: false,
      completedAt: null,
      priority: 'medium',
      dueDate: todayKey,
      dueTime: null,
      endDate: null,
      listId: listDevId,
      tags: ['云同步'],
      subtasks: [
        {
          id: 'sub_starter_2_1',
          title: '填写 WebDAV 服务器地址与凭据',
          notes: '',
          noteImages: [],
          completed: false,
          sortOrder: 0,
          updatedAt: nowIso,
        },
        {
          id: 'sub_starter_2_2',
          title: '设置端到端加密口令并执行预览同步',
          notes: '',
          noteImages: [],
          completed: false,
          sortOrder: 1,
          updatedAt: nowIso,
        },
      ],
      repeatRule: null,
      reminderRule: null,
      quadrantOverride: null,
      links: [],
      sortOrder: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
    {
      id: 'todo_starter_3',
      title: '整理本周计划与重要提醒',
      notes: '支持为重要事项设置单次或按日/周/月循环提醒，也可在四象限视图中快速划分优先级。',
      noteImages: [],
      completed: false,
      completedAt: null,
      priority: 'low',
      dueDate: tomorrowKey,
      dueTime: '17:30',
      endDate: null,
      listId: listPersonalId,
      tags: ['计划'],
      subtasks: [
        {
          id: 'sub_starter_3_1',
          title: '在日历视图查看农历与日程排布',
          notes: '',
          noteImages: [],
          completed: false,
          sortOrder: 0,
          updatedAt: nowIso,
        },
        {
          id: 'sub_starter_3_2',
          title: '为关键任务开启重复提醒与免打扰时段',
          notes: '',
          noteImages: [],
          completed: false,
          sortOrder: 1,
          updatedAt: nowIso,
        },
      ],
      repeatRule: null,
      reminderRule: {
        enabled: true,
        nextAt: remTime.toISOString(),
        mode: 'standard',
        frequency: 'daily',
        weekdays: [],
        month: null,
        day: null,
        intervalValue: null,
        intervalUnit: null,
        times: ['17:30'],
        stopCondition: 'until_complete',
        maxCount: null,
        triggeredCount: 0,
        lastTriggeredAt: null,
      },
      quadrantOverride: null,
      links: [],
      sortOrder: 2,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
    {
      id: 'todo_starter_4',
      title: '安装并启动 DeskTag',
      notes: '',
      noteImages: [],
      completed: true,
      completedAt: nowIso,
      priority: 'none',
      dueDate: todayKey,
      dueTime: null,
      endDate: null,
      listId: listPersonalId,
      tags: ['上手'],
      subtasks: [],
      repeatRule: null,
      reminderRule: null,
      quadrantOverride: null,
      links: [],
      sortOrder: 3,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
    {
      id: 'todo_starter_5',
      title: '试试智能识别：输入「明天下午3点 周会复盘 #工作 重要 提醒」',
      notes: '输入框支持自动识别日期、时间、优先级、标签、重复周期与提醒设置，多行粘贴可一键批量拆分为多条待办。',
      noteImages: [],
      completed: false,
      completedAt: null,
      priority: 'none',
      dueDate: null,
      dueTime: null,
      endDate: null,
      listId: null,
      tags: ['技巧'],
      subtasks: [],
      repeatRule: null,
      reminderRule: null,
      quadrantOverride: null,
      links: [],
      sortOrder: 4,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
  ];

  const noteGroups: NoteGroup[] = [
    {
      id: groupGuideId,
      name: '上手指南',
      locked: false,
      pinHash: null,
      sortOrder: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
  ];

  const notes: NoteItem[] = [
    {
      id: noteGuideId,
      title: 'DeskTag 快速上手',
      kind: 'normal',
      content: `# DeskTag 快速上手

## 核心快捷方式
| 操作 | 快捷键 / 入口 | 说明 |
| --- | --- | --- |
| 展开 / 收起面板 | Alt+Shift+D | 任意应用窗口下全局呼出 |
| 快速新建待办 | Alt+Shift+N | 自动聚焦顶部待办输入框 |
| 全局内容检索 | Ctrl+K | 跨待办、清单与便签即时搜索 |
| 切换外观主题 | 顶部主题图标 | 内置 12 款原创浅色与深色主题 |

## 双向关联与大纲
- 使用 \`#\` / \`##\` 标题即可自动生成右侧浮动目录大纲。
- 在正文中输入 \`@\` 可快速双向关联任意待办或便签。
- 点击工具栏「弹出窗口」可将常用便签固定为独立悬浮窗。`,
      timelineEntries: [],
      attachments: [],
      links: [{ targetType: 'todo', targetId: 'todo_starter_1', label: '熟悉 DeskTag 桌面贴边与快捷键' }],
      groupId: groupGuideId,
      pinnedToSide: true,
      tabWidth: null,
      sortOrder: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
    {
      id: noteIdeasId,
      title: '今日灵感记录',
      kind: 'timeline',
      content: '',
      timelineEntries: [
        {
          id: 'tl_starter_1',
          content: '欢迎使用 DeskTag！时间轴便签适合按时间顺序随手记录想法、会议片段与日常进展。',
          createdAt: new Date(now.getTime() - 3600 * 1000 * 2).toISOString(),
          updatedAt: nowIso,
          attachments: [],
          linkedTodoId: null,
        },
        {
          id: 'tl_starter_2',
          content: '点击单条记录右侧的「转为待办」，即可一键生成带双向关联的任务条目。',
          createdAt: nowIso,
          updatedAt: nowIso,
          attachments: [],
          linkedTodoId: null,
        },
      ],
      attachments: [],
      links: [],
      groupId: null,
      pinnedToSide: true,
      tabWidth: null,
      sortOrder: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
  ];

  return {
    ...base,
    todos,
    lists,
    notes,
    noteGroups,
    updatedAt: nowIso,
  };
}

function defaultWebDavConfigView(): WebDavConfigView {
  return {
    enabled: false,
    url: '',
    username: '',
    passwordSet: false,
    passphraseSet: false,
    remoteDir: 'desktag',
    autoSyncMinutes: 3,
    debouncePush: true,
    followServer: false,
  };
}

function defaultWebDavStatusView(): WebDavStatusView {
  return {
    enabled: false,
    configured: false,
    syncing: false,
    lastSyncAt: null,
    lastError: null,
    serverFileWarning: null,
    conflictNotice: null,
    canUndo: false,
    nextAutoSyncAt: null,
    backendHint: null,
  };
}

function isMainWindowRoute(): boolean {
  if (typeof window === 'undefined') return true;
  const win = new URLSearchParams(window.location.search).get('window');
  return !win || win === 'main';
}

function defaultPlatformInfo(): PlatformInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isAndroid = /Android/i.test(ua);
  const isMac = /Macintosh|Mac OS X/i.test(ua);
  const isWin = /Windows/i.test(ua);
  const platform = isAndroid ? 'android' : isMac ? 'macos' : isWin ? 'windows' : 'linux';
  const appVersion =
    typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim() ? __APP_VERSION__ : '1.3.1';
  return {
    platform,
    isDesktop: !isAndroid,
    isMobile: isAndroid,
    appVersion,
    supportsEdgeDock: !isAndroid,
    supportsGlobalShortcut: !isAndroid,
    supportsTray: !isAndroid,
  };
}

export interface DeskTagStoreValue {
  // Core state
  loading: boolean;
  data: AppData;
  device: DeviceSettings;
  dock: DockState;
  dockTransition: DockTransitionPhase;
  clearDockTransition: () => void;
  platform: PlatformInfo;
  isMobileLayout: boolean;
  notifications: NotificationItem[];
  unreadNotificationCount: number;
  webdavConfig: WebDavConfigView;
  webdavStatus: WebDavStatusView;

  // Derived active entities
  activeTodos: TodoItem[];
  activeLists: TodoList[];
  activeNotes: NoteItem[];
  activeNoteGroups: NoteGroup[];

  // Navigation & UI state
  activeTab: ActiveTab;
  todoScope: TodoScope;
  selectedListId: string | null;
  showQuadrant: boolean;
  mobileSection: MobileSection;
  mobileViewsSubTab: 'calendar' | 'quadrant';
  editingTodoId: string | null;
  reminderTodoId: string | null;
  showListManager: boolean;
  showSettings: boolean;
  settingsTab: SettingsTabId;
  showSearch: boolean;
  showVoiceModal: boolean;
  showSkinPopover: boolean;
  showNotifications: boolean;
  showMoreMenu: boolean;
  navHistory: NavHistoryEntry[];
  unlockedGroupIds: Set<string>;
  toastMessage: string | null;
  quickAddFocusTrigger: number;

  // Navigation & UI setters
  setActiveTab: (tab: ActiveTab) => void;
  setTodoScope: (scope: TodoScope) => void;
  setSelectedListId: (listId: string | null) => void;
  setShowQuadrant: (show: boolean) => void;
  setMobileSection: (section: MobileSection) => void;
  setMobileViewsSubTab: (tab: 'calendar' | 'quadrant') => void;
  setEditingTodoId: (id: string | null) => void;
  setReminderTodoId: (id: string | null) => void;
  setShowListManager: (show: boolean) => void;
  setShowSettings: (show: boolean, tab?: SettingsTabId) => void;
  setSettingsTab: (tab: SettingsTabId) => void;
  setShowSearch: (show: boolean) => void;
  setShowVoiceModal: (show: boolean) => void;
  setShowSkinPopover: (show: boolean) => void;
  setShowNotifications: (show: boolean) => void;
  setShowMoreMenu: (show: boolean) => void;
  closeAllPopovers: () => void;
  openContentLink: (link: ContentLink) => void;
  navigateBack: () => void;
  showToast: (msg: string) => void;

  // Todo CRUD
  addTodo: (partial: Partial<TodoItem> & { title: string }) => TodoItem;
  addTodosBatch: (items: Array<Partial<TodoItem> & { title: string }>) => TodoItem[];
  updateTodo: (id: string, patch: Partial<TodoItem>) => void;
  toggleTodo: (id: string) => void;
  deleteTodo: (id: string) => void;
  reorderTodos: (orderedIds: string[]) => void;

  // Subtask CRUD
  addSubtask: (todoId: string, title: string) => SubtaskItem | null;
  updateSubtask: (todoId: string, subtaskId: string, patch: Partial<SubtaskItem>) => void;
  toggleSubtask: (todoId: string, subtaskId: string) => void;
  deleteSubtask: (todoId: string, subtaskId: string) => void;
  reorderSubtasks: (todoId: string, orderedSubtaskIds: string[]) => void;

  // List CRUD
  addList: (name: string, color?: string, pinnedToSide?: boolean) => TodoList;
  updateList: (id: string, patch: Partial<TodoList>) => void;
  deleteList: (id: string) => void;
  toggleListPin: (id: string) => void;
  reorderLists: (orderedIds: string[]) => void;

  // Note & Timeline & Link CRUD
  addNote: (partial?: Partial<NoteItem>) => NoteItem;
  updateNote: (id: string, patch: Partial<NoteItem>) => void;
  deleteNote: (id: string) => void;
  toggleNotePin: (id: string) => void;
  addTimelineEntry: (noteId: string, content: string, attachments?: AttachmentRef[]) => TimelineEntry | null;
  updateTimelineEntry: (noteId: string, entryId: string, patch: Partial<TimelineEntry>) => void;
  deleteTimelineEntry: (noteId: string, entryId: string) => void;
  convertTimelineEntryToTodo: (noteId: string, entryId: string) => TodoItem | null;
  addContentLink: (sourceType: 'todo' | 'note', sourceId: string, link: ContentLink) => void;
  replaceContentLink: (
    sourceType: 'todo' | 'note',
    sourceId: string,
    oldTargetId: string,
    newLink: ContentLink,
  ) => void;
  removeContentLink: (sourceType: 'todo' | 'note', sourceId: string, targetId: string) => void;

  // NoteGroup & Privacy Lock
  addNoteGroup: (name: string) => NoteGroup;
  updateNoteGroup: (id: string, patch: Partial<NoteGroup>) => void;
  deleteNoteGroup: (id: string) => void;
  lockNoteGroup: (groupId: string, pin: string) => Promise<void>;
  unlockNoteGroup: (groupId: string, pin: string) => Promise<boolean>;
  relockNoteGroup: (groupId: string) => void;
  removeNoteGroupLock: (groupId: string, pin: string) => Promise<boolean>;

  // Settings, Device & Dock
  updateSyncedSettings: (patch: Partial<SyncedSettings>) => void;
  updateDeviceSettings: (patch: Partial<DeviceSettings>) => Promise<void>;
  setDockMode: (mode: DockMode) => Promise<void>;
  toggleAutoHide: () => Promise<void>;
  toggleAlwaysOnTop: () => Promise<void>;
  expandPanel: () => Promise<void>;
  collapsePanel: () => Promise<void>;
  hideToTray: () => Promise<void>;
  quitApp: () => Promise<void>;
  resetPanelLayout: () => Promise<void>;
  replaceAppData: (newData: AppData, persist?: boolean) => void;
  applySyncedAppData: (newData: AppData) => void;

  // Notifications
  refreshNotifications: () => Promise<void>;
  markNotificationsRead: (ids?: string[]) => Promise<void>;
  clearNotifications: () => Promise<void>;

  // WebDAV
  refreshWebdav: () => Promise<void>;
  triggerWebdavSyncNow: () => Promise<SyncExecutionResult>;
  setWebdavConfigState: (cfg: WebDavConfigView) => void;
  setWebdavStatusState: (status: WebDavStatusView) => void;

  // App Updates
  updateResult: UpdateCheckResult | null;
  updateChecking: boolean;
  updateError: string | null;
  updateInstalling: boolean;
  updateProgress: UpdateDownloadProgress | null;
  updateBannerDismissed: boolean;
  hasUnignoredUpdate: boolean;
  checkForUpdates: (options?: { force?: boolean; silent?: boolean }) => Promise<UpdateCheckResult | null>;
  installAvailableUpdate: () => Promise<UpdateInstallResult | null>;
  skipUpdateVersion: (version: string | null) => Promise<void>;
  dismissUpdateBanner: () => void;
}

const DeskTagContext = createContext<DeskTagStoreValue | null>(null);

export const DeskTagProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AppData>(createDefaultAppData);
  const [device, setDevice] = useState<DeviceSettings>(createDefaultDeviceSettings);
  const [platform, setPlatform] = useState<PlatformInfo>(defaultPlatformInfo);
  const [dock, setDock] = useState<DockState>(() => ({
    mode: 'right_tabs',
    collapsed: false,
    autoHide: false,
    alwaysOnTop: false,
    platform: defaultPlatformInfo().platform,
  }));
  const [dockTransition, setDockTransition] = useState<DockTransitionPhase>('idle');
  const [narrowViewport, setNarrowViewport] = useState<boolean>(() => {
    const plat = defaultPlatformInfo();
    return (
      plat.isMobile ||
      (typeof window !== 'undefined' && !api.isTauriRuntime() && window.innerWidth <= 480)
    );
  });
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [webdavConfig, setWebdavConfig] = useState<WebDavConfigView>(defaultWebDavConfigView);
  const [webdavStatus, setWebdavStatus] = useState<WebDavStatusView>(defaultWebDavStatusView);

  // Navigation & UI state
  const [activeTab, setActiveTabState] = useState<ActiveTab>({ kind: 'todo' });
  const [todoScope, setTodoScope] = useState<TodoScope>('today');
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [showQuadrant, setShowQuadrant] = useState(false);
  const [mobileSection, setMobileSection] = useState<MobileSection>('todo');
  const [mobileViewsSubTab, setMobileViewsSubTab] = useState<'calendar' | 'quadrant'>('calendar');
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [reminderTodoId, setReminderTodoId] = useState<string | null>(null);
  const [showListManager, setShowListManager] = useState(false);
  const [showSettings, setShowSettingsState] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('general');
  const [showSearch, setShowSearch] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showSkinPopover, setShowSkinPopover] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [navHistory, setNavHistory] = useState<NavHistoryEntry[]>([]);
  const [unlockedGroupIds, setUnlockedGroupIds] = useState<Set<string>>(() => new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [quickAddFocusTrigger, setQuickAddFocusTrigger] = useState(0);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<UpdateDownloadProgress | null>(null);
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);

  const saveTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const expandResetTimerRef = useRef<number | null>(null);
  const browserCollapseTimerRef = useRef<number | null>(null);
  const dockRef = useRef<DockState>(dock);
  dockRef.current = dock;
  const dockTransitionRef = useRef<DockTransitionPhase>(dockTransition);
  dockTransitionRef.current = dockTransition;
  const prevDockCollapsedRef = useRef<boolean | null>(null);
  const latestDataRef = useRef<AppData>(data);
  latestDataRef.current = data;
  const latestDeviceRef = useRef<DeviceSettings>(device);
  latestDeviceRef.current = device;
  const latestUpdateRef = useRef<UpdateCheckResult | null>(updateResult);
  latestUpdateRef.current = updateResult;
  const updateCheckingRef = useRef(false);
  const updateInstallingRef = useRef(false);

  const isMobileLayout = platform.isMobile || narrowViewport;

  const clearExpandResetTimer = useCallback(() => {
    if (expandResetTimerRef.current !== null) {
      window.clearTimeout(expandResetTimerRef.current);
      expandResetTimerRef.current = null;
    }
  }, []);

  const clearBrowserCollapseTimer = useCallback(() => {
    if (browserCollapseTimerRef.current !== null) {
      window.clearTimeout(browserCollapseTimerRef.current);
      browserCollapseTimerRef.current = null;
    }
  }, []);

  const scheduleExpandReset = useCallback(() => {
    clearExpandResetTimer();
    expandResetTimerRef.current = window.setTimeout(() => {
      expandResetTimerRef.current = null;
      setDockTransition((cur) => (cur === 'expanding' ? 'idle' : cur));
    }, 220);
  }, [clearExpandResetTimer]);

  const clearDockTransition = useCallback(() => {
    clearExpandResetTimer();
    setDockTransition((cur) => (cur === 'expanding' ? 'idle' : cur));
  }, [clearExpandResetTimer]);

  useEffect(() => {
    return () => {
      clearExpandResetTimer();
      clearBrowserCollapseTimer();
    };
  }, [clearBrowserCollapseTimer, clearExpandResetTimer]);

  // Synchronously bridge collapsed -> expanded transitions before first paint even if
  // 'desktag://dock-state' arrives without a preceding 'desktag://dock-transition' event.
  useLayoutEffect(() => {
    const prev = prevDockCollapsedRef.current;
    prevDockCollapsedRef.current = dock.collapsed;
    if (prev === true && !dock.collapsed) {
      if (dockTransitionRef.current !== 'expanding') {
        setDockTransition('expanding');
        scheduleExpandReset();
      }
    } else if (prev === false && dock.collapsed) {
      if (dockTransitionRef.current === 'collapsing') {
        clearExpandResetTimer();
        setDockTransition('idle');
      }
    }
  }, [dock.collapsed, clearExpandResetTimer, scheduleExpandReset]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  }, []);

  const persistDataDebounced = useCallback((nextData: AppData) => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void api.saveAppData(nextData).catch((err) => {
        console.error('[DeskTag] saveAppData failed:', err);
      });
    }, 180);
  }, []);

  const mutateData = useCallback(
    (updater: (prev: AppData) => AppData) => {
      setData((prev) => {
        const next = updater(prev);
        const stamped: AppData = { ...next, updatedAt: new Date().toISOString() };
        persistDataDebounced(stamped);
        return stamped;
      });
    },
    [persistDataDebounced],
  );

  // Viewport resize listener for responsive mobile layout
  useEffect(() => {
    const checkNarrow = () =>
      platform.isMobile ||
      (typeof window !== 'undefined' && !api.isTauriRuntime() && window.innerWidth <= 480);
    const onResize = () => {
      setNarrowViewport(checkNarrow());
    };
    setNarrowViewport(checkNarrow());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [platform.isMobile]);

  // Reflect mobile layout attribute on document root so modal CSS scopes cleanly
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.toggleAttribute('data-mobile', isMobileLayout);
    }
  }, [isMobileLayout]);

  // Pause desktop edge auto-hide while any modal, popover, or menu is open (main window only)
  useEffect(() => {
    if (!platform.supportsEdgeDock || !isMainWindowRoute()) return;
    const anyOverlayOpen = Boolean(
      editingTodoId ||
        reminderTodoId ||
        showListManager ||
        showSettings ||
        showSearch ||
        showVoiceModal ||
        showSkinPopover ||
        showNotifications ||
        showMoreMenu,
    );
    void api.setAutoHidePaused(anyOverlayOpen).catch(() => {});
    return () => {
      if (anyOverlayOpen) {
        void api.setAutoHidePaused(false).catch(() => {});
      }
    };
  }, [
    platform.supportsEdgeDock,
    editingTodoId,
    reminderTodoId,
    showListManager,
    showSettings,
    showSearch,
    showVoiceModal,
    showSkinPopover,
    showNotifications,
    showMoreMenu,
  ]);

  // Apply skin, opacity, font family & sizes whenever synced settings change
  useEffect(() => {
    const s = data.settings;
    const skin = getSkinById(s.skinId);
    applySkinToDocument(skin, s.opacity, s.fontFamily, s.bodyFontSize, s.uiFontSize);
  }, [
    data.settings.skinId,
    data.settings.opacity,
    data.settings.fontFamily,
    data.settings.bodyFontSize,
    data.settings.uiFontSize,
  ]);

  const refreshNotifications = useCallback(async () => {
    try {
      const items = await api.getNotifications();
      setNotifications(items);
    } catch {
      // ignore
    }
  }, []);

  const refreshWebdav = useCallback(async () => {
    try {
      const [cfg, st] = await Promise.all([api.getWebdavConfig(), api.getWebdavStatus()]);
      setWebdavConfig(cfg);
      setWebdavStatus(st);
    } catch {
      // ignore
    }
  }, []);

  // Initial state hydration
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bundle = await api.loadAppState();
        if (cancelled) return;

        let loadedData = bundle.data;
        const alreadySeeded =
          typeof window !== 'undefined' && window.localStorage.getItem(SEED_FLAG_KEY) === '1';
        const isBrandNewEmpty =
          loadedData.todos.length === 0 &&
          loadedData.lists.length === 0 &&
          loadedData.notes.length === 0 &&
          !alreadySeeded;

        if (isBrandNewEmpty) {
          loadedData = buildStarterData(loadedData);
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(SEED_FLAG_KEY, '1');
          }
          void api.saveAppData(loadedData);
        }

        setData(loadedData);
        setDevice(bundle.device);
        setDock(bundle.dock);
        setPlatform(bundle.platform);

        // Apply default view from settings
        const defView = loadedData.settings.defaultView;
        if (defView === 'quadrant') {
          setShowQuadrant(true);
        } else if (defView === 'today' || defView === 'week' || defView === 'month' || defView === 'unscheduled') {
          setTodoScope(defView);
        }

        await Promise.all([refreshNotifications(), refreshWebdav()]);
      } catch (err) {
        console.error('[DeskTag] loadAppState failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshNotifications, refreshWebdav]);

  // Listen to Tauri real-time events (multi-window sync, WebDAV status, dock state, notifications, quick-add)
  useEffect(() => {
    if (!api.isTauriRuntime()) {
      // Browser preview cross-tab storage sync for popped-out windows
      const onStorage = (e: StorageEvent) => {
        if (e.key === 'desktag_fallback_data_v1' && e.newValue) {
          try {
            const parsed = JSON.parse(e.newValue) as AppData;
            setData(parsed);
          } catch {
            // ignore
          }
        }
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    }

    let unlisteners: Array<() => void> = [];
    let disposed = false;

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        if (disposed) return;

        const u1 = await listen<AppData>('desktag://data-updated', (ev) => {
          if (ev.payload && Array.isArray(ev.payload.todos)) {
            setData(ev.payload);
          } else {
            void api.loadAppState().then((b) => setData(b.data));
          }
        });
        const u2 = await listen<AppData>('desktag://data-synced', (ev) => {
          if (ev.payload && Array.isArray(ev.payload.todos)) {
            setData(ev.payload);
          } else {
            void api.loadAppState().then((b) => setData(b.data));
          }
          void refreshWebdav();
        });
        const u3 = await listen<WebDavStatusView>('desktag://sync-status', (ev) => {
          if (ev.payload) {
            setWebdavStatus(ev.payload);
          }
        });
        const u4 = await listen<DockState>('desktag://dock-state', (ev) => {
          if (ev.payload) {
            setDock(ev.payload);
          }
        });
        const u4b = await listen<DockTransitionEventPayload>('desktag://dock-transition', (ev) => {
          const phase = ev.payload?.phase;
          if (!phase) return;
          if (phase === 'expanding') {
            clearBrowserCollapseTimer();
            setDockTransition('expanding');
            scheduleExpandReset();
          } else if (phase === 'collapsing') {
            clearExpandResetTimer();
            setDockTransition('collapsing');
          } else {
            clearExpandResetTimer();
            setDockTransition('idle');
          }
        });
        const u5 = await listen<NotificationItem[]>('desktag://notifications-updated', (ev) => {
          if (Array.isArray(ev.payload)) {
            setNotifications(ev.payload);
          } else {
            void refreshNotifications();
          }
        });
        const u6 = await listen('desktag://focus-quick-add', () => {
          setActiveTabState({ kind: 'todo' });
          setShowQuadrant(false);
          setQuickAddFocusTrigger((n) => n + 1);
        });
        const u7 = await listen<UpdateDownloadProgress>('desktag://update-progress', (ev) => {
          if (ev.payload) {
            setUpdateProgress(ev.payload);
          }
        });

        unlisteners = [u1, u2, u3, u4, u4b, u5, u6, u7];
      } catch (err) {
        console.warn('[DeskTag] event listener setup skipped:', err);
      }
    })();

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        try {
          unlisten();
        } catch {
          // ignore
        }
      }
    };
  }, [clearBrowserCollapseTimer, clearExpandResetTimer, refreshNotifications, refreshWebdav, scheduleExpandReset]);

  // Derived active slices
  const activeTodos = useMemo(
    () => data.todos.filter((t) => !t.deletedAt),
    [data.todos],
  );
  const activeLists = useMemo(
    () => [...data.lists.filter((l) => !l.deletedAt)].sort((a, b) => a.sortOrder - b.sortOrder),
    [data.lists],
  );
  const activeNotes = useMemo(
    () => [...data.notes.filter((n) => !n.deletedAt)].sort((a, b) => a.sortOrder - b.sortOrder),
    [data.notes],
  );
  const activeNoteGroups = useMemo(
    () => [...data.noteGroups.filter((g) => !g.deletedAt)].sort((a, b) => a.sortOrder - b.sortOrder),
    [data.noteGroups],
  );

  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  // Navigation helpers
  const closeAllPopovers = useCallback(() => {
    setShowSkinPopover(false);
    setShowNotifications(false);
    setShowMoreMenu(false);
  }, []);

  const setActiveTab = useCallback(
    (tab: ActiveTab) => {
      setActiveTabState(tab);
      setShowQuadrant(false);
      closeAllPopovers();
      if (tab.kind === 'list') {
        setTodoScope('list');
        setSelectedListId(tab.listId);
      } else if (tab.kind === 'todo') {
        if (todoScope === 'list') {
          setTodoScope('today');
          setSelectedListId(null);
        }
      }
    },
    [closeAllPopovers, todoScope],
  );

  const setShowSettings = useCallback((show: boolean, tab?: SettingsTabId) => {
    if (tab) setSettingsTab(tab);
    setShowSettingsState(show);
    if (show) {
      setShowSkinPopover(false);
      setShowNotifications(false);
      setShowMoreMenu(false);
    }
  }, []);

  const openContentLink = useCallback(
    (link: ContentLink) => {
      const currentLabel =
        editingTodoId
          ? activeTodos.find((t) => t.id === editingTodoId)?.title ?? '待办'
          : activeTab.kind === 'note'
            ? activeNotes.find((n) => n.id === activeTab.noteId)?.title ?? '便签'
            : '待办';

      setNavHistory((prev) => [
        ...prev.slice(-14),
        {
          activeTab,
          showQuadrant,
          editingTodoId,
          label: currentLabel,
        },
      ]);

      if (link.targetType === 'note') {
        setEditingTodoId(null);
        setShowQuadrant(false);
        setActiveTabState({ kind: 'note', noteId: link.targetId });
        setMobileSection('notes');
      } else {
        setActiveTabState({ kind: 'todo' });
        setShowQuadrant(false);
        setEditingTodoId(link.targetId);
        setMobileSection('todo');
      }
    },
    [activeNotes, activeTab, activeTodos, editingTodoId, showQuadrant],
  );

  const navigateBack = useCallback(() => {
    setNavHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setActiveTabState(last.activeTab);
      setShowQuadrant(last.showQuadrant);
      setEditingTodoId(last.editingTodoId);
      return prev.slice(0, -1);
    });
  }, []);

  // -------------------------------------------------------------------------
  // Todo CRUD
  // -------------------------------------------------------------------------

  const addTodo = useCallback(
    (partial: Partial<TodoItem> & { title: string }): TodoItem => {
      const nowIso = new Date().toISOString();
      const currentTodos = latestDataRef.current.todos.filter((t) => !t.deletedAt);
      const minOrder = currentTodos.reduce((min, t) => Math.min(min, t.sortOrder), 0);
      const item: TodoItem = {
        id: partial.id ?? createId('todo'),
        title: partial.title.trim(),
        notes: partial.notes ?? '',
        noteImages: partial.noteImages ?? [],
        completed: partial.completed ?? false,
        completedAt: partial.completed ? nowIso : null,
        priority: partial.priority ?? 'none',
        dueDate: partial.dueDate !== undefined ? partial.dueDate : null,
        dueTime: partial.dueTime !== undefined ? partial.dueTime : null,
        endDate: partial.endDate ?? null,
        listId: partial.listId !== undefined ? partial.listId : null,
        tags: partial.tags ?? [],
        subtasks: partial.subtasks ?? [],
        repeatRule: partial.repeatRule ?? null,
        reminderRule: partial.reminderRule ?? null,
        quadrantOverride: partial.quadrantOverride ?? null,
        links: partial.links ?? [],
        sortOrder: partial.sortOrder ?? minOrder - 1,
        createdAt: partial.createdAt ?? nowIso,
        updatedAt: nowIso,
        deletedAt: null,
      };
      mutateData((prev) => ({
        ...prev,
        todos: [item, ...prev.todos],
      }));
      return item;
    },
    [mutateData],
  );

  const addTodosBatch = useCallback(
    (items: Array<Partial<TodoItem> & { title: string }>): TodoItem[] => {
      const nowIso = new Date().toISOString();
      const baseMin = latestDataRef.current.todos.reduce((min, t) => Math.min(min, t.sortOrder), 0);
      const created: TodoItem[] = items
        .filter((it) => it.title.trim().length > 0)
        .map((partial, idx) => ({
          id: partial.id ?? createId('todo'),
          title: partial.title.trim(),
          notes: partial.notes ?? '',
          noteImages: partial.noteImages ?? [],
          completed: partial.completed ?? false,
          completedAt: partial.completed ? nowIso : null,
          priority: partial.priority ?? 'none',
          dueDate: partial.dueDate !== undefined ? partial.dueDate : null,
          dueTime: partial.dueTime !== undefined ? partial.dueTime : null,
          endDate: partial.endDate ?? null,
          listId: partial.listId !== undefined ? partial.listId : null,
          tags: partial.tags ?? [],
          subtasks: partial.subtasks ?? [],
          repeatRule: partial.repeatRule ?? null,
          reminderRule: partial.reminderRule ?? null,
          quadrantOverride: partial.quadrantOverride ?? null,
          links: partial.links ?? [],
          sortOrder: baseMin - items.length + idx,
          createdAt: nowIso,
          updatedAt: nowIso,
          deletedAt: null,
        }));
      if (created.length === 0) return [];
      mutateData((prev) => ({
        ...prev,
        todos: [...created, ...prev.todos],
      }));
      return created;
    },
    [mutateData],
  );

  const updateTodo = useCallback(
    (id: string, patch: Partial<TodoItem>) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        todos: prev.todos.map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                updatedAt: nowIso,
              }
            : t,
        ),
      }));
    },
    [mutateData],
  );

  const toggleTodo = useCallback(
    (id: string) => {
      const now = new Date();
      const nowIso = now.toISOString();
      let spawnedMessage: string | null = null;

      mutateData((prev) => {
        const target = prev.todos.find((t) => t.id === id);
        if (!target) return prev;
        const nextCompleted = !target.completed;
        const updatedTodos = prev.todos.map((t) =>
          t.id === id
            ? {
                ...t,
                completed: nextCompleted,
                completedAt: nextCompleted ? nowIso : null,
                updatedAt: nowIso,
              }
            : t,
        );

        if (nextCompleted && target.repeatRule?.enabled) {
          const nextOccurrence = spawnNextRepeatTodo(target, now);
          if (nextOccurrence) {
            spawnedMessage = `已生成下一次重复待办 (${nextOccurrence.dueDate})`;
            return {
              ...prev,
              todos: [nextOccurrence, ...updatedTodos],
            };
          }
        }
        return {
          ...prev,
          todos: updatedTodos,
        };
      });

      if (spawnedMessage) {
        showToast(spawnedMessage);
      }
    },
    [mutateData, showToast],
  );

  const deleteTodo = useCallback(
    (id: string) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        todos: prev.todos.map((t) =>
          t.id === id ? { ...t, deletedAt: nowIso, updatedAt: nowIso } : t,
        ),
      }));
      setEditingTodoId((cur) => (cur === id ? null : cur));
      setReminderTodoId((cur) => (cur === id ? null : cur));
    },
    [mutateData],
  );

  const reorderTodos = useCallback(
    (orderedIds: string[]) => {
      const nowIso = new Date().toISOString();
      const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]));
      mutateData((prev) => ({
        ...prev,
        todos: prev.todos.map((t) => {
          const idx = orderMap.get(t.id);
          return idx !== undefined ? { ...t, sortOrder: idx, updatedAt: nowIso } : t;
        }),
      }));
    },
    [mutateData],
  );

  // -------------------------------------------------------------------------
  // Subtask CRUD
  // -------------------------------------------------------------------------

  const addSubtask = useCallback(
    (todoId: string, title: string): SubtaskItem | null => {
      const clean = title.trim();
      if (!clean) return null;
      const nowIso = new Date().toISOString();
      const sub: SubtaskItem = {
        id: createId('sub'),
        title: clean,
        notes: '',
        noteImages: [],
        completed: false,
        sortOrder: 999,
        updatedAt: nowIso,
      };
      mutateData((prev) => ({
        ...prev,
        todos: prev.todos.map((t) => {
          if (t.id !== todoId) return t;
          const nextSub: SubtaskItem = { ...sub, sortOrder: t.subtasks.length };
          return {
            ...t,
            subtasks: [...t.subtasks, nextSub],
            updatedAt: nowIso,
          };
        }),
      }));
      return sub;
    },
    [mutateData],
  );

  const updateSubtask = useCallback(
    (todoId: string, subtaskId: string, patch: Partial<SubtaskItem>) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        todos: prev.todos.map((t) => {
          if (t.id !== todoId) return t;
          return {
            ...t,
            subtasks: t.subtasks.map((s) =>
              s.id === subtaskId ? { ...s, ...patch, updatedAt: nowIso } : s,
            ),
            updatedAt: nowIso,
          };
        }),
      }));
    },
    [mutateData],
  );

  const toggleSubtask = useCallback(
    (todoId: string, subtaskId: string) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        todos: prev.todos.map((t) => {
          if (t.id !== todoId) return t;
          return {
            ...t,
            subtasks: t.subtasks.map((s) =>
              s.id === subtaskId ? { ...s, completed: !s.completed, updatedAt: nowIso } : s,
            ),
            updatedAt: nowIso,
          };
        }),
      }));
    },
    [mutateData],
  );

  const deleteSubtask = useCallback(
    (todoId: string, subtaskId: string) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        todos: prev.todos.map((t) => {
          if (t.id !== todoId) return t;
          return {
            ...t,
            subtasks: t.subtasks.filter((s) => s.id !== subtaskId),
            updatedAt: nowIso,
          };
        }),
      }));
    },
    [mutateData],
  );

  const reorderSubtasks = useCallback(
    (todoId: string, orderedSubtaskIds: string[]) => {
      const nowIso = new Date().toISOString();
      const map = new Map(orderedSubtaskIds.map((id, idx) => [id, idx]));
      mutateData((prev) => ({
        ...prev,
        todos: prev.todos.map((t) => {
          if (t.id !== todoId) return t;
          const nextSubs = [...t.subtasks]
            .map((s) => ({ ...s, sortOrder: map.get(s.id) ?? s.sortOrder, updatedAt: nowIso }))
            .sort((a, b) => a.sortOrder - b.sortOrder);
          return { ...t, subtasks: nextSubs, updatedAt: nowIso };
        }),
      }));
    },
    [mutateData],
  );

  // -------------------------------------------------------------------------
  // List CRUD
  // -------------------------------------------------------------------------

  const addList = useCallback(
    (name: string, color: string = '#df6542', pinnedToSide: boolean = false): TodoList => {
      const nowIso = new Date().toISOString();
      const existing = latestDataRef.current.lists.filter((l) => !l.deletedAt);
      const list: TodoList = {
        id: createId('list'),
        name: name.trim() || '新建清单',
        color,
        icon: null,
        pinnedToSide,
        tabWidth: null,
        sortOrder: existing.length,
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
      };
      mutateData((prev) => ({
        ...prev,
        lists: [...prev.lists, list],
      }));
      return list;
    },
    [mutateData],
  );

  const updateList = useCallback(
    (id: string, patch: Partial<TodoList>) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        lists: prev.lists.map((l) => (l.id === id ? { ...l, ...patch, updatedAt: nowIso } : l)),
      }));
    },
    [mutateData],
  );

  const deleteList = useCallback(
    (id: string) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        lists: prev.lists.map((l) =>
          l.id === id ? { ...l, deletedAt: nowIso, pinnedToSide: false, updatedAt: nowIso } : l,
        ),
        todos: prev.todos.map((t) =>
          t.listId === id ? { ...t, listId: null, updatedAt: nowIso } : t,
        ),
      }));
      if (selectedListId === id) {
        setSelectedListId(null);
        setTodoScope('today');
      }
      if (activeTab.kind === 'list' && activeTab.listId === id) {
        setActiveTabState({ kind: 'todo' });
      }
    },
    [activeTab, mutateData, selectedListId],
  );

  const toggleListPin = useCallback(
    (id: string) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        lists: prev.lists.map((l) =>
          l.id === id ? { ...l, pinnedToSide: !l.pinnedToSide, updatedAt: nowIso } : l,
        ),
      }));
    },
    [mutateData],
  );

  const reorderLists = useCallback(
    (orderedIds: string[]) => {
      const nowIso = new Date().toISOString();
      const map = new Map(orderedIds.map((id, idx) => [id, idx]));
      mutateData((prev) => ({
        ...prev,
        lists: prev.lists.map((l) => {
          const idx = map.get(l.id);
          return idx !== undefined ? { ...l, sortOrder: idx, updatedAt: nowIso } : l;
        }),
      }));
    },
    [mutateData],
  );

  // -------------------------------------------------------------------------
  // Note, Timeline & Content Link CRUD
  // -------------------------------------------------------------------------

  const addNote = useCallback(
    (partial: Partial<NoteItem> = {}): NoteItem => {
      const nowIso = new Date().toISOString();
      const existing = latestDataRef.current.notes.filter((n) => !n.deletedAt);
      const kind = partial.kind ?? 'normal';
      const note: NoteItem = {
        id: partial.id ?? createId('note'),
        title: partial.title?.trim() || (kind === 'timeline' ? '时间轴记录' : '新便签'),
        kind,
        content: partial.content ?? '',
        timelineEntries: partial.timelineEntries ?? [],
        attachments: partial.attachments ?? [],
        links: partial.links ?? [],
        groupId: partial.groupId ?? null,
        pinnedToSide: partial.pinnedToSide ?? true,
        tabWidth: partial.tabWidth ?? null,
        sortOrder: partial.sortOrder ?? existing.length,
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
      };
      mutateData((prev) => ({
        ...prev,
        notes: [...prev.notes, note],
      }));
      return note;
    },
    [mutateData],
  );

  const updateNote = useCallback(
    (id: string, patch: Partial<NoteItem>) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        notes: prev.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: nowIso } : n)),
      }));
    },
    [mutateData],
  );

  const deleteNote = useCallback(
    (id: string) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        notes: prev.notes.map((n) =>
          n.id === id ? { ...n, deletedAt: nowIso, pinnedToSide: false, updatedAt: nowIso } : n,
        ),
      }));
      if (activeTab.kind === 'note' && activeTab.noteId === id) {
        setActiveTabState({ kind: 'note_library' });
      }
    },
    [activeTab, mutateData],
  );

  const toggleNotePin = useCallback(
    (id: string) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        notes: prev.notes.map((n) =>
          n.id === id ? { ...n, pinnedToSide: !n.pinnedToSide, updatedAt: nowIso } : n,
        ),
      }));
    },
    [mutateData],
  );

  const addTimelineEntry = useCallback(
    (noteId: string, content: string, attachments: AttachmentRef[] = []): TimelineEntry | null => {
      const clean = content.trim();
      if (!clean && attachments.length === 0) return null;
      const nowIso = new Date().toISOString();
      const entry: TimelineEntry = {
        id: createId('tl'),
        content: clean,
        createdAt: nowIso,
        updatedAt: nowIso,
        attachments,
        linkedTodoId: null,
      };
      mutateData((prev) => ({
        ...prev,
        notes: prev.notes.map((n) =>
          n.id === noteId
            ? {
                ...n,
                timelineEntries: [entry, ...n.timelineEntries],
                updatedAt: nowIso,
              }
            : n,
        ),
      }));
      return entry;
    },
    [mutateData],
  );

  const updateTimelineEntry = useCallback(
    (noteId: string, entryId: string, patch: Partial<TimelineEntry>) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        notes: prev.notes.map((n) =>
          n.id === noteId
            ? {
                ...n,
                timelineEntries: n.timelineEntries.map((e) =>
                  e.id === entryId ? { ...e, ...patch, updatedAt: nowIso } : e,
                ),
                updatedAt: nowIso,
              }
            : n,
        ),
      }));
    },
    [mutateData],
  );

  const deleteTimelineEntry = useCallback(
    (noteId: string, entryId: string) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        notes: prev.notes.map((n) =>
          n.id === noteId
            ? {
                ...n,
                timelineEntries: n.timelineEntries.filter((e) => e.id !== entryId),
                updatedAt: nowIso,
              }
            : n,
        ),
      }));
    },
    [mutateData],
  );

  const convertTimelineEntryToTodo = useCallback(
    (noteId: string, entryId: string): TodoItem | null => {
      const note = latestDataRef.current.notes.find((n) => n.id === noteId && !n.deletedAt);
      const entry = note?.timelineEntries.find((e) => e.id === entryId);
      if (!note || !entry) return null;

      const titleLine = entry.content.split(/\r?\n/)[0]?.slice(0, 80).trim() || '来自时间轴的待办';
      const nowIso = new Date().toISOString();
      const createdTodo = addTodo({
        title: titleLine,
        notes: entry.content,
        dueDate: formatDateKey(new Date()),
        links: [{ targetType: 'note', targetId: note.id, label: note.title || '时间轴便签' }],
      });

      mutateData((prev) => ({
        ...prev,
        notes: prev.notes.map((n) =>
          n.id === noteId
            ? {
                ...n,
                timelineEntries: n.timelineEntries.map((e) =>
                  e.id === entryId ? { ...e, linkedTodoId: createdTodo.id, updatedAt: nowIso } : e,
                ),
                updatedAt: nowIso,
              }
            : n,
        ),
      }));

      showToast('已转为待办并建立关联');
      return createdTodo;
    },
    [addTodo, mutateData, showToast],
  );

  const addContentLink = useCallback(
    (sourceType: 'todo' | 'note', sourceId: string, link: ContentLink) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => {
        if (sourceType === 'todo') {
          return {
            ...prev,
            todos: prev.todos.map((t) => {
              if (t.id !== sourceId) return t;
              if (t.links.some((l) => l.targetId === link.targetId && l.targetType === link.targetType)) {
                return t;
              }
              return { ...t, links: [...t.links, link], updatedAt: nowIso };
            }),
          };
        }
        return {
          ...prev,
          notes: prev.notes.map((n) => {
            if (n.id !== sourceId) return n;
            if (n.links.some((l) => l.targetId === link.targetId && l.targetType === link.targetType)) {
              return n;
            }
            return { ...n, links: [...n.links, link], updatedAt: nowIso };
          }),
        };
      });
    },
    [mutateData],
  );

  const replaceContentLink = useCallback(
    (sourceType: 'todo' | 'note', sourceId: string, oldTargetId: string, newLink: ContentLink) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => {
        if (sourceType === 'todo') {
          return {
            ...prev,
            todos: prev.todos.map((t) =>
              t.id === sourceId
                ? {
                    ...t,
                    links: t.links.map((l) => (l.targetId === oldTargetId ? newLink : l)),
                    updatedAt: nowIso,
                  }
                : t,
            ),
          };
        }
        return {
          ...prev,
          notes: prev.notes.map((n) =>
            n.id === sourceId
              ? {
                  ...n,
                  links: n.links.map((l) => (l.targetId === oldTargetId ? newLink : l)),
                  updatedAt: nowIso,
                }
              : n,
          ),
        };
      });
    },
    [mutateData],
  );

  const removeContentLink = useCallback(
    (sourceType: 'todo' | 'note', sourceId: string, targetId: string) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => {
        if (sourceType === 'todo') {
          return {
            ...prev,
            todos: prev.todos.map((t) =>
              t.id === sourceId
                ? {
                    ...t,
                    links: t.links.filter((l) => l.targetId !== targetId),
                    updatedAt: nowIso,
                  }
                : t,
            ),
          };
        }
        return {
          ...prev,
          notes: prev.notes.map((n) =>
            n.id === sourceId
              ? {
                  ...n,
                  links: n.links.filter((l) => l.targetId !== targetId),
                  updatedAt: nowIso,
                }
              : n,
          ),
        };
      });
    },
    [mutateData],
  );

  // -------------------------------------------------------------------------
  // NoteGroup & Privacy Lock
  // -------------------------------------------------------------------------

  const addNoteGroup = useCallback(
    (name: string): NoteGroup => {
      const nowIso = new Date().toISOString();
      const existing = latestDataRef.current.noteGroups.filter((g) => !g.deletedAt);
      const group: NoteGroup = {
        id: createId('grp'),
        name: name.trim() || '新分组',
        locked: false,
        pinHash: null,
        sortOrder: existing.length,
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
      };
      mutateData((prev) => ({
        ...prev,
        noteGroups: [...prev.noteGroups, group],
      }));
      return group;
    },
    [mutateData],
  );

  const updateNoteGroup = useCallback(
    (id: string, patch: Partial<NoteGroup>) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        noteGroups: prev.noteGroups.map((g) =>
          g.id === id ? { ...g, ...patch, updatedAt: nowIso } : g,
        ),
      }));
    },
    [mutateData],
  );

  const deleteNoteGroup = useCallback(
    (id: string) => {
      const nowIso = new Date().toISOString();
      mutateData((prev) => ({
        ...prev,
        noteGroups: prev.noteGroups.map((g) =>
          g.id === id ? { ...g, deletedAt: nowIso, updatedAt: nowIso } : g,
        ),
        notes: prev.notes.map((n) =>
          n.groupId === id ? { ...n, groupId: null, updatedAt: nowIso } : n,
        ),
      }));
    },
    [mutateData],
  );

  const lockNoteGroup = useCallback(
    async (groupId: string, pin: string) => {
      const hashed = await hashPin(pin);
      updateNoteGroup(groupId, { locked: true, pinHash: hashed });
      setUnlockedGroupIds((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
    },
    [updateNoteGroup],
  );

  const unlockNoteGroup = useCallback(async (groupId: string, pin: string): Promise<boolean> => {
    const group = latestDataRef.current.noteGroups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group || !group.locked || !group.pinHash) return true;
    const hashed = await hashPin(pin);
    if (hashed === group.pinHash) {
      setUnlockedGroupIds((prev) => {
        const next = new Set(prev);
        next.add(groupId);
        return next;
      });
      return true;
    }
    return false;
  }, []);

  const relockNoteGroup = useCallback((groupId: string) => {
    setUnlockedGroupIds((prev) => {
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
  }, []);

  const removeNoteGroupLock = useCallback(
    async (groupId: string, pin: string): Promise<boolean> => {
      const ok = await unlockNoteGroup(groupId, pin);
      if (!ok) return false;
      updateNoteGroup(groupId, { locked: false, pinHash: null });
      return true;
    },
    [unlockNoteGroup, updateNoteGroup],
  );

  // -------------------------------------------------------------------------
  // Settings, Device & Dock Controls
  // -------------------------------------------------------------------------

  const updateSyncedSettings = useCallback(
    (patch: Partial<SyncedSettings>) => {
      mutateData((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          ...patch,
        },
      }));
    },
    [mutateData],
  );

  const updateDeviceSettings = useCallback(
    async (patch: Partial<DeviceSettings>) => {
      const next: DeviceSettings = { ...latestDeviceRef.current, ...patch };
      latestDeviceRef.current = next;
      setDevice(next);
      try {
        const nextDock = await api.saveDeviceSettings(next);
        setDock(nextDock);
      } catch (err) {
        console.error('[DeskTag] saveDeviceSettings failed:', err);
      }
    },
    [],
  );

  const setDockMode = useCallback(
    async (mode: DockMode) => {
      clearBrowserCollapseTimer();
      clearExpandResetTimer();
      setDockTransition('idle');
      setDevice((prev) => ({ ...prev, dockMode: mode }));
      try {
        const nextDock = await api.setDockMode(mode);
        setDock(nextDock);
      } catch (err) {
        console.error('[DeskTag] setDockMode failed:', err);
      }
    },
    [clearBrowserCollapseTimer, clearExpandResetTimer],
  );

  const toggleAutoHide = useCallback(async () => {
    const nextEnabled = !dock.autoHide;
    setDevice((prev) => ({ ...prev, autoHide: nextEnabled }));
    setDock((prev) => ({ ...prev, autoHide: nextEnabled }));
    try {
      const nextDock = await api.setAutoHide(nextEnabled);
      setDock(nextDock);
    } catch (err) {
      console.error('[DeskTag] setAutoHide failed:', err);
    }
  }, [dock.autoHide]);

  const toggleAlwaysOnTop = useCallback(async () => {
    const nextEnabled = !dock.alwaysOnTop;
    setDevice((prev) => ({ ...prev, alwaysOnTop: nextEnabled }));
    setDock((prev) => ({ ...prev, alwaysOnTop: nextEnabled }));
    try {
      const nextDock = await api.setAlwaysOnTop(nextEnabled);
      setDock(nextDock);
    } catch (err) {
      console.error('[DeskTag] setAlwaysOnTop failed:', err);
    }
  }, [dock.alwaysOnTop]);

  const expandPanel = useCallback(async () => {
    if (!api.isTauriRuntime()) {
      const wasCollapsing = dockTransitionRef.current === 'collapsing';
      const wasCollapsed = dockRef.current.collapsed;
      clearBrowserCollapseTimer();
      if (!wasCollapsing && !wasCollapsed) {
        return;
      }
      try {
        const nextDock = await api.expandPanel();
        setDock(nextDock);
      } catch {
        setDock((prev) => ({ ...prev, collapsed: false }));
      }
      setDockTransition('expanding');
      scheduleExpandReset();
      return;
    }

    if (dockTransitionRef.current === 'collapsing') {
      setDockTransition('expanding');
      scheduleExpandReset();
    }
    try {
      const nextDock = await api.expandPanel();
      setDock(nextDock);
    } catch {
      setDock((prev) => ({ ...prev, collapsed: false }));
    }
  }, [clearBrowserCollapseTimer, scheduleExpandReset]);

  const collapsePanel = useCallback(async () => {
    if (!api.isTauriRuntime()) {
      if (dockRef.current.collapsed || dockTransitionRef.current === 'collapsing') {
        return;
      }
      clearExpandResetTimer();
      clearBrowserCollapseTimer();
      setDockTransition('collapsing');
      browserCollapseTimerRef.current = window.setTimeout(() => {
        browserCollapseTimerRef.current = null;
        void api
          .collapsePanel()
          .then((nextDock) => {
            setDock(nextDock);
            setDockTransition('idle');
          })
          .catch(() => {
            setDock((prev) => ({ ...prev, collapsed: true }));
            setDockTransition('idle');
          });
      }, 160);
      return;
    }

    try {
      const nextDock = await api.collapsePanel();
      setDock(nextDock);
    } catch {
      setDock((prev) => ({ ...prev, collapsed: true }));
    }
  }, [clearBrowserCollapseTimer, clearExpandResetTimer]);

  const hideToTray = useCallback(async () => {
    try {
      await api.hideToTray();
    } catch (err) {
      console.error('[DeskTag] hideToTray failed:', err);
    }
  }, []);

  const quitApp = useCallback(async () => {
    try {
      await api.quitApp();
      return;
    } catch (err) {
      console.error('[DeskTag] quitApp failed:', err);
    }
    if (api.isTauriRuntime()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
        return;
      } catch {
        // Fallback below
      }
    }
    window.close();
  }, []);

  const resetPanelLayout = useCallback(async () => {
    clearBrowserCollapseTimer();
    clearExpandResetTimer();
    setDockTransition('idle');
    try {
      const nextDevice = await api.resetPanelLayout();
      setDevice(nextDevice);
      const nextDock = await api.getDockState();
      setDock(nextDock);
      showToast('已恢复默认布局 480 × 680 并重新贴边');
    } catch (err) {
      console.error('[DeskTag] resetPanelLayout failed:', err);
    }
  }, [clearBrowserCollapseTimer, clearExpandResetTimer, showToast]);

  const applySyncedAppData = useCallback((newData: AppData) => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setData(newData);
  }, []);

  const replaceAppData = useCallback((newData: AppData, persist: boolean = true) => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!persist) {
      setData(newData);
      return;
    }
    const stamped: AppData = { ...newData, updatedAt: new Date().toISOString() };
    setData(stamped);
    void api.saveAppData(stamped);
  }, []);

  // -------------------------------------------------------------------------
  // Notifications & WebDAV
  // -------------------------------------------------------------------------

  const markNotificationsRead = useCallback(async (ids?: string[]) => {
    try {
      const updated = await api.markNotificationsRead(ids ?? null);
      setNotifications(updated);
    } catch {
      // ignore
    }
  }, []);

  const clearNotifications = useCallback(async () => {
    try {
      await api.clearNotifications();
      setNotifications([]);
    } catch {
      // ignore
    }
  }, []);

  const triggerWebdavSyncNow = useCallback(async (): Promise<SyncExecutionResult> => {
    setWebdavStatus((prev) => ({ ...prev, syncing: true, lastError: null }));
    try {
      const res = await api.webdavSyncNow();
      setWebdavStatus(res.status);
      if (res.data) {
        setData(res.data);
      }
      showToast(res.ok ? res.message || '同步完成' : res.message || '同步失败');
      return res;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failedStatus: WebDavStatusView = {
        ...webdavStatus,
        syncing: false,
        lastError: message,
      };
      setWebdavStatus(failedStatus);
      showToast(`同步失败：${message}`);
      return {
        ok: false,
        changedLocal: false,
        changedRemote: false,
        data: null,
        status: failedStatus,
        message,
      };
    }
  }, [showToast, webdavStatus]);

  // -------------------------------------------------------------------------
  // App Updates (GitHub Releases)
  // -------------------------------------------------------------------------

  const hasUnignoredUpdate = Boolean(
    updateResult?.hasUpdate &&
      updateResult.latestVersion !== device.skippedUpdateVersion,
  );

  const checkForUpdates = useCallback(
    async (options?: { force?: boolean; silent?: boolean }): Promise<UpdateCheckResult | null> => {
      const force = Boolean(options?.force);
      const silent = Boolean(options?.silent);
      if (updateCheckingRef.current) {
        return latestUpdateRef.current;
      }
      updateCheckingRef.current = true;
      setUpdateChecking(true);
      if (!silent) {
        setUpdateError(null);
      }
      try {
        const res = await api.checkForUpdate(force);
        latestUpdateRef.current = res;
        setUpdateResult(res);
        setUpdateError(null);
        setDevice((prev) => {
          const next = { ...prev, lastUpdateCheckAt: res.checkedAt };
          latestDeviceRef.current = next;
          return next;
        });
        if (res.hasUpdate && res.latestVersion !== latestDeviceRef.current.skippedUpdateVersion) {
          setUpdateBannerDismissed(false);
        }
        return res;
      } catch (err) {
        if (!silent) {
          const msg = err instanceof Error ? err.message : String(err);
          setUpdateError(msg || '检查更新失败，请检查网络或代理设置后重试');
        }
        return null;
      } finally {
        updateCheckingRef.current = false;
        setUpdateChecking(false);
      }
    },
    [],
  );

  const installAvailableUpdate = useCallback(async (): Promise<UpdateInstallResult | null> => {
    const current = latestUpdateRef.current;
    if (!current || !current.hasUpdate || updateInstallingRef.current) {
      return null;
    }
    updateInstallingRef.current = true;
    setUpdateInstalling(true);
    setUpdateError(null);
    setUpdateProgress({
      stage: 'downloading',
      downloadedBytes: 0,
      totalBytes: current.recommendedAsset?.size ?? null,
      percent: 0,
      message: '准备下载更新…',
    });
    try {
      const res = await api.downloadAndInstallUpdate(current);
      if (res.message) {
        showToast(res.message);
      }
      if (res.action !== 'relaunched') {
        updateInstallingRef.current = false;
        setUpdateInstalling(false);
      }
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUpdateError(msg || '下载或安装更新失败');
      setUpdateProgress({
        stage: 'error',
        downloadedBytes: 0,
        totalBytes: current.recommendedAsset?.size ?? null,
        percent: null,
        message: msg,
      });
      showToast(`更新失败：${msg}`);
      updateInstallingRef.current = false;
      setUpdateInstalling(false);
      return null;
    }
  }, [showToast]);

  const skipUpdateVersion = useCallback(
    async (version: string | null) => {
      await updateDeviceSettings({ skippedUpdateVersion: version });
      if (version) {
        setUpdateBannerDismissed(true);
        showToast(`已跳过版本 v${version}`);
      } else {
        setUpdateBannerDismissed(false);
        showToast('已取消跳过此版本');
      }
    },
    [showToast, updateDeviceSettings],
  );

  const dismissUpdateBanner = useCallback(() => {
    setUpdateBannerDismissed(true);
  }, []);

  // Also format time string helper kept referenced (avoid unused import)
  void pad2;

  const value: DeskTagStoreValue = {
    loading,
    data,
    device,
    dock,
    dockTransition,
    clearDockTransition,
    platform,
    isMobileLayout,
    notifications,
    unreadNotificationCount,
    webdavConfig,
    webdavStatus,
    activeTodos,
    activeLists,
    activeNotes,
    activeNoteGroups,
    activeTab,
    todoScope,
    selectedListId,
    showQuadrant,
    mobileSection,
    mobileViewsSubTab,
    editingTodoId,
    reminderTodoId,
    showListManager,
    showSettings,
    settingsTab,
    showSearch,
    showVoiceModal,
    showSkinPopover,
    showNotifications,
    showMoreMenu,
    navHistory,
    unlockedGroupIds,
    toastMessage,
    quickAddFocusTrigger,
    setActiveTab,
    setTodoScope,
    setSelectedListId,
    setShowQuadrant,
    setMobileSection,
    setMobileViewsSubTab,
    setEditingTodoId,
    setReminderTodoId,
    setShowListManager,
    setShowSettings,
    setSettingsTab,
    setShowSearch,
    setShowVoiceModal,
    setShowSkinPopover,
    setShowNotifications,
    setShowMoreMenu,
    closeAllPopovers,
    openContentLink,
    navigateBack,
    showToast,
    addTodo,
    addTodosBatch,
    updateTodo,
    toggleTodo,
    deleteTodo,
    reorderTodos,
    addSubtask,
    updateSubtask,
    toggleSubtask,
    deleteSubtask,
    reorderSubtasks,
    addList,
    updateList,
    deleteList,
    toggleListPin,
    reorderLists,
    addNote,
    updateNote,
    deleteNote,
    toggleNotePin,
    addTimelineEntry,
    updateTimelineEntry,
    deleteTimelineEntry,
    convertTimelineEntryToTodo,
    addContentLink,
    replaceContentLink,
    removeContentLink,
    addNoteGroup,
    updateNoteGroup,
    deleteNoteGroup,
    lockNoteGroup,
    unlockNoteGroup,
    relockNoteGroup,
    removeNoteGroupLock,
    updateSyncedSettings,
    updateDeviceSettings,
    setDockMode,
    toggleAutoHide,
    toggleAlwaysOnTop,
    expandPanel,
    collapsePanel,
    hideToTray,
    quitApp,
    resetPanelLayout,
    replaceAppData,
    applySyncedAppData,
    refreshNotifications,
    markNotificationsRead,
    clearNotifications,
    refreshWebdav,
    triggerWebdavSyncNow,
    setWebdavConfigState: setWebdavConfig,
    setWebdavStatusState: setWebdavStatus,
    updateResult,
    updateChecking,
    updateError,
    updateInstalling,
    updateProgress,
    updateBannerDismissed,
    hasUnignoredUpdate,
    checkForUpdates,
    installAvailableUpdate,
    skipUpdateVersion,
    dismissUpdateBanner,
  };

  return React.createElement(DeskTagContext.Provider, { value }, children);
};

export function useDeskTagStore(): DeskTagStoreValue {
  const ctx = useContext(DeskTagContext);
  if (!ctx) {
    throw new Error('useDeskTagStore must be used inside <DeskTagProvider>');
  }
  return ctx;
}
