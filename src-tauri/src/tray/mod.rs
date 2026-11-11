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

/// The menu's items, kept so their labels can follow the app's language.
pub struct TrayItems {
    open: MenuItem<tauri::Wry>,
    start_engine: MenuItem<tauri::Wry>,
    stop_engine: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

/// The menu's labels in the language the app is shown in.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    open: String,
    start_engine: String,
    stop_engine: String,
    quit: String,
}

/// Relabel the tray menu. The page owns the app's text (`src/i18n`), so it
/// sends the labels at start and whenever the language changes; until then
/// the menu shows the English it was built with.
#[tauri::command]
pub fn tray_set_labels(app: AppHandle, labels: TrayLabels) -> std::result::Result<(), String> {
    let Some(items) = app.try_state::<TrayItems>() else {
        return Ok(());
    };
    for (item, text) in [
        (&items.open, &labels.open),
        (&items.start_engine, &labels.start_engine),
        (&items.stop_engine, &labels.stop_engine),
        (&items.quit, &labels.quit),
    ] {
        item.set_text(text).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn build_tray(app: &AppHandle) -> Result<TrayIcon> {
    let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)
        .map_err(|e| TrayError::BuildFailed(e.to_string()))?;
    let start_daemon_i = MenuItem::with_id(app, "start_daemon", "Start engine", true, None::<&str>)
        .map_err(|e| TrayError::BuildFailed(e.to_string()))?;
    let stop_daemon_i = MenuItem::with_id(app, "stop_daemon", "Stop engine", true, None::<&str>)
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

    app.manage(TrayItems {
        open: open_i.clone(),
        start_engine: start_daemon_i.clone(),
        stop_engine: stop_daemon_i.clone(),
        quit: quit_i.clone(),
    });

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
            // "Start engine" / "Stop engine" items share the same
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
