//! Hub HTTP calls the webview can't make itself.
//!
//! The webview's content security policy (`tauri.conf.json`) allows no
//! outside hosts, so a `fetch()` to a hub fails in a built app. These
//! commands make the few hub calls the frontend needs. They are a fixed
//! set — the OAuth token endpoint, three named resources, the account
//! (with its picture) and its notifications — not a general proxy, which would undo what
//! the policy protects. Each returns
//! the hub's status and body as they came, so the frontend keeps its own
//! handling of both.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::state::AppState;

const TIMEOUT: Duration = Duration::from_secs(20);

/// A hub's answer: its HTTP status and body text.
#[derive(Debug, Serialize)]
pub struct HubResponse {
    pub status: u16,
    pub body: String,
}

/// The hub resources the frontend reads.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum HubResource {
    /// `GET /v1/runtimes`: the signed-in account's runtimes.
    Runtimes,
    /// `GET /v1/me/accessible-pekos`: pekos the account can reach.
    AccessiblePekos,
    /// `GET /v1/search`: one search over people, pekos and seeds. People
    /// and pekos are found only by their exact ID (hub ADR-009).
    Search,
}

impl HubResource {
    fn path(self) -> &'static str {
        match self {
            Self::Runtimes => "/v1/runtimes",
            Self::AccessiblePekos => "/v1/me/accessible-pekos",
            Self::Search => "/v1/search",
        }
    }
}

/// `base` joined with an absolute `path`, for an http(s) hub only.
fn hub_url(base: &str, path: &str) -> Result<reqwest::Url, String> {
    let api = crate::clients::hub_origin::hub_api_base(base);
    let base = reqwest::Url::parse(&api).map_err(|e| format!("not a hub URL ({base}): {e}"))?;
    if !matches!(base.scheme(), "http" | "https") {
        return Err(format!("not a hub URL ({base}): use http or https"));
    }
    base.join(path).map_err(|e| e.to_string())
}

async fn send(request: reqwest::RequestBuilder, host: &str) -> Result<HubResponse, String> {
    let resp = request
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach {host}: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("The answer from {host} broke off: {e}"))?;
    Ok(HubResponse { status, body })
}

fn host_of(url: &reqwest::Url) -> String {
    match (url.host_str(), url.port()) {
        (Some(host), Some(port)) => format!("{host}:{port}"),
        (Some(host), None) => host.to_string(),
        _ => url.to_string(),
    }
}

/// `GET` one of [`HubResource`] on the hub at `base_url`, with the
/// account's token when given and `query` as the query string.
#[tauri::command]
pub async fn hub_get(
    state: tauri::State<'_, AppState>,
    base_url: String,
    resource: HubResource,
    access_token: Option<String>,
    query: Option<Vec<(String, String)>>,
) -> Result<HubResponse, String> {
    let mut url = hub_url(&base_url, resource.path())?;
    if let Some(query) = query {
        url.query_pairs_mut().extend_pairs(query);
    }
    let host = host_of(&url);
    let mut request = state.http.get(url).header("Accept", "application/json");
    if let Some(given) = access_token {
        // The webview passes the token it read when it signed in; an
        // access token lasts an hour, and after that every read was a
        // 401 (your pekos on other computers stopped updating). Use the
        // signed-in account's token, refreshed when it's expiring.
        let api = crate::clients::hub_origin::hub_api_base(&base_url);
        let token = crate::clients::hub_auth::access_token(&state.http, &api)
            .await
            .unwrap_or(given);
        request = request.bearer_auth(token);
    }
    send(request, &host).await
}

/// `POST /oauth/token` on the hub at `base_url`: the authorization-code
/// exchange or a refresh. `params` is the JSON body; only those two
/// grant types are sent.
#[tauri::command]
pub async fn hub_oauth_token(
    state: tauri::State<'_, AppState>,
    base_url: String,
    params: serde_json::Map<String, serde_json::Value>,
) -> Result<HubResponse, String> {
    check_grant(&params)?;
    let url = hub_url(&base_url, "/oauth/token")?;
    let host = host_of(&url);
    send(state.http.post(url).json(&params), &host).await
}

