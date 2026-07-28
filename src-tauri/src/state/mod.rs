//! Application state for multi-runtime support.
//!
//! Holds the registry of connected runtimes (local + remote) and
//! provides dispatch to the correct transport layer.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::clients::hub_remote_client::HubRemoteClient;

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
    /// PR #5: shared HTTP client used to build new HubRemoteClient
    /// instances. Re-using a single client keeps the connection pool
    /// warm and matches the rest of the desktop's HTTP surface.
    pub http: reqwest::Client,
    /// PR #5: HubRemoteClient instances keyed by `hub:<hub_url>` so
    /// `resolve_runtime` can hand a clone to any IPC command without
    /// rebuilding the client per request.
    pub hub_remotes: RwLock<HashMap<String, Arc<HubRemoteClient>>>,
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
    /// Remote principal reachable via pekohub HTTPS + SSE. Carries an
    /// `Arc<HubRemoteClient>` so commands can call `send_stream`
    /// without re-resolving through the runtime-id registry.
    HubRemote(Arc<HubRemoteClient>),
}

impl AppState {
    pub fn new(pekohub_client: crate::clients::pekohub::PekohubClient) -> Self {
        Self {
            runtimes: RwLock::new(HashMap::new()),
            pekohub_client,
            http: reqwest::Client::new(),
            hub_remotes: RwLock::new(HashMap::new()),
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

    /// PR #5: register a `HubRemoteClient` for a `hub:<hub_url>` id.
    /// Subsequent calls to `resolve_runtime` with that id return
    /// `ResolvedRuntime::HubRemote(client.clone())`.
    pub async fn register_hub_remote(&self, client: HubRemoteClient) -> Arc<HubRemoteClient> {
        let arc = Arc::new(client);
        let id = arc.runtime_id.clone();
        self.hub_remotes.write().await.insert(id, arc.clone());
        arc
    }

    /// PR #5: drop a registered `HubRemoteClient`. Called when the
    /// user removes the principal from the sidebar (PR #4).
    pub async fn unregister_hub_remote(&self, runtime_id: &str) -> Option<Arc<HubRemoteClient>> {
        self.hub_remotes.write().await.remove(runtime_id)
    }

    /// Resolve a `runtime_id` to a transport. `None` / `Some("local")`
    /// both resolve to the local IPC client. Any `hub:<hub_url>` id
    /// resolves to the registered `HubRemoteClient` if one is present;
    /// otherwise we fall back to `Local` and let the IPC command
    /// surface the missing-principal error to the user.
    pub(crate) async fn resolve_runtime(&self, runtime_id: Option<&str>) -> ResolvedRuntime {
        let id = runtime_id.unwrap_or("local");
        if id == "local" {
            return ResolvedRuntime::Local;
        }
        // PR #5: hub:<url> ids return the registered HubRemoteClient.
        // Unknown ids fall through to Local so the IPC layer returns
        // its existing "daemon unreachable" error path rather than
        // a Tauri-level 500 — this matches the PR #3 contract that
        // every `runtime_id` is addressable.
        if let Some(client) = self.hub_remotes.read().await.get(id).cloned() {
            return ResolvedRuntime::HubRemote(client);
        }
        // Touch the runtime-id registry so we still surface a fresh
        // `RuntimeConnection` for callers that introspect it later.
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
