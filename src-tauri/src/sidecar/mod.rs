//! SidecarSupervisor — the desktop's engine lifecycle owner (ADR-043).
//!
//! The supervisor owns the bundled `peko` sidecar process: it spawns
//! the sidecar at app startup with `--sidecar-mode`, captures stderr
//! (notably `PEKO_VERSION=x.y.z`), watches the child's lifetime, and
//! shuts it down cleanly on app exit. On unexpected exit it
//! auto-restarts the engine once; if the second instance also dies
//! within the give-up window the supervisor surfaces a `Failed` state
//! and emits `engine-state-changed` for the UI to pick up.
//!
//! Until PR #27 lands the user-facing Settings buttons remain, but
//! they go through this supervisor so the legacy code path and the
//! new sidecar path share a single child handle.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent, TerminatedPayload};
use tauri_plugin_shell::ShellExt;
use thiserror::Error;

const LOG_RING_CAPACITY: usize = 200;
const RESTART_BACKOFF: Duration = Duration::from_secs(2);
const RESTART_GIVEUP_WINDOW: Duration = Duration::from_secs(30);
const MAX_RESTART_ATTEMPTS: u32 = 1;

const STATE_EVENT: &str = "engine-state-changed";
const VERSION_MISMATCH_EVENT: &str = "engine-version-mismatch";

#[derive(Error, Debug)]
pub enum SupervisorError {
    #[error("sidecar binary missing from bundle")]
    BinaryMissing,
    #[error("spawn failed: {0}")]
    Spawn(String),
    #[error("engine not running")]
    NotRunning,
    #[error("shutdown timed out after {0}s")]
    ShutdownTimeout(u64),
}

pub type Result<T> = std::result::Result<T, SupervisorError>;

/// Public-facing engine state surfaced to the UI.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EngineState {
    /// Supervisor constructed but engine never started.
    Stopped,
    /// Spawn issued; waiting for first stderr line / IPC readiness.
    Starting,
    /// Engine is up and emitting.
    Running {
        pid: u32,
        version: String,
        uptime_secs: u64,
    },
    /// Engine exited unexpectedly; supervisor is restarting it.
    Restarting { attempt: u32 },
    /// Engine exited twice within the give-up window; supervisor has
    /// stopped trying and is awaiting user action.
    Failed { message: String },
}

/// Snapshot for the diagnostics panel (PR #27 surface).
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Diagnostics {
    pub state: EngineState,
    pub pid: Option<u32>,
    pub version: Option<String>,
    pub expected_version: Option<String>,
    pub version_matches: Option<bool>,
    pub uptime_secs: u64,
    pub lockfile_path: String,
    pub socket_path: String,
    pub log_ring: Vec<String>,
    pub restart_count: u32,
    pub last_error: Option<String>,
}

/// Payload emitted alongside `engine-version-mismatch` so the UI can
/// show the user which versions are involved.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VersionMismatch {
    pub actual: String,
    pub expected: String,
}

pub struct Supervisor {
    inner: Arc<Mutex<Inner>>,
    app_handle: AppHandle,
}

struct Inner {
    child: Option<CommandChild>,
    child_pid: Option<u32>,
    state: EngineState,
    version: Option<String>,
    expected_version: Option<String>,
    started_at: Option<Instant>,
    first_exit_at: Option<Instant>,
    restart_count: u32,
    last_error: Option<String>,
    log_ring: VecDeque<String>,
}

