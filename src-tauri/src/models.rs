use chrono::Utc;
use serde::{Deserialize, Serialize};

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TodoPriority {
    #[default]
    None,
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuadrantId {
    Q1,
    Q2,
    Q3,
    Q4,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentKind {
    #[default]
    File,
    Image,
    Audio,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRef {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub relative_path: String,
    #[serde(default)]
    pub kind: AttachmentKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkTargetType {
    Todo,
    Note,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentLink {
    pub target_type: LinkTargetType,
    pub target_id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub note_images: Vec<AttachmentRef>,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub sort_order: f64,
    #[serde(default = "now_iso")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RepeatFrequency {
    #[default]
    Daily,
    Weekly,
    Monthly,
    Yearly,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatRule {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub frequency: RepeatFrequency,
    #[serde(default = "default_repeat_interval")]
    pub interval: u32,
    #[serde(default)]
    pub weekdays: Vec<u8>,
    #[serde(default)]
    pub end_date: Option<String>,
}

fn default_repeat_interval() -> u32 {
    1
}

impl Default for RepeatRule {
    fn default() -> Self {
        Self {
            enabled: false,
            frequency: RepeatFrequency::Daily,
            interval: 1,
            weekdays: Vec::new(),
            end_date: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ReminderMode {
    #[default]
    Standard,
    Recurring,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ReminderFrequency {
    #[default]
    Daily,
    Weekly,
    MonthDay,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ReminderIntervalUnit {
    Hours,
    #[default]
    Days,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ReminderStopCondition {
    #[default]
    UntilComplete,
    MaxCount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderRule {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub next_at: Option<String>,
    #[serde(default)]
    pub mode: ReminderMode,
    #[serde(default)]
    pub frequency: ReminderFrequency,
    #[serde(default)]
    pub weekdays: Vec<u8>,
    #[serde(default)]
    pub month: Option<u8>,
    #[serde(default)]
    pub day: Option<u8>,
    #[serde(default)]
    pub interval_value: Option<u32>,
    #[serde(default)]
    pub interval_unit: Option<ReminderIntervalUnit>,
    #[serde(default)]
    pub times: Vec<String>,
    #[serde(default)]
    pub stop_condition: ReminderStopCondition,
    #[serde(default)]
    pub max_count: Option<u32>,
    #[serde(default)]
    pub triggered_count: u32,
    #[serde(default)]
    pub last_triggered_at: Option<String>,
}

impl Default for ReminderRule {
    fn default() -> Self {
        Self {
            enabled: false,
            next_at: None,
            mode: ReminderMode::Standard,
            frequency: ReminderFrequency::Daily,
            weekdays: Vec::new(),
            month: None,
            day: None,
            interval_value: None,
            interval_unit: None,
            times: Vec::new(),
            stop_condition: ReminderStopCondition::UntilComplete,
            max_count: None,
            triggered_count: 0,
            last_triggered_at: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub note_images: Vec<AttachmentRef>,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub priority: TodoPriority,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub due_time: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub list_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub subtasks: Vec<SubtaskItem>,
    #[serde(default)]
    pub repeat_rule: Option<RepeatRule>,
    #[serde(default)]
    pub reminder_rule: Option<ReminderRule>,
    #[serde(default)]
    pub quadrant_override: Option<QuadrantId>,
    #[serde(default)]
    pub links: Vec<ContentLink>,
    #[serde(default)]
    pub sort_order: f64,
    #[serde(default = "now_iso")]
    pub created_at: String,
    #[serde(default = "now_iso")]
    pub updated_at: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoList {
    pub id: String,
    pub name: String,
    #[serde(default = "default_list_color")]
    pub color: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub pinned_to_side: bool,
    #[serde(default)]
    pub tab_width: Option<u32>,
    #[serde(default)]
    pub sort_order: f64,
    #[serde(default = "now_iso")]
    pub created_at: String,
    #[serde(default = "now_iso")]
    pub updated_at: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

fn default_list_color() -> String {
    "#df6542".to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum NoteKind {
    #[default]
    Normal,
    Timeline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEntry {
    pub id: String,
    pub content: String,
    #[serde(default = "now_iso")]
    pub created_at: String,
    #[serde(default = "now_iso")]
    pub updated_at: String,
    #[serde(default)]
    pub attachments: Vec<AttachmentRef>,
    #[serde(default)]
    pub linked_todo_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub kind: NoteKind,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub timeline_entries: Vec<TimelineEntry>,
    #[serde(default)]
    pub attachments: Vec<AttachmentRef>,
    #[serde(default)]
    pub links: Vec<ContentLink>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub pinned_to_side: bool,
    #[serde(default)]
    pub tab_width: Option<u32>,
    #[serde(default)]
    pub sort_order: f64,
    #[serde(default = "now_iso")]
    pub created_at: String,
    #[serde(default = "now_iso")]
    pub updated_at: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub pin_hash: Option<String>,
    #[serde(default)]
    pub sort_order: f64,
    #[serde(default = "now_iso")]
    pub created_at: String,
    #[serde(default = "now_iso")]
    pub updated_at: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum NotificationKind {
    #[default]
    Reminder,
    Sync,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationItem {
    pub id: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub kind: NotificationKind,
    #[serde(default)]
    pub todo_id: Option<String>,
    #[serde(default = "now_iso")]
    pub created_at: String,
    #[serde(default)]
    pub read: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TodoSortBy {
    #[default]
    Manual,
    Priority,
    DueDate,
    CreatedAt,
    UpdatedAt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DefaultView {
    #[default]
    Today,
    Week,
    Month,
    Unscheduled,
    Quadrant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuadrantRules {
    #[serde(default = "default_urgent_within_days")]
    pub urgent_within_days: u32,
    #[serde(default = "default_important_priorities")]
    pub important_priorities: Vec<TodoPriority>,
    #[serde(default = "default_quadrant_scope")]
    pub scope: String,
}

fn default_urgent_within_days() -> u32 {
    1
}

fn default_important_priorities() -> Vec<TodoPriority> {
    vec![TodoPriority::High, TodoPriority::Medium]
}

fn default_quadrant_scope() -> String {
    "all".to_string()
}

impl Default for QuadrantRules {
    fn default() -> Self {
        Self {
            urgent_within_days: default_urgent_within_days(),
            important_priorities: default_important_priorities(),
            scope: default_quadrant_scope(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedSettings {
    #[serde(default = "default_skin_id")]
    pub skin_id: String,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_body_font_size")]
    pub body_font_size: u32,
    #[serde(default = "default_ui_font_size")]
    pub ui_font_size: u32,
    #[serde(default = "default_true")]
    pub auto_numbering: bool,
    #[serde(default)]
    pub sort_by: TodoSortBy,
    #[serde(default = "default_true")]
    pub show_details_in_list: bool,
    #[serde(default)]
    pub default_view: DefaultView,
    #[serde(default)]
    pub quadrant_rules: QuadrantRules,
    #[serde(default = "default_true")]
    pub smart_text_recognition: bool,
    #[serde(default)]
    pub dnd_enabled: bool,
    #[serde(default = "default_dnd_start")]
    pub dnd_start: String,
    #[serde(default = "default_dnd_end")]
    pub dnd_end: String,
    #[serde(default = "default_true")]
    pub notification_sound: bool,
    #[serde(default = "default_language")]
    pub language: String,
}

fn default_skin_id() -> String {
    "morning-linen".to_string()
}
fn default_opacity() -> f64 {
    1.0
}
fn default_font_family() -> String {
    "system".to_string()
}
fn default_body_font_size() -> u32 {
    14
}
fn default_ui_font_size() -> u32 {
    13
}
fn default_true() -> bool {
    true
}
fn default_dnd_start() -> String {
    "22:00".to_string()
}
fn default_dnd_end() -> String {
    "08:00".to_string()
}
fn default_language() -> String {
    "zh-CN".to_string()
}

impl Default for SyncedSettings {
    fn default() -> Self {
        Self {
            skin_id: default_skin_id(),
            opacity: default_opacity(),
            font_family: default_font_family(),
            body_font_size: default_body_font_size(),
            ui_font_size: default_ui_font_size(),
            auto_numbering: true,
            sort_by: TodoSortBy::Manual,
            show_details_in_list: true,
            default_view: DefaultView::Today,
            quadrant_rules: QuadrantRules::default(),
            smart_text_recognition: true,
            dnd_enabled: false,
            dnd_start: default_dnd_start(),
            dnd_end: default_dnd_end(),
            notification_sound: true,
            language: default_language(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DockMode {
    #[default]
    RightTabs,
    RightHide,
    LeftTabs,
    LeftHide,
    TopHide,
    TopTabs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TabWidthMode {
    #[default]
    Uniform,
    Auto,
    Individual,
}

/// Device-local settings (KeepOwn — NEVER uploaded to WebDAV or overwritten by sync).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSettings {
    #[serde(default)]
    pub dock_mode: DockMode,
    #[serde(default)]
    pub auto_hide: bool,
    #[serde(default)]
    pub always_on_top: bool,
    #[serde(default = "default_panel_width")]
    pub panel_width: u32,
    #[serde(default = "default_panel_height")]
    pub panel_height: u32,
    #[serde(default)]
    pub panel_x: Option<i32>,
    #[serde(default)]
    pub panel_y: Option<i32>,
    #[serde(default)]
    pub monitor_name: Option<String>,
    #[serde(default)]
    pub tab_width_mode: TabWidthMode,
    #[serde(default = "default_uniform_tab_width")]
    pub uniform_tab_width: u32,
    #[serde(default = "default_max_visible_tabs")]
    pub max_visible_tabs: u32,
    #[serde(default)]
    pub launch_at_login: bool,
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    #[serde(default = "default_shortcut_toggle")]
    pub global_shortcut_toggle: String,
    #[serde(default = "default_shortcut_quick_add")]
    pub global_shortcut_quick_add: String,
    #[serde(default)]
    pub custom_data_dir: Option<String>,
}

fn default_panel_width() -> u32 {
    480
}
fn default_panel_height() -> u32 {
    680
}
fn default_uniform_tab_width() -> u32 {
    64
}
fn default_max_visible_tabs() -> u32 {
    8
}
fn default_shortcut_toggle() -> String {
    "Alt+Shift+D".to_string()
}
fn default_shortcut_quick_add() -> String {
    "Alt+Shift+N".to_string()
}

impl Default for DeviceSettings {
    fn default() -> Self {
        Self {
            dock_mode: DockMode::RightTabs,
            auto_hide: false,
            always_on_top: false,
            panel_width: default_panel_width(),
            panel_height: default_panel_height(),
            panel_x: None,
            panel_y: None,
            monitor_name: None,
            tab_width_mode: TabWidthMode::Uniform,
            uniform_tab_width: default_uniform_tab_width(),
            max_visible_tabs: default_max_visible_tabs(),
            launch_at_login: false,
            close_to_tray: true,
            global_shortcut_toggle: default_shortcut_toggle(),
            global_shortcut_quick_add: default_shortcut_quick_add(),
            custom_data_dir: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub todos: Vec<TodoItem>,
    #[serde(default)]
    pub lists: Vec<TodoList>,
    #[serde(default)]
    pub notes: Vec<NoteItem>,
    #[serde(default)]
    pub note_groups: Vec<NoteGroup>,
    #[serde(default)]
    pub settings: SyncedSettings,
    #[serde(default = "now_iso")]
    pub updated_at: String,
}

fn default_schema_version() -> u32 {
    CURRENT_SCHEMA_VERSION
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            todos: Vec::new(),
            lists: Vec::new(),
            notes: Vec::new(),
            note_groups: Vec::new(),
            settings: SyncedSettings::default(),
            updated_at: now_iso(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformKind {
    Windows,
    Macos,
    Android,
    Linux,
}

impl PlatformKind {
    pub fn current() -> Self {
        #[cfg(target_os = "windows")]
        {
            Self::Windows
        }
        #[cfg(target_os = "macos")]
        {
            Self::Macos
        }
        #[cfg(target_os = "android")]
        {
            Self::Android
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "android")))]
        {
            Self::Linux
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockState {
    pub mode: DockMode,
    pub collapsed: bool,
    pub auto_hide: bool,
    pub always_on_top: bool,
    pub platform: PlatformKind,
}

impl DockState {
    pub fn from_device(device: &DeviceSettings) -> Self {
        Self {
            mode: device.dock_mode,
            collapsed: false,
            auto_hide: device.auto_hide,
            always_on_top: device.always_on_top,
            platform: PlatformKind::current(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub platform: PlatformKind,
    pub is_desktop: bool,
    pub is_mobile: bool,
    pub app_version: String,
    pub supports_edge_dock: bool,
    pub supports_global_shortcut: bool,
    pub supports_tray: bool,
}

impl PlatformInfo {
    pub fn current() -> Self {
        let platform = PlatformKind::current();
        let is_mobile = matches!(platform, PlatformKind::Android);
        let is_desktop = !is_mobile;
        Self {
            platform,
            is_desktop,
            is_mobile,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            supports_edge_dock: is_desktop,
            supports_global_shortcut: is_desktop,
            supports_tray: is_desktop,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateBundle {
    pub data: AppData,
    pub device: DeviceSettings,
    pub dock: DockState,
    pub platform: PlatformInfo,
}

/// Stored privately on disk (`sync.json`, `0600`). NEVER serialized directly to frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub passphrase: String,
    #[serde(default = "default_remote_dir")]
    pub remote_dir: String,
    #[serde(default = "default_auto_sync_minutes")]
    pub auto_sync_minutes: i32,
    #[serde(default = "default_true")]
    pub debounce_push: bool,
    #[serde(default)]
    pub follow_server: bool,
}

fn default_remote_dir() -> String {
    "desktag".to_string()
}

fn default_auto_sync_minutes() -> i32 {
    3
}

impl Default for WebDavConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            url: String::new(),
            username: String::new(),
            password: String::new(),
            passphrase: String::new(),
            remote_dir: default_remote_dir(),
            auto_sync_minutes: default_auto_sync_minutes(),
            debounce_push: true,
            follow_server: false,
        }
    }
}

impl WebDavConfig {
    pub fn to_view(&self) -> WebDavConfigView {
        WebDavConfigView {
            enabled: self.enabled,
            url: self.url.clone(),
            username: self.username.clone(),
            password_set: !self.password.is_empty(),
            passphrase_set: !self.passphrase.is_empty(),
            remote_dir: self.remote_dir.clone(),
            auto_sync_minutes: self.auto_sync_minutes,
            debounce_push: self.debounce_push,
            follow_server: self.follow_server,
        }
    }

    pub fn is_configured(&self) -> bool {
        !self.url.trim().is_empty() && !self.username.trim().is_empty() && !self.password.is_empty()
    }
}

/// Safe projection of WebDAV config for frontend display — secrets are masked as booleans.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavConfigView {
    pub enabled: bool,
    pub url: String,
    pub username: String,
    pub password_set: bool,
    pub passphrase_set: bool,
    pub remote_dir: String,
    pub auto_sync_minutes: i32,
    pub debounce_push: bool,
    pub follow_server: bool,
}

/// Input payload from frontend when saving, testing, or previewing WebDAV settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavConfigInput {
    pub enabled: bool,
    pub url: String,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
    #[serde(default)]
    pub clear_password: Option<bool>,
    #[serde(default)]
    pub clear_passphrase: Option<bool>,
    #[serde(default = "default_remote_dir")]
    pub remote_dir: String,
    #[serde(default = "default_auto_sync_minutes")]
    pub auto_sync_minutes: i32,
    #[serde(default = "default_true")]
    pub debounce_push: bool,
    #[serde(default)]
    pub follow_server: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerFileWarning {
    pub kind: String,
    pub message: String,
    pub can_replace: bool,
    #[serde(default)]
    pub hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictNotice {
    pub at: String,
    pub summary: String,
    pub backup_dir: String,
    pub conflict_count: usize,
    pub restored: bool,
    pub followed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WebDavStatusView {
    pub enabled: bool,
    pub configured: bool,
    pub syncing: bool,
    #[serde(default)]
    pub last_sync_at: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub server_file_warning: Option<ServerFileWarning>,
    #[serde(default)]
    pub conflict_notice: Option<ConflictNotice>,
    pub can_undo: bool,
    #[serde(default)]
    pub next_auto_sync_at: Option<String>,
    #[serde(default)]
    pub backend_hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreviewItem {
    pub entity_type: String,
    pub entity_id: String,
    pub title: String,
    pub action: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreview {
    pub token: String,
    pub direction: String,
    pub to_upload_count: usize,
    pub to_download_count: usize,
    pub conflict_count: usize,
    pub items: Vec<SyncPreviewItem>,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavTestResult {
    pub ok: bool,
    #[serde(default)]
    pub status_code: Option<u16>,
    pub message: String,
    pub remote_file_exists: bool,
    #[serde(default)]
    pub suggested_url: Option<String>,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncExecutionResult {
    pub ok: bool,
    pub changed_local: bool,
    pub changed_remote: bool,
    #[serde(default)]
    pub data: Option<AppData>,
    pub status: WebDavStatusView,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub data_dir: String,
    pub data_file_path: String,
    pub attachments_dir: String,
    pub sync_backup_dir: String,
    pub total_bytes: u64,
    pub is_custom_dir: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOptions {
    #[serde(default = "default_true")]
    pub include_data: bool,
    #[serde(default = "default_true")]
    pub include_settings: bool,
    #[serde(default)]
    pub target_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub path: String,
    pub bytes: u64,
    pub exported_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBackupResult {
    pub data: AppData,
    #[serde(default)]
    pub device: Option<DeviceSettings>,
    pub imported_todos: usize,
    pub imported_notes: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportDocFormat {
    Markdown,
    Html,
    Docx,
    Pdf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocumentRequest {
    pub format: ExportDocFormat,
    pub scope: String,
    #[serde(default)]
    pub note_id: Option<String>,
    #[serde(default)]
    pub target_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocumentResult {
    pub path: String,
    pub format: ExportDocFormat,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAttachmentInput {
    pub name: String,
    pub mime: String,
    #[serde(default)]
    pub kind: AttachmentKind,
    pub base64_data: String,
}
