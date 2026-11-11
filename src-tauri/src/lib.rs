use tauri::{AppHandle, Emitter, Listener, Manager};

pub mod clients;
pub mod commands;
pub mod fs;
pub mod ipc;
pub mod sidecar;
pub mod state;
pub mod storage;
pub mod tray;
pub mod updater;

/// The peko-runtime version this app needs: the one its release bundles
/// as the sidecar, and the oldest one it accepts from a daemon it didn't
/// start (peko-runtime ADR-102 D4). It lives in `src-tauri/runtime-version`
/// so the release workflow reads the same value. The app has its own
/// version; the two no longer move together.
fn expected_engine_version() -> String {
    include_str!("../runtime-version").trim().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // Size, position, and the like are restored; decorations are
        // not. They come from the window config (`tauri.macos.conf.json`
        // gives macOS its native buttons), and a state file saved by an
        // older build with `decorated: false` would otherwise hide them
        // for good.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        // PR #6: deep-link plugin. Wires the platform-specific URL
        // handler (macOS Event Mgr, Windows registry, Linux .desktop).
        // The actual scheme list comes from the runtime `register_all`
        // call in the setup closure below + the OS-side metadata
        // (Info.plist `CFBundleURLTypes`, NSIS installer, deb metadata).
        .plugin(tauri_plugin_deep_link::init())
        .manage(tauri::async_runtime::block_on(state::init_state()))
        .setup(|app| {
            // Attached audio and video play from the engine's copies
            // through the asset protocol (WebKit streams them with range
            // requests). Only the pekos' folders are reachable, and the
            // conversations' file stores, where files from other computers
            // are kept (runtime ADR-094) — the webview already reads those
            // conversations over IPC.
            if let Some(home) = crate::commands::system::peko_home() {
                use tauri::Manager;
                // `principals/` is where pekos lived before the runtime
                // moved them to `pekos/`; it stays allowed until a runtime
                // that still uses it has migrated.
                for dir in [
                    home.join("pekos"),
                    home.join("principals"),
                    home.join("runtime").join("channels"),
                ] {
                    if let Err(e) = app.asset_protocol_scope().allow_directory(&dir, true) {
                        eprintln!(
                            "[peko-desktop] attachment playback unavailable in {}: {e}",
                            dir.display()
                        );
                    }
                }
            }
            // PR #6: register the desktop scheme(s) so the OS routes
            // share links into the running app. Windows and Linux register
            // at runtime (`register_all` writes the registry / the
            // `.desktop` MIME entry for every scheme in `tauri.conf.json`);
            // macOS registers from the bundle's Info.plist
            // (`CFBundleURLTypes`), so there is nothing to do here and the
            // plugin would only report an unsupported platform. An
            // unbundled `tauri dev` build on macOS receives no links.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("[peko-desktop] deep-link register_all failed: {e}");
                }
            }

            // PR #6: forward incoming URLs from the OS to the React
            // layer as a `deep-link-received` event. The handler on
            // the JS side parses the URL, distinguishes
            // `peko://add-peko?url=...` (legacy:
            // `peko://add-principal?url=...`) from
            // `https://${hub}/@${owner}/${name}?token=...` (older:
            // `/peko/…`, `/p/…`), and either calls
            // `remotePrincipalAdd` directly or opens
            // the AddRemotePrincipalModal pre-filled. The runtime
            // path keeps both shapes routed through one parser so
            // the JS contract is uniform.
            #[cfg(desktop)]
            {
                use tauri::Emitter;
                use tauri_plugin_deep_link::DeepLinkExt;
                let deep_link_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        let _ = deep_link_handle.emit("deep-link-received", url.as_str());
                    }
                });
            }

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
                if let Err(e) = supervisor_for_spawn.start() {
                    eprintln!("[peko-desktop] sidecar spawn failed: {e}");
                    let _ = app_handle.emit(
                        "engine-state-changed",
                        &sidecar::EngineState::Failed {
                            message: format!("spawn failed: {e}"),
                        },
                    );
                }
            });

            // Bridge: EngineState → RuntimeStatus.
            //
            // The supervisor is the single source of truth for engine
            // lifecycle (ADR-043). The AppState's `RuntimeStatus` is
            // a derived view of that state, updated reactively via the
            // `engine-state-changed` event — never by an independent
            // probe. The legacy init-state probe was racy: it ran
            // before this supervisor existed and produced spurious
            // "Disconnected" labels (and double-spawned the daemon).
            //
            // (a) Initial-state capture handles the race where the
            // supervisor's first emit fires before the listener is
            // registered — without this, a fast-starting engine would
            // be reported as `Disconnected` until its next emit.
            //
            // (b) The listener's EventId is dropped intentionally:
            // Tauri's event system keeps listeners alive for the
            // AppHandle's lifetime, so no `unlisten` is needed. A
            // future reader should not "fix" the dropped handle.
            let app_handle_for_bridge = app.handle().clone();
            let supervisor_for_bridge = supervisor.clone();
            tauri::async_runtime::spawn(async move {
                update_local_runtime(
                    &app_handle_for_bridge,
                    map_engine_state_to_runtime_status(&supervisor_for_bridge.state()),
                )
                .await;

                let listener_handle = app_handle_for_bridge.clone();
                let _ = app_handle_for_bridge.listen("engine-state-changed", move |event| {
                    // Best-effort parse — the supervisor always
                    // emits `EngineState`, but a malformed payload
                    // shouldn't crash the listener. If parsing
                    // fails, leave the current status; the next
                    // emit will retry.
                    if let Ok(engine_state) =
                        serde_json::from_str::<sidecar::EngineState>(event.payload())
                    {
                        let handle = listener_handle.clone();
                        let status = map_engine_state_to_runtime_status(&engine_state);
                        tauri::async_runtime::spawn(async move {
                            update_local_runtime(&handle, status).await;
                        });
                    }
                });
            });

            Ok(())
        })
        .invoke_handler(commands::register_commands())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // macOS: clicking the window's red close button fires
            // `WindowEvent::CloseRequested`, NOT `RunEvent::Exit`.
            // By default Tauri closes just the window and the app
            // stays in the dock — which leaves our owned peko
            // daemon running. Force the app to quit on window
            // close so `Exit` fires below and `sup.stop()` runs.
            // This makes T-104 (close desktop → engine exits)
            // work for both X-click and Cmd+Q paths. Cmd+Q is
            // unaffected: it goes through `ExitRequested → Exit`
            // without invoking CloseRequested.
            if let tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::CloseRequested { .. },
                ..
            } = event
            {
                app_handle.exit(0);
                return;
            }

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

