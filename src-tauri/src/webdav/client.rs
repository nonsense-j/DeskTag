//! Zero-dependency WebDAV HTTP client over `reqwest` (rustls-tls) + `quick-xml`,
//! hardened for Nutstore, 123pan, TeraCLOUD, Synology DSM, Alist/OpenList, and Nextcloud.

use serde::{Deserialize, Serialize};

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