impl Supervisor {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                child: None,
                child_pid: None,
                state: EngineState::Stopped,
                version: None,
                expected_version: None,
                started_at: None,
                first_exit_at: None,
                restart_count: 0,
                last_error: None,
                log_ring: VecDeque::with_capacity(LOG_RING_CAPACITY),
            })),
            app_handle,
        }
    }

    pub fn set_expected_version(&self, v: String) {
        self.inner.lock().unwrap().expected_version = Some(v);
    }

    pub fn state(&self) -> EngineState {
        self.inner.lock().unwrap().state.clone()
    }

    pub fn is_running(&self) -> bool {
        matches!(
            self.inner.lock().unwrap().state,
            EngineState::Running { .. }
        )
    }

    /// Spawn the bundled sidecar with `--sidecar-mode`. Idempotent:
    /// returns the existing PID if already running.
    ///
    /// Intentionally NOT async: all operations are synchronous
    /// (lock, sidecar spawn, lock update, reader-task spawn). The
    /// Tauri commands wrap this in `async_runtime::block_on` when
    /// they need to call it from a sync context. Avoiding `async`
    /// here keeps the function `Send`-able across `await` points in
    /// callers like `handle_terminated`.
    pub fn start(&self) -> Result<u32> {
        {
            let g = self.inner.lock().unwrap();
            if let EngineState::Running { pid, .. } = &g.state {
                return Ok(*pid);
            }
        }

        let app_handle = self.app_handle.clone();
        let (rx, child) = app_handle
            .shell()
            .sidecar("peko")
            .map_err(|e| SupervisorError::Spawn(e.to_string()))?
            .args(["daemon", "start", "--sidecar-mode"])
            .spawn()
            .map_err(|e| SupervisorError::Spawn(e.to_string()))?;

        let pid = child.pid();

        {
            let mut g = self.inner.lock().unwrap();
            g.child = Some(child);
            g.child_pid = Some(pid);
            g.state = EngineState::Starting;
            g.started_at = Some(Instant::now());
            g.last_error = None;
        }
        self.emit_state();

        // Reader task: pull CommandEvent, parse stderr, decide on
        // restart when the child terminates.
        let inner = self.inner.clone();
        let app_for_task = self.app_handle.clone();
        tauri::async_runtime::spawn(async move {
            drive_events(inner, app_for_task, rx).await;
        });

        Ok(pid)
    }

    /// Stop the sidecar. Sends SIGTERM via CommandChild::kill. The
    /// reader task observes the Terminated event and finalises state
    /// asynchronously — we don't wait for it here, since `CommandChild`
    /// exposes no `try_wait` and the reader task owns the receiver.
    /// Idempotent: returns Ok if already stopped.
    pub fn stop(&self) -> Result<()> {
        let child = {
            let mut g = self.inner.lock().unwrap();
            match g.child.take() {
                Some(c) => c,
                None => {
                    g.state = EngineState::Stopped;
                    g.started_at = None;
                    g.first_exit_at = None;
                    g.restart_count = 0;
                    return Ok(());
                }
            }
        };

        let _ = child.kill();

        let mut g = self.inner.lock().unwrap();
        g.child_pid = None;
        g.started_at = None;
        g.state = EngineState::Stopped;
        g.restart_count = 0;
        drop(g);
        self.emit_state();
        Ok(())
    }

    /// Restart: stop + start. Sync — same Send rationale as `start`.
    pub fn restart(&self) -> Result<u32> {
        let _ = self.stop();
        self.start()
    }

    /// Snapshot for the diagnostics panel.
    pub fn diagnostics(&self) -> Diagnostics {
        let g = self.inner.lock().unwrap();
        let uptime_secs = g.started_at.map(|t| t.elapsed().as_secs()).unwrap_or(0);
        let version_matches = match (&g.version, &g.expected_version) {
            (Some(actual), Some(expected)) => Some(actual == expected),
            _ => None,
        };
        let pid = g.child_pid.or_else(|| match &g.state {
            EngineState::Running { pid, .. } => Some(*pid),
            _ => None,
        });
        Diagnostics {
            state: g.state.clone(),
            pid,
            version: g.version.clone(),
            expected_version: g.expected_version.clone(),
            version_matches,
            uptime_secs,
            lockfile_path: lockfile_path().to_string_lossy().to_string(),
            socket_path: socket_path().to_string_lossy().to_string(),
            log_ring: g.log_ring.iter().cloned().collect(),
            restart_count: g.restart_count,
            last_error: g.last_error.clone(),
        }
    }

    fn emit_state(&self) {
        let snap = self.diagnostics();
        let _ = self.app_handle.emit(STATE_EVENT, &snap.state);
    }
}

