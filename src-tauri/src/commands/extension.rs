use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExtensionSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
}

#[tauri::command]
pub async fn extension_list() -> Result<Vec<ExtensionSummary>, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let resp = client.list_extensions(false, None).await.map_err(|e| e.to_string())?;
    
    let extensions = resp.get("extensions")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|e| {
            Some(ExtensionSummary {
                id: e.get("id")?.as_str()?.to_string(),
                name: e.get("name")?.as_str()?.to_string(),
                version: e.get("version").and_then(|v| v.as_str()).unwrap_or("n/a").to_string(),
                enabled: e.get("enabled")?.as_bool().unwrap_or(true),
            })
        }).collect())
        .unwrap_or_default();
    
    Ok(extensions)
}

#[tauri::command]
pub fn extension_install(path: String) -> Result<String, String> {
    super::util::run_peko_ok(&["ext", "install", &path])
}

#[tauri::command]
pub async fn extension_enable(id: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let resp = client.enable_extension(&id, None).await.map_err(|e| e.to_string())?;
    
    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
    }
    
    let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("Extension enabled");
    Ok(msg.to_string())
}

#[tauri::command]
pub async fn extension_disable(id: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let resp = client.disable_extension(&id, None).await.map_err(|e| e.to_string())?;
    
    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
    }
    
    let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("Extension disabled");
    Ok(msg.to_string())
}

#[tauri::command]
pub fn extension_uninstall(id: String) -> Result<String, String> {
    super::util::run_peko_ok(&["ext", "uninstall", &id])
}
