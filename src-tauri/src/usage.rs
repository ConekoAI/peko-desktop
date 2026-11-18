//! Usage events (pekohub ADR-014 decisions 3 to 5).
//!
//! The window asks for an event by name with a few properties; this side
//! decides whether it leaves. It leaves only when all of these hold:
//!
//! - the name and every property are on the list below, with a value the
//!   list allows (a fixed word, a yes/no, or a version number). Anything
//!   else is refused, so a name, a path or a sentence cannot ride along;
//! - the owner has passed the privacy screen with usage counts on;
//! - the app was built with `PEKO_DESKTOP_POSTHOG_KEY`.
//!
//! Each event also carries the app, its version, the OS family and a
//! random install id kept in `<peko folder>/desktop/install-id`. After
//! sign-in the install id is linked once to the account's analytics id (a
//! random value PekoHub keeps for this; never the account id). That
//! happens on this side, so the window never holds the id.
//!
//! Sent from here, not the window, so the window's content-security
//! policy stays closed. Adding an event amends the ADR.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

/// What a property's value may be.
#[derive(Clone, Copy, Debug)]
enum Allowed {
    /// One of these words.
    OneOf(&'static [&'static str]),
    Bool,
    /// A version number: digits and dots, with an optional `-suffix`.
    Version,
}

/// Every event the app may send, with the properties each may carry.
const EVENTS: &[(&str, &[(&str, Allowed)])] = &[
    ("app_opened", &[]),
    (
        "onboarding_step",
        &[(
            "step",
            Allowed::OneOf(&["model", "peko", "hello", "done", "skipped"]),
        )],
    ),
    (
        "model_key_added",
        &[(
            "api_format",
            Allowed::OneOf(&["openai", "anthropic", "responses", "other"]),
        )],
    ),
    (
        "peko_created",
        &[("from", Allowed::OneOf(&["blank", "seed"]))],
    ),
    (
        "first_reply_received",
        &[(
            "since_install",
            Allowed::OneOf(&["under_1m", "under_5m", "under_30m", "under_1d", "over_1d"]),
        )],
    ),
    (
        "message_sent",
        &[
            ("kind", Allowed::OneOf(&["dm", "group"])),
            ("has_attachment", Allowed::Bool),
        ],
    ),
    ("group_created", &[]),
    (
        "approval_decided",
        &[("decision", Allowed::OneOf(&["approve", "deny", "always"]))],
    ),
    ("hub_signed_in", &[]),
    (
        "settings_changed",
        &[(
            "setting",
            Allowed::OneOf(&[
                "theme",
                "language",
                "keep_awake",
                "crash_reports",
                "usage_events",
            ]),
        )],
    ),
    (
        "update_installed",
        &[
            ("from_version", Allowed::Version),
            ("to_version", Allowed::Version),
        ],
    ),
];

fn is_version(text: &str) -> bool {
    let (numbers, suffix) = text.split_once('-').unwrap_or((text, ""));
    !numbers.is_empty()
        && text.len() <= 32
        && numbers
            .split('.')
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
        && suffix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.')
}

/// The properties to send for `name`, or why the event is refused.
fn checked(name: &str, given: &Map<String, Value>) -> Result<BTreeMap<String, Value>, String> {
    let (_, allowed) = EVENTS
        .iter()
        .find(|(event, _)| *event == name)
        .ok_or_else(|| format!("{name} is not a usage event"))?;
    let mut out = BTreeMap::new();
    for (key, value) in given {
        let (_, kind) = allowed
            .iter()
            .find(|(k, _)| k == key)
            .ok_or_else(|| format!("{name} has no property {key}"))?;
        let ok = match (kind, value) {
            (Allowed::OneOf(words), Value::String(s)) => words.contains(&s.as_str()),
            (Allowed::Bool, Value::Bool(_)) => true,
            (Allowed::Version, Value::String(s)) => is_version(s),
            _ => false,
        };
        if !ok {
            return Err(format!("{name}.{key} has a value that is not allowed"));
        }
        out.insert(key.clone(), value.clone());
    }
    Ok(out)
}

fn key() -> Option<&'static str> {
    option_env!("PEKO_DESKTOP_POSTHOG_KEY")
        .map(str::trim)
        .filter(|k| !k.is_empty())
}

fn host() -> &'static str {
    option_env!("PEKO_DESKTOP_POSTHOG_HOST")
        .map(str::trim)
        .filter(|h| h.starts_with("https://"))
        .unwrap_or("https://eu.i.posthog.com")
}

fn desktop_dir() -> Option<PathBuf> {
    crate::commands::system::peko_home().map(|home| home.join("desktop"))
}

