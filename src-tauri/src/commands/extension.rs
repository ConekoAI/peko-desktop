use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExtensionSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
}

#[tauri::command]
pub fn extension_list() -> Result<Vec<ExtensionSummary>, String> {
    Ok(vec![])
}

#[tauri::command]
pub fn extension_install(path: String) -> Result<String, String> {
    Ok(format!("extension installed from {}", path))
}

#[tauri::command]
pub fn extension_enable(id: String) -> Result<String, String> {
    Ok(format!("extension '{}' enabled", id))
}

#[tauri::command]
pub fn extension_disable(id: String) -> Result<String, String> {
    Ok(format!("extension '{}' disabled", id))
}

#[tauri::command]
pub fn extension_uninstall(id: String) -> Result<String, String> {
    Ok(format!("extension '{}' uninstalled", id))
}
