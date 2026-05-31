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
pub fn team_list() -> Result<Vec<TeamSummary>, String> {
    Ok(vec![])
}

#[tauri::command]
pub fn team_show(name: String) -> Result<TeamDetail, String> {
    Ok(TeamDetail {
        name,
        members: vec![],
        workflow: "sequential".to_string(),
        created_at: "".to_string(),
        updated_at: "".to_string(),
    })
}

#[tauri::command]
pub fn team_export(name: String, path: String) -> Result<String, String> {
    Ok(format!("team '{}' exported to {}", name, path))
}

#[tauri::command]
pub fn team_import(path: String) -> Result<String, String> {
    Ok(format!("team imported from {}", path))
}
