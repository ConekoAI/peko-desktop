//! In-app updates.
//!
//! The app asks its update feed (`plugins.updater.endpoints` in
//! `tauri.conf.json`: `latest.json` on the newest GitHub release) whether
//! a newer version exists, and installs it in place: download, verify the
//! signature against the public key in the config, stop the engine,
//! replace the app, start again.
//!
//! There are two feeds while the app moves into the ConekoAI/Peko
//! repository: Peko's first, then this repository's. The updater skips a
//! feed with no `latest.json` and uses the first one that has it, so this
//! app follows Peko's releases once they carry the app.
//!
//! The engine is stopped first because the update replaces its binary,
//! which Windows won't do while it runs. An engine this app only watches
//! (one started from the command line) is left running.
//!
//! A Linux install from a `.deb` or `.rpm` can't replace itself: the
//! package manager owns those files. There the app only says a newer
//! version exists.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

/// What the app knows about a newer version of itself.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// The version running now.
    pub current: String,
    /// The newer version on offer, if any.
    pub available: Option<String>,
    /// Whether this install can replace itself. False for a Linux package
    /// install; the person then gets the new version from the download page.
    pub can_install: bool,
}

/// Download progress, emitted as `update-progress`.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateProgress {
    pub downloaded: u64,
    /// The size of the download, when the server says.
    pub total: Option<u64>,
}

/// Whether this install can replace itself (see the module docs).
fn can_install(platform: &str, appimage: bool) -> bool {
    platform != "linux" || appimage
}

fn this_install_can_update() -> bool {
    can_install(std::env::consts::OS, std::env::var_os("APPIMAGE").is_some())
}

/// Whether the build names a key to verify updates with. A build
/// without one has no update feed to trust, so it never asks.
fn has_update_key(config: &tauri::Config) -> bool {
    config
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(serde_json::Value::as_str)
        .is_some_and(|key| !key.trim().is_empty())
}

/// Ask the update feed whether a newer version exists.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<UpdateStatus, String> {
    let current = app.package_info().version.to_string();
    let can_install = this_install_can_update();
    if !has_update_key(app.config()) {
        return Ok(UpdateStatus {
            current,
            available: None,
            can_install,
        });
    }
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Couldn't check for updates: {e}"))?;
    Ok(UpdateStatus {
        current,
        available: update.map(|u| u.version),
        can_install,
    })
}

/// Download the newer version, install it and start it. Returns only on
/// failure, or when there was nothing newer: on success the app restarts.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    if !this_install_can_update() {
        return Err("This install can't update itself.".to_string());
    }
    let Some(update) = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Couldn't check for updates: {e}"))?
    else {
        return Ok(());
    };

    let progress_app = app.clone();
    let mut downloaded: u64 = 0;
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit("update-progress", UpdateProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| format!("The update couldn't be downloaded: {e}"))?;

    // The update replaces the engine's binary; pekos pick up where they
    // were when it starts again (runs recover on their own).
    let supervisor = app
        .try_state::<std::sync::Arc<crate::sidecar::Supervisor>>()
        .map(|s| s.inner().clone());
    if let Some(supervisor) = &supervisor {
        let _ = supervisor.stop();
    }
    if let Err(e) = update.install(bytes) {
        // Nothing was replaced: bring the engine back.
        if let Some(supervisor) = &supervisor {
            let _ = supervisor.start();
        }
        return Err(format!("The update couldn't be installed: {e}"));
    }
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_linux_package_install_cannot_update_itself() {
        assert!(can_install("macos", false));
        assert!(can_install("windows", false));
        assert!(can_install("linux", true));
        assert!(!can_install("linux", false));
    }

    #[test]
    fn status_reaches_the_webview_in_camel_case() {
        let status = UpdateStatus {
            current: "0.1.5".into(),
            available: Some("0.1.6".into()),
            can_install: true,
        };
        assert_eq!(
            serde_json::to_value(&status).unwrap(),
            serde_json::json!({ "current": "0.1.5", "available": "0.1.6", "canInstall": true })
        );
    }
}
