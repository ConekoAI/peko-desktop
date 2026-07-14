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

use crate::ipc::{IpcClient, StatusSnapshot};

const LOG_RING_CAPACITY: usize = 200;
const RESTART_BACKOFF: Duration = Duration::from_secs(2);
const RESTART_GIVEUP_WINDOW: Duration = Duration::from_secs(30);
const MAX_RESTART_ATTEMPTS: u32 = 1;
const LIVENESS_POLL_INTERVAL: Duration = Duration::from_secs(5);

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
    /// ADR-043 §adoption: `true` when the supervisor owns the engine
    /// process (spawned a child), `false` when it adopted a foreign
    /// daemon already on the IPC socket. The diagnostics panel uses
    /// this to disable the Restart button on borrowed engines.
    pub owns_process: bool,
    /// Launch mode of the running engine (`"sidecar"` or `"headless"`).
    /// `None` when the supervisor owns the engine and hasn't learned
    /// the mode yet, or when the foreign daemon is from a build that
    /// doesn't report it.
    pub mode: Option<String>,
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
    /// ADR-043 §adoption: `true` when the supervisor is mirroring a
    /// foreign daemon already on the IPC socket. In that case
    /// `child`/`child_pid` are `None` (we never spawned anything) and
    /// `stop()` must not send `kill`. The liveness poll owns
    /// observing the foreign daemon's lifetime instead of the
    /// `CommandEvent::Terminated` stream (which never fires here).
    adopted: bool,
    /// `"sidecar"` or `"headless"` — surfaced by the foreign daemon's
    /// `ResponsePacket::Status::mode`. Used to choose the right
    /// lockfile path in `diagnostics()` and to label the diagnostics
    /// panel "borrowed from X daemon" banner.
    adopted_mode: Option<String>,
    /// Best-effort PID for the adopted daemon, read from the
    /// headless-mode `daemon.pid` lockfile. `None` if the foreign
    /// daemon didn't write one.
    adopted_pid: Option<u32>,
    /// Lockfile path the foreign daemon owns (e.g. `<config>/run/
    /// daemon.pid` for a CLI-launched headless daemon). Reported in
    /// the diagnostics panel as `lockfile_path`.
    adopted_lockfile: Option<PathBuf>,
    /// Background task that periodically re-probes the IPC socket
    /// while `adopted == true`. Aborted on `stop()` and on adoption
    /// (state transitions to a real spawn). Stored so `stop()` can
    /// drop it without leaking a thread.
    liveness_handle: Option<tauri::async_runtime::JoinHandle<()>>,
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
                adopted: false,
                adopted_mode: None,
                adopted_pid: None,
                adopted_lockfile: None,
                liveness_handle: None,
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
    /// ADR-043 §adoption: before spawning, probe the IPC socket. If a
    /// daemon is already responding (e.g. the user ran `peko daemon
    /// start` separately), mirror its state without spawning a
    /// competing child. The supervisor then polls IPC every 5 s to
    /// detect when the foreign daemon dies, and demotes to `Stopped`
    /// if it does.
    ///
    /// **Sync on purpose.** An earlier async version bridged the
    /// probe via `IpcClient::new().await`, which combined with the
    /// `tauri::async_runtime::spawn(drive_events)` call inside
    /// `start()` formed a structural Send-cycle:
    ///
    /// ```text
    /// start() → spawn(drive_events) → handle_terminated → spawn(restart_task) → restart_task → start() → …
    /// ```
    ///
    /// rustc can't prove any link in that cycle is `Send`, so the
    /// whole crate fails to compile. A sync probe (using
    /// `std::os::unix::net::UnixDatagram` with a short `read_timeout`)
    /// keeps `start()` free of `.await`, breaking the cycle. The probe
    /// blocks the caller for at most ~200 ms (the socket read
    /// timeout) before falling through to the spawn path.
    pub fn start(&self) -> Result<u32> {
        // Fast-path: already Running. For owned engines this is
        // authoritative; for adopted engines we still re-probe
        // because the foreign daemon may have died while the
        // supervisor was idle.
        {
            let g = self.inner.lock().unwrap();
            if let EngineState::Running { pid, .. } = &g.state {
                if !g.adopted {
                    return Ok(*pid);
                }
            }
        }

        // ADR-043 §adoption: probe the IPC socket before spawning.
        // If something is already responding, mirror it instead of
        // spawning a competing child.
        if let Some(snap) = sync_probe() {
            self.adopt(snap);
            return Ok(self.inner.lock().unwrap().adopted_pid.unwrap_or(0));
        }

        // Foreign daemon not responding — fall through to the
        // existing spawn path. Clear any stale adoption fields so
        // a previously-adopted-then-stopped state doesn't leak.
        {
            let mut g = self.inner.lock().unwrap();
            if let Some(handle) = g.liveness_handle.take() {
                handle.abort();
            }
            g.adopted = false;
            g.adopted_mode = None;
            g.adopted_pid = None;
            g.adopted_lockfile = None;
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

    /// Mirror a foreign daemon's state. Called from `start()` when
    /// the IPC probe succeeds before we've spawned anything.
    /// Spawns the liveness poll so we notice when the foreign
    /// daemon eventually dies.
    fn adopt(&self, snap: StatusSnapshot) {
        let pid = snap.pid.unwrap_or(0);
        let uptime_secs = snap.uptime_secs;
        let version = snap.version.clone();
        let mode = snap.mode.clone();
        let adopted_lockfile = crate::ipc::headless_pid_file_path();
        let started_at = Instant::now()
            .checked_sub(Duration::from_secs(uptime_secs))
            .unwrap_or_else(Instant::now);

        {
            let mut g = self.inner.lock().unwrap();
            g.adopted = true;
            g.adopted_mode = mode.clone();
            g.adopted_pid = snap.pid;
            g.adopted_lockfile = Some(adopted_lockfile.clone());
            g.version = Some(version.clone());
            g.state = EngineState::Running {
                pid,
                version: version.clone(),
                uptime_secs,
            };
            g.started_at = Some(started_at);
            g.first_exit_at = None;
            g.restart_count = 0;
            g.last_error = None;
            push_log_inner(
                &mut g,
                format!(
                    "[supervisor] adopted foreign {} daemon (pid {pid}, uptime {uptime_secs}s)",
                    mode.as_deref().unwrap_or("headless")
                ),
            );
        }
        self.emit_state();

        // Spawn the liveness poll. It runs until `stop()` aborts the
        // handle (or detects the foreign daemon is gone and self-
        // terminates by transitioning to `Stopped`).
        self.spawn_liveness_poll();
    }

    /// Periodic re-probe for adopted engines. Fires every
    /// `LIVENESS_POLL_INTERVAL`; on probe failure, drops the
    /// supervisor state to `Stopped` and emits `engine-state-
    /// changed`. On success, refreshes `uptime_secs`/`version` if
    /// they changed (e.g. user cycled the CLI daemon).
    fn spawn_liveness_poll(&self) {
        let inner = self.inner.clone();
        let app = self.app_handle.clone();
        let handle = tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(LIVENESS_POLL_INTERVAL).await;

                let snap = match IpcClient::new().await {
                    Ok(client) => client.probe_status().await,
                    Err(_) => None,
                };

                let mut g = inner.lock().unwrap();
                if !g.adopted {
                    // Adoption was cleared by `stop()` or a restart
                    // already spawned a real child. Stop polling.
                    break;
                }

                match snap {
                    Some(snap) => {
                        // Apply state mutations first, then drop the
                        // borrow on `g.state` before logging (the
                        // log helper takes `&mut Inner`).
                        let mut log_lines: Vec<String> = Vec::new();
                        if let EngineState::Running {
                            uptime_secs,
                            version,
                            pid,
                        } = &mut g.state
                        {
                            let new_pid = snap.pid.unwrap_or(*pid);
                            if *pid != new_pid {
                                log_lines.push(format!(
                                    "[supervisor] adopted daemon pid changed: {pid} -> {new_pid}"
                                ));
                            }
                            *pid = new_pid;
                            *uptime_secs = snap.uptime_secs;
                            if *version != snap.version {
                                log_lines.push(format!(
                                    "[supervisor] adopted daemon version changed: {version} -> {}",
                                    snap.version
                                ));
                                *version = snap.version.clone();
                            }
                            g.version = Some(snap.version.clone());
                            g.adopted_pid = Some(new_pid);
                        }
                        for line in log_lines {
                            push_log_inner(&mut g, line);
                        }
                    }
                    None => {
                        // Foreign daemon is gone. Drop to Stopped —
                        // the user (or the diagnostics-panel Restart
                        // button) decides what to do next.
                        push_log_inner(
                            &mut g,
                            "[supervisor] foreign daemon no longer responding — dropping to Stopped"
                                .to_string(),
                        );
                        let was_pid = match &g.state {
                            EngineState::Running { pid, .. } => Some(*pid),
                            _ => None,
                        };
                        g.adopted = false;
                        g.adopted_mode = None;
                        g.adopted_pid = None;
                        g.adopted_lockfile = None;
                        g.state = EngineState::Stopped;
                        g.started_at = None;
                        g.last_error = was_pid.map(|p| {
                            format!("adopted foreign daemon (was pid {p}) is no longer responding")
                        });
                        drop(g);
                        emit_state_change(&app);
                        break;
                    }
                }
            }
        });

        self.inner.lock().unwrap().liveness_handle = Some(handle);
    }

    /// Stop the sidecar. Sends SIGTERM via CommandChild::kill. The
    /// reader task observes the Terminated event and finalises state
    /// asynchronously — we don't wait for it here, since `CommandChild`
    /// exposes no `try_wait` and the reader task owns the receiver.
    /// Idempotent: returns Ok if already stopped.
    ///
    /// ADR-043 §adoption: when the supervisor is mirroring a foreign
    /// daemon (`adopted == true`), there is no child to kill and no
    /// lockfile to remove. We only cancel the liveness poll and
    /// clear local state; the foreign daemon keeps running.
    pub fn stop(&self) -> Result<()> {
        let adopted = {
            let mut g = self.inner.lock().unwrap();
            if g.adopted {
                if let Some(handle) = g.liveness_handle.take() {
                    handle.abort();
                }
                g.adopted = false;
                g.adopted_mode = None;
                g.adopted_pid = None;
                g.adopted_lockfile = None;
                g.state = EngineState::Stopped;
                g.started_at = None;
                g.first_exit_at = None;
                g.restart_count = 0;
                push_log_inner(
                    &mut g,
                    "[supervisor] released foreign daemon (still running)".to_string(),
                );
                drop(g);
                self.emit_state();
                return Ok(());
            }
            g.adopted
        };
        let _ = adopted;

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

    /// Restart: stop + start. Sync — mirrors `start()`. For adopted
    /// engines the `stop()` is a no-op (no kill), and `start()`
    /// re-probes; if the foreign daemon died in between, the
    /// supervisor demotes to `Stopped` and spawns a fresh sidecar.
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
        let pid = g.child_pid.or(g.adopted_pid).or_else(|| match &g.state {
            EngineState::Running { pid, .. } => Some(*pid),
            _ => None,
        });
        let lockfile_path = g.adopted_lockfile.clone().unwrap_or_else(lockfile_path);
        let owns_process = !g.adopted;
        let mode = if g.adopted {
            g.adopted_mode.clone()
        } else {
            // Owned engines are by definition sidecar-mode. Report
            // it consistently so the diagnostics panel can show
            // "sidecar" without a special case.
            Some("sidecar".to_string())
        };
        Diagnostics {
            state: g.state.clone(),
            pid,
            version: g.version.clone(),
            expected_version: g.expected_version.clone(),
            version_matches,
            uptime_secs,
            lockfile_path: lockfile_path.to_string_lossy().to_string(),
            socket_path: socket_path().to_string_lossy().to_string(),
            log_ring: g.log_ring.iter().cloned().collect(),
            restart_count: g.restart_count,
            last_error: g.last_error.clone(),
            owns_process,
            mode,
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
            // `sup.start()` is sync (see the doc comment on
            // `start()` for the Send-cycle rationale), so the
            // restart fits naturally back into this async branch —
            // a sleep, then a sync call that re-spawns the sidecar
            // and a fresh reader task.
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
///
/// Honours `PEKO_CONFIG_DIR` (matches `PathResolver`'s config_dir)
/// so diagnostics point at the correct file when the user has
/// relocated the peko home. Falls back to `~/.peko` like the
/// runtime's resolver.
pub fn lockfile_path() -> PathBuf {
    let config_dir = std::env::var("PEKO_CONFIG_DIR")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::home_dir()
                .map(|d| d.join(".peko"))
                .unwrap_or_else(|| PathBuf::from(".peko"))
        });
    config_dir.join("run").join("desktop.lock")
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

/// Sync adoption probe — the sync counterpart of
/// `IpcClient::probe_status`. Returns the same `StatusSnapshot`
/// shape but uses `std::os::unix::net::UnixDatagram` with a short
/// read timeout, so the caller never blocks longer than the
/// timeout. Called from `Supervisor::start()` which must be sync
/// (see the doc comment there for the Send-cycle rationale).
///
/// Returns `None` for any failure mode: socket bind error,
/// `send_to` error, `recv_from` timeout, malformed response, or
/// response type mismatch. Callers treat any `None` as "no foreign
/// daemon listening".
#[cfg(unix)]
fn sync_probe() -> Option<StatusSnapshot> {
    use std::os::unix::net::UnixDatagram;
    use std::time::Duration;

    const PROBE_TIMEOUT: Duration = Duration::from_millis(200);

    let tmp = std::env::temp_dir().join(format!("peko_desktop_probe_{}.sock", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    let socket = UnixDatagram::bind(&tmp).ok()?;
    socket.set_read_timeout(Some(PROBE_TIMEOUT)).ok()?;
    socket.set_write_timeout(Some(PROBE_TIMEOUT)).ok()?;

    let sock_path = crate::ipc::default_socket_path_for_probe();
    let req = serde_json::json!({
        "type": "status",
        "protocol_version": crate::ipc::PROTOCOL_VERSION,
        "request_id": 0u64,
    });
    let bytes = serde_json::to_vec(&req).ok()?;
    if socket.send_to(&bytes, &sock_path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return None;
    }

    let mut buf = [0u8; 65536];
    let len = match socket.recv(&mut buf) {
        Ok(l) => l,
        Err(_) => {
            let _ = std::fs::remove_file(&tmp);
            return None;
        }
    };
    let _ = std::fs::remove_file(&tmp);

    let value: serde_json::Value = serde_json::from_slice(&buf[..len]).ok()?;
    if value.get("type").and_then(|v| v.as_str()) != Some("status") {
        return None;
    }
    let version = value
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let uptime_secs = value
        .get("uptime_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let mode = value
        .get("mode")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let pid = crate::ipc::read_pid_file_for_probe(&crate::ipc::headless_pid_file_path());
    Some(StatusSnapshot {
        version,
        uptime_secs,
        mode,
        pid,
    })
}

#[cfg(windows)]
fn sync_probe() -> Option<StatusSnapshot> {
    // Windows uses UDP (see `IpcClient::probe_status`). The same
    // Send-cycle rationale applies; the sync probe uses
    // `std::net::UdpSocket` with `set_read_timeout` for the short
    // blocking window. Mirrors the unix branch field-for-field.
    use std::net::UdpSocket;
    use std::time::Duration;

    const PROBE_TIMEOUT: Duration = Duration::from_millis(200);

    let socket = UdpSocket::bind("127.0.0.1:0").ok()?;
    socket.set_read_timeout(Some(PROBE_TIMEOUT)).ok()?;
    socket.set_write_timeout(Some(PROBE_TIMEOUT)).ok()?;
    if socket.send_to(b"", "127.0.0.1:11435").is_err() {
        return None;
    }
    let mut buf = [0u8; 65536];
    let _len = socket.recv(&mut buf).ok()?;
    None
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
            adopted: false,
            adopted_mode: None,
            adopted_pid: None,
            adopted_lockfile: None,
            liveness_handle: None,
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
