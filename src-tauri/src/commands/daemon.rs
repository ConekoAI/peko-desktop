//! Legacy daemon command surface.
//!
//! As of ADR-043 the desktop owns the engine lifecycle via the
//! sidecar supervisor. These commands remain registered so the
//! existing Settings buttons keep working until PR #27 removes
//! them; they are now thin proxies that route through the
//! supervisor instead of spawning a separate child process.

use crate::sidecar::{self, EngineState};

/// Status projected from the sidecar supervisor into the legacy
/// `DaemonStatus` shape so the existing `useDaemonStatus` hook keeps
/// working until PR #27 swaps it for `useEngineStatus`.
///
/// Lives in this file (not the deleted `daemon` module) because the
/// type is only consumed by the daemon_* Tauri commands below.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DaemonStatus {
    pub running: bool,
    pub version: String,
    pub uptime_secs: u64,
    pub jobs_checked: u64,
    pub jobs_executed: u64,
}

#[tauri::command]
pub fn daemon_start() -> Result<String, String> {
    let app =
        sidecar::current_app_handle().ok_or_else(|| "supervisor not installed".to_string())?;
    let sup = sidecar::get(&app);
    sup.start()
        .map(|pid| format!("daemon started (pid: {pid})"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn daemon_stop() -> Result<String, String> {
    let app =
        sidecar::current_app_handle().ok_or_else(|| "supervisor not installed".to_string())?;
    let sup = sidecar::get(&app);
    sup.stop()
        .map(|_| "daemon stopped".to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn daemon_restart() -> Result<String, String> {
    let app =
        sidecar::current_app_handle().ok_or_else(|| "supervisor not installed".to_string())?;
    let sup = sidecar::get(&app);
    sup.restart()
        .map(|pid| format!("daemon restarted (pid: {pid})"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn daemon_status() -> Result<DaemonStatus, String> {
    let app =
        sidecar::current_app_handle().ok_or_else(|| "supervisor not installed".to_string())?;
    let diag = sidecar::get(&app).diagnostics();
    let (running, version, uptime_secs) = match &diag.state {
        EngineState::Running {
            version,
            uptime_secs,
            ..
        } => (true, version.clone(), *uptime_secs),
        _ => (
            false,
            diag.version.clone().unwrap_or_default(),
            diag.uptime_secs,
        ),
    };
    Ok(DaemonStatus {
        running,
        version,
        uptime_secs,
        jobs_checked: 0,
        jobs_executed: 0,
    })
}

#[tauri::command]
pub async fn daemon_ensure_running() -> Result<DaemonStatus, String> {
    // The supervisor is the canonical owner of the engine process;
    // the IPC client defers to it so every IPC call goes through the
    // same child handle.
    let app =
        sidecar::current_app_handle().ok_or_else(|| "supervisor not installed".to_string())?;
    let sup = sidecar::get(&app);
    match sup.state() {
        EngineState::Running { pid, .. } => {
            let _ = pid;
        }
        _ => {
            sup.start().map_err(|e| e.to_string())?;
        }
    }
    daemon_status()
}
