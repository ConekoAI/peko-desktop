use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use thiserror::Error;

use crate::commands::daemon::DaemonStatus;

#[derive(Error, Debug)]
pub enum TrayError {
    #[error("tray build failed: {0}")]
    BuildFailed(String),
    #[error("not implemented")]
    NotImplemented,
}

pub type Result<T> = std::result::Result<T, TrayError>;

pub fn build_tray(app: &AppHandle) -> Result<TrayIcon> {
    let tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Peko Desktop")
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

pub fn update_tray_status(_status: DaemonStatus) {
    // Placeholder: update tray tooltip or icon based on daemon status
}
