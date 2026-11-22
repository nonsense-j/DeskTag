use std::sync::Arc;
use std::time::Duration;

use chrono::{
    DateTime, Datelike, Duration as ChronoDuration, Local, NaiveDate, NaiveDateTime, NaiveTime,
    TimeZone, Timelike, Utc,
};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

use crate::models::{
    now_iso, NotificationItem, NotificationKind, ReminderFrequency, ReminderIntervalUnit,
    ReminderMode, ReminderRule, ReminderStopCondition,
};
use crate::storage::StorageManager;

/// Parse an `HH:MM` (or `HH:MM:SS`) clock time string.
pub fn parse_hhmm(raw: &str) -> Option<NaiveTime> {
    let s = raw.trim();
    NaiveTime::parse_from_str(s, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(s, "%H:%M:%S"))
        .ok()
}

/// Parse a reminder timestamp from RFC 3339 or local naive formats (`YYYY-MM-DDTHH:MM`,
/// `YYYY-MM-DD HH:MM`, `YYYY/MM/DD HH:MM`) into UTC.
pub fn parse_reminder_timestamp(raw: &str) -> Option<DateTime<Utc>> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }
    let naive = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M"))
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S"))
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M"))
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y/%m/%d %H:%M:%S"))
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y/%m/%d %H:%M"))
        .ok()?;
    local_naive_to_utc(naive)
}

fn local_naive_to_utc(naive: NaiveDateTime) -> Option<DateTime<Utc>> {
    Local
        .from_local_datetime(&naive)
        .earliest()
        .or_else(|| Local.from_local_datetime(&naive).latest())
        .map(|dt| dt.with_timezone(&Utc))
}

fn naive_in_tz<Tz: TimeZone>(tz: &Tz, date: NaiveDate, time: NaiveTime) -> Option<DateTime<Tz>> {
    let naive = date.and_time(time);
    tz.from_local_datetime(&naive)
        .earliest()
        .or_else(|| tz.from_local_datetime(&naive).latest())
}

/// Check whether `local_time` falls within the configured Do-Not-Disturb quiet window.
/// Properly handles midnight wrap-around ranges such as `22:00` – `08:00`.
pub fn is_in_dnd_window(
    local_time: NaiveTime,
    dnd_enabled: bool,
    dnd_start: &str,
    dnd_end: &str,
) -> bool {
    if !dnd_enabled {
        return false;
    }
    let (Some(start), Some(end)) = (parse_hhmm(dnd_start), parse_hhmm(dnd_end)) else {
        return false;
    };
    if start == end {
        return false;
    }
    if start < end {
        local_time >= start && local_time < end
    } else {
        // Wraps across midnight (e.g., 22:00 -> 08:00)
        local_time >= start || local_time < end
    }
}

fn sorted_rule_times<Tz: TimeZone>(rule: &ReminderRule, fallback_dt: &DateTime<Tz>) -> Vec<NaiveTime> {
    let mut times: Vec<NaiveTime> = rule.times.iter().filter_map(|t| parse_hhmm(t)).collect();
    times.sort();
    times.dedup();
    if times.is_empty() {
        if let Some(next_str) = rule.next_at.as_deref() {
            if let Some(dt_utc) = parse_reminder_timestamp(next_str) {
                let dt_tz = dt_utc.with_timezone(&fallback_dt.timezone());
                times.push(dt_tz.time());
            }
        }
    }
    if times.is_empty() {
        let t = NaiveTime::from_hms_opt(fallback_dt.hour(), fallback_dt.minute(), 0)
            .unwrap_or_else(|| NaiveTime::from_hms_opt(9, 0, 0).expect("valid 09:00"));
        times.push(t);
    }
    times
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    };
    next.and_then(|d| d.pred_opt())
        .map(|d| d.day())
        .unwrap_or(28)
}

