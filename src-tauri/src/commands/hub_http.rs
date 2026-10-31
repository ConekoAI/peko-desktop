//! Hub HTTP calls the webview can't make itself.
//!
//! The webview's content security policy (`tauri.conf.json`) allows no
//! outside hosts, so a `fetch()` to a hub fails in a built app. These
//! commands make the few hub calls the frontend needs. They are a fixed
//! set — the OAuth token endpoint and three named resources — not a
//! general proxy, which would undo what the policy protects. Each returns
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
    /// `GET /v1/discovery/search`: the public directory.
    DiscoverySearch,
}

impl HubResource {
    fn path(self) -> &'static str {
        match self {
            Self::Runtimes => "/v1/runtimes",
            Self::AccessiblePekos => "/v1/me/accessible-pekos",
            Self::DiscoverySearch => "/v1/discovery/search",
        }
    }
}

/// `base` joined with an absolute `path`, for an http(s) hub only.
fn hub_url(base: &str, path: &str) -> Result<reqwest::Url, String> {
    let base =
        reqwest::Url::parse(base.trim()).map_err(|e| format!("not a hub URL ({base}): {e}"))?;
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
    if let Some(token) = access_token {
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

fn check_grant(params: &serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    match params.get("grant_type").and_then(|v| v.as_str()) {
        Some("authorization_code" | "refresh_token") => Ok(()),
        other => Err(format!("unsupported grant type: {other:?}")),
    }
}

/// The public share link of a peko on this runtime:
/// `<hub>/peko/<owner's handle>/<name>`, from the hub the runtime is
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
        .map_err(|e| format!("principal_get failed: {e}"))?;
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

/// `<hub>/peko/<ownerHandle>/<name>` from the hub's directory answer.
fn share_link(hub: &str, resolution: &serde_json::Value) -> Option<String> {
    let handle = resolution.get("ownerHandle")?.as_str()?;
    let name = resolution.get("name")?.as_str()?;
    Some(format!(
        "{}/peko/{}/{}",
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
    use super::*;

    #[test]
    fn resources_map_to_fixed_paths() {
        let url = hub_url("https://pekohub.ai/", HubResource::AccessiblePekos.path()).unwrap();
        assert_eq!(url.as_str(), "https://pekohub.ai/v1/me/accessible-pekos");
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
        let r: HubResource = serde_json::from_str("\"discovery_search\"").unwrap();
        assert_eq!(r, HubResource::DiscoverySearch);
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
            share_link("https://pekohub.ai/", &resolution).as_deref(),
            Some("https://pekohub.ai/peko/tester/remy")
        );
        // A hub that predates `ownerHandle` gives no link, not a wrong one.
        assert_eq!(
            share_link("https://pekohub.ai", &serde_json::json!({ "name": "remy" })),
            None
        );
        assert_eq!(urlencoding_segment("a b/c"), "a%20b%2Fc");
    }
}
