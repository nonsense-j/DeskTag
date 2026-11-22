//! Item-level 3-way merge engine for DeskTag (`AppData` todos, lists, notes, groups, settings)
//! with `updatedAt` resolution, `deletedAt` soft-delete tombstones, `SyncState` persistence,
//! ciphertext cache, rotating safety snapshots, and preview token generation.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::models::{
    AppData, ConflictNotice, NoteGroup, NoteItem, ServerFileWarning, SyncPreview, SyncPreviewItem,
    SyncedSettings, TodoItem, TodoList, WebDavConfig,
};
use crate::storage::{write_atomic, StorageManager};
use crate::webdav::client::{normalize_remote_dir, RemoteVersion};
use crate::webdav::crypto::sha256_hex;

pub const SYNC_STATE_FILE_NAME: &str = "sync-state.json";
pub const REMOTE_CACHE_FILE_NAME: &str = "sync-server.desktag-backup";
pub const SNAPSHOT_EXT: &str = ".desktag-backup";
pub const MAX_SNAPSHOTS_PER_TAG: usize = 5;

// ---------------------------------------------------------------------------
// Sync Entity Abstraction & Deterministic Hashing
// ---------------------------------------------------------------------------

trait SyncEntity: Clone + Serialize {
    fn entity_type() -> &'static str;
    fn id(&self) -> &str;
    fn display_title(&self) -> String;
    fn updated_at(&self) -> &str;
    fn deleted_at(&self) -> Option<&str>;
}

impl SyncEntity for TodoItem {
    fn entity_type() -> &'static str {
        "todo"
    }
    fn id(&self) -> &str {
        &self.id
    }
    fn display_title(&self) -> String {
        if self.title.trim().is_empty() {
            self.id.clone()
        } else {
            self.title.clone()
        }
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
    fn deleted_at(&self) -> Option<&str> {
        self.deleted_at.as_deref()
    }
}

impl SyncEntity for TodoList {
    fn entity_type() -> &'static str {
        "list"
    }
    fn id(&self) -> &str {
        &self.id
    }
    fn display_title(&self) -> String {
        if self.name.trim().is_empty() {
            self.id.clone()
        } else {
            self.name.clone()
        }
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
    fn deleted_at(&self) -> Option<&str> {
        self.deleted_at.as_deref()
    }
}

impl SyncEntity for NoteItem {
    fn entity_type() -> &'static str {
        "note"
    }
    fn id(&self) -> &str {
        &self.id
    }
    fn display_title(&self) -> String {
        if self.title.trim().is_empty() {
            self.id.clone()
        } else {
            self.title.clone()
        }
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
    fn deleted_at(&self) -> Option<&str> {
        self.deleted_at.as_deref()
    }
}

impl SyncEntity for NoteGroup {
    fn entity_type() -> &'static str {
        "note_group"
    }
    fn id(&self) -> &str {
        &self.id
    }
    fn display_title(&self) -> String {
        if self.name.trim().is_empty() {
            self.id.clone()
        } else {
            self.name.clone()
        }
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
    fn deleted_at(&self) -> Option<&str> {
        self.deleted_at.as_deref()
    }
}

fn entity_key(entity_type: &str, id: &str) -> String {
    format!("{entity_type}:{id}")
}

fn hash_serializable<T: Serialize>(value: &T) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    sha256_hex(&bytes)
}

/// Compute per-item deterministic SHA-256 hashes for `AppData` (`todo:<id>`, `list:<id>`, `note:<id>`, `note_group:<id>`, `settings`).
pub fn compute_item_hashes(data: &AppData) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for item in &data.todos {
        map.insert(entity_key("todo", &item.id), hash_serializable(item));
    }
    for item in &data.lists {
        map.insert(entity_key("list", &item.id), hash_serializable(item));
    }
    for item in &data.notes {
        map.insert(entity_key("note", &item.id), hash_serializable(item));
    }
    for item in &data.note_groups {
        map.insert(entity_key("note_group", &item.id), hash_serializable(item));
    }
    map.insert("settings".to_string(), hash_serializable(&data.settings));
    map
}

