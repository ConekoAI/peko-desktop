use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamSummary {
    pub name: String,
    pub description: Option<String>,
    pub agent_count: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamDetail {
    pub name: String,
    pub description: Option<String>,
    pub members: Vec<String>,
    pub agent_count: usize,
    pub created_at: String,
    pub updated_at: String,
}

fn parse_team_summary(value: &serde_json::Value) -> Option<TeamSummary> {
    let metadata = value.get("metadata").cloned().unwrap_or(serde_json::json!({}));
    Some(TeamSummary {
        name: value.get("name")?.as_str()?.to_string(),
        description: metadata
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        agent_count: value.get("agent_count").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
    })
}

fn parse_team_detail(value: &serde_json::Value) -> Option<TeamDetail> {
    let metadata = value.get("metadata").cloned().unwrap_or(serde_json::json!({}));
    let team_path = value.get("path").and_then(|v| v.as_str());

    // created_at is a string from metadata (e.g., "2024-01-15T10:30:00Z")
    let created_at = metadata
        .get("created_at")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    // updated_at from directory modification time
    let updated_at = team_path
        .and_then(|path| std::fs::metadata(path).ok())
        .and_then(|meta| meta.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let members = value
        .get("members")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    Some(TeamDetail {
        name: value.get("name")?.as_str()?.to_string(),
        description: metadata
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        members,
        agent_count: value.get("agent_count").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
        created_at,
        updated_at,
    })
}

#[tauri::command]
pub async fn team_list() -> Result<Vec<TeamSummary>, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.list_teams().await.map_err(|e| e.to_string())?;
    let teams = value
        .get("teams")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_team_summary).collect())
        .unwrap_or_default();
    Ok(teams)
}

#[tauri::command]
pub async fn team_show(name: String) -> Result<TeamDetail, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;

    // Get team info
    let value = client.get_team(&name).await.map_err(|e| e.to_string())?;
    let mut team = value
        .get("team")
        .and_then(parse_team_detail)
        .ok_or_else(|| "team not found".to_string())?;

    // agent_count already populated from daemon's TeamInfo.members
    team.agent_count = team.members.len();

    Ok(team)
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
