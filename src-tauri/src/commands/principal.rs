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
use tauri::Manager;

use crate::state::AppState;

/// Lightweight summary row for the principal list / sidebar.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrincipalSummary {
    pub name: String,
    pub exposure: String,
    pub status: String,
    pub description: Option<String>,
    pub preferred_model_id: Option<String>,
    pub owner: String,
    pub runtime_id: String,
}

#[tauri::command]
pub async fn principal_list(
    state: tauri::State<'_, AppState>,
    runtime_id: Option<String>,
) -> Result<Vec<PrincipalSummary>, String> {
    // PR #3: route on the supplied runtime_id. `None` / `Some("local")`
    // both resolve to the local IPC client; PR #5 will route
    // `hub:<url>` style IDs to the HubRemoteClient. The runtime's
    // id is stamped on the returned summary so the React sidebar
    // can group entries by owning runtime.
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    let runtime_id = runtime_id.unwrap_or_else(|| "local".to_string());
    let _ = resolved; // PR #5 will branch on `resolved`.

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
            preferred_model_id: v
                .get("preferred_model_id")
                .and_then(|s| s.as_str())
                .map(|s| s.to_string()),
            owner: v
                .get("owner")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string(),
            runtime_id: runtime_id.clone(),
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
    runtime_id: Option<String>,
) -> Result<Option<PrincipalSummary>, String> {
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    let _ = resolved; // PR #5 will branch on `resolved`.
    let runtime_id = runtime_id.unwrap_or_else(|| "local".to_string());

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .principal_get(&name)
        .await
        .map_err(|e| format!("principal_get failed: {e}"))?;

    Ok(project_principal_get_envelope(&value, &runtime_id))
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
        preferred_model_id: p
            .get("preferred_model_id")
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
    model_id: String,
    runtime_id: Option<String>,
) -> Result<PrincipalSummary, String> {
    validate_principal_name(&name)?;
    if model_id.is_empty() {
        return Err("model id must not be empty".to_string());
    }
    // PR #3: creation is local-only. Reject any remote runtime_id
    // explicitly so the JS form surfaces a clear error rather than
    // silently sending a create packet to a remote hub.
    let runtime_id = runtime_id.unwrap_or_else(|| "local".to_string());
    if runtime_id != "local" {
        return Err(format!(
            "principal_create is only available on the local runtime (got runtime_id={runtime_id:?})"
        ));
    }
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .principal_create(&name, description.as_deref(), &model_id)
        .await
        .map_err(|e| format!("principal_create failed: {e}"))?;
    project_principal_create_envelope(&value, &name)
}

/// Mirror of the runtime's `validate_agent_name` rules
/// (`peko-runtime/peko-rs/core/src/common/identifiers.rs:49`). Pre-IPC
/// nicety so obviously-bad input fails fast; the daemon re-validates
/// so this is only a UX win, not a security boundary.
fn validate_principal_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err(format!("invalid principal name: {name:?}"));
    }
    // Mirror the runtime's explicit `..` rule (PR #241). The
    // per-char alphanumeric check below incidentally rejects "."
    // and "..", but the explicit check makes the intent obvious and
    // survives a future regex loosening.
    if name == ".." || name == "." || name.contains("..") {
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
///
/// The runtime can also send `{"type": "error", "message": "..."}`
/// when the create fails (e.g. the model's preferred model id is
/// unknown after PR #204 removed default providers, or the disk is
/// read-only). Without the early check below those errors surfaced as
/// the misleading "principal_create response missing `principal`" —
/// a user could not tell whether the request never reached the
/// runtime, the runtime returned a malformed envelope, or the
/// runtime rejected the request. Surface the runtime's message so
/// the React form can show the real reason.
fn project_principal_create_envelope(
    value: &serde_json::Value,
    fallback_name: &str,
) -> Result<PrincipalSummary, String> {
    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        let message = value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown runtime error");
        return Err(format!("principal_create failed: {message}"));
    }
    let p = value
        .get("principal")
        .and_then(|v| v.as_object())
        .ok_or_else(|| {
            format!(
                "principal_create response missing `principal` (got envelope: {})",
                value
            )
        })?;
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
        preferred_model_id: p
            .get("preferred_model_id")
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

/// Update an existing Principal's mutable config (description, status,
/// exposure, and pinned model). Mirror of the runtime's
/// `RequestPacket::PrincipalUpdate`. The daemon checks
/// `Permission::ManageSettings`; for the local desktop caller this is
/// always satisfied for principals it owns.
#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrincipalUpdateRequest {
    pub name: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub exposure: Option<String>,
    pub preferred_model_id: Option<String>,
    /// PR #3: defaults to `"local"`. Forwarded through the
    /// `RuntimeConnection` registry; only "local" is accepted in
    /// PR #3, PR #5 will add remote support.
    pub runtime_id: Option<String>,
}

