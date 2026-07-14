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
