use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AgentSummary {
    pub name: String,
    pub description: Option<String>,
    pub model: String,
    pub provider: String,
    pub team: String,
    pub session_count: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AgentDetail {
    pub name: String,
    pub description: Option<String>,
    pub model: String,
    pub provider: String,
    pub team: String,
    pub session_count: usize,
    pub system_prompt: Option<String>,
    pub tools: Vec<String>,
    pub extensions: Vec<String>,
    pub config: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

fn extract_provider_from_config(config: &serde_json::Value) -> String {
    config
        .get("provider")
        .and_then(|p| p.get("provider_type"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string()
}

fn extract_model_from_config(config: &serde_json::Value) -> String {
    config
        .get("provider")
        .and_then(|p| p.get("default_model"))
        .and_then(|v| v.as_str())
        .unwrap_or("default")
        .to_string()
}

fn extract_system_prompt_from_config(config: &serde_json::Value) -> Option<String> {
    config
        .get("system_prompt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn extract_tools_from_config(config: &serde_json::Value) -> Vec<String> {
    config
        .get("tools")
        .and_then(|t| t.get("enabled"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn parse_agent_summary(value: &serde_json::Value) -> Option<AgentSummary> {
    let config = value.get("config").cloned().unwrap_or(serde_json::json!({}));
    Some(AgentSummary {
        name: value.get("name")?.as_str()?.to_string(),
        description: config
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        model: extract_model_from_config(&config),
        provider: extract_provider_from_config(&config),
        team: value.get("team")?.as_str()?.to_string(),
        session_count: value.get("session_count").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
    })
}

fn parse_agent_detail(value: &serde_json::Value) -> Option<AgentDetail> {
    let config = value.get("config").cloned().unwrap_or(serde_json::json!({}));
    let created_at = value
        .get("created_at_ms")
        .or_else(|| value.get("created_at"))
        .and_then(|v| v.as_u64())
        .map(|ts| ts.to_string())
        .or_else(|| config.get("created_at").and_then(|v| v.as_u64()).map(|ts| ts.to_string()))
        .unwrap_or_else(|| "unknown".to_string());
    let updated_at = value
        .get("updated_at_ms")
        .or_else(|| value.get("updated_at"))
        .and_then(|v| v.as_u64())
        .map(|ts| ts.to_string())
        .or_else(|| config.get("updated_at").and_then(|v| v.as_u64()).map(|ts| ts.to_string()))
        .unwrap_or_else(|| "unknown".to_string());
    Some(AgentDetail {
        name: value.get("name")?.as_str()?.to_string(),
        description: config
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        model: extract_model_from_config(&config),
        provider: extract_provider_from_config(&config),
        team: value.get("team")?.as_str()?.to_string(),
        session_count: value.get("session_count").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
        system_prompt: extract_system_prompt_from_config(&config),
        tools: extract_tools_from_config(&config),
        extensions: vec![],
        config,
        created_at,
        updated_at,
    })
}

#[tauri::command]
pub async fn agent_list() -> Result<Vec<AgentSummary>, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.list_agents().await.map_err(|e| e.to_string())?;
    let agents = value
        .get("agents")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_agent_summary).collect())
        .unwrap_or_default();
    Ok(agents)
}

#[tauri::command]
pub async fn agent_show(name: String) -> Result<AgentDetail, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.get_agent(&name).await.map_err(|e| e.to_string())?;
    let agent = value
        .get("agent")
        .and_then(parse_agent_detail)
        .ok_or_else(|| "agent not found".to_string())?;
    Ok(agent)
}

#[tauri::command]
pub async fn agent_create(name: String, provider: String, model: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client
        .create_agent(&name, &provider, &model)
        .await
        .map_err(|e| e.to_string())?;
    let msg = value
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("created")
        .to_string();
    Ok(msg)
}

#[tauri::command]
pub async fn agent_remove(name: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.delete_agent(&name).await.map_err(|e| e.to_string())?;
    let msg = value
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("removed")
        .to_string();
    Ok(msg)
}

#[tauri::command]
pub async fn agent_export(name: String, path: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let resp = client.export_agent(&name, None, Some(&path), false).await.map_err(|e| e.to_string())?;

    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
    }

    let output = resp.get("output_path").and_then(|v| v.as_str()).unwrap_or("unknown");
    Ok(format!("Agent exported to {}", output))
}

#[tauri::command]
pub async fn agent_import(path: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let resp = client.import_agent(&path, None, None).await.map_err(|e| e.to_string())?;

    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
    }

    let name = resp.get("name").and_then(|v| v.as_str()).unwrap_or("unknown");
    Ok(format!("Agent '{}' imported", name))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProviderInfo {
    pub id: String,
    pub display_name: String,
    pub api_type: String,
    pub default_model: String,
    pub requires_key: bool,
    pub is_local: bool,
}

#[tauri::command]
pub async fn provider_list() -> Result<Vec<ProviderInfo>, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.list_providers().await.map_err(|e| e.to_string())?;

    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(value.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
    }

    let providers = value
        .get("providers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| {
                    Some(ProviderInfo {
                        id: p.get("id")?.as_str()?.to_string(),
                        display_name: p.get("display_name")?.as_str()?.to_string(),
                        api_type: p.get("api_type")?.as_str()?.to_string(),
                        default_model: p.get("default_model")?.as_str()?.to_string(),
                        requires_key: p.get("requires_key")?.as_bool().unwrap_or(true),
                        is_local: p.get("is_local")?.as_bool().unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(providers)
}
