//! E2EE AES-256-GCM + PBKDF2-SHA256 backup envelope (Magpie-compatible security design).

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const ENVELOPE_FORMAT: &str = "desktag-backup";
pub const ENVELOPE_VERSION: u32 = 1;
pub const DEFAULT_KDF: &str = "pbkdf2-sha256";
pub const DEFAULT_ITERATIONS: u32 = 600_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedEnvelope {
    pub format: String,
    pub version: u32,
    pub kdf: String,
    pub iterations: u32,
    pub salt: String,
    pub nonce: String,
    pub data: String,
}

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("not a DeskTag encrypted backup")]
    NotBackup,
    #[error("corrupt or truncated backup envelope")]
    Corrupt,
    #[error("backup was created by a newer version of DeskTag")]
    NewerVersion,
    #[error("incorrect encryption passphrase")]
    WrongPassphrase,
    #[error("crypto error: {0}")]
    Internal(String),
}
