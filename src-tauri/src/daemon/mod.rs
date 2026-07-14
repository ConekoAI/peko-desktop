use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DaemonError {
    #[error("binary not found: peko not found in bundled resources or PATH")]
    BinaryNotFound,
    #[error("start failed: {0}")]
    StartFailed(String),
    #[error("stop failed: {0}")]
    StopFailed(String),
    #[error("status check failed: {0}")]
    StatusFailed(String),
    #[error("already running")]
    AlreadyRunning,
    #[error("not running")]
    NotRunning,
}

pub type Result<T> = std::result::Result<T, DaemonError>;

/// Daemon process handle wrapper
pub struct DaemonHandle {
    pub child: Child,
    pub pid: u32,
}

/// Global mutable state for the daemon child process
static DAEMON_CHILD: Mutex<Option<DaemonHandle>> = Mutex::new(None);

/// Find the peko binary.
/// 1. Check bundled sidecar next to the app executable
/// 2. Check PATH for `peko` or `pekobot`
pub fn find_binary() -> Result<PathBuf> {
    // Check bundled sidecar
    if let Ok(exe) = std::env::current_exe() {
        let dir = exe.parent().unwrap_or_else(|| Path::new("."));
        for name in ["peko", "pekobot", "peko.exe", "pekobot.exe"] {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    // Check PATH
    for bin_name in ["peko", "pekobot"] {
        if let Ok(path) = which::which(bin_name) {
            return Ok(path);
        }
    }
    Err(DaemonError::BinaryNotFound)
}

/// Check if daemon is running by reading PID file and checking process
pub fn is_running() -> bool {
    let pid_path = default_pid_path();
    let pid = match std::fs::read_to_string(&pid_path) {
        Ok(content) => match content.trim().parse::<u32>() {
            Ok(p) => p,
            Err(_) => return false,
        },
        Err(_) => return false,
    };

    // Check if process exists (platform-specific)
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|out| String::from_utf8_lossy(&out.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }
    #[cfg(unix)]
    {
        std::path::Path::new(&format!("/proc/{}", pid)).exists()
    }
}

/// Start the daemon process
pub fn start() -> Result<u32> {
    let mut guard = DAEMON_CHILD
        .lock()
        .map_err(|e| DaemonError::StartFailed(e.to_string()))?;

    if is_running() {
        return Err(DaemonError::AlreadyRunning);
    }

    let binary = find_binary()?;

    let child = Command::new(&binary)
        .arg("daemon")
        .arg("start")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| DaemonError::StartFailed(format!("{}: {}", binary.display(), e)))?;

    let pid = child.id();
    *guard = Some(DaemonHandle { child, pid });

    // Wait a moment for daemon to write its PID file
    std::thread::sleep(Duration::from_millis(500));

    Ok(pid)
}

/// Stop the daemon gracefully via IPC shutdown packet, then kill if needed
pub fn stop() -> Result<()> {
    let mut guard = DAEMON_CHILD
        .lock()
        .map_err(|e| DaemonError::StopFailed(e.to_string()))?;

    if !is_running() {
        *guard = None;
        return Err(DaemonError::NotRunning);
    }

    // Try graceful shutdown via IPC first
    let _ = try_shutdown_via_ipc();

    // Wait for graceful shutdown
    std::thread::sleep(Duration::from_secs(2));

    if is_running() {
        // Force kill
        if let Some(ref mut handle) = guard.as_mut() {
            let _ = handle.child.kill();
        }

        // Also try killing by PID file
        let pid_path = default_pid_path();
        if let Ok(content) = std::fs::read_to_string(&pid_path) {
            if let Ok(pid) = content.trim().parse::<u32>() {
                #[cfg(windows)]
                {
                    let _ = Command::new("taskkill")
                        .args(["/F", "/PID", &pid.to_string()])
                        .output();
                }
                #[cfg(unix)]
                {
                    let _ = Command::new("kill").arg("-9").arg(pid.to_string()).output();
                }
            }
        }
    }

    // Clean up PID file
    let _ = std::fs::remove_file(default_pid_path());
    let _ = std::fs::remove_file(default_pid_path().with_extension("lock"));

    *guard = None;
    Ok(())
}

/// Restart the daemon
pub fn restart() -> Result<u32> {
    let _ = stop();
    std::thread::sleep(Duration::from_millis(500));
    start()
}

/// Ensure the daemon is running, starting it if necessary.
///
/// As of ADR-043 the desktop owns the engine lifecycle via
/// `crate::sidecar::Supervisor`. The legacy `ensure_running_async`
/// path (called from the IPC client) defers to the supervisor so
/// every IPC call goes through the same child handle.
pub async fn ensure_running_async() -> Result<u32> {
    // The IPC client holds an `AppHandle` only when invoked from a
    // `#[tauri::command]`; for non-Tauri contexts (tests, ad-hoc
    // scripts) this short-circuits to the legacy find-binary path.
    // The IPC client itself is the only production caller of this
    // function, so the Tauri path is the one that matters.
    match crate::ipc::current_app_handle() {
        Some(handle) => {
            let sup = crate::sidecar::get(&handle);
            match sup.state() {
                crate::sidecar::EngineState::Running { pid, .. } => Ok(pid),
                _ => tokio::task::spawn_blocking(move || sup.start())
                    .await
                    .map_err(|e| DaemonError::StartFailed(e.to_string()))?
                    .map_err(|e| DaemonError::StartFailed(e.to_string())),
            }
        }
        None => {
            // No Tauri context — fall back to the legacy PATH-based
            // lookup so unit tests and headless tools keep working.
            tokio::task::spawn_blocking(ensure_running_legacy)
                .await
                .map_err(|e| DaemonError::StartFailed(e.to_string()))?
        }
    }
}

/// Legacy ensure-running kept for headless / non-Tauri callers.
/// The supervisor (ADR-043) is the preferred path; this only fires
/// when the IPC client is invoked outside a Tauri runtime.
fn ensure_running_legacy() -> Result<u32> {
    if is_running() {
        if let Ok(content) = std::fs::read_to_string(default_pid_path()) {
            if let Ok(pid) = content.trim().parse::<u32>() {
                return Ok(pid);
            }
        }
    }
    start()?;
    let pid_path = default_pid_path();
    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(500));
        if let Ok(content) = std::fs::read_to_string(&pid_path) {
            if let Ok(pid) = content.trim().parse::<u32>() {
                if is_running() {
                    return Ok(pid);
                }
            }
        }
    }
    Err(DaemonError::StartFailed(
        "daemon started but did not write PID file within 10 seconds".to_string(),
    ))
}

