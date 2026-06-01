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

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum StreamEvent {
    #[serde(rename = "text")]
    Text { content: String },
    #[serde(rename = "tool_call")]
    ToolCall { name: String, arguments: String },
    #[serde(rename = "tool_result")]
    ToolResult { output: String },
    #[serde(rename = "done")]
    Done,
    #[serde(rename = "error")]
    Error { message: String },
}

/// Check if a response indicates a protocol version mismatch.
/// Returns true if the daemon rejected the request due to version.
pub fn is_version_mismatch(response: &serde_json::Value) -> bool {
    response.get("type").and_then(|v| v.as_str()) == Some("error")
        && response.get("message").and_then(|v| v.as_str())
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
        use std::path::PathBuf;
        let tmp = std::env::temp_dir().join(format!(
            "peko_desktop_ipc_{}.sock",
            std::process::id()
        ));
        let _ = tokio::fs::remove_file(&tmp).await;
        let socket = tokio::net::UnixDatagram::bind(&tmp)
            .await
            .map_err(|e| IpcError::ConnectionFailed(e.to_string()))?;
        Ok(Self {
            socket,
            _tmp_path: tmp,
        })
    }

    /// Send a request and wait for a single response (non-streaming).
    async fn request_response(&self, request: serde_json::Value) -> Result<serde_json::Value> {
        let bytes = serde_json::to_vec(&request)
            .map_err(|e| IpcError::Serialization(e.to_string()))?;
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
            "name": name,
            "provider": provider,
            "model": model,
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
    pub async fn list_extensions(&self, enabled_only: bool, ext_type: Option<&str>) -> Result<serde_json::Value> {
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
    pub async fn enable_extension(&self, id: &str, target: Option<&str>) -> Result<serde_json::Value> {
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
    pub async fn disable_extension(&self, id: &str, target: Option<&str>) -> Result<serde_json::Value> {
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

    /// Send an execute request and emit stream events via the Tauri app handle.
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
            "message": message,
            "session_id": session_id,
        });

        let bytes = serde_json::to_vec(&request)
            .map_err(|e| IpcError::Serialization(e.to_string()))?;
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
            let len = match tokio::time::timeout(Duration::from_secs(30), self.socket.recv_from(&mut buf)).await {
                Ok(Ok((len, _))) => len,
                Ok(Err(e)) => return Err(IpcError::ReceiveFailed(e.to_string())),
                Err(_) => return Err(IpcError::Timeout),
            };

            let event: StreamEvent = serde_json::from_slice(&buf[..len])
                .map_err(|e| IpcError::Serialization(e.to_string()))?;

            let is_done = matches!(event, StreamEvent::Done | StreamEvent::Error { .. });

            let _ = app.emit("ipc-stream-event", &event);

            if is_done {
                break;
            }
        }

        Ok(())
    }
}

#[cfg(unix)]
fn default_socket_path() -> std::path::PathBuf {
    dirs::home_dir()
        .map(|d| d.join(".peko").join("run").join("daemon.sock"))
        .unwrap_or_else(|| std::path::PathBuf::from(".peko").join("run").join("daemon.sock"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_event_serialization() {
        let event = StreamEvent::Text { content: "hello".to_string() };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("hello"));
        
        let deserialized: StreamEvent = serde_json::from_str(&json).unwrap();
        match deserialized {
            StreamEvent::Text { content } => assert_eq!(content, "hello"),
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
