pub mod commands;
pub mod daemon;
pub mod fs;
pub mod ipc;
pub mod tray;
pub mod updater;
pub mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Build system tray
            let _ = tray::build_tray(app.handle());
            Ok(())
        })
        .invoke_handler(commands::register_commands())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
