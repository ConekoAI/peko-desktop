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

/// Look up a single Principal by name. Returns the lightweight
/// summary shape used by `principal_list` so the desktop's
/// `usePrincipal` hook can consume either source interchangeably.
/// The runtime returns `principal: null` for a miss, never an
/// error.
#[tauri::command]
pub async fn principal_get(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<Option<PrincipalSummary>, String> {
    let runtime = state
        .get_runtime("local")
        .await
        .ok_or_else(|| "Local runtime not found".to_string())?;

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .principal_get(&name)
        .await
        .map_err(|e| format!("principal_get failed: {e}"))?;

    Ok(project_principal_get_envelope(&value, &runtime.id))
}

/// Project the runtime's `principal_get` response envelope down to
/// the desktop's lightweight `PrincipalSummary`. Extracted so the
/// projection logic is unit-testable without spinning up the IPC
/// stack.
fn project_principal_get_envelope(
    value: &serde_json::Value,
    runtime_id: &str,
) -> Option<PrincipalSummary> {
    let p = value.get("principal").and_then(|v| v.as_object())?;
    Some(PrincipalSummary {
        name: p
            .get("name")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        exposure: p
            .get("exposure")
            .and_then(|s| s.as_str())
            .unwrap_or("unexposed")
            .to_string(),
        status: p
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("offline")
            .to_string(),
        description: p
            .get("description")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string()),
        owner: p
            .get("owner")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        runtime_id: runtime_id.to_string(),
    })
}

/// Create a new Principal on the local runtime. Mirrors
/// `peko principal new <name>` so the desktop user never has to drop
/// to the CLI to onboard. The daemon validates the name (saving a
/// round-trip is a desktop-side nicety), writes `agents/primary.md`,
/// and registers the new principal in the in-memory manager. The
/// caller is recorded as the owner.
///
/// Errors from the daemon (e.g. name validation, `AlreadyExists`)
/// propagate as `Err(String)` — the React form surfaces them inline.
#[tauri::command]
pub async fn principal_create(
    name: String,
    description: Option<String>,
    preferred_provider_id: Option<String>,
    preferred_model_id: Option<String>,
) -> Result<PrincipalSummary, String> {
    validate_principal_name(&name)?;
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .principal_create(
            &name,
            description.as_deref(),
            preferred_provider_id.as_deref(),
            preferred_model_id.as_deref(),
        )
        .await
        .map_err(|e| format!("principal_create failed: {e}"))?;
    project_principal_create_envelope(&value, &name)
}

/// Mirror of the runtime's `validate_agent_name` rules
/// (`peko-runtime/src/common/identifiers.rs:49`). Pre-IPC nicety so
/// obviously-bad input fails fast; the daemon re-validates so this is
/// only a UX win, not a security boundary.
fn validate_principal_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err(format!("invalid principal name: {name:?}"));
    }
    if name.starts_with('-') || name.ends_with('-') {
        return Err(format!("invalid principal name: {name:?}"));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(format!("invalid principal name: {name:?}"));
    }
    if name
        .chars()
        .any(|c| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
    {
        return Err(format!("invalid principal name: {name:?}"));
    }
    Ok(())
}

