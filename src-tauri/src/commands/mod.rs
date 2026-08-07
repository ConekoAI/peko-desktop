pub mod capability;
pub mod channel;
pub mod cron;
pub mod daemon;
pub mod engine;
pub mod extension;
pub mod model_admin;
pub mod oauth_callback;
pub mod principal;
pub mod registry;
pub mod remote_principal;
pub mod runtime;
pub mod settings;
pub mod system;

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
        principal::principal_update,
        principal::principal_remove,
        principal::principal_send,
        principal::principal_send_stream,
        principal::principal_send_control,
        principal::principal_log,
        principal::principal_set_status,
        principal::principal_set_exposure,
        principal::principal_grant_permission,
        principal::principal_revoke_permission,
        principal::principal_permissions,
        principal::principal_mint_invite,
        principal::principal_revoke_invite,
        capability::capability_list,
        capability::capability_grant,
        capability::capability_revoke,
        channel::channel_list,
        channel::channel_get,
        channel::channel_events,
        channel::channel_members,
        channel::channel_post,
        channel::channel_create,
        channel::channel_invite,
        channel::channel_leave,
        channel::channel_events_watch,
        model_admin::model_list,
        model_admin::model_templates,
        model_admin::model_add,
        model_admin::model_update,
        model_admin::model_remove,
        model_admin::model_test,
        model_admin::model_reload,
        extension::extension_list,
        extension::extension_install,
        extension::extension_uninstall,
        registry::registry_search,
        registry::registry_pull,
        cron::cron_list,
        cron::cron_add,
        cron::cron_remove,
        cron::cron_run,
        settings::settings_get,
        settings::settings_set,
        settings::settings_list,
        settings::credential_get_raw,
        settings::credential_set_raw,
        settings::credential_get_by_id,
        settings::credential_get_material,
        settings::credential_set_generic,
        settings::credential_delete_by_id,
        settings::credential_list_generic,
        settings::pekohub_logout,
        system::system_status,
        system::system_doctor,
        system::system_clean,
        runtime::runtime_list,
        runtime::runtime_add,
        runtime::runtime_remove,
        runtime::runtime_reconnect,
        runtime::runtime_rename,
        remote_principal::remote_principal_list,
        remote_principal::remote_principal_resolve,
        remote_principal::remote_principal_add,
        remote_principal::remote_principal_remove,
        oauth_callback::start_oauth_callback_listener,
    ]
}
