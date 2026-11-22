//! E2EE AES-256-GCM + PBKDF2-SHA256 backup envelope (Magpie-compatible security design).

use std::collections::HashMap;
use std::sync::{Mutex as StdMutex, OnceLock};

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::models::AppData;

pub const ENVELOPE_FORMAT: &str = "desktag-backup";
pub const PLAIN_ENVELOPE_FORMAT: &str = "desktag-plain";
pub const DATA_ENVELOPE_FORMAT: &str = "desktag-data";
pub const ENVELOPE_VERSION: u32 = 1;
pub const DEFAULT_KDF: &str = "pbkdf2-sha256";
pub const DEFAULT_ITERATIONS: u32 = 600_000;
pub const MIN_ITERATIONS: u32 = 100_000;
pub const MAX_ITERATIONS: u32 = 10_000_000;
pub const SETUP_PREFIX: &str = "desktag-sync:";

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainEnvelope {
    pub format: String,
    pub version: u32,
    pub data: AppData,
}

/// One-paste setup payload sealed inside `desktag-sync:<b64url>`.
/// NEVER carries the encryption passphrase.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupPayload {
    pub url: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default = "default_remote_dir")]
    pub remote_dir: String,
}

fn default_remote_dir() -> String {
    "desktag".to_string()
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

static KEY_CACHE: OnceLock<StdMutex<HashMap<[u8; 32], [u8; KEY_LEN]>>> = OnceLock::new();
static SALT_CACHE: OnceLock<StdMutex<HashMap<[u8; 32], Vec<u8>>>> = OnceLock::new();

fn key_cache() -> &'static StdMutex<HashMap<[u8; 32], [u8; KEY_LEN]>> {
    KEY_CACHE.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn salt_cache() -> &'static StdMutex<HashMap<[u8; 32], Vec<u8>>> {
    SALT_CACHE.get_or_init(|| StdMutex::new(HashMap::new()))
}

/// Strip leading UTF-8 BOM (`\xef\xbb\xbf`) if present.
pub fn strip_utf8_bom(data: &[u8]) -> &[u8] {
    data.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(data)
}

/// Compute lowercase hex SHA-256 digest of bytes.
pub fn sha256_hex(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    hex::encode(digest)
}

