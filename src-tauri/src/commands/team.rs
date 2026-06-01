use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TeamSummary {
    pub name: String,
    pub members: Vec<String>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TeamDetail {
    pub name: String,
    pub members: Vec<String>,
    pub workflow: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub async fn team_list() -> Result<Vec<TeamSummary>, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.list_teams().await.map_err(|e| e.to_string())?;
    let teams = value
        .get("teams")
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![]));
    serde_json::from_value(teams).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn team_show(name: String) -> Result<TeamDetail, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.get_team(&name).await.map_err(|e| e.to_string())?;
    let team = value
        .get("team")
        .cloned()
        .ok_or_else(|| "team not found".to_string())?;
    serde_json::from_value(team).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn team_export(name: String, path: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let resp = client.export_team(&name, Some(&path), false).await.map_err(|e| e.to_string())?;

    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
    }

    let output = resp.get("output_path").and_then(|v| v.as_str()).unwrap_or("unknown");
    Ok(format!("Team exported to {}", output))
}

#[tauri::command]
pub async fn team_import(path: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let resp = client.import_team(&path, None, false).await.map_err(|e| e.to_string())?;

    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
    }

    let name = resp.get("name").and_then(|v| v.as_str()).unwrap_or("unknown");
    Ok(format!("Team '{}' imported", name))
}
