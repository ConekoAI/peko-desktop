//! The PekoHub sign-in, for calls made from the backend.
//!
//! The frontend's OAuth flow stores a token bundle — `{access_token,
//! refresh_token?, expires_at?, hub?}` as JSON — at `provider:pekohub/default`
//! in the runtime vault. Backend calls that act as the signed-in account
//! (chatting with a remote peko) read it here, refreshing an expiring
//! access token first (pekohub ADR-007: refresh tokens rotate, so the new
//! bundle is stored back).
//!
//! The tokens go to the hub that issued them and nowhere else
//! ([`is_signed_in_hub`]). A share link names its own hub, and a hub that
//! got the sign-in could act as the account: register a computer to it,
//! and through that computer speak as the owner to their pekos.

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
    /// The API base of the hub that issued the tokens. Bundles stored
    /// before it was recorded belong to the hub the settings name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hub: Option<String>,
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
        hub: None,
    }))
}

/// The API base of the hub the stored sign-in belongs to: the one it
/// recorded, else the hub the settings name (`pekohub.base_url`), else
/// the official hub. `None` when the app isn't signed in.
pub async fn signed_in_hub() -> Option<String> {
    let bundle = stored_bundle().await?;
    Some(bundle_hub(&bundle))
}

fn bundle_hub(bundle: &TokenBundle) -> String {
    let named = bundle.hub.clone().or_else(|| {
        crate::commands::settings::settings_get("pekohub.base_url".to_string())
            .ok()
            .flatten()
            .filter(|v| !v.trim().is_empty())
    });
    super::hub_origin::hub_api_base(named.as_deref().unwrap_or(super::hub_origin::DEFAULT_HUB))
}

/// Whether `api_base` is the hub the stored sign-in belongs to: the only
/// hub its tokens are sent to.
pub async fn is_signed_in_hub(api_base: &str) -> bool {
    signed_in_hub()
        .await
        .is_some_and(|hub| hub == super::hub_origin::hub_api_base(api_base))
}

/// The signed-in account's access token for the hub at `api_base`, or
/// `None` when the app isn't signed in to PekoHub.
/// `None` too for any other hub: the sign-in is never sent there.
pub async fn access_token(http: &reqwest::Client, api_base: &str) -> Option<String> {
    let bundle = stored_bundle().await?;
    let hub = bundle_hub(&bundle);
    if hub != super::hub_origin::hub_api_base(api_base) {
        return None;
    }
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
    match refresh(http, &hub, &refresh_token).await {
        Ok(mut fresh) => {
            fresh.hub = Some(hub);
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
        hub: None,
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
            hub: None,
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

    #[test]
    fn a_bundle_belongs_to_the_hub_that_issued_it() {
        let bundle = TokenBundle {
            access_token: "a".into(),
            refresh_token: Some("r".into()),
            expires_at: None,
            hub: Some("https://pekohub.ai".into()),
        };
        // The website's address names the API it signs in with.
        assert_eq!(bundle_hub(&bundle), "https://api.pekohub.ai");
        let json = serde_json::to_string(&bundle).unwrap();
        assert!(json.contains(r#""hub":"https://pekohub.ai""#), "{json}");
    }
}