/// Returns whether `data` starts like a DeskTag backup envelope (ignoring whitespace/BOM).
pub fn is_backup_json(data: &[u8]) -> bool {
    let clean = strip_utf8_bom(data);
    let head = compact_head(clean, 96);
    head.starts_with(r#"{"format":"desktag-backup""#)
        || head.starts_with(r#"{"format":"desktag-plain""#)
}

/// Returns whether `data` begins like a DeskTag backup (including a very short truncated prefix).
pub fn is_backup_head(data: &[u8]) -> bool {
    let clean = strip_utf8_bom(data);
    let head = compact_head(clean, 64);
    if head.is_empty() {
        return false;
    }
    const WANT_ENC: &str = r#"{"format":"desktag-backup""#;
    const WANT_PLAIN: &str = r#"{"format":"desktag-plain""#;
    head.starts_with(WANT_ENC)
        || WANT_ENC.starts_with(&head)
        || head.starts_with(WANT_PLAIN)
        || WANT_PLAIN.starts_with(&head)
}

fn compact_head(data: &[u8], max_bytes: usize) -> String {
    let slice = &data[..data.len().min(max_bytes)];
    String::from_utf8_lossy(slice)
        .chars()
        .filter(|c| !matches!(c, ' ' | '\t' | '\n' | '\r'))
        .collect()
}

/// Build AAD binding all envelope header fields against tampering or KDF downgrade.
pub fn build_aad(format: &str, version: u32, kdf: &str, iterations: u32, salt: &[u8]) -> Vec<u8> {
    format!("{format}/{version}/{kdf}/{iterations}/{}", hex::encode(salt)).into_bytes()
}

/// Reuse one 16-byte random salt per passphrase per process (fresh 12-byte nonce on every seal).
fn salt_for_passphrase(passphrase: &str) -> Vec<u8> {
    let pass_hash: [u8; 32] = Sha256::digest(passphrase.as_bytes()).into();
    let cache = salt_cache();
    let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(salt) = guard.get(&pass_hash) {
        return salt.clone();
    }
    let mut salt = vec![0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    guard.insert(pass_hash, salt.clone());
    salt
}

/// Derive a 32-byte AES-256 key via PBKDF2-HMAC-SHA256 with in-memory caching.
pub fn derive_key_cached(passphrase: &str, salt: &[u8], iterations: u32) -> [u8; KEY_LEN] {
    let mut hasher = Sha256::new();
    hasher.update(passphrase.as_bytes());
    hasher.update([0u8]);
    hasher.update(iterations.to_string().as_bytes());
    hasher.update([0u8]);
    hasher.update(hex::encode(salt).as_bytes());
    let cache_key: [u8; 32] = hasher.finalize().into();

    if let Ok(guard) = key_cache().lock() {
        if let Some(key) = guard.get(&cache_key) {
            return *key;
        }
    }

    let mut derived = [0u8; KEY_LEN];
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, iterations, &mut derived);

    let mut guard = key_cache().lock().unwrap_or_else(|e| e.into_inner());
    guard.insert(cache_key, derived);
    derived
}

/// Seal arbitrary plaintext bytes into an encrypted envelope with the specified format & iterations.
fn seal_envelope_raw(
    format: &str,
    plaintext: &[u8],
    passphrase: &str,
    iterations: u32,
    pretty: bool,
) -> Result<Vec<u8>, CryptoError> {
    if passphrase.is_empty() {
        return Err(CryptoError::Internal(
            "sealing requires a non-empty passphrase".to_string(),
        ));
    }
    if !(MIN_ITERATIONS..=MAX_ITERATIONS).contains(&iterations) {
        return Err(CryptoError::Internal(format!(
            "iterations {iterations} out of bounds [{MIN_ITERATIONS}, {MAX_ITERATIONS}]"
        )));
    }

    let salt = salt_for_passphrase(passphrase);
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);

    let key = derive_key_cached(passphrase, &salt, iterations);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| CryptoError::Internal(format!("cipher init failed: {e}")))?;
    let aad = build_aad(format, ENVELOPE_VERSION, DEFAULT_KDF, iterations, &salt);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|e| CryptoError::Internal(format!("encryption failed: {e}")))?;

    let b64 = base64::engine::general_purpose::STANDARD;
    let envelope = EncryptedEnvelope {
        format: format.to_string(),
        version: ENVELOPE_VERSION,
        kdf: DEFAULT_KDF.to_string(),
        iterations,
        salt: b64.encode(&salt),
        nonce: b64.encode(nonce_bytes),
        data: b64.encode(&ciphertext),
    };

    if pretty {
        serde_json::to_vec_pretty(&envelope)
    } else {
        serde_json::to_vec(&envelope)
    }
    .map_err(|e| CryptoError::Internal(format!("serialize envelope failed: {e}")))
}

/// Open an encrypted envelope for `expected_format` and return decrypted plaintext bytes.
fn open_envelope_raw(
    raw: &[u8],
    expected_format: &str,
    passphrase: &str,
) -> Result<Vec<u8>, CryptoError> {
    let clean = strip_utf8_bom(raw);
    let val: serde_json::Value = match serde_json::from_slice(clean) {
        Ok(v) => v,
        Err(_) => {
            if expected_format == ENVELOPE_FORMAT && is_backup_json(clean) {
                return Err(CryptoError::Corrupt);
            }
            return Err(CryptoError::NotBackup);
        }
    };

    let format = match val.get("format").and_then(|v| v.as_str()) {
        Some(f) => f,
        None => return Err(CryptoError::NotBackup),
    };
    if format != expected_format {
        return Err(CryptoError::NotBackup);
    }

    // Check version/KDF before full structural deserialization so newer formats are clearly flagged.
    let version_ok = val
        .get("version")
        .and_then(|v| v.as_u64())
        .map(|v| v == ENVELOPE_VERSION as u64)
        .unwrap_or(false);
    let kdf_ok = val
        .get("kdf")
        .and_then(|v| v.as_str())
        .map(|k| k == DEFAULT_KDF)
        .unwrap_or(false);
    if !version_ok || !kdf_ok {
        return Err(CryptoError::NewerVersion);
    }

    let env: EncryptedEnvelope = serde_json::from_value(val).map_err(|_| CryptoError::Corrupt)?;
    if !(MIN_ITERATIONS..=MAX_ITERATIONS).contains(&env.iterations) {
        return Err(CryptoError::Corrupt);
    }

    let b64 = base64::engine::general_purpose::STANDARD;
    let salt = b64.decode(env.salt.trim()).map_err(|_| CryptoError::Corrupt)?;
    let nonce_bytes = b64
        .decode(env.nonce.trim())
        .map_err(|_| CryptoError::Corrupt)?;
    let ciphertext = b64.decode(env.data.trim()).map_err(|_| CryptoError::Corrupt)?;

    if salt.len() < SALT_LEN || nonce_bytes.len() != NONCE_LEN || ciphertext.is_empty() {
        return Err(CryptoError::Corrupt);
    }

    if passphrase.is_empty() {
        return Err(CryptoError::WrongPassphrase);
    }

    let key = derive_key_cached(passphrase, &salt, env.iterations);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| CryptoError::Internal(format!("cipher init failed: {e}")))?;
    let aad = build_aad(&env.format, env.version, &env.kdf, env.iterations, &salt);
    let nonce = Nonce::from_slice(&nonce_bytes);

    cipher
        .decrypt(
            nonce,
            Payload {
                msg: &ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| CryptoError::WrongPassphrase)
}

