//! IPC client for communicating with the peko daemon.
//!
//! Protocol version: 1
//! - Version 1: Initial protocol with Ping, Execute, AsyncSpawn, AsyncCancel
//! - Future versions will add CRUD packets for agents, teams, sessions, etc.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::Emitter;
use thiserror::Error;

/// Current IPC protocol version
pub const PROTOCOL_VERSION: u16 = 1;

/// Every request packet includes this header
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RequestHeader {
    pub protocol_version: u16,
    pub request_id: u64,
}

#[derive(Error, Debug)]
pub enum IpcError {
    #[error("connection failed: {0}")]
    ConnectionFailed(String),
    #[error("send failed: {0}")]
    SendFailed(String),
    #[error("receive failed: {0}")]
    ReceiveFailed(String),
    #[error("timeout")]
    Timeout,
    #[error("serialization error: {0}")]
    Serialization(String),
}

pub type Result<T> = std::result::Result<T, IpcError>;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PongResponse {
    pub request_id: u64,
    pub version: String,
    pub uptime_secs: u64,
}

/// Stream event emitted to the frontend via Tauri events.
/// This is the desktop's unified shape — the daemon uses different
/// packet shapes (ResponsePacket) which get mapped into this.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum StreamEvent {
    /// Text chunk from the assistant (mapped from daemon's ResponsePacket::Text)
    #[serde(rename = "chunk")]
    Chunk { content: String, timestamp: String },
    /// Tool call started
    #[serde(rename = "tool_call")]
    ToolCall {
        name: String,
        arguments: String,
        timestamp: String,
    },
    /// Tool execution result
    #[serde(rename = "tool_result")]
    ToolResult { output: String, timestamp: String },
    /// Stream completed successfully
    #[serde(rename = "done")]
    Done { timestamp: String },
    /// Fatal error during streaming
    #[serde(rename = "error")]
    Error { message: String, timestamp: String },
}

/// Check if a response indicates a protocol version mismatch.
/// Returns true if the daemon rejected the request due to version.
pub fn is_version_mismatch(response: &serde_json::Value) -> bool {
    response.get("type").and_then(|v| v.as_str()) == Some("error")
        && response
            .get("message")
            .and_then(|v| v.as_str())
            .map(|m| m.contains("protocol version") || m.contains("unsupported"))
            .unwrap_or(false)
}

/// Async IPC client for communicating with the peko daemon.
pub struct IpcClient {
    #[cfg(windows)]
    socket: tokio::net::UdpSocket,
    #[cfg(unix)]
    socket: tokio::net::UnixDatagram,
    #[cfg(unix)]
    _tmp_path: std::path::PathBuf,
}

async fn ensure_daemon() -> Result<()> {
    crate::daemon::ensure_running_async().await.map_err(|e| {
        IpcError::ConnectionFailed(format!("daemon not running and auto-start failed: {}", e))
    })?;
    Ok(())
}

impl IpcClient {
    /// Create a new IPC client connected to the default daemon endpoint.
    #[cfg(windows)]
    pub async fn new() -> Result<Self> {
        let socket = tokio::net::UdpSocket::bind("127.0.0.1:0")
            .await
            .map_err(|e| IpcError::ConnectionFailed(e.to_string()))?;
        Ok(Self { socket })
    }

    #[cfg(unix)]
    pub async fn new() -> Result<Self> {
        let tmp =
            std::env::temp_dir().join(format!("peko_desktop_ipc_{}.sock", std::process::id()));
        let _ = tokio::fs::remove_file(&tmp).await;
        let socket = tokio::net::UnixDatagram::bind(&tmp)
            .map_err(|e| IpcError::ConnectionFailed(e.to_string()))?;
        Ok(Self {
            socket,
            _tmp_path: tmp,
        })
    }

