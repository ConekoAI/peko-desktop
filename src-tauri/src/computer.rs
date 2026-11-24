//! A peko using this computer (runtime ADR-123 D5): the indicator strip,
//! its **Stop** and **Let it continue**, and the global stop shortcut.
//!
//! While the engine runs, this asks it once a second whether a peko is
//! using the screen (`computer_state`). When one is, a small strip shows
//! at the top of the main screen, always on top: which peko, what it is
//! doing, **Stop**, and when your mouse or keyboard paused it, **Let it
//! continue**. The strip is shown without taking focus (it would pull
//! the app the peko works in out of the front), and it is left out of
//! screen captures (`NSWindow.sharingType = .none`, Windows
//! `WDA_EXCLUDEFROMCAPTURE`) and out of the windows the engine lists (its
//! title), so the peko never sees or clicks it.
//!
//! [`STOP_SHORTCUT`] stops every peko using the screen, from any app.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The strip's window label.
pub const STRIP_LABEL: &str = "computer-strip";

/// The strip's title: the runtime leaves windows of this title out of what
/// a peko lists and captures (`computer::INDICATOR_TITLE`).
pub const STRIP_TITLE: &str = "Peko is using this computer";

/// Stops every peko using the screen. Ctrl+Alt+Shift+Escape on Windows,
/// Control+Option+Shift+Escape on a Mac: nothing common uses it on either
/// (Ctrl+Shift+Escape opens Task Manager and Cmd+Option+Escape Force Quit;
/// the extra modifier keeps clear of both).
pub const STOP_SHORTCUT: &str = "Control+Alt+Shift+Escape";

const STRIP_WIDTH: f64 = 420.0;
const STRIP_HEIGHT: f64 = 46.0;

/// The state the strip shows, as the engine reported it.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct StripState {
    pub peko: Option<String>,
    pub action: Option<String>,
    pub paused: bool,
}

fn strip_state(body: &serde_json::Value) -> Option<StripState> {
    let paused = body.get("paused").filter(|p| !p.is_null());
    let using = body.get("using").filter(|u| !u.is_null());
    if paused.is_none() && using.is_none() {
        return None;
    }
    let peko = paused
        .and_then(|p| p.get("peko"))
        .or_else(|| using.and_then(|u| u.get("peko")))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    Some(StripState {
        peko,
        action: using
            .and_then(|u| u.get("action"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        paused: paused.is_some(),
    })
}

/// The engine's `computer_result` body, or an error.
fn result_body(value: serde_json::Value) -> Result<serde_json::Value, String> {
    if value.get("type").and_then(|t| t.as_str()) == Some("error") {
        return Err(value
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("the engine refused")
            .to_string());
    }
    value
        .get("body")
        .cloned()
        .ok_or_else(|| "the engine gave no answer".to_string())
}

async fn client() -> Result<crate::ipc::IpcClient, String> {
    crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))
}

/// Whether the engine this app supervises is up (the strip never starts
/// it).
fn engine_running(app: &AppHandle) -> bool {
    crate::sidecar::get(app).is_running()
}

/// Watch the engine and show or hide the strip. Started once, from
/// `setup`.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut shown = false;
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let state = if engine_running(&app) {
                match client().await {
                    Ok(c) => c
                        .computer_state()
                        .await
                        .ok()
                        .and_then(|v| result_body(v).ok())
                        .and_then(|b| strip_state(&b)),
                    Err(_) => None,
                }
            } else {
                None
            };
            match state {
                Some(state) => {
                    if let Some(window) = strip(&app) {
                        let _ = window.emit("computer-state", &state);
                        if !shown {
                            show(&window);
                            shown = true;
                        }
                    }
                }
                None if shown => {
                    if let Some(window) = app.get_webview_window(STRIP_LABEL) {
                        hide(&window);
                    }
                    shown = false;
                }
                None => {}
            }
        }
    });
}

/// The strip window, made on first use.
fn strip(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(window) = app.get_webview_window(STRIP_LABEL) {
        return Some(window);
    }
    let window = WebviewWindowBuilder::new(
        app,
        STRIP_LABEL,
        WebviewUrl::App("computer-strip.html".into()),
    )
    .title(STRIP_TITLE)
    .inner_size(STRIP_WIDTH, STRIP_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false);
    // One click on Stop works even while Peko is not the active app.
    #[cfg(target_os = "macos")]
    let window = window.accept_first_mouse(true);
    let window = window.build();
    let window = match window {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[peko-desktop] no computer-use indicator: {e}");
            return None;
        }
    };
    exclude_from_capture(&window);
    place(app, &window);
    Some(window)
}

/// Top centre of the main screen.
fn place(app: &AppHandle, window: &WebviewWindow) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<f64>(scale);
    let origin = monitor.position().to_logical::<f64>(scale);
    let _ = window.set_position(tauri::LogicalPosition::new(
        origin.x + (size.width - STRIP_WIDTH) / 2.0,
        origin.y + 34.0,
    ));
}

