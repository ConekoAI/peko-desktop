use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum TrayError {
    #[error("tray build failed: {0}")]
    BuildFailed(String),
}

pub type Result<T> = std::result::Result<T, TrayError>;

pub fn build_tray(app: &AppHandle) -> Result<TrayIcon> {
    let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)
        .map_err(|e| TrayError::BuildFailed(e.to_string()))?;
    let start_daemon_i = MenuItem::with_id(app, "start_daemon", "Start Daemon", true, None::<&str>)
        .map_err(|e| TrayError::BuildFailed(e.to_string()))?;
    let stop_daemon_i = MenuItem::with_id(app, "stop_daemon", "Stop Daemon", true, None::<&str>)
        .map_err(|e| TrayError::BuildFailed(e.to_string()))?;
    let separator =
        PredefinedMenuItem::separator(app).map_err(|e| TrayError::BuildFailed(e.to_string()))?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|e| TrayError::BuildFailed(e.to_string()))?;

    let menu = Menu::with_items(
        app,
        &[
            &open_i,
            &start_daemon_i,
            &stop_daemon_i,
            &separator,
            &quit_i,
        ],
    )
    .map_err(|e| TrayError::BuildFailed(e.to_string()))?;

    let tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Peko Desktop")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            // ADR-043: route through the supervisor so the tray's
            // "Start Daemon" / "Stop Daemon" buttons share the same
            // child handle as the Tauri commands. The previous
            // `crate::daemon::start()`/`stop()` path spawned a
            // separate `peko daemon start` child and tracked it in
            // `DAEMON_CHILD` — orphaned when the supervisor adopted
            // or restarted the engine under the same IPC socket.
            "start_daemon" => {
                let _ = crate::sidecar::get(app).start();
            }
            "stop_daemon" => {
                let _ = crate::sidecar::get(app).stop();
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray: &TrayIcon, event: TrayIconEvent| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)
        .map_err(|e: tauri::Error| TrayError::BuildFailed(e.to_string()))?;
    Ok(tray)
}
