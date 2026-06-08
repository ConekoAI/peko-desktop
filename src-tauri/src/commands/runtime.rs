use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::{AppState, RuntimeConnection, RuntimeConnectionType, RuntimeStatus};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RuntimeSummary {
    pub id: String,
    pub name: String,
    pub connection_type: String,
    pub status: String,
}

impl From<RuntimeConnection> for RuntimeSummary {
    fn from(conn: RuntimeConnection) -> Self {
        Self {
            id: conn.id,
            name: conn.name,
            connection_type: match conn.connection_type {
                RuntimeConnectionType::Local => "local".to_string(),
                RuntimeConnectionType::Remote => "remote".to_string(),
            },
            status: match conn.status {
                RuntimeStatus::Connected => "connected".to_string(),
                RuntimeStatus::Disconnected => "disconnected".to_string(),
                RuntimeStatus::Connecting => "connecting".to_string(),
                RuntimeStatus::Error => "error".to_string(),
            },
        }
    }
}

/// List all configured runtimes.
#[tauri::command]
pub async fn runtime_list(state: State<'_, AppState>) -> Result<Vec<RuntimeSummary>, String> {
    let runtimes = state.list_runtimes().await;
    Ok(runtimes.into_iter().map(Into::into).collect())
}

/// Add a new remote runtime connection.
#[tauri::command]
pub async fn runtime_add(
    state: State<'_, AppState>,
    id: String,
    name: String,
    pekohub_url: Option<String>,
) -> Result<RuntimeSummary, String> {
    let conn = RuntimeConnection {
        id: id.clone(),
        name,
        connection_type: RuntimeConnectionType::Remote,
        status: RuntimeStatus::Connecting,
        ipc_path: None,
        pekohub_url,
    };
    state.set_runtime(conn.clone()).await;

    // Attempt a quick health check via pekohub
    match state.pekohub_client.system_status(&id).await {
        Ok(_) => {
            let mut updated = conn;
            updated.status = RuntimeStatus::Connected;
            state.set_runtime(updated.clone()).await;
            Ok(updated.into())
        }
        Err(e) => {
            let mut updated = conn;
            updated.status = RuntimeStatus::Error;
            state.set_runtime(updated.clone()).await;
            Err(format!("Failed to connect to remote runtime '{}': {}", id, e))
        }
    }
}

/// Remove a runtime connection.
#[tauri::command]
pub async fn runtime_remove(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if id == "local" {
        return Err("Cannot remove the local runtime".to_string());
    }
    state.remove_runtime(&id).await;
    Ok(())
}

/// Reconnect / refresh status for a runtime.
#[tauri::command]
pub async fn runtime_reconnect(
    state: State<'_, AppState>,
    id: String,
) -> Result<RuntimeSummary, String> {
    let mut conn = state
        .get_runtime(&id)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", id))?;

    conn.status = RuntimeStatus::Connecting;
    state.set_runtime(conn.clone()).await;

    let result: Result<(), String> = match conn.connection_type {
        RuntimeConnectionType::Local => {
            state.check_local_runtime().await.map_err(|e| e.to_string())
        }
        RuntimeConnectionType::Remote => {
            state
                .pekohub_client
                .system_status(&conn.id)
                .await
                .map(|_| ())
        }
    };

    match result {
        Ok(()) => {
            conn.status = RuntimeStatus::Connected;
        }
        Err(_) => {
            conn.status = RuntimeStatus::Disconnected;
        }
    }

    state.set_runtime(conn.clone()).await;
    Ok(conn.into())
}

/// Update the display name of a runtime.
#[tauri::command]
pub async fn runtime_rename(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<RuntimeSummary, String> {
    let mut conn = state
        .get_runtime(&id)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", id))?;
    conn.name = name;
    state.set_runtime(conn.clone()).await;
    Ok(conn.into())
}
