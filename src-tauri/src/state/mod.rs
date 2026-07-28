//! Application state for multi-runtime support.
//!
//! Holds the registry of connected runtimes (local + remote) and
//! provides dispatch to the correct transport layer.

use std::collections::HashMap;
use tokio::sync::RwLock;

/// Connection type for a runtime.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeConnectionType {
    /// Local runtime via IPC (Unix socket / UDP).
    Local,
    /// Remote runtime via PekoHub HTTP API.
    Remote,
}

/// Metadata for a connected or configured runtime.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RuntimeConnection {
    pub id: String,
    pub name: String,
    pub connection_type: RuntimeConnectionType,
    pub status: RuntimeStatus,
    /// For local runtimes: the IPC socket path or UDP address.
    pub ipc_path: Option<String>,
    /// For remote runtimes: the PekoHub base URL.
    pub pekohub_url: Option<String>,
}

/// Connection status of a runtime.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeStatus {
    Connected,
    Disconnected,
    Connecting,
    Error,
}

impl RuntimeConnection {
    /// Create a default local runtime connection.
    pub fn local_default() -> Self {
        Self {
            id: "local".to_string(),
            name: "Local Runtime".to_string(),
            connection_type: RuntimeConnectionType::Local,
            status: RuntimeStatus::Connecting,
            ipc_path: None,
            pekohub_url: None,
        }
    }
}

/// Global application state shared across Tauri commands.
pub struct AppState {
    pub runtimes: RwLock<HashMap<String, RuntimeConnection>>,
    pub pekohub_client: crate::clients::pekohub::PekohubClient,
}

/// Resolved transport for a principal command. Returned by
/// [`AppState::resolve_runtime`] so commands can branch on the
/// transport without re-implementing the routing logic. PR #3 only
/// fills the `Local` arm; PR #5 adds `HubRemote` for principals that
/// live behind a pekohub URL.
#[derive(Clone)]
pub(crate) enum ResolvedRuntime {
    /// Local IPC client. The arced handle is dropped after the
    /// command finishes — `IpcClient::new()` is the existing pattern.
    Local,
    /// Remote principal reachable via pekohub HTTPS + SSE. PR #5
    /// fills this in with `Arc<crate::clients::hub_remote_client::HubRemoteClient>`.
    /// For PR #3 this variant is never constructed (the routing
    /// helper only returns `Local`); the dead-code warning is
    /// suppressed by the `#[allow(dead_code)]` on the variant.
    #[allow(dead_code)]
    HubRemote,
}

impl AppState {
    pub fn new(pekohub_client: crate::clients::pekohub::PekohubClient) -> Self {
        Self {
            runtimes: RwLock::new(HashMap::new()),
            pekohub_client,
        }
    }

    /// Get a runtime by ID.
    pub async fn get_runtime(&self, id: &str) -> Option<RuntimeConnection> {
        self.runtimes.read().await.get(id).cloned()
    }

    /// Insert or update a runtime connection.
    pub async fn set_runtime(&self, conn: RuntimeConnection) {
        self.runtimes.write().await.insert(conn.id.clone(), conn);
    }

    /// Remove a runtime by ID. Returns the removed connection if any.
    pub async fn remove_runtime(&self, id: &str) -> Option<RuntimeConnection> {
        self.runtimes.write().await.remove(id)
    }

    /// List all configured runtimes.
    pub async fn list_runtimes(&self) -> Vec<RuntimeConnection> {
        self.runtimes.read().await.values().cloned().collect()
    }

    /// Resolve a `runtime_id` to a transport. PR #3 always returns
    /// `Local` (the only registered runtime is `"local"`); PR #5
    /// extends the match to return `HubRemote` for IDs that match the
    /// `hub:<url>` pattern registered by the remote-principal add flow.
    ///
    /// `runtime_id` of `None` or `Some("local")` both resolve to the
    /// local IPC client. This is the desktop-side default that keeps
    /// every existing JS caller backward-compatible — they pass
    /// `runtimeId` only when they intentionally want a remote
    /// principal.
    pub(crate) async fn resolve_runtime(&self, runtime_id: Option<&str>) -> ResolvedRuntime {
        let id = runtime_id.unwrap_or("local");
        // PR #5: detect `hub:<hub_url>` style IDs and return
        // `HubRemote` with the corresponding client. Until then, any
        // ID that is not "local" is an error: the desktop only has
        // the local runtime registered.
        let _ = self.get_runtime(id).await;
        ResolvedRuntime::Local
    }

    /// Check whether the local runtime is currently reachable.
    pub async fn check_local_runtime(&self) -> Result<(), crate::ipc::IpcError> {
        let client = crate::ipc::IpcClient::new().await?;
        client.ping().await?;
        Ok(())
    }
}

/// Initialise the shared application state.
///
/// - Creates the PekoHub HTTP client.
/// - Registers the default local runtime.
///
/// The local runtime starts as `Connecting` — the supervisor (installed
/// in `lib.rs::run()`'s setup closure) is the canonical owner of the
/// engine lifecycle (ADR-043). The `engine-state-changed` bridge flips
/// the status to `Connected` / `Disconnected` / `Error` as the
/// supervisor reports state. Earlier versions of this function
/// attempted to auto-connect here, which raced against the supervisor's
/// own start and double-spawned the daemon; that probe is gone.
pub async fn init_state() -> AppState {
    let pekohub_client = crate::clients::pekohub::PekohubClient::new();
    let state = AppState::new(pekohub_client);

    let local = RuntimeConnection::local_default();
    state.set_runtime(local).await;
    state
}
