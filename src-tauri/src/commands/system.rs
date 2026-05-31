use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SystemStatus {
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub uptime_secs: u64,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
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
pub async fn system_status() -> Result<SystemStatus, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.system_status().await.map_err(|e| e.to_string())?;

    let status = SystemStatus {
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
    };
    Ok(status)
}

#[tauri::command]
pub async fn system_doctor() -> Result<DoctorReport, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn system_clean() -> Result<String, String> {
    super::util::run_peko_ok(&["system", "clean"])
}
