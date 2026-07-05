//! Principal commands (ADR-041).
//!
//! Principals are the top-level runtime actors. The desktop talks to
//! the local daemon over IPC; the daemon routes to the principal's
//! supervisor, which can in turn dispatch to specialist agent
//! prompts. Sessions are internal mechanics of the principal's
//! memory layer and are not surfaced in the desktop UI.
//!
//! The companion read surface is `peko log` / `RequestPacket::PrincipalLog`,
//! added in peko-runtime PR #124 and surfaced here as `principal_log`.

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::AppHandle;

use crate::state::AppState;

/// Lightweight summary row for the principal list / sidebar.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrincipalSummary {
    pub name: String,
    pub exposure: String,
    pub status: String,
    pub description: Option<String>,
    pub owner: String,
    pub runtime_id: String,
}

#[tauri::command]
pub async fn principal_list(
    state: tauri::State<'_, AppState>,
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
    let items = value
        .get("principals")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    let mut out: Vec<PrincipalSummary> = Vec::with_capacity(items.len());
    for v in items {
        out.push(PrincipalSummary {
            name: v
                .get("name")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string(),
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
            owner: v
                .get("owner")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string(),
            runtime_id: runtime.id.clone(),
        });
    }
    Ok(out)
}

/// Send a non-streaming principal message and return the final content.
#[tauri::command]
pub async fn principal_send(name: String, message: String) -> Result<String, String> {
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

/// Read a peer's conversation thread with a Principal.
///
/// Pass `peer = None` for the principal's owner-root view (the default
/// `peko log <PRINCIPAL>` invocation). Pass `peer = Some("user:alice")`
/// for a specific peer's thread; the runtime enforces the privacy
/// contract (`caller == peer || caller == principal.owner`) plus the
/// principal's `Chat` grant before returning anything.
#[tauri::command]
pub async fn principal_log(
    name: String,
    peer: Option<String>,
    limit: Option<usize>,
    since_secs: Option<u64>,
) -> Result<serde_json::Value, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    client
        .principal_log(&name, peer.as_deref(), limit, since_secs)
        .await
        .map_err(|e| format!("principal_log failed: {e}"))
}

// ── Provider catalog ────────────────────────────────────────────
//
// The provider catalog is a per-principal "soft hint" via
// `principal.toml`, not a top-level entity. It moved here from the
// retired `agent::provider_list` command in peko-runtime PR #125.

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub display_name: String,
    pub api_type: String,
    pub default_model: String,
    pub requires_key: bool,
    pub is_local: bool,
}

#[tauri::command]
pub async fn principal_provider_list() -> Result<Vec<ProviderInfo>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .list_providers()
        .await
        .map_err(|e| format!("list_providers failed: {e}"))?;
    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }
    let providers = value
        .get("providers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| {
                    Some(ProviderInfo {
                        id: p.get("id")?.as_str()?.to_string(),
                        display_name: p.get("display_name")?.as_str()?.to_string(),
                        api_type: p.get("api_type")?.as_str()?.to_string(),
                        default_model: p.get("default_model")?.as_str()?.to_string(),
                        requires_key: p.get("requires_key")?.as_bool().unwrap_or(true),
                        is_local: p.get("is_local")?.as_bool().unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(providers)
}
