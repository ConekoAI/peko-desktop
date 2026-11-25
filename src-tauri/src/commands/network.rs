//! How this computer connects to your other computers and people's
//! (runtime ADR-125 D9, D11).
//!
//! By default everything goes through PekoHub. *Automatic* links directly
//! with computers on the same network (a LAN, a VPN, Tailscale) and uses
//! PekoHub for the rest; *Direct only* never uses PekoHub for
//! conversations. The window reads `network_status` and sends
//! `network_settings_set`; it has no transport of its own.

/// One computer, and how it is reached now.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPeer {
    pub runtime_id: String,
    pub account: Option<String>,
    pub name: Option<String>,
    /// `direct`, `relay`, `waiting` or `offline`.
    pub path: String,
    pub address: Option<String>,
    /// RFC 3339: since when its link is up.
    pub since: Option<String>,
    pub last_error: Option<String>,
}

/// What `network_status` answers.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStatus {
    /// `pekohub`, `automatic` or `direct`.
    pub connection: String,
    /// `mine` or `people`.
    pub direct_with: String,
    /// Where the engine listens, while it does.
    pub listening: Option<String>,
    /// What it tells other computers to dial.
    pub told: Vec<String>,
    /// Why it does not listen, when it could not.
    pub listen_error: Option<String>,
    pub peers: Vec<NetworkPeer>,
    /// The settings as written (Advanced).
    pub direct_listen: Option<String>,
    pub direct_addresses: Vec<String>,
    pub direct_peers: Vec<String>,
}

/// A change to the settings; `None` leaves one as it is.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkChange {
    pub connection: Option<String>,
    pub direct_with: Option<String>,
    /// An empty string goes back to the default.
    pub direct_listen: Option<String>,
    pub direct_addresses: Option<Vec<String>>,
    pub direct_peers: Option<Vec<String>>,
}

fn refusal_of(value: &serde_json::Value) -> Option<String> {
    (value.get("type").and_then(|t| t.as_str()) == Some("error")).then(|| {
        let message = value
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("refused");
        match message.strip_prefix('[').and_then(|m| m.split_once("] ")) {
            Some((_, rest)) => rest.to_string(),
            None => message.to_string(),
        }
    })
}

fn text(row: &serde_json::Value, key: &str) -> Option<String> {
    row.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

fn texts(row: &serde_json::Value, key: &str) -> Vec<String> {
    row.get(key)
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect()
}

fn status_from(value: &serde_json::Value) -> Result<NetworkStatus, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    let listening = value.get("listening").cloned().unwrap_or_default();
    Ok(NetworkStatus {
        connection: text(value, "connection").unwrap_or_else(|| "pekohub".into()),
        direct_with: text(value, "direct_with").unwrap_or_else(|| "mine".into()),
        listening: text(&listening, "address"),
        told: texts(&listening, "addresses"),
        listen_error: text(&listening, "error"),
        peers: value
            .get("peers")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter_map(|row| {
                Some(NetworkPeer {
                    runtime_id: text(row, "runtime_id")?,
                    account: text(row, "account"),
                    name: text(row, "name"),
                    path: text(row, "path").unwrap_or_else(|| "relay".into()),
                    address: text(row, "address"),
                    since: text(row, "since"),
                    last_error: text(row, "last_error"),
                })
            })
            .collect(),
        direct_listen: text(value, "direct_listen"),
        direct_addresses: texts(value, "direct_addresses"),
        direct_peers: texts(value, "direct_peers"),
    })
}

async fn client() -> Result<crate::ipc::IpcClient, String> {
    crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))
}

/// How this computer connects, and how each computer is reached.
#[tauri::command]
pub async fn network_status() -> Result<NetworkStatus, String> {
    let value = client()
        .await?
        .network_status()
        .await
        .map_err(|e| format!("network_status failed: {e}"))?;
    status_from(&value)
}

/// Change how this computer connects; applied at once.
#[tauri::command]
pub async fn network_settings_set(change: NetworkChange) -> Result<NetworkStatus, String> {
    let value = client()
        .await?
        .network_settings_set(
            change.connection.as_deref(),
            change.direct_with.as_deref(),
            change.direct_listen.as_deref(),
            change.direct_addresses.as_deref(),
            change.direct_peers.as_deref(),
        )
        .await
        .map_err(|e| format!("network_settings_set failed: {e}"))?;
    status_from(&value)
}

/// Dial the computers this one knows addresses for, now.
#[tauri::command]
pub async fn network_link_retry(runtime_id: Option<String>) -> Result<(), String> {
    let value = client()
        .await?
        .network_link_retry(runtime_id.as_deref())
        .await
        .map_err(|e| format!("network_link_retry failed: {e}"))?;
    match refusal_of(&value) {
        Some(message) => Err(message),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_network_status() {
        let value = serde_json::json!({"type": "network_status_result", "request_id": 1,
            "connection": "automatic", "direct_with": "people",
            "listening": {"address": "0.0.0.0:11438", "addresses": ["192.168.1.20:11438"]},
            "peers": [
                {"runtime_id": "did:key:zDesk", "account": "user:hub:a", "name": "Desk",
                 "path": "direct", "address": "192.168.1.30:51234", "since": "2026-11-25T00:00:00Z"},
                {"runtime_id": "did:key:zLaptop", "path": "waiting", "last_error": "10.0.0.5:11438: timed out"},
                {"path": "relay"},
            ],
            "direct_peers": ["10.0.0.12:11438"], "direct_addresses": []});
        let status = status_from(&value).unwrap();
        assert_eq!(status.connection, "automatic");
        assert_eq!(status.direct_with, "people");
        assert_eq!(status.listening.as_deref(), Some("0.0.0.0:11438"));
        assert_eq!(status.told, vec!["192.168.1.20:11438".to_string()]);
        assert_eq!(status.peers.len(), 2);
        assert_eq!(status.peers[0].path, "direct");
        assert_eq!(
            status.peers[1].last_error.as_deref(),
            Some("10.0.0.5:11438: timed out")
        );
        assert_eq!(status.direct_peers, vec!["10.0.0.12:11438".to_string()]);
        assert_eq!(status.direct_listen, None);
    }

    #[test]
    fn an_engine_that_could_not_listen_says_why() {
        let value = serde_json::json!({"type": "network_status_result", "request_id": 1,
            "connection": "direct", "direct_with": "mine",
            "listening": {"addresses": [], "error": "could not listen on 0.0.0.0:11438: Address in use"},
            "peers": []});
        let status = status_from(&value).unwrap();
        assert_eq!(status.listening, None);
        assert!(status.listen_error.unwrap().contains("Address in use"));
    }

    #[test]
    fn a_refusal_reads_as_a_sentence() {
        let value = serde_json::json!({"type": "error", "request_id": 1,
            "message": "[permission_denied] local callers only"});
        assert_eq!(status_from(&value).unwrap_err(), "local callers only");
    }

    #[test]
    fn an_older_engine_reads_as_pekohub_only() {
        let value = serde_json::json!({"type": "network_status_result", "request_id": 1});
        let status = status_from(&value).unwrap();
        assert_eq!(status.connection, "pekohub");
        assert!(status.peers.is_empty());
    }
}
