pub mod agent;
pub mod cron;
pub mod daemon;
pub mod extension;
pub mod registry;
pub mod session;
pub mod settings;
pub mod system;
pub mod team;
pub mod util;

pub fn register_commands() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        daemon::daemon_start,
        daemon::daemon_stop,
        daemon::daemon_restart,
        daemon::daemon_status,
        daemon::daemon_ensure_running,
        agent::agent_list,
        agent::agent_show,
        agent::agent_create,
        agent::agent_remove,
        agent::agent_export,
        agent::agent_import,
        team::team_list,
        team::team_show,
        team::team_export,
        team::team_import,
        session::session_list,
        session::session_show,
        session::session_branch,
        session::session_compact,
        extension::extension_list,
        extension::extension_install,
        extension::extension_enable,
        extension::extension_disable,
        extension::extension_uninstall,
        registry::registry_search,
        registry::registry_pull,
        registry::registry_auth_status,
        cron::cron_list,
        cron::cron_add,
        cron::cron_remove,
        cron::cron_run,
        settings::settings_get,
        settings::settings_set,
        settings::credential_get,
        settings::credential_set,
        settings::credential_delete,
        settings::credential_test,
        system::system_status,
        system::system_doctor,
        system::system_clean,
    ]
}
