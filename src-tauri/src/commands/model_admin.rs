//! Tauri commands for the model-first catalog (RP6 + model-first migration).
//!
//! The desktop's model management surfaces call these so the UI can list
//! built-in presets, add a configured model, and edit/remove/test catalog
//! entries without shelling out. All commands proxy the model-first
//! `RequestPacket::{ModelList, ModelTemplates, ModelAdd, ModelUpdate,
//! ModelRemove, ModelTest, ModelReload}` variants over the runtime's Unix
//! datagram IPC.
//!
//! Field-name contract: the runtime emits snake_case fields (matching the
//! rest of the IPC envelope); the projections below rename to camelCase on
//! the JS side, matching the `ModelSummary` / `ModelPresetInfo` shapes the
//! TS frontend consumes.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Catalog-summary view of one configured model entry.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelSummary {
    pub id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    /// Short wire id: `"openai"` or `"anthropic"`.
    pub api_format: String,
    pub base_url: String,
    pub model_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_id: Option<String>,
    pub requires_key: bool,
    pub is_local: bool,
    pub enabled: bool,
}

/// One model declared by a built-in model preset.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelTemplateInfo {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
}

/// One built-in model preset.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelPresetInfo {
    pub id: String,
    pub display_name: String,
    /// `"openai"` or `"anthropic"`.
    pub api_type: String,
    pub base_url: String,
    pub requires_key: bool,
    pub default_model: String,
    pub models: Vec<ModelTemplateInfo>,
}

/// Result of live-testing a configured model.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelTestResult {
    pub id: String,
    pub ok: bool,
    pub message: String,
    pub latency_ms: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_used: Option<String>,
    pub tested_at: String,
}

/// JS-facing arguments for `model_add`. Converted to the snake_case JSON
/// shape the runtime expects before sending.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelAddArgs {
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub custom: bool,
    #[serde(default)]
    pub api_format: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub requires_key: Option<bool>,
    #[serde(default)]
    pub model: Vec<String>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub credential_id: Option<String>,
}

impl ModelAddArgs {
    /// Convert the JS-facing camelCase struct into the snake_case JSON
    /// shape the runtime's `ModelAddArgs` expects.
    fn into_runtime_value(self) -> serde_json::Value {
        let mut value = serde_json::json!({});
        if let Some(v) = self.template {
            value["template"] = v.into();
        }
        if let Some(v) = self.name {
            value["name"] = v.into();
        }
        if let Some(v) = self.display_name {
            value["display_name"] = v.into();
        }
        if self.custom {
            value["custom"] = true.into();
        }
        if let Some(v) = self.api_format {
            value["api_format"] = v.into();
        }
        if let Some(v) = self.base_url {
            value["base_url"] = v.into();
        }
        if let Some(v) = self.requires_key {
            value["requires_key"] = v.into();
        }
        if !self.model.is_empty() {
            value["model"] = self.model.into();
        }
        if let Some(v) = self.key {
            value["key"] = v.into();
        }
        if let Some(v) = self.credential_id {
            value["credential_id"] = v.into();
        }
        value
    }
}

/// JS-facing arguments for `model_update`. Converted to the snake_case JSON
/// shape the runtime expects before sending.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelUpdateArgs {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_key: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

impl ModelUpdateArgs {
    /// Convert the JS-facing camelCase struct into the snake_case JSON
    /// shape the runtime's `ModelUpdateArgs` expects.
    fn into_runtime_value(self) -> serde_json::Value {
        let mut value = serde_json::json!({ "id": self.id });
        if let Some(v) = self.display_name {
            value["display_name"] = v.into();
        }
        if let Some(v) = self.api_format {
            value["api_format"] = v.into();
        }
        if let Some(v) = self.base_url {
            value["base_url"] = v.into();
        }
        if let Some(v) = self.model_id {
            value["model_id"] = v.into();
        }
        if let Some(v) = self.context_window {
            value["context_window"] = v.into();
        }
        if let Some(v) = self.max_output_tokens {
            value["max_output_tokens"] = v.into();
        }
        if let Some(headers) = self.headers {
            value["headers"] = serde_json::Value::Object(
                headers.into_iter().map(|(k, v)| (k, v.into())).collect(),
            );
        }
        if let Some(v) = self.credential_id {
            value["credential_id"] = v.into();
        }
        if let Some(v) = self.requires_key {
            value["requires_key"] = v.into();
        }
        if let Some(v) = self.enabled {
            value["enabled"] = v.into();
        }
        value
    }
}

