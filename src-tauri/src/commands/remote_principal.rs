//! Remote-principal commands (PR #4).
//!
//! These commands expose the desktop's `remote-principals.json` table
//! to the frontend plus the resolve handshake that walks a share
//! link into a persisted record. Add / remove / list / resolve all
//! run on the local runtime — no IPC, no pekohub auth required for
//! the local-disk surface. The hub call inside `remote_principal_resolve`
//! is anonymous by contract (peko's public principal endpoint is
//! intentionally open).

use serde::{Deserialize, Serialize};

use crate::clients::hub_remote_client::HubRemoteClient;
use crate::state::AppState;
use crate::storage::remote_principals::{self, RemotePrincipalRecord};

/// Lightweight summary sent to the JS layer. The `runtime_id` is
/// always of the form `hub:<hub_url>` so the multi-runtime IPC
/// layer (PR #3) routes the request correctly. The `addedAtUnixMs`
/// carries the timestamp so the sidebar can render relative-age
/// badges ("added 3d ago") without re-fetching.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePrincipalSummary {
    pub hub_url: String,
    pub owner: String,
    pub principal_name: String,
    pub display_name: String,
    pub description: Option<String>,
    pub exposure: String,
    pub status: String,
    pub runtime_id: String,
    pub added_at_unix_ms: u64,
    pub has_invite_token: bool,
}

impl RemotePrincipalSummary {
    fn from_record(r: &RemotePrincipalRecord) -> Self {
        let runtime_id = format!("hub:{}", r.hub_url.trim_end_matches('/'));
        Self {
            hub_url: r.hub_url.clone(),
            owner: r.owner.clone(),
            principal_name: r.principal_name.clone(),
            display_name: r.principal_name.clone(),
            description: None,
            exposure: r.exposure.clone(),
            status: r.status.clone(),
            runtime_id,
            added_at_unix_ms: r.added_at_unix_ms,
            has_invite_token: r.invite_token.is_some(),
        }
    }
}

/// Share-link shape. Accepts the canonical `${hubUrl}/p/{owner}/{name}`
/// form (with optional `?token=...`) and the legacy
/// `${hubUrl}/v1/public/principals/{owner}/{name}` form for users
/// who copied the API URL.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePrincipalAddRequest {
    pub share_url: String,
}

/// Result of `remote_principal_resolve` — the resolver drops the
/// hub-side evidence so the frontend can show the user WHO they
/// are about to add before committing to disk.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePrincipalResolve {
    pub hub_url: String,
    pub owner: String,
    pub principal_name: String,
    pub display_name: String,
    pub description: Option<String>,
    pub exposure: String,
    pub status: String,
    pub invite_token: Option<String>,
}

/// Parse a share URL into `(hub_url, owner, principal_name, invite_token)`.
/// Accepts both `${hubUrl}/p/{owner}/{name}` and the legacy
/// `${hubUrl}/v1/public/principals/{owner}/{name}` form. Returns
/// `None` if the URL doesn't match either shape.
fn parse_share_url(raw: &str) -> Option<(String, String, String, Option<String>)> {
    let url = urlparse_simple(raw)?;
    let path = url.path.trim_end_matches('/');
    // Strip leading slash so split gives clean segments.
    let stripped = path.strip_prefix('/').unwrap_or(path);
    // `/p/{owner}/{name}` — the canonical share-link form (PR #2).
    if let Some(rest) = stripped.strip_prefix("p/") {
        let mut parts = rest.split('/');
        let owner = parts.next()?.to_string();
        let name = parts.next()?.to_string();
        if owner.is_empty() || name.is_empty() {
            return None;
        }
        // No more path segments allowed.
        if parts.next().is_some() {
            return None;
        }
        return Some((url.origin, owner, name, url.query_token));
    }
    // `/v1/public/principals/{owner}/{name}` — the API URL form.
    if let Some(rest) = stripped.strip_prefix("v1/public/principals/") {
        let mut parts = rest.split('/');
        let owner = parts.next()?.to_string();
        let name = parts.next()?.to_string();
        if owner.is_empty() || name.is_empty() {
            return None;
        }
        if parts.next().is_some() {
            return None;
        }
        return Some((url.origin, owner, name, url.query_token));
    }
    None
}

struct SimpleUrl {
    origin: String,
    path: String,
    query_token: Option<String>,
}

