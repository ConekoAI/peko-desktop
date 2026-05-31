use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AgentSummary {
    pub name: String,
    pub provider: String,
    pub model: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AgentDetail {
    pub name: String,
    pub provider: String,
    pub model: String,
    pub system_prompt: String,
    pub tools: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub async fn agent_list() -> Result<Vec<AgentSummary>, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.list_agents().await.map_err(|e| e.to_string())?;
    let agents = value
        .get("agents")
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![]));
    serde_json::from_value(agents).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_show(name: String) -> Result<AgentDetail, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.get_agent(&name).await.map_err(|e| e.to_string())?;
    let agent = value
        .get("agent")
        .cloned()
        .ok_or_else(|| "agent not found".to_string())?;
    serde_json::from_value(agent).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_create(name: String, provider: String, model: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client
        .create_agent(&name, &provider, &model)
        .await
        .map_err(|e| e.to_string())?;
    let msg = value
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("created")
        .to_string();
    Ok(msg)
}

#[tauri::command]
pub async fn agent_remove(name: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.delete_agent(&name).await.map_err(|e| e.to_string())?;
    let msg = value
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("removed")
        .to_string();
    Ok(msg)
}

#[tauri::command]
pub fn agent_export(name: String, path: String) -> Result<String, String> {
    super::util::run_peko_ok(&["agent", "export", &name, "--output", &path])
}

#[tauri::command]
pub fn agent_import(path: String) -> Result<String, String> {
    super::util::run_peko_ok(&["agent", "import", &path])
}