/// Install the supervisor into Tauri's managed state. Returns the
/// shared handle so the caller can kick off `start()` immediately.
/// Also stashes the AppHandle in a process-local OnceLock so the
/// IPC client (which doesn't have an injected AppHandle) can route
/// `ensure_running_async` through the supervisor.
pub fn install(app: &AppHandle) -> Arc<Supervisor> {
    let sup = Arc::new(Supervisor::new(app.clone()));
    app.manage(sup.clone());
    APP_HANDLE.set(app.clone()).ok();
    sup
}

/// Fetch the supervisor from Tauri's managed state. Panics if it
/// has not been installed — the only valid call site is post-`setup()`.
pub fn get(app: &AppHandle) -> Arc<Supervisor> {
    app.state::<Arc<Supervisor>>().inner().clone()
}

/// The AppHandle stashed by `install()`. Used by the IPC client to
/// bridge into the supervisor from contexts that don't get the
/// handle passed in directly. `None` if `install` has not run.
pub fn current_app_handle() -> Option<AppHandle> {
    APP_HANDLE.get().cloned()
}

static APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

// ─────────────────────────────────────────────────────────────────────
// Background event loop
// ─────────────────────────────────────────────────────────────────────

async fn drive_events(
    inner: Arc<Mutex<Inner>>,
    app: AppHandle,
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
) {
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                if line.is_empty() {
                    continue;
                }
                handle_stderr_line(&inner, &app, &line);
            }
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                if line.is_empty() {
                    continue;
                }
                push_log(&inner, &line);
            }
            CommandEvent::Error(msg) => {
                let mut g = inner.lock().unwrap();
                g.last_error = Some(msg.clone());
                push_log_inner(&mut g, format!("[supervisor] stream error: {msg}"));
            }
            CommandEvent::Terminated(payload) => {
                handle_terminated(&inner, &app, payload).await;
                break;
            }
            _ => {}
        }
    }
}

fn handle_stderr_line(inner: &Arc<Mutex<Inner>>, app: &AppHandle, line: &str) {
    push_log(inner, line);

    // Parse `PEKO_VERSION=x.y.z` (runtime writes this as the FIRST
    // line of stderr in sidecar mode; see ADR-043 §2.3).
    if let Some(version) = parse_peko_version(line) {
        let mut g = inner.lock().unwrap();
        g.version = Some(version.clone());
        // Promote Starting → Running the first time we see a version.
        if matches!(g.state, EngineState::Starting) {
            g.first_exit_at = None;
            g.restart_count = 0;
            let pid = g.child_pid.unwrap_or(0);
            g.state = EngineState::Running {
                pid,
                version: version.clone(),
                uptime_secs: 0,
            };
            let expected = g.expected_version.clone();
            drop(g);
            emit_state_change(app);
            if let Some(expected_v) = expected {
                if expected_v != version {
                    let _ = app.emit(
                        VERSION_MISMATCH_EVENT,
                        &VersionMismatch {
                            actual: version,
                            expected: expected_v,
                        },
                    );
                }
            }
            return;
        }
        // Already Running — just update version (unlikely but safe).
        if let EngineState::Running {
            pid, uptime_secs, ..
        } = &mut g.state
        {
            g.state = EngineState::Running {
                pid: *pid,
                version: version.clone(),
                uptime_secs: *uptime_secs,
            };
        }
        let expected = g.expected_version.clone();
        drop(g);
        emit_state_change(app);
        if let Some(expected_v) = expected {
            if expected_v != version {
                let _ = app.emit(
                    VERSION_MISMATCH_EVENT,
                    &VersionMismatch {
                        actual: version,
                        expected: expected_v,
                    },
                );
            }
        }
    }
}

