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
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::Emitter;
use thiserror::Error;

use crate::sidecar::sync_probe;

/// Current IPC protocol version
pub const PROTOCOL_VERSION: u16 = 1;

/// Unique identifier for per-request Unix-domain socket paths so that
/// concurrent IPC clients in the same process do not bind to the same
/// filesystem entry and trample each other's responses.
static IPC_CLIENT_COUNTER: AtomicU64 = AtomicU64::new(0);

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
/// Streamed event payload forwarded to the React frontend over a Tauri
/// `Channel` for `principal_send_stream`. This is the shape the Chat UI
/// consumes directly; `StreamEvent` is the legacy `peko-stream` emit
/// shape kept for migration-window compatibility and carries more
/// fields (timestamp, tool call/result, etc.) that the new UI does not
/// surface.
///
/// `Iteration` is a content-free boundary marker emitted by the
/// runtime at the start of each agentic loop iteration; the frontend
/// uses it to (a) break chat bubbles between iterations and (b) drive
/// the "Thinking…" pill while a new iteration's first token is in
/// flight. Tool-call / thinking / retry / usage events stay backend-
/// only and are not surfaced through this channel.
#[derive(Serialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatStreamMsg {
    /// A streamed assistant text delta.
    Chunk { delta: String },
    /// Agentic-iteration boundary marker (iteration counter starts at 1).
    Iteration { iteration: u32 },
}

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
    /// PR-2b: live channel event from `ChannelEventsWatch`. The
    /// `payload` is the runtime's `ChannelEvent` JSON object
    /// verbatim — the React side can switch on `payload.kind`
    /// (mirrors `peko_protocol::channel::ChannelEvent`'s
    /// `#[serde(tag = "kind", rename_all = "snake_case")]` shape).
    #[serde(rename = "channel_event")]
    ChannelEvent {
        channel_id: String,
        payload: serde_json::Value,
        timestamp: String,
    },
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

/// Variant of the runtime's `PrincipalSendControlMode`. The wire shape
/// is the same `tag = "mode"` enum the runtime deserializes; we keep a
/// mirror here so `IpcClient::principal_send_control` can build the
/// payload without re-implementing the discriminator inline.
#[derive(Debug, Clone)]
pub enum PrincipalSendControlMode {
    Interrupt,
    Steer { text: String },
}

/// Convert a peer string from the desktop's Display form
/// (`"user:alice"`, `"principal:<did>"`, `"public"`) into the tagged
/// Subject wire form (`{"kind":"user","id":"alice"}`,
/// `{"kind":"principal","id":"<did>"}`, `{"kind":"public"}`) that
/// `RequestPacket::PrincipalLog.peer: Option<Subject>` expects.
///
/// `None` would not be valid for `Subject::Public` — the runtime
/// returns it as `{"kind":"public"}` with no `id` field
/// (`observability/audit.rs:185-198`). Bare strings without a
/// `kind:id` prefix are returned as `None` so the request payload
/// surfaces the malformed peer to the daemon rather than silently
/// succeeding.
#[cfg_attr(not(test), allow(dead_code))]
fn peer_str_to_subject_value(peer: &str) -> serde_json::Value {
    if peer == "public" {
        return serde_json::json!({ "kind": "public" });
    }
    if let Some(id) = peer.strip_prefix("user:") {
        return serde_json::json!({ "kind": "user", "id": id });
    }
    if let Some(id) = peer.strip_prefix("principal:") {
        return serde_json::json!({ "kind": "principal", "id": id });
    }
    serde_json::Value::Null
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
    // ADR-043: route through the supervisor so the IPC client shares
    // the same child handle as every other consumer of the engine
    // (Tauri commands, tray menu, status bridge). The supervisor is
    // the canonical owner of the lifecycle; this call site has no
    // business reaching for `peko` CLI shortcuts.
    let app = crate::sidecar::current_app_handle()
        .ok_or_else(|| IpcError::ConnectionFailed("supervisor not installed".to_string()))?;
    let sup = crate::sidecar::get(&app);
    if !sup.is_running() {
        sup.start().map_err(|e| {
            IpcError::ConnectionFailed(format!("daemon not running and auto-start failed: {}", e))
        })?;
    }
    // Block until the daemon's IPC socket is actually responding.
    // The supervisor's `Running` state is misleadingly early — it
    // transitions on `PEKO_VERSION` which the runtime emits before
    // `AppState::new` does its heavy disk I/O (vault, identity,
    // principal scan, peer registry, model catalog, extension
    // store). The authoritative readiness signal is the socket
    // bind inside `IpcServer::new`, which fires ~2 s after spawn
    // on a populated vault. Without this wait, the first IPC call
    // after a cold boot hits `send_to` → `ENOENT` → `SendFailed`,
    // and React Query silently shows an empty list (the sidebar
    // has no error UI). Each iteration of `sync_probe` already
    // caps at its 200 ms `read_timeout`, so this loop is cheap
    // when the daemon is already up (one instant success) and
    // bounded when it isn't. Matches the IPC client's 10 s
    // `recv_from` timeout below so a hung daemon surfaces the
    // same `IpcError::Timeout` either way.
    wait_for_socket_ready(Duration::from_secs(10)).await?;
    Ok(())
}

