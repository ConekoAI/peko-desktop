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
pub fn registry_search(
    _query: String,
    page: u32,
    per_page: u32,
) -> Result<SearchResult, String> {
    Ok(SearchResult {
        items: vec![],
        total: 0,
        page,
        per_page,
    })
}

#[tauri::command]
pub fn registry_pull(ref_str: String) -> Result<String, String> {
    Ok(format!("pulled {}", ref_str))
}

#[tauri::command]
pub fn registry_auth_status() -> Result<AuthStatus, String> {
    Ok(AuthStatus {
        authenticated: false,
        username: None,
    })
}
