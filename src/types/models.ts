/**
 * Canonical TypeScript data & IPC contracts for DeskTag.
 * 1:1 mirror of `src-tauri/src/models.rs` (camelCase JSON over Tauri v2 IPC).
 */

export const CURRENT_SCHEMA_VERSION = 1;

export type TodoPriority = 'none' | 'low' | 'medium' | 'high';

export type QuadrantId = 'q1' | 'q2' | 'q3' | 'q4';

export type AttachmentKind = 'file' | 'image' | 'audio';

export interface AttachmentRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  relativePath: string;
  kind: AttachmentKind;
}

export type LinkTargetType = 'todo' | 'note';

export interface ContentLink {
  targetType: LinkTargetType;
  targetId: string;
  label: string;
}

export interface SubtaskItem {
  id: string;
  title: string;
  notes: string;
  noteImages: AttachmentRef[];
  completed: boolean;
  sortOrder: number;
  updatedAt: string;
}

export type RepeatFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export interface RepeatRule {
  enabled: boolean;
  frequency: RepeatFrequency;
  interval: number;
  weekdays: number[]; // 1 (Mon) .. 7 (Sun)
  endDate: string | null;
}

export type ReminderMode = 'standard' | 'recurring';

export type ReminderFrequency = 'daily' | 'weekly' | 'month_day' | 'custom';

export type ReminderIntervalUnit = 'hours' | 'days';

export type ReminderStopCondition = 'until_complete' | 'max_count';

export interface ReminderRule {
  enabled: boolean;
  nextAt: string | null;
  mode: ReminderMode;
  frequency: ReminderFrequency;
  weekdays: number[]; // 1 (Mon) .. 7 (Sun)
  month: number | null;
  day: number | null;
  intervalValue: number | null;
  intervalUnit: ReminderIntervalUnit | null;
  times: string[]; // ["08:30", "18:00"]
  stopCondition: ReminderStopCondition;
  maxCount: number | null;
  triggeredCount: number;
  lastTriggeredAt: string | null;
}

