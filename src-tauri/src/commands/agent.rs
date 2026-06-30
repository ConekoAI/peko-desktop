use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentSummary {
    pub name: String,
    pub description: Option<String>,
    pub model: String,
    pub provider: String,
    pub session_count: usize,
    pub runtime_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetail {
    pub name: String,
    pub description: Option<String>,
    pub model: String,
    pub provider: String,
    pub session_count: usize,
    pub system_prompt: Option<String>,
    pub tools: Vec<String>,
    pub extensions: Vec<String>,
    pub config: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
    pub runtime_id: String,
    pub status: Option<String>,
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

fn extract_system_prompt(value: &serde_json::Value, config: &serde_json::Value) -> Option<String> {
    // The daemon now resolves the system prompt file content into a top-level
    // `system_prompt` field on `AgentInfo`. Fall back to the legacy config key
    // or the `prompt.system.files` array for older daemon versions.
    value
        .get("system_prompt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            config
                .get("system_prompt")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .or_else(|| {
            config
                .get("prompt")
                .and_then(|p| p.get("system"))
                .and_then(|s| s.get("files"))
                .and_then(|f| f.as_array())
                .and_then(|arr| arr.first())
                .and_then(|v| v.as_str())
                .map(|s| format!("<{}>", s))
        })
}

fn extract_extensions_from_config(config: &serde_json::Value) -> Vec<String> {
    config
        .get("extensions")
        .and_then(|e| e.get("enabled"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn parse_agent_summary(value: &serde_json::Value, runtime_id: &str) -> Option<AgentSummary> {
    let config = value
        .get("config")
        .cloned()
        .unwrap_or(serde_json::json!({}));
    Some(AgentSummary {
        name: value.get("name")?.as_str()?.to_string(),
        description: config
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        model: extract_model_from_config(&config),
        provider: extract_provider_from_config(&config),
        session_count: value
            .get("session_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize,
        runtime_id: runtime_id.to_string(),
    })
}

fn parse_agent_detail(value: &serde_json::Value, runtime_id: &str) -> Option<AgentDetail> {
    let config = value
        .get("config")
        .cloned()
        .unwrap_or(serde_json::json!({}));
    let config_path = value.get("config_path").and_then(|v| v.as_str());
    let (created_at, updated_at) = config_path
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|meta| {
            let created = meta
                .created()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            (created, modified)
        })
        .unwrap_or_else(|| {
            let created = value
                .get("created_at_ms")
                .or_else(|| value.get("created_at"))
                .and_then(|v| v.as_u64())
                .map(|ts| ts.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let updated = value
                .get("updated_at_ms")
                .or_else(|| value.get("updated_at"))
                .and_then(|v| v.as_u64())
                .map(|ts| ts.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            (created, updated)
        });
    let extensions = extract_extensions_from_config(&config);
    Some(AgentDetail {
        name: value.get("name")?.as_str()?.to_string(),
        description: config
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        model: extract_model_from_config(&config),
        provider: extract_provider_from_config(&config),
        session_count: value
            .get("session_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize,
        system_prompt: extract_system_prompt(value, &config),
        tools: extensions.clone(),
        extensions,
        config,
        created_at,
        updated_at,
        runtime_id: runtime_id.to_string(),
        status: value
            .get("status")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_agent_json() -> serde_json::Value {
        serde_json::json!({
            "name": "test-agent",
            "config": {
                "provider": {
                    "provider_type": "openai",
                    "default_model": "gpt-4"
                },
                "description": "A test agent",
                "extensions": {
                    "enabled": ["ext1", "ext2"]
                },
                "system_prompt": "legacy prompt"
            },
            "session_count": 3,
            "system_prompt": "resolved prompt",
            "created_at_ms": 1700000000000u64,
            "updated_at_ms": 1700000001000u64,
            "status": "online"
        })
    }

    #[test]
    fn test_extract_provider_from_config() {
        let config = sample_agent_json()["config"].clone();
        assert_eq!(extract_provider_from_config(&config), "openai");
    }

    #[test]
    fn test_extract_provider_defaults_unknown() {
        let config = serde_json::json!({});
        assert_eq!(extract_provider_from_config(&config), "unknown");
    }

    #[test]
    fn test_extract_model_from_config() {
        let config = sample_agent_json()["config"].clone();
        assert_eq!(extract_model_from_config(&config), "gpt-4");
    }

    #[test]
    fn test_extract_model_defaults_default() {
        let config = serde_json::json!({});
        assert_eq!(extract_model_from_config(&config), "default");
    }

    #[test]
    fn test_extract_system_prompt_prefers_top_level() {
        let value = sample_agent_json();
        let config = value["config"].clone();
        assert_eq!(
            extract_system_prompt(&value, &config),
            Some("resolved prompt".to_string())
        );
    }

    #[test]
    fn test_extract_system_prompt_falls_back_to_legacy_config() {
        let mut value = sample_agent_json();
        value.as_object_mut().unwrap().remove("system_prompt");
        let config = value["config"].clone();
        assert_eq!(
            extract_system_prompt(&value, &config),
            Some("legacy prompt".to_string())
        );
    }

    #[test]
    fn test_extract_system_prompt_falls_back_to_prompt_files() {
        let value = serde_json::json!({
            "config": {
                "prompt": {
                    "system": {
                        "files": ["prompts/system.md"]
                    }
                }
            }
        });
        let config = value["config"].clone();
        assert_eq!(
            extract_system_prompt(&value, &config),
            Some("<prompts/system.md>".to_string())
        );
    }

    #[test]
    fn test_extract_system_prompt_returns_none_when_missing() {
        let value = serde_json::json!({ "config": {} });
        assert_eq!(extract_system_prompt(&value, &value["config"]), None);
    }

    #[test]
    fn test_extract_extensions_from_config() {
        let config = sample_agent_json()["config"].clone();
        let exts = extract_extensions_from_config(&config);
        assert_eq!(exts, vec!["ext1", "ext2"]);
    }

    #[test]
    fn test_extract_extensions_defaults_empty() {
        let config = serde_json::json!({});
        assert!(extract_extensions_from_config(&config).is_empty());
    }

    #[test]
    fn test_parse_agent_summary() {
        let value = sample_agent_json();
        let summary = parse_agent_summary(&value, "local").unwrap();
        assert_eq!(summary.name, "test-agent");
        assert_eq!(summary.provider, "openai");
        assert_eq!(summary.model, "gpt-4");
        assert_eq!(summary.description, Some("A test agent".to_string()));
        assert_eq!(summary.session_count, 3);
        assert_eq!(summary.runtime_id, "local");
    }

    #[test]
    fn test_parse_agent_summary_defaults_missing_fields() {
        let value = serde_json::json!({ "name": "minimal" });
        let summary = parse_agent_summary(&value, "remote").unwrap();
        assert_eq!(summary.name, "minimal");
        assert_eq!(summary.provider, "unknown");
        assert_eq!(summary.model, "default");
        assert_eq!(summary.session_count, 0);
    }

    #[test]
    fn test_parse_agent_detail() {
        let value = sample_agent_json();
        let detail = parse_agent_detail(&value, "local").unwrap();
        assert_eq!(detail.name, "test-agent");
        assert_eq!(detail.provider, "openai");
        assert_eq!(detail.model, "gpt-4");
        assert_eq!(detail.system_prompt, Some("resolved prompt".to_string()));
        assert_eq!(detail.extensions, vec!["ext1", "ext2"]);
        assert_eq!(detail.tools, vec!["ext1", "ext2"]);
        assert_eq!(detail.status, Some("online".to_string()));
        assert_eq!(detail.runtime_id, "local");
        assert_eq!(detail.created_at, "1700000000000");
        assert_eq!(detail.updated_at, "1700000001000");
    }

    #[test]
    fn test_parse_agent_detail_without_timestamps() {
        let value = serde_json::json!({ "name": "minimal", "config": {} });
        let detail = parse_agent_detail(&value, "local").unwrap();
        assert_eq!(detail.created_at, "unknown");
        assert_eq!(detail.updated_at, "unknown");
    }
}

// ------------------------------------------------------------------
// Unified dispatch helpers
// ------------------------------------------------------------------

async fn dispatch_agent_list(
    state: &AppState,
    runtime_id: &str,
) -> Result<Vec<AgentSummary>, String> {
    let runtime = state
        .get_runtime(runtime_id)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", runtime_id))?;

    let value = match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| e.to_string())?;
            client.list_agents().await.map_err(|e| e.to_string())?
        }
        crate::state::RuntimeConnectionType::Remote => state
            .pekohub_client
            .list_agents(runtime_id)
            .await
            .map_err(|e| e.to_string())?,
    };

    let agents = value
        .get("agents")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| parse_agent_summary(v, runtime_id))
                .collect()
        })
        .unwrap_or_default();
    Ok(agents)
}

async fn dispatch_agent_show(
    state: &AppState,
    runtime_id: &str,
    name: &str,
) -> Result<AgentDetail, String> {
    let runtime = state
        .get_runtime(runtime_id)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", runtime_id))?;

    let value = match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| e.to_string())?;
            client.get_agent(name).await.map_err(|e| e.to_string())?
        }
        crate::state::RuntimeConnectionType::Remote => {
            // For remote, list agents and find the one matching name
            let list = state
                .pekohub_client
                .list_agents(runtime_id)
                .await
                .map_err(|e| e.to_string())?;
            let agents = list
                .get("agents")
                .and_then(|v| v.as_array())
                .unwrap_or(&vec![])
                .clone();
            agents
                .into_iter()
                .find(|a| a.get("name").and_then(|v| v.as_str()) == Some(name))
                .ok_or_else(|| format!("agent '{}' not found", name))?
        }
    };

    let agent = value
        .get("agent")
        .and_then(|v| parse_agent_detail(v, runtime_id))
        .or_else(|| parse_agent_detail(&value, runtime_id))
        .ok_or_else(|| "agent not found".to_string())?;
    Ok(agent)
}

async fn dispatch_agent_create(
    state: &AppState,
    runtime_id: &str,
    name: &str,
    provider: &str,
    model: &str,
) -> Result<AgentDetail, String> {
    let runtime = state
        .get_runtime(runtime_id)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", runtime_id))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| e.to_string())?;
            let _value = client
                .create_agent(name, provider, model)
                .await
                .map_err(|e| e.to_string())?;
            let agent_value = client.get_agent(name).await.map_err(|e| e.to_string())?;
            let agent = agent_value
                .get("agent")
                .and_then(|v| parse_agent_detail(v, runtime_id))
                .ok_or_else(|| "agent created but could not be fetched".to_string())?;
            Ok(agent)
        }
        crate::state::RuntimeConnectionType::Remote => {
            let _value = state
                .pekohub_client
                .create_agent(runtime_id, name, provider, model)
                .await
                .map_err(|e| e.to_string())?;
            // Re-fetch via list to get full detail
            dispatch_agent_show(state, runtime_id, name).await
        }
    }
}

