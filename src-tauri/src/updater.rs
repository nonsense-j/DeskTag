//! Lightweight native GitHub Releases update checker & installer for DeskTag.
//!
//! Design goals:
//! - Zero extra Cargo crates (reuses `reqwest` with `rustls-tls` + `stream` + desktop `system-proxy`,
//!   `sha2`, `hex`, `serde_json`, `tauri-plugin-opener`).
//! - Primary endpoint: `https://github.com/nonsense-j/DeskTag/releases/latest/download/latest.json`
//!   (served via GitHub release CDN redirect with zero REST API rate-limit pressure).
//! - Automatic fallback: `https://api.github.com/repos/nonsense-j/DeskTag/releases/latest` +
//!   `SHA256SUMS.txt` when `latest.json` is unavailable.
//! - Strict HTTPS + GitHub host allowlist on initial URLs and every redirect hop in production.
//! - First-class support for Windows Standalone (`.exe` in-place NTFS `.old` swap + relaunch without
//!   spawning `cmd.exe`/`powershell.exe`), Windows NSIS (`-setup.exe`), Windows MSI (`.msi`),
//!   macOS (`aarch64`/`x64` `.dmg`), and Android (`.apk`).

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

use reqwest::header::{HeaderValue, ACCEPT};
use reqwest::redirect::Policy;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;
#[cfg(any(target_os = "windows", target_os = "macos", test))]
use uuid::Uuid;

use crate::models::{
    now_iso, InstallKind, UpdateAsset, UpdateCheckResult, UpdateDownloadProgress,
    UpdateInstallResult,
};
use crate::storage::StorageManager;

pub const GITHUB_OWNER: &str = "nonsense-j";
pub const GITHUB_REPO: &str = "DeskTag";
pub const LATEST_MANIFEST_URL: &str =
    "https://github.com/nonsense-j/DeskTag/releases/latest/download/latest.json";
pub const GITHUB_API_LATEST_URL: &str =
    "https://api.github.com/repos/nonsense-j/DeskTag/releases/latest";
pub const RELEASES_PAGE_URL: &str = "https://github.com/nonsense-j/DeskTag/releases";

pub const UPDATE_PROGRESS_EVENT: &str = "desktag://update-progress";
pub const CLEANUP_OLD_EXE_FLAG: &str = "--cleanup-old-exe";

const MANIFEST_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MANIFEST_TOTAL_TIMEOUT: Duration = Duration::from_secs(15);
const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const DOWNLOAD_READ_TIMEOUT: Duration = Duration::from_secs(60);
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(100);

const MAX_MANIFEST_BYTES: usize = 256 * 1024;
const MAX_CHECKSUMS_BYTES: usize = 128 * 1024;
const MAX_DOWNLOAD_BYTES: u64 = 200 * 1024 * 1024;
const MAX_REDIRECTS: usize = 10;

const ALLOWED_GITHUB_HOSTS: &[&str] = &[
    "github.com",
    "api.github.com",
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com",
    "github-releases.githubusercontent.com",
];

// ---------------------------------------------------------------------------
// SemVer 2.0.0 Parsing & Comparison
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreIdent {
    Numeric(u64),
    AlphaNum(String),
}

impl Ord for PreIdent {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (PreIdent::Numeric(a), PreIdent::Numeric(b)) => a.cmp(b),
            (PreIdent::Numeric(_), PreIdent::AlphaNum(_)) => Ordering::Less,
            (PreIdent::AlphaNum(_), PreIdent::Numeric(_)) => Ordering::Greater,
            (PreIdent::AlphaNum(a), PreIdent::AlphaNum(b)) => a.cmp(b),
        }
    }
}

impl PartialOrd for PreIdent {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemVer {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    pub pre: Vec<PreIdent>,
}

impl Ord for SemVer {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.major, self.minor, self.patch)
            .cmp(&(other.major, other.minor, other.patch))
            .then_with(|| match (self.pre.is_empty(), other.pre.is_empty()) {
                (true, true) => Ordering::Equal,
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                (false, false) => self.pre.cmp(&other.pre),
            })
    }
}

impl PartialOrd for SemVer {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Normalize a version tag by trimming whitespace and stripping a leading `v`/`V`.
pub fn normalize_version(raw: &str) -> String {
    raw.trim()
        .trim_start_matches(['v', 'V'])
        .trim()
        .to_string()
}

/// Parse a SemVer string such as `v1.0.2`, `1.10.0`, or `1.2.0-beta.1+build`.
pub fn parse_semver(raw: &str) -> Option<SemVer> {
    let stripped = normalize_version(raw);
    if stripped.is_empty() {
        return None;
    }
    let without_build = stripped.split('+').next().unwrap_or("");
    let (core, pre_str) = match without_build.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (without_build, None),
    };

    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }
    let major = parts[0].parse::<u64>().ok()?;
    let minor = parts[1].parse::<u64>().ok()?;
    let patch = if parts.len() == 3 {
        parts[2].parse::<u64>().ok()?
    } else {
        0
    };

    let mut pre = Vec::new();
    if let Some(p) = pre_str {
        if p.is_empty() {
            return None;
        }
        for ident in p.split('.') {
            if ident.is_empty() {
                return None;
            }
            if ident.bytes().all(|b| b.is_ascii_digit()) {
                pre.push(PreIdent::Numeric(ident.parse::<u64>().ok()?));
            } else {
                pre.push(PreIdent::AlphaNum(ident.to_string()));
            }
        }
    }

    Some(SemVer {
        major,
        minor,
        patch,
        pre,
    })
}

/// Returns `true` iff `candidate` is strictly newer than `current` according to SemVer 2.0.0.
pub fn is_newer_version(current: &str, candidate: &str) -> bool {
    match (parse_semver(current), parse_semver(candidate)) {
        (Some(cur), Some(cand)) => cand > cur,
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Host Allowlist & URL Validation
// ---------------------------------------------------------------------------

/// Validate that a URL is strictly HTTPS without embedded credentials and targets an
/// official GitHub release host.
pub fn is_allowed_github_url(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    ALLOWED_GITHUB_HOSTS
        .iter()
        .any(|allowed| host.eq_ignore_ascii_case(allowed))
}

/// Validate an initial release download URL: must be HTTPS under
/// `https://github.com/nonsense-j/DeskTag/releases/...`.
pub fn validate_release_download_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|e| format!("无效的下载链接: {e}"))?;
    if !is_allowed_github_url(&url) {
        return Err("下载链接域名不在受信任的 GitHub 白名单内".to_string());
    }
    let host = url.host_str().unwrap_or("");
    let expected_prefix = format!("/{GITHUB_OWNER}/{GITHUB_REPO}/releases/").to_ascii_lowercase();
    if !host.eq_ignore_ascii_case("github.com")
        || !url.path().to_ascii_lowercase().starts_with(&expected_prefix)
    {
        return Err("下载链接必须指向 nonsense-j/DeskTag 的 GitHub Releases".to_string());
    }
    Ok(url)
}

/// Ensure a browser release page URL belongs to this repository's GitHub Releases;
/// falls back safely to `RELEASES_PAGE_URL` otherwise.
pub fn sanitize_release_page_url(raw: &str) -> String {
    if let Ok(url) = Url::parse(raw.trim()) {
        if is_allowed_github_url(&url) {
            let host = url.host_str().unwrap_or("");
            let expected_prefix =
                format!("/{GITHUB_OWNER}/{GITHUB_REPO}/releases").to_ascii_lowercase();
            if host.eq_ignore_ascii_case("github.com")
                && url.path().to_ascii_lowercase().starts_with(&expected_prefix)
            {
                return url.to_string();
            }
        }
    }
    RELEASES_PAGE_URL.to_string()
}

