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
pub fn session_list(agent: String) -> Result<Vec<SessionSummary>, String> {
    super::util::run_peko_json(&["session", "list", &agent, "--json"])
}

#[tauri::command]
pub fn session_show(id: String) -> Result<SessionDetail, String> {
    super::util::run_peko_json(&["session", "show", &id, "--json"])
}

#[tauri::command]
pub fn session_branch(id: String, name: String) -> Result<String, String> {
    super::util::run_peko_ok(&["session", "branch", &id, "--name", &name])
}

#[tauri::command]
pub fn session_compact(id: String) -> Result<String, String> {
    super::util::run_peko_ok(&["session", "compact", &id])
}