#[tauri::command]
pub async fn principal_update(req: PrincipalUpdateRequest) -> Result<PrincipalSummary, String> {
    // PR #3: update is local-only. The Shape mirrors `principal_create`:
    // a remote runtime_id is rejected up front so the desktop exposes
    // a clear failure rather than silently forwarding to a remote hub.
    let runtime_id = req.runtime_id.clone().unwrap_or_else(|| "local".to_string());
    if runtime_id != "local" {
        return Err(format!(
            "principal_update is only available on the local runtime (got runtime_id={runtime_id:?})"
        ));
    }
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .principal_update(
            &req.name,
            req.description.as_deref(),
            req.status.as_deref(),
            req.exposure.as_deref(),
            req.preferred_model_id.as_deref(),
        )
        .await
        .map_err(|e| format!("principal_update failed: {e}"))?;
    project_principal_update_envelope(&value, &runtime_id)
}

/// Remove a Principal and its on-disk workspace. Mirror of the runtime's
/// `RequestPacket::PrincipalRemove`. Returns `true` if the principal was
/// actually deleted, `false` if it was already gone.
#[tauri::command]
pub async fn principal_remove(
    name: String,
    runtime_id: Option<String>,
) -> Result<bool, String> {
    // PR #3: remove is local-only (mirrors create / update).
    let runtime_id = runtime_id.unwrap_or_else(|| "local".to_string());
    if runtime_id != "local" {
        return Err(format!(
            "principal_remove is only available on the local runtime (got runtime_id={runtime_id:?})"
        ));
    }
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .principal_remove(&name)
        .await
        .map_err(|e| format!("principal_remove failed: {e}"))?;
    project_principal_remove_envelope(&value)
}

/// Project the runtime's `principal_updated` envelope down to the
/// desktop's `PrincipalSummary`. Reuses the same field defaults as
/// `principal_list` so the sidebar and detail views stay consistent.
fn project_principal_update_envelope(
    value: &serde_json::Value,
    runtime_id: &str,
) -> Result<PrincipalSummary, String> {
    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        let message = value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown runtime error");
        return Err(format!("principal_update failed: {message}"));
    }
    let p = value
        .get("principal")
        .and_then(|v| v.as_object())
        .ok_or_else(|| {
            format!(
                "principal_update response missing `principal` (got envelope: {})",
                value
            )
        })?;
    Ok(PrincipalSummary {
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
        preferred_model_id: p
            .get("preferred_model_id")
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

/// Project the runtime's `principal_removed` envelope down to a boolean.
fn project_principal_remove_envelope(value: &serde_json::Value) -> Result<bool, String> {
    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        let message = value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown runtime error");
        return Err(format!("principal_remove failed: {message}"));
    }
    value
        .get("removed")
        .and_then(|v| v.as_bool())
        .ok_or_else(|| {
            format!(
                "principal_remove response missing `removed` (got envelope: {})",
                value
            )
        })
}

/// Send a non-streaming principal message and return the final content.
#[tauri::command]
pub async fn principal_send(
    state: tauri::State<'_, AppState>,
    name: String,
    message: String,
    runtime_id: Option<String>,
) -> Result<String, String> {
    // PR #5: route by runtime_id. Remote principals use
    // `HubRemoteClient::send_stream` and discard the per-chunk
    // events — the chat UI consumes the streaming path; this is
    // the legacy non-streaming entrypoint kept for headless callers.
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    match resolved {
        crate::state::ResolvedRuntime::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| format!("IpcClient::new failed: {e}"))?;
            client
                .principal_send(name, message)
                .await
                .map_err(|e| format!("principal_send failed: {e}"))
        }
        crate::state::ResolvedRuntime::HubRemote(client) => {
            let user_entry = crate::storage::local_chat_log::user_entry(message.clone());
            let _ = crate::storage::local_chat_log::append_entry(
                &client.runtime_id,
                &name,
                &user_entry,
            );
            client
                .send_stream(&message, |_msg| {})
                .await
                .map_err(|e| format!("hub remote send failed: {e}"))
        }
    }
}

