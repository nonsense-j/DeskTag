//! Zero-dependency WebDAV HTTP client over `reqwest` (rustls-tls) + `quick-xml`,
//! hardened for Nutstore, 123pan, TeraCLOUD, Synology DSM, Alist/OpenList, and Nextcloud.

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};

use base64::Engine;
use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use flate2::read::{DeflateDecoder, GzDecoder, ZlibDecoder};
use md5::Md5;
use quick_xml::events::Event;
use quick_xml::Reader;
use rand::rngs::OsRng;
use rand::RngCore;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT_ENCODING, AUTHORIZATION, CONTENT_ENCODING, CONTENT_LENGTH, CONTENT_TYPE, DATE, ETAG, IF_MATCH, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED, RETRY_AFTER, WWW_AUTHENTICATE};
use reqwest::{Client, Method, Response, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::models::{ServerFileWarning, WebDavConfig, WebDavTestResult};
use crate::webdav::crypto::{is_backup_head, strip_utf8_bom};

pub const REMOTE_FILE_NAME: &str = "desktag.desktag-backup";
pub const META_TIMEOUT: Duration = Duration::from_secs(30);
pub const ACTIVITY_TIMEOUT: Duration = Duration::from_secs(60);
pub const MAX_READ_BYTES: usize = 64 * 1024 * 1024; // 64 MiB

const MAX_BACKOFF_NO_HEADER: Duration = Duration::from_secs(30 * 60); // 30m
const MAX_BACKOFF_RETRY_AFTER: Duration = Duration::from_secs(6 * 60 * 60); // 6h

const GZIP_MAGIC: [u8; 2] = [0x1F, 0x8B];
const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteVersion {
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub modified: Option<String>,
    #[serde(default)]
    pub no_cond_read: bool,
}

impl RemoteVersion {
    /// Returns the conditional read header `(name, value)` unless disabled by `no_cond_read`.
    pub fn read_condition(&self) -> Option<(&'static str, &str)> {
        if self.no_cond_read {
            return None;
        }
        if let Some(ref etag) = self.etag {
            if !etag.is_empty() {
                return Some(("If-None-Match", etag.as_str()));
            }
        }
        if let Some(ref modified) = self.modified {
            if !modified.is_empty() {
                return Some(("If-Modified-Since", modified.as_str()));
            }
        }
        None
    }
}

#[derive(Debug)]
pub enum GetOutcome {
    NotModified(RemoteVersion),
    NotFound,
    Data { bytes: Vec<u8>, version: RemoteVersion },
}

#[derive(Debug, Error)]
pub enum DavError {
    #[error("Invalid WebDAV server URL: {0}")]
    InvalidUrl(String),
    #[error("WebDAV server refused username or password (HTTP 401)")]
    Unauthorized,
    #[error("WebDAV server denied access (HTTP 403): {0}")]
    Forbidden(String),
    #[error("Remote file changed on server while syncing (HTTP 412)")]
    PreconditionFailed,
    #[error("WebDAV server is rate-limiting requests (HTTP {status})")]
    RateLimited {
        status: u16,
        retry_after: Option<Duration>,
    },
    #[error("{message}")]
    Nowhere {
        status: u16,
        message: String,
        suggested_url: Option<String>,
    },
    #[error("{0}")]
    NotBackup(ServerFileWarning),
    #[error("Short upload: server kept {actual} of {expected} bytes for {name}")]
    ShortWrite {
        actual: u64,
        expected: usize,
        name: String,
    },
    #[error("WebDAV HTTP {status}: {message}")]
    Http { status: u16, message: String },
    #[error("Network/IO error: {0}")]
    Network(String),
}

impl std::fmt::Display for ServerFileWarning {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

/// Normalize remote_dir segments (trim slashes, default to `"desktag"`).
pub fn normalize_remote_dir(dir: &str) -> String {
    let parts: Vec<&str> = dir
        .trim()
        .split('/')
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "." && *s != "..")
        .collect();
    if parts.is_empty() {
        "desktag".to_string()
    } else {
        parts.join("/")
    }
}

/// Infer a human-friendly backend hint from a WebDAV URL.
pub fn infer_backend_hint(url: &str) -> Option<String> {
    let parsed = Url::parse(url.trim()).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    let path = parsed.path().to_ascii_lowercase();
    let port = parsed.port();

    if host.contains("jianguoyun.com") {
        Some("Nutstore (坚果云)".to_string())
    } else if host.contains("123pan") || host.contains("123957") || host.contains("123684") {
        Some("123pan (123云盘)".to_string())
    } else if host.contains("teracloud.jp") || host.contains("infini-cloud.net") {
        Some("TeraCLOUD / InfiniCLOUD".to_string())
    } else if path.contains("remote.php/dav") {
        Some("Nextcloud / ownCloud".to_string())
    } else if matches!(port, Some(5005 | 5006)) {
        Some("Synology DSM".to_string())
    } else if path == "/dav" || path.starts_with("/dav/") {
        Some("WebDAV (Alist / Standard)".to_string())
    } else {
        Some("WebDAV".to_string())
    }
}

/// Compute next auto-sync wait duration after a sync attempt (Magpie exponential backoff + Retry-After).
pub fn compute_backoff(
    rate_limit: Option<Option<Duration>>,
    prev_wait: Duration,
    base_interval: Duration,
) -> Duration {
    match rate_limit {
        None => base_interval,
        Some(Some(retry_after)) if retry_after > Duration::ZERO => {
            let cap = MAX_BACKOFF_RETRY_AFTER.max(base_interval);
            retry_after.max(base_interval).min(cap)
        }
        Some(_) => {
            let cap = MAX_BACKOFF_NO_HEADER.max(base_interval);
            let doubled = prev_wait.saturating_mul(2).max(base_interval.saturating_mul(2));
            doubled.min(cap)
        }
    }
}

// ---------------------------------------------------------------------------
// RFC 7616 HTTP Digest Authentication
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DigestAlgo {
    Md5,
    Md5Sess,
    Sha256,
    Sha256Sess,
}

impl DigestAlgo {
    fn as_header_str(self) -> &'static str {
        match self {
            Self::Md5 => "MD5",
            Self::Md5Sess => "MD5-sess",
            Self::Sha256 => "SHA-256",
            Self::Sha256Sess => "SHA-256-sess",
        }
    }

    fn is_sha256(self) -> bool {
        matches!(self, Self::Sha256 | Self::Sha256Sess)
    }

    fn is_session(self) -> bool {
        matches!(self, Self::Md5Sess | Self::Sha256Sess)
    }

    fn hash_hex(self, input: &str) -> String {
        match self {
            Self::Md5 | Self::Md5Sess => {
                let mut h = Md5::new();
                h.update(input.as_bytes());
                hex::encode(h.finalize())
            }
            Self::Sha256 | Self::Sha256Sess => {
                let mut h = Sha256::new();
                h.update(input.as_bytes());
                hex::encode(h.finalize())
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct DigestChallenge {
    realm: String,
    nonce: String,
    opaque: Option<String>,
    algorithm: DigestAlgo,
    qop_auth: bool,
}

#[derive(Debug, Clone)]
struct DigestState {
    challenge: DigestChallenge,
    nc: u32,
}

impl DigestChallenge {
    pub fn authorize(&self, method: &str, uri: &str, user: &str, pass: &str, nc: u32) -> String {
        let mut cnonce_raw = [0u8; 8];
        OsRng.fill_bytes(&mut cnonce_raw);
        let cnonce = hex::encode(cnonce_raw);
        self.authorize_with_cnonce(method, uri, user, pass, nc, &cnonce)
    }

    fn authorize_with_cnonce(
        &self,
        method: &str,
        uri: &str,
        user: &str,
        pass: &str,
        nc: u32,
        cnonce: &str,
    ) -> String {
        let mut ha1 = self
            .algorithm
            .hash_hex(&format!("{user}:{}:{pass}", self.realm));
        if self.algorithm.is_session() {
            ha1 = self
                .algorithm
                .hash_hex(&format!("{ha1}:{}:{cnonce}", self.nonce));
        }
        let ha2 = self.algorithm.hash_hex(&format!("{method}:{uri}"));
        let ncs = format!("{nc:08x}");

        let response = if self.qop_auth {
            self.algorithm
                .hash_hex(&format!("{ha1}:{}:{ncs}:{cnonce}:auth:{ha2}", self.nonce))
        } else {
            self.algorithm.hash_hex(&format!("{ha1}:{}:{ha2}", self.nonce))
        };

        let mut parts = vec![
            format!("username={}", quote_auth_param(user)),
            format!("realm={}", quote_auth_param(&self.realm)),
            format!("nonce={}", quote_auth_param(&self.nonce)),
            format!("uri={}", quote_auth_param(uri)),
            format!("algorithm={}", self.algorithm.as_header_str()),
            format!("response={}", quote_auth_param(&response)),
        ];

        if self.qop_auth {
            parts.push("qop=auth".to_string());
            parts.push(format!("nc={ncs}"));
            parts.push(format!("cnonce={}", quote_auth_param(cnonce)));
        }

        if let Some(ref opaque) = self.opaque {
            if !opaque.is_empty() {
                parts.push(format!("opaque={}", quote_auth_param(opaque)));
            }
        }

        format!("Digest {}", parts.join(", "))
    }
}

fn quote_auth_param(s: &str) -> String {
    let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

/// Parse one or more `WWW-Authenticate` header values and select the strongest Digest challenge
/// (preferring SHA-256 / SHA-256-sess over MD5 / MD5-sess).
pub fn parse_digest_challenges<'a, I>(headers: I) -> Option<DigestChallenge>
where
    I: IntoIterator<Item = &'a str>,
{
    let mut best: Option<DigestChallenge> = None;

    for raw in headers {
        for segment in split_auth_challenges(raw) {
            let trimmed = segment.trim();
            if trimmed.len() < 7 || !trimmed[..7].eq_ignore_ascii_case("digest ") {
                continue;
            }
            let params = parse_auth_params(&trimmed[7..]);
            let Some(nonce) = params.get("nonce").filter(|s| !s.is_empty()).cloned() else {
                continue;
            };
            let realm = params.get("realm").cloned().unwrap_or_default();
            let opaque = params.get("opaque").filter(|s| !s.is_empty()).cloned();

            let algo_str = params
                .get("algorithm")
                .map(|s| s.to_ascii_uppercase())
                .unwrap_or_else(|| "MD5".to_string());
            let algorithm = match algo_str.as_str() {
                "MD5" | "" => DigestAlgo::Md5,
                "MD5-SESS" => DigestAlgo::Md5Sess,
                "SHA-256" => DigestAlgo::Sha256,
                "SHA-256-SESS" => DigestAlgo::Sha256Sess,
                _ => continue,
            };

            let mut qop_auth = false;
            if let Some(qop_raw) = params.get("qop").filter(|s| !s.is_empty()) {
                for token in qop_raw.split(',') {
                    if token.trim().eq_ignore_ascii_case("auth") {
                        qop_auth = true;
                    }
                }
                if !qop_auth {
                    // Server only offered auth-int or unknown qop
                    continue;
                }
            }

            let candidate = DigestChallenge {
                realm,
                nonce,
                opaque,
                algorithm,
                qop_auth,
            };

            let prefer = match &best {
                None => true,
                Some(current) => candidate.algorithm.is_sha256() && !current.algorithm.is_sha256(),
            };
            if prefer {
                best = Some(candidate);
            }
        }
    }

    best
}

/// Split a single `WWW-Authenticate` header that may carry comma-separated challenges
/// (e.g., `Basic realm="x", Digest realm="x", nonce="1", algorithm=SHA-256`).
fn split_auth_challenges(raw: &str) -> Vec<&str> {
    let bytes = raw.as_bytes();
    let mut slices = Vec::new();
    let mut start = 0usize;
    let mut in_quotes = false;
    let mut escape = false;
    let mut i = 0usize;

    while i < bytes.len() {
        let b = bytes[i];
        if in_quotes {
            if escape {
                escape = false;
            } else if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_quotes = false;
            }
            i += 1;
            continue;
        }
        if b == b'"' {
            in_quotes = true;
            i += 1;
            continue;
        }
        if b == b',' {
            // Check whether the next non-space token starts a new auth scheme (`Scheme <key>=`)
            let rest = raw[i + 1..].trim_start();
            if starts_with_auth_scheme(rest) {
                slices.push(&raw[start..i]);
                start = i + 1;
            }
        }
        i += 1;
    }
    if start < raw.len() {
        slices.push(&raw[start..]);
    }
    slices
}

fn starts_with_auth_scheme(s: &str) -> bool {
    let Some((first, after)) = s.split_once(char::is_whitespace) else {
        return false;
    };
    if first.is_empty() || first.contains('=') {
        return false;
    }
    first.eq_ignore_ascii_case("digest")
        || first.eq_ignore_ascii_case("basic")
        || first.eq_ignore_ascii_case("bearer")
        || after.trim_start().contains('=')
}

fn parse_auth_params(mut s: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    loop {
        s = s.trim_start_matches(|c: char| c == ',' || c == ' ' || c == '\t');
        let Some(eq) = s.find('=') else {
            break;
        };
        let key = s[..eq].trim().to_ascii_lowercase();
        s = s[eq + 1..].trim_start_matches(|c: char| c == ' ' || c == '\t');

        let val = if let Some(after_quote) = s.strip_prefix('"') {
            let mut buf = String::new();
            let mut chars = after_quote.char_indices();
            let mut end_idx = after_quote.len();
            while let Some((idx, ch)) = chars.next() {
                if ch == '\\' {
                    if let Some((_, next_ch)) = chars.next() {
                        buf.push(next_ch);
                    }
                } else if ch == '"' {
                    end_idx = idx + 1;
                    break;
                } else {
                    buf.push(ch);
                }
            }
            s = &after_quote[end_idx..];
            buf
        } else {
            let end = s.find(',').unwrap_or(s.len());
            let v = s[..end].trim().to_string();
            s = &s[end..];
            v
        };

        out.insert(key, val);
    }
    out
}

// ---------------------------------------------------------------------------
// HTTP Date, Retry-After, Version Extraction & Defensive Decompression
// ---------------------------------------------------------------------------

/// Parse RFC 7231 HTTP-date formats (IMF-fixdate / RFC 2822, RFC 850, ANSI asctime).
pub fn parse_http_date(raw: &str) -> Option<DateTime<Utc>> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc2822(s) {
        return Some(dt.with_timezone(&Utc));
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(s, "%a, %d %b %Y %H:%M:%S GMT") {
        return Some(Utc.from_utc_datetime(&naive));
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(s, "%A, %d-%b-%y %H:%M:%S GMT") {
        return Some(Utc.from_utc_datetime(&naive));
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(s, "%a %b %e %H:%M:%S %Y") {
        return Some(Utc.from_utc_datetime(&naive));
    }
    None
}

/// Parse `Retry-After` header (delta seconds or HTTP-date).
pub fn parse_retry_after(raw: &str) -> Option<Duration> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(secs) = s.parse::<u64>() {
        if secs > 0 {
            return Some(Duration::from_secs(secs));
        }
        return None;
    }
    if let Some(target) = parse_http_date(s) {
        let delta = target.signed_duration_since(Utc::now());
        if delta.num_seconds() > 0 {
            return Some(Duration::from_secs(delta.num_seconds() as u64));
        }
    }
    None
}

/// Extract `RemoteVersion` from HTTP response headers:
/// - Prefers `ETag`.
/// - Falls back to `Last-Modified` ONLY when `Date - Last-Modified >= 1s` (Magpie #1s clock-skew guard).
pub fn version_from_headers(headers: &HeaderMap) -> RemoteVersion {
    if let Some(etag) = header_str(headers, ETAG).filter(|s| !s.is_empty()) {
        return RemoteVersion {
            etag: Some(etag.to_string()),
            modified: None,
            no_cond_read: false,
        };
    }
    let Some(lm_raw) = header_str(headers, LAST_MODIFIED).filter(|s| !s.is_empty()) else {
        return RemoteVersion::default();
    };
    let Some(lm_time) = parse_http_date(lm_raw) else {
        return RemoteVersion::default();
    };
    let Some(date_raw) = header_str(headers, DATE).filter(|s| !s.is_empty()) else {
        return RemoteVersion::default();
    };
    let Some(date_time) = parse_http_date(date_raw) else {
        return RemoteVersion::default();
    };
    if date_time.signed_duration_since(lm_time) < chrono::Duration::seconds(1) {
        return RemoteVersion::default();
    }
    RemoteVersion {
        etag: None,
        modified: Some(lm_raw.to_string()),
        no_cond_read: false,
    }
}

/// Transparently unpack gzip, zstd, or deflate bodies sent despite `Accept-Encoding: identity`.
pub fn unpack_body(data: Vec<u8>, content_encoding: Option<&str>) -> Result<Vec<u8>, String> {
    let enc = content_encoding
        .unwrap_or("")
        .rsplit(',')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    if data.starts_with(&GZIP_MAGIC) {
        let decoder = GzDecoder::new(data.as_slice());
        return read_bounded(decoder);
    }
    if data.starts_with(&ZSTD_MAGIC) {
        let decoder =
            zstd::stream::read::Decoder::new(data.as_slice()).map_err(|e| format!("zstd init failed: {e}"))?;
        return read_bounded(decoder);
    }
    if enc == "deflate" && !data.is_empty() && data[0] != b'{' {
        if let Ok(out) = read_bounded(ZlibDecoder::new(data.as_slice())) {
            return Ok(out);
        }
        return read_bounded(DeflateDecoder::new(data.as_slice()));
    }
    if enc == "br" && !data.is_empty() && data[0] != b'{' {
        return Err(
            "WebDAV server compressed the backup with Brotli (Content-Encoding: br) despite Accept-Encoding: identity; disable Brotli for the WebDAV path on the server or proxy"
                .to_string(),
        );
    }
    Ok(data)
}

fn read_bounded<R: Read>(reader: R) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let limit = (MAX_READ_BYTES as u64) + 1;
    reader
        .take(limit)
        .read_to_end(&mut out)
        .map_err(|e| format!("failed to decompress WebDAV response: {e}"))?;
    if out.len() > MAX_READ_BYTES {
        return Err(format!(
            "decompressed WebDAV backup exceeds {} MiB limit",
            MAX_READ_BYTES / (1024 * 1024)
        ));
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Captive Portal / Wrong URL / Foreign File Classification (`what_is`)
// ---------------------------------------------------------------------------

/// Inspect unexpected response bytes and classify into an actionable `ServerFileWarning`.
/// HTML and XML responses always set `can_replace = false` so DeskTag never overwrites a server endpoint.
pub fn what_is(data: &[u8], moved: Option<String>, remote_path: &str) -> ServerFileWarning {
    let size = data.len();
    if size == 0 {
        return ServerFileWarning {
            kind: "empty".to_string(),
            message: format!(
                "Remote file {remote_path} is empty (0 bytes) — a previous upload did not finish. Use Force Upload to replace it."
            ),
            can_replace: true,
            hint: None,
        };
    }

    let clean = strip_utf8_bom(data);
    let trimmed = trim_ascii_whitespace(clean);

    if is_backup_head(trimmed) {
        return ServerFileWarning {
            kind: "cut".to_string(),
            message: format!(
                "Remote file {remote_path} is a truncated or damaged DeskTag backup ({size} bytes). Sync from the last device that wrote it, or use Force Upload to rebuild it."
            ),
            can_replace: true,
            hint: None,
        };
    }

    let head_len = trimmed.len().min(512);
    let head = String::from_utf8_lossy(&trimmed[..head_len]).to_ascii_lowercase();

    if head.starts_with('<')
        && (head.contains("<html")
            || head.contains("<!doctype html")
            || head.contains("<head")
            || head.contains("<body")
            || head.contains("<title"))
    {
        let title = extract_html_title(trimmed);
        let mut msg = format!("Server returned a web page instead of {remote_path}");
        if let Some(ref t) = title {
            msg.push_str(&format!(" (\"{t}\")"));
        }
        if let Some(ref m) = moved {
            msg.push_str(&format!(" after redirecting to {m}"));
        }
        msg.push_str(". Check that the URL is a WebDAV endpoint rather than a web login page.");
        return ServerFileWarning {
            kind: "page".to_string(),
            message: msg,
            can_replace: false,
            hint: Some(
                "Nutstore: https://dav.jianguoyun.com/dav/  |  Nextcloud: https://<host>/remote.php/dav/files/<user>/"
                    .to_string(),
            ),
        };
    }

    if head.starts_with("<?xml") || head.starts_with('<') {
        let root = extract_xml_root(trimmed);
        let mut msg = format!("Server returned an XML document instead of {remote_path}");
        if let Some(ref r) = root {
            msg.push_str(&format!(" (<{r}>)"));
        }
        if let Some(ref m) = moved {
            msg.push_str(&format!(" after redirecting to {m}"));
        }
        msg.push_str(". Verify the WebDAV server URL and remote folder path.");
        return ServerFileWarning {
            kind: "xml".to_string(),
            message: msg,
            can_replace: false,
            hint: Some(
                "Nutstore: https://dav.jianguoyun.com/dav/  |  Nextcloud: https://<host>/remote.php/dav/files/<user>/"
                    .to_string(),
            ),
        };
    }

    if let Ok(val) = serde_json::from_slice::<serde_json::Value>(trimmed) {
        if let Some(fmt) = val.get("format").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            let fmt_clipped = clip_str(fmt, 40);
            return ServerFileWarning {
                kind: "format".to_string(),
                message: format!(
                    "Remote file {remote_path} belongs to another format (\"{fmt_clipped}\"), not DeskTag. Choose a different remote folder or use Force Upload."
                ),
                can_replace: true,
                hint: None,
            };
        }
        return ServerFileWarning {
            kind: "json".to_string(),
            message: format!(
                "Remote file {remote_path} is a JSON file ({size} bytes) that is not a DeskTag backup. Choose another folder or use Force Upload."
            ),
            can_replace: true,
            hint: None,
        };
    }

    ServerFileWarning {
        kind: "other".to_string(),
        message: format!(
            "Remote file {remote_path} is not a DeskTag backup ({size} bytes). Choose another folder or use Force Upload."
        ),
        can_replace: true,
        hint: None,
    }
}

fn trim_ascii_whitespace(bytes: &[u8]) -> &[u8] {
    let start = bytes
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    let end = bytes
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .map(|i| i + 1)
        .unwrap_or(start);
    &bytes[start..end]
}

fn extract_html_title(data: &[u8]) -> Option<String> {
    let slice = &data[..data.len().min(64 * 1024)];
    let text = String::from_utf8_lossy(slice);
    let lower = text.to_ascii_lowercase();
    let start_tag = lower.find("<title")?;
    let after_open = lower[start_tag..].find('>')? + start_tag + 1;
    let close_tag = lower[after_open..].find("</title>")? + after_open;
    let raw_title = text[after_open..close_tag]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let cleaned = raw_title
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    if cleaned.is_empty() {
        None
    } else {
        Some(clip_str(&cleaned, 80))
    }
}

fn extract_xml_root(data: &[u8]) -> Option<String> {
    let slice = &data[..data.len().min(4096)];
    let mut text = String::from_utf8_lossy(slice).into_owned();
    if let Some(pos) = text.find("?>") {
        text = text[pos + 2..].to_string();
    }
    let trimmed = text.trim_start();
    let after_lt = trimmed.strip_prefix('<')?;
    let name: String = after_lt
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | ':' | '-' | '.'))
        .collect();
    if name.is_empty() {
        None
    } else {
        Some(clip_str(&name, 40))
    }
}

fn clip_str(s: &str, max_chars: usize) -> String {
    let mut chars = s.chars();
    let prefix: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

// ---------------------------------------------------------------------------
// WebDAV XML Parsing Helpers (`quick-xml`)
// ---------------------------------------------------------------------------

/// Parse `<getcontentlength>` from a `PROPFIND Depth: 0` Multi-Status response.
pub fn parse_propfind_content_length(xml_bytes: &[u8]) -> Option<u64> {
    let mut reader = Reader::from_reader(xml_bytes);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut in_len = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                if e.local_name().as_ref().eq_ignore_ascii_case(b"getcontentlength") {
                    in_len = true;
                }
            }
            Ok(Event::End(e)) => {
                if e.local_name().as_ref().eq_ignore_ascii_case(b"getcontentlength") {
                    in_len = false;
                }
            }
            Ok(Event::Text(t)) if in_len => {
                if let Ok(txt) = t.unescape() {
                    if let Ok(n) = txt.trim().parse::<u64>() {
                        return Some(n);
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    None
}

/// Parse up to `max_count` direct child `<collection>` names from a `PROPFIND Depth: 1` response.
pub fn parse_propfind_child_collections(
    xml_bytes: &[u8],
    base_path: &str,
    max_count: usize,
) -> Vec<String> {
    let self_path = base_path.trim_end_matches('/');
    let mut reader = Reader::from_reader(xml_bytes);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    let mut in_response = false;
    let mut in_href = false;
    let mut current_href = String::new();
    let mut is_collection = false;
    let mut out = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.local_name();
                if name.as_ref().eq_ignore_ascii_case(b"response") {
                    in_response = true;
                    current_href.clear();
                    is_collection = false;
                } else if in_response && name.as_ref().eq_ignore_ascii_case(b"href") {
                    in_href = true;
                } else if in_response && name.as_ref().eq_ignore_ascii_case(b"collection") {
                    is_collection = true;
                }
            }
            Ok(Event::Empty(e)) => {
                if in_response && e.local_name().as_ref().eq_ignore_ascii_case(b"collection") {
                    is_collection = true;
                }
            }
            Ok(Event::Text(t)) if in_href => {
                if let Ok(txt) = t.unescape() {
                    current_href.push_str(txt.trim());
                }
            }
            Ok(Event::End(e)) => {
                let name = e.local_name();
                if name.as_ref().eq_ignore_ascii_case(b"href") {
                    in_href = false;
                } else if name.as_ref().eq_ignore_ascii_case(b"response") {
                    if is_collection && !current_href.is_empty() && out.len() < max_count {
                        let raw_path = Url::parse(&current_href)
                            .map(|u| u.path().to_string())
                            .unwrap_or_else(|_| current_href.clone());
                        let norm = raw_path.trim_end_matches('/');
                        if norm != self_path && !norm.is_empty() {
                            let (parent, leaf) = split_parent_and_leaf(norm);
                            let is_direct_child = parent == self_path
                                || (self_path.is_empty() && parent == "/");
                            if is_direct_child && !leaf.is_empty() && !out.contains(&leaf) {
                                out.push(leaf);
                            }
                        }
                    }
                    in_response = false;
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    out
}

fn split_parent_and_leaf(path: &str) -> (&str, String) {
    match path.rfind('/') {
        Some(0) => ("/", path[1..].to_string()),
        Some(idx) => (&path[..idx], path[idx + 1..].to_string()),
        None => ("", path.to_string()),
    }
}

// ---------------------------------------------------------------------------
// WebDAV HTTP Client
// ---------------------------------------------------------------------------

pub struct WebDavClient {
    base: Url,
    remote_dir: String,
    username: String,
    password: String,
    http: Client,
    digest: StdMutex<Option<DigestState>>,
    no_cond_read: AtomicBool,
}

impl WebDavClient {
    pub fn from_config(cfg: &WebDavConfig) -> Result<Self, DavError> {
        Self::new(&cfg.url, &cfg.remote_dir, &cfg.username, &cfg.password)
    }

    pub fn new(
        base_url: &str,
        remote_dir: &str,
        username: &str,
        password: &str,
    ) -> Result<Self, DavError> {
        let trimmed = base_url.trim();
        let mut parsed =
            Url::parse(trimmed).map_err(|e| DavError::InvalidUrl(format!("{trimmed}: {e}")))?;
        if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
            return Err(DavError::InvalidUrl(format!(
                "\"{trimmed}\" must start with https:// or http://"
            )));
        }
        let clean_path = parsed.path().trim_end_matches('/').to_string();
        parsed.set_path(&clean_path);
        parsed.set_query(None);
        parsed.set_fragment(None);

        let http = Client::builder()
            .connect_timeout(META_TIMEOUT)
            .read_timeout(ACTIVITY_TIMEOUT)
            .user_agent(format!("DeskTag/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| DavError::Network(format!("failed to initialize HTTP client: {e}")))?;

        Ok(Self {
            base: parsed,
            remote_dir: normalize_remote_dir(remote_dir),
            username: username.trim().to_string(),
            password: password.to_string(),
            http,
            digest: StdMutex::new(None),
            no_cond_read: AtomicBool::new(false),
        })
    }

    pub fn set_no_cond_read(&self, value: bool) {
        self.no_cond_read.store(value, Ordering::Relaxed);
    }

    pub fn is_no_cond_read(&self) -> bool {
        self.no_cond_read.load(Ordering::Relaxed)
    }

    pub fn remote_rel_path(&self) -> String {
        format!("{}/{}", self.remote_dir, REMOTE_FILE_NAME)
    }

    fn base_url_str(&self) -> String {
        let mut u = self.base.clone();
        let path = u.path().trim_end_matches('/').to_string();
        u.set_path(&format!("{path}/"));
        u.to_string()
    }

    fn join_url(&self, segments: &[&str], trailing_slash: bool) -> Url {
        let mut u = self.base.clone();
        let mut path = u.path().trim_end_matches('/').to_string();
        for seg in segments {
            for part in seg.split('/').filter(|p| !p.is_empty()) {
                path.push('/');
                path.push_str(part);
            }
        }
        if trailing_slash && !path.ends_with('/') {
            path.push('/');
        }
        u.set_path(&path);
        u
    }

    fn dir_url(&self) -> Url {
        self.join_url(&[&self.remote_dir], true)
    }

    fn file_url(&self) -> Url {
        self.join_url(&[&self.remote_dir, REMOTE_FILE_NAME], false)
    }

    /// Execute a single HTTP request with Basic Auth + automatic RFC 7616 Digest Auth fallback & caching.
    async fn send_raw(
        &self,
        method: Method,
        url: Url,
        body: Option<Vec<u8>>,
        extra_headers: &[(&str, &str)],
        timeout: Option<Duration>,
    ) -> Result<Response, DavError> {
        let mut used_cached_digest = false;
        let auth_header = self.build_auth_header(&method, &url, &mut used_cached_digest);

        let res = self
            .execute_once(&method, &url, body.clone(), extra_headers, auth_header, timeout)
            .await?;

        if res.status() == StatusCode::UNAUTHORIZED {
            let www_vals: Vec<String> = res
                .headers()
                .get_all(WWW_AUTHENTICATE)
                .iter()
                .filter_map(|v| v.to_str().ok().map(ToString::to_string))
                .collect();
            let challenge = parse_digest_challenges(www_vals.iter().map(String::as_str));
            if let Some(fresh) = challenge {
                let digest_header = {
                    let mut guard = self.digest.lock().unwrap_or_else(|e| e.into_inner());
                    *guard = Some(DigestState {
                        challenge: fresh,
                        nc: 1,
                    });
                    let st = guard.as_ref().expect("just set");
                    st.challenge.authorize(
                        method.as_str(),
                        &request_uri(&url),
                        &self.username,
                        &self.password,
                        st.nc,
                    )
                };
                let retry_res = self
                    .execute_once(&method, &url, body, extra_headers, Some(digest_header), timeout)
                    .await?;
                if retry_res.status() == StatusCode::UNAUTHORIZED {
                    return Err(DavError::Unauthorized);
                }
                if let Some(err) = check_rate_limit(retry_res.status(), retry_res.headers()) {
                    return Err(err);
                }
                return Ok(retry_res);
            }
            return Err(DavError::Unauthorized);
        }

        if let Some(err) = check_rate_limit(res.status(), res.headers()) {
            return Err(err);
        }

        Ok(res)
    }

    fn build_auth_header(
        &self,
        method: &Method,
        url: &Url,
        used_digest: &mut bool,
    ) -> Option<String> {
        if self.username.is_empty() && self.password.is_empty() {
            return None;
        }
        let mut guard = self.digest.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(ref mut st) = *guard {
            st.nc = st.nc.saturating_add(1);
            *used_digest = true;
            return Some(st.challenge.authorize(
                method.as_str(),
                &request_uri(url),
                &self.username,
                &self.password,
                st.nc,
            ));
        }
        let creds = format!("{}:{}", self.username, self.password);
        let encoded = base64::engine::general_purpose::STANDARD.encode(creds.as_bytes());
        Some(format!("Basic {encoded}"))
    }

    async fn execute_once(
        &self,
        method: &Method,
        url: &Url,
        body: Option<Vec<u8>>,
        extra_headers: &[(&str, &str)],
        auth_header: Option<String>,
        timeout: Option<Duration>,
    ) -> Result<Response, DavError> {
        let mut req = self.http.request(method.clone(), url.clone());
        if let Some(t) = timeout {
            req = req.timeout(t);
        }
        if let Some(auth) = auth_header {
            req = req.header(AUTHORIZATION, auth);
        }
        for (k, v) in extra_headers {
            if let (Ok(name), Ok(val)) = (
                HeaderName::from_bytes(k.as_bytes()),
                HeaderValue::from_str(v),
            ) {
                req = req.header(name, val);
            }
        }
        if let Some(bytes) = body {
            req = req.body(bytes);
        }
        req.send()
            .await
            .map_err(|e| DavError::Network(format!("{e}")))
    }

    /// Read response body with a 60s per-chunk activity watchdog and 64 MiB cap.
    async fn read_body_bounded(&self, mut res: Response) -> Result<Vec<u8>, DavError> {
        let mut out = Vec::new();
        loop {
            let chunk_opt = tokio::time::timeout(ACTIVITY_TIMEOUT, res.chunk())
                .await
                .map_err(|_| {
                    DavError::Network(format!(
                        "WebDAV download stalled for {}s with no data",
                        ACTIVITY_TIMEOUT.as_secs()
                    ))
                })?
                .map_err(|e| DavError::Network(format!("reading WebDAV response body: {e}")))?;

            let Some(chunk) = chunk_opt else {
                break;
            };
            if out.len().saturating_add(chunk.len()) > MAX_READ_BYTES {
                return Err(DavError::Network(format!(
                    "WebDAV remote file exceeds {} MiB limit",
                    MAX_READ_BYTES / (1024 * 1024)
                )));
            }
            out.extend_from_slice(&chunk);
        }
        Ok(out)
    }

    /// Conditional `GET` of the remote backup with full Nutstore / 123pan / TeraCLOUD / Synology / redirect hardening.
    pub async fn get(&self, have: &RemoteVersion) -> Result<GetOutcome, DavError> {
        if have.no_cond_read {
            self.set_no_cond_read(true);
        }

        let mut cond = if self.is_no_cond_read() {
            None
        } else {
            have.read_condition().map(|(k, v)| (k, v.to_string()))
        };

        let target_url = self.file_url();

        loop {
            let mut headers: Vec<(&str, &str)> = vec![(ACCEPT_ENCODING.as_str(), "identity")];
            if let Some((ref k, ref v)) = cond {
                headers.push((k, v.as_str()));
            }

            let res = self
                .send_raw(Method::GET, target_url.clone(), None, &headers, None)
                .await?;
            let status = res.status();

            // 123pan quirk (#4993): conditional GET returns >= 500 -> permanently disable conditional reads and retry immediately!
            if cond.is_some() && status.is_server_error() {
                self.set_no_cond_read(true);
                cond = None;
                continue;
            }

            if status == StatusCode::NOT_MODIFIED && cond.is_some() {
                let mut v = have.clone();
                v.no_cond_read = self.is_no_cond_read();
                return Ok(GetOutcome::NotModified(v));
            }

            // Synology DSM quirk: 403 for file inside non-existent folder
            if status == StatusCode::FORBIDDEN {
                if !self.dir_exists(&self.dir_url()).await {
                    return Ok(GetOutcome::NotFound);
                }
                return Err(self.diagnose_forbidden().await);
            }

            // Nutstore quirk: 409 Conflict when folder does not exist yet
            if matches!(
                status,
                StatusCode::NOT_FOUND | StatusCode::GONE | StatusCode::CONFLICT
            ) {
                return Ok(GetOutcome::NotFound);
            }

            if status != StatusCode::OK {
                return Err(DavError::Http {
                    status: status.as_u16(),
                    message: format!("reading {} failed", self.remote_rel_path()),
                });
            }

            let final_url = res.url().clone();
            let resp_headers = res.headers().clone();
            let raw_bytes = self.read_body_bounded(res).await?;

            // TeraCLOUD / nginx quirk: unpack if server compressed despite Accept-Encoding: identity
            let encoding = header_str(&resp_headers, CONTENT_ENCODING);
            let bytes = unpack_body(raw_bytes, encoding).map_err(|e| DavError::Http {
                status: status.as_u16(),
                message: e,
            })?;

            // Redirect detection to captive portal / web login page
            if urls_differ(&target_url, &final_url) && !is_backup_head(&bytes) {
                let moved = format!(
                    "{}{}",
                    final_url.host_str().unwrap_or(""),
                    final_url.path()
                );
                let warning = what_is(&bytes, Some(moved), &self.remote_rel_path());
                if !warning.can_replace {
                    return Err(DavError::NotBackup(warning));
                }
            }

            let mut ver = version_from_headers(&resp_headers);
            ver.no_cond_read = self.is_no_cond_read();
            return Ok(GetOutcome::Data {
                bytes,
                version: ver,
            });
        }
    }

    /// Conditional `PUT` with automatic `MKCOL` (including Synology 403), Alist `PROPFIND Depth: 1` hints,
    /// Nutstore `HEAD: 0` -> `PROPFIND` length verification, and 3x short-write retry updating `If-Match`.
    pub async fn put(
        &self,
        data: &[u8],
        if_match_etag: Option<&str>,
    ) -> Result<RemoteVersion, DavError> {
        let file_url = self.file_url();
        let mut current_if_match: Option<String> = if_match_etag
            .filter(|e| !e.is_empty())
            .map(ToString::to_string);
        let mut try_idx: usize = 0;
        let mut writes: usize = 0;

        loop {
            let mut headers: Vec<(&str, &str)> =
                vec![(CONTENT_TYPE.as_str(), "application/octet-stream")];
            if let Some(ref etag) = current_if_match {
                headers.push((IF_MATCH.as_str(), etag.as_str()));
            }

            let res = self
                .send_raw(
                    Method::PUT,
                    file_url.clone(),
                    Some(data.to_vec()),
                    &headers,
                    None,
                )
                .await?;
            let status = res.status();
            let resp_etag = header_str(res.headers(), ETAG)
                .filter(|s| !s.is_empty())
                .map(ToString::to_string);

            if status.is_success() {
                writes += 1;
                match self.verify_upload_length(&file_url, data.len()).await {
                    Ok(_) => {
                        return Ok(RemoteVersion {
                            etag: resp_etag,
                            modified: None,
                            no_cond_read: self.is_no_cond_read(),
                        });
                    }
                    Err((actual, head_etag)) => {
                        if writes < 3 {
                            // Update If-Match to the truncated file's new ETag before retrying
                            current_if_match = resp_etag.or(head_etag);
                            try_idx += 1;
                            continue;
                        }
                        return Err(DavError::ShortWrite {
                            actual,
                            expected: data.len(),
                            name: REMOTE_FILE_NAME.to_string(),
                        });
                    }
                }
            }

            if status == StatusCode::PRECONDITION_FAILED {
                return Err(DavError::PreconditionFailed);
            }

            if status == StatusCode::FORBIDDEN
                && (try_idx > 0 || self.dir_exists(&self.dir_url()).await)
            {
                return Err(self.diagnose_forbidden().await);
            }

            // First attempt missing folder (404 / 409 / Synology 403): create folder via MKCOL and retry
            if try_idx == 0
                && matches!(
                    status,
                    StatusCode::NOT_FOUND | StatusCode::CONFLICT | StatusCode::FORBIDDEN
                )
            {
                self.ensure_remote_dir().await?;
                try_idx += 1;
                continue;
            }

            // Second attempt still 404/409 -> Alist/OpenList root storage discovery via PROPFIND Depth: 1
            if matches!(status, StatusCode::NOT_FOUND | StatusCode::CONFLICT) {
                return Err(self.diagnose_nowhere(status.as_u16()).await);
            }

            return Err(DavError::Http {
                status: status.as_u16(),
                message: format!("writing {} failed", self.remote_rel_path()),
            });
        }
    }

    /// Post-`PUT` length verification (`HEAD` + `PROPFIND Depth: 0` fallback for Nutstore's `Content-Length: 0` quirk).
    async fn verify_upload_length(
        &self,
        file_url: &Url,
        want: usize,
    ) -> Result<Option<String>, (u64, Option<String>)> {
        let Ok(res) = self
            .send_raw(Method::HEAD, file_url.clone(), None, &[], Some(META_TIMEOUT))
            .await
        else {
            return Ok(None);
        };
        if res.status() != StatusCode::OK {
            return Ok(None);
        }
        let head_etag = header_str(res.headers(), ETAG)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string);

        let content_len = header_str(res.headers(), CONTENT_LENGTH)
            .and_then(|s| s.trim().parse::<u64>().ok());

        let Some(mut observed) = content_len else {
            return Ok(head_etag);
        };
        if observed >= want as u64 {
            return Ok(head_etag);
        }

        // Nutstore quirk (#1259): HEAD reports Content-Length: 0 -> verify via PROPFIND Depth: 0 <getcontentlength>
        if let Some(prop_len) = self.propfind_length(file_url).await {
            if prop_len >= want as u64 {
                return Ok(head_etag);
            }
            observed = prop_len;
        }

        Err((observed, head_etag))
    }

    async fn propfind_length(&self, url: &Url) -> Option<u64> {
        let method = Method::from_bytes(b"PROPFIND").ok()?;
        let res = self
            .send_raw(method, url.clone(), None, &[("Depth", "0")], Some(META_TIMEOUT))
            .await
            .ok()?;
        if res.status() != StatusCode::MULTI_STATUS {
            return None;
        }
        let body = res.bytes().await.ok()?;
        parse_propfind_content_length(&body)
    }

    async fn dir_exists(&self, dir_url: &Url) -> bool {
        let Ok(method) = Method::from_bytes(b"PROPFIND") else {
            return true;
        };
        match self
            .send_raw(
                method,
                dir_url.clone(),
                None,
                &[("Depth", "0")],
                Some(META_TIMEOUT),
            )
            .await
        {
            Ok(res) => res.status().is_success(),
            Err(_) => true,
        }
    }

    /// Create each nested segment of `remote_dir` with `MKCOL`.
    async fn ensure_remote_dir(&self) -> Result<(), DavError> {
        let mkcol = Method::from_bytes(b"MKCOL")
            .map_err(|e| DavError::Network(format!("invalid MKCOL method: {e}")))?;

        let mut built = Vec::new();
        for seg in self.remote_dir.split('/').filter(|s| !s.is_empty()) {
            built.push(seg);
            let target = self.join_url(&built, true);
            let res = self
                .send_raw(mkcol.clone(), target, None, &[], Some(META_TIMEOUT))
                .await?;
            let status = res.status();
            if status == StatusCode::FORBIDDEN {
                return Err(self.diagnose_forbidden().await);
            }
            if status == StatusCode::CONFLICT {
                let dir = if self.base.path().is_empty() {
                    "/"
                } else {
                    self.base.path()
                };
                return Err(DavError::Http {
                    status: 409,
                    message: format!(
                        "Parent folder {dir} does not exist on the WebDAV server (HTTP 409): create it first or adjust the server URL"
                    ),
                });
            }
            // 2xx = created, 405 = already exists
            if !status.is_success() && status != StatusCode::METHOD_NOT_ALLOWED {
                return Err(DavError::Http {
                    status: status.as_u16(),
                    message: format!("creating remote folder {} failed", self.remote_dir),
                });
            }
        }
        Ok(())
    }

    /// Disambiguate HTTP 403 between missing base folder, missing app dir permissions, and quota exhaustion (Nutstore #4927).
    async fn diagnose_forbidden(&self) -> DavError {
        let dir = if self.base.path().is_empty() {
            "/"
        } else {
            self.base.path()
        };
        let Ok(propfind) = Method::from_bytes(b"PROPFIND") else {
            return DavError::Forbidden(format!("access denied to {dir}"));
        };
        let base_probe_url = self.join_url(&[], true);
        match self
            .send_raw(
                propfind,
                base_probe_url,
                None,
                &[("Depth", "0")],
                Some(META_TIMEOUT),
            )
            .await
        {
            Err(DavError::Unauthorized) => DavError::Unauthorized,
            Ok(res) => {
                let st = res.status();
                if matches!(
                    st,
                    StatusCode::NOT_FOUND | StatusCode::CONFLICT | StatusCode::GONE
                ) {
                    DavError::Forbidden(format!(
                        "folder {dir} does not exist on the WebDAV server: create it first or adjust the URL"
                    ))
                } else if st.is_success() {
                    if !self.dir_exists(&self.dir_url()).await {
                        DavError::Forbidden(format!(
                            "server does not allow creating folder {}/{} — create '{}' on the server first",
                            dir.trim_end_matches('/'),
                            self.remote_dir,
                            self.remote_dir
                        ))
                    } else {
                        DavError::Forbidden(format!(
                            "server denied writing to {}/{} — check write permissions and whether the account's storage or monthly upload quota is exhausted",
                            dir.trim_end_matches('/'),
                            self.remote_dir
                        ))
                    }
                } else {
                    DavError::Forbidden(format!(
                        "account does not have access to {dir} (probe HTTP {})",
                        st.as_u16()
                    ))
                }
            }
            Err(_) => DavError::Forbidden(format!(
                "folder {dir} may not exist or the account lacks permission"
            )),
        }
    }

    /// Alist / OpenList root detection: `PROPFIND Depth: 1` on base URL extracts up to 5 child collections.
    async fn diagnose_nowhere(&self, code: u16) -> DavError {
        let dir = if self.base.path().is_empty() {
            "/"
        } else {
            self.base.path()
        };
        let (children, probe_status) = self.list_child_collections(5).await;
        if matches!(probe_status, Some(404 | 409 | 410)) {
            return DavError::Nowhere {
                status: code,
                message: format!(
                    "Folder {dir} does not exist on the WebDAV server (HTTP {code}): create it first or adjust the URL"
                ),
                suggested_url: None,
            };
        }
        let mut message = format!(
            "WebDAV server cannot create folder '{}' inside {} (HTTP {code}): point the URL to a writable directory",
            self.remote_dir, dir
        );
        let suggested_url = if let Some(first) = children.first() {
            let suggestion = self.join_url(&[first], true).to_string();
            message.push_str(&format!(
                " — detected storages ({}), try {}",
                children.join(", "),
                suggestion
            ));
            Some(suggestion)
        } else {
            None
        };
        DavError::Nowhere {
            status: code,
            message,
            suggested_url,
        }
    }

    async fn list_child_collections(&self, max_count: usize) -> (Vec<String>, Option<u16>) {
        let Ok(propfind) = Method::from_bytes(b"PROPFIND") else {
            return (Vec::new(), None);
        };
        let base_url = self.join_url(&[], true);
        let Ok(res) = self
            .send_raw(
                propfind,
                base_url,
                None,
                &[("Depth", "1")],
                Some(META_TIMEOUT),
            )
            .await
        else {
            return (Vec::new(), None);
        };
        let status = res.status().as_u16();
        if res.status() != StatusCode::MULTI_STATUS {
            return (Vec::new(), Some(status));
        }
        let Ok(body) = res.bytes().await else {
            return (Vec::new(), Some(status));
        };
        let children = parse_propfind_child_collections(&body, self.base.path(), max_count);
        (children, Some(status))
    }

    /// Live `PROPFIND Depth: 0` + auth verification + remote file existence check + actionable suggestions.
    pub async fn test_connection(&self) -> WebDavTestResult {
        let started = Instant::now();
        let suggested_vendor_url = suggest_vendor_url(&self.base);

        let Ok(propfind) = Method::from_bytes(b"PROPFIND") else {
            return WebDavTestResult {
                ok: false,
                status_code: None,
                message: "Internal error constructing PROPFIND method".to_string(),
                remote_file_exists: false,
                suggested_url: suggested_vendor_url,
                latency_ms: started.elapsed().as_millis() as u64,
            };
        };

        let base_url = self.join_url(&[], true);
        let res = match self
            .send_raw(
                propfind.clone(),
                base_url,
                None,
                &[("Depth", "0")],
                Some(META_TIMEOUT),
            )
            .await
        {
            Ok(r) => r,
            Err(DavError::Unauthorized) => {
                return WebDavTestResult {
                    ok: false,
                    status_code: Some(401),
                    message: "Authentication failed (HTTP 401): check username and app password"
                        .to_string(),
                    remote_file_exists: false,
                    suggested_url: suggested_vendor_url,
                    latency_ms: started.elapsed().as_millis() as u64,
                };
            }
            Err(DavError::RateLimited { status, retry_after }) => {
                let extra = retry_after
                    .map(|d| format!(" (retry after {}s)", d.as_secs()))
                    .unwrap_or_default();
                return WebDavTestResult {
                    ok: false,
                    status_code: Some(status),
                    message: format!("Server is rate-limiting requests (HTTP {status}){extra}"),
                    remote_file_exists: false,
                    suggested_url: suggested_vendor_url,
                    latency_ms: started.elapsed().as_millis() as u64,
                };
            }
            Err(e) => {
                return WebDavTestResult {
                    ok: false,
                    status_code: None,
                    message: format!("Connection failed: {e}"),
                    remote_file_exists: false,
                    suggested_url: suggested_vendor_url,
                    latency_ms: started.elapsed().as_millis() as u64,
                };
            }
        };

        let status = res.status();
        let status_code = Some(status.as_u16());

        if status == StatusCode::FORBIDDEN {
            let err = self.diagnose_forbidden().await;
            return WebDavTestResult {
                ok: false,
                status_code,
                message: err.to_string(),
                remote_file_exists: false,
                suggested_url: suggested_vendor_url,
                latency_ms: started.elapsed().as_millis() as u64,
            };
        }

        if !status.is_success() {
            let mut suggested = suggested_vendor_url;
            if matches!(status, StatusCode::NOT_FOUND | StatusCode::CONFLICT) && suggested.is_none()
            {
                let (children, _) = self.list_child_collections(5).await;
                if let Some(first) = children.first() {
                    suggested = Some(self.join_url(&[first], true).to_string());
                }
            }
            let message = if status == StatusCode::METHOD_NOT_ALLOWED {
                format!(
                    "Server rejected PROPFIND (HTTP 405): {} may be a web page instead of a WebDAV endpoint",
                    self.base_url_str()
                )
            } else {
                format!(
                    "WebDAV server returned HTTP {} for {}",
                    status.as_u16(),
                    self.base_url_str()
                )
            };
            return WebDavTestResult {
                ok: false,
                status_code,
                message,
                remote_file_exists: false,
                suggested_url: suggested,
                latency_ms: started.elapsed().as_millis() as u64,
            };
        }

        // Guard against web pages that return 200 OK HTML to PROPFIND
        let body = res.bytes().await.unwrap_or_default();
        let lower_head = String::from_utf8_lossy(&body[..body.len().min(512)]).to_ascii_lowercase();
        if lower_head.contains("<html") || lower_head.contains("<!doctype html") {
            return WebDavTestResult {
                ok: false,
                status_code,
                message: "Server returned an HTML web page instead of a WebDAV Multi-Status response. Use the provider's WebDAV endpoint URL."
                    .to_string(),
                remote_file_exists: false,
                suggested_url: suggested_vendor_url,
                latency_ms: started.elapsed().as_millis() as u64,
            };
        }

        // Check if remote backup file already exists
        let remote_file_exists = match self
            .send_raw(
                propfind,
                self.file_url(),
                None,
                &[("Depth", "0")],
                Some(META_TIMEOUT),
            )
            .await
        {
            Ok(file_res) => file_res.status().is_success(),
            Err(_) => false,
        };

        let latency_ms = started.elapsed().as_millis() as u64;
        let message = if remote_file_exists {
            format!(
                "Connected ({}ms) — existing DeskTag backup found at {}",
                latency_ms,
                self.remote_rel_path()
            )
        } else {
            format!(
                "Connected ({}ms) — ready to initialize sync in {}/",
                latency_ms, self.remote_dir
            )
        };

        WebDavTestResult {
            ok: true,
            status_code,
            message,
            remote_file_exists,
            suggested_url: suggested_vendor_url,
            latency_ms,
        }
    }
}

fn suggest_vendor_url(base: &Url) -> Option<String> {
    let host = base.host_str()?.to_ascii_lowercase();
    let path = base.path().to_ascii_lowercase();
    if host.contains("jianguoyun.com") && (host != "dav.jianguoyun.com" || !path.starts_with("/dav"))
    {
        return Some("https://dav.jianguoyun.com/dav/".to_string());
    }
    None
}

fn request_uri(url: &Url) -> String {
    match url.query() {
        Some(q) => format!("{}?{q}", url.path()),
        None => url.path().to_string(),
    }
}

fn urls_differ(requested: &Url, final_url: &Url) -> bool {
    requested.scheme() != final_url.scheme()
        || requested.host_str() != final_url.host_str()
        || requested.port_or_known_default() != final_url.port_or_known_default()
        || requested.path().trim_end_matches('/') != final_url.path().trim_end_matches('/')
}

fn header_str(headers: &HeaderMap, name: HeaderName) -> Option<&str> {
    headers.get(name)?.to_str().ok().map(str::trim)
}

fn check_rate_limit(status: StatusCode, headers: &HeaderMap) -> Option<DavError> {
    if status == StatusCode::TOO_MANY_REQUESTS || status == StatusCode::SERVICE_UNAVAILABLE {
        let retry_after = header_str(headers, RETRY_AFTER).and_then(parse_retry_after);
        return Some(DavError::RateLimited {
            status: status.as_u16(),
            retry_after,
        });
    }
    None
}

// Keep unused imports clean (IF_MODIFIED_SINCE / IF_NONE_MATCH referenced via str names in RemoteVersion)
const _: (&HeaderName, &HeaderName) = (&IF_NONE_MATCH, &IF_MODIFIED_SINCE);