fn urlparse_simple(raw: &str) -> Option<SimpleUrl> {
    // Find the scheme boundary.
    let (scheme, after_scheme) = raw.split_once("://")?;
    if scheme != "http" && scheme != "https" {
        return None;
    }
    // Split path / query off the rest.
    let (authority_and_path, query) = match after_scheme.find('?') {
        Some(idx) => (&after_scheme[..idx], &after_scheme[idx + 1..]),
        None => (after_scheme, ""),
    };
    let (origin, path) = match authority_and_path.find('/') {
        Some(idx) => (&authority_and_path[..idx], &authority_and_path[idx..]),
        None => (authority_and_path, "/"),
    };
    if origin.is_empty() {
        return None;
    }
    let query_token = query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find_map(|(k, v)| {
            if k == "token" {
                Some(v.to_string())
            } else {
                None
            }
        });
    Some(SimpleUrl {
        origin: format!("{scheme}://{origin}"),
        path: path.to_string(),
        query_token,
    })
}

#[tauri::command]
pub async fn remote_principal_list() -> Result<Vec<RemotePrincipalSummary>, String> {
    let records = remote_principals::read_all()?;
    Ok(records
        .iter()
        .map(RemotePrincipalSummary::from_record)
        .collect())
}

#[tauri::command]
pub async fn remote_principal_resolve(share_url: String) -> Result<RemotePrincipalResolve, String> {
    let (hub_url, owner, name, invite_token) = parse_share_url(&share_url)
        .ok_or_else(|| format!("not a valid pekohub share URL: {share_url:?}"))?;
    // Use a PekohubClient pinned to the user-supplied hub URL so
    // self-hosted hubs resolve against the right base.
    let client = crate::clients::pekohub::PekohubClient::new().with_base_url(hub_url.clone());
    let payload = client
        .get_public_principal(&owner, &name, invite_token.as_deref())
        .await?;
    // The endpoint returns `{ liveInstance: {...} }` with the
    // live-side fields. We project the display name / description /
    // status from the `liveInstance` envelope so the frontend can
    // show a confirmation card before the user clicks "Add".
    let live = payload
        .get("liveInstance")
        .ok_or_else(|| "pekohub response missing `liveInstance`".to_string())?;
    let display_name = live
        .get("publicName")
        .and_then(|v| v.as_str())
        .unwrap_or(&name)
        .to_string();
    let description = live
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let exposure = live
        .get("exposure")
        .and_then(|v| v.as_str())
        .unwrap_or("public")
        .to_string();
    let status = live
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("offline")
        .to_string();
    Ok(RemotePrincipalResolve {
        hub_url,
        owner,
        principal_name: name,
        display_name,
        description,
        exposure,
        status,
        invite_token,
    })
}

#[tauri::command]
pub async fn remote_principal_add(
    state: tauri::State<'_, AppState>,
    req: RemotePrincipalAddRequest,
) -> Result<RemotePrincipalSummary, String> {
    let resolved = remote_principal_resolve(req.share_url.clone()).await?;
    let added_at_unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let record = RemotePrincipalRecord {
        hub_url: resolved.hub_url.clone(),
        owner: resolved.owner.clone(),
        principal_name: resolved.principal_name.clone(),
        exposure: resolved.exposure.clone(),
        status: resolved.status.clone(),
        added_at_unix_ms,
        invite_token: resolved.invite_token.clone(),
    };
    let mut records = remote_principals::read_all().unwrap_or_default();
    // Dedupe on (hub_url, owner, principal_name) — adding the same
    // share link twice is a noop that updates the existing record.
    records.retain(|r| {
        !(r.hub_url == record.hub_url
            && r.owner == record.owner
            && r.principal_name == record.principal_name)
    });
    records.push(record.clone());
    remote_principals::write_all(&records)?;
    // PR #5: build a HubRemoteClient pinned to this hub and register
    // it with AppState so `resolve_runtime` returns `HubRemote(client)`
    // for the new `hub:<hub_url>` runtime_id. Without this, the IPC
    // routing layer falls back to the local IPC client and every
    // chat request returns "daemon unreachable".
    let client = HubRemoteClient::new(
        record.hub_url.clone(),
        record.owner.clone(),
        record.principal_name.clone(),
        record.invite_token.clone(),
        state.http.clone(),
    );
    let _ = state.register_hub_remote(client).await;
    Ok(RemotePrincipalSummary {
        hub_url: record.hub_url.clone(),
        owner: record.owner.clone(),
        principal_name: record.principal_name.clone(),
        display_name: resolved.display_name,
        description: resolved.description,
        exposure: record.exposure.clone(),
        status: record.status.clone(),
        runtime_id: format!("hub:{}", record.hub_url.trim_end_matches('/')),
        added_at_unix_ms: record.added_at_unix_ms,
        has_invite_token: record.invite_token.is_some(),
    })
}

