pub mod cron;
pub mod daemon;
pub mod extension;
pub mod principal;
pub mod registry;
pub mod runtime;
pub mod settings;
pub mod system;
pub mod util;

pub fn register_commands() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static
{
    tauri::generate_handler![
        daemon::daemon_start,
        daemon::daemon_stop,
        daemon::daemon_restart,
        daemon::daemon_status,
        daemon::daemon_ensure_running,
        principal::principal_list,
        principal::principal_send,
        principal::principal_send_stream,
        principal::principal_log,
        principal::principal_provider_list,
        extension::extension_list,
        extension::extension_install,
        extension::extension_enable,
        extension::extension_disable,
        extension::extension_uninstall,
        registry::registry_search,
        registry::registry_pull,
        registry::registry_auth_status,
        registry::shared_instances_list,
        cron::cron_list,
        cron::cron_add,
        cron::cron_remove,
        cron::cron_run,
        settings::settings_get,
        settings::settings_set,
        settings::settings_list,
        settings::credential_get,
        settings::credential_set,
        settings::credential_delete,
        settings::credential_test,
        system::system_status,
        system::system_doctor,
        system::system_clean,
        runtime::runtime_list,
        runtime::runtime_add,
        runtime::runtime_remove,
        runtime::runtime_reconnect,
        runtime::runtime_rename,
    ]
}