async fn handle_terminated(inner: &Arc<Mutex<Inner>>, app: &AppHandle, payload: TerminatedPayload) {
    let exit_code = payload.code;
    let signal = payload.signal;
    let msg = match (exit_code, signal) {
        (Some(0), _) => "engine exited cleanly".to_string(),
        (Some(code), _) => format!("engine exited with code {code}"),
        (None, Some(sig)) => format!("engine killed by signal {sig}"),
        (None, None) => "engine terminated".to_string(),
    };

    // Phase 1: read state and decide the next action while holding
    // the lock. Drop the guard before any await.
    enum Action {
        Stopped,
        Restart,
        GiveUp,
    }
    let action = {
        let mut g = inner.lock().unwrap();
        push_log_inner(&mut g, format!("[supervisor] {msg}"));

        let was_running = matches!(g.state, EngineState::Running { .. } | EngineState::Starting);
        if !was_running {
            g.state = EngineState::Stopped;
            g.child = None;
            g.child_pid = None;
            Action::Stopped
        } else {
            let now = Instant::now();
            let within_giveup = g
                .first_exit_at
                .map(|t| now.duration_since(t) < RESTART_GIVEUP_WINDOW)
                .unwrap_or(false);

            if g.restart_count < MAX_RESTART_ATTEMPTS && !within_giveup {
                g.first_exit_at = Some(now);
                g.restart_count += 1;
                g.state = EngineState::Restarting {
                    attempt: g.restart_count,
                };
                g.child = None;
                g.child_pid = None;
                Action::Restart
            } else {
                g.state = EngineState::Failed {
                    message: format!("engine keeps stopping ({msg})"),
                };
                g.last_error = Some(msg.clone());
                g.child = None;
                g.child_pid = None;
                Action::GiveUp
            }
        }
    };

    match action {
        Action::Stopped | Action::GiveUp => {
            emit_state_change(app);
        }
        Action::Restart => {
            emit_state_change(app);
            tokio::time::sleep(RESTART_BACKOFF).await;
            let sup = get(app);
            if let Err(e) = sup.start() {
                let mut g = inner.lock().unwrap();
                g.state = EngineState::Failed {
                    message: format!("restart failed: {e}"),
                };
                g.last_error = Some(e.to_string());
                drop(g);
                emit_state_change(app);
            }
        }
    }
}

fn emit_state_change(app: &AppHandle) {
    let sup = app.state::<Arc<Supervisor>>().inner().clone();
    let snap = sup.diagnostics();
    let _ = app.emit(STATE_EVENT, &snap.state);
}

fn push_log(inner: &Arc<Mutex<Inner>>, line: &str) {
    let mut g = inner.lock().unwrap();
    push_log_inner(&mut g, line.to_string());
}

fn push_log_inner(g: &mut Inner, line: String) {
    if g.log_ring.len() == LOG_RING_CAPACITY {
        g.log_ring.pop_front();
    }
    g.log_ring.push_back(line);
}

// (the `child_alive` helper from the previous draft was removed when
// we switched to kill+detach in `stop()`. The reader task owns the
// Receiver<CommandEvent> and observes Terminated, which is the
// authoritative signal that the child has exited.)

// ─────────────────────────────────────────────────────────────────────
// Free helpers — paths and version parsing
// ─────────────────────────────────────────────────────────────────────

/// Sidecar-mode lockfile path. The runtime writes `desktop.lock`
/// (not `daemon.pid`) when started with `--sidecar-mode`, per
/// ADR-043 §2.3 and `daemon_process_service::pid_file_path`.
pub fn lockfile_path() -> PathBuf {
    dirs::home_dir()
        .map(|d| d.join(".peko").join("run").join("desktop.lock"))
        .unwrap_or_else(|| PathBuf::from(".peko").join("run").join("desktop.lock"))
}

/// IPC socket path the runtime binds in sidecar mode. The runtime
/// does NOT differentiate the socket by mode (it always binds
/// `daemon.sock` on Unix / `127.0.0.1:11435` UDP on Windows), so
/// this is informational — it tells the user where to look, not
/// where a sidecar-only socket lives.
pub fn socket_path() -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from("127.0.0.1:11435")
    }
    #[cfg(unix)]
    {
        dirs::home_dir()
            .map(|d| d.join(".peko").join("run").join("daemon.sock"))
            .unwrap_or_else(|| PathBuf::from(".peko").join("run").join("daemon.sock"))
    }
}