/// Deterministic content hash of `AppData` independent of top-level `AppData.updated_at` timestamp bumps.
pub fn compute_bundle_hash(data: &AppData) -> String {
    let hashes = compute_item_hashes(data);
    hash_serializable(&hashes)
}

/// Returns true if `AppData` has no user items (ignoring soft-deleted tombstones? No: zero items of any kind)
/// and default settings — used for Magpie's empty-first join guard (#5642).
pub fn is_app_data_empty(data: &AppData) -> bool {
    data.todos.is_empty()
        && data.lists.is_empty()
        && data.notes.is_empty()
        && data.note_groups.is_empty()
        && data.settings == SyncedSettings::default()
}

fn compare_timestamps(a: &str, b: &str) -> Ordering {
    match (
        DateTime::parse_from_rfc3339(a),
        DateTime::parse_from_rfc3339(b),
    ) {
        (Ok(ta), Ok(tb)) => ta.with_timezone(&Utc).cmp(&tb.with_timezone(&Utc)),
        _ => a.cmp(b),
    }
}

// ---------------------------------------------------------------------------
// 3-Way Item-Level Merge
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct MergeOutcome {
    pub merged: AppData,
    pub changed_local: bool,
    pub changed_remote: bool,
    pub to_upload_count: usize,
    pub to_download_count: usize,
    pub conflict_count: usize,
    pub local_displaced: bool,
    pub remote_displaced: bool,
    pub items: Vec<SyncPreviewItem>,
}

/// Standard 3-way merge when an explicit `base` `AppData` snapshot is available.
pub fn merge_app_data(
    local: &AppData,
    remote: &AppData,
    base: Option<&AppData>,
) -> MergeOutcome {
    let prev = base.map(compute_item_hashes);
    merge_app_data_with_hashes(local, remote, prev.as_ref(), false)
}

/// Full item-level 3-way merge using persisted `prev_hashes` from `sync-state.json`.
pub fn merge_app_data_with_hashes(
    local: &AppData,
    remote: &AppData,
    prev_hashes: Option<&BTreeMap<String, String>>,
    follow_server: bool,
) -> MergeOutcome {
    let mut changed_local = false;
    let mut changed_remote = false;
    let mut to_upload_count = 0usize;
    let mut to_download_count = 0usize;
    let mut conflict_count = 0usize;
    let mut local_displaced = false;
    let mut remote_displaced = false;
    let mut items = Vec::new();

    let todos = merge_collection(
        &local.todos,
        &remote.todos,
        prev_hashes,
        follow_server,
        &mut changed_local,
        &mut changed_remote,
        &mut to_upload_count,
        &mut to_download_count,
        &mut conflict_count,
        &mut local_displaced,
        &mut remote_displaced,
        &mut items,
    );
    let lists = merge_collection(
        &local.lists,
        &remote.lists,
        prev_hashes,
        follow_server,
        &mut changed_local,
        &mut changed_remote,
        &mut to_upload_count,
        &mut to_download_count,
        &mut conflict_count,
        &mut local_displaced,
        &mut remote_displaced,
        &mut items,
    );
    let notes = merge_collection(
        &local.notes,
        &remote.notes,
        prev_hashes,
        follow_server,
        &mut changed_local,
        &mut changed_remote,
        &mut to_upload_count,
        &mut to_download_count,
        &mut conflict_count,
        &mut local_displaced,
        &mut remote_displaced,
        &mut items,
    );
    let note_groups = merge_collection(
        &local.note_groups,
        &remote.note_groups,
        prev_hashes,
        follow_server,
        &mut changed_local,
        &mut changed_remote,
        &mut to_upload_count,
        &mut to_download_count,
        &mut conflict_count,
        &mut local_displaced,
        &mut remote_displaced,
        &mut items,
    );

    let settings = merge_settings(
        local,
        remote,
        prev_hashes,
        follow_server,
        &mut changed_local,
        &mut changed_remote,
        &mut to_upload_count,
        &mut to_download_count,
        &mut conflict_count,
        &mut local_displaced,
        &mut remote_displaced,
        &mut items,
    );

    let updated_at = match compare_timestamps(&local.updated_at, &remote.updated_at) {
        Ordering::Greater => local.updated_at.clone(),
        _ => remote.updated_at.clone(),
    };

    let merged = AppData {
        schema_version: local.schema_version.max(remote.schema_version),
        todos,
        lists,
        notes,
        note_groups,
        settings,
        updated_at,
    };

    MergeOutcome {
        merged,
        changed_local,
        changed_remote,
        to_upload_count,
        to_download_count,
        conflict_count,
        local_displaced,
        remote_displaced,
        items,
    }
}