/// Compute the next reminder trigger strictly after `after` (or at/after for initial Standard).
/// Returns `None` if disabled, exhausted by `MaxCount`, or Standard has already fired.
pub fn compute_next_trigger_at<Tz: TimeZone>(
    rule: &ReminderRule,
    after: DateTime<Tz>,
) -> Option<DateTime<Tz>> {
    if !rule.enabled {
        return None;
    }
    if rule.stop_condition == ReminderStopCondition::MaxCount {
        if let Some(max) = rule.max_count {
            if rule.triggered_count >= max {
                return None;
            }
        }
    }

    let tz = after.timezone();

    if rule.mode == ReminderMode::Standard {
        if rule.triggered_count > 0 {
            return None;
        }
        let next_str = rule.next_at.as_deref()?;
        let dt_utc = parse_reminder_timestamp(next_str)?;
        return Some(dt_utc.with_timezone(&tz));
    }

    let times = sorted_rule_times(rule, &after);

    match rule.frequency {
        ReminderFrequency::Daily => {
            let base_date = after.date_naive();
            for day_offset in 0..=2 {
                let d = base_date + ChronoDuration::days(day_offset);
                for &t in &times {
                    if let Some(cand) = naive_in_tz(&tz, d, t) {
                        if cand > after {
                            return Some(cand);
                        }
                    }
                }
            }
            None
        }
        ReminderFrequency::Weekly => {
            let mut weekdays: Vec<u8> = rule
                .weekdays
                .iter()
                .copied()
                .filter(|&w| (1..=7).contains(&w))
                .collect();
            if weekdays.is_empty() {
                weekdays.push(after.weekday().number_from_monday() as u8);
            }
            let base_date = after.date_naive();
            for day_offset in 0..=14 {
                let d = base_date + ChronoDuration::days(day_offset);
                let iso_wd = d.weekday().number_from_monday() as u8;
                if !weekdays.contains(&iso_wd) {
                    continue;
                }
                for &t in &times {
                    if let Some(cand) = naive_in_tz(&tz, d, t) {
                        if cand > after {
                            return Some(cand);
                        }
                    }
                }
            }
            None
        }
        ReminderFrequency::MonthDay => {
            let target_day = rule.day.unwrap_or(after.day() as u8).clamp(1, 31) as u32;
            match rule.month.filter(|&m| (1..=12).contains(&m)) {
                Some(target_month) => {
                    // Specific month & day every year.
                    for year_offset in 0..=8 {
                        let year = after.year() + year_offset;
                        let max_d = days_in_month(year, target_month as u32);
                        let day = target_day.min(max_d);
                        if let Some(d) = NaiveDate::from_ymd_opt(year, target_month as u32, day) {
                            for &t in &times {
                                if let Some(cand) = naive_in_tz(&tz, d, t) {
                                    if cand > after {
                                        return Some(cand);
                                    }
                                }
                            }
                        }
                    }
                    None
                }
                None => {
                    // Specific day of every month.
                    let start_year = after.year();
                    let start_month = after.month() as i32;
                    for m_offset in 0..=24 {
                        let total_m = (start_month - 1) + m_offset;
                        let year = start_year + total_m.div_euclid(12);
                        let month = (total_m.rem_euclid(12) + 1) as u32;
                        let max_d = days_in_month(year, month);
                        let day = target_day.min(max_d);
                        if let Some(d) = NaiveDate::from_ymd_opt(year, month, day) {
                            for &t in &times {
                                if let Some(cand) = naive_in_tz(&tz, d, t) {
                                    if cand > after {
                                        return Some(cand);
                                    }
                                }
                            }
                        }
                    }
                    None
                }
            }
        }
        ReminderFrequency::Custom => {
            let step = rule.interval_value.unwrap_or(1).max(1) as i64;
            let unit = rule.interval_unit.unwrap_or(ReminderIntervalUnit::Days);
            match unit {
                ReminderIntervalUnit::Hours => {
                    let anchor = rule
                        .last_triggered_at
                        .as_deref()
                        .or(rule.next_at.as_deref())
                        .and_then(parse_reminder_timestamp)
                        .map(|u| u.with_timezone(&tz))
                        .unwrap_or_else(|| after.clone());
                    let step_dur = ChronoDuration::hours(step);
                    if anchor > after {
                        return Some(anchor);
                    }
                    let elapsed_secs = (after.clone() - anchor.clone()).num_seconds();
                    let step_secs = step_dur.num_seconds().max(1);
                    let jumps = (elapsed_secs / step_secs) + 1;
                    Some(anchor + ChronoDuration::seconds(jumps * step_secs))
                }
                ReminderIntervalUnit::Days => {
                    let anchor_date = rule
                        .last_triggered_at
                        .as_deref()
                        .or(rule.next_at.as_deref())
                        .and_then(parse_reminder_timestamp)
                        .map(|u| u.with_timezone(&tz).date_naive())
                        .unwrap_or_else(|| after.date_naive());
                    // First check remaining times on today if today is on the interval schedule.
                    let diff_days = (after.date_naive() - anchor_date).num_days();
                    let next_cycle_date = if diff_days <= 0 {
                        anchor_date
                    } else if diff_days % step == 0 {
                        after.date_naive()
                    } else {
                        anchor_date + ChronoDuration::days(((diff_days / step) + 1) * step)
                    };

                    for k in 0..=2 {
                        let d = next_cycle_date + ChronoDuration::days(k * step);
                        for &t in &times {
                            if let Some(cand) = naive_in_tz(&tz, d, t) {
                                if cand > after {
                                    return Some(cand);
                                }
                            }
                        }
                    }
                    None
                }
            }
        }
    }
}

