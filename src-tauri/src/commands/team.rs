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
    super::util::run_peko_json(&["team", "list", "--json"])
}

#[tauri::command]
pub fn team_show(name: String) -> Result<TeamDetail, String> {
    super::util::run_peko_json(&["team", "show", &name, "--json"])
}

#[tauri::command]
pub fn team_export(name: String, path: String) -> Result<String, String> {
    super::util::run_peko_ok(&["team", "export", &name, "--output", &path])
}

#[tauri::command]
pub fn team_import(path: String) -> Result<String, String> {
    super::util::run_peko_ok(&["team", "import", &path])
}