/// Result envelope returned by the `principal_send_stream` Tauri
/// command. `request_id` is the runtime's correlation id for the
/// in-flight run (also minted by `IpcClient::next_request_id` on the
/// desktop side); the frontend holds onto it so a subsequent
/// `principal_send_control(steer)` call can target the same run. The
/// runtime's `streaming_runs` registry is keyed by this id, so a
/// mismatch silently drops the control packet as `UnknownRun`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PrincipalSendStreamResult {
    pub request_id: u64,
    pub content: String,
}

/// Stream a principal message via the `principal_send_stream` IPC
/// path. Each `PrincipalSentChunk` delta and `PrincipalSentIteration`
/// boundary marker is pushed to the supplied Tauri
/// `Channel<ChatStreamMsg>`; the resolved `Promise<PrincipalSendStreamResult>`
/// on the JS side returns the final full content plus the runtime
/// correlation id once the run settles. The desktop's `useIpcStream`
/// hook also listens on the `peko-stream` Tauri event channel for
/// chunks so legacy listeners see the live tokens during the
/// migration window.
///
/// The `request_id` is supplied by the JS caller (see
/// `nextRequestId` in `src/hooks/usePrincipals.ts`). The JS side
/// stashes it in a ref BEFORE awaiting the IPC call, so a subsequent
/// `principal_send_control(steer)` can target the in-flight run by
/// id — the runtime's `streaming_runs` registry is keyed by it. If
/// we minted the id here on the Rust side, the JS caller would not
/// learn it until the run settled (the result envelope is only
/// populated on `principal_sent_done`), which is too late to steer.
#[tauri::command]
pub async fn principal_send_stream(
    app: AppHandle,
    name: String,
    message: String,
    request_id: u64,
    on_event: Channel<crate::ipc::ChatStreamMsg>,
    runtime_id: Option<String>,
) -> Result<PrincipalSendStreamResult, String> {
    // PR #5: route by runtime_id. Local → IpcClient; HubRemote →
    // HubRemoteClient::send_stream. The local arm keeps the legacy
    // (tx, rx) channel dance that the daemon supervisor drives; the
    // remote arm pushes events directly into the supplied Tauri
    // Channel.
    let resolved = {
        let state = app.state::<AppState>();
        state.resolve_runtime(runtime_id.as_deref()).await
    };

    let content = match resolved {
        crate::state::ResolvedRuntime::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| format!("IpcClient::new failed: {e}"))?;
            let (tx, rx) = tokio::sync::oneshot::channel::<String>();
            client
                .principal_send_stream(
                    &app,
                    request_id,
                    name,
                    message,
                    {
                        let channel = on_event.clone();
                        move |msg| {
                            let _ = channel.send(msg);
                        }
                    },
                    move |content| {
                        let _ = tx.send(content);
                    },
                )
                .await
                .map_err(|e| format!("principal_send_stream failed: {e}"))?;
            rx.await
                .map_err(|e| format!("supervisor task died: {e}"))?
        }
        crate::state::ResolvedRuntime::HubRemote(client) => {
            // Persist the user message optimistically so the local
            // chat log mirrors what the UI already shows.
            let user_entry = crate::storage::local_chat_log::user_entry(message.clone());
            let _ = crate::storage::local_chat_log::append_entry(
                &client.runtime_id,
                &name,
                &user_entry,
            );
            client
                .send_stream(&message, move |msg| {
                    let _ = on_event.send(msg);
                })
                .await
                .map_err(|e| format!("hub remote stream failed: {e}"))?
        }
    };

    Ok(PrincipalSendStreamResult {
        request_id,
        content,
    })
}