async fn dispatch_agent_remove(
    state: &AppState,
    runtime_id: &str,
    name: &str,
) -> Result<String, String> {
    let runtime = state
        .get_runtime(runtime_id)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", runtime_id))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| e.to_string())?;
            let value = client.delete_agent(name).await.map_err(|e| e.to_string())?;
            let msg = value
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("removed")
                .to_string();
            Ok(msg)
        }
        crate::state::RuntimeConnectionType::Remote => {
            // For remote we need the instance_id; we look it up by name
            let list = state
                .pekohub_client
                .list_agents(runtime_id)
                .await
                .map_err(|e| e.to_string())?;
            let agents = list
                .get("agents")
                .and_then(|v| v.as_array())
                .unwrap_or(&vec![])
                .clone();
            let instance = agents
                .into_iter()
                .find(|a| a.get("name").and_then(|v| v.as_str()) == Some(name));
            if let Some(inst) = instance {
                let id = inst.get("id").and_then(|v| v.as_str()).unwrap_or(name);
                state
                    .pekohub_client
                    .delete_agent(id)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok("removed".to_string())
            } else {
                Err(format!("agent '{}' not found on remote runtime", name))
            }
        }
    }
}

// ------------------------------------------------------------------
// Tauri commands
// ------------------------------------------------------------------