export interface TodoItem {
  id: string;
  title: string;
  notes: string;
  noteImages: AttachmentRef[];
  completed: boolean;
  completedAt: string | null;
  priority: TodoPriority;
  dueDate: string | null; // YYYY-MM-DD
  dueTime: string | null; // HH:mm
  endDate: string | null; // YYYY-MM-DD (multi-day span)
  listId: string | null;
  tags: string[];
  subtasks: SubtaskItem[];
  repeatRule: RepeatRule | null;
  reminderRule: ReminderRule | null;
  quadrantOverride: QuadrantId | null;
  links: ContentLink[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TodoList {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  pinnedToSide: boolean;
  tabWidth: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type NoteKind = 'normal' | 'timeline';

export interface TimelineEntry {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  attachments: AttachmentRef[];
  linkedTodoId: string | null;
}

export interface NoteItem {
  id: string;
  title: string;
  kind: NoteKind;
  content: string;
  timelineEntries: TimelineEntry[];
  attachments: AttachmentRef[];
  links: ContentLink[];
  groupId: string | null;
  pinnedToSide: boolean;
  tabWidth: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NoteGroup {
  id: string;
  name: string;
  locked: boolean;
  pinHash: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type NotificationKind = 'reminder' | 'sync' | 'system';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  kind: NotificationKind;
  todoId: string | null;
  createdAt: string;
  read: boolean;
}

export type TodoSortBy = 'manual' | 'priority' | 'due_date' | 'created_at' | 'updated_at';

export type DefaultView = 'today' | 'week' | 'month' | 'unscheduled' | 'quadrant';

export interface QuadrantRules {
  urgentWithinDays: number;
  importantPriorities: TodoPriority[];
  scope: string;
}

export interface SyncedSettings {
  skinId: string;
  opacity: number;
  fontFamily: string;
  bodyFontSize: number;
  uiFontSize: number;
  autoNumbering: boolean;
  sortBy: TodoSortBy;
  showDetailsInList: boolean;
  defaultView: DefaultView;
  quadrantRules: QuadrantRules;
  smartTextRecognition: boolean;
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  notificationSound: boolean;
  language: string;
}

export type DockMode =
  | 'right_tabs'
  | 'right_hide'
  | 'left_tabs'
  | 'left_hide'
  | 'top_hide'
  | 'top_tabs';

export type TabWidthMode = 'uniform' | 'auto' | 'individual';

/** Device-local settings (KeepOwn — NEVER synced across devices). */
export interface DeviceSettings {
  dockMode: DockMode;
  autoHide: boolean;
  alwaysOnTop: boolean;
  panelWidth: number;
  panelHeight: number;
  panelX: number | null;
  panelY: number | null;
  monitorName: string | null;
  tabWidthMode: TabWidthMode;
  uniformTabWidth: number;
  maxVisibleTabs: number;
  launchAtLogin: boolean;
  closeToTray: boolean;
  globalShortcutToggle: string;
  globalShortcutQuickAdd: string;
  customDataDir: string | null;
  autoCheckUpdates: boolean;
  skippedUpdateVersion: string | null;
  lastUpdateCheckAt: string | null;
}

export interface AppData {
  schemaVersion: number;
  todos: TodoItem[];
  lists: TodoList[];
  notes: NoteItem[];
  noteGroups: NoteGroup[];
  settings: SyncedSettings;
  updatedAt: string;
}

export type PlatformKind = 'windows' | 'macos' | 'android' | 'linux';

export interface DockState {
  mode: DockMode;
  collapsed: boolean;
  autoHide: boolean;
  alwaysOnTop: boolean;
  platform: PlatformKind;
}

export interface PlatformInfo {
  platform: PlatformKind;
  isDesktop: boolean;
  isMobile: boolean;
  appVersion: string;
  supportsEdgeDock: boolean;
  supportsGlobalShortcut: boolean;
  supportsTray: boolean;
}

export interface AppStateBundle {
  data: AppData;
  device: DeviceSettings;
  dock: DockState;
  platform: PlatformInfo;
}

/** Private config shape (never returned raw with secrets from backend). */
export interface WebDavConfig {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  passphrase: string;
  remoteDir: string;
  autoSyncMinutes: number;
  debouncePush: boolean;
  followServer: boolean;
}

/** Safe UI view of WebDAV config — secrets are masked as booleans. */
export interface WebDavConfigView {
  enabled: boolean;
  url: string;
  username: string;
  passwordSet: boolean;
  passphraseSet: boolean;
  remoteDir: string;
  autoSyncMinutes: number;
  debouncePush: boolean;
  followServer: boolean;
}

/** Input payload when saving, testing, or previewing WebDAV config. */
export interface WebDavConfigInput {
  enabled: boolean;
  url: string;
  username: string;
  password?: string | null;
  passphrase?: string | null;
  clearPassword?: boolean;
  clearPassphrase?: boolean;
  remoteDir: string;
  autoSyncMinutes: number;
  debouncePush: boolean;
  followServer: boolean;
}

export interface ServerFileWarning {
  kind: string;
  message: string;
  canReplace: boolean;
  hint: string | null;
}

export interface ConflictNotice {
  at: string;
  summary: string;
  backupDir: string;
  conflictCount: number;
  restored: boolean;
  followed: boolean;
}

export interface WebDavStatusView {
  enabled: boolean;
  configured: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  serverFileWarning: ServerFileWarning | null;
  conflictNotice: ConflictNotice | null;
  canUndo: boolean;
  nextAutoSyncAt: string | null;
  backendHint: string | null;
}

export interface SyncPreviewItem {
  entityType: string;
  entityId: string;
  title: string;
  action: string;
}

export interface SyncPreview {
  token: string;
  direction: string;
  toUploadCount: number;
  toDownloadCount: number;
  conflictCount: number;
  items: SyncPreviewItem[];
  summary: string;
}

export interface WebDavTestResult {
  ok: boolean;
  statusCode: number | null;
  message: string;
  remoteFileExists: boolean;
  suggestedUrl: string | null;
  latencyMs: number;
}

export interface SyncExecutionResult {
  ok: boolean;
  changedLocal: boolean;
  changedRemote: boolean;
  data: AppData | null;
  status: WebDavStatusView;
  message: string;
}

export interface StorageInfo {
  dataDir: string;
  dataFilePath: string;
  attachmentsDir: string;
  syncBackupDir: string;
  totalBytes: number;
  isCustomDir: boolean;
}

export interface BackupOptions {
  includeData: boolean;
  includeSettings: boolean;
  targetPath?: string | null;
}

export interface BackupResult {
  path: string;
  bytes: number;
  exportedAt: string;
}

export interface ImportBackupResult {
  data: AppData;
  device: DeviceSettings | null;
  importedTodos: number;
  importedNotes: number;
}

export type ExportDocFormat = 'markdown' | 'html' | 'docx' | 'pdf';

export interface ExportDocumentRequest {
  format: ExportDocFormat;
  scope: string;
  noteId?: string | null;
  targetPath?: string | null;
}

export interface ExportDocumentResult {
  path: string;
  format: ExportDocFormat;
  bytes: number;
}

export interface SaveAttachmentInput {
  name: string;
  mime: string;
  kind: AttachmentKind;
  base64Data: string;
}

export type InstallKind =
  | 'windows_standalone'
  | 'windows_nsis'
  | 'windows_msi'
  | 'macos_arm64'
  | 'macos_x64'
  | 'android_arm64'
  | 'linux';

export interface UpdateAsset {
  name: string;
  url: string;
  size: number | null;
  sha256: string | null;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  skipped: boolean;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string | null;
  releaseUrl: string;
  installKind: InstallKind;
  recommendedAsset: UpdateAsset | null;
  checkedAt: string;
  source: string;
}

export type UpdateDownloadStage = 'downloading' | 'verifying' | 'installing' | 'ready' | 'error';

export interface UpdateDownloadProgress {
  stage: UpdateDownloadStage;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  message: string | null;
}

export type UpdateInstallAction =
  | 'relaunched'
  | 'installer_launched'
  | 'revealed_in_folder'
  | 'opened_url';

export interface UpdateInstallResult {
  action: UpdateInstallAction;
  path: string | null;
  message: string;
}

export function createDefaultSyncedSettings(): SyncedSettings {
  return {
    skinId: 'ink-minimal',
    opacity: 1.0,
    fontFamily: 'system',
    bodyFontSize: 14,
    uiFontSize: 13,
    autoNumbering: true,
    sortBy: 'manual',
    showDetailsInList: true,
    defaultView: 'today',
    quadrantRules: {
      urgentWithinDays: 1,
      importantPriorities: ['high', 'medium'],
      scope: 'all',
    },
    smartTextRecognition: true,
    dndEnabled: false,
    dndStart: '22:00',
    dndEnd: '08:00',
    notificationSound: true,
    language: 'zh-CN',
  };
}

export function createDefaultDeviceSettings(): DeviceSettings {
  return {
    dockMode: 'right_tabs',
    autoHide: false,
    alwaysOnTop: false,
    panelWidth: 480,
    panelHeight: 680,
    panelX: null,
    panelY: null,
    monitorName: null,
    tabWidthMode: 'uniform',
    uniformTabWidth: 64,
    maxVisibleTabs: 8,
    launchAtLogin: false,
    closeToTray: true,
    globalShortcutToggle: 'Alt+Shift+D',
    globalShortcutQuickAdd: 'Alt+Shift+N',
    customDataDir: null,
    autoCheckUpdates: true,
    skippedUpdateVersion: null,
    lastUpdateCheckAt: null,
  };
}

export function createDefaultAppData(): AppData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    todos: [],
    lists: [],
    notes: [],
    noteGroups: [],
    settings: createDefaultSyncedSettings(),
    updatedAt: new Date().toISOString(),
  };
}
