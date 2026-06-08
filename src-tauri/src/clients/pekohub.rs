//! HTTP client for the PekoHub remote-runtime API.
//!
//! All methods return raw `serde_json::Value` so that the command layer
//! can map them into frontend-facing structs, keeping the client thin.

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::json;

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

    /// List runtimes registered to the authenticated account.
    pub async fn list_runtimes(&self) -> Result<serde_json::Value, String> {
        let url = format!("{}/v1/runtimes", self.base_url);
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

    /// List agents (instances) on a specific remote runtime.
    pub async fn list_agents(&self, runtime_id: &str) -> Result<serde_json::Value, String> {
        let url = format!("{}/v1/instances?runtime_id={}", self.base_url, runtime_id);
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

    /// Send a chat message to an agent on a remote runtime.
    /// Returns the HTTP response body as text (usually SSE or JSON).
    pub async fn chat(&self, instance_id: &str, message: &str) -> Result<String, String> {
        let url = format!("{}/v1/instances/{}/chat", self.base_url, instance_id);
        let mut req = self
            .http
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .json(&json!({ "message": message }));
        if let Some((k, v)) = Self::auth_header() {
            req = req.header(&k, v);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("pekohub error: {}", resp.status()));
        }
        resp.text().await.map_err(|e| e.to_string())
    }

    /// Get session list for an agent on a remote runtime.
    pub async fn list_sessions(&self, instance_id: &str) -> Result<serde_json::Value, String> {
        let url = format!("{}/v1/instances/{}/sessions", self.base_url, instance_id);
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

    /// Get session history for an agent on a remote runtime.
    pub async fn session_history(
        &self,
        instance_id: &str,
        session_id: &str,
    ) -> Result<serde_json::Value, String> {
        let url = format!(
            "{}/v1/instances/{}/sessions/{}",
            self.base_url, instance_id, session_id
        );
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

    /// Create a new agent on a remote runtime.
    pub async fn create_agent(
        &self,
        runtime_id: &str,
        name: &str,
        provider: &str,
        model: &str,
    ) -> Result<serde_json::Value, String> {
        let url = format!("{}/v1/instances", self.base_url);
        let mut req = self
            .http
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .json(&json!({
                "runtime_id": runtime_id,
                "name": name,
                "provider": provider,
                "model": model,
            }));
        if let Some((k, v)) = Self::auth_header() {
            req = req.header(&k, v);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("pekohub error: {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// Delete an agent on a remote runtime.
    pub async fn delete_agent(&self, instance_id: &str) -> Result<serde_json::Value, String> {
        let url = format!("{}/v1/instances/{}", self.base_url, instance_id);
        let mut req = self.http.delete(&url);
        if let Some((k, v)) = Self::auth_header() {
            req = req.header(&k, v);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("pekohub error: {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

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
}

impl Default for PekohubClient {
    fn default() -> Self {
        Self::new()
    }
}