#[allow(clippy::too_many_arguments)]
fn merge_collection<T: SyncEntity>(
    local_items: &[T],
    remote_items: &[T],
    prev_hashes: Option<&BTreeMap<String, String>>,
    follow_server: bool,
    changed_local: &mut bool,
    changed_remote: &mut bool,
    to_upload_count: &mut usize,
    to_download_count: &mut usize,
    conflict_count: &mut usize,
    local_displaced: &mut bool,
    remote_displaced: &mut bool,
    preview_items: &mut Vec<SyncPreviewItem>,
) -> Vec<T> {
    let kind = T::entity_type();
    let local_map: HashMap<&str, &T> = local_items.iter().map(|i| (i.id(), i)).collect();
    let remote_map: HashMap<&str, &T> = remote_items.iter().map(|i| (i.id(), i)).collect();

    // Deterministic union order: local order first, then remote-only items in remote order.
    let mut ordered_ids: Vec<&str> = Vec::with_capacity(local_items.len() + remote_items.len());
    let mut seen: HashSet<&str> = HashSet::new();
    for item in local_items {
        if seen.insert(item.id()) {
            ordered_ids.push(item.id());
        }
    }
    for item in remote_items {
        if seen.insert(item.id()) {
            ordered_ids.push(item.id());
        }
    }

    let mut result = Vec::with_capacity(ordered_ids.len());

    for id in ordered_ids {
        let local_opt = local_map.get(id).copied();
        let remote_opt = remote_map.get(id).copied();
        let key = entity_key(kind, id);
        let prev_hash = prev_hashes.and_then(|m| m.get(&key)).map(String::as_str);

        if follow_server {
            match (local_opt, remote_opt) {
                (_, Some(r)) => {
                    let same = local_opt
                        .map(|l| hash_serializable(l) == hash_serializable(r))
                        .unwrap_or(false);
                    if !same {
                        *changed_local = true;
                        *to_download_count += 1;
                        let action = if r.deleted_at().is_some() {
                            "delete"
                        } else {
                            "download"
                        };
                        preview_items.push(SyncPreviewItem {
                            entity_type: kind.to_string(),
                            entity_id: id.to_string(),
                            title: r.display_title(),
                            action: action.to_string(),
                        });
                    }
                    result.push(r.clone());
                }
                (Some(l), None) => {
                    *changed_local = true;
                    *to_download_count += 1;
                    preview_items.push(SyncPreviewItem {
                        entity_type: kind.to_string(),
                        entity_id: id.to_string(),
                        title: l.display_title(),
                        action: "delete".to_string(),
                    });
                }
                (None, None) => {}
            }
            continue;
        }

        match (local_opt, remote_opt) {
            (Some(l), Some(r)) => {
                let lh = hash_serializable(l);
                let rh = hash_serializable(r);
                if lh == rh {
                    result.push(l.clone());
                    continue;
                }

                let (local_changed, remote_changed) = match prev_hash {
                    Some(ph) => (lh != ph, rh != ph),
                    None => (true, true),
                };

                match (local_changed, remote_changed) {
                    (true, false) => {
                        result.push(l.clone());
                        *changed_remote = true;
                        *to_upload_count += 1;
                        let action = if l.deleted_at().is_some() {
                            "delete"
                        } else {
                            "upload"
                        };
                        preview_items.push(SyncPreviewItem {
                            entity_type: kind.to_string(),
                            entity_id: id.to_string(),
                            title: l.display_title(),
                            action: action.to_string(),
                        });
                    }
                    (false, true) => {
                        result.push(r.clone());
                        *changed_local = true;
                        *to_download_count += 1;
                        let action = if r.deleted_at().is_some() {
                            "delete"
                        } else {
                            "download"
                        };
                        preview_items.push(SyncPreviewItem {
                            entity_type: kind.to_string(),
                            entity_id: id.to_string(),
                            title: r.display_title(),
                            action: action.to_string(),
                        });
                    }
                    _ => {
                        // Conflict: both sides modified (or diverged on first join with same UUID)
                        *conflict_count += 1;
                        match compare_timestamps(l.updated_at(), r.updated_at()) {
                            Ordering::Greater => {
                                result.push(l.clone());
                                *changed_remote = true;
                                *remote_displaced = true;
                                preview_items.push(SyncPreviewItem {
                                    entity_type: kind.to_string(),
                                    entity_id: id.to_string(),
                                    title: l.display_title(),
                                    action: "conflict".to_string(),
                                });
                            }
                            _ => {
                                result.push(r.clone());
                                *changed_local = true;
                                *local_displaced = true;
                                preview_items.push(SyncPreviewItem {
                                    entity_type: kind.to_string(),
                                    entity_id: id.to_string(),
                                    title: r.display_title(),
                                    action: "conflict".to_string(),
                                });
                            }
                        }
                    }
                }
            }
            (Some(l), None) => {
                if let Some(ph) = prev_hash {
                    // Existed previously; physically absent on remote now
                    if hash_serializable(l) == ph {
                        // Local unchanged -> propagate deletion cleanly
                        *changed_local = true;
                        *to_download_count += 1;
                        preview_items.push(SyncPreviewItem {
                            entity_type: kind.to_string(),
                            entity_id: id.to_string(),
                            title: l.display_title(),
                            action: "delete".to_string(),
                        });
                    } else {
                        // Local modified after sync -> preserve newer edit over physical deletion
                        result.push(l.clone());
                        *changed_remote = true;
                        *conflict_count += 1;
                        *remote_displaced = true;
                        preview_items.push(SyncPreviewItem {
                            entity_type: kind.to_string(),
                            entity_id: id.to_string(),
                            title: l.display_title(),
                            action: "conflict".to_string(),
                        });
                    }
                } else {
                    // Newly created locally (or first join with empty remote: empty-first guard!)
                    result.push(l.clone());
                    *changed_remote = true;
                    *to_upload_count += 1;
                    let action = if l.deleted_at().is_some() {
                        "delete"
                    } else {
                        "upload"
                    };
                    preview_items.push(SyncPreviewItem {
                        entity_type: kind.to_string(),
                        entity_id: id.to_string(),
                        title: l.display_title(),
                        action: action.to_string(),
                    });
                }
            }
            (None, Some(r)) => {
                if let Some(ph) = prev_hash {
                    // Existed previously; physically removed locally
                    if hash_serializable(r) == ph {
                        // Remote unchanged -> propagate local physical deletion to remote
                        *changed_remote = true;
                        *to_upload_count += 1;
                        preview_items.push(SyncPreviewItem {
                            entity_type: kind.to_string(),
                            entity_id: id.to_string(),
                            title: r.display_title(),
                            action: "delete".to_string(),
                        });
                    } else {
                        // Remote edited after sync -> preserve newer remote edit
                        result.push(r.clone());
                        *changed_local = true;
                        *conflict_count += 1;
                        *local_displaced = true;
                        preview_items.push(SyncPreviewItem {
                            entity_type: kind.to_string(),
                            entity_id: id.to_string(),
                            title: r.display_title(),
                            action: "conflict".to_string(),
                        });
                    }
                } else {
                    // Newly created on remote (or first join pulling remote items)
                    result.push(r.clone());
                    *changed_local = true;
                    *to_download_count += 1;
                    let action = if r.deleted_at().is_some() {
                        "delete"
                    } else {
                        "download"
                    };
                    preview_items.push(SyncPreviewItem {
                        entity_type: kind.to_string(),
                        entity_id: id.to_string(),
                        title: r.display_title(),
                        action: action.to_string(),
                    });
                }
            }
            (None, None) => {}
        }
    }

    result
}

