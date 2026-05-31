#[tauri::command]
pub fn settings_get(_key: String) -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
pub fn settings_set(_key: String, _value: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn credential_get(_provider: String) -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
pub fn credential_set(_provider: String, _key: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn credential_delete(_provider: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn credential_test(_provider: String) -> Result<bool, String> {
    Ok(false)
}
