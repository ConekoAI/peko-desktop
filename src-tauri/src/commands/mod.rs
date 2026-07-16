pub mod cron;
pub mod daemon;
pub mod engine;
pub mod extension;
pub mod principal;
pub mod provider_admin;
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
        engine::engine_status,
        engine::engine_diagnostics,
        engine::engine_restart,
        principal::principal_list,
        principal::principal_get,
        principal::principal_create,
        principal::principal_send,
        principal::principal_send_stream,
        principal::principal_log,
        principal::principal_provider_list,
        provider_admin::provider_templates,
        provider_admin::provider_add,
        extension::extension_list,
        extension::extension_install,
        extension::extension_uninstall,
        registry::registry_search,
        registry::registry_pull,
        registry::registry_auth_status,
        registry::registry_login,
        registry::registry_logout,
        registry::accessible_principals_list,
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
        settings::credential_list,
        settings::credential_get_raw,
        settings::credential_set_raw,
        settings::credential_get_by_id,
        settings::credential_get_material,
        settings::credential_set_generic,
        settings::credential_delete_by_id,
        settings::credential_test_by_id,
        settings::credential_list_generic,
        settings::binding_list,
        settings::binding_get,
        settings::binding_set,
        settings::binding_delete,
        settings::binding_test_rotation,
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