/// `POST /oauth/revoke` on the hub at `base_url`: signing out revokes the
/// refresh token there (RFC 7009), not just here.
#[tauri::command]
pub async fn hub_oauth_revoke(
    state: tauri::State<'_, AppState>,
    base_url: String,
    token: String,
) -> Result<HubResponse, String> {
    let url = hub_url(&base_url, "/oauth/revoke")?;
    let host = host_of(&url);
    send(
        state
            .http
            .post(url)
            .json(&serde_json::json!({ "client_id": "peko-desktop", "token": token })),
        &host,
    )
    .await
}

fn check_grant(params: &serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    match params.get("grant_type").and_then(|v| v.as_str()) {
        Some("authorization_code" | "refresh_token") => Ok(()),
        other => Err(format!("unsupported grant type: {other:?}")),
    }
}

/// The signed-in PekoHub account, as the app shows it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubAccount {
    pub handle: String,
    pub display_name: Option<String>,
    /// The account's picture as a `data:` URL: the webview's content
    /// security policy loads no image from another host, so the backend
    /// fetches it (an `https` image of at most [`AVATAR_MAX_BYTES`]).
    pub avatar: Option<String>,
}

const AVATAR_MAX_BYTES: usize = 512 * 1024;

/// The signed-in account (`GET /v1/auth/me`) on the hub at `hub`, with its
/// picture; `None` when the app isn't signed in or the hub no longer takes
/// the sign-in.
#[tauri::command]
pub async fn hub_account(
    state: tauri::State<'_, AppState>,
    hub: String,
) -> Result<Option<HubAccount>, String> {
    let api = crate::clients::hub_origin::hub_api_base(&hub);
    let Some(token) = crate::clients::hub_auth::access_token(&state.http, &api).await else {
        return Ok(None);
    };
    let url = hub_url(&hub, "/v1/auth/me")?;
    let host = host_of(&url);
    let answer = send(
        state
            .http
            .get(url)
            .header("Accept", "application/json")
            .bearer_auth(token),
        &host,
    )
    .await?;
    if answer.status == 401 {
        return Ok(None);
    }
    if !(200..300).contains(&answer.status) {
        return Err(format!("{host} answered {} for the account", answer.status));
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Me {
        namespace: String,
        display_name: Option<String>,
        avatar_url: Option<String>,
    }
    let me: Me = serde_json::from_str(&answer.body).map_err(|e| e.to_string())?;
    let avatar = match me.avatar_url.as_deref() {
        Some(url) => avatar_data_url(&state.http, url).await,
        None => None,
    };
    Ok(Some(HubAccount {
        handle: me.namespace,
        display_name: me.display_name,
        avatar,
    }))
}

/// `url`'s image as a `data:` URL, or `None` when it isn't an `https`
/// image of at most [`AVATAR_MAX_BYTES`] (the app shows initials then).
async fn avatar_data_url(http: &reqwest::Client, url: &str) -> Option<String> {
    use base64::Engine as _;
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.scheme() != "https" {
        return None;
    }
    let resp = http
        .get(parsed)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)?
        .to_str()
        .ok()?
        .split(';')
        .next()?
        .trim()
        .to_string();
    if !content_type.starts_with("image/") || content_type.contains("svg") {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > AVATAR_MAX_BYTES {
        return None;
    }
    Some(format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

/// The signed-in account's notifications on the hub at `hub` (`GET
/// /v1/me/notifications`) — offers to take a peko, new sign-ins,
/// moderators' actions; the Hub sends no email. Uses the stored sign-in,
/// refreshed one call at a time (`hub_auth`).
#[tauri::command]
pub async fn hub_notifications(
    state: tauri::State<'_, AppState>,
    hub: String,
) -> Result<HubResponse, String> {
    let api = crate::clients::hub_origin::hub_api_base(&hub);
    let token = crate::clients::hub_auth::access_token(&state.http, &api)
        .await
        .ok_or_else(|| "Sign in to PekoHub first.".to_string())?;
    let url = hub_url(&hub, "/v1/me/notifications")?;
    let host = host_of(&url);
    send(
        state
            .http
            .get(url)
            .header("Accept", "application/json")
            .bearer_auth(token),
        &host,
    )
    .await
}

/// Mark notifications read (`POST /v1/me/notifications/read`): `ids`, or
/// all of them when `None`.
#[tauri::command]
pub async fn hub_notifications_read(
    state: tauri::State<'_, AppState>,
    hub: String,
    ids: Option<Vec<String>>,
) -> Result<HubResponse, String> {
    let api = crate::clients::hub_origin::hub_api_base(&hub);
    let token = crate::clients::hub_auth::access_token(&state.http, &api)
        .await
        .ok_or_else(|| "Sign in to PekoHub first.".to_string())?;
    let url = hub_url(&hub, "/v1/me/notifications/read")?;
    let host = host_of(&url);
    let body = match ids {
        Some(ids) => serde_json::json!({ "ids": ids }),
        None => serde_json::json!({}),
    };
    send(state.http.post(url).bearer_auth(token).json(&body), &host).await
}

/// The public share link of a peko on this runtime — its ID as a page,
/// `<website>/@<owner's handle>/<name>` (hub ADR-009) — from the hub the runtime is
/// registered with. The runtime knows the hub and the peko's hub id; the
/// hub knows the owner's handle. `None` when the peko isn't public, or
/// the runtime isn't registered, or the hub doesn't know the peko.
#[tauri::command]
pub async fn peko_share_link(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<Option<String>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let peko = client
        .principal_get(&name)
        .await
        .map_err(|e| format!("Couldn't load the peko: {e}"))?;
    let Some(hub_id) = public_hub_id(&peko) else {
        return Ok(None);
    };
    let tunnel = client
        .tunnel_status()
        .await
        .map_err(|e| format!("tunnel_status failed: {e}"))?;
    let Some(hub) = tunnel.get("hub_url").and_then(|v| v.as_str()) else {
        return Ok(None);
    };
    let url = hub_url(hub, &format!("/v1/principals/by-hub-id/{hub_id}"))?;
    let host = host_of(&url);
    let answer = send(
        state.http.get(url).header("Accept", "application/json"),
        &host,
    )
    .await?;
    if answer.status == 404 {
        return Ok(None);
    }
    if !(200..300).contains(&answer.status) {
        return Err(format!("{host} answered {}", answer.status));
    }
    let resolution: serde_json::Value = serde_json::from_str(&answer.body)
        .map_err(|e| format!("unexpected answer from {host}: {e}"))?;
    Ok(share_link(hub, &resolution))
}

/// The hub id of a public peko, from the runtime's `principal_get` answer.
fn public_hub_id(answer: &serde_json::Value) -> Option<String> {
    let peko = answer.get("principal")?;
    if peko.get("exposure").and_then(|v| v.as_str()) != Some("public") {
        return None;
    }
    peko.get("hub_id")
        .and_then(|v| v.as_str())
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

/// The peko's share link from the hub's directory answer: the hub's own
/// `shareUrl` (on its website), else `<website>/@<ownerHandle>/<name>`.
fn share_link(hub: &str, resolution: &serde_json::Value) -> Option<String> {
    if let Some(url) = resolution.get("shareUrl").and_then(|v| v.as_str()) {
        return Some(url.to_string());
    }
    let hub = crate::clients::hub_origin::hub_web_origin(hub);
    let hub = hub.as_str();
    let handle = resolution.get("ownerHandle")?.as_str()?;
    let name = resolution.get("name")?.as_str()?;
    Some(format!(
        "{}/@{}/{}",
        hub.trim_end_matches('/'),
        urlencoding_segment(handle),
        urlencoding_segment(name)
    ))
}

/// Percent-encode one path segment (handles and names are usually
/// plain, but a segment must never break the path).
fn urlencoding_segment(segment: &str) -> String {
    let mut url = reqwest::Url::parse("http://x/").expect("static URL parses");
    url.path_segments_mut()
        .expect("http URL has segments")
        .push(segment);
    url.path().trim_start_matches('/').to_string()
}

#[cfg(test)]
mod tests {

    /// The webview gets only an `https` image as a picture.
    #[tokio::test]
    async fn an_avatar_is_fetched_only_over_https() {
        let http = reqwest::Client::new();
        assert_eq!(
            avatar_data_url(&http, "http://example.com/a.png").await,
            None
        );
        assert_eq!(
            avatar_data_url(&http, "data:image/png;base64,AAAA").await,
            None
        );
        assert_eq!(avatar_data_url(&http, "not a url").await, None);
    }
    use super::*;

    #[test]
    fn resources_map_to_fixed_paths() {
        let url = hub_url(
            "https://api.pekohub.ai/",
            HubResource::AccessiblePekos.path(),
        )
        .unwrap();
        assert_eq!(
            url.as_str(),
            "https://api.pekohub.ai/v1/me/accessible-pekos"
        );
        // The website's address reaches its API.
        let url = hub_url("https://pekohub.ai", HubResource::Runtimes.path()).unwrap();
        assert_eq!(url.as_str(), "https://api.pekohub.ai/v1/runtimes");
        // An absolute path replaces any path on the base, as `new URL(path, base)` does.
        let url = hub_url(
            "http://localhost:3000/somewhere",
            HubResource::Runtimes.path(),
        )
        .unwrap();
        assert_eq!(url.as_str(), "http://localhost:3000/v1/runtimes");
        assert_eq!(host_of(&url), "localhost:3000");
    }

    #[test]
    fn only_http_hubs() {
        assert!(hub_url("file:///etc/passwd", "/v1/runtimes").is_err());
        assert!(hub_url("not a url", "/v1/runtimes").is_err());
    }

    #[test]
    fn resources_deserialize_from_snake_case() {
        let r: HubResource = serde_json::from_str("\"search\"").unwrap();
        assert_eq!(r, HubResource::Search);
        assert_eq!(r.path(), "/v1/search");
        // The peko directory is gone (hub ADR-009).
        assert!(serde_json::from_str::<HubResource>("\"discovery_search\"").is_err());
        assert!(serde_json::from_str::<HubResource>("\"anything_else\"").is_err());
    }

    #[test]
    fn only_the_two_oauth_grants() {
        let grant = |g: &str| {
            let mut m = serde_json::Map::new();
            m.insert("grant_type".into(), g.into());
            check_grant(&m)
        };
        assert!(grant("authorization_code").is_ok());
        assert!(grant("refresh_token").is_ok());
        assert!(grant("client_credentials").is_err());
        assert!(check_grant(&serde_json::Map::new()).is_err());
    }

    #[test]
    fn share_link_from_the_runtime_and_the_hub() {
        let answer = serde_json::json!({
            "principal": { "name": "remy", "exposure": "public", "hub_id": "156f1a95-d977-4c4a-979e-8ed4848ae6eb" }
        });
        assert_eq!(
            public_hub_id(&answer).as_deref(),
            Some("156f1a95-d977-4c4a-979e-8ed4848ae6eb")
        );
        let private = serde_json::json!({ "principal": { "exposure": "private", "hub_id": "x" } });
        assert_eq!(public_hub_id(&private), None);
        let unregistered =
            serde_json::json!({ "principal": { "exposure": "public", "hub_id": null } });
        assert_eq!(public_hub_id(&unregistered), None);

        let resolution = serde_json::json!({ "name": "remy", "ownerHandle": "tester" });
        assert_eq!(
            share_link("https://api.pekohub.ai/", &resolution).as_deref(),
            Some("https://pekohub.ai/@tester/remy"),
            "links name the website, not the API"
        );
        let with_share_url = serde_json::json!({
            "name": "remy", "ownerHandle": "tester",
            "shareUrl": "https://pekohub.ai/@tester/remy"
        });
        assert_eq!(
            share_link("https://api.pekohub.ai", &with_share_url).as_deref(),
            Some("https://pekohub.ai/@tester/remy")
        );
        // A hub that predates `ownerHandle` gives no link, not a wrong one.
        assert_eq!(
            share_link("https://pekohub.ai", &serde_json::json!({ "name": "remy" })),
            None
        );
        assert_eq!(urlencoding_segment("a b/c"), "a%20b%2Fc");
    }
}
