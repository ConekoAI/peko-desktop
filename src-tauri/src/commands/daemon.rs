//! Legacy daemon command surface.
//!
//! As of ADR-043 the desktop owns the engine lifecycle via the
//! sidecar supervisor. These commands remain registered so the
//! existing Settings buttons keep working until PR #27 removes
//! them; they are now thin proxies that route through the
//! supervisor instead of spawning a separate child process.

use crate::daemon::DaemonStatus;
use crate::sidecar::{self, EngineState};

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

/// Status of the sidecar supervisor, projected into the legacy
/// `DaemonStatus` shape so the existing `useDaemonStatus` hook keeps
/// working until PR #27 swaps it for `useEngineStatus`.
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
    crate::daemon::ensure_running_async()
        .await
        .map_err(|e| e.to_string())?;
    daemon_status()
}
