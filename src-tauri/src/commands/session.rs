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
pub fn session_branch(id: String, name: String) -> Result<String, String> {
    super::util::run_peko_ok(&["session", "branch", &id, "--name", &name])
}

#[tauri::command]
pub fn session_compact(id: String) -> Result<String, String> {
    super::util::run_peko_ok(&["session", "compact", &id])
}