/// Preview the next `count` reminder timestamps starting after `from`.
pub fn preview_next_triggers<Tz: TimeZone>(
    rule: &ReminderRule,
    from: DateTime<Tz>,
    count: usize,
) -> Vec<DateTime<Tz>> {
    let mut sim = rule.clone();
    let mut cursor = from;
    let mut results = Vec::with_capacity(count);
    for _ in 0..count {
        let Some(next) = compute_next_trigger_at(&sim, cursor) else {
            break;
        };
        results.push(next.clone());
        sim.triggered_count = sim.triggered_count.saturating_add(1);
        sim.last_triggered_at = Some(next.with_timezone(&Utc).to_rfc3339());
        cursor = next;
    }
    results
}

/// Evaluate all active uncompleted todos against `now_local`, fire due reminders
/// (unless inside the DND window), persist updated `AppData` and notifications,
/// and return the newly created notification items.
pub fn process_due_reminders_at(
    storage: &StorageManager,
    now_local: DateTime<Local>,
) -> Vec<NotificationItem> {
    let mut data = storage.load_app_data();
    if is_in_dnd_window(
        now_local.time(),
        data.settings.dnd_enabled,
        &data.settings.dnd_start,
        &data.settings.dnd_end,
    ) {
        return Vec::new();
    }

    let now_utc = now_local.with_timezone(&Utc);
    let mut fired: Vec<NotificationItem> = Vec::new();
    let mut data_dirty = false;

    for todo in &mut data.todos {
        if todo.deleted_at.is_some() || todo.completed {
            continue;
        }
        let Some(ref mut rule) = todo.reminder_rule else {
            continue;
        };
        if !rule.enabled {
            continue;
        }

        // If recurring reminder has no next_at initialized yet, seed it cleanly.
        if rule.next_at.is_none() && rule.mode == ReminderMode::Recurring {
            if let Some(first_next) = compute_next_trigger_at(rule, now_local) {
                rule.next_at = Some(first_next.with_timezone(&Utc).to_rfc3339());
                data_dirty = true;
            }
            continue;
        }

        let Some(next_utc) = rule.next_at.as_deref().and_then(parse_reminder_timestamp) else {
            continue;
        };

        if next_utc <= now_utc {
            // Respect max_count safeguard before firing.
            if rule.stop_condition == ReminderStopCondition::MaxCount {
                if let Some(max) = rule.max_count {
                    if rule.triggered_count >= max {
                        rule.enabled = false;
                        rule.next_at = None;
                        data_dirty = true;
                        continue;
                    }
                }
            }

            let body = if !todo.notes.trim().is_empty() {
                todo.notes.lines().next().unwrap_or("").trim().to_string()
            } else if let Some(ref due) = todo.due_date {
                match &todo.due_time {
                    Some(t) => format!("截止时间：{due} {t}"),
                    None => format!("截止日期：{due}"),
                }
            } else {
                "点击查看待办详情".to_string()
            };

            let notif = NotificationItem {
                id: Uuid::new_v4().to_string(),
                title: format!("待办提醒：{}", todo.title),
                body,
                kind: NotificationKind::Reminder,
                todo_id: Some(todo.id.clone()),
                created_at: now_iso(),
                read: false,
            };
            fired.push(notif);

            rule.triggered_count = rule.triggered_count.saturating_add(1);
            rule.last_triggered_at = Some(now_utc.to_rfc3339());

            match rule.mode {
                ReminderMode::Standard => {
                    rule.enabled = false;
                    rule.next_at = None;
                }
                ReminderMode::Recurring => {
                    if rule.stop_condition == ReminderStopCondition::MaxCount
                        && rule.max_count.map(|m| rule.triggered_count >= m).unwrap_or(false)
                    {
                        rule.enabled = false;
                        rule.next_at = None;
                    } else if let Some(next_dt) = compute_next_trigger_at(rule, now_local) {
                        rule.next_at = Some(next_dt.with_timezone(&Utc).to_rfc3339());
                    } else {
                        rule.enabled = false;
                        rule.next_at = None;
                    }
                }
            }

            todo.updated_at = now_iso();
            data_dirty = true;
        }
    }

    if data_dirty {
        let _ = storage.save_app_data(data);
    }

    for item in &fired {
        let _ = storage.append_notification(item.clone());
    }

    fired
}

