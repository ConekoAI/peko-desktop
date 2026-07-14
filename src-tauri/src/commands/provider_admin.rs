//! Tauri commands for `provider_templates` + `provider_add` (T-109b).
//!
//! The desktop's "Add Provider" modal calls these so the picker
//! can list built-in templates and add a new provider to the
//! runtime catalog without shelling out. Both commands proxy
//! `RequestPacket::ProviderTemplates` / `RequestPacket::ProviderAdd`
//! over the runtime's Unix datagram IPC.
//!
//! Field-name contract: the runtime emits snake_case fields
//! (matching the rest of the IPC envelope); the projections below
//! rename to camelCase on the JS side, matching the existing
//! `ProviderInfo` shape (PR #187) and the F6/F7 convention for
//! Tauri commands that cross the JS boundary. See
//! `peko-runtime/src/ipc/packet.rs` for the runtime side.

use serde::{Deserialize, Serialize};

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
pub async fn provider_add(args: ProviderAddArgs) -> Result<serde_json::Value, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let payload =
        serde_json::to_value(&args).map_err(|e| format!("failed to serialize args: {e}"))?;
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
    // Forward the `provider` object directly — the modal reads
    // `id` and re-fetches the catalog via `useProviders()` so the
    // full provider list refreshes, but having `provider` in the
    // response lets callers skip the round-trip if they want.
    Ok(value
        .get("provider")
        .cloned()
        .unwrap_or(serde_json::Value::Null))
}
