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
    super::util::run_peko_json(&["ext", "list", "--json"])
}

#[tauri::command]
pub fn extension_install(path: String) -> Result<String, String> {
    super::util::run_peko_ok(&["ext", "install", &path])
}

#[tauri::command]
pub fn extension_enable(id: String) -> Result<String, String> {
    super::util::run_peko_ok(&["ext", "enable", &id])
}

#[tauri::command]
pub fn extension_disable(id: String) -> Result<String, String> {
    super::util::run_peko_ok(&["ext", "disable", &id])
}

#[tauri::command]
pub fn extension_uninstall(id: String) -> Result<String, String> {
    super::util::run_peko_ok(&["ext", "uninstall", &id])
}