pub struct ReminderScheduler {
    storage: Arc<StorageManager>,
}

impl ReminderScheduler {
    pub fn new(storage: Arc<StorageManager>) -> Self {
        Self { storage }
    }

    pub fn get_notifications(&self) -> Vec<NotificationItem> {
        self.storage.load_notifications()
    }

    pub fn mark_notifications_read(
        &self,
        ids: Option<Vec<String>>,
    ) -> Result<Vec<NotificationItem>, String> {
        let mut list = self.storage.load_notifications();
        for item in &mut list {
            if match &ids {
                None => true,
                Some(targets) => targets.iter().any(|id| id == &item.id),
            } {
                item.read = true;
            }
        }
        self.storage.save_notifications(&list)?;
        Ok(list)
    }

    pub fn clear_notifications(&self) -> Result<(), String> {
        self.storage.save_notifications(&[])
    }

    /// Spawn the background 15-second reminder ticker across desktop and Android.
    pub fn spawn_reminder_daemon(self: &Arc<Self>, app: AppHandle) {
        let storage = Arc::clone(&self.storage);
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(15));
            loop {
                ticker.tick().await;
                let fired = process_due_reminders_at(&storage, Local::now());
                if fired.is_empty() {
                    continue;
                }
                for item in &fired {
                    let _ = app
                        .notification()
                        .builder()
                        .title(&item.title)
                        .body(&item.body)
                        .show();
                }
                let updated_notifs = storage.load_notifications();
                let updated_data = storage.load_app_data();
                let _ = app.emit("desktag://notifications-updated", &updated_notifs);
                let _ = app.emit("desktag://data-updated", &updated_data);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AppData, TodoItem, TodoPriority};
    use chrono::FixedOffset;