    /// Send a request and wait for a single response (non-streaming).
    async fn request_response(&self, request: serde_json::Value) -> Result<serde_json::Value> {
        let bytes =
            serde_json::to_vec(&request).map_err(|e| IpcError::Serialization(e.to_string()))?;
        let mut buf = vec![0u8; 65536];

        #[cfg(windows)]
        {
            self.socket
                .send_to(&bytes, "127.0.0.1:11435")
                .await
                .map_err(|e| IpcError::SendFailed(e.to_string()))?;
        }
        #[cfg(unix)]
        {
            let sock_path = default_socket_path();
            self.socket
                .send_to(&bytes, &sock_path)
                .await
                .map_err(|e| IpcError::SendFailed(e.to_string()))?;
        }

        let len = tokio::time::timeout(Duration::from_secs(10), self.socket.recv_from(&mut buf))
            .await
            .map_err(|_| IpcError::Timeout)?
            .map_err(|e| IpcError::ReceiveFailed(e.to_string()))?
            .0;

        let value: serde_json::Value = serde_json::from_slice(&buf[..len])
            .map_err(|e| IpcError::Serialization(e.to_string()))?;
        Ok(value)
    }

    /// Send a ping and wait for a pong response.
    pub async fn ping(&self) -> Result<PongResponse> {
        ensure_daemon().await?;

        let request = serde_json::json!({
            "type": "ping",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64
        });

        let value = self.request_response(request).await?;

        Ok(PongResponse {
            request_id: value
                .get("request_id")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            version: value
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            uptime_secs: value
                .get("uptime_secs")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
        })
    }

    // ── Agent CRUD ────────────────────────────────────────────────

