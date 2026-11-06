//! Remote-principal commands (PR #4).
//!
//! These commands expose the desktop's `remote-principals.json` table
//! to the frontend plus the resolve handshake that walks a share
//! link into a persisted record. Add / remove / list / resolve all
//! run on the local runtime — no IPC, no pekohub auth required for
//! the local-disk surface. The hub call inside `remote_principal_resolve`
//! is anonymous by contract (the hub's `/v1/public/pekos/:owner/:pekoName`
//! endpoint is intentionally open).

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
    /// Set for one of your own pekos (saved from your account's list).
    pub hub_id: Option<String>,
    pub avatar: Option<String>,
    pub local_id: Option<String>,
    /// One of your own pekos, following your account: not removed by hand.
    pub from_account: bool,
}

impl RemotePrincipalSummary {
    fn from_record(r: &RemotePrincipalRecord) -> Self {
        let runtime_id = format!("hub:{}", r.hub_url.trim_end_matches('/'));
        Self {
            hub_url: r.hub_url.clone(),
            owner: r.owner.clone(),
            principal_name: r.principal_name.clone(),
            display_name: r.principal_name.clone(),
            description: r.description.clone(),
            exposure: r.exposure.clone(),
            status: r.status.clone(),
            runtime_id,
            added_at_unix_ms: r.added_at_unix_ms,
            has_invite_token: r.invite_token.is_some(),
            hub_id: r.hub_id.clone(),
            avatar: r.avatar.clone(),
            local_id: r.local_id.clone(),
            from_account: r.from_account,
        }
    }
}

/// Share-link shape. Accepts the canonical `${hubUrl}/@{owner}/{name}`
/// form (the peko's ID as its page, hub ADR-009; with optional
/// `?token=...`), the older `${hubUrl}/peko/{owner}/{name}` and
/// `${hubUrl}/p/{owner}/{name}` forms (the hub redirects them, and users
/// still have old links lying around), plus the `/v1/public/pekos/{owner}/{name}` and retired
/// `/v1/public/principals/{owner}/{name}` API URL forms for users who
/// copied the endpoint directly.
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
/// Accepts `${hubUrl}/@{owner}/{name}` (canonical, hub ADR-009), the
/// older `${hubUrl}/peko/{owner}/{name}` and `${hubUrl}/p/{owner}/{name}`
/// forms, and both API URL forms (`/v1/public/pekos/...` and the retired
/// `/v1/public/principals/...`). Returns `None` if the URL doesn't
/// match any known shape.
fn parse_share_url(raw: &str) -> Option<(String, String, String, Option<String>)> {
    let url = urlparse_simple(raw)?;
    let path = url.path.trim_end_matches('/');
    // Strip leading slash so split gives clean segments.
    let stripped = path.strip_prefix('/').unwrap_or(path);
    // `/@{owner}/{name}` — the peko's ID is its page (hub ADR-009). A
    // pasted link may carry the `@` percent-encoded. Handles are
    // lowercase.
    if let Some(rest) = stripped
        .strip_prefix('@')
        .or_else(|| stripped.strip_prefix("%40"))
    {
        let mut parts = rest.split('/');
        let owner = parts.next()?.to_ascii_lowercase();
        let name = parts.next()?.to_string();
        if owner.is_empty() || name.is_empty() || parts.next().is_some() {
            return None;
        }
        return Some((
            crate::clients::hub_origin::hub_api_base(&url.origin),
            owner,
            name,
            url.query_token,
        ));
    }
    // `/peko/{owner}/{name}` and `/p/…` — the older share-link forms the
    // hub still redirects.
    for prefix in ["peko/", "p/"] {
        if let Some(rest) = stripped.strip_prefix(prefix) {
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
            return Some((
                crate::clients::hub_origin::hub_api_base(&url.origin),
                owner,
                name,
                url.query_token,
            ));
        }
    }
    // `/v1/public/pekos/{owner}/{name}` — the API URL form; the
    // retired `/v1/public/principals/…` spelling is accepted for old
    // copied links.
    for prefix in ["v1/public/pekos/", "v1/public/principals/"] {
        if let Some(rest) = stripped.strip_prefix(prefix) {
            let mut parts = rest.split('/');
            let owner = parts.next()?.to_string();
            let name = parts.next()?.to_string();
            if owner.is_empty() || name.is_empty() {
                return None;
            }
            if parts.next().is_some() {
                return None;
            }
            return Some((
                crate::clients::hub_origin::hub_api_base(&url.origin),
                owner,
                name,
                url.query_token,
            ));
        }
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
    let client = crate::clients::pekohub::PekohubClient::new()
        .with_base_url(crate::clients::hub_origin::hub_api_base(&hub_url));
    let payload = client
        .get_public_principal(&owner, &name, invite_token.as_deref())
        .await?;
    // The endpoint returns `{ liveInstance: { id, publicName,
    // description, owner {id,name,avatarUrl}, capabilities, status,
    // tosRequired, tosText } }`. We project the display name /
    // description / status from the `liveInstance` envelope so the
    // frontend can show a confirmation card before the user clicks
    // "Add". The post-ADR-005 envelope no longer carries `exposure`
    // (the endpoint serves both `public` and `unlisted` rows), so the
    // record falls back to "public" — the field is informational
    // only; chat access is gated hub-side, not by this value.
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
        ..Default::default()
    };
    remote_principals::update(|records| {
        // Dedupe on (hub_url, owner, principal_name) — adding the same
        // share link twice is a noop that updates the existing record.
        records.retain(|r| {
            !(r.hub_url == record.hub_url
                && r.owner == record.owner
                && r.principal_name == record.principal_name)
        });
        records.push(record.clone());
    })?;
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
        hub_id: None,
        avatar: None,
        local_id: None,
        from_account: false,
    })
}

