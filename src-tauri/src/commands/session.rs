use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionSummary {
    pub id: String,
    pub agent: String,
    pub title: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionDetail {
    pub id: String,
    pub agent: String,
    pub title: String,
    pub messages: Vec<String>,
    pub branches: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub async fn session_list(agent: String) -> Result<Vec<SessionSummary>, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.list_sessions(&agent).await.map_err(|e| e.to_string())?;
    let sessions = value
        .get("sessions")
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![]));
    serde_json::from_value(sessions).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn session_show(id: String) -> Result<SessionDetail, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.get_session(&id).await.map_err(|e| e.to_string())?;
    let session = value
        .get("session")
        .cloned()
        .ok_or_else(|| "session not found".to_string())?;
    serde_json::from_value(session).map_err(|e| e.to_string())
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
