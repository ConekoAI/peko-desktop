use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;

/// Resolve the peko data directory, mirroring the runtime's
/// `default_data_dir()` convention (`PEKO_HOME` env var override,
/// otherwise the platform-appropriate `dirs::data_dir()/peko`).
/// Lives here rather than as a dependency on the runtime crate so
/// the desktop stays a thin shell around the runtime.
fn peko_data_dir() -> std::path::PathBuf {
    if let Ok(home) = std::env::var("PEKO_HOME") {
        return std::path::PathBuf::from(home);
    }
    dirs::data_dir()
        .map(|d| d.join("peko"))
        .unwrap_or_else(|| std::path::PathBuf::from(".peko"))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SystemStatus {
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub uptime_secs: u64,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub runtime_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DoctorReport {
    pub checks: Vec<CheckResult>,
    pub healthy: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CheckResult {
    pub name: String,
    pub passed: bool,
    pub message: String,
}

#[tauri::command]
pub async fn system_status(
    state: State<'_, AppState>,
    runtime_id: Option<String>,
) -> Result<SystemStatus, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    let runtime = state
        .get_runtime(&rid)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", rid))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| e.to_string())?;
            let value = client.system_status().await.map_err(|e| e.to_string())?;
            Ok(SystemStatus {
                version: value
                    .get("version")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                platform: std::env::consts::OS.to_string(),
                arch: std::env::consts::ARCH.to_string(),
                uptime_secs: value
                    .get("uptime_secs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
                memory_used_mb: value
                    .get("memory_used_mb")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
                memory_total_mb: value
                    .get("memory_total_mb")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
                runtime_id: rid,
            })
        }
        crate::state::RuntimeConnectionType::Remote => {
            let value = state
                .pekohub_client
                .system_status(&rid)
                .await
                .map_err(|e| e.to_string())?;
            Ok(SystemStatus {
                version: value
                    .get("version")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                platform: value
                    .get("platform")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                arch: value
                    .get("arch")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                uptime_secs: value
                    .get("uptime_secs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
                memory_used_mb: value
                    .get("memory_used_mb")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
                memory_total_mb: value
                    .get("memory_total_mb")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
                runtime_id: rid,
            })
        }
    }
}

#[tauri::command]
pub async fn system_doctor(
    state: State<'_, AppState>,
    runtime_id: Option<String>,
) -> Result<DoctorReport, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    let runtime = state
        .get_runtime(&rid)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", rid))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| e.to_string())?;
            let value = client.system_doctor().await.map_err(|e| e.to_string())?;
            let checks: Vec<CheckResult> = value
                .get("checks")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|c| {
                            Some(CheckResult {
                                name: c.get("name")?.as_str()?.to_string(),
                                passed: c.get("passed")?.as_bool().unwrap_or(false),
                                message: c.get("message")?.as_str()?.to_string(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            let healthy = checks.iter().all(|c| c.passed);
            Ok(DoctorReport { checks, healthy })
        }
        crate::state::RuntimeConnectionType::Remote => {
            Err("System doctor is not supported for remote runtimes yet".to_string())
        }
    }
}

#[tauri::command]
pub async fn system_clean(
    state: State<'_, AppState>,
    runtime_id: Option<String>,
) -> Result<String, String> {
    let rid = runtime_id.unwrap_or_else(|| "local".to_string());
    let runtime = state
        .get_runtime(&rid)
        .await
        .ok_or_else(|| format!("Runtime '{}' not found", rid))?;

    match runtime.connection_type {
        crate::state::RuntimeConnectionType::Local => {
            let client = crate::ipc::IpcClient::new()
                .await
                .map_err(|e| e.to_string())?;
            let resp = client
                .system_clean(Some("all"))
                .await
                .map_err(|e| e.to_string())?;
            if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
                return Err(resp
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string());
            }
            let cleaned = resp
                .get("cleaned")
                .and_then(|v| v.as_array())
                .map(|arr| arr.len())
                .unwrap_or(0);
            let bytes = resp
                .get("bytes_freed")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            Ok(format!("Cleaned {} items, freed {} bytes", cleaned, bytes))
        }
        crate::state::RuntimeConnectionType::Remote => {
            Err("System clean is not supported for remote runtimes yet".to_string())
        }
    }
}

/// Return the last N lines of the local daemon's log file, if any.
///
/// The peko daemon writes to `<data_dir>/daemon.log` when file-based
/// logging is enabled (default off; flip the env knob on the runtime
/// to enable). The desktop reads it directly from disk because the
/// runtime does not currently surface log reads over IPC.
///
/// Returns an empty `Vec` (not an error) when the file does not
/// exist — the DaemonLogs page renders "No log output" gracefully in
/// that case. Operators who need log access can either enable
/// file-logging on the runtime or read the file directly from
/// `<data_dir>/daemon.log`.
#[tauri::command]
pub async fn system_logs(lines: Option<usize>) -> Result<Vec<String>, String> {
    let n = lines.unwrap_or(200);
    let log_path = peko_data_dir().join("daemon.log");
    if !log_path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&log_path)
        .map_err(|e| format!("failed to read {}: {}", log_path.display(), e))?;
    let buf: Vec<&str> = content.lines().rev().take(n).collect();
    let mut out: Vec<String> = buf.into_iter().map(|s| s.to_string()).collect();
    out.reverse();
    Ok(out)
}
