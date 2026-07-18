use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BundleItem {
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub downloads: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchResult {
    pub items: Vec<BundleItem>,
    pub total: u64,
    pub page: u32,
    pub per_page: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuthStatus {
    pub authenticated: bool,
    pub username: Option<String>,
}

#[tauri::command]
pub async fn registry_search(
    query: String,
    page: u32,
    per_page: u32,
) -> Result<SearchResult, String> {
    let url = format!(
        "https://pekohub.org/api/v1/search?q={}&page={}&perPage={}",
        urlencoding::encode(&query),
        page,
        per_page
    );
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;
    let result: SearchResult = response
        .json()
        .await
        .map_err(|e| format!("failed to parse response: {}", e))?;
    Ok(result)
}

#[tauri::command]
pub async fn registry_pull(ref_str: String) -> Result<String, String> {
    // Get registry token from vault
    let token = crate::vault::get_credential("peko", "pekohub")
        .ok()
        .flatten();

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    // The legacy `registry_pull` IPC packet was retired with
    // ADR-041. The runtime's surface is `principal_pull`; the
    // desktop pre-confirms because the user has already accepted
    // the preview in the registry search UI.
    let resp = client
        .principal_pull(&ref_str, None, false, false, token.as_deref(), None)
        .await
        .map_err(|e| e.to_string())?;

    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        return Err(resp
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string());
    }

    let name = resp
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let version = resp
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    Ok(format!("Pulled {}:{}", name, version))
}

#[tauri::command]
pub fn registry_auth_status() -> Result<AuthStatus, String> {
    match crate::vault::get_credential("peko", "pekohub") {
        Ok(Some(stored)) => {
            // Stored as `username:token` so login can preserve the
            // username. Status callers only care about whether auth is
            // set up, not the token itself.
            let username = stored.split(':').next().map(|s| s.to_string());
            Ok(AuthStatus {
                authenticated: true,
                username,
            })
        }
        Ok(None) => Ok(AuthStatus {
            authenticated: false,
            username: None,
        }),
        Err(e) => Err(e.to_string()),
    }
}

/// Persist PekoHub auth credentials. The token is stored in the OS
/// keychain under `("peko", "pekohub")` as `username:token` so the
/// existing `registry_auth_status` can recover the username on
/// subsequent reads.
#[tauri::command]
pub fn registry_login(username: String, token: String) -> Result<AuthStatus, String> {
    let stored = format!("{username}:{token}");
    crate::vault::set_credential("peko", "pekohub", &stored)
        .map_err(|e| format!("failed to store PekoHub credentials: {e}"))?;
    Ok(AuthStatus {
        authenticated: true,
        username: Some(username),
    })
}

/// Forget PekoHub auth credentials. Idempotent — succeeds whether or
/// not a credential was previously stored.
#[tauri::command]
pub fn registry_logout() -> Result<(), String> {
    match crate::vault::delete_credential("peko", "pekohub") {
        Ok(()) => Ok(()),
        Err(crate::vault::VaultError::Keyring(keyring_core::error::Error::NoEntry)) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

