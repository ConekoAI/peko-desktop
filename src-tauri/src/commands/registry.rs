use serde::{Deserialize, Serialize};

/// Copy surfaced when the hub answers a registry call with 410 Gone
/// (retired lanes/kinds). PekoHub is a seed-only registry post-ADR-005;
/// the extension-era artifact kinds were retired, not moved.
const SEED_ONLY_COPY: &str =
    "PekoHub is a seed-only registry — the requested artifact kind or lane was retired. \
     Only peko seeds are available.";

/// True when an error payload/status looks like the hub's 410 Gone
/// for retired registry lanes/kinds.
fn is_retired_registry_gone(status: reqwest::StatusCode, body: &str) -> bool {
    status == reqwest::StatusCode::GONE || body.contains("seed-only")
}

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
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        if is_retired_registry_gone(status, &body) {
            return Err(SEED_ONLY_COPY.to_string());
        }
        return Err(format!("pekohub search failed ({status}): {body}"));
    }
    let result: SearchResult = response
        .json()
        .await
        .map_err(|e| format!("failed to parse response: {}", e))?;
    Ok(result)
}

/// Structured result of a successful `registry_pull`, projected from
/// the runtime's `principal_pulled { name, version, digest }`
/// envelope. Replaces the legacy `"Pulled {name}:{version}"` string —
/// the JS wrapper's return type expects an object, not a string.
/// NOTE for the TS reconciliation: this is NOT a full `BundleItem`
/// (the pull envelope carries no description/author/downloads);
/// the TS return type should become `{ name, version, digest }`.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPullResult {
    pub name: String,
    pub version: String,
    pub digest: String,
}

/// Project the runtime's `principal_pulled` envelope into a
/// [`RegistryPullResult`]. Extracted for unit-testability.
fn project_principal_pulled_envelope(value: &serde_json::Value) -> RegistryPullResult {
    let pick = |key: &str| {
        value
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string()
    };
    RegistryPullResult {
        name: pick("name"),
        version: pick("version"),
        digest: pick("digest"),
    }
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
///
/// The JS arg is `{ ref }`; `r#ref` is the raw-identifier spelling of
/// the `ref` keyword — the Tauri macro `unraw()`s it, so the wire
/// arg name is exactly `ref`.
#[tauri::command]
pub async fn registry_pull(r#ref: String) -> Result<RegistryPullResult, String> {
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
        .principal_pull(&r#ref, None, false, false, Some(&token), None)
        .await
        .map_err(|e| e.to_string())?;

    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        let message = resp
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string();
        // A 410 Gone from the hub (retired lanes/kinds, e.g. pulling
        // an extension-era artifact) arrives inside the runtime's
        // error message — either as the formatted status ("HTTP 410
        // Gone: …") or via the hub body's "seed-only" copy. Re-word
        // it so the registry UI explains the retirement instead of
        // dumping a raw OCI error.
        if message.contains("410") || message.contains("seed-only") {
            return Err(format!("{SEED_ONLY_COPY} ({message})"));
        }
        return Err(message);
    }

    Ok(project_principal_pulled_envelope(&resp))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 410 Gone from the hub (retired lanes/kinds) must surface the
    /// "seed-only registry" copy, not a raw OCI error.
    #[test]
    fn gone_status_triggers_seed_only_copy() {
        assert!(is_retired_registry_gone(
            reqwest::StatusCode::GONE,
            r#"{"error":"PekoHub is a seed-only registry: push DNA under 'peko/principals/<name>'"}"#
        ));
        // The hub's body copy alone also trips it (defense in depth if
        // a proxy rewrites the status).
        assert!(is_retired_registry_gone(
            reqwest::StatusCode::BAD_REQUEST,
            "PekoHub is a seed-only registry (ADR-056 D6)"
        ));
        assert!(!is_retired_registry_gone(
            reqwest::StatusCode::NOT_FOUND,
            r#"{"error":"not found"}"#
        ));
    }

    /// The seed-only copy names the registry model so the frontend
    /// can show it verbatim.
    #[test]
    fn seed_only_copy_mentions_seed_only_registry() {
        assert!(SEED_ONLY_COPY.contains("seed-only registry"));
    }

    /// The pull result projects the runtime's `principal_pulled
    /// { name, version, digest }` envelope verbatim — pin the shape
    /// the TS wrapper consumes (`{ name, version, digest }`,
    /// camelCase keys).
    #[test]
    fn project_principal_pulled_envelope_extracts_fields() {
        let v = serde_json::json!({
            "type": "principal_pulled",
            "request_id": 1,
            "name": "coding-assistant",
            "version": "1.2.3",
            "digest": "sha256:abc123",
        });
        let r = project_principal_pulled_envelope(&v);
        assert_eq!(r.name, "coding-assistant");
        assert_eq!(r.version, "1.2.3");
        assert_eq!(r.digest, "sha256:abc123");
        // The serialized keys are the JS-facing contract.
        let json = serde_json::to_value(&r).unwrap();
        for key in ["name", "version", "digest"] {
            assert!(json.get(key).is_some(), "missing key {key} in {json}");
        }
    }

    /// Malformed envelopes degrade to "unknown" fields rather than
    /// failing the whole pull (the pull itself already succeeded
    /// daemon-side; a projection panic would be misleading).
    #[test]
    fn project_principal_pulled_envelope_tolerates_missing_fields() {
        let r = project_principal_pulled_envelope(&serde_json::json!({"type": "principal_pulled"}));
        assert_eq!(r.name, "unknown");
        assert_eq!(r.version, "unknown");
        assert_eq!(r.digest, "unknown");
    }
}
