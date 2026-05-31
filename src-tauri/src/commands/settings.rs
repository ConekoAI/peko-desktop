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
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read config: {}", e))?;
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
    let content = toml::to_string_pretty(table)
        .map_err(|e| format!("failed to serialize config: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("failed to write config: {}", e))
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

#[tauri::command]
pub fn settings_get(key: String) -> Result<Option<String>, String> {
    let table = read_config()?;
    Ok(get_nested(&table, &key))
}

#[tauri::command]
pub fn settings_set(key: String, value: String) -> Result<(), String> {
    let mut table = read_config()?;
    set_nested(&mut table, &key, &value);
    write_config(&table)
}

#[tauri::command]
pub fn credential_get(provider: String) -> Result<Option<String>, String> {
    crate::vault::get_credential("peko", &provider)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn credential_set(provider: String, key: String) -> Result<(), String> {
    crate::vault::set_credential("peko", &provider, &key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn credential_delete(provider: String) -> Result<(), String> {
    crate::vault::delete_credential("peko", &provider)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn credential_test(_provider: String) -> Result<bool, String> {
    // TODO: make a minimal API call to validate the credential
    Ok(true)
}
