use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

use crate::state::AppState;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub agent: String,
    pub title: Option<String>,
    pub message_count: usize,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub runtime_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub id: String,
    pub agent: String,
    pub title: Option<String>,
    pub message_count: usize,
    pub status: String,
    pub messages: Vec<SessionMessage>,
    pub branches: Vec<String>,
    pub parent_id: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
    pub runtime_id: String,
}

fn format_timestamp(ts: u64) -> String {
    if ts == 0 {
        return "unknown".to_string();
    }
    ts.to_string()
}

fn parse_session_summary(
    value: &serde_json::Value,
    active_session_id: Option<&str>,
    runtime_id: &str,
) -> Option<SessionSummary> {
    let created_at = value
        .get("created_at")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let updated_at = value
        .get("updated_at")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let session_id = value
        .get("session_id")
        .or_else(|| value.get("id"))?
        .as_str()?
        .to_string();
    let status = active_session_id
        .map(|active| if active == session_id { "active" } else { "inactive" })
        .unwrap_or("unknown")
        .to_string();

    Some(SessionSummary {
        id: session_id,
        agent: value.get("agent_name")?.as_str()?.to_string(),
        title: value
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        message_count: value
            .get("message_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize,
        status,
        created_at: format_timestamp(created_at),
        updated_at: format_timestamp(updated_at),
        runtime_id: runtime_id.to_string(),
    })
}

fn parse_session_detail(value: &serde_json::Value, runtime_id: &str) -> Option<SessionDetail> {
    let info = value.get("info").cloned().unwrap_or(value.clone());
    let created_at = info.get("created_at").and_then(|v| v.as_u64()).unwrap_or(0);
    let updated_at = info.get("updated_at").and_then(|v| v.as_u64()).unwrap_or(0);
    let status = info
        .get("is_active")
        .and_then(|v| v.as_bool())
        .map(|b| if b { "active" } else { "inactive" })
        .unwrap_or("unknown")
        .to_string();

    Some(SessionDetail {
        id: info
            .get("session_id")
            .or_else(|| info.get("id"))?
            .as_str()?
            .to_string(),
        agent: info.get("agent_name")?.as_str()?.to_string(),
        title: info
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        message_count: info
            .get("message_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize,
        status,
        messages: vec![],
        branches: vec![],
        parent_id: info
            .get("parent_session_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        metadata: serde_json::json!({}),
        created_at: format_timestamp(created_at),
        updated_at: format_timestamp(updated_at),
        runtime_id: runtime_id.to_string(),
    })
}

// ------------------------------------------------------------------
// Unified dispatch
// ------------------------------------------------------------------

async fn dispatch_session_list(
    state: &AppState,
    runtime_id: &str,
    agent: &str,
) -> Result<Vec<SessionSummary>, String> {
    let runtime = state
        .get_runtime(runtime_id)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", runtime_id))?;

    let value = match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
            client.list_sessions(agent).await.map_err(|e| e.to_string())?
        }
        crate::state::RuntimeConnectionType::Remote => {
            // For remote, we need the instance_id for the agent
            let list = state
                .pekohub_client
                .list_agents(runtime_id)
                .await
                .map_err(|e| e.to_string())?;
            let agents = list
                .get("agents")
                .and_then(|v| v.as_array())
                .unwrap_or(&vec![])
                .clone();
            let instance = agents
                .into_iter()
                .find(|a| a.get("name").and_then(|v| v.as_str()) == Some(agent));
            let instance_id = instance
                .and_then(|a| a.get("id").and_then(|v| v.as_str().map(|s| s.to_string())))
                .ok_or_else(|| format!("agent '{}' not found on remote runtime", agent))?;
            state
                .pekohub_client
                .list_sessions(&instance_id)
                .await
                .map_err(|e| e.to_string())?
        }
    };

    let active_session = value.get("active_session").and_then(|v| v.as_str());
    let sessions = value
        .get("sessions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| parse_session_summary(s, active_session, runtime_id))
                .collect()
        })
        .unwrap_or_default();
    Ok(sessions)
}