/// Send a control packet targeting an in-flight `principal_send_stream`
/// run. Used by the desktop's chat input when a stream is already
/// running and the user wants to either interrupt it (`Interrupt`) or
/// push new context that the next agentic iteration will drain
/// (`Steer { text }`). `target_request_id` is the id returned by the
/// originating `principal_send_stream` call. Returns the runtime's
/// `principal_send_control_done` envelope verbatim so the JS caller
/// can surface `status: "applied" | "unknown_run"` to the user.
#[tauri::command]
pub async fn principal_send_control(
    state: tauri::State<'_, AppState>,
    target_request_id: u64,
    mode: serde_json::Value,
    runtime_id: Option<String>,
) -> Result<serde_json::Value, String> {
    // PR #5: only the local runtime supports steering — the hub's
    // SSE bridge is fire-and-forget, so we surface a clear error
    // rather than silently dropping the control packet.
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    if matches!(resolved, crate::state::ResolvedRuntime::HubRemote(_)) {
        return Err(
            "principal_send_control: steering is not supported for remote principals"
                .to_string(),
        );
    }
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let ipc_mode = match mode
        .get("mode")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "principal_send_control: missing `mode` discriminator".to_string())?
    {
        "interrupt" => crate::ipc::PrincipalSendControlMode::Interrupt,
        "steer" => {
            let text = mode
                .get("text")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "principal_send_control: `steer` mode requires `text`".to_string())?
                .to_string();
            crate::ipc::PrincipalSendControlMode::Steer { text }
        }
        other => {
            return Err(format!(
                "principal_send_control: unknown mode `{other}` (expected `interrupt` or `steer`)"
            ));
        }
    };
    client
        .principal_send_control(target_request_id, ipc_mode)
        .await
        .map_err(|e| format!("principal_send_control failed: {e}"))
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
    state: tauri::State<'_, AppState>,
    name: String,
    peer: Option<String>,
    limit: Option<usize>,
    since_secs: Option<u64>,
    cursor: Option<String>,
    runtime_id: Option<String>,
) -> Result<serde_json::Value, String> {
    // PR #5: route by runtime_id. The remote branch reads the
    // desktop's local JSONL appender (HubRemoteClient writes to it
    // during send_stream); pekohub has no read API yet so we don't
    // attempt to forward.
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    match resolved {
        crate::state::ResolvedRuntime::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| format!("IpcClient::new failed: {e}"))?;
            client
                .principal_log(&name, peer.as_deref(), limit, since_secs, cursor.as_deref())
                .await
                .map_err(|e| format!("principal_log failed: {e}"))
        }
        crate::state::ResolvedRuntime::HubRemote(client) => {
            client.list_chat_log(limit, since_secs, cursor).await
        }
    }
}

// ── PR #3: new status / exposure / permission commands ──────────────────────
//
// These wrap the corresponding runtime IPC packets added in the same
// PR-series. None of them accept a `runtime_id` — they only operate
// on the local runtime because ACL grants and exposure flips are
// owner-only RPCs that the hub does not yet proxy. The local-only
// rejection lives in the dedicated `reject_if_remote` helper below.