#[cfg(test)]
fn is_loopback_http_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost") | Some("::1"))
}

#[cfg(not(test))]
fn is_loopback_http_url(_url: &Url) -> bool {
    false
}

fn validate_download_url_for_mode(raw: &str, allow_loopback_http: bool) -> Result<Url, String> {
    if allow_loopback_http {
        let url = Url::parse(raw.trim()).map_err(|e| format!("无效的下载链接: {e}"))?;
        if is_loopback_http_url(&url) {
            return Ok(url);
        }
    }
    validate_release_download_url(raw)
}

fn build_http_client(
    connect_timeout: Duration,
    total_timeout: Option<Duration>,
    read_timeout: Option<Duration>,
    allow_loopback_http: bool,
) -> Result<Client, String> {
    let policy = Policy::custom(move |attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("too many redirects");
        }
        if allow_loopback_http && is_loopback_http_url(attempt.url()) {
            return attempt.follow();
        }
        if is_allowed_github_url(attempt.url()) {
            attempt.follow()
        } else {
            attempt.error("blocked redirect to untrusted host or non-HTTPS URL")
        }
    });

    let mut builder = Client::builder()
        .connect_timeout(connect_timeout)
        .redirect(policy)
        .user_agent(format!("DeskTag/{}", env!("CARGO_PKG_VERSION")));

    if let Some(t) = total_timeout {
        builder = builder.timeout(t);
    }
    if let Some(rt) = read_timeout {
        builder = builder.read_timeout(rt);
    }

    builder
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败: {e}"))
}

// ---------------------------------------------------------------------------
// InstallKind Detection
// ---------------------------------------------------------------------------

/// Detect the current installation/package format so DeskTag downloads the matching asset.
pub fn detect_install_kind() -> InstallKind {
    #[cfg(target_os = "windows")]
    {
        let exe = std::env::current_exe().unwrap_or_default();
        let has_uninstall = exe
            .parent()
            .map(|dir| dir.join("uninstall.exe").is_file())
            .unwrap_or(false);
        let mut program_files_dirs = Vec::new();
        for key in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(val) = std::env::var(key) {
                if !val.trim().is_empty() {
                    program_files_dirs.push(PathBuf::from(val));
                }
            }
        }
        detect_install_kind_for_windows_path(&exe, has_uninstall, &program_files_dirs)
    }
    #[cfg(target_os = "macos")]
    {
        #[cfg(target_arch = "aarch64")]
        {
            InstallKind::MacosArm64
        }
        #[cfg(not(target_arch = "aarch64"))]
        {
            InstallKind::MacosX64
        }
    }
    #[cfg(target_os = "android")]
    {
        InstallKind::AndroidArm64
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "android")))]
    {
        InstallKind::Linux
    }
}

/// Pure, testable Windows install-mode classifier:
/// - NSIS installs always place `uninstall.exe` beside `desktag.exe`.
/// - MSI installs place `desktag.exe` under `Program Files` / `Program Files (x86)`.
/// - Everything else (e.g. `DeskTag_*_x64-standalone.exe` in Downloads/Desktop/Tools) is Standalone.
pub fn detect_install_kind_for_windows_path(
    exe_path: &Path,
    has_uninstall_sibling: bool,
    program_files_dirs: &[PathBuf],
) -> InstallKind {
    if has_uninstall_sibling {
        return InstallKind::WindowsNsis;
    }
    let exe_norm = normalize_win_path_str(exe_path);
    for dir in program_files_dirs {
        let mut dir_norm = normalize_win_path_str(dir);
        if dir_norm.is_empty() {
            continue;
        }
        if !dir_norm.ends_with('/') {
            dir_norm.push('/');
        }
        if exe_norm.starts_with(&dir_norm) {
            return InstallKind::WindowsMsi;
        }
    }
    InstallKind::WindowsStandalone
}

fn normalize_win_path_str(p: &Path) -> String {
    p.to_string_lossy()
        .replace('\\', "/")
        .trim_start_matches("//?/")
        .to_ascii_lowercase()
}

pub fn manifest_key_for_install_kind(kind: InstallKind) -> Option<&'static str> {
    match kind {
        InstallKind::WindowsStandalone => Some("windows-x86_64-standalone"),
        InstallKind::WindowsNsis => Some("windows-x86_64-nsis"),
        InstallKind::WindowsMsi => Some("windows-x86_64-msi"),
        InstallKind::MacosArm64 => Some("macos-aarch64"),
        InstallKind::MacosX64 => Some("macos-x86_64"),
        InstallKind::AndroidArm64 => Some("android-arm64"),
        InstallKind::Linux => None,
    }
}

// ---------------------------------------------------------------------------
// Manifest (`latest.json`), GitHub Releases API & `SHA256SUMS.txt` Parsing
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestManifestAsset {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestManifest {
    pub version: String,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub pub_date: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub release_url: Option<String>,
    #[serde(default)]
    pub assets: BTreeMap<String, LatestManifestAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubReleasePayload {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    assets: Vec<GitHubReleaseAsset>,
}

/// Parse a `SHA256SUMS.txt` file into a map of `filename -> lowercase 64-hex digest`.
pub fn parse_sha256_sums(text: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let Some(digest_raw) = parts.next() else {
            continue;
        };
        let Some(name_raw) = parts.next() else {
            continue;
        };
        let digest = digest_raw.to_ascii_lowercase();
        if digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit()) {
            let name = name_raw.trim_start_matches('*').to_string();
            if !name.is_empty() {
                map.insert(name, digest);
            }
        }
    }
    map
}

fn normalize_sha256(raw: Option<String>) -> Option<String> {
    raw.and_then(|s| {
        let lower = s.trim().to_ascii_lowercase();
        if lower.len() == 64 && lower.bytes().all(|b| b.is_ascii_hexdigit()) {
            Some(lower)
        } else {
            None
        }
    })
}

fn match_github_asset_for_kind(
    assets: &[GitHubReleaseAsset],
    kind: InstallKind,
    checksums: &BTreeMap<String, String>,
    allow_loopback_http: bool,
) -> Option<UpdateAsset> {
    let matched = assets.iter().find(|asset| {
        let low = asset.name.to_ascii_lowercase();
        match kind {
            InstallKind::WindowsStandalone => low.ends_with("-standalone.exe"),
            InstallKind::WindowsNsis => low.ends_with("-setup.exe"),
            InstallKind::WindowsMsi => low.ends_with(".msi"),
            InstallKind::MacosArm64 => low.ends_with("_aarch64.dmg") || low.ends_with("_arm64.dmg"),
            InstallKind::MacosX64 => low.ends_with("_x64.dmg") || low.ends_with("_x86_64.dmg"),
            InstallKind::AndroidArm64 => low.ends_with(".apk"),
            InstallKind::Linux => false,
        }
    })?;

    if validate_download_url_for_mode(&matched.browser_download_url, allow_loopback_http).is_err() {
        return None;
    }

    Some(UpdateAsset {
        name: matched.name.clone(),
        url: matched.browser_download_url.clone(),
        size: matched.size,
        sha256: checksums.get(&matched.name).cloned(),
    })
}