/// Async wait until `sync_probe` succeeds, or `budget` elapses.
/// Spawn-blocking because `sync_probe` uses `std::os::unix::net::
/// UnixDatagram` (sync); the runtime cost is one ~200 ms-blocking
/// syscall per iteration, but the surrounding `tokio::time::sleep`
/// yields the async task. Keep this on `spawn_blocking` so a busy
/// runtime doesn't starve other IPC calls.
async fn wait_for_socket_ready(budget: Duration) -> Result<()> {
    let deadline = std::time::Instant::now() + budget;
    loop {
        let probe_result = tokio::task::spawn_blocking(sync_probe).await;
        if let Ok(Some(_)) = probe_result {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            return Err(IpcError::Timeout);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Raise the kernel-side `SO_RCVBUF` on the freshly-bound client
/// socket so the desktop can receive larger daemon responses
/// (`model_templates`, `model_list`, `system_status`, …).
///
/// Why this exists: the desktop binds a per-PID tmp
/// `AF_UNIX/SOCK_DGRAM` socket to receive responses. With the
/// platform's default receive queue, the daemon's
/// `send_to(peer)` for a 5+ KB `model_templates` payload
/// returns `ENOBUFS` ("No buffer space available", os error 55).
/// The handler logs the error and the client silently times out at
/// 10 s — the modal then shows "model_templates failed:
/// timeout". We saw this exactly when the catalog grew past a
/// handful of templates (memory: `provider-templates-ipc-enobufs`).
///
/// The runtime already bumps `SO_SNDBUF` on its server socket
/// (`peko-runtime/src/ipc/server.rs::bump_send_buffer`); 256 KiB is
/// generous for the largest response in flight while staying well
/// under any per-socket memory budget on a developer workstation.
/// Failures here are non-fatal: we drop the warning and the socket
/// keeps whatever the kernel gave us (often still enough for small
/// responses like `credential_get`).
#[cfg(unix)]
fn bump_recv_buffer<S: std::os::fd::AsRawFd>(socket: &S) {
    const IPC_RECV_BUFFER_BYTES: usize = 256 * 1024;
    let fd = socket.as_raw_fd();
    let buf_len = IPC_RECV_BUFFER_BYTES as libc::c_int;
    // SAFETY: `fd` is a live socket owned by `socket`, and `buf_len` is
    // a valid `c_int`. `SOL_SOCKET` / `SO_RCVBUF` are the kernel
    // constants we want. `setsockopt` does not take ownership of the
    // fd and writes the requested buffer size back via the same fd.
    let rc = unsafe {
        libc::setsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_RCVBUF,
            &buf_len as *const _ as *const libc::c_void,
            std::mem::size_of::<libc::c_int>() as libc::socklen_t,
        )
    };
    if rc != 0 {
        let err = std::io::Error::last_os_error();
        tracing::warn!(
            "failed to bump client socket SO_RCVBUF to {} bytes ({}); \
             large responses (e.g. model_templates) may fail with ENOBUFS",
            IPC_RECV_BUFFER_BYTES,
            err
        );
    }
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
        let counter = IPC_CLIENT_COUNTER.fetch_add(1, Ordering::Relaxed);
        let tmp = std::env::temp_dir().join(format!(
            "peko_desktop_ipc_{}_{}.sock",
            std::process::id(),
            counter
        ));
        let _ = tokio::fs::remove_file(&tmp).await;
        let socket = tokio::net::UnixDatagram::bind(&tmp)
            .map_err(|e| IpcError::ConnectionFailed(e.to_string()))?;
        bump_recv_buffer(&socket);
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

    // ── Capability (per-Principal grants) ───────────────────────────

    /// List granted, detected, and active capabilities for a Principal.
    pub async fn capability_list(&self, principal: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "capability_list",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "principal": principal,
        });
        self.request_response(req).await
    }

    /// Grant a capability to a Principal.
    pub async fn capability_grant(
        &self,
        principal: &str,
        capability: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "capability_grant",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "principal": principal,
            "capability": capability,
        });
        self.request_response(req).await
    }

    /// Revoke a capability from a Principal.
    pub async fn capability_revoke(
        &self,
        principal: &str,
        capability: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "capability_revoke",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "principal": principal,
            "capability": capability,
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

    // ── Credential (vault) ─────────────────────────────────────────

    /// List credentials from the runtime's vault, optionally filtered by
    /// namespace and kind. RP4 generic shape: returns
    /// `{ providers: [{ id, namespace, name, kind, has_key, last_tested_at,
    /// last_tested_ok }] }`.
    pub async fn credential_list(
        &self,
        namespace: Option<&str>,
        kind: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let mut req = serde_json::json!({
            "type": "credential_list",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
        });
        if let Some(ns) = namespace {
            req["namespace"] = serde_json::Value::String(ns.to_string());
        }
        if let Some(k) = kind {
            req["kind"] = serde_json::Value::String(k.to_string());
        }
        self.request_response(req).await
    }

    /// Fetch the full (non-material) record for a credential by id.
    pub async fn credential_get(&self, id: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "credential_get",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "id": id,
        });
        self.request_response(req).await
    }

    /// Fetch the secret material for a credential by id. Audit-logged on
    /// the runtime side; the desktop should only call this for the Reveal
    /// affordance or OAuth-token retrieval.
    pub async fn credential_get_material(
        &self,
        id: &str,
        reason: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "credential_get_material",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "id": id,
            "reason": reason,
        });
        self.request_response(req).await
    }

    /// Store or overwrite a credential at `(namespace, name)`. Returns the
    /// runtime-assigned credential id on success.
    pub async fn credential_set(
        &self,
        namespace: &str,
        name: &str,
        kind: &str,
        material: &str,
        metadata: Option<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let mut req = serde_json::json!({
            "type": "credential_set",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "namespace": namespace,
            "name": name,
            "kind": kind,
            "material": material,
        });
        if let Some(meta) = metadata {
            req["metadata"] = meta;
        }
        self.request_response(req).await
    }

    /// Delete a credential by id.
    pub async fn credential_delete(&self, id: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "credential_delete",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "id": id,
        });
        self.request_response(req).await
    }

    // ── Model catalog ───────────────────────────────────────────────

    /// List configured models from the runtime's model catalog.
    pub async fn model_list(&self) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "model_list",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
        });
        self.request_response(req).await
    }

    /// Re-read the model catalog and credential vault from disk.
    pub async fn model_reload(&self) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "model_reload",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
        });
        self.request_response(req).await
    }

    /// List the built-in model presets the runtime ships with.
    pub async fn model_templates(&self) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "model_templates",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
        });
        self.request_response(req).await
    }

    /// Add a model to the runtime catalog.
    pub async fn model_add(&self, args: serde_json::Value) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "model_add",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "args": args,
        });
        self.request_response(req).await
    }

    /// Update an existing model catalog entry.
    pub async fn model_update(&self, args: serde_json::Value) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "model_update",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "args": args,
        });
        self.request_response(req).await
    }

    /// Remove a model from the runtime catalog.
    pub async fn model_remove(&self, id: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "model_remove",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "id": id,
        });
        self.request_response(req).await
    }

    /// Live-test a configured model.
    pub async fn model_test(&self, id: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "model_test",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "id": id,
        });
        self.request_response(req).await
    }

    // ── Principal operations (ADR-041) ───────────────────────────────

    /// Send a Principal message via the streaming IPC path. The
    /// daemon emits `principal_sent_chunk` deltas (and content-free
    /// `principal_sent_iteration` boundary markers) followed by a
    /// `principal_sent_done` packet carrying the full final answer.
    /// Each message is forwarded through the supplied `on_event`
    /// closure; the `on_done` closure receives the final `content`
    /// string once the supervisor has settled.
    ///
    /// `request_id` is the caller's pre-minted correlation id (see
    /// `next_request_id`). The runtime's `streaming_runs` registry is
    /// keyed by this id — the desktop tracks it so a follow-up
    /// `principal_send_control(steer)` call can target the right run.
    /// Hardcoded `1` would collide if two streams ever ran in parallel
    /// (e.g. two tabs); the runtime caps successor ids at 2^63 (see
    /// `next_successor_request_id` in the IPC handler), so capping ours
    /// at 2^62 - 1 keeps the namespaces disjoint.
    pub async fn principal_send_stream<F, G>(
        &self,
        app: &tauri::AppHandle,
        request_id: u64,
        name: String,
        message: String,
        on_event: F,
        on_done: G,
    ) -> Result<()>
    where
        F: Fn(ChatStreamMsg) + Send + Sync + 'static,
        G: FnOnce(String) + Send + 'static,
    {
        ensure_daemon().await?;

        let request = serde_json::json!({
            "type": "principal_send_stream",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": request_id,
            "name": name,
            "message": message,
            // The runtime's IPC layer attaches `CallerContext::local()`
            // (subject `Subject::User("local")`) to socket-based requests,
            // and the `PrincipalCreate` handler uses that caller subject
            // for the principal's owner. Sending a different string here
            // would make the chat peer (`Subject::User(this string)`)
            // diverge from the owner, failing the `check_permission`
            // owner-equality check (`user:desktop cannot perform Chat on
            // principal:Test`). Mirror the local-trust identity so a
            // desktop-created principal is chat-able from the same
            // desktop. The runtime's session-key for this peer will be
            // `local`, which is also what the CLI's local invocations use
            // (their `_paths.user()` defaults to "default" but the IPC
            // caller's subject is still `local`; CLI sessions are keyed
            // by `--user`, this single-thread desktop is keyed by `local`).
            "user": "local",
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
                    on_event(ChatStreamMsg::Chunk {
                        delta: delta.clone(),
                    });
                    let _ = app.emit(
                        "peko-stream",
                        &StreamEvent::Chunk {
                            content: delta,
                            timestamp,
                        },
                    );
                }
                "principal_sent_iteration" => {
                    // Content-free boundary marker. Iteration counter
                    // starts at 1 (first `Lifecycle{Running}` after the
                    // run starts). Missing/invalid defaults to 0 so the
                    // frontend can still drive its pill.
                    let iteration =
                        raw.get("iteration").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    on_event(ChatStreamMsg::Iteration { iteration });
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

    /// Send a control message targeting an in-flight `principal_send_stream`
    /// run. `mode` is one of:
    ///
    /// - `"interrupt"` — soft-cancel: aborts the run at the next
    ///   agentic-loop seam and returns the partial assistant text.
    ///   Mirrors the runtime's `PrincipalSendControlMode::Interrupt`.
    /// - `"steer"` — user-added text is pushed onto the run's inbox
    ///   (`AsyncInboxItem::Steering`) and the next agentic iteration
    ///   drains it as new context. Used by the desktop's chat input
    ///   when a stream is already running and the user wants to
    ///   redirect mid-flight. Mirrors
    ///   `PrincipalSendControlMode::Steer { text }`.
    ///
    /// `target_request_id` is the `request_id` returned by the
    /// originating `principal_send_stream` call. The runtime's
    /// `streaming_runs` registry is keyed by it — sending the wrong
    /// id results in `UnknownRun` and the control packet is dropped.
    ///
    /// Returns the runtime's single-shot `principal_sent_control_done`
    /// envelope, which carries a `status: "applied" | "unknown_run"`
    /// discriminator the caller can surface to the user.
    pub async fn principal_send_control(
        &self,
        target_request_id: u64,
        mode: PrincipalSendControlMode,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let mode_payload = match &mode {
            PrincipalSendControlMode::Interrupt => serde_json::json!({ "mode": "interrupt" }),
            PrincipalSendControlMode::Steer { text } => {
                serde_json::json!({ "mode": "steer", "text": text })
            }
        };
        let req = serde_json::json!({
            "type": "principal_send_control",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": target_request_id,
            "target_request_id": target_request_id,
            "mode": mode_payload,
        });
        self.request_response(req).await
    }

    /// Send a Principal message via the non-streaming IPC path. The
    /// daemon returns a single `principal_sent` packet with the full
    /// final answer. Used by code paths that don't need live tokens
    /// (e.g. CLI-style bulk operations). The `user` field mirrors the
    /// streaming variant — see `principal_send_stream` for the rationale
    /// on `Subject::User("local")` alignment.
    pub async fn principal_send(&self, name: String, message: String) -> Result<String> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_send",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "message": message,
            "user": "local",
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
    ///
    /// **Wire shape (audit H7):** `peer` is re-encoded from the
    /// Display form (`"user:local"`) into the tagged Subject form
    /// (`{"kind":"user","id":"local"}`) before sending. The runtime's
    /// `RequestPacket::PrincipalLog.peer` is `Option<Subject>` with
    /// `#[serde(tag = "kind", content = "id")]` — sending a bare
    /// string causes serde to reject the entire envelope before the
    /// handler runs, so the chat-history view silently returns
    /// empty. This helper centralizes the conversion so callers can
    /// keep using the Display form.
    pub async fn principal_log(
        &self,
        name: &str,
        peer: Option<&str>,
        limit: Option<usize>,
        since_secs: Option<u64>,
        cursor: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_log",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "peer": peer.map(peer_str_to_subject_value),
            "limit": limit,
            "since_secs": since_secs,
            "cursor": cursor,
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
    pub async fn principal_create(
        &self,
        name: &str,
        description: Option<&str>,
        model_id: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_create",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "description": description,
            "model_id": model_id,
        });
        self.request_response(req).await
    }

    /// Update an existing Principal's mutable config. Mirror of
    /// `RequestPacket::PrincipalUpdate`. All fields except `name` are
    /// optional; omitted fields are left unchanged. The daemon checks
    /// `Permission::ManageSettings` before mutating `principal.toml`.
    pub async fn principal_update(
        &self,
        name: &str,
        description: Option<&str>,
        status: Option<&str>,
        exposure: Option<&str>,
        preferred_model_id: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_update",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "description": description,
            "status": status,
            "exposure": exposure,
            "preferred_model_id": preferred_model_id,
        });
        self.request_response(req).await
    }

    /// Remove a Principal and its on-disk workspace. Mirror of
    /// `RequestPacket::PrincipalRemove`. The daemon checks
    /// `Permission::ManageSettings` before deleting.
    pub async fn principal_remove(&self, name: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_remove",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
        });
        self.request_response(req).await
    }

    /// PR #3: mirror of `RequestPacket::PrincipalSetStatus`. The
    /// daemon validates the status enum and re-announces the
    /// instance tunnel message so the hub reflects the new state.
    pub async fn principal_set_status(
        &self,
        name: &str,
        status: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_set_status",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "status": status,
        });
        self.request_response(req).await
    }

    /// PR #3: mirror of `RequestPacket::PrincipalSetExposure`. The
    /// daemon validates the exposure enum and re-announces the
    /// instance tunnel message.
    pub async fn principal_set_exposure(
        &self,
        name: &str,
        exposure: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_set_exposure",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "exposure": exposure,
        });
        self.request_response(req).await
    }

    /// PR #3: mirror of `RequestPacket::PrincipalGrantPermission`.
    /// `permission` is a serialized `PermissionGrant` (the runtime's
    /// own shape — `{principal, capabilities, expires_at?}`); the
    /// daemon validates against the principal's `permissions: Vec<PermissionGrant>`
    /// authoritative ACL.
    pub async fn principal_grant_permission(
        &self,
        name: &str,
        permission: &serde_json::Value,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_grant_permission",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "permission": permission,
        });
        self.request_response(req).await
    }

    /// PR #3: mirror of `RequestPacket::PrincipalRevokePermission`.
    /// `grant_id` is the runtime's stable id for the grant (UUID v4).
    pub async fn principal_revoke_permission(
        &self,
        name: &str,
        grant_id: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_revoke_permission",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "grant_id": grant_id,
        });
        self.request_response(req).await
    }

    /// PR #3: mirror of `RequestPacket::PrincipalPermissions`. Returns
    /// the full `permissions: Vec<PermissionGrant>` array so the
    /// desktop can render the access list inline.
    pub async fn principal_permissions(&self, name: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_permissions",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
        });
        self.request_response(req).await
    }

    /// PR #11: mirror of `RequestPacket::PrincipalMintInvite`. The
    /// runtime mints a signed invite token, returns it in the
    /// `principal_invite_minted` response. `scope` is forwarded
    /// verbatim as a JSON array of permission names; the daemon
    /// resolves them against `peko_auth::Permission` (matches the
    /// desktop-side parse in `commands/principal.rs`).
    pub async fn principal_mint_invite(
        &self,
        name: &str,
        scope: Vec<String>,
        ttl_secs: u64,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_mint_invite",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "scope": scope,
            "ttl_secs": ttl_secs,
        });
        self.request_response(req).await
    }

    /// PR #11: mirror of `RequestPacket::PrincipalRevokeInvite`.
    /// Adds the `jti` to the runtime's in-memory
    /// `InviteRevocationSet`; the next inbound request presenting
    /// that token is rejected.
    pub async fn principal_revoke_invite(
        &self,
        name: &str,
        jti: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_revoke_invite",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "jti": jti,
        });
        self.request_response(req).await
    }

    // -- Channel surface (peko-channel cross-runtime desktop PR-1) ----
    //
    // Read-only IPC wrappers. Posts land in PR-2 / PR-2a; invites +
    // leaves land in PR-3. Wire types follow the runtime's
    // RequestPacket variants in `peko_runtime::ipc::packet::RequestPacket`:
    //
    // - `channel_list` → `ChannelList { principal_name }`
    // - `channel_peek` → `ChannelPeek { channel, since }`
    // - `channel_members` → `ChannelMembers { channel }`
    // - `channel_post` → `ChannelPost { channel, sender_name, text, parent }`

    /// List channels `principal_name` is a member of. Mirrors
    /// `RequestPacket::ChannelList`. The desktop's `useChannels` hook
    /// iterates local principals and dedupes by `channel_id` to
    /// render a unified sidebar.
    pub async fn channel_list(&self, principal_name: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "channel_list",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "principal_name": principal_name,
        });
        self.request_response(req).await
    }

    /// Fetch the channel's event log since `since` (None = from the
    /// start). Mirrors `RequestPacket::ChannelPeek`. Returns the
    /// full `ChannelPeekResult { channel, events }` envelope — the
    /// desktop's `channel_get` reuses this to derive metadata from
    /// the first `Created` event.
    pub async fn channel_peek(
        &self,
        channel: &str,
        since: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "channel_peek",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "channel": channel,
            "since": since,
        });
        self.request_response(req).await
    }

    /// List the principal DIDs currently in `channel`. Mirrors
    /// `RequestPacket::ChannelMembers`. The runtime derives the
    /// authoritative membership from the `Member*` event log.
    pub async fn channel_members(&self, channel: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "channel_members",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "channel": channel,
        });
        self.request_response(req).await
    }

    /// PR-2a: post a message to `channel` from `sender_name`. `parent`
    /// is the optional task id of the message being replied to.
    /// Mirrors `RequestPacket::ChannelPost { channel, sender_name,
    /// text, parent }`. Returns the `ChannelPosted { task_id, channel
    /// }` envelope; the desktop's `channel_post` Tauri command
    /// projects `task_id` to the frontend.
    pub async fn channel_post(
        &self,
        channel: &str,
        sender_name: &str,
        text: &str,
        parent: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "channel_post",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "channel": channel,
            "sender_name": sender_name,
            "text": text,
            "parent": parent,
        });
        self.request_response(req).await
    }

    /// PR-3: create a new channel owned by `creator_name`. Mirrors
    /// `RequestPacket::ChannelCreate { creator_name, name }`. Returns
    /// the `ChannelCreated { channel }` envelope; the desktop's
    /// `channel_create` Tauri command projects `channel` to the
    /// frontend as the freshly minted `ChannelId` string.
    pub async fn channel_create(
        &self,
        creator_name: &str,
        name: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "channel_create",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "creator_name": creator_name,
            "name": name,
        });
        self.request_response(req).await
    }

    /// PR-3: add `invitee_name` to `channel` (invited by
    /// `inviter_name`). Mirrors `RequestPacket::ChannelInvite
    /// { channel, inviter_name, invitee_name }`. Returns the
    /// `ChannelInvited { channel, invitee }` envelope; the desktop's
    /// `channel_invite` Tauri command projects both fields to the
    /// frontend. For cross-runtime invites the runtime emits a
    /// `TunnelChannelInvite` envelope out-of-band; the IPC response
    /// acknowledges only the local invite.
    pub async fn channel_invite(
        &self,
        channel: &str,
        inviter_name: &str,
        invitee_name: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "channel_invite",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "channel": channel,
            "inviter_name": inviter_name,
            "invitee_name": invitee_name,
        });
        self.request_response(req).await
    }

    /// PR-3: remove `principal_name` from `channel`. Mirrors
    /// `RequestPacket::ChannelLeave { channel, principal_name }`.
    /// Returns the `ChannelLeft { channel, principal }` envelope; the
    /// desktop's `channel_leave` Tauri command projects both fields
    /// so the React side can surface "left <channel>" or remove the
    /// channel from the sidebar if the leaver was the last local
    /// member.
    pub async fn channel_leave(
        &self,
        channel: &str,
        principal_name: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "channel_leave",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "channel": channel,
            "principal_name": principal_name,
        });
        self.request_response(req).await
    }

    /// PR-2b: subscribe to live channel events for `channel`. Mirrors
    /// `principal_send_stream`'s request-response shape — the daemon
    /// sends `ChannelEventReceived` packets in a loop until the
    /// client disconnects, and the desktop re-emits each as a
    /// `peko-stream` event with `kind: "channel_event"` so the React
    /// `useChannelStreamInvalidator` hook can invalidate
    /// `["channel-events", channelId]` on every update.
    ///
    /// `since` is the caller's last-seen line number — events at
    /// earlier line numbers are replayed, then live events are
    /// forwarded. The runtime closes the stream when the client
    /// disconnects or the daemon shuts down; the loop also exits
    /// on a 120s timeout to avoid leaking tasks.
    pub async fn channel_events_watch(
        &self,
        app: &tauri::AppHandle,
        channel: &str,
        since: Option<&str>,
    ) -> Result<()> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "channel_events_watch",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "channel": channel,
            "since": since,
        });
        let bytes = serde_json::to_vec(&req).map_err(|e| IpcError::Serialization(e.to_string()))?;

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
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .to_string();

            match packet_type {
                "channel_event_received" => {
                    // PR-2b: forward each event as a `peko-stream`
                    // channel_event. The React side's
                    // `useChannelStreamInvalidator` filters on
                    // `payload.channel === channelId`.
                    let channel_id = raw
                        .get("channel")
                        .and_then(|v| v.as_str())
                        .unwrap_or(channel)
                        .to_string();
                    let payload = raw.get("event").cloned().unwrap_or(serde_json::Value::Null);
                    let _ = app.emit(
                        "peko-stream",
                        &StreamEvent::ChannelEvent {
                            channel_id,
                            payload,
                            timestamp,
                        },
                    );
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
}

#[cfg(unix)]
impl Drop for IpcClient {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self._tmp_path);
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

    /// PR-2b: `StreamEvent::ChannelEvent` round-trips with the
    /// `channel_event` discriminator the React listener filters on.
    /// The `payload` is preserved verbatim so the React side can
    /// switch on `payload.kind` (mirrors the runtime's
    /// `peko_protocol::channel::ChannelEvent` shape).
    #[test]
    fn test_stream_event_channel_event_serialization() {
        let event = StreamEvent::ChannelEvent {
            channel_id: "chan_abcdefgh".to_string(),
            payload: serde_json::json!({
                "kind": "posted",
                "channel": "chan_abcdefgh",
                "author": "prin_bob",
                "parent": null,
                "text": "hello from B",
                "at": "2026-08-06T12:00:00Z",
            }),
            timestamp: "0d 12:00:00 UTC".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("channel_event"), "got {json}");
        assert!(json.contains("chan_abcdefgh"));
        assert!(json.contains("posted"));

        let deserialized: StreamEvent = serde_json::from_str(&json).unwrap();
        match deserialized {
            StreamEvent::ChannelEvent {
                channel_id,
                payload,
                ..
            } => {
                assert_eq!(channel_id, "chan_abcdefgh");
                assert_eq!(payload["kind"], "posted");
                assert_eq!(payload["text"], "hello from B");
            }
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

    /// Lock the wire-level alignment between the desktop's
    /// `principal_send_stream` peer and the runtime's `caller.subject()`
    /// (see `principal_send_stream` for the rationale). Without this
    /// pin a future "use a friendlier label" change would silently
    /// break chat for desktop-created principals — owner =
    /// `Subject::User("local")` (from `CallerContext::local()` over the
    /// local socket) but peer would be `Subject::User("desktop")`,
    /// failing `check_permission`'s owner-equality rule and surfacing
    /// `user:desktop cannot perform Chat on principal:<name>`.
    #[test]
    fn principal_send_stream_request_uses_local_peer() {
        let req = serde_json::json!({
            "type": "principal_send_stream",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": "alice",
            "message": "hello",
            "user": "local",
        });
        assert_eq!(
            req.get("user").and_then(|v| v.as_str()),
            Some("local"),
            "chat peer must match the IPC caller's local-trust subject \
             (Subject::User(\"local\")) so the principal's owner check passes"
        );
    }

    /// Same alignment pin for the non-streaming `principal_send` path —
    /// the streaming variant above is the hot path, but the one-shot
    /// variant shares the same wire-level owner/peer contract and
    /// would hit the same bug if anyone "fixes" the user string back
    /// to "desktop".
    #[test]
    fn principal_send_request_uses_local_peer() {
        let req = serde_json::json!({
            "type": "principal_send",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": "alice",
            "message": "hello",
            "user": "local",
        });
        assert_eq!(req.get("user").and_then(|v| v.as_str()), Some("local"));
    }

    /// The runtime's `RequestPacket::PrincipalLog.peer` is
    /// `Option<Subject>` with `#[serde(tag = "kind", content = "id")]`
    /// — sending a bare `"user:local"` string causes the entire
    /// envelope to fail serde deserialization BEFORE the handler
    /// runs, so `principal_log` silently returns an empty event list
    /// and the chat history never loads on cold boot. Lock the
    /// conversion from Display form to tagged Subject form here.
    #[test]
    fn peer_str_to_subject_value_user() {
        assert_eq!(
            peer_str_to_subject_value("user:local"),
            serde_json::json!({ "kind": "user", "id": "local" })
        );
        assert_eq!(
            peer_str_to_subject_value("user:alice"),
            serde_json::json!({ "kind": "user", "id": "alice" })
        );
    }

    #[test]
    fn peer_str_to_subject_value_principal() {
        assert_eq!(
            peer_str_to_subject_value("principal:did:peko:abc123"),
            serde_json::json!({ "kind": "principal", "id": "did:peko:abc123" })
        );
    }

    /// `Subject::Public` is a unit variant — the runtime serializes it
    /// as `{"kind": "public"}` with no `id` field (verified in
    /// `observability/audit.rs:185-198`). Mirror that exactly so the
    /// deserializer accepts it.
    #[test]
    fn peer_str_to_subject_value_public() {
        assert_eq!(
            peer_str_to_subject_value("public"),
            serde_json::json!({ "kind": "public" })
        );
    }

    /// A bare id with no prefix (e.g. legacy owner strings, or
    /// `subject_id` values surfaced via Display of stripped forms)
    /// shouldn't be silently mapped to `User` — surface it as `null`
    /// so the request fails loudly instead of returning a misleading
    /// privacy-gated empty list.
    #[test]
    fn peer_str_to_subject_value_unknown_prefix_is_null() {
        assert_eq!(peer_str_to_subject_value("alice"), serde_json::Value::Null);
    }
}
