use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::{AppState, RuntimeConnection, RuntimeConnectionType, RuntimeStatus};

/// One runtime in `runtime_list`, in the frontend's camelCase
/// (`connectionType`). Sent snake_case, the local engine read as remote
/// with a blank type.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
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

/// This computer's runtime, registered with PekoHub.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubRegistration {
    pub hub: String,
    pub runtime_did: String,
    /// The PekoHub account the runtime and its local user belong to.
    pub account: String,
}

/// Register the local runtime with the hub at `hub` under the account
/// the signed-in `token` belongs to (pekohub ADR-007). The daemon
/// connects the tunnel at once, so this computer's pekos can go online.
#[tauri::command]
pub async fn runtime_hub_register(hub: String, token: String) -> Result<HubRegistration, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .runtime_register(&hub, &token)
        .await
        .map_err(|e| format!("runtime_register failed: {e}"))?;
    hub_registration_from(&value)
}

fn hub_registration_from(value: &serde_json::Value) -> Result<HubRegistration, String> {
    match value.get("type").and_then(|t| t.as_str()) {
        Some("runtime_registered") => {
            let field = |name: &str| {
                value
                    .get(name)
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .ok_or_else(|| format!("runtime_registered carried no {name}"))
            };
            Ok(HubRegistration {
                hub: field("hub")?,
                runtime_did: field("runtime_did")?,
                account: field("account")?,
            })
        }
        Some("error") => Err(value
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("the runtime refused to register")
            .to_string()),
        _ => Err("This runtime is too old to register from the app. Update Peko, or run `peko runtime register`.".to_string()),
    }
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
            Err(format!(
                "Failed to connect to remote runtime '{}': {}",
                id, e
            ))
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
        RuntimeConnectionType::Remote => state
            .pekohub_client
            .system_status(&conn.id)
            .await
            .map(|_| ()),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_state() -> AppState {
        AppState::new(crate::clients::pekohub::PekohubClient::new())
    }

    // Helper to wrap AppState in a fake Tauri State for testing.
    // Safety: we only use this in tests and never drop the reference early.
    fn fake_state(state: &AppState) -> State<'_, AppState> {
        // tauri::State is a transparent wrapper around &T, so we can transmute.
        unsafe { std::mem::transmute(state) }
    }

    #[tokio::test]
    async fn test_runtime_list_returns_all() {
        let state = test_state();
        state
            .set_runtime(RuntimeConnection {
                id: "local".to_string(),
                name: "Local".to_string(),
                connection_type: RuntimeConnectionType::Local,
                status: RuntimeStatus::Connected,
                ipc_path: None,
                pekohub_url: None,
            })
            .await;
        state
            .set_runtime(RuntimeConnection {
                id: "remote-1".to_string(),
                name: "Remote".to_string(),
                connection_type: RuntimeConnectionType::Remote,
                status: RuntimeStatus::Disconnected,
                ipc_path: None,
                pekohub_url: Some("https://hub.example.com".to_string()),
            })
            .await;

        let list = runtime_list(fake_state(&state)).await.unwrap();
        assert_eq!(list.len(), 2);
        let ids: Vec<String> = list.iter().map(|r| r.id.clone()).collect();
        assert!(ids.contains(&"local".to_string()));
        assert!(ids.contains(&"remote-1".to_string()));
    }

    #[tokio::test]
    async fn test_runtime_remove_blocks_local() {
        let state = test_state();
        let result = runtime_remove(fake_state(&state), "local".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cannot remove"));
    }

    #[tokio::test]
    async fn test_runtime_remove_deletes_remote() {
        let state = test_state();
        state
            .set_runtime(RuntimeConnection {
                id: "remote-1".to_string(),
                name: "Remote".to_string(),
                connection_type: RuntimeConnectionType::Remote,
                status: RuntimeStatus::Connected,
                ipc_path: None,
                pekohub_url: None,
            })
            .await;

        let result = runtime_remove(fake_state(&state), "remote-1".to_string()).await;
        assert!(result.is_ok());
        assert!(state.get_runtime("remote-1").await.is_none());
    }

    #[tokio::test]
    async fn test_runtime_rename_updates_name() {
        let state = test_state();
        state
            .set_runtime(RuntimeConnection {
                id: "local".to_string(),
                name: "Old Name".to_string(),
                connection_type: RuntimeConnectionType::Local,
                status: RuntimeStatus::Connected,
                ipc_path: None,
                pekohub_url: None,
            })
            .await;

        let summary = runtime_rename(
            fake_state(&state),
            "local".to_string(),
            "New Name".to_string(),
        )
        .await
        .unwrap();
        assert_eq!(summary.name, "New Name");
        let fetched = state.get_runtime("local").await.unwrap();
        assert_eq!(fetched.name, "New Name");
    }

    #[tokio::test]
    async fn test_runtime_rename_not_found() {
        let state = test_state();
        let result =
            runtime_rename(fake_state(&state), "missing".to_string(), "X".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_runtime_summary_from_local_connected() {
        let conn = RuntimeConnection {
            id: "local".to_string(),
            name: "Local".to_string(),
            connection_type: RuntimeConnectionType::Local,
            status: RuntimeStatus::Connected,
            ipc_path: None,
            pekohub_url: None,
        };
        let summary: RuntimeSummary = conn.into();
        assert_eq!(summary.id, "local");
        assert_eq!(summary.connection_type, "local");
        let wire = serde_json::to_value(&summary).unwrap();
        assert_eq!(
            wire["connectionType"], "local",
            "the frontend reads camelCase"
        );
        assert_eq!(summary.status, "connected");
    }

    #[test]
    fn test_runtime_summary_from_remote_error() {
        let conn = RuntimeConnection {
            id: "r1".to_string(),
            name: "Remote".to_string(),
            connection_type: RuntimeConnectionType::Remote,
            status: RuntimeStatus::Error,
            ipc_path: None,
            pekohub_url: None,
        };
        let summary: RuntimeSummary = conn.into();
        assert_eq!(summary.connection_type, "remote");
        assert_eq!(summary.status, "error");
    }
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

#[cfg(test)]
mod hub_registration_tests {
    use super::*;

    #[test]
    fn registration_answers_map_to_results() {
        let ok = serde_json::json!({
            "type": "runtime_registered",
            "hub": "https://api.pekohub.ai",
            "runtime_did": "did:key:z6Mk",
            "account": "acct",
        });
        let reg = hub_registration_from(&ok).unwrap();
        assert_eq!(reg.hub, "https://api.pekohub.ai");
        assert_eq!(reg.account, "acct");

        let refused = serde_json::json!({"type": "error", "message": "PekoHub rejected the API key: HTTP 401"});
        assert_eq!(
            hub_registration_from(&refused).unwrap_err(),
            "PekoHub rejected the API key: HTTP 401"
        );

        // A daemon that predates `runtime_register` answers something else.
        let old = serde_json::json!({"type": "done", "success": false});
        assert!(hub_registration_from(&old).unwrap_err().contains("too old"));
    }
}
