pub use crate::daemon::DaemonStatus;

#[tauri::command]
pub fn daemon_start() -> Result<String, String> {
    crate::daemon::start()
        .map(|pid| format!("daemon started (pid: {})", pid))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn daemon_stop() -> Result<String, String> {
    crate::daemon::stop()
        .map(|_| "daemon stopped".to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn daemon_restart() -> Result<String, String> {
    crate::daemon::restart()
        .map(|pid| format!("daemon restarted (pid: {})", pid))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn daemon_status() -> Result<DaemonStatus, String> {
    crate::daemon::status().map_err(|e| e.to_string())
}