/// Get daemon status
pub fn status() -> Result<DaemonStatus> {
    let running = is_running();

    if !running {
        return Ok(DaemonStatus {
            running: false,
            version: String::new(),
            uptime_secs: 0,
            jobs_checked: 0,
            jobs_executed: 0,
        });
    }

    // Try to get version via IPC ping
    match try_ping_ipc() {
        Ok(pong) => Ok(DaemonStatus {
            running: true,
            version: pong.version,
            uptime_secs: pong.uptime_secs,
            jobs_checked: 0, // TODO: read from cron engine status
            jobs_executed: 0,
        }),
        Err(_) => Ok(DaemonStatus {
            running: true,
            version: "unknown".to_string(),
            uptime_secs: 0,
            jobs_checked: 0,
            jobs_executed: 0,
        }),
    }
}

/// Daemon status struct
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DaemonStatus {
    pub running: bool,
    pub version: String,
    pub uptime_secs: u64,
    pub jobs_checked: u64,
    pub jobs_executed: u64,
}

// --- Internal helpers ---

fn default_pid_path() -> PathBuf {
    dirs::home_dir()
        .map(|d| d.join(".peko").join("run").join("daemon.pid"))
        .unwrap_or_else(|| PathBuf::from(".peko").join("run").join("daemon.pid"))
}

