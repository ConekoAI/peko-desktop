use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub source: String,
    pub ext_type: String,
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
                description: e.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
                enabled: e.get("enabled")?.as_bool().unwrap_or(true),
                source: e.get("source").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
                ext_type: e.get("ext_type").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
            })
        }).collect())
        .unwrap_or_default();
    
    Ok(extensions)
}

#[tauri::command]
pub async fn extension_install(path: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let resp = client.install_extension(&path).await.map_err(|e| e.to_string())?;
    
    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
    }
    
    let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("Extension installed");
    Ok(msg.to_string())
}

#[tauri::command]
pub async fn extension_enable(id: String, target: Option<String>) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let target_ref = target.as_deref();
    let resp = client.enable_extension(&id, target_ref).await.map_err(|e| e.to_string())?;
    
    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
    }
    
    let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("Extension enabled");
    Ok(msg.to_string())
}

#[tauri::command]
pub async fn extension_disable(id: String, target: Option<String>) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let target_ref = target.as_deref();
    let resp = client.disable_extension(&id, target_ref).await.map_err(|e| e.to_string())?;
    
    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
    }
    
    let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("Extension disabled");
    Ok(msg.to_string())
}

#[tauri::command]
pub async fn extension_uninstall(id: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let resp = client.uninstall_extension(&id).await.map_err(|e| e.to_string())?;
    
    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
    }
    
    let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("Extension uninstalled");
    Ok(msg.to_string())
}
