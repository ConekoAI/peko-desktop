//! Tauri commands for provider catalog administration (T-109b + RP6).
//!
//! The desktop's provider management surfaces call these so the UI can
//! list built-in templates, add a provider, and (RP6) edit/remove
//! catalog entries and promote a default without shelling out. All
//! commands proxy `RequestPacket::{ProviderTemplates, ProviderAdd,
//! ProviderUpdate, ProviderRemove, ProviderSetDefault}` over the
//! runtime's Unix datagram IPC.
//!
//! Field-name contract: the runtime emits snake_case fields (matching
//! the rest of the IPC envelope); the projections below rename to
//! camelCase on the JS side, matching the existing `ProviderInfo` shape
//! (PR #187) and the F6/F7 convention for Tauri commands that cross
//! the JS boundary. See `peko-runtime/src/ipc/packet.rs` for the
//! runtime side.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::commands::principal::{project_provider, ModelInfo, ProviderInfo};

/// One model declared by a built-in provider template. Owned +
/// camelCase projection of `peko_runtime::ipc::packet::ModelTemplateInfo`.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelTemplate {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
}

/// One built-in provider template. Owned + camelCase projection
/// of `peko_runtime::ipc::packet::ProviderTemplateInfo`.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTemplate {
    pub id: String,
    pub display_name: String,
    /// `"openai"` or `"anthropic"` — matches `ProviderInfo::api_type`
    /// and the underlying `ApiFormat` enum's snake-case wire ids.
    pub api_type: String,
    /// Empty string for templates where the user must supply a
    /// deployment URL (e.g. `azure-openai`).
    pub base_url: String,
    pub requires_key: bool,
    pub default_model: String,
    pub models: Vec<ModelTemplate>,
}

/// Mirror of the runtime's `ProviderAddArgs` so the Tauri command
/// can accept the full payload as a single struct parameter. All
/// fields are optional / defaultable so the modal can send a bare
/// `{}` payload and let the runtime's bare-invocation guard reject
/// it with a clear error message (T-109b symmetry rule).
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAddArgs {
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
    pub set_default: Option<bool>,
    #[serde(default)]
    pub default_model: Option<String>,
}

impl ProviderAddArgs {
    /// Convert the JS-facing camelCase struct into the snake_case JSON
    /// shape the runtime's `ProviderAddArgs` expects.
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
        if let Some(v) = self.set_default {
            value["set_default"] = v.into();
        }
        if let Some(v) = self.default_model {
            value["default_model"] = v.into();
        }
        value
    }
}

/// RP6: Arguments for `provider_update`. Every field except `id` is
/// optional; omitted fields leave the existing catalog entry untouched.
/// The JS surface is camelCase; `into_runtime_value` rewrites to the
/// snake_case shape the runtime expects.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUpdateArgs {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<ModelInfo>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_key: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