async fn read_bounded_bytes(
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("读取响应数据失败: {e}"))?
    {
        if buf.len().saturating_add(chunk.len()) > max_bytes {
            return Err(format!("响应体积超过上限 ({max_bytes} 字节)"));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

fn build_result_from_manifest(
    manifest: LatestManifest,
    current_version: &str,
    install_kind: InstallKind,
    skipped_version: Option<&str>,
    force: bool,
    allow_loopback_http: bool,
) -> Result<UpdateCheckResult, String> {
    let latest_version = normalize_version(&manifest.version);
    if parse_semver(&latest_version).is_none() {
        return Err(format!("latest.json 中的版本号格式无效: {}", manifest.version));
    }

    let has_update = is_newer_version(current_version, &latest_version);
    let skipped = has_update
        && !force
        && skipped_version
            .map(|s| normalize_version(s) == latest_version)
            .unwrap_or(false);

    let recommended_asset = manifest_key_for_install_kind(install_kind)
        .and_then(|key| manifest.assets.get(key))
        .filter(|a| validate_download_url_for_mode(&a.url, allow_loopback_http).is_ok())
        .map(|a| UpdateAsset {
            name: a.name.clone(),
            url: a.url.clone(),
            size: a.size,
            sha256: normalize_sha256(a.sha256.clone()),
        });

    let tag = manifest
        .tag
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("v{latest_version}"));
    let release_name = manifest
        .name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("DeskTag {tag}"));
    let release_url = manifest
        .release_url
        .as_deref()
        .map(sanitize_release_page_url)
        .unwrap_or_else(|| format!("{RELEASES_PAGE_URL}/tag/{tag}"));

    Ok(UpdateCheckResult {
        current_version: normalize_version(current_version),
        latest_version,
        has_update,
        skipped,
        release_name,
        release_notes: manifest.notes.unwrap_or_default(),
        published_at: manifest.pub_date,
        release_url,
        install_kind,
        recommended_asset,
        checked_at: now_iso(),
        source: "latest_json".to_string(),
    })
}

async fn fetch_update_info(
    current_version: &str,
    install_kind: InstallKind,
    skipped_version: Option<&str>,
    force: bool,
    manifest_url: &str,
    github_api_url: &str,
    allow_loopback_http: bool,
) -> Result<UpdateCheckResult, String> {
    let client = build_http_client(
        MANIFEST_CONNECT_TIMEOUT,
        Some(MANIFEST_TOTAL_TIMEOUT),
        None,
        allow_loopback_http,
    )?;

    // 1. Primary: CDN-backed `latest.json` (no GitHub REST API rate limit).
    let primary_err: String = match client
        .get(manifest_url)
        .header(ACCEPT, HeaderValue::from_static("application/json"))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            match read_bounded_bytes(resp, MAX_MANIFEST_BYTES).await {
                Ok(bytes) => match serde_json::from_slice::<LatestManifest>(&bytes) {
                    Ok(manifest) => {
                        match build_result_from_manifest(
                            manifest,
                            current_version,
                            install_kind,
                            skipped_version,
                            force,
                            allow_loopback_http,
                        ) {
                            Ok(res) => return Ok(res),
                            Err(e) => e,
                        }
                    }
                    Err(e) => format!("解析 latest.json 失败: {e}"),
                },
                Err(e) => e,
            }
        }
        Ok(resp) => format!("latest.json 返回 HTTP {}", resp.status().as_u16()),
        Err(e) => e.to_string(),
    };

    // 2. Fallback: GitHub Releases REST API + optional `SHA256SUMS.txt`.
    let api_resp = client
        .get(github_api_url)
        .header(
            ACCEPT,
            HeaderValue::from_static("application/vnd.github+json"),
        )
        .header("X-GitHub-Api-Version", HeaderValue::from_static("2022-11-28"))
        .send()
        .await
        .map_err(|e| {
            format!("无法连接到 GitHub 检查更新，请检查网络或代理设置: {e}（主清单: {primary_err}）")
        })?;

    let status = api_resp.status();
    if status == StatusCode::FORBIDDEN || status == StatusCode::TOO_MANY_REQUESTS {
        return Err(
            "GitHub API 请求频率受限，请稍后重试或直接前往 GitHub 发布页查看最新版本".to_string(),
        );
    }
    if !status.is_success() {
        return Err(format!(
            "检查更新失败：GitHub 返回 HTTP {}",
            status.as_u16()
        ));
    }

    let bytes = read_bounded_bytes(api_resp, MAX_MANIFEST_BYTES).await?;
    let payload: GitHubReleasePayload =
        serde_json::from_slice(&bytes).map_err(|e| format!("解析 GitHub Release 数据失败: {e}"))?;

    if payload.draft {
        return Err("最新 GitHub Release 为草稿状态，暂不可用".to_string());
    }

    let latest_version = normalize_version(&payload.tag_name);
    if parse_semver(&latest_version).is_none() {
        return Err(format!(
            "GitHub Release 标签版本号格式无效: {}",
            payload.tag_name
        ));
    }

    // Best-effort fetch of `SHA256SUMS.txt` so fallback downloads still verify SHA-256.
    let mut checksums = BTreeMap::new();
    if let Some(sums_asset) = payload
        .assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("SHA256SUMS.txt"))
    {
        if validate_download_url_for_mode(&sums_asset.browser_download_url, allow_loopback_http)
            .is_ok()
        {
            if let Ok(sums_resp) = client.get(&sums_asset.browser_download_url).send().await {
                if sums_resp.status().is_success() {
                    if let Ok(sums_bytes) = read_bounded_bytes(sums_resp, MAX_CHECKSUMS_BYTES).await
                    {
                        if let Ok(sums_text) = String::from_utf8(sums_bytes) {
                            checksums = parse_sha256_sums(&sums_text);
                        }
                    }
                }
            }
        }
    }

    let has_update = is_newer_version(current_version, &latest_version);
    let skipped = has_update
        && !force
        && skipped_version
            .map(|s| normalize_version(s) == latest_version)
            .unwrap_or(false);

    let recommended_asset = match_github_asset_for_kind(
        &payload.assets,
        install_kind,
        &checksums,
        allow_loopback_http,
    );

    let release_name = payload
        .name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("DeskTag {}", payload.tag_name));
    let release_url = payload
        .html_url
        .as_deref()
        .map(sanitize_release_page_url)
        .unwrap_or_else(|| format!("{RELEASES_PAGE_URL}/tag/{}", payload.tag_name));

    Ok(UpdateCheckResult {
        current_version: normalize_version(current_version),
        latest_version,
        has_update,
        skipped,
        release_name,
        release_notes: payload.body.unwrap_or_default(),
        published_at: payload.published_at,
        release_url,
        install_kind,
        recommended_asset,
        checked_at: now_iso(),
        source: "github_api".to_string(),
    })
}

/// Check GitHub Releases for a newer DeskTag version and update `device.last_update_check_at`.
pub async fn check_for_update(
    storage: &StorageManager,
    force: bool,
) -> Result<UpdateCheckResult, String> {
    let mut device = storage.load_device_settings();
    let install_kind = detect_install_kind();
    let current_version = env!("CARGO_PKG_VERSION");

    let result = fetch_update_info(
        current_version,
        install_kind,
        device.skipped_update_version.as_deref(),
        force,
        LATEST_MANIFEST_URL,
        GITHUB_API_LATEST_URL,
        false,
    )
    .await?;

    device.last_update_check_at = Some(result.checked_at.clone());
    let _ = storage.save_device_settings(&device);

    Ok(result)
}

// ---------------------------------------------------------------------------
// Streaming Download & SHA-256 Verification
// ---------------------------------------------------------------------------