async fn dispatch_session_show(
    state: &AppState,
    runtime_id: &str,
    id: &str,
) -> Result<SessionDetail, String> {
    let (agent, session_id) = if id.contains('/') {
        let parts: Vec<&str> = id.splitn(2, '/').collect();
        (parts[0].to_string(), parts[1].to_string())
    } else {
        ("default".to_string(), id.to_string())
    };

    let runtime = state
        .get_runtime(runtime_id)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", runtime_id))?;

    let value = match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
            client
                .show_session(&agent, None, &session_id, false)
                .await
                .map_err(|e| e.to_string())?
        }
        crate::state::RuntimeConnectionType::Remote => {
            let list = state
                .pekohub_client
                .list_agents(runtime_id)
                .await
                .map_err(|e| e.to_string())?;
            let agents = list
                .get("agents")
                .and_then(|v| v.as_array())
                .unwrap_or(&vec![])
                .clone();
            let instance = agents
                .into_iter()
                .find(|a| a.get("name").and_then(|v| v.as_str()) == Some(&agent));
            let instance_id = instance
                .and_then(|a| a.get("id").and_then(|v| v.as_str().map(|s| s.to_string())))
                .ok_or_else(|| format!("agent '{}' not found on remote runtime", agent))?;
            state
                .pekohub_client
                .session_history(&instance_id, &session_id)
                .await
                .map_err(|e| e.to_string())?
        }
    };

    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }

    let session = value
        .get("session")
        .and_then(|v| parse_session_detail(v, runtime_id))
        .ok_or_else(|| "session not found".to_string())?;
    Ok(session)
}

async fn dispatch_session_history(
    state: &AppState,
    runtime_id: &str,
    id: &str,
) -> Result<Vec<SessionMessage>, String> {
    let (agent, session_id) = if id.contains('/') {
        let parts: Vec<&str> = id.splitn(2, '/').collect();
        (parts[0].to_string(), parts[1].to_string())
    } else {
        ("default".to_string(), id.to_string())
    };

    let runtime = state
        .get_runtime(runtime_id)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", runtime_id))?;

    let value = match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
            client
                .show_session(&agent, None, &session_id, true)
                .await
                .map_err(|e| e.to_string())?
        }
        crate::state::RuntimeConnectionType::Remote => {
            let list = state
                .pekohub_client
                .list_agents(runtime_id)
                .await
                .map_err(|e| e.to_string())?;
            let agents = list
                .get("agents")
                .and_then(|v| v.as_array())
                .unwrap_or(&vec![])
                .clone();
            let instance = agents
                .into_iter()
                .find(|a| a.get("name").and_then(|v| v.as_str()) == Some(&agent));
            let instance_id = instance
                .and_then(|a| a.get("id").and_then(|v| v.as_str().map(|s| s.to_string())))
                .ok_or_else(|| format!("agent '{}' not found on remote runtime", agent))?;
            state
                .pekohub_client
                .session_history(&instance_id, &session_id)
                .await
                .map_err(|e| e.to_string())?
        }
    };

    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }

    let mut messages: Vec<SessionMessage> = value
        .get("history")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|event| {
                    let event_type = event.get("type")?.as_str()?;
                    if event_type != "Message" {
                        return None;
                    }
                    let role = event.get("role").and_then(|v| v.as_str()).unwrap_or("unknown");
                    if role == "system" {
                        return None;
                    }
                    Some(SessionMessage {
                        id: event
                            .get("timestamp")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        role: role.to_string(),
                        content: event
                            .get("content")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        timestamp: event
                            .get("timestamp")
                            .and_then(|v| v.as_str())
                            .unwrap_or("0")
                            .to_string(),
                        metadata: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    messages.reverse();
    Ok(messages)
}

async fn get_active_session(state: &AppState, runtime_id: &str, agent: &str) -> Option<String> {
    let runtime = state.get_runtime(runtime_id).await?;
    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new().await.ok()?;
            let resp = client.list_sessions(agent).await.ok()?;
            resp.get("active_session")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        }
        crate::state::RuntimeConnectionType::Remote => {
            // For remote, we don't have a direct active_session concept yet
            None
        }
    }
}

#[tauri::command]
pub async fn session_list(
    state: State<'_, AppState>,
    agent: String,
    runtime_id: Option<String>,
) -> Result<Vec<SessionSummary>, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    dispatch_session_list(&state, &rid, &agent).await
}

#[tauri::command]
pub async fn session_show(
    state: State<'_, AppState>,
    id: String,
    runtime_id: Option<String>,
) -> Result<SessionDetail, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    dispatch_session_show(&state, &rid, &id).await
}

