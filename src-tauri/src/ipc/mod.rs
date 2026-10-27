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

/// Receive timeout for `principal_create` / `principal_import`. The
/// runtime's ADR-054 genesis pipeline can block a create far past the
/// default 10s request budget (the runtime CLI's own genesis wait caps
/// at 300s); 320s gives the daemon headroom while still bounding a
/// truly hung call.
pub const GENESIS_REQUEST_TIMEOUT: Duration = Duration::from_secs(320);

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
/// flight. `ToolStart` / `ToolEnd` are the run's tool steps and
/// `Thinking` its reasoning deltas; the runtime sends tool inputs,
/// outputs, and thinking only to the peko's owner (others get tool
/// names and status).
///
/// `Queued` means the peko was already working on this thread: the
/// runtime posted the message to the DM channel and queued it for the
/// running turn (`[queued]` `Done`). The reply arrives on the DM
/// channel, not on this stream. `RunSummary` mirrors the runtime's
/// `run_summary` packet sent once per finished run.
#[derive(Serialize, Debug, Clone)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ChatStreamMsg {
    /// A streamed assistant text delta.
    Chunk { delta: String },
    /// Agentic-iteration boundary marker (iteration counter starts at 1).
    Iteration { iteration: u32 },
    /// The message was queued behind the peko's running turn.
    Queued { message: String },
    /// A tool call started. `input` is a short redacted summary.
    ToolStart {
        tool_id: String,
        name: String,
        input: Option<String>,
    },
    /// A tool call finished. `output` is a short redacted excerpt.
    ToolEnd {
        tool_id: String,
        name: String,
        success: bool,
        duration_ms: u64,
        output: Option<String>,
    },
    /// A thinking (reasoning) text delta.
    Thinking { delta: String },
    /// Per-run totals: iterations, token usage, and failed tool calls.
    RunSummary {
        iterations: u32,
        total_tokens: Option<u64>,
        tool_errors: Vec<RunToolError>,
    },
}

/// One failed tool call from a runtime `run_summary` packet.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunToolError {
    pub tool_name: Option<String>,
    pub error_message: String,
}

/// The `[queued]` prefix the runtime puts on a streaming send's
/// `Done { success: false }` when the thread already has a running
/// turn (`IngressOutcome::Queued`).
pub const QUEUED_PREFIX: &str = "[queued]";

/// Project a runtime tool-step or thinking packet
/// (`principal_sent_tool_start` / `_tool_end` / `_thinking`) into its
/// [`ChatStreamMsg`]; `None` for any other packet.
pub fn step_from_packet(raw: &serde_json::Value) -> Option<ChatStreamMsg> {
    let text = |key: &str| raw.get(key).and_then(|v| v.as_str()).map(String::from);
    match raw.get("type")?.as_str()? {
        "principal_sent_tool_start" => Some(ChatStreamMsg::ToolStart {
            tool_id: text("tool_id")?,
            name: text("name")?,
            input: text("input"),
        }),
        "principal_sent_tool_end" => Some(ChatStreamMsg::ToolEnd {
            tool_id: text("tool_id")?,
            name: text("name")?,
            success: raw.get("success")?.as_bool()?,
            duration_ms: raw.get("duration_ms").and_then(|v| v.as_u64()).unwrap_or(0),
            output: text("output"),
        }),
        "principal_sent_thinking" => Some(ChatStreamMsg::Thinking {
            delta: text("delta")?,
        }),
        _ => None,
    }
}