/// Seal `AppData` into a DeskTag backup envelope:
/// - When `passphrase` is non-empty: AES-256-GCM + PBKDF2-SHA256 `desktag-backup` envelope.
/// - When `passphrase` is empty: unencrypted `desktag-plain` JSON envelope.
pub fn seal_app_data(data: &AppData, passphrase: &str) -> Result<Vec<u8>, CryptoError> {
    if passphrase.is_empty() {
        let plain = PlainEnvelope {
            format: PLAIN_ENVELOPE_FORMAT.to_string(),
            version: ENVELOPE_VERSION,
            data: data.clone(),
        };
        return serde_json::to_vec_pretty(&plain)
            .map_err(|e| CryptoError::Internal(format!("serialize plain envelope failed: {e}")));
    }
    let plaintext = serde_json::to_vec(data)
        .map_err(|e| CryptoError::Internal(format!("serialize app data failed: {e}")))?;
    seal_envelope_raw(
        ENVELOPE_FORMAT,
        &plaintext,
        passphrase,
        DEFAULT_ITERATIONS,
        true,
    )
}

/// Seal raw plaintext bytes as a `desktag-backup` encrypted envelope.
pub fn seal_backup_bytes(plaintext: &[u8], passphrase: &str) -> Result<Vec<u8>, CryptoError> {
    seal_envelope_raw(
        ENVELOPE_FORMAT,
        plaintext,
        passphrase,
        DEFAULT_ITERATIONS,
        true,
    )
}

/// Open raw `desktag-backup` encrypted envelope bytes into plaintext bytes.
pub fn open_backup_bytes(raw: &[u8], passphrase: &str) -> Result<Vec<u8>, CryptoError> {
    open_envelope_raw(raw, ENVELOPE_FORMAT, passphrase)
}

/// Open a DeskTag backup (`desktag-backup` E2EE or `desktag-plain` unencrypted) into `AppData`.
pub fn open_app_data(raw: &[u8], passphrase: &str) -> Result<AppData, CryptoError> {
    let clean = strip_utf8_bom(raw);
    let val: serde_json::Value = match serde_json::from_slice(clean) {
        Ok(v) => v,
        Err(_) => {
            if is_backup_json(clean) {
                return Err(CryptoError::Corrupt);
            }
            return Err(CryptoError::NotBackup);
        }
    };

    let format = match val.get("format").and_then(|v| v.as_str()) {
        Some(f) => f,
        None => return Err(CryptoError::NotBackup),
    };

    match format {
        ENVELOPE_FORMAT => {
            let plain_bytes = open_envelope_raw(clean, ENVELOPE_FORMAT, passphrase)?;
            serde_json::from_slice::<AppData>(&plain_bytes).map_err(|_| CryptoError::Corrupt)
        }
        PLAIN_ENVELOPE_FORMAT => {
            let version_ok = val
                .get("version")
                .and_then(|v| v.as_u64())
                .map(|v| v == ENVELOPE_VERSION as u64)
                .unwrap_or(false);
            if !version_ok {
                return Err(CryptoError::NewerVersion);
            }
            let plain: PlainEnvelope =
                serde_json::from_value(val).map_err(|_| CryptoError::Corrupt)?;
            Ok(plain.data)
        }
        _ => Err(CryptoError::NotBackup),
    }
}

