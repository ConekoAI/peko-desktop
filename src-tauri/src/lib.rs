use tauri::Emitter;

pub mod clients;
pub mod commands;
pub mod daemon;
pub mod fs;
pub mod ipc;
pub mod state;
pub mod tray;
pub mod updater;
pub mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .manage(tauri::async_runtime::block_on(state::init_state()))
        .setup(|app| {
            // Build system tray
            let _ = tray::build_tray(app.handle())?;
            
            // Auto-start daemon on app launch (non-blocking)
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match daemon::ensure_running_async().await {
                    Ok(pid) => {
                        let _ = app_handle.emit("daemon-auto-started", pid);
                    }
                    Err(e) => {
                        let _ = app_handle.emit("daemon-auto-start-failed", e.to_string());
                    }
                }
            });
            
            Ok(())
        })
        .invoke_handler(commands::register_commands())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