// ── PR #3: new status / exposure / permission commands ──────────────────────
//
// These wrap the corresponding runtime IPC packets added in the same
// PR-series. None of them accept a `runtime_id` — they only operate
// on the local runtime because ACL grants and exposure flips are
// owner-only RPCs that the hub does not yet proxy. The local-only
// rejection lives in the upfront check.

fn reject_if_remote(runtime_id: Option<String>) -> Result<String, String> {
    let id = runtime_id.unwrap_or_else(|| "local".to_string());
    if id != "local" {
        return Err(format!(
            "this command is local-only (got runtime_id={id:?})"
        ));
    }
    Ok(id)
}

/// Set the local principal's runtime status (`online` / `offline` /
/// `busy` / `error`). Mirror of `RequestPacket::PrincipalSetStatus`.
#[tauri::command]
pub async fn principal_set_status(
    name: String,
    status: String,
    runtime_id: Option<String>,
) -> Result<serde_json::Value, String> {
    reject_if_remote(runtime_id)?;
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    client
        .principal_set_status(&name, &status)
        .await
        .map_err(|e| format!("principal_set_status failed: {e}"))
}

/// Set the local principal's exposure (`unexposed` / `private` /
/// `public` / `unlisted`). Mirror of `RequestPacket::PrincipalSetExposure`.
#[tauri::command]
pub async fn principal_set_exposure(
    name: String,
    exposure: String,
    runtime_id: Option<String>,
) -> Result<serde_json::Value, String> {
    reject_if_remote(runtime_id)?;
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    client
        .principal_set_exposure(&name, &exposure)
        .await
        .map_err(|e| format!("principal_set_exposure failed: {e}"))
}

/// Grant a permission on a local principal. Mirror of
/// `RequestPacket::PrincipalGrantPermission`. The `permission` shape
/// is the runtime's `PermissionGrant` JSON (`{principal, capabilities, expires_at?}`).
#[tauri::command]
pub async fn principal_grant_permission(
    name: String,
    permission: serde_json::Value,
    runtime_id: Option<String>,
) -> Result<serde_json::Value, String> {
    reject_if_remote(runtime_id)?;
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    client
        .principal_grant_permission(&name, &permission)
        .await
        .map_err(|e| format!("principal_grant_permission failed: {e}"))
}

/// Revoke a previously-granted permission on a local principal.
/// Mirror of `RequestPacket::PrincipalRevokePermission` — `grant_id`
/// is the stable id returned in the prior `principal_grant_permission`
/// response.
#[tauri::command]
pub async fn principal_revoke_permission(
    name: String,
    grant_id: String,
    runtime_id: Option<String>,
) -> Result<serde_json::Value, String> {
    reject_if_remote(runtime_id)?;
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    client
        .principal_revoke_permission(&name, &grant_id)
        .await
        .map_err(|e| format!("principal_revoke_permission failed: {e}"))
}

/// List the permissions currently granted on a local principal.
/// Mirror of `RequestPacket::PrincipalPermissions`. Returns the
/// `permissions: Vec<PermissionGrant>` envelope verbatim so the
/// `PrincipalProfileModal` can render the access list inline.
#[tauri::command]
pub async fn principal_permissions(
    name: String,
    runtime_id: Option<String>,
) -> Result<serde_json::Value, String> {
    reject_if_remote(runtime_id)?;
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    client
        .principal_permissions(&name)
        .await
        .map_err(|e| format!("principal_permissions failed: {e}"))
}

