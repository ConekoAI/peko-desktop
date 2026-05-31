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
    super::util::run_peko_json(&["cron", "list", "--json"])
}

#[tauri::command]
pub fn cron_add(name: String, schedule: String, message: String) -> Result<String, String> {
    super::util::run_peko_ok(&[
        "cron",
        "add",
        "--name",
        &name,
        "--schedule",
        &schedule,
        "--message",
        &message,
    ])
}

#[tauri::command]
pub fn cron_remove(id: String) -> Result<String, String> {
    super::util::run_peko_ok(&["cron", "remove", &id])
}

#[tauri::command]
pub fn cron_run(id: String) -> Result<String, String> {
    super::util::run_peko_ok(&["cron", "run", &id])
}
