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
    Ok(vec![])
}

#[tauri::command]
pub fn agent_show(name: String) -> Result<AgentDetail, String> {
    Ok(AgentDetail {
        name,
        provider: "openai".to_string(),
        model: "gpt-4".to_string(),
        system_prompt: "".to_string(),
        tools: vec![],
        created_at: "".to_string(),
        updated_at: "".to_string(),
    })
}

#[tauri::command]
pub fn agent_create(name: String, provider: String, model: String) -> Result<String, String> {
    Ok(format!("agent '{}' created with {}/{}", name, provider, model))
}

#[tauri::command]
pub fn agent_remove(name: String) -> Result<String, String> {
    Ok(format!("agent '{}' removed", name))
}

#[tauri::command]
pub fn agent_export(name: String, path: String) -> Result<String, String> {
    Ok(format!("agent '{}' exported to {}", name, path))
}

#[tauri::command]
pub fn agent_import(path: String) -> Result<String, String> {
    Ok(format!("agent imported from {}", path))
}