#[tauri::command]
pub async fn session_history(
    state: State<'_, AppState>,
    id: String,
    runtime_id: Option<String>,
) -> Result<Vec<SessionMessage>, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    dispatch_session_history(&state, &rid, &id).await
}

#[tauri::command]
pub async fn session_branch(
    state: State<'_, AppState>,
    id: String,
    name: String,
    runtime_id: Option<String>,
) -> Result<String, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    let runtime = state
        .get_runtime(&rid)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", rid))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
            let (agent, session_id) = if id.contains('/') {
                let parts: Vec<&str> = id.splitn(2, '/').collect();
                (parts[0].to_string(), parts[1].to_string())
            } else {
                ("default".to_string(), id)
            };
            let resp = client
                .branch_session(&agent, None, &session_id, Some(&name))
                .await
                .map_err(|e| e.to_string())?;
            if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
                return Err(resp
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string());
            }
            let new_id = resp
                .get("new_session_id")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            Ok(format!("Session branched: {}", new_id))
        }
        crate::state::RuntimeConnectionType::Remote => {
            Err("Session branch is not supported for remote runtimes yet".to_string())
        }
    }
}

#[tauri::command]
pub async fn session_compact(
    state: State<'_, AppState>,
    id: String,
    runtime_id: Option<String>,
) -> Result<String, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    let runtime = state
        .get_runtime(&rid)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", rid))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
            let (agent, session_id) = if id.contains('/') {
                let parts: Vec<&str> = id.splitn(2, '/').collect();
                (parts[0].to_string(), parts[1].to_string())
            } else {
                ("default".to_string(), id)
            };
            let resp = client
                .compact_session(&agent, None, &session_id, false, None)
                .await
                .map_err(|e| e.to_string())?;
            if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
                return Err(resp
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string());
            }
            let saved = resp.get("tokens_saved").and_then(|v| v.as_u64()).unwrap_or(0);
            Ok(format!("Session compacted, saved {} tokens", saved))
        }
        crate::state::RuntimeConnectionType::Remote => {
            Err("Session compact is not supported for remote runtimes yet".to_string())
        }
    }
}

/// Send a message to an agent and stream the response via Tauri events.
#[tauri::command(rename_all = "snake_case")]
pub async fn session_send(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    message: String,
    new_session: Option<bool>,
    runtime_id: Option<String>,
) -> Result<(), String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    let id = id.strip_prefix("chat-").unwrap_or(&id);
    let (agent, explicit_session_id) = if id.contains('/') {
        let parts: Vec<&str> = id.splitn(2, '/').collect();
        (parts[0].to_string(), Some(parts[1].to_string()))
    } else {
        (id.to_string(), None)
    };

    let (session_id, debug_explicit) = if new_session == Some(true) {
        (None, explicit_session_id.clone())
    } else if let Some(sid) = explicit_session_id {
        (Some(sid), None)
    } else {
        (get_active_session(&state, &rid, &agent).await, None)
    };

    eprintln!(
        "[session_send] runtime={}, agent={}, explicit_session_id={:?}, new_session={:?}, resolved_session_id={:?}",
        rid, agent, debug_explicit, new_session, session_id
    );

    let runtime = state
        .get_runtime(&rid)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", rid))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
            client
                .execute(&app, agent, message, session_id)
                .await
                .map_err(|e| e.to_string())
        }
        crate::state::RuntimeConnectionType::Remote => {
            // Resolve agent to instance_id
            let list = state
                .pekohub_client
                .list_agents(&rid)
                .await
                .map_err(|e| e.to_string())?;
            let agents = list
                .get("agents")
                .and_then(|v| v.as_array())
                .unwrap_or(&vec![])
                .clone();
            let instance = agents
                .into_iter()
                .find(|a| a.get("name").and_then(|v| v.as_str()) == Some(&agent));
            let instance_id = instance
                .and_then(|a| a.get("id").and_then(|v| v.as_str().map(|s| s.to_string())))
                .ok_or_else(|| format!("agent '{}' not found on remote runtime", agent))?;

            // Stream via SSE
            let app_handle = app.clone();
            state
                .pekohub_client
                .chat_streaming(&instance_id, &message, move |event| {
                    let _ = app_handle.emit("peko-stream", &event);
                })
                .await
                .map_err(|e| e.to_string())?;

            Ok(())
        }
    }
}
