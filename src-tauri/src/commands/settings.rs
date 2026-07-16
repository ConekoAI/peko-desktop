use std::path::PathBuf;

fn config_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|d| d.join(".peko").join("config.toml"))
        .ok_or_else(|| "could not determine home directory".to_string())
}

fn read_config() -> Result<toml::Table, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(toml::Table::new());
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("failed to read config: {}", e))?;
    content
        .parse::<toml::Table>()
        .map_err(|e| format!("failed to parse config: {}", e))
}

fn write_config(table: &toml::Table) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create config directory: {}", e))?;
    }
    let content =
        toml::to_string_pretty(table).map_err(|e| format!("failed to serialize config: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("failed to write config: {}", e))
}

fn get_nested(table: &toml::Table, key: &str) -> Option<String> {
    let parts: Vec<&str> = key.split('.').collect();
    let mut current = toml::Value::Table(table.clone());
    for part in &parts {
        match current {
            toml::Value::Table(mut t) => {
                current = t.remove(*part)?;
            }
            _ => return None,
        }
    }
    match current {
        toml::Value::String(s) => Some(s),
        other => Some(other.to_string()),
    }
}

fn set_nested(table: &mut toml::Table, key: &str, value: &str) {
    let parts: Vec<&str> = key.split('.').collect();
    let mut current = table;
    for (i, part) in parts.iter().enumerate() {
        if i == parts.len() - 1 {
            current.insert(part.to_string(), toml::Value::String(value.to_string()));
            return;
        }
        // Ensure the entry is a table, then get a mutable reference to it.
        if !matches!(current.get(*part), Some(toml::Value::Table(_))) {
            current.insert(part.to_string(), toml::Value::Table(toml::Table::new()));
        }
        let next = current.get_mut(*part).unwrap();
        match next {
            toml::Value::Table(ref mut t) => current = t,
            _ => unreachable!(),
        }
    }
}

#[cfg(test)]
mod config_tests {
    use super::*;

    #[test]
    fn test_get_nested_flat_key() {
        let mut table = toml::Table::new();
        table.insert("name".to_string(), toml::Value::String("peko".to_string()));
        assert_eq!(get_nested(&table, "name"), Some("peko".to_string()));
    }

    #[test]
    fn test_get_nested_dotted_key() {
        let mut table = toml::Table::new();
        let mut inner = toml::Table::new();
        inner.insert("key".to_string(), toml::Value::String("secret".to_string()));
        table.insert("provider".to_string(), toml::Value::Table(inner));
        assert_eq!(
            get_nested(&table, "provider.key"),
            Some("secret".to_string())
        );
    }

    #[test]
    fn test_get_nested_missing_returns_none() {
        let table = toml::Table::new();
        assert_eq!(get_nested(&table, "missing"), None);
    }

    #[test]
    fn test_get_nested_non_string_value() {
        let mut table = toml::Table::new();
        table.insert("count".to_string(), toml::Value::Integer(42));
        assert_eq!(get_nested(&table, "count"), Some("42".to_string()));
    }

    #[test]
    fn test_set_nested_creates_intermediate_tables() {
        let mut table = toml::Table::new();
        set_nested(&mut table, "a.b.c", "value");
        assert_eq!(get_nested(&table, "a.b.c"), Some("value".to_string()));
    }

    #[test]
    fn test_set_nested_overwrites_existing() {
        let mut table = toml::Table::new();
        set_nested(&mut table, "x", "old");
        set_nested(&mut table, "x", "new");
        assert_eq!(get_nested(&table, "x"), Some("new".to_string()));
    }

    #[test]
    fn test_settings_list_flattens_nested_table() {
        let mut table = toml::Table::new();
        let mut inner = toml::Table::new();
        inner.insert(
            "host".to_string(),
            toml::Value::String("localhost".to_string()),
        );
        inner.insert("port".to_string(), toml::Value::Integer(8080));
        table.insert("server".to_string(), toml::Value::Table(inner));
        table.insert("debug".to_string(), toml::Value::Boolean(true));

        // We can't easily call settings_list() because it reads from disk,
        // so test the flatten logic directly by mirroring its behaviour.
        let mut settings = Vec::new();
        fn flatten_table(prefix: &str, table: &toml::Table, out: &mut Vec<Setting>) {
            for (key, value) in table.iter() {
                let full_key = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{}.{}", prefix, key)
                };
                match value {
                    toml::Value::Table(t) => flatten_table(&full_key, t, out),
                    _ => {
                        out.push(Setting {
                            key: full_key,
                            value: value.to_string().trim_matches('"').to_string(),
                            default_value: None,
                            description: None,
                            category: "general".to_string(),
                        });
                    }
                }
            }
        }
        flatten_table("", &table, &mut settings);

        assert_eq!(settings.len(), 3);
        let keys: Vec<String> = settings.iter().map(|s| s.key.clone()).collect();
        assert!(keys.contains(&"server.host".to_string()));
        assert!(keys.contains(&"server.port".to_string()));
        assert!(keys.contains(&"debug".to_string()));

        let debug = settings.iter().find(|s| s.key == "debug").unwrap();
        assert_eq!(debug.value, "true");
    }
}

