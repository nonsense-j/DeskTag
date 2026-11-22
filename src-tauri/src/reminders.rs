use std::sync::Arc;

use crate::models::NotificationItem;
use crate::storage::StorageManager;

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
}
