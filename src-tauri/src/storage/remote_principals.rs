//! Persistent storage for remote principals. PR #4 adds the
//! `remote-principals.json` table that backs the desktop's
//! "Connect to a remote principal" flow: a user pastes a share URL
//! from pekohub, the desktop resolves the principal via the hub's
//! `/v1/public/principals/:owner/:name` endpoint, and the verified
//! record is persisted to disk so the sidebar can re-render it across
//! restarts.
//!
//! The file lives at `~/.peko/remote-principals.json`. The handler
//! pair (`remote_principal_add` / `remote_principal_list` / etc.) in
//! `commands/remote_principal.rs` is the only consumer.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Per-record shape. Matches the fields the hub `/v1/public/principals/:owner/:name`
/// endpoint exposes (PR #2: `unlisted` is a valid exposure value).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RemotePrincipalRecord {
    pub hub_url: String,
    pub owner: String,
    pub principal_name: String,
    pub exposure: String,
    pub status: String,
    pub added_at_unix_ms: u64,
    /// Optional invite token embedded in the share URL. PR #11
    /// surfaces this in the burn-revoke modal; until then the row
    /// just carries it so a future re-resolve doesn't lose it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invite_token: Option<String>,
}

/// Wrapper so JSON reads stay forward-compatible — missing fields on
/// the surface stay `None` / empty rather than failing the whole
/// load.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct RemotePrincipalFile {
    #[serde(default)]
    pub principals: Vec<RemotePrincipalRecord>,
}

fn file_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|d| d.join(".peko").join("remote-principals.json"))
        .ok_or_else(|| "could not determine home directory".to_string())
}

/// Read the full file. Missing file returns an empty default rather
/// than an error so first-run callers don't have to seed the file.
pub fn read_all() -> Result<Vec<RemotePrincipalRecord>, String> {
    let path = file_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read remote-principals.json: {}", e))?;
    let parsed: RemotePrincipalFile = serde_json::from_str(&content).unwrap_or_default();
    Ok(parsed.principals)
}

/// Atomically replace the file with the supplied records. We write to
/// a sibling tmp file then rename, so a crash mid-write can't leave
/// a half-truncated JSON document on disk (mirrors the f30a
/// session-atomic-append pattern).
pub fn write_all(records: &[RemotePrincipalRecord]) -> Result<(), String> {
    let path = file_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create config directory: {}", e))?;
    }
    let wrapper = RemotePrincipalFile {
        principals: records.to_vec(),
    };
    let content = serde_json::to_string_pretty(&wrapper)
        .map_err(|e| format!("failed to serialize remote-principals: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, content)
        .map_err(|e| format!("failed to write remote-principals tmp: {}", e))?;
    std::fs::rename(&tmp, &path)
        .map_err(|e| format!("failed to rename remote-principals tmp: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The unique-key tuple is `(hub_url, owner, principal_name)` —
    /// two rows with the same triple are the same remote principal.
    /// Used by callers to dedupe before insert.
    #[allow(dead_code)] // exposed for callers that want the dedupe key inline
    pub fn key(r: &RemotePrincipalRecord) -> (String, String, String) {
        (r.hub_url.clone(), r.owner.clone(), r.principal_name.clone())
    }

    #[test]
    fn test_roundtrip_empty() {
        let records: Vec<RemotePrincipalRecord> = Vec::new();
        let wrapper = RemotePrincipalFile {
            principals: records,
        };
        let json = serde_json::to_string(&wrapper).unwrap();
        let parsed: RemotePrincipalFile = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.principals.len(), 0);
    }

    #[test]
    fn test_roundtrip_with_records() {
        let records = vec![
            RemotePrincipalRecord {
                hub_url: "https://pekohub.org".to_string(),
                owner: "alice".to_string(),
                principal_name: "coding-assistant".to_string(),
                exposure: "public".to_string(),
                status: "online".to_string(),
                added_at_unix_ms: 1_700_000_000_000,
                invite_token: None,
            },
            RemotePrincipalRecord {
                hub_url: "https://pekohub.org".to_string(),
                owner: "bob".to_string(),
                principal_name: "helper".to_string(),
                exposure: "unlisted".to_string(),
                status: "offline".to_string(),
                added_at_unix_ms: 1_700_000_001_000,
                invite_token: Some("opaque".to_string()),
            },
        ];
        let wrapper = RemotePrincipalFile {
            principals: records.clone(),
        };
        let json = serde_json::to_string(&wrapper).unwrap();
        let parsed: RemotePrincipalFile = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.principals, records);
    }

    #[test]
    fn test_optional_invite_token_roundtrip() {
        let r = RemotePrincipalRecord {
            hub_url: "https://h".to_string(),
            owner: "o".to_string(),
            principal_name: "p".to_string(),
            exposure: "private".to_string(),
            status: "online".to_string(),
            added_at_unix_ms: 0,
            invite_token: None,
        };
        let json = serde_json::to_string(&r).unwrap();
        // `skip_serializing_if = "Option::is_none"` keeps the wire
        // shape clean for the no-token case.
        assert!(!json.contains("invite_token"));
        let parsed: RemotePrincipalRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, r);
    }
}
