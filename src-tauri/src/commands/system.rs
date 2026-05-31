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
    super::util::run_peko_json(&["system", "status", "--json"])
}

#[tauri::command]
pub fn system_doctor() -> Result<DoctorReport, String> {
    super::util::run_peko_json(&["system", "doctor", "--json"])
}

#[tauri::command]
pub fn system_clean() -> Result<String, String> {
    super::util::run_peko_ok(&["system", "clean"])
}