/// One of your own pekos on another computer, as your PekoHub account
/// lists it (`/v1/me/accessible-pekos`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePrincipalAdoptRequest {
    pub hub_url: String,
    pub owner: String,
    pub principal_name: String,
    pub hub_id: String,
    #[serde(default)]
    pub exposure: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub local_id: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// From your account's list (one of your own pekos), rather than a DM
    /// with someone else's peko.
    #[serde(default)]
    pub from_account: bool,
}

/// The saved records after adopting `req`: a record with its Hub ID (or
/// its `(hub, owner, name)`) is refreshed in place, keeping when it was
/// first added; otherwise it is added.
fn adopt_into(
    mut records: Vec<RemotePrincipalRecord>,
    req: RemotePrincipalAdoptRequest,
    now_unix_ms: u64,
) -> (Vec<RemotePrincipalRecord>, RemotePrincipalRecord) {
    let same = |r: &RemotePrincipalRecord| {
        r.hub_id.as_deref() == Some(req.hub_id.as_str())
            || (r.hub_url == req.hub_url
                && r.owner == req.owner
                && r.principal_name == req.principal_name)
    };
    let previous = records.iter().find(|r| same(r)).cloned();
    records.retain(|r| !same(r));
    let record = RemotePrincipalRecord {
        hub_url: req.hub_url,
        owner: req.owner,
        principal_name: req.principal_name,
        exposure: req.exposure.unwrap_or_else(|| "private".to_string()),
        status: req.status.unwrap_or_else(|| "offline".to_string()),
        added_at_unix_ms: previous
            .as_ref()
            .map(|r| r.added_at_unix_ms)
            .unwrap_or(now_unix_ms),
        from_account: req.from_account || previous.as_ref().is_some_and(|r| r.from_account),
        invite_token: previous.and_then(|r| r.invite_token),
        hub_id: Some(req.hub_id),
        avatar: req.avatar.filter(|a| !a.trim().is_empty()),
        local_id: req.local_id.filter(|id| !id.is_empty()),
        description: req.description.filter(|d| !d.trim().is_empty()),
    };
    records.push(record.clone());
    (records, record)
}

