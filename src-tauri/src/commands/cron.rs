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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cron_job_standard() {
        let value = serde_json::json!({
            "id": "job-1",
            "name": "daily-backup",
            "schedule": "0 0 * * *",
            "message": "run backup",
            "enabled": true
        });
        let job = parse_cron_job(&value).unwrap();
        assert_eq!(job.id, "job-1");
        assert_eq!(job.name, "daily-backup");
        assert_eq!(job.schedule, "0 0 * * *");
        assert_eq!(job.message, "run backup");
        assert!(job.enabled);
    }

    #[test]
    fn test_parse_cron_job_ms_schedule() {
        let value = serde_json::json!({
            "id": "job-2",
            "name": "tick",
            "schedule": {
                "Every": { "every_ms": 5000 }
            },
            "message": "tick",
            "enabled": false
        });
        let job = parse_cron_job(&value).unwrap();
        assert_eq!(job.schedule, "5000ms");
        assert!(!job.enabled);
    }

    #[test]
    fn test_parse_cron_job_defaults_enabled() {
        let value = serde_json::json!({
            "id": "job-3",
            "name": "minimal",
            "schedule": "* * * * *",
            "message": "x",
            "enabled": null
        });
        let job = parse_cron_job(&value).unwrap();
        assert!(job.enabled);
    }

    #[test]
    fn test_parse_cron_job_missing_id_returns_none() {
        let value = serde_json::json!({ "name": "bad" });
        assert!(parse_cron_job(&value).is_none());
    }

    #[test]
    fn test_parse_cron_job_missing_schedule_returns_none() {
        let value = serde_json::json!({
            "id": "job-4",
            "name": "no-schedule",
            "message": "x"
        });
        assert!(parse_cron_job(&value).is_none());
    }
}

#[tauri::command]
pub async fn cron_list() -> Result<Vec<CronJob>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    let value = client.cron_list().await.map_err(|e| e.to_string())?;
    let jobs = value
        .get("jobs")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_cron_job).collect())
        .unwrap_or_default();
    Ok(jobs)
}

#[tauri::command]
pub async fn cron_add(name: String, schedule: String, message: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    let resp = client
        .cron_add_simple(&name, &schedule, &message)
        .await
        .map_err(|e| e.to_string())?;

    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }

    let job_id = resp
        .get("job_id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    Ok(format!("Cron job {} added", job_id))
}

#[tauri::command]
pub async fn cron_remove(id: String) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
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
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
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
