//! Capability management commands (per-Principal grants).
//!
//! Thin Tauri wrappers over the runtime's `capability_list`,
//! `capability_grant`, and `capability_revoke` IPC variants. The runtime
//! owns the capability model; the desktop only projects the response
//! shapes the React UI expects.

use serde::{Deserialize, Serialize};

/// Capability inventory for a single Principal.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityList {
    pub granted: Vec<String>,
    pub detected: Vec<String>,
    pub active: Vec<String>,
}

#[tauri::command]
pub async fn capability_list(principal: String) -> Result<CapabilityList, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    let value = client
        .capability_list(&principal)
        .await
        .map_err(|e| e.to_string())?;

    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }

    let as_vec = |key: &str| {
        value
            .get(key)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    };

    Ok(CapabilityList {
        granted: as_vec("granted"),
        detected: as_vec("detected"),
        active: as_vec("active"),
    })
}

#[tauri::command]
pub async fn capability_grant(
    principal: String,
    capability: String,
) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    let value = client
        .capability_grant(&principal, &capability)
        .await
        .map_err(|e| e.to_string())?;

    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }

    Ok(capability)
}

#[tauri::command]
pub async fn capability_revoke(
    principal: String,
    capability: String,
) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    let value = client
        .capability_revoke(&principal, &capability)
        .await
        .map_err(|e| e.to_string())?;

    if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }

    Ok(capability)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_capability_list() {
        let envelope = serde_json::json!({
            "type": "capability_list",
            "request_id": 1,
            "principal": "helper",
            "granted": ["tool:Read", "agent:researcher"],
            "detected": ["tool:Write"],
            "active": ["tool:Read"]
        });

        let as_vec = |key: &str| {
            envelope
                .get(key)
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default()
        };

        let list = CapabilityList {
            granted: as_vec("granted"),
            detected: as_vec("detected"),
            active: as_vec("active"),
        };

        assert_eq!(list.granted, vec!["tool:Read", "agent:researcher"]);
        assert_eq!(list.detected, vec!["tool:Write"]);
        assert_eq!(list.active, vec!["tool:Read"]);
    }
}