fn sanitize_asset_filename(raw: &str) -> Result<String, String> {
    let name = Path::new(raw)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':')
    {
        return Err(format!("安装包文件名无效: {raw}"));
    }
    Ok(name.to_string())
}

#[allow(dead_code)]
async fn download_and_verify_to_path<F>(
    client: &Client,
    url: &Url,
    part_path: &Path,
    expected_sha256: Option<&str>,
    fallback_total_bytes: Option<u64>,
    mut on_progress: F,
) -> Result<u64, String>
where
    F: FnMut(UpdateDownloadProgress),
{
    if let Some(parent) = part_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建下载目录失败: {e}"))?;
    }

    on_progress(UpdateDownloadProgress {
        stage: "downloading".to_string(),
        downloaded_bytes: 0,
        total_bytes: fallback_total_bytes,
        percent: Some(0),
        message: Some("正在连接下载服务器…".to_string()),
    });

    let mut resp = client
        .get(url.clone())
        .send()
        .await
        .map_err(|e| format!("下载更新包失败，请检查网络或代理设置: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "下载更新包失败：服务器返回 HTTP {}",
            resp.status().as_u16()
        ));
    }

    let content_length = resp.content_length();
    let total_bytes = content_length.or(fallback_total_bytes);
    if let Some(total) = total_bytes {
        if total > MAX_DOWNLOAD_BYTES {
            return Err("更新包体积超出安全限制，已取消下载".to_string());
        }
    }

    let mut file =
        File::create(part_path).map_err(|e| format!("创建临时下载文件失败: {e}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();

    let download_res: Result<(), String> = async {
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| format!("下载中断: {e}"))?
        {
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            if downloaded > MAX_DOWNLOAD_BYTES {
                return Err("下载体积超出安全限制，已取消更新".to_string());
            }
            file.write_all(&chunk)
                .map_err(|e| format!("写入更新包失败: {e}"))?;
            hasher.update(&chunk);

            if last_emit.elapsed() >= PROGRESS_EMIT_INTERVAL {
                let percent = total_bytes.and_then(|t| {
                    if t > 0 {
                        Some(((downloaded.saturating_mul(100) / t).min(100)) as u8)
                    } else {
                        None
                    }
                });
                on_progress(UpdateDownloadProgress {
                    stage: "downloading".to_string(),
                    downloaded_bytes: downloaded,
                    total_bytes,
                    percent,
                    message: None,
                });
                last_emit = Instant::now();
            }
        }
        file.flush().map_err(|e| format!("刷新更新包文件失败: {e}"))?;
        let _ = file.sync_all();
        Ok(())
    }
    .await;

    drop(file);

    if let Err(err) = download_res {
        let _ = fs::remove_file(part_path);
        return Err(err);
    }

    if downloaded == 0 {
        let _ = fs::remove_file(part_path);
        return Err("下载到的更新包为空文件，请重试".to_string());
    }

    if let Some(expected_len) = content_length {
        if downloaded != expected_len {
            let _ = fs::remove_file(part_path);
            return Err("更新包下载不完整，请重试".to_string());
        }
    }

    on_progress(UpdateDownloadProgress {
        stage: "verifying".to_string(),
        downloaded_bytes: downloaded,
        total_bytes: Some(downloaded),
        percent: Some(100),
        message: Some("正在校验安装包 SHA-256 完整性…".to_string()),
    });

    if let Some(expected) = expected_sha256 {
        let actual = hex::encode(hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected.trim()) {
            let _ = fs::remove_file(part_path);
            return Err(
                "安装包 SHA-256 校验未通过，已自动删除临时文件，请重试或前往 GitHub 发布页手动下载"
                    .to_string(),
            );
        }
    }

    Ok(downloaded)
}

// ---------------------------------------------------------------------------
// Standalone Target Path & Pre-Init `.old` Cleanup
// ---------------------------------------------------------------------------

/// Compute the target filename when replacing a Windows Standalone executable:
/// - If the user kept the versioned release filename (e.g. `DeskTag_1.0.1_x64-standalone.exe`),
///   adopt the new versioned asset filename (`DeskTag_1.1.0_x64-standalone.exe`) in the same folder.
/// - If the user renamed it (e.g. `DeskTag.exe`), preserve their custom path so shortcuts keep working.
pub fn compute_standalone_target_exe(
    current_exe: &Path,
    current_version: &str,
    _new_version: &str,
    asset_filename: &str,
) -> PathBuf {
    let Some(parent) = current_exe.parent() else {
        return current_exe.to_path_buf();
    };
    let cur_name = current_exe
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let cur_low = cur_name.to_ascii_lowercase();
    let ver_low = normalize_version(current_version).to_ascii_lowercase();

    if cur_low.contains("-standalone.exe")
        && !ver_low.is_empty()
        && cur_low.contains(&ver_low)
        && asset_filename.to_ascii_lowercase().ends_with(".exe")
    {
        parent.join(asset_filename)
    } else {
        current_exe.to_path_buf()
    }
}

pub fn append_old_suffix(exe_path: &Path) -> PathBuf {
    let mut os = exe_path.as_os_str().to_os_string();
    os.push(".old");
    PathBuf::from(os)
}

/// Strictly validate that `candidate` is a safe `.exe.old` cleanup target in the same directory
/// as `current_exe`, preventing `--cleanup-old-exe` from deleting arbitrary files.
pub fn validate_cleanup_target(current_exe: &Path, candidate: &Path) -> Option<PathBuf> {
    if candidate
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return None;
    }

    let cur_dir = current_exe.parent()?;
    let cand_dir = candidate.parent()?;

    let cur_dir_canon = fs::canonicalize(cur_dir).unwrap_or_else(|_| cur_dir.to_path_buf());
    let cand_dir_canon = fs::canonicalize(cand_dir).unwrap_or_else(|_| cand_dir.to_path_buf());
    if normalize_win_path_str(&cur_dir_canon) != normalize_win_path_str(&cand_dir_canon) {
        return None;
    }

    let cand_name = candidate.file_name()?.to_str()?;
    let cand_low = cand_name.to_ascii_lowercase();
    if !cand_low.ends_with(".exe.old") {
        return None;
    }

    let cur_name = current_exe.file_name()?.to_str()?;
    let expected_same_old = format!("{}.old", cur_name.to_ascii_lowercase());
    let allowed_name = cand_low == expected_same_old || cand_low.starts_with("desktag");
    if !allowed_name {
        return None;
    }

    if let Ok(meta) = fs::symlink_metadata(candidate) {
        if meta.file_type().is_symlink() || !meta.is_file() {
            return None;
        }
    }

    Some(cand_dir_canon.join(cand_name))
}

