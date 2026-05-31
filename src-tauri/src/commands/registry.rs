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
pub fn registry_pull(ref_str: String) -> Result<String, String> {
    super::util::run_peko_ok(&["agent", "pull", &ref_str])
}

#[tauri::command]
pub fn registry_auth_status() -> Result<AuthStatus, String> {
    match crate::vault::get_credential("peko", "pekohub") {
        Ok(Some(_)) => Ok(AuthStatus {
            authenticated: true,
            username: None,
        }),
        Ok(None) => Ok(AuthStatus {
            authenticated: false,
            username: None,
        }),
        Err(e) => Err(e.to_string()),
    }
}