    pub async fn list_agents(&self) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "agent_list",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "team_filter": null,
        });
        self.request_response(req).await
    }

    pub async fn get_agent(&self, name: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "agent_get",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "team": null,
        });
        self.request_response(req).await
    }

    pub async fn create_agent(
        &self,
        name: &str,
        provider: &str,
        model: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "agent_create",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "request": {
                "name": name,
                "provider": provider,
                "model": model,
            },
        });
        self.request_response(req).await
    }

    pub async fn delete_agent(&self, name: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "agent_delete",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
        });
        self.request_response(req).await
    }

    pub async fn update_agent(
        &self,
        name: &str,
        model: Option<&str>,
        description: Option<&str>,
        system_prompt: Option<&str>,
        config: Option<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "agent_update",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "team": null,
            "model": model,
            "description": description,
            "system_prompt": system_prompt,
            "config": config,
        });
        self.request_response(req).await
    }

    /// Export an agent
    pub async fn export_agent(
        &self,
        name: &str,
        team: Option<&str>,
        output: Option<&str>,
        include_sessions: bool,
        with_extensions: bool,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "agent_export",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "team": team,
            "output": output,
            "include_sessions": include_sessions,
            "with_extensions": with_extensions,
        });
        self.request_response(req).await
    }

    /// Import an agent
    pub async fn import_agent(
        &self,
        file_path: &str,
        name: Option<&str>,
        team: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "agent_import",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "file_path": file_path,
            "name": name,
            "team": team,
        });
        self.request_response(req).await
    }

    // ── Team CRUD ─────────────────────────────────────────────────

    pub async fn list_teams(&self) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "team_list",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
        });
        self.request_response(req).await
    }

    pub async fn get_team(&self, name: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "team_get",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
        });
        self.request_response(req).await
    }

    /// Export a team
    pub async fn export_team(
        &self,
        name: &str,
        output: Option<&str>,
        include_sessions: bool,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "team_export",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "output": output,
            "include_sessions": include_sessions,
        });
        self.request_response(req).await
    }

    /// Import a team
    pub async fn import_team(
        &self,
        file_path: &str,
        name: Option<&str>,
        force: bool,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "team_import",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "file_path": file_path,
            "name": name,
            "force": force,
        });
        self.request_response(req).await
    }

    pub async fn create_team(
        &self,
        name: &str,
        description: Option<&str>,
        members: Option<Vec<String>>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "team_create",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "description": description,
            "members": members,
        });
        self.request_response(req).await
    }

    pub async fn delete_team(&self, name: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "team_delete",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "force": false,
        });
        self.request_response(req).await
    }

    pub async fn join_team(&self, team: &str, agent: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "team_join",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "team": team,
            "agent": agent,
        });
        self.request_response(req).await
    }

    pub async fn leave_team(&self, team: &str, agent: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "team_leave",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "team": team,
            "agent": agent,
        });
        self.request_response(req).await
    }

    // ── Session CRUD ──────────────────────────────────────────────

    pub async fn list_sessions(&self, agent: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "session_list",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "agent": agent,
        });
        self.request_response(req).await
    }

    pub async fn get_session(&self, id: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "session_get",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "id": id,
        });
        self.request_response(req).await
    }

    pub async fn list_providers(&self) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "provider_list",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
        });
        self.request_response(req).await
    }

    /// Get a stored credential from the runtime's OS-keychain-backed
    /// secret store. As of v3 the runtime owns the keychain; the
    /// desktop no longer maintains its own copy.
    pub async fn credential_get(&self, provider: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "credential_get",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "provider": provider,
        });
        self.request_response(req).await
    }

    /// Set a credential via the runtime. The desktop should *not* hold
    /// the secret beyond the IPC call.
    pub async fn credential_set(&self, provider: &str, api_key: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "credential_set",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "provider": provider,
            "api_key": api_key,
        });
        self.request_response(req).await
    }

    /// Delete a credential via the runtime.
    pub async fn credential_delete(&self, provider: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "credential_delete",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "provider": provider,
        });
        self.request_response(req).await
    }

    /// List providers with stored credentials (via the runtime).
    pub async fn credential_list(&self) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "credential_list",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
        });
        self.request_response(req).await
    }

    /// Show session details with optional history.
    /// `agent` and `session_id` are required. `team` defaults to "default".
    pub async fn show_session(
        &self,
        agent: &str,
        team: Option<&str>,
        session_id: &str,
        history: bool,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "session_show",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "agent": agent,
            "team": team,
            "session_id": session_id,
            "history": history,
        });
        self.request_response(req).await
    }

    // ── System ────────────────────────────────────────────────────

    /// Get system status from daemon
    pub async fn system_status(&self) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "system_status",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
        });
        self.request_response(req).await
    }

    /// Run system doctor check
    pub async fn system_doctor(&self) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "system_doctor",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
        });
        self.request_response(req).await
    }

    // ── Cron ──────────────────────────────────────────────────────

    /// List cron jobs
    pub async fn cron_list(&self) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "cron_list",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "include_disabled": true,
        });
        self.request_response(req).await
    }

    /// Remove a cron job
    pub async fn cron_remove(&self, id: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "cron_remove",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "job_id": id,
        });
        self.request_response(req).await
    }

    /// Run a cron job now
    pub async fn cron_run(&self, id: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "cron_run",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "job_id": id,
        });
        self.request_response(req).await
    }

    // ── Extension ─────────────────────────────────────────────────

    /// List extensions from daemon
    pub async fn list_extensions(
        &self,
        enabled_only: bool,
        ext_type: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "extension_list",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "enabled_only": enabled_only,
            "ext_type": ext_type,
        });
        self.request_response(req).await
    }

    /// Enable an extension
    pub async fn enable_extension(
        &self,
        id: &str,
        target: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "extension_enable",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "id": id,
            "target": target,
        });
        self.request_response(req).await
    }

    /// Disable an extension
    pub async fn disable_extension(
        &self,
        id: &str,
        target: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "extension_disable",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "id": id,
            "target": target,
        });
        self.request_response(req).await
    }

    // ── System ────────────────────────────────────────────────────

    /// Clean system cache
    pub async fn system_clean(&self, scope: Option<&str>) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "system_clean",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "scope": scope,
        });
        self.request_response(req).await
    }

    /// Install an extension from a path
    pub async fn install_extension(&self, path: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "extension_install",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "path": path,
        });
        self.request_response(req).await
    }

    /// Uninstall an extension by ID
    pub async fn uninstall_extension(&self, id: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "extension_uninstall",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "id": id,
        });
        self.request_response(req).await
    }

    /// Add a cron job (simplified)
    pub async fn cron_add_simple(
        &self,
        name: &str,
        schedule: &str,
        message: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "cron_add_simple",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "schedule": schedule,
            "message": message,
        });
        self.request_response(req).await
    }

    /// Branch a session
    pub async fn branch_session(
        &self,
        agent: &str,
        team: Option<&str>,
        session_id: &str,
        label: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "session_branch",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "agent": agent,
            "team": team,
            "session_id": session_id,
            "label": label,
        });
        self.request_response(req).await
    }

    /// Compact a session
    pub async fn compact_session(
        &self,
        agent: &str,
        team: Option<&str>,
        session_id: &str,
        dry_run: bool,
        instruction: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "session_compact",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "agent": agent,
            "team": team,
            "session_id": session_id,
            "dry_run": dry_run,
            "instruction": instruction,
        });
        self.request_response(req).await
    }

    /// Pull an agent from registry
    pub async fn registry_pull(
        &self,
        registry_ref: &str,
        team: Option<&str>,
        force: bool,
        token: Option<&str>,
        host: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "registry_pull",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "registry_ref": registry_ref,
            "team": team,
            "force": force,
            "registry_token": token,
            "registry_host": host,
        });
        self.request_response(req).await
    }

    /// Set instance status (online/offline) for tunnel-published agents
    pub async fn set_instance_status(
        &self,
        agent_name: &str,
        status: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "instance_set_status",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "agent_name": agent_name,
            "status": status,
        });
        self.request_response(req).await
    }

    /// Set instance exposure (unexposed/private/public) for tunnel-published agents
    pub async fn set_instance_exposure(
        &self,
        agent_name: &str,
        exposure: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "instance_set_exposure",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "agent_name": agent_name,
            "exposure": exposure,
        });
        self.request_response(req).await
    }

    /// Send an execute request and emit stream events via the Tauri app handle.
    ///
    /// The daemon returns ResponsePacket shapes (Text { chunk }, Done { success }, Error { message })
    /// which we map into our frontend-facing StreamEvent enum.
    pub async fn execute(
        &self,
        app: &tauri::AppHandle,
        agent: String,
        message: String,
        session_id: Option<String>,
    ) -> Result<()> {
        ensure_daemon().await?;

        let request = serde_json::json!({
            "type": "execute",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "agent": agent,
            "team": "default",
            "message": message,
            "session_id": session_id,
            "new_session": session_id.is_none(),
            "stream": true,
            "user": "desktop",
        });

        let bytes =
            serde_json::to_vec(&request).map_err(|e| IpcError::Serialization(e.to_string()))?;
        let mut buf = vec![0u8; 65536];

        #[cfg(windows)]
        {
            self.socket
                .send_to(&bytes, "127.0.0.1:11435")
                .await
                .map_err(|e| IpcError::SendFailed(e.to_string()))?;
        }
        #[cfg(unix)]
        {
            let sock_path = default_socket_path();
            self.socket
                .send_to(&bytes, &sock_path)
                .await
                .map_err(|e| IpcError::SendFailed(e.to_string()))?;
        }

        // Read streaming responses until Done or Error
        loop {
            let len = match tokio::time::timeout(
                Duration::from_secs(30),
                self.socket.recv_from(&mut buf),
            )
            .await
            {
                Ok(Ok((len, _))) => len,
                Ok(Err(e)) => return Err(IpcError::ReceiveFailed(e.to_string())),
                Err(_) => return Err(IpcError::Timeout),
            };

            let raw: serde_json::Value = serde_json::from_slice(&buf[..len])
                .map_err(|e| IpcError::Serialization(e.to_string()))?;

            let packet_type = raw.get("type").and_then(|v| v.as_str()).unwrap_or("");

            // Emit milliseconds since epoch — JavaScript's Date constructor
            // handles this natively: new Date("1717421234567") works.
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .to_string();

            let event = match packet_type {
                "text" => {
                    let chunk = raw
                        .get("chunk")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    StreamEvent::Chunk {
                        content: chunk,
                        timestamp,
                    }
                }
                "done" => {
                    let success = raw.get("success").and_then(|v| v.as_bool()).unwrap_or(true);
                    if !success {
                        let error_msg = raw
                            .get("error")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unknown error")
                            .to_string();
                        StreamEvent::Error {
                            message: error_msg,
                            timestamp,
                        }
                    } else {
                        StreamEvent::Done { timestamp }
                    }
                }
                "error" => {
                    let message = raw
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error")
                        .to_string();
                    StreamEvent::Error { message, timestamp }
                }
                "heartbeat" => {
                    // Daemon keepalive — ignore
                    continue;
                }
                other => {
                    // Unknown packet type — skip or log
                    eprintln!("[peko-desktop] Unknown IPC response packet type: {}", other);
                    continue;
                }
            };

            let is_done = matches!(event, StreamEvent::Done { .. } | StreamEvent::Error { .. });

            let _ = app.emit("peko-stream", &event);

            if is_done {
                break;
            }
        }

        Ok(())
    }

    // ── Principal operations (ADR-041) ───────────────────────────────

    /// Send a Principal message via the streaming IPC path. The
    /// daemon emits `principal_sent_chunk` deltas followed by a
    /// `principal_sent_done` packet carrying the full final answer.
    /// Each delta is forwarded through the supplied `on_chunk`
    /// closure; the `on_done` closure receives the final `content`
    /// string once the supervisor has settled.
    pub async fn principal_send_stream<F, G>(
        &self,
        app: &tauri::AppHandle,
        name: String,
        message: String,
        on_chunk: F,
        on_done: G,
    ) -> Result<()>
    where
        F: Fn(String) + Send + Sync + 'static,
        G: FnOnce(String) + Send + 'static,
    {
        ensure_daemon().await?;

        let request = serde_json::json!({
            "type": "principal_send_stream",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "message": message,
            "user": "desktop",
        });

        let bytes =
            serde_json::to_vec(&request).map_err(|e| IpcError::Serialization(e.to_string()))?;

        #[cfg(windows)]
        {
            self.socket
                .send_to(&bytes, "127.0.0.1:11435")
                .await
                .map_err(|e| IpcError::SendFailed(e.to_string()))?;
        }
        #[cfg(unix)]
        {
            let sock_path = default_socket_path();
            self.socket
                .send_to(&bytes, &sock_path)
                .await
                .map_err(|e| IpcError::SendFailed(e.to_string()))?;
        }

        let mut buf = vec![0u8; 65536];
        loop {
            let len = match tokio::time::timeout(
                Duration::from_secs(120),
                self.socket.recv_from(&mut buf),
            )
            .await
            {
                Ok(Ok((len, _))) => len,
                Ok(Err(e)) => return Err(IpcError::ReceiveFailed(e.to_string())),
                Err(_) => return Err(IpcError::Timeout),
            };

            let raw: serde_json::Value = serde_json::from_slice(&buf[..len])
                .map_err(|e| IpcError::Serialization(e.to_string()))?;

            let packet_type = raw.get("type").and_then(|v| v.as_str()).unwrap_or("");

            // Emit the chunks via Tauri events so the legacy
            // `peko-stream` channel listeners still see the live
            // tokens during the migration window.
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .to_string();

            match packet_type {
                "principal_sent_chunk" => {
                    let delta = raw
                        .get("delta")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    on_chunk(delta.clone());
                    let _ = app.emit(
                        "peko-stream",
                        &StreamEvent::Chunk {
                            content: delta,
                            timestamp,
                        },
                    );
                }
                "principal_sent_done" => {
                    let content = raw
                        .get("content")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    on_done(content.clone());
                    let _ = app.emit("peko-stream", &StreamEvent::Done { timestamp });
                    return Ok(());
                }
                "done" => return Ok(()),
                "error" => {
                    let message = raw
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error")
                        .to_string();
                    let _ = app.emit(
                        "peko-stream",
                        &StreamEvent::Error {
                            message: message.clone(),
                            timestamp,
                        },
                    );
                    return Err(IpcError::ReceiveFailed(message));
                }
                "heartbeat" => continue,
                other => {
                    eprintln!("[peko-desktop] Unknown IPC response packet type: {other}");
                    continue;
                }
            }
        }
    }

    /// Send a Principal message via the non-streaming IPC path. The
    /// daemon returns a single `principal_sent` packet with the full
    /// final answer. Used by code paths that don't need live tokens
    /// (e.g. CLI-style bulk operations).
    pub async fn principal_send(&self, name: String, message: String) -> Result<String> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_send",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "message": message,
            "user": "desktop",
        });
        let value = self.request_response(req).await?;
        // The daemon may return either a `principal_sent` packet or
        // a generic `Done` envelope; unwrap both shapes.
        if let Some(content) = value.get("content").and_then(|v| v.as_str()) {
            return Ok(content.to_string());
        }
        // Fallback: assume the value is the full payload.
        Ok(value.to_string())
    }

    /// List all known Principals.
    pub async fn principal_list(&self) -> Result<serde_json::Value> {
        // The runtime does not yet expose a `principal_list` IPC
        // variant; fall back to file-system discovery of the
        // workspace's `principals/` directory. The IPC variant
        // will be added in a follow-up.
        let path = dirs::home_dir()
            .map(|d| d.join(".peko").join("workspace").join("principals"))
            .unwrap_or_else(|| std::path::PathBuf::from(".peko/workspace/principals"));
        let read = tokio::fs::read_dir(&path).await.ok();
        let mut out: Vec<serde_json::Value> = Vec::new();
        if let Some(mut rd) = read {
            while let Ok(Some(entry)) = rd.next_entry().await {
                if let Ok(name) = entry.file_name().into_string() {
                    if let Ok(s) =
                        tokio::fs::read_to_string(entry.path().join("principal.toml")).await
                    {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                            out.push(serde_json::json!({
                                "name": v.get("name").cloned().unwrap_or_else(|| name.clone().into()),
                                "exposure": v.get("exposure").cloned().unwrap_or_else(|| "unexposed".into()),
                                "status": v.get("status").cloned().unwrap_or_else(|| "offline".into()),
                                "description": v.get("identity")
                                    .and_then(|i| i.get("display_name"))
                                    .cloned()
                                    .unwrap_or(serde_json::Value::Null),
                            }));
                        }
                    }
                }
            }
        }
        Ok(serde_json::json!({ "principals": out }))
    }
}

#[cfg(unix)]
fn default_socket_path() -> std::path::PathBuf {
    dirs::home_dir()
        .map(|d| d.join(".peko").join("run").join("daemon.sock"))
        .unwrap_or_else(|| {
            std::path::PathBuf::from(".peko")
                .join("run")
                .join("daemon.sock")
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_event_serialization() {
        let event = StreamEvent::Chunk {
            content: "hello".to_string(),
            timestamp: "0d 12:00:00 UTC".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("hello"));
        assert!(json.contains("chunk"));

        let deserialized: StreamEvent = serde_json::from_str(&json).unwrap();
        match deserialized {
            StreamEvent::Chunk { content, .. } => assert_eq!(content, "hello"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn test_pong_response_serialization() {
        let pong = PongResponse {
            request_id: 123,
            version: "1.0.0".to_string(),
            uptime_secs: 42,
        };
        let json = serde_json::to_string(&pong).unwrap();
        let deserialized: PongResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.request_id, 123);
        assert_eq!(deserialized.version, "1.0.0");
    }
}
