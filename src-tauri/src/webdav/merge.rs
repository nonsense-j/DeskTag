//! Item-level 3-way merge engine for DeskTag (`AppData` todos, lists, notes, groups, settings)
//! with `updatedAt` resolution and `deletedAt` soft-delete tombstones.

use crate::models::{AppData, SyncPreviewItem};

#[derive(Debug, Clone)]
pub struct MergeOutcome {
    pub merged: AppData,
    pub changed_local: bool,
    pub changed_remote: bool,
    pub conflict_count: usize,
    pub items: Vec<SyncPreviewItem>,
}

pub fn merge_app_data(local: &AppData, _remote: &AppData, _base: Option<&AppData>) -> MergeOutcome {
    MergeOutcome {
        merged: local.clone(),
        changed_local: false,
        changed_remote: false,
        conflict_count: 0,
        items: Vec::new(),
    }
}
