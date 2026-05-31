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
pub fn system_status() -> Result<SystemStatus, String> {
    Ok(SystemStatus {
        version: "0.1.0".to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        uptime_secs: 0,
        memory_used_mb: 0,
        memory_total_mb: 0,
    })
}

#[tauri::command]
pub fn system_doctor() -> Result<DoctorReport, String> {
    Ok(DoctorReport {
        checks: vec![],
        healthy: true,
    })
}

#[tauri::command]
pub fn system_clean() -> Result<String, String> {
    Ok("system cleaned".to_string())
}
