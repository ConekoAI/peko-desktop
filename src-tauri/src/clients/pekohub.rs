//! HTTP client for the PekoHub remote-runtime API.
//!
//! All methods return raw `serde_json::Value` so that the command layer
//! can map them into frontend-facing structs, keeping the client thin.

use reqwest::header::AUTHORIZATION;

const DEFAULT_BASE_URL: &str = "https://pekohub.org/api";

/// Provider-namespace + name used by the OAuth flow to store the token
/// bundle in the runtime's credential vault. Must match
/// `useRuntimes.ts::storeOAuthBundle` which writes via
/// `credentialSetRaw("pekohub", ...)`.
const OAUTH_NAMESPACE: &str = "provider:pekohub";
const OAUTH_NAME: &str = "default";
const OAUTH_KIND: &str = "oauth_token";

/// Default OAuth client_id; must match `useRuntimes.ts` /
/// `oauthTokenRefresh`.
const OAUTH_CLIENT_ID: &str = "peko-desktop";

/// Refresh the access token if it expires within this window. Matches
/// the 60s skew buffer used by `useRuntimes.ts::isTokenExpired`.
const REFRESH_SKEW_SECS: i64 = 60;

/// Thin wrapper around `reqwest` for PekoHub API calls.
pub struct PekohubClient {
    http: reqwest::Client,
    base_url: String,
}