#[tauri::command]
pub fn settings_get(key: String) -> Result<Option<String>, String> {
    let table = read_config()?;
    Ok(get_nested(&table, &key))
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct Setting {
    pub key: String,
    pub value: String,
    pub default_value: Option<String>,
    pub description: Option<String>,
    pub category: String,
}

#[tauri::command]
pub fn settings_list() -> Result<Vec<Setting>, String> {
    let table = read_config()?;
    let mut settings = Vec::new();
    fn flatten_table(prefix: &str, table: &toml::Table, out: &mut Vec<Setting>) {
        for (key, value) in table.iter() {
            let full_key = if prefix.is_empty() {
                key.clone()
            } else {
                format!("{}.{}", prefix, key)
            };
            match value {
                toml::Value::Table(t) => flatten_table(&full_key, t, out),
                _ => {
                    out.push(Setting {
                        key: full_key,
                        value: value.to_string().trim_matches('"').to_string(),
                        default_value: None,
                        description: None,
                        category: "general".to_string(),
                    });
                }
            }
        }
    }
    flatten_table("", &table, &mut settings);
    Ok(settings)
}

#[tauri::command]
pub fn settings_set(key: String, value: String) -> Result<(), String> {
    let mut table = read_config()?;
    set_nested(&mut table, &key, &value);
    write_config(&table)
}

// ─── Credential / binding helpers ─────────────────────────────────

/// Build the provider namespace for the default API-key slot.
fn provider_namespace(provider: &str) -> String {
    format!("provider:{provider}")
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

/// Resolve the default credential id for a provider by listing its
/// `provider:<provider>` namespace and picking the `default` name row.
async fn find_default_credential_id(
    client: &crate::ipc::IpcClient,
    provider: &str,
) -> Result<Option<String>, String> {
    let namespace = provider_namespace(provider);
    let resp = client
        .credential_list(Some(&namespace), Some("api_key"))
        .await
        .map_err(|e| e.to_string())?;
    check_runtime_error(&resp)?;
    Ok(resp
        .get("providers")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            arr.iter().find_map(|row| {
                let name = row.get("name").and_then(|n| n.as_str())?;
                if name == "default" {
                    row.get("id").and_then(|id| id.as_str()).map(String::from)
                } else {
                    None
                }
            })
        }))
}

// ─── Provider-keyed credential adapters (current UI) ──────────────

/// Reveal the raw secret material for a provider's default credential.
/// Audit-logged by the runtime.
#[tauri::command]
pub async fn credential_get_raw(provider: String) -> Result<Option<String>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    match find_default_credential_id(&client, &provider).await? {
        Some(id) => {
            let resp = client
                .credential_get_material(&id, "desktop provider-keyed raw reveal")
                .await
                .map_err(|e| e.to_string())?;
            check_runtime_error(&resp)?;
            Ok(resp
                .get("material")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()))
        }
        None => Ok(None),
    }
}

