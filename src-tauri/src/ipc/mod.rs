//! IPC client for communicating with the peko daemon.
//!
//! Protocol version: 1
//! - Version 1: Initial protocol with Ping, Principal* packets.
//!
//! The legacy `agent_*` and `session_*` IPC variants were retired in
//! peko-runtime PR #125 (ADR-042, 2026-07-05). The desktop now talks
//! to the daemon exclusively through the `principal_*` surface plus
//! the small handful of orthogonal IPC calls (extension, cron, system,
//! registry, credential, settings).

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

/// Snapshot of a foreign daemon's status, used by the supervisor's
/// adoption probe. The supervisor calls `probe_status()` from
/// `start()` BEFORE spawning the bundled sidecar — if a daemon
/// (CLI-launched or otherwise) is already responding on the IPC
/// socket, the supervisor mirrors its state instead of spawning a
/// competing child.
///
/// Distinct from `PongResponse` (used by the legacy `ping` flow)
/// because adoption needs the launch mode and a best-effort PID to
/// populate the diagnostics panel.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StatusSnapshot {
    pub version: String,
    pub uptime_secs: u64,
    /// `None` if the daemon didn't report a mode (older builds).
    /// Otherwise `"sidecar"` or `"headless"`.
    pub mode: Option<String>,
    /// Best-effort PID read from the daemon's lockfile (`<config>/run/
    /// daemon.pid` for headless daemons). `None` if the lockfile is
    /// missing or the daemon didn't write one.
    pub pid: Option<u32>,
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

/// Returns the AppHandle that was stashed at supervisor install
/// time, or `None` if no Tauri runtime is active (tests, ad-hoc
/// tooling). Used by `daemon::ensure_running_async` to route through
/// the supervisor instead of the legacy find-binary path.
pub fn current_app_handle() -> Option<tauri::AppHandle> {
    crate::sidecar::current_app_handle()
}