#[tauri::command]
pub async fn agent_list(
    state: State<'_, AppState>,
    runtime_id: Option<String>,
) -> Result<Vec<AgentSummary>, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    dispatch_agent_list(&state, &rid).await
}

#[tauri::command]
pub async fn agent_show(
    state: State<'_, AppState>,
    name: String,
    runtime_id: Option<String>,
) -> Result<AgentDetail, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    dispatch_agent_show(&state, &rid, &name).await
}

#[tauri::command]
pub async fn agent_create(
    state: State<'_, AppState>,
    name: String,
    provider: String,
    model: String,
    runtime_id: Option<String>,
) -> Result<AgentDetail, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    dispatch_agent_create(&state, &rid, &name, &provider, &model).await
}

#[tauri::command]
pub async fn agent_remove(
    state: State<'_, AppState>,
    name: String,
    runtime_id: Option<String>,
) -> Result<String, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    dispatch_agent_remove(&state, &rid, &name).await
}

#[tauri::command]
pub async fn agent_export(
    state: State<'_, AppState>,
    name: String,
    path: String,
    runtime_id: Option<String>,
    with_extensions: Option<bool>,
) -> Result<String, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    let runtime = state
        .get_runtime(&rid)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", rid))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| e.to_string())?;
            let resp = client
                .export_agent(
                    &name,
                    Some(&path),
                    false,
                    with_extensions.unwrap_or(false),
                )
                .await
                .map_err(|e| e.to_string())?;
            if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
                return Err(resp
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string());
            }
            let output = resp
                .get("output_path")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            Ok(format!("Agent exported to {}", output))
        }
        crate::state::RuntimeConnectionType::Remote => {
            Err("Export is not supported for remote runtimes yet".to_string())
        }
    }
}