/// Run BEFORE `tauri::Builder` / `tauri-plugin-single-instance` initializes.
///
/// When a Windows Standalone binary restarts into a newly swapped version, the new process is
/// spawned with `--cleanup-old-exe <old.exe.old>`. Polling `fs::remove_file` waits for the old
/// Windows executable image lock (and therefore its single-instance mutex) to be released cleanly
/// without spawning `cmd.exe` or `powershell.exe`.
pub fn handle_startup_cleanup() {
    #[cfg(target_os = "windows")]
    {
        let Ok(current_exe) = std::env::current_exe() else {
            return;
        };

        let mut args = std::env::args_os().skip(1);
        let mut explicit_target: Option<PathBuf> = None;
        while let Some(arg) = args.next() {
            if arg == CLEANUP_OLD_EXE_FLAG {
                if let Some(val) = args.next() {
                    explicit_target = Some(PathBuf::from(val));
                }
                break;
            }
        }

        if let Some(candidate) = explicit_target {
            if let Some(safe_target) = validate_cleanup_target(&current_exe, &candidate) {
                for _ in 0..50 {
                    if !safe_target.exists() {
                        break;
                    }
                    if fs::remove_file(&safe_target).is_ok() {
                        // Brief grace period for OS handle / single-instance pipe teardown.
                        std::thread::sleep(Duration::from_millis(120));
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        }

        // Best-effort sweep of any leftover `desktag*.exe.old` in the same folder.
        if let Some(dir) = current_exe.parent() {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if let Some(safe) = validate_cleanup_target(&current_exe, &path) {
                        let _ = fs::remove_file(safe);
                    }
                }
            }
        }
    }
}

#[allow(dead_code)]
fn temp_update_dir() -> PathBuf {
    std::env::temp_dir().join("DeskTag-update")
}

#[allow(dead_code)]
fn fallback_download_dir() -> PathBuf {
    dirs::download_dir().unwrap_or_else(temp_update_dir)
}

#[allow(dead_code)]
fn emit_progress(app: &AppHandle, progress: UpdateDownloadProgress) {
    let _ = app.emit(UPDATE_PROGRESS_EVENT, &progress);
}

#[cfg(target_os = "windows")]
fn schedule_graceful_exit(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(180)).await;
        handle.exit(0);
    });
}

/// Download, SHA-256 verify, and apply an available update according to the runtime `InstallKind`.
pub async fn download_and_install_update(
    app: &AppHandle,
    update: UpdateCheckResult,
) -> Result<UpdateInstallResult, String> {
    let install_kind = detect_install_kind();
    let safe_release_url = sanitize_release_page_url(&update.release_url);

    // Mobile / Linux or missing platform asset: open trusted download/release URL in browser.
    let Some(asset) = update.recommended_asset.as_ref() else {
        app.opener()
            .open_url(&safe_release_url, None::<&str>)
            .map_err(|e| format!("无法打开下载页面: {e}"))?;
        return Ok(UpdateInstallResult {
            action: "opened_url".to_string(),
            path: None,
            message: "已为你打开 GitHub 发布页，请选择对应安装包下载".to_string(),
        });
    };

    let validated_url = validate_release_download_url(&asset.url)?;
    if matches!(install_kind, InstallKind::AndroidArm64 | InstallKind::Linux) {
        app.opener()
            .open_url(validated_url.as_str(), None::<&str>)
            .map_err(|e| format!("无法打开更新下载链接: {e}"))?;
        return Ok(UpdateInstallResult {
            action: "opened_url".to_string(),
            path: None,
            message: "已跳转到新版本安装包下载链接".to_string(),
        });
    }

    let safe_name = sanitize_asset_filename(&asset.name)?;
    let expected_sha256 = normalize_sha256(asset.sha256.clone());
    let client = build_http_client(
        DOWNLOAD_CONNECT_TIMEOUT,
        None,
        Some(DOWNLOAD_READ_TIMEOUT),
        false,
    )?;

    #[cfg(target_os = "windows")]
    {
        match install_kind {
            InstallKind::WindowsStandalone => {
                let current_exe =
                    std::env::current_exe().map_err(|e| format!("无法定位当前程序路径: {e}"))?;
                let exe_dir = current_exe
                    .parent()
                    .ok_or_else(|| "无法定位当前程序所在目录".to_string())?;

                // Probe whether the standalone exe directory is writable before downloading.
                let probe_part = exe_dir.join(format!(".{safe_name}.{}.part", Uuid::new_v4()));
                let can_replace_in_place = match File::create(&probe_part) {
                    Ok(f) => {
                        drop(f);
                        let _ = fs::remove_file(&probe_part);
                        true
                    }
                    Err(_) => false,
                };

                if !can_replace_in_place {
                    let dl_dir = fallback_download_dir();
                    let part_path = dl_dir.join(format!(".{safe_name}.{}.part", Uuid::new_v4()));
                    let final_path = dl_dir.join(&safe_name);
                    let app_clone = app.clone();
                    if let Err(err) = download_and_verify_to_path(
                        &client,
                        &validated_url,
                        &part_path,
                        expected_sha256.as_deref(),
                        asset.size,
                        |p| emit_progress(&app_clone, p),
                    )
                    .await
                    {
                        emit_progress(
                            app,
                            UpdateDownloadProgress {
                                stage: "error".to_string(),
                                downloaded_bytes: 0,
                                total_bytes: asset.size,
                                percent: None,
                                message: Some(err.clone()),
                            },
                        );
                        return Err(err);
                    }

                    let _ = fs::remove_file(&final_path);
                    fs::rename(&part_path, &final_path).map_err(|e| {
                        let _ = fs::remove_file(&part_path);
                        format!("保存新版本文件失败: {e}")
                    })?;

                    let _ = app.opener().reveal_item_in_dir(&final_path);
                    emit_progress(
                        app,
                        UpdateDownloadProgress {
                            stage: "ready".to_string(),
                            downloaded_bytes: asset.size.unwrap_or(0),
                            total_bytes: asset.size,
                            percent: Some(100),
                            message: Some("新版本已下载完成并打开所在目录".to_string()),
                        },
                    );
                    return Ok(UpdateInstallResult {
                        action: "revealed_in_folder".to_string(),
                        path: Some(final_path.to_string_lossy().to_string()),
                        message: "当前程序目录无写入权限，已将校验通过的新版本下载到下载目录，请关闭旧版后运行新版".to_string(),
                    });
                }

                let part_path = exe_dir.join(format!(".{safe_name}.{}.part", Uuid::new_v4()));
                let app_clone = app.clone();
                if let Err(err) = download_and_verify_to_path(
                    &client,
                    &validated_url,
                    &part_path,
                    expected_sha256.as_deref(),
                    asset.size,
                    |p| emit_progress(&app_clone, p),
                )
                .await
                {
                    emit_progress(
                        app,
                        UpdateDownloadProgress {
                            stage: "error".to_string(),
                            downloaded_bytes: 0,
                            total_bytes: asset.size,
                            percent: None,
                            message: Some(err.clone()),
                        },
                    );
                    return Err(err);
                }

                emit_progress(
                    app,
                    UpdateDownloadProgress {
                        stage: "installing".to_string(),
                        downloaded_bytes: asset.size.unwrap_or(0),
                        total_bytes: asset.size,
                        percent: Some(100),
                        message: Some("正在替换程序并重新启动…".to_string()),
                    },
                );

                let target_exe = compute_standalone_target_exe(
                    &current_exe,
                    env!("CARGO_PKG_VERSION"),
                    &update.latest_version,
                    &safe_name,
                );
                let old_exe = append_old_suffix(&current_exe);
                if old_exe.exists() {
                    let _ = fs::remove_file(&old_exe);
                }

                if let Err(err) = fs::rename(&current_exe, &old_exe) {
                    let _ = fs::remove_file(&part_path);
                    return Err(format!("无法备份旧版本程序以完成原地更新: {err}"));
                }

                if target_exe != current_exe && target_exe.exists() {
                    let _ = fs::remove_file(&target_exe);
                }

                if let Err(err) = fs::rename(&part_path, &target_exe) {
                    let _ = fs::rename(&old_exe, &current_exe);
                    let _ = fs::remove_file(&part_path);
                    return Err(format!("无法写入新版本程序: {err}"));
                }

                if let Err(err) = std::process::Command::new(&target_exe)
                    .arg(CLEANUP_OLD_EXE_FLAG)
                    .arg(&old_exe)
                    .spawn()
                {
                    let _ = fs::rename(&target_exe, &part_path);
                    let _ = fs::rename(&old_exe, &current_exe);
                    let _ = fs::remove_file(&part_path);
                    return Err(format!("新版本启动失败，已自动回滚: {err}"));
                }

                emit_progress(
                    app,
                    UpdateDownloadProgress {
                        stage: "ready".to_string(),
                        downloaded_bytes: asset.size.unwrap_or(0),
                        total_bytes: asset.size,
                        percent: Some(100),
                        message: Some("更新完成，正在重新启动 DeskTag…".to_string()),
                    },
                );
                schedule_graceful_exit(app);

                return Ok(UpdateInstallResult {
                    action: "relaunched".to_string(),
                    path: Some(target_exe.to_string_lossy().to_string()),
                    message: "更新已就绪，DeskTag 正在自动重启…".to_string(),
                });
            }
            InstallKind::WindowsNsis | InstallKind::WindowsMsi => {
                let stage_dir = temp_update_dir();
                let part_path = stage_dir.join(format!(".{safe_name}.{}.part", Uuid::new_v4()));
                let installer_path = stage_dir.join(&safe_name);
                let app_clone = app.clone();
                if let Err(err) = download_and_verify_to_path(
                    &client,
                    &validated_url,
                    &part_path,
                    expected_sha256.as_deref(),
                    asset.size,
                    |p| emit_progress(&app_clone, p),
                )
                .await
                {
                    emit_progress(
                        app,
                        UpdateDownloadProgress {
                            stage: "error".to_string(),
                            downloaded_bytes: 0,
                            total_bytes: asset.size,
                            percent: None,
                            message: Some(err.clone()),
                        },
                    );
                    return Err(err);
                }

                let _ = fs::remove_file(&installer_path);
                fs::rename(&part_path, &installer_path).map_err(|e| {
                    let _ = fs::remove_file(&part_path);
                    format!("准备安装程序失败: {e}")
                })?;

                emit_progress(
                    app,
                    UpdateDownloadProgress {
                        stage: "installing".to_string(),
                        downloaded_bytes: asset.size.unwrap_or(0),
                        total_bytes: asset.size,
                        percent: Some(100),
                        message: Some("正在启动安装程序…".to_string()),
                    },
                );

                let launch_res = if matches!(install_kind, InstallKind::WindowsMsi) {
                    std::process::Command::new("msiexec")
                        .arg("/i")
                        .arg(&installer_path)
                        .spawn()
                } else {
                    std::process::Command::new(&installer_path).spawn()
                };
                if let Err(err) = launch_res {
                    return Err(format!("启动安装程序失败: {err}"));
                }

                emit_progress(
                    app,
                    UpdateDownloadProgress {
                        stage: "ready".to_string(),
                        downloaded_bytes: asset.size.unwrap_or(0),
                        total_bytes: asset.size,
                        percent: Some(100),
                        message: Some("安装程序已启动，DeskTag 即将关闭以完成更新".to_string()),
                    },
                );
                schedule_graceful_exit(app);

                return Ok(UpdateInstallResult {
                    action: "installer_launched".to_string(),
                    path: Some(installer_path.to_string_lossy().to_string()),
                    message: "安装程序已启动，DeskTag 将自动退出以完成升级".to_string(),
                });
            }
            _ => {}
        }
    }

    #[cfg(target_os = "macos")]
    {
        if matches!(install_kind, InstallKind::MacosArm64 | InstallKind::MacosX64) {
            let dl_dir = fallback_download_dir();
            let part_path = dl_dir.join(format!(".{safe_name}.{}.part", Uuid::new_v4()));
            let final_path = dl_dir.join(&safe_name);
            let app_clone = app.clone();
            if let Err(err) = download_and_verify_to_path(
                &client,
                &validated_url,
                &part_path,
                expected_sha256.as_deref(),
                asset.size,
                |p| emit_progress(&app_clone, p),
            )
            .await
            {
                emit_progress(
                    app,
                    UpdateDownloadProgress {
                        stage: "error".to_string(),
                        downloaded_bytes: 0,
                        total_bytes: asset.size,
                        percent: None,
                        message: Some(err.clone()),
                    },
                );
                return Err(err);
            }

            let _ = fs::remove_file(&final_path);
            fs::rename(&part_path, &final_path).map_err(|e| {
                let _ = fs::remove_file(&part_path);
                format!("保存 DMG 安装包失败: {e}")
            })?;

            let _ = app
                .opener()
                .open_path(final_path.to_string_lossy().to_string(), None::<&str>);
            emit_progress(
                app,
                UpdateDownloadProgress {
                    stage: "ready".to_string(),
                    downloaded_bytes: asset.size.unwrap_or(0),
                    total_bytes: asset.size,
                    percent: Some(100),
                    message: Some("安装包已下载并打开".to_string()),
                },
            );
            return Ok(UpdateInstallResult {
                action: "installer_launched".to_string(),
                path: Some(final_path.to_string_lossy().to_string()),
                message: "已下载并打开 DMG 安装包，请将 DeskTag 拖入「应用程序」替换旧版本"
                    .to_string(),
            });
        }
    }

    let _ = (client, safe_name, expected_sha256);
    app.opener()
        .open_url(validated_url.as_str(), None::<&str>)
        .map_err(|e| format!("无法打开下载链接: {e}"))?;
    Ok(UpdateInstallResult {
        action: "opened_url".to_string(),
        path: None,
        message: "已打开新版本下载链接".to_string(),
    })
}