impl ProviderUpdateArgs {
    /// Convert the JS-facing camelCase struct into the snake_case JSON
    /// shape the runtime's `ProviderUpdateArgs` expects.
    fn into_runtime_value(self) -> serde_json::Value {
        let mut value = serde_json::json!({ "id": self.id });
        if let Some(v) = self.display_name {
            value["display_name"] = v.into();
        }
        if let Some(v) = self.base_url {
            value["base_url"] = v.into();
        }
        if let Some(v) = self.api_format {
            value["api_format"] = v.into();
        }
        if let Some(models) = self.models {
            value["models"] = serde_json::Value::Array(
                models
                    .into_iter()
                    .map(|m| {
                        let mut obj = serde_json::json!({ "id": m.id });
                        if let Some(v) = m.display_name {
                            obj["display_name"] = v.into();
                        }
                        if let Some(v) = m.context_length {
                            obj["context_length"] = v.into();
                        }
                        if let Some(v) = m.max_output_tokens {
                            obj["max_output_tokens"] = v.into();
                        }
                        if !m.capabilities.is_empty() {
                            obj["capabilities"] = m.capabilities.into();
                        }
                        obj
                    })
                    .collect(),
            );
        }
        if let Some(v) = self.default_model_id {
            value["default_model_id"] = v.into();
        }
        if let Some(headers) = self.headers {
            value["headers"] = serde_json::Value::Object(
                headers.into_iter().map(|(k, v)| (k, v.into())).collect(),
            );
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

/// RP6: Result of promoting a provider+model to the runtime default.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDefaultSetResult {
    pub provider: String,
    pub model: String,
}

/// List the built-in provider templates the runtime ships with.
/// Mirrors the runtime IPC `RequestPacket::ProviderTemplates` →
/// `ResponsePacket::ProviderTemplates { providers }`.
#[tauri::command]
pub async fn provider_templates() -> Result<Vec<ProviderTemplate>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .provider_templates()
        .await
        .map_err(|e| format!("provider_templates failed: {e}"))?;
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
                    let models = p
                        .get("models")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|m| {
                                    Some(ModelTemplate {
                                        id: m.get("id")?.as_str()?.to_string(),
                                        display_name: m
                                            .get("display_name")
                                            .and_then(|v| v.as_str())
                                            .map(str::to_string),
                                        context_length: m
                                            .get("context_length")
                                            .and_then(|v| v.as_u64())
                                            .and_then(|n| u32::try_from(n).ok()),
                                        max_output_tokens: m
                                            .get("max_output_tokens")
                                            .and_then(|v| v.as_u64())
                                            .and_then(|n| u32::try_from(n).ok()),
                                    })
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    Some(ProviderTemplate {
                        id: p.get("id")?.as_str()?.to_string(),
                        display_name: p.get("display_name")?.as_str()?.to_string(),
                        api_type: p.get("api_type")?.as_str()?.to_string(),
                        base_url: p.get("base_url")?.as_str()?.to_string(),
                        requires_key: p
                            .get("requires_key")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(true),
                        default_model: p.get("default_model")?.as_str()?.to_string(),
                        models,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(providers)
}

/// Add a provider to the runtime catalog. Mirrors
/// `RequestPacket::ProviderAdd { args }` →
/// `ResponsePacket::ProviderAdded { provider }`. On error, the
/// runtime's `ResponsePacket::Error` message is forwarded as the
/// Tauri command error so the modal renders the same string the
/// CLI's `peko provider add` would print.
#[tauri::command]
pub async fn provider_add(args: ProviderAddArgs) -> Result<ProviderInfo, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let payload = args.into_runtime_value();
    let value = client
        .provider_add(payload)
        .await
        .map_err(|e| format!("provider_add failed: {e}"))?;
    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }
    project_provider(value.get("provider").unwrap_or(&serde_json::Value::Null))
        .ok_or_else(|| "provider_add response missing `provider`".to_string())
}

/// RP6: Update an existing provider catalog entry. Mirrors
/// `RequestPacket::ProviderUpdate { args }` →
/// `ResponsePacket::ProviderUpdated { provider }`.
#[tauri::command]
pub async fn provider_update(args: ProviderUpdateArgs) -> Result<ProviderInfo, String> {
    if args.id.is_empty() {
        return Err("provider id must not be empty".to_string());
    }

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let payload = args.into_runtime_value();
    let value = client
        .provider_update(payload)
        .await
        .map_err(|e| format!("provider_update failed: {e}"))?;
    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }
    project_provider(value.get("provider").unwrap_or(&serde_json::Value::Null))
        .ok_or_else(|| "provider_update response missing `provider`".to_string())
}

/// RP6: Remove a provider from the runtime catalog. Mirrors
/// `RequestPacket::ProviderRemove { id }` →
/// `ResponsePacket::ProviderRemoved { id, removed }`.
#[tauri::command]
pub async fn provider_remove(id: String) -> Result<bool, String> {
    if id.is_empty() {
        return Err("provider id must not be empty".to_string());
    }

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .provider_remove(&id)
        .await
        .map_err(|e| format!("provider_remove failed: {e}"))?;
    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }
    Ok(value
        .get("removed")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

/// RP6: Promote a provider (and optionally a specific model) to the
/// runtime default. Mirrors `RequestPacket::ProviderSetDefault` →
/// `ResponsePacket::ProviderDefaultSet { provider, model }`.
#[tauri::command]
pub async fn provider_set_default(
    provider: String,
    model: Option<String>,
) -> Result<ProviderDefaultSetResult, String> {
    if provider.is_empty() {
        return Err("provider id must not be empty".to_string());
    }

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .provider_set_default(&provider, model.as_deref())
        .await
        .map_err(|e| format!("provider_set_default failed: {e}"))?;
    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }
    let provider_out = value
        .get("provider")
        .and_then(|v| v.as_str())
        .ok_or("provider_set_default response missing `provider`")?
        .to_string();
    let model_out = value
        .get("model")
        .and_then(|v| v.as_str())
        .ok_or("provider_set_default response missing `model`")?
        .to_string();
    Ok(ProviderDefaultSetResult {
        provider: provider_out,
        model: model_out,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_add_args_converts_to_runtime_snake_case() {
        let args = ProviderAddArgs {
            template: None,
            name: Some("my-openai".to_string()),
            display_name: Some("My OpenAI".to_string()),
            custom: true,
            api_format: Some("openai_completions".to_string()),
            base_url: Some("https://api.openai.com".to_string()),
            requires_key: Some(true),
            model: vec!["gpt-4o".to_string()],
            key: Some("secret".to_string()),
            set_default: Some(true),
            default_model: Some("gpt-4o".to_string()),
        };
        let value = args.into_runtime_value();
        assert_eq!(value["name"].as_str(), Some("my-openai"));
        assert_eq!(value["display_name"].as_str(), Some("My OpenAI"));
        assert_eq!(value["api_format"].as_str(), Some("openai_completions"));
        assert_eq!(value["base_url"].as_str(), Some("https://api.openai.com"));
        assert_eq!(value["requires_key"].as_bool(), Some(true));
        assert_eq!(value["set_default"].as_bool(), Some(true));
        assert_eq!(value["default_model"].as_str(), Some("gpt-4o"));
        // camelCase keys must not leak into the runtime payload.
        assert!(value.get("displayName").is_none());
        assert!(value.get("apiFormat").is_none());
    }

    #[test]
    fn provider_update_args_converts_nested_models_and_headers() {
        let args = ProviderUpdateArgs {
            id: "openai".to_string(),
            display_name: Some("OpenAI (edited)".to_string()),
            base_url: None,
            api_format: Some("openai_completions".to_string()),
            models: Some(vec![ModelInfo {
                id: "gpt-4o".to_string(),
                display_name: Some("GPT-4o".to_string()),
                context_length: Some(128000),
                max_output_tokens: Some(4096),
                capabilities: vec!["tool_use".to_string(), "vision".to_string()],
            }]),
            default_model_id: Some("gpt-4o".to_string()),
            headers: Some(BTreeMap::from([(
                "OpenAI-Organization".to_string(),
                "org-123".to_string(),
            )])),
            requires_key: None,
            enabled: Some(false),
        };
        let value = args.into_runtime_value();
        assert_eq!(value["id"].as_str(), Some("openai"));
        assert_eq!(value["display_name"].as_str(), Some("OpenAI (edited)"));
        assert_eq!(value["api_format"].as_str(), Some("openai_completions"));
        assert_eq!(value["default_model_id"].as_str(), Some("gpt-4o"));
        assert_eq!(value["enabled"].as_bool(), Some(false));

        let models = value["models"].as_array().expect("models array");
        let first = models.first().unwrap();
        assert_eq!(first["id"].as_str(), Some("gpt-4o"));
        assert_eq!(first["context_length"].as_u64(), Some(128000));
        assert_eq!(first["capabilities"].as_array().map(|a| a.len()), Some(2));

        let headers = value["headers"].as_object().expect("headers object");
        assert_eq!(
            headers.get("OpenAI-Organization").and_then(|v| v.as_str()),
            Some("org-123")
        );

        // camelCase keys must not leak into the runtime payload.
        assert!(value.get("displayName").is_none());
        assert!(value.get("defaultModelId").is_none());
    }

    #[test]
    fn provider_update_args_omits_none_fields() {
        let args = ProviderUpdateArgs {
            id: "openai".to_string(),
            ..Default::default()
        };
        let value = args.into_runtime_value();
        assert!(value["display_name"].is_null());
        // The runtime treats null optional fields as omitted, so this is fine.
    }
}