#[tauri::command]
pub async fn agent_update(
    state: State<'_, AppState>,
    name: String,
    payload: serde_json::Value,
    runtime_id: Option<String>,
) -> Result<AgentDetail, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    let runtime = state
        .get_runtime(&rid)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", rid))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| e.to_string())?;

            let model = payload
                .get("model")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty());
            let description = payload
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let system_prompt = payload
                .get("systemPrompt")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let config = payload.get("config").cloned();

            let update_resp = client
                .update_agent(
                    &name,
                    model,
                    description.as_deref(),
                    system_prompt.as_deref(),
                    config,
                )
                .await
                .map_err(|e| e.to_string())?;
            if update_resp.get("type").and_then(|v| v.as_str()) == Some("error") {
                return Err(update_resp
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string());
            }

            let value = client.get_agent(&name).await.map_err(|e| e.to_string())?;
            let agent = value
                .get("agent")
                .and_then(|v| parse_agent_detail(v, &rid))
                .ok_or_else(|| "agent not found".to_string())?;
            Ok(agent)
        }
        crate::state::RuntimeConnectionType::Remote => {
            Err("Agent update is not supported for remote runtimes yet".to_string())
        }
    }
}

#[tauri::command]
pub async fn agent_import(
    state: State<'_, AppState>,
    path: String,
    runtime_id: Option<String>,
) -> Result<String, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    let runtime = state
        .get_runtime(&rid)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", rid))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| e.to_string())?;
            let resp = client
                .import_agent(&path, None)
                .await
                .map_err(|e| e.to_string())?;
            if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
                return Err(resp
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string());
            }
            let name = resp
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            Ok(format!("Agent '{}' imported", name))
        }
        crate::state::RuntimeConnectionType::Remote => {
            Err("Import is not supported for remote runtimes yet".to_string())
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub display_name: String,
    pub api_type: String,
    pub default_model: String,
    pub requires_key: bool,
    pub is_local: bool,
}

#[tauri::command]
pub async fn agent_set_status(
    state: State<'_, AppState>,
    name: String,
    status: String,
    runtime_id: Option<String>,
) -> Result<String, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    let runtime = state
        .get_runtime(&rid)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", rid))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| e.to_string())?;
            let resp = client
                .set_instance_status(&name, &status)
                .await
                .map_err(|e| e.to_string())?;
            if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
                return Err(resp
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string());
            }
            Ok(format!("Agent '{}' status set to {}", name, status))
        }
        crate::state::RuntimeConnectionType::Remote => {
            let client = crate::clients::pekohub::PekohubClient::new()
                .with_base_url(runtime.pekohub_url.clone().unwrap_or_default());
            let instance_id = format!("{}:{}", runtime.id, name);
            client
                .update_instance_status(&instance_id, &status)
                .await
                .map_err(|e| e.to_string())?;
            Ok(format!("Agent '{}' status set to {}", name, status))
        }
    }
}

#[tauri::command]
pub async fn agent_set_exposure(
    state: State<'_, AppState>,
    name: String,
    exposure: String,
    runtime_id: Option<String>,
) -> Result<String, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    let runtime = state
        .get_runtime(&rid)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", rid))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| e.to_string())?;
            let resp = client
                .set_instance_exposure(&name, &exposure)
                .await
                .map_err(|e| e.to_string())?;
            if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
                return Err(resp
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string());
            }
            Ok(format!("Agent '{}' exposure set to {}", name, exposure))
        }
        crate::state::RuntimeConnectionType::Remote => {
            let client = crate::clients::pekohub::PekohubClient::new()
                .with_base_url(runtime.pekohub_url.clone().unwrap_or_default());
            let instance_id = format!("{}:{}", runtime.id, name);
            client
                .update_instance_exposure(&instance_id, &exposure, None)
                .await
                .map_err(|e| e.to_string())?;
            Ok(format!("Agent '{}' exposure set to {}", name, exposure))
        }
    }
}

#[tauri::command]
pub async fn provider_list(
    state: State<'_, AppState>,
    runtime_id: Option<String>,
) -> Result<Vec<ProviderInfo>, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    let runtime = state
        .get_runtime(&rid)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", rid))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| e.to_string())?;
            let value = client.list_providers().await.map_err(|e| e.to_string())?;
            if value.get("type").and_then(|v| v.as_str()) == Some("error") {
                return Err(value
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string());
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
        crate::state::RuntimeConnectionType::Remote => {
            Err("Provider list is not supported for remote runtimes yet".to_string())
        }
    }
}