/// Seal auxiliary data (such as SetupText payload) into a compact `desktag-data` envelope.
pub fn seal_data(plaintext: &[u8], passphrase: &str) -> Result<Vec<u8>, CryptoError> {
    seal_envelope_raw(
        DATA_ENVELOPE_FORMAT,
        plaintext,
        passphrase,
        DEFAULT_ITERATIONS,
        false,
    )
}

/// Open auxiliary data sealed by `seal_data`.
pub fn open_data(sealed: &[u8], passphrase: &str) -> Result<Vec<u8>, CryptoError> {
    open_envelope_raw(sealed, DATA_ENVELOPE_FORMAT, passphrase)
}

/// Produce one-paste `desktag-sync:<base64url(seal_data(setupJSON, passphrase))>`.
pub fn export_setup_text(payload: &SetupPayload, passphrase: &str) -> Result<String, CryptoError> {
    if payload.url.trim().is_empty() {
        return Err(CryptoError::Internal(
            "WebDAV URL is required before exporting setup text".to_string(),
        ));
    }
    if passphrase.is_empty() {
        return Err(CryptoError::Internal(
            "An encryption passphrase is required to export a one-paste setup string".to_string(),
        ));
    }
    let normalized = SetupPayload {
        url: payload.url.trim().to_string(),
        username: payload.username.trim().to_string(),
        password: payload.password.clone(),
        remote_dir: if payload.remote_dir.trim().is_empty() {
            default_remote_dir()
        } else {
            payload.remote_dir.trim().to_string()
        },
    };
    let json_bytes = serde_json::to_vec(&normalized)
        .map_err(|e| CryptoError::Internal(format!("serialize setup payload failed: {e}")))?;
    let sealed = seal_data(&json_bytes, passphrase)?;
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&sealed);
    Ok(format!("{SETUP_PREFIX}{encoded}"))
}

/// Decode and decrypt a one-paste `desktag-sync:...` setup string using `passphrase`.
/// Skips leading chat text, line breaks wrapped inside the token, and trailing prose/punctuation.
pub fn import_setup_text(text: &str, passphrase: &str) -> Result<SetupPayload, CryptoError> {
    let idx = text.find(SETUP_PREFIX).ok_or(CryptoError::NotBackup)?;
    let after = &text[idx + SETUP_PREFIX.len()..];

    let mut segments: Vec<String> = Vec::new();
    for (pos, raw_token) in after.split_whitespace().enumerate() {
        let mut normalized = String::new();
        let mut hit_non_b64 = false;
        for ch in raw_token.chars() {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '+' | '/' | '=') {
                match ch {
                    '+' => normalized.push('-'),
                    '/' => normalized.push('_'),
                    '=' => {}
                    other => normalized.push(other),
                }
            } else {
                hit_non_b64 = true;
                break;
            }
        }

        if pos == 0 {
            if normalized.is_empty() {
                return Err(CryptoError::NotBackup);
            }
            segments.push(normalized);
            if hit_non_b64 {
                break;
            }
        } else {
            // Stop before trailing prose tokens that contain punctuation (e.g. "Thanks!")
            if hit_non_b64 || normalized.is_empty() {
                break;
            }
            segments.push(normalized);
        }
    }

    if segments.is_empty() {
        return Err(CryptoError::NotBackup);
    }

    // Try longest contiguous segment join down to 1 so trailing plain English words (e.g. "\nThanks")
    // cannot corrupt the base64url envelope, while preserving WrongPassphrase errors on valid envelopes.
    let mut last_err = CryptoError::NotBackup;
    for end in (1..=segments.len()).rev() {
        let candidate: String = segments[..end].concat();
        let Ok(sealed) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(candidate.as_bytes())
        else {
            continue;
        };
        match open_data(&sealed, passphrase) {
            Ok(plain) => {
                let payload: SetupPayload =
                    serde_json::from_slice(&plain).map_err(|_| CryptoError::Corrupt)?;
                if payload.url.trim().is_empty() {
                    return Err(CryptoError::Corrupt);
                }
                return Ok(payload);
            }
            Err(CryptoError::WrongPassphrase) => return Err(CryptoError::WrongPassphrase),
            Err(CryptoError::NewerVersion) => return Err(CryptoError::NewerVersion),
            Err(e) => last_err = e,
        }
    }

    Err(last_err)
}
