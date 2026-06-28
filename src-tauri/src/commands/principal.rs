//! Principal commands (ADR-041).
//!
//! Principals are the top-level runtime actors. The desktop talks to
//! the local daemon over IPC; the daemon routes to the principal's
//! supervisor, which can in turn dispatch to specialist agent
//! prompts. Sessions are internal mechanics of the principal's
//! memory layer and are not surfaced in the desktop UI.

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri::State;

use crate::state::AppState;

/// Lightweight summary row for the principal list / sidebar.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrincipalSummary {
    pub name: String,
    pub exposure: String,
    pub status: String,
    pub description: Option<String>,
    pub runtime_id: String,
}

#[tauri::command]
pub async fn principal_list(
    state: State<'_, AppState>,
) -> Result<Vec<PrincipalSummary>, String> {
    // Pull the local default runtime. The runtime_id field on the
    // returned summary is the runtime that owns the principal, so the
    // multi-runtime UI can route messages correctly.
    let runtime = state
        .get_runtime("local")
        .await
        .ok_or_else(|| "Local runtime not found".to_string())?;

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .principal_list()
        .await
        .map_err(|e| format!("principal_list failed: {e}"))?;

    let empty = Vec::new();
    let items = value.get("principals").and_then(|v| v.as_array()).unwrap_or(&empty);
    let mut out: Vec<PrincipalSummary> = Vec::with_capacity(items.len());
    for v in items {
        out.push(PrincipalSummary {
            name: v.get("name").and_then(|s| s.as_str()).unwrap_or("").to_string(),
            exposure: v
                .get("exposure")
                .and_then(|s| s.as_str())
                .unwrap_or("unexposed")
                .to_string(),
            status: v
                .get("status")
                .and_then(|s| s.as_str())
                .unwrap_or("offline")
                .to_string(),
            description: v
                .get("description")
                .and_then(|s| s.as_str())
                .map(|s| s.to_string()),
            runtime_id: runtime.id.clone(),
        });
    }
    Ok(out)
}

/// Send a non-streaming principal message and return the final content.
#[tauri::command]
pub async fn principal_send(
    name: String,
    message: String,
) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    client
        .principal_send(name, message)
        .await
        .map_err(|e| format!("principal_send failed: {e}"))
}

/// Stream a principal message via the `principal_send_stream` IPC
/// path. Each `PrincipalSentChunk` delta is pushed to the supplied
/// Tauri `Channel<String>`; the resolved `Promise<string>` on the
/// JS side returns the final full content on completion. The
/// desktop's `useIpcStream` hook also listens on the `peko-stream`
/// Tauri event channel for chunks so legacy listeners see the live
/// tokens during the migration window.
#[tauri::command]
pub async fn principal_send_stream(
    app: AppHandle,
    name: String,
    message: String,
    on_chunk: Channel<String>,
) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    client
        .principal_send_stream(
            &app,
            name,
            message,
            {
                let channel = on_chunk.clone();
                move |delta| {
                    let _ = channel.send(delta);
                }
            },
            move |content| {
                let _ = tx.send(content);
            },
        )
        .await
        .map_err(|e| format!("principal_send_stream failed: {e}"))?;
    rx.await.map_err(|e| format!("supervisor task died: {e}"))
}