/// Path to the headless daemon's PID file. Mirrors
/// `DaemonProcessService::pid_file_path(sidecar_mode=false)`: `<config>/run/
/// daemon.pid`. Honours `PEKO_CONFIG_DIR` like the runtime's resolver.
pub fn headless_pid_file_path() -> std::path::PathBuf {
    let config_dir = std::env::var("PEKO_CONFIG_DIR")
        .ok()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            dirs::home_dir()
                .map(|d| d.join(".peko"))
                .unwrap_or_else(|| std::path::PathBuf::from(".peko"))
        });
    config_dir.join("run").join("daemon.pid")
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

    /// Send a request without calling `ensure_daemon()`. Used by the
    /// supervisor's adoption probe so the probe can detect a foreign
    /// daemon WITHOUT recursing back into the supervisor (which would
    /// be an infinite loop: supervisor → probe → supervisor → …).
    ///
    /// Returns `Err(IpcError::ConnectionFailed | Timeout | …)` if
    /// nothing is listening on the IPC socket. Callers should treat
    /// any error as "no foreign daemon", not as a fatal error.
    async fn request_raw(&self, request: serde_json::Value) -> Result<serde_json::Value> {
        self.request_response(request).await
    }

    /// Adoption probe: ask the IPC socket for a Status packet and
    /// decode it without touching the supervisor. Used by
    /// `SidecarSupervisor::start` to detect a foreign daemon (CLI-
    /// launched or otherwise) before spawning the bundled sidecar.
    ///
    /// Returns `None` if no daemon is responding, if the response
    /// isn't a `status` packet, or if the wire shape is unparseable.
    /// Never panics.
    pub async fn probe_status(&self) -> Option<StatusSnapshot> {
        let req = serde_json::json!({
            "type": "status",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 0u64,
        });
        let value = self.request_raw(req).await.ok()?;
        if value.get("type").and_then(|v| v.as_str()) != Some("status") {
            return None;
        }
        let version = value
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let uptime_secs = value
            .get("uptime_secs")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let mode = value
            .get("mode")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let pid = read_pid_file(&headless_pid_file_path());
        Some(StatusSnapshot {
            version,
            uptime_secs,
            mode,
            pid,
        })
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

    /// Add a cron job (full CronJob struct as required by runtime's
    /// `RequestPacket::CronAdd`). The runtime owns id generation,
    /// timestamps, and run counters; the desktop only supplies the
    /// user-facing fields (name, schedule, principal, action).
    pub async fn cron_add(&self, job: serde_json::Value) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "cron_add",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "job": job,
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

    // ── Registry ──────────────────────────────────────────────────

    /// Pull a Principal bundle from a registry. Maps to runtime's
    /// `RequestPacket::PrincipalPull` (the legacy `registry_pull`
    /// packet was retired with ADR-041; the runtime's surface is
    /// `principal_pull`). Desktop pre-confirms because the user has
    /// already accepted the preview in the registry search UI.
    pub async fn principal_pull(
        &self,
        registry_ref: &str,
        name: Option<&str>,
        force: bool,
        allow_unsigned: bool,
        registry_token: Option<&str>,
        registry_host: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_pull",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "registry_ref": registry_ref,
            "name": name,
            "force": force,
            "confirmed": true,
            "selected_capabilities": [],
            "allow_unsigned": allow_unsigned,
            "registry_token": registry_token,
            "registry_host": registry_host,
        });
        self.request_response(req).await
    }

    // ── Credential (keychain) ─────────────────────────────────────

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

    /// Live-ping the provider's real API with the stored key (or
    /// no key for local providers like Ollama) and return the
    /// structured outcome (`{ok, message, latency_ms, http_status,
    /// model_used, tested_at}`). Replaces the old `credential_get`-
    /// then-shape-check path that couldn't tell `sk-opena-12345`
    /// from a real key. Powers the desktop's Test button — the
    /// CLI's `peko credential test` uses the same IPC seam. See
    /// `peko-runtime` PR #193 (`providers::validator::Validator`).
    pub async fn credential_test(&self, provider: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "credential_test",
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

    /// List the runtime's provider catalog.
    pub async fn list_providers(&self) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "provider_list",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
        });
        self.request_response(req).await
    }

    /// List the built-in provider templates the runtime ships
    /// with. Mirrors the CLI's `peko provider templates` over IPC
    /// so the desktop's "Add Provider" modal can populate its
    /// template picker without shelling out. T-109b.
    pub async fn provider_templates(&self) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "provider_templates",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
        });
        self.request_response(req).await
    }

    /// Add a provider to the runtime catalog. Mirrors
    /// `peko provider add` over IPC so the desktop's "Add Provider"
    /// modal can register a new template- or custom-shaped
    /// provider without shelling out. The full `args` payload is
    /// serialized and forwarded; the runtime's handler does the
    /// template/custom branch + `--key` / `--set-default` folding
    /// and returns the new entry's catalog-summary view. T-109b.
    pub async fn provider_add(&self, args: serde_json::Value) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "provider_add",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "args": args,
        });
        self.request_response(req).await
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

    /// Read a peer's conversation thread with a Principal.
    ///
    /// Mirror of `RequestPacket::PrincipalLog` (PR #124). The privacy
    /// contract (`caller == peer || caller == principal.owner` plus
    /// the principal's `Chat` grant) is enforced by the daemon. The
    /// desktop passes through `peer` as the Subject parse result
    /// (`user:alice`, `principal:<did>`, or `public`) — or `None` for
    /// the owner-root default view.
    pub async fn principal_log(
        &self,
        name: &str,
        peer: Option<&str>,
        limit: Option<usize>,
        since_secs: Option<u64>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_log",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "peer": peer,
            "limit": limit,
            "since_secs": since_secs,
        });
        self.request_response(req).await
    }

    /// List all known Principals via the runtime's `principal_list`
    /// IPC variant. The legacy filesystem-discovery fallback was
    /// removed: the runtime is the single source of truth for
    /// Principal inventory (ADR-041).
    pub async fn principal_list(&self) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_list",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
        });
        self.request_response(req).await
    }

    /// Look up a single Principal by name. Mirror of
    /// `RequestPacket::PrincipalGet`. The response envelope is
    /// `{"type": "principal_get", "principal": {...} | null}` — the
    /// daemon returns `null` for a miss, never an error.
    pub async fn principal_get(&self, name: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_get",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
        });
        self.request_response(req).await
    }

    /// Create a new Principal on the local runtime. Mirror of
    /// `RequestPacket::PrincipalCreate` (peko-runtime PR #185). The
    /// daemon validates the name, persists the workspace +
    /// `agents/primary.md`, and returns a `principal_created` envelope
    /// with the new summary. Errors surface as a generic `error`
    /// packet — callers should map them to user-facing messages.
    #[allow(clippy::too_many_arguments)]
    pub async fn principal_create(
        &self,
        name: &str,
        description: Option<&str>,
        preferred_provider_id: Option<&str>,
        preferred_model_id: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_create",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "description": description,
            "preferred_provider_id": preferred_provider_id,
            "preferred_model_id": preferred_model_id,
        });
        self.request_response(req).await
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

/// Public re-export of the unix socket path so the supervisor's
/// sync probe (`sidecar::sync_probe`) can hit the same socket the
/// async `IpcClient` uses. Kept `pub(crate)` — the desktop's IPC
/// surface is intentionally internal.
#[cfg(unix)]
pub(crate) fn default_socket_path_for_probe() -> std::path::PathBuf {
    default_socket_path()
}

/// Read a peko daemon PID file (typically `<config>/run/daemon.pid` for
/// the headless CLI daemon). Returns `None` if the file is missing,
/// unreadable, or contains a non-numeric value.
fn read_pid_file(path: &std::path::Path) -> Option<u32> {
    let s = std::fs::read_to_string(path).ok()?;
    s.trim().parse::<u32>().ok()
}

/// Public re-export of the PID-file reader for the supervisor's
/// sync probe. Same access boundary as
/// `default_socket_path_for_probe`.
pub(crate) fn read_pid_file_for_probe(path: &std::path::Path) -> Option<u32> {
    read_pid_file(path)
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
