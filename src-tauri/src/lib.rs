use tauri::{Emitter, Manager};

pub mod clients;
pub mod commands;
pub mod daemon;
pub mod fs;
pub mod ipc;
pub mod sidecar;
pub mod state;
pub mod tray;
pub mod updater;
pub mod vault;

/// Best-effort lookup of the engine version this desktop bundle was
/// built against. For now this is the desktop's own `Cargo.toml`
/// version (release process guarantees it matches the bundled
/// `peko`); if a more precise contract is needed later, the value
/// can be baked in via `build.rs` from the peko-runtime release tag.
fn expected_engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .manage(tauri::async_runtime::block_on(state::init_state()))
        .setup(|app| {
            // Build system tray
            let _ = tray::build_tray(app.handle())?;

            // Install the sidecar supervisor (ADR-043). This is the
            // canonical owner of the engine lifecycle from now on —
            // the legacy `daemon` module defers to it.
            let supervisor = sidecar::install(&app.handle().clone());
            supervisor.set_expected_version(expected_engine_version());

            // Kick off the first spawn from setup() so the engine is
            // up by the time the UI mounts.
            let supervisor_for_spawn = supervisor.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = tokio::task::spawn_blocking(move || supervisor_for_spawn.start())
                    .await
                    .unwrap_or_else(|e| Err(sidecar::SupervisorError::Spawn(e.to_string())))
                {
                    eprintln!("[peko-desktop] sidecar spawn failed: {e}");
                    let _ = app_handle.emit(
                        "engine-state-changed",
                        &sidecar::EngineState::Failed {
                            message: format!("spawn failed: {e}"),
                        },
                    );
                }
            });

            Ok(())
        })
        .invoke_handler(commands::register_commands())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Graceful shutdown on app exit: stop the sidecar so we
            // don't leave a zombie peko process holding the lockfile.
            // RunEvent::Exit fires after ExitRequested is accepted
            // and the main loop is tearing down.
            if let tauri::RunEvent::Exit = event {
                if let Some(sup) = app_handle.try_state::<std::sync::Arc<sidecar::Supervisor>>() {
                    let sup = sup.inner().clone();
                    let _ = sup.stop();
                }
            }
        });
}
