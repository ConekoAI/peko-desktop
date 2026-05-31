use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CronJob {
    pub id: String,
    pub name: String,
    pub schedule: String,
    pub message: String,
    pub enabled: bool,
}

fn parse_cron_job(value: &serde_json::Value) -> Option<CronJob> {
    Some(CronJob {
        id: value.get("id")?.as_str()?.to_string(),
        name: value.get("name")?.as_str()?.to_string(),
        schedule: value
            .get("schedule")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                value
                    .get("schedule")
                    .and_then(|s| s.get("Every"))
                    .and_then(|e| e.get("every_ms"))
                    .and_then(|ms| ms.as_u64())
                    .map(|ms| format!("{}ms", ms))
            })
            .unwrap_or_default(),
        message: value.get("message")?.as_str()?.to_string(),
        enabled: value.get("enabled")?.as_bool().unwrap_or(true),
    })
}

#[tauri::command]
pub async fn cron_list() -> Result<Vec<CronJob>, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.cron_list().await.map_err(|e| e.to_string())?;
    let jobs = value
        .get("jobs")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_cron_job).collect())
        .unwrap_or_default();
    Ok(jobs)
}

// Keep cron_add as CLI shell-out (complex scheduling parsing)
#[tauri::command]
pub fn cron_add(name: String, schedule: String, message: String) -> Result<String, String> {
    super::util::run_peko_ok(&[
        "cron",
        "add",
        "--name",
        &name,
        "--schedule",
        &schedule,
        "--message",
        &message,
    ])
}

#[tauri::command]
pub async fn cron_remove(id: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.cron_remove(&id).await.map_err(|e| e.to_string())?;
    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }
    Ok(format!("Cron job {} removed", id))
}

#[tauri::command]
pub async fn cron_run(id: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new().await.map_err(|e| e.to_string())?;
    let value = client.cron_run(&id).await.map_err(|e| e.to_string())?;
    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }
    let run_id = value
        .get("run_id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    Ok(format!("Cron job {} started (run: {})", id, run_id))
}