/// Store a raw secret for a provider at `provider:<provider>/default`
/// as an OAuth token. Used by the PekoHub OAuth flow.
#[tauri::command]
pub async fn credential_set_raw(provider: String, raw_value: String) -> Result<(), String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    let namespace = provider_namespace(&provider);
    let resp = client
        .credential_set(&namespace, "default", "oauth_token", &raw_value, None)
        .await
        .map_err(|e| e.to_string())?;
    check_runtime_error(&resp)?;
    Ok(())
}

// ─── Generic credential commands (RP4) ────────────────────────────

/// Full credential record returned by the generic commands.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CredentialDetail {
    pub id: String,
    pub namespace: String,
    pub name: String,
    pub kind: String,
    #[serde(alias = "has_key")]
    pub has_key: bool,
    #[serde(alias = "last_tested_at")]
    pub last_tested_at: Option<String>,
    #[serde(alias = "last_tested_ok")]
    pub last_tested_ok: Option<bool>,
    #[serde(default)]
    pub system_owned: bool,
    #[serde(default)]
    pub metadata: serde_json::Value,
    #[serde(alias = "created_at")]
    pub created_at: Option<String>,
    #[serde(alias = "updated_at")]
    pub updated_at: Option<String>,
}

#[tauri::command]
pub async fn credential_get_by_id(id: String) -> Result<CredentialDetail, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    let resp = client
        .credential_get(&id)
        .await
        .map_err(|e| e.to_string())?;
    check_runtime_error(&resp)?;
    let credential = resp
        .get("credential")
        .ok_or_else(|| "missing credential in response".to_string())?;
    serde_json::from_value(credential.clone())
        .map_err(|e| format!("failed to parse credential: {e}"))
}

#[tauri::command]
pub async fn credential_get_material(id: String, reason: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    let resp = client
        .credential_get_material(&id, &reason)
        .await
        .map_err(|e| e.to_string())?;
    check_runtime_error(&resp)?;
    resp.get("material")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "missing material in response".to_string())
}

#[tauri::command]
pub async fn credential_set_generic(
    namespace: String,
    name: String,
    kind: String,
    material: String,
    metadata: Option<serde_json::Value>,
) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    let resp = client
        .credential_set(&namespace, &name, &kind, &material, metadata)
        .await
        .map_err(|e| e.to_string())?;
    check_runtime_error(&resp)?;
    resp.get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "missing id in credential_set response".to_string())
}

#[tauri::command]
pub async fn credential_delete_by_id(id: String) -> Result<(), String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    let resp = client
        .credential_delete(&id)
        .await
        .map_err(|e| e.to_string())?;
    check_runtime_error(&resp)?;
    Ok(())
}

#[tauri::command]
pub async fn credential_list_generic(
    namespace: Option<String>,
    kind: Option<String>,
) -> Result<Vec<CredentialDetail>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    let resp = client
        .credential_list(namespace.as_deref(), kind.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    check_runtime_error(&resp)?;
    Ok(resp
        .get("providers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                .collect()
        })
        .unwrap_or_default())
}

// ─── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod credential_tests {
    use super::*;

    #[test]
    fn check_runtime_error_surfaces_message() {
        let resp = serde_json::json!({
            "type": "error",
            "message": "boom",
        });
        assert_eq!(check_runtime_error(&resp).unwrap_err(), "boom");
    }

    #[test]
    fn check_runtime_error_ignores_success() {
        let resp = serde_json::json!({
            "type": "credential_set_done",
            "id": "abc",
        });
        assert!(check_runtime_error(&resp).is_ok());
    }

    #[test]
    fn credential_detail_deserializes_runtime_snake_case() {
        let value = serde_json::json!({
            "id": "id-1",
            "namespace": "provider:anthropic",
            "name": "default",
            "kind": "api_key",
            "has_key": true,
            "last_tested_at": "2026-07-16T00:00:00Z",
            "last_tested_ok": true,
        });
        let detail: CredentialDetail = serde_json::from_value(value).unwrap();
        assert_eq!(detail.id, "id-1");
        assert_eq!(detail.namespace, "provider:anthropic");
        assert!(detail.has_key);
        assert_eq!(
            detail.last_tested_at.as_deref(),
            Some("2026-07-16T00:00:00Z")
        );
    }
}