/// PR #11: mint a signed invite token for a local principal.
/// Mirror of `RequestPacket::PrincipalMintInvite`. Returns the
/// `PrincipalInviteMinted` envelope as JSON (the runtime shapes it
/// as `{ name, token, url, claims }`). The `scope` is forwarded
/// as a JSON array of permission name strings; the daemon
/// deserializes them into `peko_auth::Permission` (snake_case
/// matches the lowercase names we use here).
#[tauri::command]
pub async fn principal_mint_invite(
    name: String,
    scope: Vec<String>,
    ttl_secs: u64,
    runtime_id: Option<String>,
) -> Result<serde_json::Value, String> {
    reject_if_remote(runtime_id)?;
    // Reject obviously-bad scope names client-side so a typo
    // produces a clean error instead of a daemon roundtrip +
    // deserialization failure. The list mirrors
    // `peko_auth::Permission` exactly (snake_case); if a new
    // permission is added on the runtime side, this list must be
    // updated.
    const ALLOWED: &[&str] = &[
        "chat",
        "view_settings",
        "manage_settings",
        "manage_extensions",
        "manage_members",
        "expose",
        "delete",
    ];
    for s in &scope {
        if !ALLOWED.contains(&s.as_str()) {
            return Err(format!("Unknown permission: {s}"));
        }
    }

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    client
        .principal_mint_invite(&name, scope, ttl_secs)
        .await
        .map_err(|e| format!("principal_mint_invite failed: {e}"))
}

/// PR #11: revoke a previously-minted invite token. Adds the `jti`
/// to the runtime's in-memory `InviteRevocationSet`. The next
/// inbound request presenting that token is rejected by the
/// runtime's `TunnelDispatcher::check_request_allowed`.
#[tauri::command]
pub async fn principal_revoke_invite(
    name: String,
    jti: String,
    runtime_id: Option<String>,
) -> Result<serde_json::Value, String> {
    reject_if_remote(runtime_id)?;
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    client
        .principal_revoke_invite(&name, &jti)
        .await
        .map_err(|e| format!("principal_revoke_invite failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // PR #3: the local-only gate rejects any non-`"local"` runtime_id
    // before the IPC client is instantiated. Pin the contract so a
    // future refactor that loosens the check catches in CI.
    #[test]
    fn test_reject_if_remote_accepts_local() {
        assert_eq!(reject_if_remote(None).unwrap(), "local");
        assert_eq!(reject_if_remote(Some("local".to_string())).unwrap(), "local");
    }

    #[test]
    fn test_reject_if_remote_rejects_remote_runtime_id() {
        let err = reject_if_remote(Some("hub:pekohub.org".to_string()))
            .expect_err("remote runtime_id must be rejected");
        assert!(
            err.contains("local-only"),
            "error should clearly say local-only, got: {err}"
        );
        assert!(
            err.contains("hub:pekohub.org"),
            "error should echo the supplied runtime_id, got: {err}"
        );
    }

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
            "type": "principal_created",
            "request_id": 1,
        });
        assert!(project_principal_create_envelope(&envelope, "alice").is_err());
    }

    /// Runtime returns a `ResponsePacket::Error` envelope when the
    /// create fails (e.g. unknown model id after PR #204, disk full,
    /// permission denied). Surface its `message` so the React form
    /// shows the real reason instead of the misleading "missing
    /// `principal`" sentinel.
    #[test]
    fn test_project_principal_create_envelope_runtime_error_surfaces_message() {
        let envelope = serde_json::json!({
            "type": "error",
            "request_id": 1,
            "message": "principal_create failed: model id 'gpt-x' is not configured"
        });
        let err = project_principal_create_envelope(&envelope, "alice")
            .expect_err("error envelope should fail projection");
        assert!(
            err.contains("model id 'gpt-x' is not configured"),
            "runtime error message must be surfaced verbatim, got: {err}"
        );
        // And it's clearly framed as a runtime failure, not a
        // wire-shape complaint.
        assert!(
            err.starts_with("principal_create failed"),
            "error must be prefixed to distinguish from protocol errors, got: {err}"
        );
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
            ".",        // single dot
            "..",       // double dot (path-traversal defense)
            "foo..bar", // embedded ".." segment
            "..foo",
            "foo..",
            &"a".repeat(65),
        ] {
            assert!(
                validate_principal_name(name).is_err(),
                "{name:?} should reject"
            );
        }
    }
}