/// Project the runtime's `principal_created` envelope down to the
/// desktop's lightweight `PrincipalSummary`. Extracted so the
/// projection logic is unit-testable without spinning up the IPC
/// stack (same shape as `project_principal_get_envelope`).
fn project_principal_create_envelope(
    value: &serde_json::Value,
    fallback_name: &str,
) -> Result<PrincipalSummary, String> {
    let p = value
        .get("principal")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "principal_create response missing `principal`".to_string())?;
    Ok(PrincipalSummary {
        name: p
            .get("name")
            .and_then(|s| s.as_str())
            .unwrap_or(fallback_name)
            .to_string(),
        exposure: p
            .get("exposure")
            .and_then(|s| s.as_str())
            .unwrap_or("unexposed")
            .to_string(),
        status: p
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("offline")
            .to_string(),
        description: p
            .get("description")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string()),
        owner: p
            .get("owner")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        runtime_id: "local".to_string(),
    })
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
    // Mirror the `credential_list` flow: force the runtime to re-read
    // the catalog and the vault from disk first. The desktop's
    // `useProviders` query keys off this, and the catalog's user-added
    // entries live in `providers.toml` — a daemon that started before
    // the user added a custom provider via the CLI would otherwise hand
    // us a stale snapshot. We pair this with the `credential_list`
    // reload so both queries see the same on-disk reality.
    let _ = client.provider_reload().await;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_principal_get_envelope_hit() {
        let envelope = serde_json::json!({
            "type": "principal_get",
            "request_id": 1,
            "principal": {
                "name": "helper",
                "did": "did:peko:local:helper:abc",
                "owner": "user:alice",
                "description": "A test principal",
                "exposure": "Private",
                "status": "online",
                "capabilities": {},
                "agent_prompt_count": 2,
                "workspace_path": "/tmp/helper",
            }
        });
        let projected = project_principal_get_envelope(&envelope, "local");
        let p = projected.expect("hit should project to Some");
        assert_eq!(p.name, "helper");
        assert_eq!(p.exposure, "Private");
        assert_eq!(p.status, "online");
        assert_eq!(p.description.as_deref(), Some("A test principal"));
        assert_eq!(p.owner, "user:alice");
        assert_eq!(p.runtime_id, "local");
    }

    #[test]
    fn test_project_principal_get_envelope_miss_returns_none() {
        let envelope = serde_json::json!({
            "type": "principal_get",
            "request_id": 1,
            "principal": null,
        });
        assert!(project_principal_get_envelope(&envelope, "local").is_none());
    }

    #[test]
    fn test_project_principal_get_envelope_minimal_applies_defaults() {
        // Runtime returns a minimal summary when fields aren't set; the
        // projection must fill in the same defaults as `principal_list`.
        let envelope = serde_json::json!({
            "type": "principal_get",
            "request_id": 1,
            "principal": { "name": "minimal" },
        });
        let p = project_principal_get_envelope(&envelope, "local").unwrap();
        assert_eq!(p.name, "minimal");
        assert_eq!(p.exposure, "unexposed");
        assert_eq!(p.status, "offline");
        assert_eq!(p.description, None);
        assert_eq!(p.owner, "");
        assert_eq!(p.runtime_id, "local");
    }

    #[test]
    fn test_project_principal_create_envelope_hit() {
        let envelope = serde_json::json!({
            "type": "principal_created",
            "request_id": 1,
            "principal": {
                "name": "alice",
                "owner": "user:desktop",
                "description": "personal assistant",
                "exposure": "Private",
                "status": "online",
            }
        });
        let p = project_principal_create_envelope(&envelope, "alice").unwrap();
        assert_eq!(p.name, "alice");
        assert_eq!(p.exposure, "Private");
        assert_eq!(p.status, "online");
        assert_eq!(p.description.as_deref(), Some("personal assistant"));
        assert_eq!(p.owner, "user:desktop");
        assert_eq!(p.runtime_id, "local");
    }

    #[test]
    fn test_project_principal_create_envelope_missing_field_returns_error() {
        // No `principal` object — projection should fail loudly so the
        // caller surfaces the error in the form rather than silently
        // creating a row with empty fields.
        let envelope = serde_json::json!({
            "type": "error",
            "request_id": 1,
            "message": "principal already exists"
        });
        assert!(project_principal_create_envelope(&envelope, "alice").is_err());
    }

    #[test]
    fn test_validate_principal_name_accepts_valid_names() {
        for name in ["alice", "helper-1", "test_principal", "A1B2C3"] {
            assert!(
                validate_principal_name(name).is_ok(),
                "{name:?} should validate"
            );
        }
    }

    #[test]
    fn test_validate_principal_name_rejects_bad_names() {
        for name in [
            "",
            "-leading-hyphen",
            "trailing-hyphen-",
            "has/slash",
            "has\\backslash",
            "has space",
            "has.dot",
            &"a".repeat(65),
        ] {
            assert!(
                validate_principal_name(name).is_err(),
                "{name:?} should reject"
            );
        }
    }
}
