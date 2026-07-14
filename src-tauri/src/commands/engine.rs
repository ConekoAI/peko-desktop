//! Tauri command surface for the sidecar supervisor (ADR-043).
//!
//! These are the public commands the frontend uses to query engine
//! state and (in the diagnostics panel exposed by PR #27) drive
//! manual restart. The `engine_status` command is intentionally
//! cheap — a clone of an `Arc<Mutex<Inner>>` snapshot — so the UI
//! can poll it on a tight cadence.

use crate::sidecar::{self, Diagnostics, EngineState};

/// Idempotent status snapshot. Mirrors `daemon_status` but typed
/// against the supervisor's `EngineState` so the UI can drive the
/// status badge / banners from a single source of truth.
#[tauri::command]
pub fn engine_status() -> EngineState {
    let app = crate::sidecar::current_app_handle()
        .expect("engine_status invoked before supervisor install");
    sidecar::get(&app).state()
}

/// Full diagnostics bundle for the power-user panel: PID, version
/// comparison, lockfile / socket paths, recent log ring buffer,
/// restart count, last error. Surfaces only in the "Show internal
/// status" toggle (PR #27).
#[tauri::command]
pub fn engine_diagnostics() -> Diagnostics {
    let app = crate::sidecar::current_app_handle()
        .expect("engine_diagnostics invoked before supervisor install");
    sidecar::get(&app).diagnostics()
}

/// Manual restart hook for the diagnostics panel. The frontend
/// should not call this in normal operation — the supervisor
/// auto-restarts on unexpected exit and the user closes the app
/// to fully cycle the engine. This exists so a developer / support
/// agent can recover from a `Failed` state without quitting.
#[tauri::command]
pub async fn engine_restart() -> Result<u32, String> {
    let app = crate::sidecar::current_app_handle()
        .expect("engine_restart invoked before supervisor install");
    tokio::task::spawn_blocking(move || sidecar::get(&app).restart())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