#[allow(clippy::too_many_arguments)]
fn merge_settings(
    local: &AppData,
    remote: &AppData,
    prev_hashes: Option<&BTreeMap<String, String>>,
    follow_server: bool,
    changed_local: &mut bool,
    changed_remote: &mut bool,
    to_upload_count: &mut usize,
    to_download_count: &mut usize,
    conflict_count: &mut usize,
    local_displaced: &mut bool,
    remote_displaced: &mut bool,
    preview_items: &mut Vec<SyncPreviewItem>,
) -> SyncedSettings {
    let lh = hash_serializable(&local.settings);
    let rh = hash_serializable(&remote.settings);
    if lh == rh {
        return local.settings.clone();
    }

    if follow_server {
        *changed_local = true;
        *to_download_count += 1;
        preview_items.push(SyncPreviewItem {
            entity_type: "settings".to_string(),
            entity_id: "settings".to_string(),
            title: "Synced Settings".to_string(),
            action: "download".to_string(),
        });
        return remote.settings.clone();
    }

    let default_hash = hash_serializable(&SyncedSettings::default());
    let prev_hash = prev_hashes.and_then(|m| m.get("settings")).map(String::as_str);

    match prev_hash {
        None => {
            // First join: apply empty-first guard so an empty/default server never overwrites custom local settings
            if is_app_data_empty(remote) && rh == default_hash && lh != default_hash {
                *changed_remote = true;
                *to_upload_count += 1;
                preview_items.push(SyncPreviewItem {
                    entity_type: "settings".to_string(),
                    entity_id: "settings".to_string(),
                    title: "Synced Settings".to_string(),
                    action: "upload".to_string(),
                });
                local.settings.clone()
            } else if is_app_data_empty(local) && lh == default_hash {
                *changed_local = true;
                *to_download_count += 1;
                preview_items.push(SyncPreviewItem {
                    entity_type: "settings".to_string(),
                    entity_id: "settings".to_string(),
                    title: "Synced Settings".to_string(),
                    action: "download".to_string(),
                });
                remote.settings.clone()
            } else {
                // Both customized on first join -> newer AppData.updated_at wins
                *conflict_count += 1;
                match compare_timestamps(&local.updated_at, &remote.updated_at) {
                    Ordering::Greater => {
                        *changed_remote = true;
                        *remote_displaced = true;
                        preview_items.push(SyncPreviewItem {
                            entity_type: "settings".to_string(),
                            entity_id: "settings".to_string(),
                            title: "Synced Settings".to_string(),
                            action: "conflict".to_string(),
                        });
                        local.settings.clone()
                    }
                    _ => {
                        *changed_local = true;
                        *local_displaced = true;
                        preview_items.push(SyncPreviewItem {
                            entity_type: "settings".to_string(),
                            entity_id: "settings".to_string(),
                            title: "Synced Settings".to_string(),
                            action: "conflict".to_string(),
                        });
                        remote.settings.clone()
                    }
                }
            }
        }
        Some(ph) => {
            let lc = lh != ph;
            let rc = rh != ph;
            match (lc, rc) {
                (true, false) => {
                    *changed_remote = true;
                    *to_upload_count += 1;
                    preview_items.push(SyncPreviewItem {
                        entity_type: "settings".to_string(),
                        entity_id: "settings".to_string(),
                        title: "Synced Settings".to_string(),
                        action: "upload".to_string(),
                    });
                    local.settings.clone()
                }
                (false, true) => {
                    *changed_local = true;
                    *to_download_count += 1;
                    preview_items.push(SyncPreviewItem {
                        entity_type: "settings".to_string(),
                        entity_id: "settings".to_string(),
                        title: "Synced Settings".to_string(),
                        action: "download".to_string(),
                    });
                    remote.settings.clone()
                }
                _ => {
                    *conflict_count += 1;
                    match compare_timestamps(&local.updated_at, &remote.updated_at) {
                        Ordering::Greater => {
                            *changed_remote = true;
                            *remote_displaced = true;
                            preview_items.push(SyncPreviewItem {
                                entity_type: "settings".to_string(),
                                entity_id: "settings".to_string(),
                                title: "Synced Settings".to_string(),
                                action: "conflict".to_string(),
                            });
                            local.settings.clone()
                        }
                        _ => {
                            *changed_local = true;
                            *local_displaced = true;
                            preview_items.push(SyncPreviewItem {
                                entity_type: "settings".to_string(),
                                entity_id: "settings".to_string(),
                                title: "Synced Settings".to_string(),
                                action: "conflict".to_string(),
                            });
                            remote.settings.clone()
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// SyncPreview Construction & Deterministic 16-Hex-Char Token
// ---------------------------------------------------------------------------

pub fn build_sync_preview(
    outcome: &MergeOutcome,
    local_bundle_hash: &str,
    remote_sum: &str,
    remote_etag: Option<&str>,
    remote_absent: bool,
    follow_server: bool,
) -> SyncPreview {
    let direction = if outcome.conflict_count > 0 {
        "conflict"
    } else if outcome.to_upload_count > 0 && outcome.to_download_count > 0 {
        "bidirectional"
    } else if outcome.to_upload_count > 0 || (remote_absent && !follow_server) {
        "upload"
    } else if outcome.to_download_count > 0 {
        "download"
    } else {
        "up_to_date"
    };

    let summary = if remote_absent && !follow_server {
        if outcome.to_upload_count == 0 {
            "Remote server has no backup yet — will initialize backup".to_string()
        } else {
            format!(
                "Initialize server backup with {} item(s)",
                outcome.to_upload_count
            )
        }
    } else if outcome.items.is_empty() {
        "Already up to date".to_string()
    } else {
        let mut parts = Vec::new();
        if outcome.to_upload_count > 0 {
            parts.push(format!("{} to upload", outcome.to_upload_count));
        }
        if outcome.to_download_count > 0 {
            parts.push(format!("{} to download", outcome.to_download_count));
        }
        if outcome.conflict_count > 0 {
            parts.push(format!("{} conflict(s)", outcome.conflict_count));
        }
        parts.join(", ")
    };

    let fingerprint = serde_json::json!({
        "localHash": local_bundle_hash,
        "remoteSum": remote_sum,
        "remoteEtag": remote_etag.unwrap_or(""),
        "remoteAbsent": remote_absent,
        "followServer": follow_server,
        "direction": direction,
        "items": &outcome.items,
    });
    let full_hash = sha256_hex(&serde_json::to_vec(&fingerprint).unwrap_or_default());
    let token = full_hash[..16].to_string();

    SyncPreview {
        token,
        direction: direction.to_string(),
        to_upload_count: outcome.to_upload_count,
        to_download_count: outcome.to_download_count,
        conflict_count: outcome.conflict_count,
        items: outcome.items.clone(),
        summary,
    }
}

/// Build an upload preview when no remote backup exists yet.
pub fn build_initial_upload_preview(
    local: &AppData,
    local_bundle_hash: &str,
    follow_server: bool,
) -> SyncPreview {
    let mut items = Vec::new();
    if !follow_server {
        for t in &local.todos {
            items.push(SyncPreviewItem {
                entity_type: "todo".to_string(),
                entity_id: t.id.clone(),
                title: t.display_title(),
                action: "upload".to_string(),
            });
        }
        for l in &local.lists {
            items.push(SyncPreviewItem {
                entity_type: "list".to_string(),
                entity_id: l.id.clone(),
                title: l.display_title(),
                action: "upload".to_string(),
            });
        }
        for n in &local.notes {
            items.push(SyncPreviewItem {
                entity_type: "note".to_string(),
                entity_id: n.id.clone(),
                title: n.display_title(),
                action: "upload".to_string(),
            });
        }
        for g in &local.note_groups {
            items.push(SyncPreviewItem {
                entity_type: "note_group".to_string(),
                entity_id: g.id.clone(),
                title: g.display_title(),
                action: "upload".to_string(),
            });
        }
        if local.settings != SyncedSettings::default() {
            items.push(SyncPreviewItem {
                entity_type: "settings".to_string(),
                entity_id: "settings".to_string(),
                title: "Synced Settings".to_string(),
                action: "upload".to_string(),
            });
        }
    }

    let to_upload_count = items.len();
    let outcome = MergeOutcome {
        merged: local.clone(),
        changed_local: false,
        changed_remote: !follow_server,
        to_upload_count,
        to_download_count: 0,
        conflict_count: 0,
        local_displaced: false,
        remote_displaced: false,
        items,
    };
    build_sync_preview(&outcome, local_bundle_hash, "", None, true, follow_server)
}

// ---------------------------------------------------------------------------
// SyncState Persistence, Ciphertext Cache, Rotating Snapshots & Rebuild Guard
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedSync {
    pub at: String,
    pub snapshot_path: String,
    #[serde(default)]
    pub after_hashes: BTreeMap<String, String>,
    #[serde(default)]
    pub after_bundle_hash: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub last_sync_at: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub server_file_warning: Option<ServerFileWarning>,
    #[serde(default)]
    pub conflict_notice: Option<ConflictNotice>,
    #[serde(default)]
    pub remote_sum: String,
    #[serde(default)]
    pub server: RemoteVersion,
    #[serde(default)]
    pub prev_hashes: Option<BTreeMap<String, String>>,
    #[serde(default)]
    pub local_bundle_hash: String,
    #[serde(default)]
    pub applied: Option<AppliedSync>,
    #[serde(default)]
    pub restore_undo_file: Option<String>,
}

impl SyncState {
    pub fn has_undo(&self) -> bool {
        if let Some(ref a) = self.applied {
            if Path::new(&a.snapshot_path).is_file() {
                return true;
            }
        }
        if let Some(ref p) = self.restore_undo_file {
            if Path::new(p).is_file() {
                return true;
            }
        }
        false
    }
}

/// Unique state key: `sha256(url\0remote_dir\0user\0passphrase)`.
pub fn state_key(cfg: &WebDavConfig) -> String {
    let raw = format!(
        "{}\0{}\0{}\0{}",
        cfg.url.trim().trim_end_matches('/'),
        normalize_remote_dir(&cfg.remote_dir),
        cfg.username.trim(),
        cfg.passphrase
    );
    sha256_hex(raw.as_bytes())
}

pub fn sync_state_path(storage: &StorageManager) -> PathBuf {
    storage.active_dir().join(SYNC_STATE_FILE_NAME)
}

pub fn remote_cache_path(storage: &StorageManager) -> PathBuf {
    storage.active_dir().join(REMOTE_CACHE_FILE_NAME)
}

pub fn load_sync_state(storage: &StorageManager) -> SyncState {
    let path = sync_state_path(storage);
    let Ok(raw) = fs::read(&path) else {
        return SyncState::default();
    };
    match serde_json::from_slice::<SyncState>(&raw) {
        Ok(st) => st,
        Err(_) => {
            // Preserve unparsed corrupt state file before resetting (Magpie KeepUnparsed pattern)
            let backup_dir = storage.sync_backup_dir();
            let _ = fs::create_dir_all(&backup_dir);
            let ts = Utc::now().format("%Y-%m-%d-%H%M%S");
            let corrupt_copy = backup_dir.join(format!("{ts}-sync-state-corrupt.json"));
            let _ = write_atomic(&corrupt_copy, &raw);
            SyncState::default()
        }
    }
}

pub fn save_sync_state(storage: &StorageManager, state: &SyncState) -> Result<(), String> {
    let path = sync_state_path(storage);
    let bytes = serde_json::to_vec_pretty(state)
        .map_err(|e| format!("failed to serialize sync state: {e}"))?;
    write_atomic(&path, &bytes)?;
    restrict_file_permissions(&path);
    Ok(())
}

pub fn save_cached_remote(storage: &StorageManager, bytes: &[u8]) -> Result<(), String> {
    let path = remote_cache_path(storage);
    write_atomic(&path, bytes)?;
    restrict_file_permissions(&path);
    Ok(())
}

pub fn load_cached_remote(storage: &StorageManager, expected_sum: &str) -> Option<Vec<u8>> {
    if expected_sum.is_empty() {
        return None;
    }
    let path = remote_cache_path(storage);
    let bytes = fs::read(&path).ok()?;
    if sha256_hex(&bytes) == expected_sum {
        Some(bytes)
    } else {
        None
    }
}

/// Save a safety snapshot to `storage.sync_backup_dir()` named `YYYY-MM-DD-HHMMSS-<tag>.desktag-backup`
/// and rotate to keep only the newest 5 snapshots per tag.
pub fn save_rotating_snapshot(
    storage: &StorageManager,
    tag: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let dir = storage.sync_backup_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create sync backup dir: {e}"))?;
    restrict_dir_permissions(&dir);

    let now = Utc::now();
    let base_name = format!("{}-{tag}{SNAPSHOT_EXT}", now.format("%Y-%m-%d-%H%M%S"));
    let mut path = dir.join(&base_name);
    if path.exists() {
        let with_ms = format!(
            "{}-{tag}{SNAPSHOT_EXT}",
            now.format("%Y-%m-%d-%H%M%S-%3f")
        );
        path = dir.join(with_ms);
        let mut seq = 1u32;
        while path.exists() {
            path = dir.join(format!(
                "{}-{seq:02}-{tag}{SNAPSHOT_EXT}",
                now.format("%Y-%m-%d-%H%M%S-%3f")
            ));
            seq += 1;
        }
    }

    write_atomic(&path, bytes)?;
    restrict_file_permissions(&path);
    rotate_snapshots(&dir, tag, MAX_SNAPSHOTS_PER_TAG);
    Ok(path)
}

fn rotate_snapshots(dir: &Path, tag: &str, keep: usize) {
    let suffix = format!("-{tag}{SNAPSHOT_EXT}");
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut matching: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.ends_with(&suffix))
                .unwrap_or(false)
        })
        .collect();
    matching.sort();
    while matching.len() > keep {
        let oldest = matching.remove(0);
        let _ = fs::remove_file(oldest);
    }
}

/// Returns true ONLY when `corrupt_remote` is a strict prefix of `cached_good` truncated PAST `"data"`,
/// guaranteeing an out-of-date computer can never match just the constant envelope header and overwrite newer data.
pub fn can_auto_rebuild_corrupt(corrupt_remote: &[u8], cached_good: &[u8]) -> bool {
    if corrupt_remote.is_empty() || corrupt_remote.len() >= cached_good.len() {
        return false;
    }
    if !cached_good.starts_with(corrupt_remote) {
        return false;
    }
    let needle = b"\"data\"";
    let Some(data_pos) = find_subslice(cached_good, needle) else {
        return false;
    };
    corrupt_remote.len() > data_pos + needle.len()
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[cfg(unix)]
fn restrict_file_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_file_permissions(_path: &Path) {}

#[cfg(unix)]
fn restrict_dir_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
}

#[cfg(not(unix))]
fn restrict_dir_permissions(_path: &Path) {}