/// 32 random hex digits from the system's generator.
fn random_id() -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn is_id(text: &str) -> bool {
    (32..=36).contains(&text.len()) && text.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// This install's id, made on first use.
fn install_id_in(dir: &std::path::Path) -> Option<String> {
    let path = dir.join("install-id");
    if let Ok(found) = std::fs::read_to_string(&path) {
        let found = found.trim();
        if is_id(found) {
            return Some(found.to_string());
        }
    }
    let id = random_id()?;
    std::fs::create_dir_all(dir).ok()?;
    std::fs::write(&path, &id).ok()?;
    Some(id)
}

/// The body PostHog's capture endpoint takes.
fn body(key: &str, event: &str, distinct_id: &str, properties: BTreeMap<String, Value>) -> Value {
    let mut all: Map<String, Value> = properties.into_iter().collect();
    all.insert("app".into(), json!("desktop"));
    all.insert("app_version".into(), json!(env!("CARGO_PKG_VERSION")));
    all.insert("os".into(), json!(std::env::consts::OS));
    all.insert("$geoip_disable".into(), json!(true));
    json!({ "api_key": key, "event": event, "distinct_id": distinct_id, "properties": all })
}

fn post(body: Value) {
    let url = format!("{}/i/v0/e/", host());
    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
        {
            Ok(client) => client,
            Err(_) => return,
        };
        // A usage event that does not arrive is simply not counted.
        let _ = client.post(url).json(&body).send().await;
    });
}

/// Whether events may leave: the owner's choice, and a key in this build.
fn sending() -> Option<&'static str> {
    crate::telemetry::load()
        .sends_usage_events()
        .then(key)
        .flatten()
}

// ─── Commands ────────────────────────────────────────────────────

/// Count one thing that happened. Refuses anything not on the list.
#[tauri::command]
pub fn usage_event(name: String, properties: Option<Map<String, Value>>) -> Result<(), String> {
    let properties = checked(&name, &properties.unwrap_or_default())?;
    let (Some(key), Some(dir)) = (sending(), desktop_dir()) else {
        return Ok(());
    };
    if let Some(id) = install_id_in(&dir) {
        post(body(key, &name, &id, properties));
    }
    Ok(())
}

/// Link this install to the signed-in account's analytics id, once per
/// account, and count the sign-in. Called when the app reads the account
/// from PekoHub (`commands/hub_http.rs`); the id never passes through the
/// window.
pub fn link_account(analytics_id: &str) {
    if !is_id(analytics_id) {
        return;
    }
    let (Some(key), Some(dir)) = (sending(), desktop_dir()) else {
        return;
    };
    let linked = dir.join("linked-account");
    if std::fs::read_to_string(&linked).is_ok_and(|was| was.trim() == analytics_id) {
        return;
    }
    let Some(install) = install_id_in(&dir) else {
        return;
    };
    let mut properties = BTreeMap::new();
    properties.insert("$anon_distinct_id".to_string(), json!(install));
    post(body(key, "$identify", analytics_id, properties));
    post(body(key, "hub_signed_in", &install, BTreeMap::new()));
    let _ = std::fs::write(&linked, analytics_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn props(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap_or_default()
    }

    #[test]
    fn an_event_on_the_list_passes_with_its_allowed_values() {
        assert!(checked("app_opened", &Map::new()).is_ok());
        let sent = checked(
            "message_sent",
            &props(json!({"kind": "group", "has_attachment": true})),
        )
        .unwrap();
        assert_eq!(sent.get("kind"), Some(&json!("group")));
        assert!(checked(
            "update_installed",
            &props(json!({"from_version": "0.2.0", "to_version": "0.3.0-beta.1"}))
        )
        .is_ok());
    }

    #[test]
    fn a_name_a_property_or_a_value_off_the_list_is_refused() {
        assert!(checked("peko_renamed", &Map::new()).is_err());
        assert!(checked("app_opened", &props(json!({"peko": "Momo"}))).is_err());
        assert!(checked(
            "message_sent",
            &props(json!({"kind": "hello Ada, about the plan"}))
        )
        .is_err());
        assert!(checked(
            "message_sent",
            &props(json!({"has_attachment": "/Users/ada/notes.md"}))
        )
        .is_err());
        assert!(checked("settings_changed", &props(json!({"setting": "hub_url"}))).is_err());
        assert!(checked(
            "update_installed",
            &props(json!({"to_version": "see /Users/ada"}))
        )
        .is_err());
        assert!(checked("onboarding_step", &props(json!({"step": 3}))).is_err());
    }

    #[test]
    fn the_install_id_is_made_once_and_kept() {
        let dir = tempfile::tempdir().unwrap();
        let first = install_id_in(dir.path()).unwrap();
        assert_eq!(first.len(), 32);
        assert_eq!(install_id_in(dir.path()).unwrap(), first);
        // A damaged file is replaced, not sent.
        std::fs::write(dir.path().join("install-id"), "Ada's MacBook").unwrap();
        let replaced = install_id_in(dir.path()).unwrap();
        assert!(is_id(&replaced) && replaced != "Ada's MacBook");
    }

    #[test]
    fn what_is_sent_is_the_event_the_id_and_the_fixed_context() {
        let sent = body(
            "phc_test",
            "app_opened",
            "0123456789abcdef0123456789abcdef",
            BTreeMap::new(),
        );
        assert_eq!(sent["event"], "app_opened");
        assert_eq!(sent["distinct_id"], "0123456789abcdef0123456789abcdef");
        let properties = sent["properties"].as_object().unwrap();
        let mut keys: Vec<_> = properties.keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(keys, ["$geoip_disable", "app", "app_version", "os"]);
    }

    #[test]
    fn only_an_id_can_be_linked() {
        assert!(!is_id("ada@example.com"));
        assert!(!is_id("Ada"));
        assert!(is_id("0f0e0d0c-0000-4000-8000-000000000001"));
    }
}
