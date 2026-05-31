use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CronJob {
    pub id: String,
    pub name: String,
    pub schedule: String,
    pub message: String,
    pub enabled: bool,
}

#[tauri::command]
pub fn cron_list() -> Result<Vec<CronJob>, String> {
    Ok(vec![])
}

#[tauri::command]
pub fn cron_add(name: String, _schedule: String, _message: String) -> Result<String, String> {
    Ok(format!("cron job '{}' added", name))
}

#[tauri::command]
pub fn cron_remove(id: String) -> Result<String, String> {
    Ok(format!("cron job '{}' removed", id))
}

#[tauri::command]
pub fn cron_run(id: String) -> Result<String, String> {
    Ok(format!("cron job '{}' executed", id))
}