/// If a runtime response is an error packet, surface its message.
fn check_runtime_error(resp: &serde_json::Value) -> Result<(), String> {
    if resp.get("type").and_then(|t| t.as_str()) == Some("error") {
        let msg = resp
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("runtime error")
            .to_string();
        return Err(msg);
    }
    Ok(())
}

fn project_model(m: &serde_json::Value) -> Option<ModelSummary> {
    let headers = m
        .get("headers")
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                .collect()
        })
        .unwrap_or_default();

    Some(ModelSummary {
        id: m.get("id")?.as_str()?.to_string(),
        display_name: m
            .get("display_name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        template_id: m
            .get("template_id")
            .and_then(|v| v.as_str())
            .map(std::string::ToString::to_string),
        api_format: m
            .get("api_format")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        base_url: m
            .get("base_url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        model_id: m
            .get("model_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        context_window: m
            .get("context_window")
            .and_then(|v| v.as_u64())
            .and_then(|n| u32::try_from(n).ok()),
        max_output_tokens: m
            .get("max_output_tokens")
            .and_then(|v| v.as_u64())
            .and_then(|n| u32::try_from(n).ok()),
        headers,
        credential_id: m
            .get("credential_id")
            .and_then(|v| v.as_str())
            .map(std::string::ToString::to_string),
        requires_key: m
            .get("requires_key")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        is_local: m.get("is_local").and_then(|v| v.as_bool()).unwrap_or(false),
        enabled: m.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
    })
}

fn project_model_template(m: &serde_json::Value) -> Option<ModelTemplateInfo> {
    Some(ModelTemplateInfo {
        id: m.get("id")?.as_str()?.to_string(),
        display_name: m
            .get("display_name")
            .and_then(|v| v.as_str())
            .map(std::string::ToString::to_string),
        context_length: m
            .get("context_length")
            .and_then(|v| v.as_u64())
            .and_then(|n| u32::try_from(n).ok()),
        max_output_tokens: m
            .get("max_output_tokens")
            .and_then(|v| v.as_u64())
            .and_then(|n| u32::try_from(n).ok()),
    })
}

fn project_preset(p: &serde_json::Value) -> Option<ModelPresetInfo> {
    let models = p
        .get("models")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(project_model_template).collect())
        .unwrap_or_default();

    Some(ModelPresetInfo {
        id: p.get("id")?.as_str()?.to_string(),
        display_name: p
            .get("display_name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        api_type: p
            .get("api_type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        base_url: p
            .get("base_url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        requires_key: p
            .get("requires_key")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        default_model: p
            .get("default_model")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        models,
    })
}

fn project_model_tested(value: &serde_json::Value) -> Option<ModelTestResult> {
    Some(ModelTestResult {
        id: value.get("id")?.as_str()?.to_string(),
        ok: value.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
        message: value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        latency_ms: value
            .get("latency_ms")
            .and_then(|v| v.as_u64())
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(0),
        http_status: value
            .get("http_status")
            .and_then(|v| v.as_u64())
            .and_then(|n| u16::try_from(n).ok()),
        model_used: value
            .get("model_used")
            .and_then(|v| v.as_str())
            .map(std::string::ToString::to_string),
        tested_at: value
            .get("tested_at")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

/// List configured models from the runtime catalog.
#[tauri::command]
pub async fn model_list() -> Result<Vec<ModelSummary>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .model_list()
        .await
        .map_err(|e| format!("model_list failed: {e}"))?;
    check_runtime_error(&value)?;
    let models = value
        .get("models")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(project_model).collect())
        .unwrap_or_default();
    Ok(models)
}

/// List the built-in model presets the runtime ships with.
#[tauri::command]
pub async fn model_templates() -> Result<Vec<ModelPresetInfo>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .model_templates()
        .await
        .map_err(|e| format!("model_templates failed: {e}"))?;
    check_runtime_error(&value)?;
    let presets = value
        .get("presets")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(project_preset).collect())
        .unwrap_or_default();
    Ok(presets)
}

/// Add a model to the runtime catalog.
#[tauri::command]
pub async fn model_add(args: ModelAddArgs) -> Result<ModelSummary, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let payload = args.into_runtime_value();
    let value = client
        .model_add(payload)
        .await
        .map_err(|e| format!("model_add failed: {e}"))?;
    check_runtime_error(&value)?;
    project_model(value.get("model").unwrap_or(&serde_json::Value::Null))
        .ok_or_else(|| "model_add response missing `model`".to_string())
}

/// Update an existing configured model.
#[tauri::command]
pub async fn model_update(args: ModelUpdateArgs) -> Result<ModelSummary, String> {
    if args.id.is_empty() {
        return Err("model id must not be empty".to_string());
    }

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let payload = args.into_runtime_value();
    let value = client
        .model_update(payload)
        .await
        .map_err(|e| format!("model_update failed: {e}"))?;
    check_runtime_error(&value)?;
    project_model(value.get("model").unwrap_or(&serde_json::Value::Null))
        .ok_or_else(|| "model_update response missing `model`".to_string())
}

/// Remove a configured model from the runtime catalog.
#[tauri::command]
pub async fn model_remove(id: String) -> Result<bool, String> {
    if id.is_empty() {
        return Err("model id must not be empty".to_string());
    }

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .model_remove(&id)
        .await
        .map_err(|e| format!("model_remove failed: {e}"))?;
    check_runtime_error(&value)?;
    Ok(value
        .get("removed")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

/// Live-test a configured model.
#[tauri::command]
pub async fn model_test(id: String) -> Result<ModelTestResult, String> {
    if id.is_empty() {
        return Err("model id must not be empty".to_string());
    }

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .model_test(&id)
        .await
        .map_err(|e| format!("model_test failed: {e}"))?;
    check_runtime_error(&value)?;
    project_model_tested(&value)
        .ok_or_else(|| "model_test response missing required fields".to_string())
}

/// Re-read the model catalog and credential vault from disk.
#[tauri::command]
pub async fn model_reload() -> Result<(usize, usize), String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .model_reload()
        .await
        .map_err(|e| format!("model_reload failed: {e}"))?;
    check_runtime_error(&value)?;
    let models_count = value
        .get("models_count")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(0);
    let keys_count = value
        .get("keys_count")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(0);
    Ok((models_count, keys_count))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_add_args_converts_to_runtime_snake_case() {
        let args = ModelAddArgs {
            template: Some("anthropic".to_string()),
            name: Some("my-claude".to_string()),
            display_name: Some("My Claude".to_string()),
            custom: false,
            api_format: None,
            base_url: None,
            requires_key: Some(true),
            model: vec!["claude-3-5-haiku-latest".to_string()],
            key: Some("secret".to_string()),
            credential_id: None,
        };
        let value = args.into_runtime_value();
        assert_eq!(value["template"].as_str(), Some("anthropic"));
        assert_eq!(value["name"].as_str(), Some("my-claude"));
        assert_eq!(value["display_name"].as_str(), Some("My Claude"));
        assert_eq!(value["requires_key"].as_bool(), Some(true));
        assert_eq!(value["model"].as_array().map(|a| a.len()), Some(1));
        assert_eq!(value["key"].as_str(), Some("secret"));
        // camelCase keys must not leak into the runtime payload.
        assert!(value.get("displayName").is_none());
        assert!(value.get("apiFormat").is_none());
    }

    #[test]
    fn model_update_args_converts_all_fields() {
        let args = ModelUpdateArgs {
            id: "claude-haiku".to_string(),
            display_name: Some("Claude Haiku (edited)".to_string()),
            api_format: Some("anthropic_messages".to_string()),
            base_url: Some("https://api.anthropic.com".to_string()),
            model_id: Some("claude-3-5-haiku-latest".to_string()),
            context_window: Some(200000),
            max_output_tokens: Some(4096),
            headers: Some(BTreeMap::from([(
                "Anthropic-Version".to_string(),
                "2023-06-01".to_string(),
            )])),
            credential_id: Some("cred-1".to_string()),
            requires_key: Some(true),
            enabled: Some(false),
        };
        let value = args.into_runtime_value();
        assert_eq!(value["id"].as_str(), Some("claude-haiku"));
        assert_eq!(
            value["display_name"].as_str(),
            Some("Claude Haiku (edited)")
        );
        assert_eq!(value["api_format"].as_str(), Some("anthropic_messages"));
        assert_eq!(
            value["base_url"].as_str(),
            Some("https://api.anthropic.com")
        );
        assert_eq!(value["model_id"].as_str(), Some("claude-3-5-haiku-latest"));
        assert_eq!(value["context_window"].as_u64(), Some(200000));
        assert_eq!(value["max_output_tokens"].as_u64(), Some(4096));
        assert_eq!(value["credential_id"].as_str(), Some("cred-1"));
        assert_eq!(value["enabled"].as_bool(), Some(false));

        let headers = value["headers"].as_object().expect("headers object");
        assert_eq!(
            headers.get("Anthropic-Version").and_then(|v| v.as_str()),
            Some("2023-06-01")
        );

        // camelCase keys must not leak into the runtime payload.
        assert!(value.get("displayName").is_none());
        assert!(value.get("modelId").is_none());
    }

    #[test]
    fn model_update_args_omits_none_fields() {
        let args = ModelUpdateArgs {
            id: "openai".to_string(),
            ..Default::default()
        };
        let value = args.into_runtime_value();
        assert!(value["display_name"].is_null());
    }

    #[test]
    fn project_model_maps_runtime_snake_case() {
        let value = serde_json::json!({
            "id": "claude-haiku",
            "display_name": "Claude Haiku",
            "template_id": "anthropic",
            "api_format": "anthropic",
            "base_url": "https://api.anthropic.com",
            "model_id": "claude-3-5-haiku-latest",
            "context_window": 200000u64,
            "max_output_tokens": 4096u64,
            "headers": { "Anthropic-Version": "2023-06-01" },
            "credential_id": "cred-1",
            "requires_key": true,
            "is_local": false,
            "enabled": true,
        });
        let m = project_model(&value).expect("should project");
        assert_eq!(m.id, "claude-haiku");
        assert_eq!(m.template_id.as_deref(), Some("anthropic"));
        assert_eq!(m.api_format, "anthropic");
        assert_eq!(m.model_id, "claude-3-5-haiku-latest");
        assert_eq!(m.context_window, Some(200000));
        assert_eq!(m.max_output_tokens, Some(4096));
        assert_eq!(m.credential_id.as_deref(), Some("cred-1"));
        assert!(m.enabled);
    }

    #[test]
    fn project_model_missing_id_returns_none() {
        let value = serde_json::json!({ "display_name": "No id" });
        assert!(project_model(&value).is_none());
    }

    #[test]
    fn project_preset_maps_models() {
        let value = serde_json::json!({
            "id": "anthropic",
            "display_name": "Anthropic",
            "api_type": "anthropic",
            "base_url": "https://api.anthropic.com",
            "requires_key": true,
            "default_model": "claude-3-5-haiku-latest",
            "models": [
                {
                    "id": "claude-3-5-haiku-latest",
                    "display_name": "Claude 3.5 Haiku",
                    "context_length": 200000,
                    "max_output_tokens": 4096
                }
            ]
        });
        let p = project_preset(&value).expect("should project");
        assert_eq!(p.id, "anthropic");
        assert_eq!(p.api_type, "anthropic");
        assert_eq!(p.default_model, "claude-3-5-haiku-latest");
        assert_eq!(p.models.len(), 1);
        let mt = p.models.first().unwrap();
        assert_eq!(mt.id, "claude-3-5-haiku-latest");
        assert_eq!(mt.context_length, Some(200000));
    }

    #[test]
    fn project_model_tested_maps_all_fields() {
        let value = serde_json::json!({
            "id": "claude-haiku",
            "ok": true,
            "message": "ok",
            "latency_ms": 123u64,
            "http_status": 200u64,
            "model_used": "claude-3-5-haiku-latest",
            "tested_at": "2026-07-16T00:00:00Z",
        });
        let r = project_model_tested(&value).expect("should project");
        assert_eq!(r.id, "claude-haiku");
        assert!(r.ok);
        assert_eq!(r.message, "ok");
        assert_eq!(r.latency_ms, 123);
        assert_eq!(r.http_status, Some(200));
        assert_eq!(r.model_used.as_deref(), Some("claude-3-5-haiku-latest"));
        assert_eq!(r.tested_at, "2026-07-16T00:00:00Z");
    }
}