fn try_shutdown_via_ipc() -> Result<()> {
    // Send Shutdown request packet via UDP
    let request = serde_json::json!({
        "type": "shutdown",
        "request_id": 1u64,
        "force": false
    });

    let bytes = request.to_string().into_bytes();

    #[cfg(windows)]
    {
        use std::net::UdpSocket;
        if let Ok(socket) = UdpSocket::bind("127.0.0.1:0") {
            let _ = socket.send_to(&bytes, "127.0.0.1:11435");
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::net::UnixDatagram;
        let sock_path = default_socket_path();
        if let Ok(socket) = UnixDatagram::unbound() {
            let _ = socket.send_to(&bytes, &sock_path);
        }
    }

    Ok(())
}

fn try_ping_ipc() -> Result<PongResponse> {
    let request = serde_json::json!({
        "type": "ping",
        "request_id": 1u64
    });

    let bytes = request.to_string().into_bytes();
    let mut buf = [0u8; 65536];

    #[cfg(windows)]
    {
        use std::net::UdpSocket;
        let socket =
            UdpSocket::bind("127.0.0.1:0").map_err(|e| DaemonError::StatusFailed(e.to_string()))?;
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .map_err(|e| DaemonError::StatusFailed(e.to_string()))?;
        socket
            .send_to(&bytes, "127.0.0.1:11435")
            .map_err(|e| DaemonError::StatusFailed(e.to_string()))?;
        let (len, _) = socket
            .recv_from(&mut buf)
            .map_err(|e| DaemonError::StatusFailed(e.to_string()))?;

        let response: serde_json::Value = serde_json::from_slice(&buf[..len])
            .map_err(|e| DaemonError::StatusFailed(e.to_string()))?;

        Ok(PongResponse {
            version: response
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            uptime_secs: response
                .get("uptime_secs")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
        })
    }
    #[cfg(unix)]
    {
        use std::os::unix::net::UnixDatagram;
        let sock_path = default_socket_path();
        let tmp =
            std::env::temp_dir().join(format!("peko_desktop_ping_{}.sock", std::process::id()));
        let _ = std::fs::remove_file(&tmp);
        let socket =
            UnixDatagram::bind(&tmp).map_err(|e| DaemonError::StatusFailed(e.to_string()))?;
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .map_err(|e| DaemonError::StatusFailed(e.to_string()))?;
        socket
            .send_to(&bytes, &sock_path)
            .map_err(|e| DaemonError::StatusFailed(e.to_string()))?;
        let (len, _) = socket
            .recv_from(&mut buf)
            .map_err(|e| DaemonError::StatusFailed(e.to_string()))?;
        let _ = std::fs::remove_file(&tmp);

        let response: serde_json::Value = serde_json::from_slice(&buf[..len])
            .map_err(|e| DaemonError::StatusFailed(e.to_string()))?;

        Ok(PongResponse {
            version: response
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            uptime_secs: response
                .get("uptime_secs")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
        })
    }
}

#[derive(Debug, Clone)]
struct PongResponse {
    version: String,
    uptime_secs: u64,
}

#[cfg(unix)]
fn default_socket_path() -> PathBuf {
    dirs::home_dir()
        .map(|d| d.join(".peko").join("run").join("daemon.sock"))
        .unwrap_or_else(|| PathBuf::from(".peko").join("run").join("daemon.sock"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_pid_path() {
        let path = default_pid_path();
        assert!(path.to_string_lossy().contains("daemon.pid"));
    }

    #[test]
    fn test_daemon_status_serialization() {
        let status = DaemonStatus {
            running: true,
            version: "1.0.0".to_string(),
            uptime_secs: 42,
            jobs_checked: 10,
            jobs_executed: 5,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("1.0.0"));
        let deserialized: DaemonStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.uptime_secs, 42);
    }
}