/// Save one of your own pekos on another computer so it sits in Chats
/// like a peko of this computer. Nothing is looked up: your account
/// listed it with its Hub ID, and its DM opens by that ID.
#[tauri::command]
pub async fn remote_principal_adopt(
    state: tauri::State<'_, AppState>,
    req: RemotePrincipalAdoptRequest,
) -> Result<RemotePrincipalSummary, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let record = remote_principals::update(|records| {
        let (merged, record) = adopt_into(std::mem::take(records), req, now);
        *records = merged;
        record
    })?;
    let client = HubRemoteClient::new(
        record.hub_url.clone(),
        record.owner.clone(),
        record.principal_name.clone(),
        record.invite_token.clone(),
        state.http.clone(),
    )
    .with_hub_id(record.hub_id.clone());
    state.register_hub_remote(client).await;
    Ok(RemotePrincipalSummary::from_record(&record))
}

/// A peko by its PekoHub ID (`GET /v1/principals/by-hub-id/:id`), read
/// as the signed-in account: its name, owner's handle, face, and
/// liveness. `None` when the hub has no such peko or won't show it.
async fn hub_peko_by_id(
    http: &reqwest::Client,
    hub_url: &str,
    hub_id: &str,
) -> Result<Option<serde_json::Value>, String> {
    // A Hub ID is a UUID; anything else never reaches the URL.
    if hub_id.len() != 36 || !hub_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Ok(None);
    }
    let api = crate::clients::hub_origin::hub_api_base(hub_url);
    let url = format!(
        "{}/v1/principals/by-hub-id/{hub_id}",
        api.trim_end_matches('/')
    );
    let mut request = http.get(&url).timeout(std::time::Duration::from_secs(20));
    if let Some(token) = crate::clients::hub_auth::access_token(http, &api).await {
        request = request.bearer_auth(token);
    }
    let resp = request
        .send()
        .await
        .map_err(|e| format!("Couldn't reach {api}: {e}"))?;
    match resp.status().as_u16() {
        200 => resp.json().await.map(Some).map_err(|e| e.to_string()),
        403 | 404 => Ok(None),
        other => Err(format!("{api} answered {other} for peko {hub_id}")),
    }
}

/// Hub IDs the hub had no peko for lately, so the minute-by-minute DM
/// check doesn't ask about them again for a while.
static MISSED: std::sync::Mutex<Vec<(String, std::time::Instant)>> =
    std::sync::Mutex::new(Vec::new());
const MISS_REMEMBERED: std::time::Duration = std::time::Duration::from_secs(600);

fn recently_missed(hub_id: &str) -> bool {
    let mut missed = MISSED.lock().unwrap_or_else(|e| e.into_inner());
    missed.retain(|(_, at)| at.elapsed() < MISS_REMEMBERED);
    missed.iter().any(|(id, _)| id == hub_id)
}

fn note_missed(hub_id: &str) {
    let mut missed = MISSED.lock().unwrap_or_else(|e| e.into_inner());
    missed.retain(|(id, at)| id != hub_id && at.elapsed() < MISS_REMEMBERED);
    missed.push((hub_id.to_string(), std::time::Instant::now()));
}

/// The record a DM with someone else's peko becomes, from the hub's
/// answer for its Hub ID. `None` without a name or an owner handle (the
/// list keys a remote peko by them).
fn dm_record(
    hub_url: &str,
    hub_id: &str,
    hit: &serde_json::Value,
    now_unix_ms: u64,
) -> Option<RemotePrincipalRecord> {
    let text = |key: &str| {
        hit.get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
    };
    Some(RemotePrincipalRecord {
        hub_url: hub_url.to_string(),
        owner: text("ownerHandle")?,
        principal_name: text("name")?,
        exposure: text("exposure").unwrap_or_else(|| "public".to_string()),
        status: text("status").unwrap_or_else(|| "offline".to_string()),
        added_at_unix_ms: now_unix_ms,
        hub_id: Some(hub_id.to_string()),
        avatar: text("avatar"),
        local_id: text("localId"),
        description: text("description"),
        ..Default::default()
    })
}

/// Add the records found for DMs to `records` as they are now: one that
/// was saved meanwhile (by Hub ID, or by hub, owner, and name) is left as
/// it is — your own peko adopted from your account keeps its
/// `from_account`. Returns the ones added.
fn add_dm_records(
    records: &mut Vec<RemotePrincipalRecord>,
    found: Vec<RemotePrincipalRecord>,
) -> Vec<RemotePrincipalRecord> {
    let mut added = Vec::new();
    for record in found {
        let saved = records.iter().any(|r| {
            (r.hub_id.is_some() && r.hub_id == record.hub_id)
                || (r.hub_url == record.hub_url
                    && r.owner == record.owner
                    && r.principal_name == record.principal_name)
        });
        if !saved {
            records.push(record.clone());
            added.push(record);
        }
    }
    added
}

