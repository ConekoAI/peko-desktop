use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DaemonStatus {
    pub running: bool,
    pub version: String,
    pub uptime_secs: u64,
    pub jobs_checked: u64,
    pub jobs_executed: u64,
}

#[tauri::command]
pub fn daemon_start() -> Result<String, String> {
    Ok("daemon started".to_string())
}

#[tauri::command]
pub fn daemon_stop() -> Result<String, String> {
    Ok("daemon stopped".to_string())
}

#[tauri::command]
pub fn daemon_restart() -> Result<String, String> {
    Ok("daemon restarted".to_string())
}

#[tauri::command]
pub fn daemon_status() -> Result<DaemonStatus, String> {
    Ok(DaemonStatus {
        running: false,
        version: "0.0.0".to_string(),
        uptime_secs: 0,
        jobs_checked: 0,
        jobs_executed: 0,
    })
}