/// Extract `x.y.z` from a line shaped `PEKO_VERSION=x.y.z`. Returns
/// `None` for any other shape (including missing/garbled version).
pub fn parse_peko_version(line: &str) -> Option<String> {
    let rest = line.strip_prefix("PEKO_VERSION=")?;
    let v = rest.trim();
    if v.is_empty() || v.len() > 64 || v.contains(char::is_whitespace) {
        return None;
    }
    if !v
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '+')
    {
        return None;
    }
    Some(v.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_state_serialization_roundtrip() {
        let s = EngineState::Running {
            pid: 4242,
            version: "0.1.0".to_string(),
            uptime_secs: 12,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"kind\":\"running\""));
        assert!(json.contains("\"pid\":4242"));
        assert!(json.contains("\"version\":\"0.1.0\""));
        let back: EngineState = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn engine_state_failed_carries_message() {
        let s = EngineState::Failed {
            message: "boom".into(),
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: EngineState = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn parse_peko_version_accepts_canonical() {
        assert_eq!(
            parse_peko_version("PEKO_VERSION=1.2.3"),
            Some("1.2.3".to_string())
        );
    }

    #[test]
    fn parse_peko_version_accepts_prerelease() {
        assert_eq!(
            parse_peko_version("PEKO_VERSION=0.1.0-rc.1+build.7"),
            Some("0.1.0-rc.1+build.7".to_string())
        );
    }

    #[test]
    fn parse_peko_version_rejects_other_lines() {
        assert_eq!(parse_peko_version("PEKO_VERSION="), None);
        assert_eq!(parse_peko_version("PEKO_VERSION= "), None);
        assert_eq!(
            parse_peko_version("PEKO_VERSION=garbage version with spaces"),
            None
        );
        assert_eq!(parse_peko_version("not a version line"), None);
        assert!(parse_peko_version("PEKO_VERSION=").is_none());
    }

    #[test]
    fn parse_peko_version_rejects_oversized() {
        let huge = "a".repeat(200);
        let line = format!("PEKO_VERSION={huge}");
        assert!(parse_peko_version(&line).is_none());
    }

    #[test]
    fn lockfile_path_contains_desktop_lock() {
        let p = lockfile_path();
        assert!(p.to_string_lossy().contains("desktop.lock"));
        assert!(!p.to_string_lossy().contains("daemon.pid"));
    }

    #[test]
    fn log_ring_caps_at_capacity() {
        let mut g = Inner {
            child: None,
            child_pid: None,
            state: EngineState::Stopped,
            version: None,
            expected_version: None,
            started_at: None,
            first_exit_at: None,
            restart_count: 0,
            last_error: None,
            log_ring: VecDeque::with_capacity(LOG_RING_CAPACITY),
        };
        for i in 0..(LOG_RING_CAPACITY + 50) {
            push_log_inner(&mut g, format!("line {i}"));
        }
        assert_eq!(g.log_ring.len(), LOG_RING_CAPACITY);
        // Oldest entries were evicted; newest entries remain.
        assert_eq!(
            g.log_ring.back().unwrap(),
            &format!("line {}", LOG_RING_CAPACITY + 50 - 1)
        );
    }

    #[test]
    fn version_matches_derivation() {
        // Both sides present and equal → true.
        let (v, e) = (Some("0.1.0".to_string()), Some("0.1.0".to_string()));
        let matches = match (&v, &e) {
            (Some(a), Some(b)) => Some(a == b),
            _ => None,
        };
        assert_eq!(matches, Some(true));

        // Both sides present but different → false.
        let e2 = Some("0.2.0".to_string());
        let matches2 = match (&v, &e2) {
            (Some(a), Some(b)) => Some(a == b),
            _ => None,
        };
        assert_eq!(matches2, Some(false));

        // Either side missing → None.
        let e3: Option<String> = None;
        let matches3 = match (&v, &e3) {
            (Some(a), Some(b)) => Some(a == b),
            _ => None,
        };
        assert_eq!(matches3, None);
    }

    #[test]
    fn socket_path_is_well_formed() {
        let p = socket_path();
        let s = p.to_string_lossy();
        #[cfg(windows)]
        assert!(
            s.contains("11435"),
            "windows socket should be UDP port 11435, got {s}"
        );
        #[cfg(unix)]
        assert!(
            s.contains("daemon.sock"),
            "unix socket should be daemon.sock, got {s}"
        );
    }
}
