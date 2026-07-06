//! HTTP client for the PekoHub remote-runtime API.
//!
//! All methods return raw `serde_json::Value` so that the command layer
//! can map them into frontend-facing structs, keeping the client thin.

use reqwest::header::AUTHORIZATION;

const DEFAULT_BASE_URL: &str = "https://pekohub.org/api";

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

    /// Retrieve the stored JWT from the OS keyring, if any.
    fn token() -> Option<String> {
        crate::vault::get_credential("peko", "pekohub")
            .ok()
            .flatten()
    }

    // ------------------------------------------------------------------
    // Auth helpers
    // ------------------------------------------------------------------

    fn auth_header() -> Option<(String, String)> {
        Self::token().map(|t| (AUTHORIZATION.to_string(), format!("Bearer {}", t)))
    }

    // ------------------------------------------------------------------
    // Runtime management
    // ------------------------------------------------------------------

    /// Get system status from a remote runtime.
    pub async fn system_status(&self, runtime_id: &str) -> Result<serde_json::Value, String> {
        let url = format!("{}/v1/runtimes/{}/status", self.base_url, runtime_id);
        let mut req = self.http.get(&url);
        if let Some((k, v)) = Self::auth_header() {
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
        if let Some((k, v)) = Self::auth_header() {
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