/// Map a supervisor `EngineState` to the AppState's `RuntimeStatus`.
///
/// The supervisor is the canonical owner of the engine lifecycle;
/// this mapping is the single derivation point that turns supervisor
/// state into the local-runtime status the AppState exposes.
fn map_engine_state_to_runtime_status(state: &sidecar::EngineState) -> state::RuntimeStatus {
    use sidecar::EngineState::*;
    match state {
        Running { .. } => state::RuntimeStatus::Connected,
        Starting | Restarting { .. } => state::RuntimeStatus::Connecting,
        Failed { .. } => state::RuntimeStatus::Error,
        Stopped => state::RuntimeStatus::Disconnected,
    }
}

/// Update the AppState's `local` runtime entry with the given status.
///
/// Cheap — the AppState holds an `RwLock<HashMap<…>>`, so this only
/// takes a write lock for the duration of the map insert. The
/// `RuntimeConnection` carries everything else (id, name, ipc_path)
/// that the original `local_default()` set, so only the `status`
/// field needs to change.
async fn update_local_runtime(app_handle: &AppHandle, status: state::RuntimeStatus) {
    let app_state = app_handle.state::<state::AppState>();
    if let Some(mut local) = app_state.get_runtime("local").await {
        local.status = status;
        app_state.set_runtime(local).await;
    }
}

#[cfg(test)]
mod runtime_version_tests {
    #[test]
    fn the_pinned_runtime_version_is_a_plain_version() {
        let v = super::expected_engine_version();
        assert!(
            crate::sidecar::parse_release(&v).is_some() && !v.contains(['-', '+']),
            "src-tauri/runtime-version must be X.Y.Z, got {v:?}"
        );
    }
}
