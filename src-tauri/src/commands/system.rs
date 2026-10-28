use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;

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

/// The folder the engine keeps pekos, models, and keys in: `PEKO_HOME`,
/// else `PEKO_CONFIG_DIR`, else `~/.peko` — the env the sidecar inherits.
#[tauri::command]
pub fn peko_home_dir() -> Result<String, String> {
    peko_home_from(
        std::env::var("PEKO_HOME").ok(),
        std::env::var("PEKO_CONFIG_DIR").ok(),
        dirs::home_dir(),
    )
    .map(|p| p.display().to_string())
    .ok_or_else(|| "could not determine the peko folder".to_string())
}

fn peko_home_from(
    peko_home: Option<String>,
    config_dir: Option<String>,
    home: Option<std::path::PathBuf>,
) -> Option<std::path::PathBuf> {
    peko_home
        .or(config_dir)
        .filter(|v| !v.trim().is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| home.map(|h| h.join(".peko")))
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

#[cfg(test)]
mod peko_home_tests {
    use super::peko_home_from;
    use std::path::PathBuf;

    #[test]
    fn env_wins_then_home() {
        let home = Some(PathBuf::from("/Users/a"));
        assert_eq!(
            peko_home_from(Some("/x".into()), Some("/y".into()), home.clone()),
            Some(PathBuf::from("/x"))
        );
        assert_eq!(
            peko_home_from(None, Some("/y".into()), home.clone()),
            Some(PathBuf::from("/y"))
        );
        assert_eq!(
            peko_home_from(Some(" ".into()), None, home),
            Some(PathBuf::from("/Users/a/.peko"))
        );
    }
}