/// AppKit allows window changes only on the main thread: run `f` with the
/// strip's `NSWindow` there.
#[cfg(target_os = "macos")]
fn with_ns_window(window: &WebviewWindow, f: fn(*mut objc2::runtime::AnyObject)) {
    let Ok(ns) = window.ns_window() else { return };
    if ns.is_null() {
        return;
    }
    let ns = ns as usize;
    let _ = window.run_on_main_thread(move || f(ns as *mut objc2::runtime::AnyObject));
}

#[cfg(target_os = "macos")]
fn exclude_from_capture(window: &WebviewWindow) {
    with_ns_window(window, |ns| {
        // NSWindowSharingNone = 0.
        let _: () = unsafe { objc2::msg_send![ns, setSharingType: 0usize] };
    });
}

#[cfg(windows)]
fn exclude_from_capture(window: &WebviewWindow) {
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowDisplayAffinity(hwnd: isize, affinity: u32) -> i32;
    }
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x11;
    if let Ok(hwnd) = window.hwnd() {
        let hwnd = hwnd.0 as isize;
        let _ = window.run_on_main_thread(move || unsafe {
            SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
        });
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn exclude_from_capture(_window: &WebviewWindow) {}

/// Show without taking focus: making the strip key would bring Peko
/// Desktop to the front, out from under the app the peko works in.
#[cfg(target_os = "macos")]
fn show(window: &WebviewWindow) {
    with_ns_window(window, |ns| {
        let _: () = unsafe { objc2::msg_send![ns, orderFrontRegardless] };
    });
}

#[cfg(windows)]
fn show(window: &WebviewWindow) {
    #[link(name = "user32")]
    extern "system" {
        fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
    }
    const SW_SHOWNOACTIVATE: i32 = 4;
    if let Ok(hwnd) = window.hwnd() {
        let hwnd = hwnd.0 as isize;
        let _ = window.run_on_main_thread(move || unsafe {
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        });
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn show(window: &WebviewWindow) {
    let _ = window.show();
}

fn hide(window: &WebviewWindow) {
    let _ = window.hide();
}

/// The global stop shortcut, registered once from `setup`.
pub fn register_shortcut(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let handle = app.clone();
    let result = app
        .global_shortcut()
        .on_shortcut(STOP_SHORTCUT, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                eprintln!("[peko-desktop] stop shortcut: stopping the peko using the screen");
                let handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    if !engine_running(&handle) {
                        return;
                    }
                    if let Ok(c) = client().await {
                        let _ = c.computer_stop().await;
                    }
                });
            }
        });
    match result {
        Ok(()) => eprintln!("[peko-desktop] stop shortcut registered: {STOP_SHORTCUT}"),
        Err(e) => eprintln!("[peko-desktop] no stop shortcut ({STOP_SHORTCUT}): {e}"),
    }
}

// ─── Commands ──────────────────────────────────────────────────────────

/// `computer_state`, for the settings page: grants, and who uses the
/// screen.
#[tauri::command]
pub async fn computer_status() -> Result<serde_json::Value, String> {
    let c = client().await?;
    result_body(c.computer_state().await.map_err(|e| e.to_string())?)
}

/// **Let it continue**.
#[tauri::command]
pub async fn computer_resume() -> Result<serde_json::Value, String> {
    let c = client().await?;
    result_body(c.computer_resume().await.map_err(|e| e.to_string())?)
}

/// **Stop**.
#[tauri::command]
pub async fn computer_stop() -> Result<serde_json::Value, String> {
    let c = client().await?;
    result_body(c.computer_stop().await.map_err(|e| e.to_string())?)
}

/// Ask macOS for the grants (the engine asks, for the app that started
/// it).
#[tauri::command]
pub async fn computer_setup() -> Result<serde_json::Value, String> {
    let c = client().await?;
    result_body(c.computer_setup().await.map_err(|e| e.to_string())?)
}

/// The stop shortcut, as the settings page shows it.
#[tauri::command]
pub fn computer_stop_shortcut() -> String {
    if cfg!(target_os = "macos") {
        "⌃⌥⇧⎋".to_string()
    } else {
        "Ctrl+Alt+Shift+Esc".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_strip_shows_only_while_a_peko_uses_the_screen() {
        assert!(strip_state(&json!({"using": null, "paused": null})).is_none());
        let s = strip_state(&json!({
            "using": {"peko": "mochi", "action": "clicking in Peko"},
            "paused": null
        }))
        .unwrap();
        assert_eq!(s.peko.as_deref(), Some("mochi"));
        assert!(!s.paused);
        let s = strip_state(&json!({"using": null, "paused": {"peko": "mochi"}})).unwrap();
        assert!(s.paused);
    }

    #[test]
    fn the_title_is_the_one_the_engine_leaves_out() {
        assert_eq!(STRIP_TITLE, "Peko is using this computer");
    }

    #[test]
    fn engine_errors_come_through() {
        assert_eq!(
            result_body(json!({"type": "error", "message": "[permission_denied] no"})).unwrap_err(),
            "[permission_denied] no"
        );
        assert_eq!(
            result_body(json!({"type": "computer_result", "body": {"available": true}})).unwrap(),
            json!({"available": true})
        );
    }
}