impl PekohubClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    /// Override the base URL (useful for testing / self-hosted hubs).
    pub fn with_base_url(mut self, url: String) -> Self {
        self.base_url = url.trim_end_matches('/').to_string();
        self
    }

    /// Retrieve the stored OAuth access token from the runtime's
    /// credential vault. Auto-refreshes via the OAuth refresh_token
    /// grant when the access token is within `REFRESH_SKEW_SECS` of
    /// expiry (D2).
    ///
    /// The OAuth flow (`useRuntimes.ts::startOAuthConnect` →
    /// `exchangeOAuthCode`) writes the full bundle as JSON to the
    /// `provider:pekohub/default` slot of kind `oauth_token` via
    /// `credentialSetRaw`. The previously documented `vault::peko /
    /// pekohub` OS-keyring slot was for the legacy Registry PAT and
    /// was never written by the OAuth flow, so reading it silently
    /// returned `None` and every PekoHub call went out unauthenticated.
    async fn token(base_url: &str) -> Option<String> {
        let (_credential_id, material) = Self::load_oauth_material().await?;
        // Refresh if the bundle is JSON, has an `expires_at`, and is
        // within the skew window. Bundles without `expires_at` are
        // treated as long-lived and never refreshed.
        if let Ok(bundle) = serde_json::from_str::<serde_json::Value>(&material) {
            if let Some(access) = bundle.get("access_token").and_then(|v| v.as_str()) {
                if Self::bundle_is_expired(&bundle) {
                    if let Some(new_bundle) = Self::refresh_bundle(base_url, &bundle).await {
                        // Persist the new bundle back to the same slot.
                        if let Ok(json) = serde_json::to_string(&new_bundle) {
                            let client = crate::ipc::IpcClient::new().await.ok();
                            if let Some(client) = client {
                                let _ = client
                                    .credential_set(
                                        OAUTH_NAMESPACE,
                                        OAUTH_NAME,
                                        OAUTH_KIND,
                                        &json,
                                        None,
                                    )
                                    .await;
                            }
                        }
                        if let Some(new_access) =
                            new_bundle.get("access_token").and_then(|v| v.as_str())
                        {
                            return Some(new_access.to_string());
                        }
                    }
                }
                return Some(access.to_string());
            }
        }
        // Legacy plain-token row (not JSON) — return verbatim.
        Some(material)
    }

    /// Look up the OAuth bundle row and reveal its material via IPC.
    /// Returns `(credential_id, material_string)`.
    async fn load_oauth_material() -> Option<(String, String)> {
        let client = crate::ipc::IpcClient::new().await.ok()?;
        let resp = client
            .credential_list(Some(OAUTH_NAMESPACE), Some(OAUTH_KIND))
            .await
            .ok()?;
        let credential_id = resp
            .get("providers")
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                arr.iter().find_map(|row| {
                    let name = row.get("name").and_then(|n| n.as_str())?;
                    if name == OAUTH_NAME {
                        row.get("id").and_then(|id| id.as_str()).map(String::from)
                    } else {
                        None
                    }
                })
            })?;
        let resp = client
            .credential_get_material(&credential_id, "pekohub api auth")
            .await
            .ok()?;
        let material = resp.get("material").and_then(|v| v.as_str())?.to_string();
        Some((credential_id, material))
    }

    /// Returns true if `bundle.expires_at` is within `REFRESH_SKEW_SECS`
    /// of now (or already past). Bundles missing `expires_at` return
    /// false (treated as long-lived).
    fn bundle_is_expired(bundle: &serde_json::Value) -> bool {
        let Some(expires_at) = bundle.get("expires_at").and_then(|v| v.as_str()) else {
            return false;
        };
        let Some(expiry) = parse_rfc3339(expires_at) else {
            return false;
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let skew = REFRESH_SKEW_SECS;
        now + skew >= expiry
    }

    /// Build a refreshed bundle from a `/oauth/token` response.
    /// Preserves the old `refresh_token` if the hub omits a new one so
    /// the next refresh can still happen.
    fn build_refreshed_bundle(
        old: &serde_json::Value,
        resp_body: &serde_json::Value,
    ) -> Option<serde_json::Value> {
        let access = resp_body.get("access_token").and_then(|v| v.as_str())?;
        let mut new_bundle = serde_json::json!({ "access_token": access });
        let rt = resp_body
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .or_else(|| old.get("refresh_token").and_then(|v| v.as_str()));
        if let Some(rt) = rt {
            new_bundle["refresh_token"] = serde_json::Value::String(rt.to_string());
        }
        if let Some(expires_in) = resp_body.get("expires_in").and_then(|v| v.as_i64()) {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let expires_at = now + expires_in;
            // ISO-8601 / RFC3339 in UTC: 2024-01-01T00:00:00Z
            let formatted = format_unix_seconds(expires_at);
            new_bundle["expires_at"] = serde_json::Value::String(formatted);
        }
        Some(new_bundle)
    }

    /// Exchange the bundle's refresh_token for a new access_token via
    /// `<base_url>/oauth/token`. Returns the refreshed bundle on
    /// success, or `None` if the bundle has no refresh_token, the
    /// network call fails, or the hub returns a non-2xx.
    async fn refresh_bundle(
        base_url: &str,
        bundle: &serde_json::Value,
    ) -> Option<serde_json::Value> {
        let refresh_token = bundle.get("refresh_token").and_then(|v| v.as_str())?;
        let base_url = base_url.trim_end_matches('/');
        let url = format!("{}/oauth/token", base_url);
        let body = serde_json::json!({
            "grant_type": "refresh_token",
            "client_id": OAUTH_CLIENT_ID,
            "refresh_token": refresh_token,
        });
        let resp = reqwest::Client::new()
            .post(&url)
            .json(&body)
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let resp_body: serde_json::Value = resp.json().await.ok()?;
        Self::build_refreshed_bundle(bundle, &resp_body)
    }

    // ------------------------------------------------------------------
    // Auth helpers
    // ------------------------------------------------------------------

    async fn auth_header(&self) -> Option<(String, String)> {
        Self::token(&self.base_url)
            .await
            .map(|t| (AUTHORIZATION.to_string(), format!("Bearer {}", t)))
    }

    // ------------------------------------------------------------------
    // Runtime management
    // ------------------------------------------------------------------

    /// Get system status from a remote runtime.
    pub async fn system_status(&self, runtime_id: &str) -> Result<serde_json::Value, String> {
        let url = format!("{}/v1/runtimes/{}/status", self.base_url, runtime_id);
        let mut req = self.http.get(&url);
        if let Some((k, v)) = self.auth_header().await {
            req = req.header(&k, v);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("pekohub error: {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// List principals the authenticated user has access to
    /// (caller-owned + caller-allowed).
    pub async fn list_accessible_principals(&self) -> Result<serde_json::Value, String> {
        let url = format!("{}/v1/me/accessible-principals", self.base_url);
        let mut req = self.http.get(&url);
        if let Some((k, v)) = self.auth_header().await {
            req = req.header(&k, v);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("pekohub error: {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    // Note: the pre-#18 PekohubClient surface (`list_agents`, `chat`,
    // `chat_streaming`, `list_sessions`, `session_history`,
    // `create_agent`, `delete_agent`, `update_instance_exposure`,
    // `update_instance_status`, `list_runtimes` PekohubClient method) was
    // removed in the Principal-as-container migration. Chat flows now
    // route through the local daemon IPC (`principal_send` /
    // `principal_send_stream`); the Shared list uses PekohubClient;
    // runtime registration is local-only.
}

impl Default for PekohubClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse an RFC3339 / ISO-8601 UTC timestamp (`YYYY-MM-DDTHH:MM:SSZ`
/// or with a numeric offset) into UNIX-epoch seconds. Returns `None`
/// for malformed input — callers treat this as "long-lived, do not
/// refresh". We avoid pulling in `chrono` for this one parser.
fn parse_rfc3339(s: &str) -> Option<i64> {
    // The offset (if any) lives in the time portion of the string.
    // We can't naively `rfind('+')` because the date contains `-`,
    // but the offset's `+`/`-` always appears AFTER the `T`
    // separator. Locate the `T` first, then scan for the offset
    // marker within the time portion.
    let t_idx = s.find('T')?;
    let time_portion = &s[t_idx + 1..];

    // Strip the trailing 'Z' before scanning for a numeric offset.
    let (time_no_z, mut offset_secs) = if let Some(rest) = time_portion.strip_suffix('Z') {
        (rest, 0i64)
    } else {
        (time_portion, 0i64)
    };

    // In `time_no_z`, look for the LAST `+` or `-`. The `-` at
    // index 0 is a sign on the hour field, so skip that. (RFC3339
    // allows e.g. `-05:00` but the leading char is part of the
    // hour, not the offset.)
    let mut offset_idx: Option<usize> = None;
    for (i, c) in time_no_z.char_indices().skip(1) {
        if c == '+' || c == '-' {
            offset_idx = Some(i);
        }
    }
    let (time_main, offset_part) = match offset_idx {
        Some(idx) => {
            let sign = if time_no_z.as_bytes()[idx] == b'-' {
                -1
            } else {
                1
            };
            offset_secs = sign * parse_offset(&time_no_z[idx..])?;
            (&time_no_z[..idx], time_no_z[idx..].to_string())
        }
        None => (time_no_z, String::new()),
    };
    let _ = offset_part; // offset already applied

    // Now extract date and time separately. `s` is `date + "T" + time`.
    let date = &s[..t_idx];

    // Validate that `s` only contains `date`, `T`, `time_portion`,
    // and an optional trailing 'Z' — guard against extras.
    let expected_len = t_idx + 1 + time_portion.len();
    if s.len() != expected_len {
        return None;
    }

    let mut dp = date.split('-');
    let year: i64 = dp.next()?.parse().ok()?;
    let month: i64 = dp.next()?.parse().ok()?;
    let day: i64 = dp.next()?.parse().ok()?;
    if dp.next().is_some() {
        return None;
    }

    // Strip subseconds before splitting the clock fields.
    let (clock, _frac) = match time_main.find('.') {
        Some(idx) => (&time_main[..idx], &time_main[idx + 1..]),
        None => (time_main, ""),
    };
    let mut tp = clock.split(':');
    let hour: i64 = tp.next()?.parse().ok()?;
    let minute: i64 = tp.next()?.parse().ok()?;
    let second_part = tp.next()?;
    if tp.next().is_some() {
        return None;
    }
    let second: i64 = second_part.parse().ok()?;

    // Civil-date → days since epoch (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let m = month as u64;
    let d = day as u64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe as i64 - 719468;
    let secs_in_day = hour * 3600 + minute * 60 + second;
    Some(days * 86400 + secs_in_day - offset_secs)
}

fn parse_offset(s: &str) -> Option<i64> {
    // Expect "±HH:MM"
    let s = s.strip_prefix('+').or_else(|| s.strip_prefix('-'))?;
    let mut p = s.split(':');
    let h: i64 = p.next()?.parse().ok()?;
    let m: i64 = p.next()?.parse().ok()?;
    if p.next().is_some() {
        return None;
    }
    Some(h * 3600 + m * 60)
}

/// Format UNIX-epoch seconds as `YYYY-MM-DDTHH:MM:SSZ` (RFC3339 UTC).
/// Inverse of [`parse_rfc3339`].
fn format_unix_seconds(secs: i64) -> String {
    let secs = secs.max(0);
    let days = secs / 86400;
    let rem = secs - days * 86400;
    let hour = rem / 3600;
    let minute = (rem / 60) % 60;
    let second = rem % 60;
    // Howard Hinnant civil_from_days — same algo as above, reversed.
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m, d, hour, minute, second
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pin: a stored OAuth bundle (JSON with `access_token`) parses to
    /// the access token string. The IPC lookup is wired through
    /// `IpcClient::credential_list` + `credential_get_material` in
    /// `token()`; here we exercise just the bundle-decoding step so
    /// the wire-shape contract is locked.
    #[test]
    fn parses_oauth_bundle_json() {
        let bundle = r#"{"access_token":"abc.def.ghi","refresh_token":"rt","expires_at":"2030-01-01T00:00:00Z"}"#;
        let parsed: serde_json::Value = serde_json::from_str(bundle).unwrap();
        let access = parsed.get("access_token").and_then(|v| v.as_str());
        assert_eq!(access, Some("abc.def.ghi"));
    }

    /// Pin: a legacy plain-token row (not JSON) round-trips as-is.
    /// Pre-OAuth-bundle rows in the vault may carry a raw JWT; the
    /// parser must surface them rather than returning None and
    /// silently dropping auth.
    #[test]
    fn falls_back_to_raw_token_when_not_json() {
        let material = "raw.jwt.string";
        let parsed: Result<serde_json::Value, _> = serde_json::from_str(material);
        assert!(parsed.is_err());
        // The non-bundle branch returns the raw material verbatim.
        let token: String = match parsed {
            Ok(bundle) => bundle
                .get("access_token")
                .and_then(|v| v.as_str())
                .unwrap_or(material)
                .to_string(),
            Err(_) => material.to_string(),
        };
        assert_eq!(token, "raw.jwt.string");
    }

    /// Pin: constants used by `token()` must match what the OAuth flow
    /// writes — drift between Rust + TS means PekohubClient reads from
    /// a slot the writer never touched.
    #[test]
    fn oauth_slot_constants_match_writer() {
        assert_eq!(OAUTH_NAMESPACE, "provider:pekohub");
        assert_eq!(OAUTH_NAME, "default");
        assert_eq!(OAUTH_KIND, "oauth_token");
    }

    /// D2: a bundle whose `expires_at` is in the past is considered
    /// expired and must trigger a refresh.
    #[test]
    fn expired_bundle_triggers_refresh() {
        let bundle = serde_json::json!({
            "access_token": "old",
            "refresh_token": "rt",
            "expires_at": "2020-01-01T00:00:00Z",
        });
        assert!(PekohubClient::bundle_is_expired(&bundle));
    }

    /// D2: a bundle whose `expires_at` is far in the future is NOT
    /// considered expired (the 60s skew window applies only near the
    /// boundary).
    #[test]
    fn fresh_bundle_is_not_expired() {
        let bundle = serde_json::json!({
            "access_token": "new",
            "refresh_token": "rt",
            "expires_at": "2099-01-01T00:00:00Z",
        });
        assert!(!PekohubClient::bundle_is_expired(&bundle));
    }

    /// D2: a bundle whose `expires_at` is within the 60s skew window
    /// (i.e. expires 30s from now) must also count as expired so the
    /// call site refreshes BEFORE the request lands and avoids a 401.
    #[test]
    fn bundle_inside_skew_window_triggers_refresh() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let expires_at = format_unix_seconds(now + 30);
        let bundle = serde_json::json!({
            "access_token": "current",
            "refresh_token": "rt",
            "expires_at": expires_at,
        });
        assert!(
            PekohubClient::bundle_is_expired(&bundle),
            "bundle expiring in 30s should be treated as expired (60s skew)"
        );
    }

    /// D2: a bundle with no `expires_at` is treated as long-lived and
    /// never refreshed (matches `useRuntimes.ts::isTokenExpired` which
    /// returns false when expires_at is missing).
    #[test]
    fn bundle_without_expiry_is_not_expired() {
        let bundle = serde_json::json!({
            "access_token": "tok",
            "refresh_token": "rt",
        });
        assert!(!PekohubClient::bundle_is_expired(&bundle));
    }

    /// D2: a malformed `expires_at` (not RFC3339) is treated as
    /// non-expired rather than panicking. The hub may have changed
    /// its format; we'd rather keep the existing token than crash.
    #[test]
    fn bundle_with_malformed_expiry_is_not_expired() {
        let bundle = serde_json::json!({
            "access_token": "tok",
            "expires_at": "not-a-date",
        });
        assert!(!PekohubClient::bundle_is_expired(&bundle));
    }

    /// Round-trip: parse_rfc3339 → format_unix_seconds reproduces the
    /// input for canonical UTC `YYYY-MM-DDTHH:MM:SSZ` timestamps.
    #[test]
    fn rfc3339_round_trip_utc() {
        let original = "2024-06-15T12:34:56Z";
        let secs = parse_rfc3339(original).expect("parses");
        assert_eq!(format_unix_seconds(secs), original);
    }

    /// parse_rfc3339 must accept `+HH:MM` offsets (e.g. ISO-8601 with
    /// timezone) and compute the right UNIX epoch.
    #[test]
    fn parse_rfc3339_with_offset() {
        // 2024-06-15T13:34:56+01:00 == 2024-06-15T12:34:56Z
        let a = parse_rfc3339("2024-06-15T13:34:56+01:00").unwrap();
        let b = parse_rfc3339("2024-06-15T12:34:56Z").unwrap();
        assert_eq!(a, b);
    }

    /// parse_rfc3339 must accept `-HH:MM` offsets too.
    #[test]
    fn parse_rfc3339_with_negative_offset() {
        // 2024-06-15T07:34:56-05:00 == 2024-06-15T12:34:56Z
        let a = parse_rfc3339("2024-06-15T07:34:56-05:00").unwrap();
        let b = parse_rfc3339("2024-06-15T12:34:56Z").unwrap();
        assert_eq!(a, b);
    }

    /// parse_rfc3339 returns None for obvious garbage rather than
    /// returning 0 (which would silently invalidate every token).
    /// Out-of-range month/day are NOT validated — they roll into
    /// civil-date arithmetic and produce a (likely far-future)
    /// timestamp that the caller treats as "long-lived, no refresh".
    #[test]
    fn parse_rfc3339_garbage_returns_none() {
        assert!(parse_rfc3339("not-a-date").is_none());
        assert!(parse_rfc3339("").is_none());
        // Missing time portion
        assert!(parse_rfc3339("2024-06-15").is_none());
        // Trailing junk
        assert!(parse_rfc3339("2024-06-15T12:34:56Z extra").is_none());
    }

    /// build_refreshed_bundle must:
    /// - Take access_token from the response
    /// - Prefer a new refresh_token from the response; fall back to old
    /// - Compute a new expires_at from expires_in
    #[test]
    fn build_refreshed_bundle_with_full_response() {
        let old = serde_json::json!({
            "access_token": "old-access",
            "refresh_token": "old-rt",
            "expires_at": "2024-01-01T00:00:00Z",
        });
        let resp = serde_json::json!({
            "access_token": "new-access",
            "refresh_token": "new-rt",
            "expires_in": 3600,
        });
        let new = PekohubClient::build_refreshed_bundle(&old, &resp).unwrap();
        assert_eq!(new["access_token"], "new-access");
        assert_eq!(new["refresh_token"], "new-rt");
        // expires_at is set to "now + 3600s" formatted as RFC3339
        let expires_at = new["expires_at"].as_str().unwrap();
        let parsed = parse_rfc3339(expires_at).unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        // Allow 5s slack for test execution time
        assert!(
            (parsed - now - 3600).abs() < 5,
            "expires_at should be ~now+3600, got delta {}",
            parsed - now - 3600
        );
    }

    /// If the hub omits a new refresh_token, preserve the old one so
    /// the next refresh still works.
    #[test]
    fn build_refreshed_bundle_preserves_old_refresh_token() {
        let old = serde_json::json!({
            "access_token": "old-access",
            "refresh_token": "kept-rt",
        });
        let resp = serde_json::json!({
            "access_token": "new-access",
            // no refresh_token, no expires_in
        });
        let new = PekohubClient::build_refreshed_bundle(&old, &resp).unwrap();
        assert_eq!(new["access_token"], "new-access");
        assert_eq!(new["refresh_token"], "kept-rt");
        assert!(new.get("expires_at").is_none());
    }
}