// ---------------------------------------------------------------------------
// Unit & Local HTTP Server Integration Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DeviceSettings;
    use std::io::{Read, Write as IoWrite};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    fn spawn_mock_http_server(
        routes: Vec<(String, u16, String, Vec<u8>)>,
    ) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let addr = listener.local_addr().expect("local_addr");
        let max_requests = routes.len().max(1);
        let handle = std::thread::spawn(move || {
            for _ in 0..max_requests {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                let mut req_buf = [0u8; 4096];
                let n = stream.read(&mut req_buf).unwrap_or(0);
                let req_text = String::from_utf8_lossy(&req_buf[..n]);
                let req_path = req_text
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");

                let matched = routes.iter().find(|(p, _, _, _)| p == req_path);
                let (status, content_type, body) = match matched {
                    Some((_, s, ct, b)) => (*s, ct.as_str(), b.as_slice()),
                    None => (404, "text/plain", b"not found".as_slice()),
                };
                let reason = match status {
                    200 => "OK",
                    403 => "Forbidden",
                    404 => "Not Found",
                    _ => "Error",
                };
                let header = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(body);
                let _ = stream.flush();
            }
        });
        (format!("http://{addr}"), handle)
    }

    #[test]
    fn test_semver_parsing_and_comparison() {
        assert!(is_newer_version("1.0.1", "1.0.2"));
        assert!(is_newer_version("v1.0.1", "v1.1.0"));
        assert!(is_newer_version("1.2.0", "1.10.0"));
        assert!(is_newer_version("1.0.2-beta.1", "1.0.2-beta.2"));
        assert!(is_newer_version("1.0.2-rc.1", "1.0.2"));
        assert!(!is_newer_version("1.0.1", "1.0.1"));
        assert!(!is_newer_version("1.0.1", "v1.0.1+build.42"));
        assert!(!is_newer_version("1.1.0", "1.0.9"));
        assert!(!is_newer_version("1.0.2", "1.0.2-rc.1"));
        assert!(parse_semver("").is_none());
        assert!(parse_semver("not-a-version").is_none());
        assert!(parse_semver("1.0.2-").is_none());
    }

    #[test]
    fn test_host_allowlist_and_download_url_validation() {
        assert!(validate_release_download_url(
            "https://github.com/nonsense-j/DeskTag/releases/download/v1.1.0/DeskTag_1.1.0_x64-standalone.exe"
        )
        .is_ok());
        assert!(validate_release_download_url(
            "http://github.com/nonsense-j/DeskTag/releases/download/v1.1.0/DeskTag_1.1.0_x64-standalone.exe"
        )
        .is_err());
        assert!(validate_release_download_url(
            "https://github.com/evil-user/DeskTag/releases/download/v1.1.0/DeskTag.exe"
        )
        .is_err());
        assert!(validate_release_download_url(
            "https://github.com.evil.example/nonsense-j/DeskTag/releases/download/v1.1.0/DeskTag.exe"
        )
        .is_err());
        assert!(validate_release_download_url(
            "https://user:pass@github.com/nonsense-j/DeskTag/releases/download/v1.1.0/DeskTag.exe"
        )
        .is_err());

        let redirect_ok =
            Url::parse("https://release-assets.githubusercontent.com/some/signed/asset").unwrap();
        assert!(is_allowed_github_url(&redirect_ok));
        let redirect_bad = Url::parse("https://evil.example.com/asset.exe").unwrap();
        assert!(!is_allowed_github_url(&redirect_bad));

        assert_eq!(
            sanitize_release_page_url("https://evil.example.com/phish"),
            RELEASES_PAGE_URL
        );
        assert_eq!(
            sanitize_release_page_url("https://github.com/nonsense-j/DeskTag/releases/tag/v1.1.0"),
            "https://github.com/nonsense-j/DeskTag/releases/tag/v1.1.0"
        );
    }

    #[test]
    fn test_windows_install_kind_detection() {
        let pf = vec![
            PathBuf::from(r"C:\Program Files"),
            PathBuf::from(r"C:\Program Files (x86)"),
        ];
        assert_eq!(
            detect_install_kind_for_windows_path(
                Path::new(r"C:\Users\Alice\AppData\Local\DeskTag\desktag.exe"),
                true,
                &pf
            ),
            InstallKind::WindowsNsis
        );
        assert_eq!(
            detect_install_kind_for_windows_path(
                Path::new(r"C:\Program Files\DeskTag\desktag.exe"),
                false,
                &pf
            ),
            InstallKind::WindowsMsi
        );
        assert_eq!(
            detect_install_kind_for_windows_path(
                Path::new(r"D:\Tools\DeskTag_1.0.1_x64-standalone.exe"),
                false,
                &pf
            ),
            InstallKind::WindowsStandalone
        );
    }

    #[test]
    fn test_standalone_target_exe_naming() {
        let versioned = Path::new(r"C:\Downloads\DeskTag_1.0.1_x64-standalone.exe");
        assert_eq!(
            compute_standalone_target_exe(
                versioned,
                "1.0.1",
                "1.1.0",
                "DeskTag_1.1.0_x64-standalone.exe"
            ),
            PathBuf::from(r"C:\Downloads\DeskTag_1.1.0_x64-standalone.exe")
        );

        let custom = Path::new(r"D:\Portable\MyDeskTag.exe");
        assert_eq!(
            compute_standalone_target_exe(
                custom,
                "1.0.1",
                "1.1.0",
                "DeskTag_1.1.0_x64-standalone.exe"
            ),
            PathBuf::from(r"D:\Portable\MyDeskTag.exe")
        );
    }

    #[test]
    fn test_sha256sums_parsing() {
        let h1 = "a".repeat(64);
        let h2 = "B".repeat(64);
        let sample = format!(
            "# comment\n{h1}  DeskTag_1.1.0_x64-standalone.exe\n{h2} *DeskTag_1.1.0_x64-setup.exe\ninvalid line\n"
        );
        let map = parse_sha256_sums(&sample);
        assert_eq!(
            map.get("DeskTag_1.1.0_x64-standalone.exe").map(String::as_str),
            Some(h1.as_str())
        );
        assert_eq!(
            map.get("DeskTag_1.1.0_x64-setup.exe").map(String::as_str),
            Some("b".repeat(64).as_str())
        );
        assert_eq!(map.len(), 2);
    }

    #[test]
    fn test_cleanup_target_path_validation() {
        let tmp_dir = std::env::temp_dir().join(format!("desktag_cleanup_test_{}", Uuid::new_v4()));
        let other_dir =
            std::env::temp_dir().join(format!("desktag_cleanup_other_{}", Uuid::new_v4()));
        fs::create_dir_all(&tmp_dir).unwrap();
        fs::create_dir_all(&other_dir).unwrap();

        let current = tmp_dir.join("DeskTag_1.1.0_x64-standalone.exe");
        let valid_versioned_old = tmp_dir.join("DeskTag_1.0.1_x64-standalone.exe.old");
        let valid_same_old = tmp_dir.join("DeskTag_1.1.0_x64-standalone.exe.old");
        let invalid_ext = tmp_dir.join("DeskTag_1.0.1_x64-standalone.exe");
        let invalid_name = tmp_dir.join("important.exe.old");
        let invalid_other_dir = other_dir.join("DeskTag_1.0.1_x64-standalone.exe.old");
        let invalid_traversal = tmp_dir
            .join("..")
            .join("DeskTag_1.0.1_x64-standalone.exe.old");

        assert!(validate_cleanup_target(&current, &valid_versioned_old).is_some());
        assert!(validate_cleanup_target(&current, &valid_same_old).is_some());
        assert!(validate_cleanup_target(&current, &invalid_ext).is_none());
        assert!(validate_cleanup_target(&current, &invalid_name).is_none());
        assert!(validate_cleanup_target(&current, &invalid_other_dir).is_none());
        assert!(validate_cleanup_target(&current, &invalid_traversal).is_none());

        let _ = fs::remove_dir_all(&tmp_dir);
        let _ = fs::remove_dir_all(&other_dir);
    }

    #[test]
    fn test_device_settings_backward_compatibility() {
        let legacy_json = r#"{
            "dockMode": "right_tabs",
            "autoHide": false,
            "alwaysOnTop": false,
            "panelWidth": 480,
            "panelHeight": 680,
            "launchAtLogin": false,
            "closeToTray": true
        }"#;
        let parsed: DeviceSettings = serde_json::from_str(legacy_json).expect("legacy deserialize");
        assert!(parsed.auto_check_updates);
        assert_eq!(parsed.skipped_update_version, None);
        assert_eq!(parsed.last_update_check_at, None);
    }

    #[tokio::test]
    async fn test_fetch_primary_latest_json_and_skip_logic() {
        let sha = "1".repeat(64);
        let manifest_body = serde_json::json!({
            "version": "1.1.0",
            "tag": "v1.1.0",
            "name": "DeskTag v1.1.0",
            "pub_date": "2026-11-22T16:00:00Z",
            "notes": "- Fix calendar\n- Add updater",
            "release_url": "https://github.com/nonsense-j/DeskTag/releases/tag/v1.1.0",
            "assets": {
                "windows-x86_64-standalone": {
                    "name": "DeskTag_1.1.0_x64-standalone.exe",
                    "url": "https://github.com/nonsense-j/DeskTag/releases/download/v1.1.0/DeskTag_1.1.0_x64-standalone.exe",
                    "size": 7340032,
                    "sha256": sha
                },
                "macos-aarch64": {
                    "name": "DeskTag_1.1.0_aarch64.dmg",
                    "url": "https://github.com/nonsense-j/DeskTag/releases/download/v1.1.0/DeskTag_1.1.0_aarch64.dmg",
                    "size": 8000000,
                    "sha256": "2".repeat(64)
                }
            }
        })
        .to_string()
        .into_bytes();

        let (base, server) = spawn_mock_http_server(vec![
            (
                "/latest.json".to_string(),
                200,
                "application/json".to_string(),
                manifest_body.clone(),
            ),
            (
                "/latest.json".to_string(),
                200,
                "application/json".to_string(),
                manifest_body,
            ),
        ]);

        let res = fetch_update_info(
            "1.0.1",
            InstallKind::WindowsStandalone,
            Some("1.1.0"),
            false,
            &format!("{base}/latest.json"),
            &format!("{base}/api"),
            true,
        )
        .await
        .expect("primary manifest ok");

        assert_eq!(res.source, "latest_json");
        assert!(res.has_update);
        assert!(res.skipped);
        assert_eq!(res.latest_version, "1.1.0");
        let asset = res.recommended_asset.expect("standalone asset");
        assert_eq!(asset.name, "DeskTag_1.1.0_x64-standalone.exe");
        assert_eq!(asset.sha256.as_deref(), Some(sha.as_str()));

        // Force check clears `skipped` so manual About clicks always show the update.
        let forced = fetch_update_info(
            "1.0.1",
            InstallKind::MacosArm64,
            Some("1.1.0"),
            true,
            &format!("{base}/latest.json"),
            &format!("{base}/api"),
            true,
        )
        .await
        .expect("forced check ok");
        assert!(!forced.skipped);
        assert_eq!(
            forced.recommended_asset.unwrap().name,
            "DeskTag_1.1.0_aarch64.dmg"
        );

        let _ = server.join();
    }

    #[tokio::test]
    async fn test_fallback_to_github_api_and_sha256sums() {
        let expected_sha = "c".repeat(64);
        let sums_body = format!("{expected_sha}  DeskTag_1.1.0_x64-standalone.exe\n").into_bytes();

        // Bind first so we can embed the loopback URL in the mock GitHub API payload.
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let base = format!("http://{addr}");

        let api_body = serde_json::json!({
            "tag_name": "v1.1.0",
            "name": "DeskTag v1.1.0",
            "body": "Fallback release notes",
            "published_at": "2026-11-22T16:00:00Z",
            "html_url": "https://github.com/nonsense-j/DeskTag/releases/tag/v1.1.0",
            "draft": false,
            "assets": [
                {
                    "name": "DeskTag_1.1.0_x64-setup.exe",
                    "browser_download_url": format!("{base}/dl/setup.exe"),
                    "size": 5000000
                },
                {
                    "name": "DeskTag_1.1.0_x64-standalone.exe",
                    "browser_download_url": format!("{base}/dl/standalone.exe"),
                    "size": 7000000
                },
                {
                    "name": "SHA256SUMS.txt",
                    "browser_download_url": format!("{base}/dl/SHA256SUMS.txt"),
                    "size": sums_body.len()
                }
            ]
        })
        .to_string()
        .into_bytes();

        let server = std::thread::spawn(move || {
            for _ in 0..3 {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let line = String::from_utf8_lossy(&buf[..n]);
                let path = line
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("/");
                let (status, ct, body) = match path {
                    "/latest.json" => (404, "text/plain", b"missing".as_slice()),
                    "/api/latest" => (200, "application/json", api_body.as_slice()),
                    "/dl/SHA256SUMS.txt" => (200, "text/plain", sums_body.as_slice()),
                    _ => (404, "text/plain", b"not found".as_slice()),
                };
                let resp = format!(
                    "HTTP/1.1 {status} OK\r\nContent-Type: {ct}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(resp.as_bytes());
                let _ = stream.write_all(body);
            }
        });

        let res = fetch_update_info(
            "1.0.1",
            InstallKind::WindowsStandalone,
            None,
            false,
            &format!("{base}/latest.json"),
            &format!("{base}/api/latest"),
            true,
        )
        .await
        .expect("github api fallback ok");

        assert_eq!(res.source, "github_api");
        assert!(res.has_update);
        assert_eq!(res.release_notes, "Fallback release notes");
        let asset = res.recommended_asset.expect("matched standalone asset");
        assert_eq!(asset.name, "DeskTag_1.1.0_x64-standalone.exe");
        assert_eq!(asset.sha256.as_deref(), Some(expected_sha.as_str()));

        let _ = server.join();
    }

    #[tokio::test]
    async fn test_download_sha256_pass_and_fail() {
        let payload = b"DeskTag mock binary payload 1234567890".to_vec();
        let good_sha = hex::encode(Sha256::digest(&payload));
        let bad_sha = "0".repeat(64);

        let (base, server) = spawn_mock_http_server(vec![
            (
                "/asset.exe".to_string(),
                200,
                "application/octet-stream".to_string(),
                payload.clone(),
            ),
            (
                "/asset.exe".to_string(),
                200,
                "application/octet-stream".to_string(),
                payload.clone(),
            ),
        ]);

        let client = build_http_client(
            Duration::from_secs(5),
            Some(Duration::from_secs(10)),
            None,
            true,
        )
        .unwrap();
        let url = Url::parse(&format!("{base}/asset.exe")).unwrap();
        let tmp_dir = std::env::temp_dir().join(format!("desktag_dl_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&tmp_dir).unwrap();

        // 1. Valid SHA-256 passes & emits progress events
        let ok_part = tmp_dir.join("ok.part");
        let stages = Arc::new(Mutex::new(Vec::<String>::new()));
        let stages_ref = stages.clone();
        let bytes = download_and_verify_to_path(
            &client,
            &url,
            &ok_part,
            Some(&good_sha),
            Some(payload.len() as u64),
            move |p| {
                stages_ref.lock().unwrap().push(p.stage);
            },
        )
        .await
        .expect("sha256 pass");
        assert_eq!(bytes as usize, payload.len());
        assert_eq!(fs::read(&ok_part).unwrap(), payload);
        let seen = stages.lock().unwrap().clone();
        assert!(seen.contains(&"downloading".to_string()));
        assert!(seen.contains(&"verifying".to_string()));

        // 2. Mismatched SHA-256 fails AND deletes `.part` file
        let bad_part = tmp_dir.join("bad.part");
        let err = download_and_verify_to_path(
            &client,
            &url,
            &bad_part,
            Some(&bad_sha),
            Some(payload.len() as u64),
            |_| {},
        )
        .await
        .expect_err("sha256 mismatch must fail");
        assert!(err.contains("SHA-256"));
        assert!(!bad_part.exists());

        let _ = fs::remove_dir_all(&tmp_dir);
        let _ = server.join();
    }

    #[tokio::test]
    async fn test_redirect_to_untrusted_host_is_blocked() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let resp = "HTTP/1.1 302 Found\r\nLocation: https://evil.example.com/payload.exe\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = stream.write_all(resp.as_bytes());
                let _ = stream.flush();
            }
        });

        let client = build_http_client(
            Duration::from_secs(5),
            Some(Duration::from_secs(10)),
            None,
            true,
        )
        .unwrap();
        let res = client.get(format!("http://{addr}/start")).send().await;
        assert!(res.is_err(), "redirect to untrusted host must be blocked");

        let _ = server.join();
    }
}
