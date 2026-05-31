use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::mpsc;
use thiserror::Error;

use crate::commands::daemon::DaemonStatus;

#[derive(Error, Debug)]
pub enum DaemonError {
    #[error("binary not found")]
    BinaryNotFound,
    #[error("start failed: {0}")]
    StartFailed(String),
    #[error("stop failed: {0}")]
    StopFailed(String),
    #[error("status check failed: {0}")]
    StatusFailed(String),
    #[error("not implemented")]
    NotImplemented,
}

pub type Result<T> = std::result::Result<T, DaemonError>;

pub struct DaemonManager;

impl DaemonManager {
    pub fn new() -> Self {
        Self
    }
}

pub fn find_binary() -> Result<PathBuf> {
    // Check bundled sidecar first, then PATH
    if let Ok(exe) = std::env::current_exe() {
        let sidecar = exe.parent().unwrap_or_else(|| std::path::Path::new(".")).join("peko-daemon");
        if sidecar.exists() {
            return Ok(sidecar);
        }
    }
    if let Ok(path) = which::which("peko-daemon") {
        return Ok(path);
    }
    Err(DaemonError::BinaryNotFound)
}

pub fn start() -> Result<Child> {
    let binary = find_binary()?;
    Command::new(binary)
        .spawn()
        .map_err(|e| DaemonError::StartFailed(e.to_string()))
}

pub fn stop() -> Result<()> {
    Ok(())
}

pub fn status() -> Result<DaemonStatus> {
    Ok(DaemonStatus {
        running: false,
        version: "0.0.0".to_string(),
        uptime_secs: 0,
        jobs_checked: 0,
        jobs_executed: 0,
    })
}

pub fn stream_logs() -> Result<mpsc::Receiver<String>> {
    let (_tx, rx) = mpsc::channel();
    Ok(rx)
}