    fn utc8(y: i32, m: u32, d: u32, hh: u32, mm: u32) -> DateTime<FixedOffset> {
        let tz = FixedOffset::east_opt(8 * 3600).unwrap();
        tz.with_ymd_and_hms(y, m, d, hh, mm, 0).unwrap()
    }

    #[test]
    fn test_dnd_window_wraparound_and_same_day() {
        // Midnight wraparound: 22:00 - 08:00
        assert!(is_in_dnd_window(
            NaiveTime::from_hms_opt(22, 0, 0).unwrap(),
            true,
            "22:00",
            "08:00"
        ));
        assert!(is_in_dnd_window(
            NaiveTime::from_hms_opt(23, 45, 0).unwrap(),
            true,
            "22:00",
            "08:00"
        ));
        assert!(is_in_dnd_window(
            NaiveTime::from_hms_opt(2, 30, 0).unwrap(),
            true,
            "22:00",
            "08:00"
        ));
        assert!(!is_in_dnd_window(
            NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            true,
            "22:00",
            "08:00"
        ));
        assert!(!is_in_dnd_window(
            NaiveTime::from_hms_opt(15, 0, 0).unwrap(),
            true,
            "22:00",
            "08:00"
        ));
        // Disabled DND
        assert!(!is_in_dnd_window(
            NaiveTime::from_hms_opt(23, 0, 0).unwrap(),
            false,
            "22:00",
            "08:00"
        ));
        // Same-day range: 12:00 - 14:00
        assert!(is_in_dnd_window(
            NaiveTime::from_hms_opt(12, 30, 0).unwrap(),
            true,
            "12:00",
            "14:00"
        ));
        assert!(!is_in_dnd_window(
            NaiveTime::from_hms_opt(14, 0, 0).unwrap(),
            true,
            "12:00",
            "14:00"
        ));
    }

    #[test]
    fn test_recurring_daily_and_weekly_multi_times() {
        // Friday 2026-11-13 08:30 (matches Daibantie reminder-cycle.webp example!)
        let rule = ReminderRule {
            enabled: true,
            mode: ReminderMode::Recurring,
            frequency: ReminderFrequency::Weekly,
            weekdays: vec![1, 5], // Mon & Fri
            times: vec!["18:00".into(), "08:30".into()], // intentionally unsorted
            stop_condition: ReminderStopCondition::UntilComplete,
            ..Default::default()
        };
        let start = utc8(2026, 11, 13, 8, 30); // Friday 08:30
        let seq = preview_next_triggers(&rule, start, 4);
        assert_eq!(seq.len(), 4);
        assert_eq!(seq[0], utc8(2026, 11, 13, 18, 0)); // Fri 18:00
        assert_eq!(seq[1], utc8(2026, 11, 16, 8, 30)); // Mon 08:30
        assert_eq!(seq[2], utc8(2026, 11, 16, 18, 0)); // Mon 18:00
        assert_eq!(seq[3], utc8(2026, 11, 20, 8, 30)); // Fri 08:30

        // Daily multi-times
        let daily = ReminderRule {
            enabled: true,
            mode: ReminderMode::Recurring,
            frequency: ReminderFrequency::Daily,
            times: vec!["09:00".into(), "21:00".into()],
            ..Default::default()
        };
        let d_next = compute_next_trigger_at(&daily, utc8(2026, 11, 13, 10, 0)).unwrap();
        assert_eq!(d_next, utc8(2026, 11, 13, 21, 0));
        let d_next2 = compute_next_trigger_at(&daily, utc8(2026, 11, 13, 21, 0)).unwrap();
        assert_eq!(d_next2, utc8(2026, 11, 14, 9, 0));
    }

