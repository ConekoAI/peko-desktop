use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionSummary {
    pub id: String,
    pub agent: String,
    pub title: Option<String>,
    pub message_count: usize,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
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
}

fn format_timestamp(ts: u64) -> String {
    // Daemon returns timestamps as u64 milliseconds
    if ts == 0 {
        return "unknown".to_string();
    }
    match std::time::UNIX_EPOCH.checked_add(std::time::Duration::from_millis(ts)) {
        Some(system_time) => {
            let secs = system_time
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let days = secs / 86_400;
            let rem = secs % 86_400;
            let hh = rem / 3600;
            let mm = (rem % 3600) / 60;
            let ss = rem % 60;
            format!("{}d {:02}:{:02}:{:02} UTC", days, hh, mm, ss)
        }
        None => "unknown".to_string(),
    }
}

fn parse_session_summary(value: &serde_json::Value) -> Option<SessionSummary> {
    let created_at = value
        .get("created_at")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let updated_at = value
        .get("updated_at")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    Some(SessionSummary {
        id: value.get("session_id").or_else(|| value.get("id"))?.as_str()?.to_string(),
        agent: value.get("agent_name")?.as_str()?.to_string(),
        title: value
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        message_count: value
            .get("message_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize,
        status: "active".to_string(),
        created_at: format_timestamp(created_at),
        updated_at: format_timestamp(updated_at),
    })
}

fn parse_session_detail(value: &serde_json::Value) -> Option<SessionDetail> {
    let info = value.get("info").cloned().unwrap_or(value.clone());
    let created_at = info
        .get("created_at")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let updated_at = info
        .get("updated_at")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    Some(SessionDetail {
        id: info.get("session_id").or_else(|| info.get("id"))?.as_str()?.to_string(),
        agent: info.get("agent_name")?.as_str()?.to_string(),
        title: info
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        message_count: info
            .get("message_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize,
        status: "active".to_string(),
        messages: vec![],
        branches: vec![],
        parent_id: info
            .get("parent_session_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        metadata: serde_json::json!({}),
        created_at: format_timestamp(created_at),
        updated_at: format_timestamp(updated_at),
    })
}

#[tauri::command]
pub async fn session_list(agent: String) -> Result<Vec<SessionSummary>, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.list_sessions(&agent).await.map_err(|e| e.to_string())?;
    let sessions = value
        .get("sessions")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_session_summary).collect())
        .unwrap_or_default();
    Ok(sessions)
}

#[tauri::command]
pub async fn session_show(id: String) -> Result<SessionDetail, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.get_session(&id).await.map_err(|e| e.to_string())?;
    let session = value
        .get("session")
        .and_then(parse_session_detail)
        .ok_or_else(|| "session not found".to_string())?;
    Ok(session)
}

/// Get the active session ID for an agent from the daemon.
async fn get_active_session(agent: &str) -> Option<String> {
    let client = crate::ipc::IpcClient::new().await.ok()?;
    let resp = client.list_sessions(agent).await.ok()?;
    resp.get("active_session")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

#[tauri::command]
pub async fn session_branch(id: String, name: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    // Parse id as "agent/session_id" or just "session_id"
    let (agent, session_id) = if id.contains('/') {
        let parts: Vec<&str> = id.splitn(2, '/').collect();
        (parts[0].to_string(), parts[1].to_string())
    } else {
        ("default".to_string(), id)
    };
    let resp = client.branch_session(&agent, None, &session_id, Some(&name)).await.map_err(|e| e.to_string())?;
    
    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
    }
    
    let new_id = resp.get("new_session_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    Ok(format!("Session branched: {}", new_id))
}

#[tauri::command]
pub async fn session_compact(id: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let (agent, session_id) = if id.contains('/') {
        let parts: Vec<&str> = id.splitn(2, '/').collect();
        (parts[0].to_string(), parts[1].to_string())
    } else {
        ("default".to_string(), id)
    };
    let resp = client.compact_session(&agent, None, &session_id, false, None).await.map_err(|e| e.to_string())?;
    
    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
    }
    
    let saved = resp.get("tokens_saved").and_then(|v| v.as_u64()).unwrap_or(0);
    Ok(format!("Session compacted, saved {} tokens", saved))
}

/// Send a message to an agent and stream the response via Tauri events.
/// The frontend listens on "peko-stream" for StreamEvent payloads.
#[tauri::command]
pub async fn session_send(
    app: tauri::AppHandle,
    id: String,
    message: String,
) -> Result<(), String> {
    // Parse id as "agent/session_id" or just "agent"
    // The frontend may prefix with "chat-" (e.g. "chat-my-agent") — strip it.
    let id = id.strip_prefix("chat-").unwrap_or(&id);
    let (agent, explicit_session_id) = if id.contains('/') {
        let parts: Vec<&str> = id.splitn(2, '/').collect();
        (parts[0].to_string(), Some(parts[1].to_string()))
    } else {
        (id.to_string(), None)
    };

    // If no explicit session ID, query the daemon for the active session.
    // This ensures continuity across messages in the same chat.
    let session_id = if let Some(sid) = explicit_session_id {
        Some(sid)
    } else {
        get_active_session(&agent).await
    };

    eprintln!("[session_send] agent={}, session_id={:?}", agent, session_id);

    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    client
        .execute(&app, agent, message, session_id)
        .await
        .map_err(|e| e.to_string())
}