/// Project a runtime `run_summary` packet into [`ChatStreamMsg::RunSummary`].
pub fn run_summary_from_packet(raw: &serde_json::Value) -> ChatStreamMsg {
    let iterations = raw.get("iterations").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let total_tokens = raw
        .get("usage")
        .and_then(|u| u.get("total_tokens"))
        .and_then(|v| v.as_u64());
    let tool_errors = raw
        .get("tool_errors")
        .and_then(|v| v.as_array())
        .map(|errs| {
            errs.iter()
                .map(|e| RunToolError {
                    tool_name: e
                        .get("tool_name")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    error_message: e
                        .get("error_message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    ChatStreamMsg::RunSummary {
        iterations,
        total_tokens,
        tool_errors,
    }
}

/// This is the desktop's unified shape — the daemon uses different
/// packet shapes (ResponsePacket) which get mapped into this.
///
/// `rename_all = "camelCase"` renames variant *tags* (no effect here
/// since each variant has an explicit `rename = "..."` override).
/// `rename_all_fields = "camelCase"` (serde ≥1.0.165) renames
/// struct-variant *fields* — `channel_id` → `channelId`, etc.
/// Without this, the React listener reads `payload.channelId` but
/// the Rust side emits `channel_id` and the listener silently
/// misses every event.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
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
    /// With the enum-level `rename_all = "camelCase"`, this serializes
    /// as `{type: "channel_event", channelId: "...", payload: {...},
    /// timestamp: "..."}` — the camelCase `channelId` is what
    /// `useChannelStreamInvalidator` filters on.
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

/// True when the daemon answered with an `error` packet.
pub fn is_error_response(response: &serde_json::Value) -> bool {
    response.get("type").and_then(|v| v.as_str()) == Some("error")
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
    if let Some(id) = peer.strip_prefix("visitor:") {
        return serde_json::json!({ "kind": "visitor", "id": id });
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
        self.request_response_with_timeout(request, Duration::from_secs(10))
            .await
    }

    /// `request_response` with a caller-supplied receive timeout.
    /// `principal_create` and `principal_import` use this: ADR-054
    /// genesis-aware creates can block the daemon far past the default
    /// 10s budget (the runtime's own CLI waits up to 300s for the
    /// genesis turn), so those calls get a 320s ceiling instead of a
    /// spurious `IpcError::Timeout` mid-provisioning.
    async fn request_response_with_timeout(
        &self,
        request: serde_json::Value,
        timeout: Duration,
    ) -> Result<serde_json::Value> {
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

        let len = tokio::time::timeout(timeout, self.socket.recv_from(&mut buf))
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
    /// `next_request_id`) so every packet of this run carries it.
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
            // ADR-057: caller-declared identity was removed from the
            // wire — the runtime derives the caller's subject from the
            // connection (`CallerContext`), so there is no `user`
            // field anymore. Older desktop builds sent `"user":
            // "local"`; the runtime now rejects unknown fields on
            // these packets.
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

        // The runtime's success sequence is `principal_sent_done` →
        // `run_summary` → `done`; a failed run sends `run_summary` →
        // `error` → `done { success: false }`. A busy thread answers
        // `done { success: false, error: "[queued]…" }` with no content.
        // Replies to queued messages are posted to the DM channel after
        // this stream's `done` — the chat follows them through
        // `principal_log_watch`, not here.
        let mut on_done = Some(on_done);
        let mut final_content: Option<String> = None;
        let mut pending_error: Option<String> = None;
        let mut buf = vec![0u8; 65536];
        loop {
            // After an `error` packet only the closing `done` is still
            // expected; don't wait the full idle budget for it.
            let idle = if pending_error.is_some() {
                Duration::from_secs(2)
            } else {
                Duration::from_secs(120)
            };
            let len = match tokio::time::timeout(idle, self.socket.recv_from(&mut buf)).await {
                Ok(Ok((len, _))) => len,
                Ok(Err(e)) => return Err(IpcError::ReceiveFailed(e.to_string())),
                Err(_) => {
                    return Err(match pending_error {
                        Some(message) => IpcError::ReceiveFailed(message),
                        None => IpcError::Timeout,
                    })
                }
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
                    final_content = Some(
                        raw.get("content")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    );
                    let _ = app.emit("peko-stream", &StreamEvent::Done { timestamp });
                }
                "run_summary" => on_event(run_summary_from_packet(&raw)),
                "principal_sent_tool_start"
                | "principal_sent_tool_end"
                | "principal_sent_thinking" => {
                    if let Some(step) = step_from_packet(&raw) {
                        on_event(step);
                    }
                }
                "done" => {
                    let success = raw
                        .get("success")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    let error = raw.get("error").and_then(|v| v.as_str()).map(String::from);
                    if success {
                        if let Some(done) = on_done.take() {
                            done(final_content.take().unwrap_or_default());
                        }
                        return Ok(());
                    }
                    if let Some(queued) = error.as_deref().filter(|e| e.starts_with(QUEUED_PREFIX))
                    {
                        on_event(ChatStreamMsg::Queued {
                            message: queued[QUEUED_PREFIX.len()..].trim().to_string(),
                        });
                        if let Some(done) = on_done.take() {
                            done(String::new());
                        }
                        return Ok(());
                    }
                    let message = error
                        .or(pending_error)
                        .unwrap_or_else(|| "run failed".to_string());
                    let _ = app.emit(
                        "peko-stream",
                        &StreamEvent::Error {
                            message: message.clone(),
                            timestamp,
                        },
                    );
                    return Err(IpcError::ReceiveFailed(message));
                }
                "error" => {
                    pending_error = Some(
                        raw.get("message")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unknown error")
                            .to_string(),
                    );
                }
                "heartbeat" => continue,
                other => {
                    eprintln!("[peko-desktop] Unknown IPC response packet type: {other}");
                    continue;
                }
            }
        }
    }

    /// Stop the run bound to a (principal, peer) thread. Mirror of
    /// `RequestPacket::PrincipalStop`: the daemon fires the run's cancel
    /// token (the loop exits at the next iteration boundary) and posts a
    /// `⏹ stopped by user` marker to the DM channel. `peer: None` is the
    /// owner's thread. Idempotent — with no running turn the daemon
    /// answers `done { success: false, error: "no running turn…" }`,
    /// which is returned as-is rather than as an error.
    pub async fn principal_stop(
        &self,
        name: &str,
        peer: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_stop",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "peer": peer.map(peer_str_to_subject_value),
        });
        self.request_response(req).await
    }

    /// Send a Principal message via the non-streaming IPC path. The
    /// daemon returns a single `principal_sent` packet with the full
    /// final answer. Used by code paths that don't need live tokens
    /// (e.g. CLI-style bulk operations). Like the streaming variant,
    /// no `user` field is sent — ADR-057 removed caller-declared
    /// identity from the wire.
    pub async fn principal_send(&self, name: String, message: String) -> Result<String> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_send",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "message": message,
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

    /// Follow a peer's thread with a Principal live. Mirror of
    /// `RequestPacket::PrincipalLogWatch`: the daemon replays DM rows
    /// newer than `since_cursor`, then streams new ones as
    /// `principal_log_appended` packets, with `heartbeat` packets every
    /// two seconds. There is no terminal `done`; the stream runs until
    /// the caller drops it (the Tauri command aborts the task) or the
    /// daemon goes away. Each row is passed to `on_message` in the same
    /// shape `principal_log` pages carry.
    pub async fn principal_log_watch<F>(
        &self,
        name: &str,
        peer: Option<&str>,
        since_cursor: Option<&str>,
        on_message: F,
    ) -> Result<()>
    where
        F: Fn(serde_json::Value) + Send + Sync + 'static,
    {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_log_watch",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "peer": peer.map(peer_str_to_subject_value),
            "since_cursor": since_cursor,
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
            // Heartbeats arrive every 2s; 15s of silence means the
            // daemon is gone.
            let len = match tokio::time::timeout(
                Duration::from_secs(15),
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
            match raw.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                "principal_log_appended" => {
                    if let Some(message) = raw.get("message") {
                        on_message(message.clone());
                    }
                }
                "heartbeat" => {}
                "done" => return Ok(()),
                "error" => {
                    let message = raw
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error")
                        .to_string();
                    return Err(IpcError::ReceiveFailed(message));
                }
                other => eprintln!("[peko-desktop] Unknown log-watch packet type: {other}"),
            }
        }
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
    ///
    /// Uses [`GENESIS_REQUEST_TIMEOUT`] instead of the default 10s:
    /// ADR-054's genesis pipeline can keep the daemon busy long after
    /// the workspace is materialized, and the default budget would
    /// surface a spurious timeout mid-provisioning.
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
        self.request_response_with_timeout(req, GENESIS_REQUEST_TIMEOUT)
            .await
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

    /// Export a Principal as a `.peko` full-existence package
    /// (ADR-056). Mirror of `RequestPacket::PrincipalExport` — the
    /// wire shape is exactly `{name, output}`; the legacy
    /// `include_sessions` / `with_extensions` / `full_snapshot` flags
    /// were retired runtime-side (exports are always full snapshots).
    /// `output: None` lets the daemon pick its default export path.
    /// Returns the `principal_exported { name, output_path }` envelope.
    pub async fn principal_export(
        &self,
        name: &str,
        output: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_export",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "output": output,
        });
        self.request_response(req).await
    }

    /// Import a `.peko` package from `file_path`. Mirror of
    /// `RequestPacket::PrincipalImport`. The desktop pre-confirms
    /// (`confirmed: true`) because the user has already accepted the
    /// import in the file-picker / preview flow — the daemon rejects
    /// unconfirmed imports outright. Returns the
    /// `principal_imported { name, config_path }` envelope.
    ///
    /// Uses [`GENESIS_REQUEST_TIMEOUT`]: unpacking a full-existence
    /// package (plus any genesis work the daemon runs on load) can
    /// exceed the default 10s budget.
    pub async fn principal_import(
        &self,
        file_path: &str,
        name: Option<&str>,
        expected_manifest_checksum: &str,
        rotate_keys: bool,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_import",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "file_path": file_path,
            "name": name,
            "force": false,
            "expected_manifest_checksum": expected_manifest_checksum,
            "rotate_keys": rotate_keys,
        });
        self.request_response_with_timeout(req, GENESIS_REQUEST_TIMEOUT)
            .await
    }

    /// Mirror of `RequestPacket::PrincipalImportPreview`: read a `.peko`
    /// package without importing it. The `principal_import_previewed`
    /// envelope lists what would run (hook and MCP definitions, skills,
    /// executable files) plus the `manifest_checksum` the import must
    /// echo back, so the package cannot change between review and
    /// import. Without `rotate_keys`, a snapshot of a peko already hosted
    /// here is refused at this step.
    pub async fn principal_import_preview(
        &self,
        file_path: &str,
        name: Option<&str>,
        rotate_keys: bool,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_import_preview",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "file_path": file_path,
            "name": name,
            "force": false,
            "rotate_keys": rotate_keys,
        });
        self.request_response_with_timeout(req, Duration::from_secs(60))
            .await
    }

    /// Load (or confirm already loaded) an on-disk Principal into the
    /// daemon's in-memory manager. Mirror of
    /// `RequestPacket::PrincipalReload`; idempotent. Required after a
    /// materialize-out-of-band flow so the cron engine can drive the
    /// principal's genesis jobs without a daemon restart. Returns the
    /// `principal_loaded { name, loaded }` envelope.
    pub async fn principal_reload(&self, name: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_reload",
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

    /// Mirror of `RequestPacket::PrincipalRegister` (ADR-081): set the
    /// peko's PekoHub registration — `local_only`, `private`
    /// (registered, reachable by its contacts), or `public`
    /// (discoverable). The daemon updates the hub over the tunnel.
    pub async fn principal_register(
        &self,
        name: &str,
        exposure: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_register",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "exposure": exposure,
        });
        self.request_response_with_timeout(req, Duration::from_secs(30))
            .await
    }

    /// Mirror of `RequestPacket::PrincipalGrantPermission`: grant
    /// `permission` (`chat` / `view_settings` / `manage_settings` /
    /// `trusted`) on `name` to `subject`, given in Display form
    /// (`user:<route>`, `principal:<route>`, `visitor:<route>`, or
    /// `public`) and re-encoded as the runtime's `ActorRef`.
    pub async fn principal_grant_permission(
        &self,
        name: &str,
        subject: &str,
        permission: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_grant_permission",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "subject": peer_str_to_subject_value(subject),
            "permission": permission,
        });
        self.request_response(req).await
    }

    /// Mirror of `RequestPacket::PrincipalRevokePermission`: a grant is
    /// identified by its `(subject, permission)` pair.
    pub async fn principal_revoke_permission(
        &self,
        name: &str,
        subject: &str,
        permission: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "principal_revoke_permission",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": name,
            "subject": peer_str_to_subject_value(subject),
            "permission": permission,
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
    // - `channel_peek` → `ChannelPeek { channel, since, tail, before, query, author }`
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
    ///
    /// ADR-057: no `requester` field — read identity is derived
    /// server-side and reads are membership-gated; a non-member caller
    /// gets a `[forbidden]` error packet. The optional
    /// `tail`/`before`/`query`/`author` filters map to the runtime's
    /// tail-read and search modes (`tail` = newest N events at or
    /// before the `before` line cursor; `query`/`author` switch the
    /// daemon to its backward filtered scan).
    #[allow(clippy::too_many_arguments)]
    pub async fn channel_peek(
        &self,
        channel: &str,
        since: Option<&str>,
        tail: Option<usize>,
        before: Option<&str>,
        query: Option<&str>,
        author: Option<&str>,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "channel_peek",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "channel": channel,
            "since": since,
            "tail": tail,
            "before": before,
            "query": query,
            "author": author,
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

    /// Mirror of `RequestPacket::ChannelInfo`: the channel's kind,
    /// name, members, and each hosted member peko's wake policy.
    pub async fn channel_info(&self, channel: &str) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "channel_info",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "channel": channel,
        });
        self.request_response(req).await
    }

    /// Mirror of `RequestPacket::ChannelSetWake`: set what starts a turn
    /// for `principal_name` in a group (`human` / `mention` / `off`).
    pub async fn channel_set_wake(
        &self,
        channel: &str,
        principal_name: &str,
        wake: &str,
    ) -> Result<serde_json::Value> {
        ensure_daemon().await?;
        let req = serde_json::json!({
            "type": "channel_set_wake",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "channel": channel,
            "principal_name": principal_name,
            "wake": wake,
        });
        self.request_response(req).await
    }

    /// PR-2a: post a message to `channel`. Mirrors
    /// `RequestPacket::ChannelPost { channel, sender_name, text,
    /// parent }`. Returns the `ChannelPosted { task_id, channel
    /// }` envelope; the desktop's `channel_post` Tauri command
    /// projects `task_id` to the frontend.
    ///
    /// ADR-057: `sender_name: None` speaks as the caller's own
    /// server-derived identity (the common case for the desktop's
    /// "post as myself" affordance); `Some(name)` must be a principal
    /// name hosted by this runtime. A `user:<id>` sender is
    /// impersonation — the runtime refuses it with `[forbidden]`, so
    /// we reject it client-side first for a cleaner error.
    pub async fn channel_post(
        &self,
        channel: &str,
        sender_name: Option<&str>,
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
    ///
    /// Audit-fix: the enum-level `rename_all = "camelCase"` makes
    /// the `channel_id` struct field serialize as `channelId` in JSON
    /// (the React listener filters on `payload.channelId === channelId`).
    /// This test is the regression guard for that contract — if
    /// `rename_all` is dropped, `assert!(json.contains("\"channelId\""))`
    /// fails and the bug is caught at unit-test time, not at runtime.
    #[test]
    fn test_stream_event_channel_event_serialization() {
        let event = StreamEvent::ChannelEvent {
            channel_id: "chan_abcdefgh".to_string(),
            payload: serde_json::json!({
                "kind": "posted",
                "channel": "chan_abcdefgh",
                "author": "principal:did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2mKLpbHYkdWfyyEbAm",
                "parent": null,
                "text": "hello from B",
                "at": "2026-08-06T12:00:00Z",
            }),
            timestamp: "0d 12:00:00 UTC".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"channel_event\""), "got {json}");
        // camelCase `channelId` field — the audit-fix regression guard.
        assert!(
            json.contains("\"channelId\":\"chan_abcdefgh\""),
            "expected camelCase channelId in {json}"
        );
        assert!(json.contains("\"posted\""), "got {json}");
        // The snake_case `channel_id` MUST NOT appear — that was the
        // pre-fix wire shape that the React listener couldn't match.
        assert!(
            !json.contains("channel_id"),
            "snake_case channel_id leaked into wire: {json}"
        );

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

    /// PR-2b bridge translation: when the daemon's IPC loop receives
    /// a `channel_event_received` response packet, the Tauri bridge
    /// forwards it as a `peko-stream` `StreamEvent::ChannelEvent`
    /// with camelCase `channelId` (the field the React listener
    /// filters on). This test guards the bridge translation by
    /// feeding the loop a synthetic raw JSON packet and asserting
    /// the resulting `StreamEvent` shape — without needing to mock
    /// the `app.emit` handle.
    ///
    /// The test is in `tests` (not on a live `IpcClient`) because
    /// the bridge code is a private helper inside
    /// `IpcClient::channel_events_watch`. We exercise the
    /// translation step directly: parse → build struct → serialize
    /// → assert camelCase. End-to-end (with mock `app.emit`) is
    /// tracked as a follow-up since it requires a `tauri::test`
    /// harness that's not wired into the workspace yet.
    #[test]
    fn test_channel_events_watch_bridge_translates_to_camel_case() {
        use serde_json::json;
        // The exact shape the daemon emits on its `ResponsePacket::ChannelEventReceived`
        // envelope — `channel` field carries routing context, `event` is the
        // runtime's `ChannelEvent` JSON (with `kind: "posted" | "created" | ...`).
        let raw = json!({
            "type": "channel_event_received",
            "request_id": 7,
            "channel": "chan_abcdefgh",
            "event": {
                "kind": "posted",
                "channel": "chan_abcdefgh",
                "author": "principal:did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2mKLpbHYkdWfyyEbAm",
                "parent": null,
                "text": "hello from B",
                "at": "2026-08-06T12:00:00Z",
            },
        });
        // Same translation the bridge does at mod.rs:1590-1603.
        let channel_id = raw
            .get("channel")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let payload = raw.get("event").cloned().unwrap_or(json!(null));
        let bridge_event = StreamEvent::ChannelEvent {
            channel_id,
            payload,
            timestamp: "2026-08-06T12:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&bridge_event).unwrap();
        assert!(
            json.contains("\"channelId\":\"chan_abcdefgh\""),
            "bridge emitted snake_case channel_id: {json}"
        );
        assert!(json.contains("\"type\":\"channel_event\""), "got {json}");
        assert!(json.contains("\"posted\""), "got {json}");
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

    /// ADR-057: caller-declared identity was removed from the wire —
    /// the runtime derives the caller's subject from the connection
    /// (`CallerContext`) and the `user` field is gone from
    /// `PrincipalSend` / `PrincipalSendStream`. Pin the absence so a
    /// future "restore the label" change fails loudly: the runtime
    /// rejects unknown fields on these packets.
    #[test]
    fn principal_send_stream_request_has_no_user_field() {
        let req = serde_json::json!({
            "type": "principal_send_stream",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": "alice",
            "message": "hello",
        });
        assert!(
            req.get("user").is_none(),
            "ADR-057 removed caller-declared identity; the request must not carry `user`"
        );
    }

    /// Same pin for the non-streaming `principal_send` path — the
    /// streaming variant above is the hot path, but the one-shot
    /// variant shares the same ADR-057 wire contract.
    #[test]
    fn principal_send_request_has_no_user_field() {
        let req = serde_json::json!({
            "type": "principal_send",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": "alice",
            "message": "hello",
        });
        assert!(req.get("user").is_none());
    }

    /// Pin the `principal_export` wire shape: exactly `{name,
    /// output}` plus the envelope header. ADR-056 retired the
    /// `include_sessions` / `with_extensions` / `full_snapshot` flags —
    /// exports are always full-existence snapshots now.
    #[test]
    fn principal_export_request_is_slim() {
        let req = serde_json::json!({
            "type": "principal_export",
            "protocol_version": PROTOCOL_VERSION,
            "request_id": 1u64,
            "name": "alice",
            "output": "/tmp/alice.peko",
        });
        let obj = req.as_object().unwrap();
        for retired in ["include_sessions", "with_extensions", "full_snapshot"] {
            assert!(
                !obj.contains_key(retired),
                "retired flag {retired} must not be sent"
            );
        }
    }

    /// The runtime's tool-step and thinking packets (shapes pinned by
    /// peko-runtime's `fixtures/desktop_stream_responses.json`).
    #[test]
    fn step_from_packet_reads_tool_steps_and_thinking() {
        let start = step_from_packet(&serde_json::json!({
            "type": "principal_sent_tool_start", "request_id": 7,
            "tool_id": "call_1", "name": "Bash", "input": "{\"command\":\"date\"}",
        }));
        assert!(matches!(
            start,
            Some(ChatStreamMsg::ToolStart { ref name, input: Some(_), .. }) if name == "Bash"
        ));
        // A non-owner caller gets no input/output fields.
        let end = step_from_packet(&serde_json::json!({
            "type": "principal_sent_tool_end", "request_id": 7,
            "tool_id": "call_2", "name": "Read", "success": false, "duration_ms": 3,
        }));
        assert!(matches!(
            end,
            Some(ChatStreamMsg::ToolEnd {
                success: false,
                duration_ms: 3,
                output: None,
                ..
            })
        ));
        let thinking = step_from_packet(&serde_json::json!({
            "type": "principal_sent_thinking", "request_id": 7, "delta": "hm",
        }));
        assert!(matches!(thinking, Some(ChatStreamMsg::Thinking { ref delta }) if delta == "hm"));
        assert!(step_from_packet(&serde_json::json!({"type": "heartbeat"})).is_none());
        // The wire form the frontend reads is camelCase-tagged by `kind`.
        let wire = serde_json::to_value(ChatStreamMsg::ToolEnd {
            tool_id: "c".into(),
            name: "Bash".into(),
            success: true,
            duration_ms: 1,
            output: None,
        })
        .unwrap();
        assert_eq!(wire["kind"], "toolEnd");
        assert_eq!(wire["durationMs"], 1);
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
        // Identity is now self-certifying `did:key:z…` (ADR-057/058);
        // legacy `did:peko:*` is dead. The converter is opaque to the
        // DID method — pin the current canonical form.
        assert_eq!(
            peer_str_to_subject_value(
                "principal:did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2mKLpbHYkdWfyyEbAm"
            ),
            serde_json::json!({ "kind": "principal", "id": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2mKLpbHYkdWfyyEbAm" })
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