/// Save the pekos you have DMs with on other computers — opened here or
/// followed from your other computers (runtime ADR-095 D5) — so each
/// sits in Chats like a peko of this computer. Returns how many were
/// added. Nothing when this computer isn't signed in.
#[tauri::command]
pub async fn remote_principal_adopt_dms(
    state: tauri::State<'_, AppState>,
    hub_url: String,
) -> Result<usize, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let answer = client
        .channel_peko_dms()
        .await
        .map_err(|e| format!("channel_peko_dms failed: {e}"))?;
    let Some(dms) = answer.get("dms").and_then(|v| v.as_array()) else {
        // Not signed in, or a runtime that predates the list.
        return Ok(0);
    };
    // Which to look up, from what is saved now; the hub is asked outside
    // the lock, and the list re-read under it before anything is added.
    let saved = remote_principals::read_all().unwrap_or_default();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut found = Vec::new();
    for dm in dms {
        let Some(hub_id) = dm.get("hub_id").and_then(|v| v.as_str()) else {
            continue;
        };
        if saved.iter().any(|r| r.hub_id.as_deref() == Some(hub_id)) || recently_missed(hub_id) {
            continue;
        }
        let Some(hit) = hub_peko_by_id(&state.http, &hub_url, hub_id).await? else {
            // Gone from PekoHub, or not shown to us (a peko made local
            // only): don't ask again every minute.
            note_missed(hub_id);
            continue;
        };
        if let Some(record) = dm_record(&hub_url, hub_id, &hit, now) {
            found.push(record);
        }
    }
    if found.is_empty() {
        return Ok(0);
    }
    let added = remote_principals::update(|records| add_dm_records(records, found))?;
    for record in &added {
        state
            .register_hub_remote(
                HubRemoteClient::new(
                    record.hub_url.clone(),
                    record.owner.clone(),
                    record.principal_name.clone(),
                    None,
                    state.http.clone(),
                )
                .with_hub_id(record.hub_id.clone()),
            )
            .await;
    }
    Ok(added.len())
}

#[tauri::command]
pub async fn remote_principal_remove(
    state: tauri::State<'_, AppState>,
    hub_url: String,
    owner: String,
    principal_name: String,
) -> Result<bool, String> {
    let removed = remote_principals::update(|records| {
        let before = records.len();
        records.retain(|r| {
            !(r.hub_url == hub_url && r.owner == owner && r.principal_name == principal_name)
        });
        records.len() != before
    })?;
    if removed {
        // PR #5: drop the in-memory HubRemoteClient so subsequent
        // IPC commands don't try to stream to a no-longer-added
        // principal. The runtime_id format is `hub:<hub_url>`.
        let runtime_id = format!("hub:{}", hub_url.trim_end_matches('/'));
        let _ = state
            .unregister_hub_remote(&runtime_id, &principal_name)
            .await;
    }
    Ok(removed)
}

/// A remote peko's live public face, read from its hub record.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemotePekoProfile {
    pub status: String,
    /// The emoji or monogram its runtime announced, if any.
    pub avatar: Option<String>,
    pub description: Option<String>,
    /// Its id on its own runtime: the app keys a peko's accent on it.
    pub local_id: Option<String>,
}

/// A `by-hub-id` answer as a profile.
fn project_hub_hit(hit: &serde_json::Value) -> Option<RemotePekoProfile> {
    project_profile(&serde_json::json!({ "liveInstance": hit }))
}

fn project_profile(payload: &serde_json::Value) -> Option<RemotePekoProfile> {
    let live = payload.get("liveInstance")?;
    let text = |key: &str| {
        live.get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
    };
    Some(RemotePekoProfile {
        status: text("status").unwrap_or_else(|| "unknown".to_string()),
        avatar: text("avatar"),
        description: text("description"),
        local_id: text("localId"),
    })
}