#[tauri::command]
pub async fn remote_principal_remove(
    state: tauri::State<'_, AppState>,
    hub_url: String,
    owner: String,
    principal_name: String,
) -> Result<bool, String> {
    let mut records = remote_principals::read_all().unwrap_or_default();
    let before = records.len();
    records.retain(|r| {
        !(r.hub_url == hub_url && r.owner == owner && r.principal_name == principal_name)
    });
    let removed = records.len() != before;
    if removed {
        remote_principals::write_all(&records)?;
        // PR #5: drop the in-memory HubRemoteClient so subsequent
        // IPC commands don't try to stream to a no-longer-added
        // principal. The runtime_id format is `hub:<hub_url>`.
        let runtime_id = format!("hub:{}", hub_url.trim_end_matches('/'));
        let _ = state.unregister_hub_remote(&runtime_id).await;
    }
    Ok(removed)
}

// ── Tauri domain port (lets the runtime-internal caller reach us) ──────
//
// `commands::register_commands` registers the public Tauri commands
// above. We don't expose a host trait here because none of the
// runtime-side code needs to call into this domain — the desktop
// owns the storage and the hub lookup.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_share_url_canonical_form() {
        let (hub, owner, name, token) =
            parse_share_url("https://pekohub.org/p/alice/coding-assistant")
                .expect("canonical form should parse");
        assert_eq!(hub, "https://pekohub.org");
        assert_eq!(owner, "alice");
        assert_eq!(name, "coding-assistant");
        assert!(token.is_none());
    }

    #[test]
    fn test_parse_share_url_with_token() {
        let (hub, owner, name, token) =
            parse_share_url("https://pekohub.org/p/alice/coding-assistant?token=abc123")
                .expect("token-bearing form should parse");
        assert_eq!(hub, "https://pekohub.org");
        assert_eq!(owner, "alice");
        assert_eq!(name, "coding-assistant");
        assert_eq!(token.as_deref(), Some("abc123"));
    }

    #[test]
    fn test_parse_share_url_api_form() {
        let (hub, owner, name, token) =
            parse_share_url("https://pekohub.org/v1/public/principals/alice/coding-assistant")
                .expect("api form should parse");
        assert_eq!(hub, "https://pekohub.org");
        assert_eq!(owner, "alice");
        assert_eq!(name, "coding-assistant");
        assert!(token.is_none());
    }

    #[test]
    fn test_parse_share_url_rejects_unknown_shape() {
        // The parser does NOT validate the host (peko supports self-hosted
        // hubs); only the URL shape must match. Unknown hosts are passed
        // through to `remote_principal_resolve` and rejected by the hub's
        // HTTP 404 there.
        assert!(parse_share_url("https://example.com/p/alice/coding-assistant").is_some());
        // Path-shape rejections:
        assert!(parse_share_url("https://pekohub.org/").is_none());
        assert!(parse_share_url("not a url").is_none());
        assert!(parse_share_url("ftp://pekohub.org/p/alice/x").is_none());
        // Trailing path segment is rejected — only the owner/name
        // pair is allowed.
        assert!(parse_share_url("https://pekohub.org/p/alice/coding-assistant/extra").is_none());
        // `/p/owner` (no name) is rejected.
        assert!(parse_share_url("https://pekohub.org/p/alice").is_none());
    }

    #[test]
    fn test_summary_runtime_id_format() {
        let r = RemotePrincipalRecord {
            hub_url: "https://pekohub.org/".to_string(),
            owner: "alice".to_string(),
            principal_name: "coding-assistant".to_string(),
            exposure: "public".to_string(),
            status: "online".to_string(),
            added_at_unix_ms: 0,
            invite_token: None,
        };
        let summary = RemotePrincipalSummary::from_record(&r);
        assert_eq!(summary.runtime_id, "hub:https://pekohub.org");
        assert!(!summary.has_invite_token);
    }

    #[test]
    fn test_summary_runtime_id_format_no_trailing_slash() {
        let r = RemotePrincipalRecord {
            hub_url: "https://pekohub.org".to_string(),
            owner: "alice".to_string(),
            principal_name: "coding-assistant".to_string(),
            exposure: "public".to_string(),
            status: "online".to_string(),
            added_at_unix_ms: 0,
            invite_token: None,
        };
        let summary = RemotePrincipalSummary::from_record(&r);
        assert_eq!(summary.runtime_id, "hub:https://pekohub.org");
    }
}
