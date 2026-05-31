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
pub fn agent_list() -> Result<Vec<AgentSummary>, String> {
    super::util::run_peko_json(&["agent", "list", "--json"])
}

#[tauri::command]
pub fn agent_show(name: String) -> Result<AgentDetail, String> {
    super::util::run_peko_json(&["agent", "show", &name, "--json"])
}

#[tauri::command]
pub fn agent_create(name: String, provider: String, model: String) -> Result<String, String> {
    super::util::run_peko_ok(&[
        "agent",
        "create",
        &name,
        "--provider",
        &provider,
        "--model",
        &model,
        "--yes",
    ])
}

#[tauri::command]
pub fn agent_remove(name: String) -> Result<String, String> {
    super::util::run_peko_ok(&["agent", "remove", &name, "--force"])
}

#[tauri::command]
pub fn agent_export(name: String, path: String) -> Result<String, String> {
    super::util::run_peko_ok(&["agent", "export", &name, "--output", &path])
}

#[tauri::command]
pub fn agent_import(path: String) -> Result<String, String> {
    super::util::run_peko_ok(&["agent", "import", &path])
}