/// Read a saved remote peko's hub record: its status, avatar,
/// description, and id. Fetched here rather than in the webview, whose
/// content security policy allows no outside hosts. `None` when the hub
/// no longer has it (deregistered, or no longer public).
#[tauri::command]
pub async fn remote_principal_profile(
    state: tauri::State<'_, AppState>,
    hub_url: String,
    owner: String,
    principal_name: String,
) -> Result<Option<RemotePekoProfile>, String> {
    let saved = remote_principals::read_all()
        .unwrap_or_default()
        .into_iter()
        .find(|r| r.hub_url == hub_url && r.owner == owner && r.principal_name == principal_name);
    // Known by its Hub ID: read it as the signed-in account, which also
    // answers for a peko with no public page (a contact's private one).
    if let Some(hub_id) = saved.as_ref().and_then(|r| r.hub_id.clone()) {
        return Ok(hub_peko_by_id(&state.http, &hub_url, &hub_id)
            .await?
            .and_then(|hit| project_hub_hit(&hit)));
    }
    let invite_token = saved.and_then(|r| r.invite_token);
    let client = crate::clients::pekohub::PekohubClient::new()
        .with_base_url(crate::clients::hub_origin::hub_api_base(&hub_url));
    match client
        .get_public_principal(&owner, &principal_name, invite_token.as_deref())
        .await
    {
        Ok(payload) => Ok(project_profile(&payload)),
        Err(e) if e == "peko not found" => Ok(None),
        Err(e) => Err(e),
    }
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

    fn adopt(name: &str, hub_id: &str) -> RemotePrincipalAdoptRequest {
        RemotePrincipalAdoptRequest {
            hub_url: "http://127.0.0.1:3901".into(),
            owner: "alice".into(),
            principal_name: name.into(),
            hub_id: hub_id.into(),
            exposure: Some("private".into()),
            status: Some("online".into()),
            avatar: Some("🦊".into()),
            local_id: Some("prin_a".into()),
            description: Some(" ".into()),
            from_account: false,
        }
    }

    /// Your own peko from your account: saved with its Hub ID and face;
    /// adopting it again refreshes the one record and keeps when it was
    /// first added, and an older share-link record of it is replaced.
    #[test]
    fn adopting_your_own_peko_keeps_one_record_with_its_hub_id() {
        let share_link = RemotePrincipalRecord {
            hub_url: "http://127.0.0.1:3901".into(),
            owner: "alice".into(),
            principal_name: "nova".into(),
            exposure: "public".into(),
            status: "offline".into(),
            added_at_unix_ms: 5,
            invite_token: Some("token".into()),
            ..Default::default()
        };
        let (records, record) = adopt_into(vec![share_link], adopt("nova", "hub-1"), 9);
        assert_eq!(records.len(), 1);
        assert_eq!(record.hub_id.as_deref(), Some("hub-1"));
        assert_eq!(record.avatar.as_deref(), Some("🦊"));
        assert_eq!(record.local_id.as_deref(), Some("prin_a"));
        assert_eq!(record.description, None, "blank text is no description");
        assert_eq!(record.added_at_unix_ms, 5);
        assert_eq!(record.invite_token.as_deref(), Some("token"));

        let mut renamed = adopt("nova-2", "hub-1");
        renamed.status = Some("offline".into());
        let (records, record) = adopt_into(records, renamed, 20);
        assert_eq!(records.len(), 1, "the same peko by its Hub ID");
        assert_eq!(record.principal_name, "nova-2");
        assert_eq!(record.status, "offline");

        let (records, _) = adopt_into(records, adopt("ada", "hub-2"), 30);
        assert_eq!(records.len(), 2);
        let summary = RemotePrincipalSummary::from_record(&records[1]);
        assert_eq!(summary.hub_id.as_deref(), Some("hub-2"));
        assert_eq!(summary.runtime_id, "hub:http://127.0.0.1:3901");
    }

    /// A DM with someone else's peko becomes a record from the hub's
    /// answer for its Hub ID; without an owner handle or name it can't.
    #[test]
    fn a_dm_with_someone_elses_peko_becomes_a_record() {
        let hit = serde_json::json!({
            "name": "helper", "ownerHandle": "bob", "hubId": "hub-9",
            "localId": "prin_b", "exposure": "public", "status": "online",
            "avatar": "🐙", "description": "",
        });
        let r = dm_record("http://127.0.0.1:3901", "hub-9", &hit, 7).unwrap();
        assert_eq!(
            (r.owner.as_str(), r.principal_name.as_str()),
            ("bob", "helper")
        );
        assert_eq!(r.hub_id.as_deref(), Some("hub-9"));
        assert_eq!(r.avatar.as_deref(), Some("🐙"));
        assert_eq!(r.description, None);
        assert!(!r.from_account, "someone else's peko");
        let profile = project_hub_hit(&hit).unwrap();
        assert_eq!(profile.status, "online");
        assert_eq!(profile.local_id.as_deref(), Some("prin_b"));

        let ownerless = serde_json::json!({ "name": "helper", "ownerHandle": null });
        assert!(dm_record("http://127.0.0.1:3901", "hub-9", &ownerless, 7).is_none());
    }

    /// The DM adoption looks pekos up between reading the list and adding
    /// to it; one of yours adopted from your account meanwhile keeps its
    /// record (and `from_account`) — before, the stale list was written
    /// back over it.
    #[test]
    fn a_dm_record_found_meanwhile_leaves_your_adoption_alone() {
        let hit = serde_json::json!({ "name": "nova", "ownerHandle": "carol" });
        let from_dm = dm_record("http://127.0.0.1:3901", "hub-nova", &hit, 1).unwrap();
        let scout = dm_record(
            "http://127.0.0.1:3901",
            "hub-scout",
            &serde_json::json!({ "name": "scout", "ownerHandle": "bob" }),
            1,
        )
        .unwrap();
        // Adopted from the account while the hub was being asked.
        let mut req = adopt("nova", "hub-nova");
        req.owner = "carol".into();
        req.from_account = true;
        let (mut records, _) = adopt_into(Vec::new(), req, 2);

        let added = add_dm_records(&mut records, vec![from_dm, scout]);
        assert_eq!(added.len(), 1, "only scout is new");
        assert_eq!(records.len(), 2);
        let nova = records.iter().find(|r| r.principal_name == "nova").unwrap();
        assert!(nova.from_account, "yours stays yours");
    }

    /// A Hub ID the hub had no peko for is skipped for a while.
    #[test]
    fn a_missed_hub_id_is_not_asked_about_again_soon() {
        let id = "00000000-0000-4000-8000-00000000abcd";
        assert!(!recently_missed(id));
        note_missed(id);
        assert!(recently_missed(id));
        assert!(!recently_missed("00000000-0000-4000-8000-00000000abce"));
    }

    /// A peko first saved from a DM, then listed by your account, becomes
    /// one of yours; one of yours stays yours.
    #[test]
    fn your_account_claims_a_peko_first_saved_from_a_dm() {
        let from_dm = RemotePrincipalRecord {
            hub_url: "http://127.0.0.1:3901".into(),
            owner: "alice".into(),
            principal_name: "nova".into(),
            hub_id: Some("hub-1".into()),
            ..Default::default()
        };
        let mut req = adopt("nova", "hub-1");
        req.from_account = true;
        let (_, record) = adopt_into(vec![from_dm], req, 1);
        assert!(record.from_account);
        let (_, again) = adopt_into(vec![record], adopt("nova", "hub-1"), 2);
        assert!(again.from_account);
    }

    #[test]
    fn profile_reads_the_live_instance() {
        let payload = serde_json::json!({
            "liveInstance": {
                "status": "online",
                "avatar": "🦊",
                "description": "",
                "localId": "prin_1",
            }
        });
        assert_eq!(
            project_profile(&payload),
            Some(RemotePekoProfile {
                status: "online".into(),
                avatar: Some("🦊".into()),
                description: None,
                local_id: Some("prin_1".into()),
            })
        );
        // A hub that predates avatars sends none.
        let old = serde_json::json!({ "liveInstance": { "status": "offline" } });
        assert_eq!(project_profile(&old).unwrap().avatar, None);
        assert_eq!(project_profile(&serde_json::json!({})), None);
    }

    #[test]
    fn test_parse_share_url_canonical_form() {
        let (hub, owner, name, token) =
            parse_share_url("https://pekohub.org/peko/alice/coding-assistant")
                .expect("the /peko/ form should parse");
        assert_eq!(
            hub, "https://api.pekohub.ai",
            "calls go to the official API host"
        );
        assert_eq!(owner, "alice");
        assert_eq!(name, "coding-assistant");
        assert!(token.is_none());
    }

    #[test]
    fn test_parse_share_url_id_form() {
        for raw in [
            "https://pekohub.ai/@alice/coding-assistant",
            "https://pekohub.ai/%40Alice/coding-assistant/",
        ] {
            let (hub, owner, name, token) = parse_share_url(raw).expect("the /@ form should parse");
            assert_eq!(hub, "https://api.pekohub.ai", "{raw}");
            assert_eq!(owner, "alice", "{raw}");
            assert_eq!(name, "coding-assistant", "{raw}");
            assert!(token.is_none());
        }
        let (_, _, _, token) =
            parse_share_url("http://localhost:3000/@alice/helper?token=t1").unwrap();
        assert_eq!(token.as_deref(), Some("t1"));
        assert!(parse_share_url("https://pekohub.ai/@alice").is_none());
        assert!(parse_share_url("https://pekohub.ai/@alice/a/b").is_none());
    }

    #[test]
    fn test_parse_share_url_legacy_p_form_still_accepted() {
        // Pre-rename share links (`/p/{owner}/{name}`) keep parsing —
        // the hub redirects them and users still have old links.
        let (hub, owner, name, token) =
            parse_share_url("https://pekohub.org/p/alice/coding-assistant")
                .expect("legacy /p/ form should parse");
        assert_eq!(
            hub, "https://api.pekohub.ai",
            "calls go to the official API host"
        );
        assert_eq!(owner, "alice");
        assert_eq!(name, "coding-assistant");
        assert!(token.is_none());
    }

    #[test]
    fn test_parse_share_url_with_token() {
        let (hub, owner, name, token) =
            parse_share_url("https://pekohub.org/peko/alice/coding-assistant?token=abc123")
                .expect("token-bearing form should parse");
        assert_eq!(
            hub, "https://api.pekohub.ai",
            "calls go to the official API host"
        );
        assert_eq!(owner, "alice");
        assert_eq!(name, "coding-assistant");
        assert_eq!(token.as_deref(), Some("abc123"));
    }

    #[test]
    fn test_parse_share_url_api_form() {
        let (hub, owner, name, token) =
            parse_share_url("https://pekohub.org/v1/public/pekos/alice/coding-assistant")
                .expect("api form should parse");
        assert_eq!(
            hub, "https://api.pekohub.ai",
            "calls go to the official API host"
        );
        assert_eq!(owner, "alice");
        assert_eq!(name, "coding-assistant");
        assert!(token.is_none());
    }

    #[test]
    fn test_parse_share_url_retired_api_form_still_accepted() {
        // The retired `/v1/public/principals/...` API URL 404s on the
        // hub, but old copied links should still resolve — the
        // resolver hits the NEW endpoint with the parsed owner/name.
        let (hub, owner, name, _token) =
            parse_share_url("https://pekohub.org/v1/public/principals/alice/coding-assistant")
                .expect("retired api form should parse");
        assert_eq!(
            hub, "https://api.pekohub.ai",
            "calls go to the official API host"
        );
        assert_eq!(owner, "alice");
        assert_eq!(name, "coding-assistant");
    }

    #[test]
    fn test_parse_share_url_keeps_a_self_hosted_origin() {
        let (hub, owner, _, _) = parse_share_url("http://localhost:3000/peko/alice/helper")
            .expect("self-hosted share links parse");
        assert_eq!(hub, "http://localhost:3000");
        assert_eq!(owner, "alice");
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
            ..Default::default()
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
            ..Default::default()
        };
        let summary = RemotePrincipalSummary::from_record(&r);
        assert_eq!(summary.runtime_id, "hub:https://pekohub.org");
    }
}
