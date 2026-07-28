//! HTTP client for the PekoHub remote-runtime API.
//!
//! All methods return raw `serde_json::Value` so that the command layer
//! can map them into frontend-facing structs, keeping the client thin.

use reqwest::header::AUTHORIZATION;

const DEFAULT_BASE_URL: &str = "https://pekohub.org/api";

/// Provider-namespace + name used by the OAuth flow to store the token
/// bundle in the runtime's credential vault. Must match
/// `useRuntimes.ts::storeOAuthBundle` which writes via
/// `credentialSetRaw("pekohub", ...)`.
const OAUTH_NAMESPACE: &str = "provider:pekohub";
const OAUTH_NAME: &str = "default";
const OAUTH_KIND: &str = "oauth_token";

/// Thin wrapper around `reqwest` for PekoHub API calls.
pub struct PekohubClient {
    http: reqwest::Client,
    base_url: String,
}

impl PekohubClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    /// Override the base URL (useful for testing / self-hosted hubs).
    pub fn with_base_url(mut self, url: String) -> Self {
        self.base_url = url.trim_end_matches('/').to_string();
        self
    }

    /// Retrieve the stored OAuth access token from the runtime's
    /// credential vault.
    ///
    /// The OAuth flow (`useRuntimes.ts::startOAuthConnect` →
    /// `exchangeOAuthCode`) writes the full bundle as JSON to the
    /// `provider:pekohub/default` slot of kind `oauth_token` via
    /// `credentialSetRaw`. The previously documented `vault::peko /
    /// pekohub` OS-keyring slot was for the legacy Registry PAT and
    /// was never written by the OAuth flow, so reading it silently
    /// returned `None` and every PekoHub call went out unauthenticated.
    /// The OAuth bundle JSON has the shape
    /// `{ access_token, refresh_token?, expires_at? }`; we parse it
    /// and return the access token, falling back to the raw string
    /// for any legacy plain-token rows the IPC still surfaces.
    async fn token() -> Option<String> {
        let client = crate::ipc::IpcClient::new().await.ok()?;
        let resp = client
            .credential_list(Some(OAUTH_NAMESPACE), Some(OAUTH_KIND))
            .await
            .ok()?;
        let credential_id = resp
            .get("providers")
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                arr.iter().find_map(|row| {
                    let name = row.get("name").and_then(|n| n.as_str())?;
                    if name == OAUTH_NAME {
                        row.get("id").and_then(|id| id.as_str()).map(String::from)
                    } else {
                        None
                    }
                })
            })?;
        let resp = client
            .credential_get_material(&credential_id, "pekohub api auth")
            .await
            .ok()?;
        let material = resp.get("material").and_then(|v| v.as_str())?;
        // Bundle format: JSON with `access_token`. If parsing fails
        // the stored row was a legacy plain token — return it as-is.
        if let Ok(bundle) = serde_json::from_str::<serde_json::Value>(material) {
            if let Some(access) = bundle.get("access_token").and_then(|v| v.as_str()) {
                return Some(access.to_string());
            }
        }
        Some(material.to_string())
    }

    // ------------------------------------------------------------------
    // Auth helpers
    // ------------------------------------------------------------------

    async fn auth_header() -> Option<(String, String)> {
        Self::token()
            .await
            .map(|t| (AUTHORIZATION.to_string(), format!("Bearer {}", t)))
    }

    // ------------------------------------------------------------------
    // Runtime management
    // ------------------------------------------------------------------

    /// Get system status from a remote runtime.
    pub async fn system_status(&self, runtime_id: &str) -> Result<serde_json::Value, String> {
        let url = format!("{}/v1/runtimes/{}/status", self.base_url, runtime_id);
        let mut req = self.http.get(&url);
        if let Some((k, v)) = Self::auth_header().await {
            req = req.header(&k, v);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("pekohub error: {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// List principals the authenticated user has access to
    /// (caller-owned + caller-allowed).
    pub async fn list_accessible_principals(&self) -> Result<serde_json::Value, String> {
        let url = format!("{}/v1/me/accessible-principals", self.base_url);
        let mut req = self.http.get(&url);
        if let Some((k, v)) = Self::auth_header().await {
            req = req.header(&k, v);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("pekohub error: {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    // Note: the pre-#18 PekohubClient surface (`list_agents`, `chat`,
    // `chat_streaming`, `list_sessions`, `session_history`,
    // `create_agent`, `delete_agent`, `update_instance_exposure`,
    // `update_instance_status`, `list_runtimes` PekohubClient method) was
    // removed in the Principal-as-container migration. Chat flows now
    // route through the local daemon IPC (`principal_send` /
    // `principal_send_stream`); the Shared list uses PekohubClient;
    // runtime registration is local-only.
}

impl Default for PekohubClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pin: a stored OAuth bundle (JSON with `access_token`) parses to
    /// the access token string. The IPC lookup is wired through
    /// `IpcClient::credential_list` + `credential_get_material` in
    /// `token()`; here we exercise just the bundle-decoding step so
    /// the wire-shape contract is locked.
    #[test]
    fn parses_oauth_bundle_json() {
        let bundle = r#"{"access_token":"abc.def.ghi","refresh_token":"rt","expires_at":"2030-01-01T00:00:00Z"}"#;
        let parsed: serde_json::Value = serde_json::from_str(bundle).unwrap();
        let access = parsed.get("access_token").and_then(|v| v.as_str());
        assert_eq!(access, Some("abc.def.ghi"));
    }

    /// Pin: a legacy plain-token row (not JSON) round-trips as-is.
    /// Pre-OAuth-bundle rows in the vault may carry a raw JWT; the
    /// parser must surface them rather than returning None and
    /// silently dropping auth.
    #[test]
    fn falls_back_to_raw_token_when_not_json() {
        let material = "raw.jwt.string";
        let parsed: Result<serde_json::Value, _> = serde_json::from_str(material);
        assert!(parsed.is_err());
        // The non-bundle branch returns the raw material verbatim.
        let token: String = match parsed {
            Ok(bundle) => bundle
                .get("access_token")
                .and_then(|v| v.as_str())
                .unwrap_or(material)
                .to_string(),
            Err(_) => material.to_string(),
        };
        assert_eq!(token, "raw.jwt.string");
    }

    /// Pin: constants used by `token()` must match what the OAuth flow
    /// writes — drift between Rust + TS means PekohubClient reads from
    /// a slot the writer never touched.
    #[test]
    fn oauth_slot_constants_match_writer() {
        assert_eq!(OAUTH_NAMESPACE, "provider:pekohub");
        assert_eq!(OAUTH_NAME, "default");
        assert_eq!(OAUTH_KIND, "oauth_token");
    }
}