    #[test]
    fn test_month_day_and_custom_intervals_and_max_count() {
        // MonthDay with Feb 31 -> clamps to Feb 28 (2027 is non-leap)
        let md_rule = ReminderRule {
            enabled: true,
            mode: ReminderMode::Recurring,
            frequency: ReminderFrequency::MonthDay,
            month: Some(2),
            day: Some(31),
            times: vec!["10:00".into()],
            ..Default::default()
        };
        let next_md = compute_next_trigger_at(&md_rule, utc8(2026, 11, 22, 12, 0)).unwrap();
        assert_eq!(next_md, utc8(2027, 2, 28, 10, 0));

        // Custom hours with MaxCount = 2
        let custom_hrs = ReminderRule {
            enabled: true,
            mode: ReminderMode::Recurring,
            frequency: ReminderFrequency::Custom,
            interval_value: Some(3),
            interval_unit: Some(ReminderIntervalUnit::Hours),
            stop_condition: ReminderStopCondition::MaxCount,
            max_count: Some(2),
            triggered_count: 0,
            ..Default::default()
        };
        let seq = preview_next_triggers(&custom_hrs, utc8(2026, 11, 22, 9, 0), 5);
        assert_eq!(seq.len(), 2);
        assert_eq!(seq[0], utc8(2026, 11, 22, 12, 0));
        assert_eq!(seq[1], utc8(2026, 11, 22, 15, 0));

        // Custom every 2 days
        let custom_days = ReminderRule {
            enabled: true,
            mode: ReminderMode::Recurring,
            frequency: ReminderFrequency::Custom,
            interval_value: Some(2),
            interval_unit: Some(ReminderIntervalUnit::Days),
            times: vec!["08:00".into()],
            last_triggered_at: Some(utc8(2026, 11, 20, 8, 0).to_rfc3339()),
            ..Default::default()
        };
        let next_d = compute_next_trigger_at(&custom_days, utc8(2026, 11, 20, 8, 0)).unwrap();
        assert_eq!(next_d, utc8(2026, 11, 22, 8, 0));
    }

    #[test]
    fn test_process_due_reminders_respects_dnd_and_advances() {
        let dir = std::env::temp_dir().join(format!("desktag_rem_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let storage = StorageManager::new(dir.clone());

        let now_local = Local.with_ymd_and_hms(2026, 11, 22, 23, 0, 0).unwrap();
        let past_iso = (now_local - ChronoDuration::minutes(5))
            .with_timezone(&Utc)
            .to_rfc3339();

        let mut data = AppData::default();
        data.settings.dnd_enabled = true;
        data.settings.dnd_start = "22:00".into();
        data.settings.dnd_end = "08:00".into();
        data.todos.push(TodoItem {
            id: "t1".into(),
            title: "提交周报".into(),
            notes: "附带进度".into(),
            note_images: vec![],
            completed: false,
            completed_at: None,
            priority: TodoPriority::High,
            due_date: Some("2026-11-22".into()),
            due_time: Some("22:55".into()),
            end_date: None,
            list_id: None,
            tags: vec![],
            subtasks: vec![],
            repeat_rule: None,
            reminder_rule: Some(ReminderRule {
                enabled: true,
                next_at: Some(past_iso),
                mode: ReminderMode::Standard,
                ..Default::default()
            }),
            quadrant_override: None,
            links: vec![],
            sort_order: 1.0,
            created_at: now_iso(),
            updated_at: now_iso(),
            deleted_at: None,
        });
        storage.save_app_data(data).unwrap();

        // At 23:00 during DND -> deferred (0 fired)
        let deferred = process_due_reminders_at(&storage, now_local);
        assert!(deferred.is_empty());
        assert!(storage.load_notifications().is_empty());

        // At 08:05 after DND -> fires and disables standard reminder
        let morning = Local.with_ymd_and_hms(2026, 11, 23, 8, 5, 0).unwrap();
        let fired = process_due_reminders_at(&storage, morning);
        assert_eq!(fired.len(), 1);
        assert!(fired[0].title.contains("提交周报"));
        let stored_data = storage.load_app_data();
        let rem = stored_data.todos[0].reminder_rule.as_ref().unwrap();
        assert!(!rem.enabled);
        assert_eq!(rem.triggered_count, 1);
        assert_eq!(storage.load_notifications().len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
