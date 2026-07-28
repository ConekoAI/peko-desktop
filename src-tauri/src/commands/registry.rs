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

/// Pull a bundle from the PekoHub registry.
///
/// Auth: read the OAuth access token from the runtime credential
/// vault (`provider:pekohub/default` slot, kind `oauth_token`). The
/// SPA's `ProfileMenu` is the single sign-in entry point — when no
/// bundle is stored the desktop must surface a "sign in to install"
/// error rather than sending an unauthenticated request.
///
/// The legacy PAT path (OS keychain `("peko","pekohub")`) was deleted
/// alongside the `vault::*` module in PR "Profile menu + drop legacy
/// registry login" — there is no fallback to "anonymous pull".
#[tauri::command]
pub async fn registry_pull(ref_str: String) -> Result<String, String> {
    let token = crate::clients::pekohub::PekohubClient::access_token().await;
    let token = token.ok_or_else(|| {
        "not signed in to PekoHub — open the profile menu (top-left) and sign in to install bundles"
            .to_string()
    })?;

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| e.to_string())?;
    // The legacy `registry_pull` IPC packet was retired with
    // ADR-041. The runtime's surface is `principal_pull`; the
    // desktop pre-confirms because the user has already accepted
    // the preview in the registry search UI.
    let resp = client
        .principal_pull(&ref_str, None, false, false, Some(&token), None)
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
