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
    quit: MenuItem<tauri::Wry>,
}

/// The menu's labels in the language the app is shown in.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    open: String,
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
    for (item, text) in [(&items.open, &labels.open), (&items.quit, &labels.quit)] {
        item.set_text(text).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Whether the tray icon exists. Without it a hidden window could not be
/// brought back, so closing the window must quit the app instead.
pub fn is_present(app: &AppHandle) -> bool {
    app.try_state::<TrayItems>().is_some()
}

/// Bring the app's window back and put it in front.
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn build_tray(app: &AppHandle) -> Result<TrayIcon> {
    let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)
        .map_err(|e| TrayError::BuildFailed(e.to_string()))?;
    let separator =
        PredefinedMenuItem::separator(app).map_err(|e| TrayError::BuildFailed(e.to_string()))?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|e| TrayError::BuildFailed(e.to_string()))?;

    let menu = Menu::with_items(app, &[&open_i, &separator, &quit_i])
        .map_err(|e| TrayError::BuildFailed(e.to_string()))?;

    app.manage(TrayItems {
        open: open_i.clone(),
        quit: quit_i.clone(),
    });

    let tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Peko Desktop")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
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
                show_main_window(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|e: tauri::Error| TrayError::BuildFailed(e.to_string()))?;
    Ok(tray)
}
