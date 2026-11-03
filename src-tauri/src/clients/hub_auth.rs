//! The PekoHub sign-in, for calls made from the backend.
//!
//! The frontend's OAuth flow stores a token bundle — `{access_token,
//! refresh_token?, expires_at?}` as JSON — at `provider:pekohub/default`
//! in the runtime vault. Backend calls that act as the signed-in account
//! (chatting with a remote peko) read it here, refreshing an expiring
//! access token first (pekohub ADR-007: refresh tokens rotate, so the new
//! bundle is stored back).

use serde::{Deserialize, Serialize};

const PROVIDER: &str = "pekohub";
const CLIENT_ID: &str = "peko-desktop";
/// Refresh when the access token has less than this left.
const SKEW_SECS: i64 = 60;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct TokenBundle {
    access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expires_at: Option<String>,
}

impl TokenBundle {
    fn expiring(&self, now: chrono::DateTime<chrono::Utc>) -> bool {
        self.expires_at
            .as_deref()
            .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
            .is_some_and(|at| at.timestamp() - now.timestamp() < SKEW_SECS)
    }
}

fn now_utc() -> chrono::DateTime<chrono::Utc> {
    std::time::SystemTime::now().into()
}

/// One refresh at a time. Refresh tokens rotate (pekohub ADR-007): two calls
/// spending the same one race, and the Hub may read the loser as a stolen
/// token and sign the account out everywhere.
static REFRESH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn stored_bundle() -> Option<TokenBundle> {
    let raw = crate::commands::settings::credential_get_raw(PROVIDER.to_string())
        .await
        .ok()
        .flatten()?;
    Some(serde_json::from_str(&raw).unwrap_or(TokenBundle {
        // A token stored before the bundle format.
        access_token: raw,
        refresh_token: None,
        expires_at: None,
    }))
}

/// The signed-in account's access token for the hub at `api_base`, or
/// `None` when the app isn't signed in to PekoHub.
pub async fn access_token(http: &reqwest::Client, api_base: &str) -> Option<String> {
    let bundle = stored_bundle().await?;
    if !bundle.expiring(now_utc()) {
        return Some(bundle.access_token);
    }
    let _refreshing = REFRESH.lock().await;
    // A call that held the lock before us may have refreshed already.
    let bundle = stored_bundle().await?;
    if !bundle.expiring(now_utc()) {
        return Some(bundle.access_token);
    }
    let refresh_token = bundle.refresh_token.clone()?;
    match refresh(http, api_base, &refresh_token).await {
        Ok(fresh) => {
            if let Ok(json) = serde_json::to_string(&fresh) {
                let _ =
                    crate::commands::settings::credential_set_raw(PROVIDER.to_string(), json).await;
            }
            Some(fresh.access_token)
        }
        // Signed out at the hub, or the refresh token was spent elsewhere.
        Err(_) => None,
    }
}

async fn refresh(
    http: &reqwest::Client,
    api_base: &str,
    refresh_token: &str,
) -> Result<TokenBundle, String> {
    #[derive(Deserialize)]
    struct Answer {
        access_token: String,
        refresh_token: Option<String>,
        expires_in: Option<i64>,
    }
    let url = format!("{}/oauth/token", api_base.trim_end_matches('/'));
    let resp = http
        .post(url)
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "refresh_token": refresh_token,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("refresh refused: {}", resp.status()));
    }
    let answer: Answer = resp.json().await.map_err(|e| e.to_string())?;
    Ok(TokenBundle {
        access_token: answer.access_token,
        refresh_token: answer.refresh_token,
        expires_at: answer
            .expires_in
            .map(|secs| (now_utc() + chrono::Duration::seconds(secs)).to_rfc3339()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_near_its_expiry_is_refreshed() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-01T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let bundle = |at: Option<&str>| TokenBundle {
            access_token: "a".into(),
            refresh_token: Some("r".into()),
            expires_at: at.map(str::to_string),
        };
        assert!(bundle(Some("2026-11-01T12:00:30Z")).expiring(now));
        assert!(bundle(Some("2026-11-01T11:00:00Z")).expiring(now));
        assert!(!bundle(Some("2026-11-01T12:30:00Z")).expiring(now));
        // The frontend writes `toISOString()` (milliseconds, `Z`).
        assert!(!bundle(Some("2026-11-01T12:30:00.000Z")).expiring(now));
        assert!(!bundle(None).expiring(now), "no expiry recorded: use it");
    }

    #[test]
    fn the_bundle_round_trips_in_the_frontends_format() {
        let json =
            r#"{"access_token":"a","refresh_token":"r","expires_at":"2026-11-01T12:30:00.000Z"}"#;
        let bundle: TokenBundle = serde_json::from_str(json).unwrap();
        assert_eq!(bundle.refresh_token.as_deref(), Some("r"));
        let back: TokenBundle =
            serde_json::from_str(&serde_json::to_string(&bundle).unwrap()).unwrap();
        assert_eq!(back, bundle);
    }
}
