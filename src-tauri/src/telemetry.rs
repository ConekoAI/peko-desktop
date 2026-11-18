//! What the app reports about itself (pekohub ADR-014).
//!
//! Two things live here: the owner's two privacy choices, and crash
//! reports.
//!
//! - **Choices** are kept in `<peko folder>/desktop/privacy.json`. Until
//!   the owner has passed the first-run privacy screen (`acknowledged`),
//!   nothing is sent, whatever the switches say.
//! - **Crash reports** go to Sentry from this native side, so the
//!   webview's content-security policy stays closed. They are on only in
//!   a build made with `PEKO_DESKTOP_SENTRY_DSN`; without it this module
//!   never opens a connection. A report carries the error's class, its
//!   stack, the app version and the OS family. The home folder is cut
//!   from every path, and there are no breadcrumbs, no host name and no
//!   user.
//!
//! The engine (the sidecar) sends nothing itself. When it stops
//! unexpectedly, this app reports that it did: exit code, signal and
//! version, no log text.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use sentry::protocol::{Event, Exception, Frame, Stacktrace};
use serde::{Deserialize, Serialize};

fn on() -> bool {
    true
}

/// The owner's choices. Both switches start on (ADR-014 decision 5).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyChoices {
    /// The owner has seen the privacy screen and continued.
    #[serde(default)]
    pub acknowledged: bool,
    #[serde(default = "on")]
    pub crash_reports: bool,
    /// Stored now so the screen is shown once; usage events themselves
    /// arrive with ADR-014 build step (c).
    #[serde(default = "on")]
    pub usage_events: bool,
}

impl Default for PrivacyChoices {
    fn default() -> Self {
        Self {
            acknowledged: false,
            crash_reports: true,
            usage_events: true,
        }
    }
}

impl PrivacyChoices {
    /// Crash reports may leave this computer.
    pub fn sends_crash_reports(&self) -> bool {
        self.acknowledged && self.crash_reports
    }
}

/// Read on every report, so turning the switch off stops sending at once.
static CRASH_REPORTS_ON: AtomicBool = AtomicBool::new(false);

fn choices_path() -> Option<PathBuf> {
    crate::commands::system::peko_home().map(|home| home.join("desktop").join("privacy.json"))
}

fn load_from(path: &Path) -> PrivacyChoices {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_to(path: &Path, choices: &PrivacyChoices) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not save: {e}"))?;
    }
    let text = serde_json::to_string_pretty(choices).map_err(|e| format!("could not save: {e}"))?;
    std::fs::write(path, text).map_err(|e| format!("could not save: {e}"))
}

/// The stored choices; the defaults when nothing is stored or readable.
pub fn load() -> PrivacyChoices {
    choices_path().map(|p| load_from(&p)).unwrap_or_default()
}

fn apply(choices: &PrivacyChoices) {
    CRASH_REPORTS_ON.store(choices.sends_crash_reports(), Ordering::Relaxed);
}

/// The Sentry address this build was made with, if any.
fn dsn() -> Option<&'static str> {
    usable_dsn(option_env!("PEKO_DESKTOP_SENTRY_DSN"))
}

/// A mistyped address turns reporting off; it must not stop the app.
fn usable_dsn(built_with: Option<&'static str>) -> Option<&'static str> {
    built_with
        .map(str::trim)
        .filter(|d| d.parse::<sentry::types::Dsn>().is_ok())
}

/// Start crash reporting. Returns a guard to hold for the life of the
/// app (dropping it sends what is still queued), or `None` in a build
/// without a Sentry address.
pub fn init() -> Option<sentry::ClientInitGuard> {
    apply(&load());
    let dsn = dsn()?;
    let home = dirs::home_dir();
    let options = sentry::ClientOptions::new()
        .dsn(dsn)
        .release(env!("CARGO_PKG_VERSION"))
        .environment(if cfg!(debug_assertions) {
            "development"
        } else {
            "production"
        })
        .send_default_pii(false)
        .max_breadcrumbs(0)
        .before_send(move |event| {
            if !CRASH_REPORTS_ON.load(Ordering::Relaxed) {
                return None;
            }
            Some(scrub(event, home.as_deref()))
        });
    let guard = sentry::init(options);
    sentry::configure_scope(|scope| {
        scope.set_tag("os", std::env::consts::OS);
        scope.set_tag("arch", std::env::consts::ARCH);
    });
    Some(guard)
}

/// `text` with the home folder replaced by `~`, so a path does not carry
/// the account name on this computer.
fn without_home(text: &str, home: Option<&Path>) -> String {
    match home.map(|h| h.display().to_string()) {
        Some(home) if home.len() > 1 => text.replace(&home, "~"),
        _ => text.to_string(),
    }
}

/// Remove from a report everything ADR-014 says never leaves.
fn scrub(mut event: Event<'static>, home: Option<&Path>) -> Event<'static> {
    event.server_name = None;
    event.user = None;
    event.request = None;
    event.breadcrumbs.values.clear();
    event.extra.clear();
    event.message = event.message.map(|m| without_home(&m, home));
    for exception in &mut event.exception.values {
        exception.value = exception.value.take().map(|v| without_home(&v, home));
        if let Some(stack) = exception.stacktrace.as_mut() {
            for frame in &mut stack.frames {
                frame.vars.clear();
                frame.abs_path = frame.abs_path.take().map(|p| without_home(&p, home));
                frame.filename = frame.filename.take().map(|p| without_home(&p, home));
            }
        }
    }
    event
}

/// One line of a stack, as the window sends it.
#[derive(Debug, Deserialize)]
pub struct UiFrame {
    pub function: Option<String>,
    pub file: Option<String>,
    pub line: Option<u64>,
    pub column: Option<u64>,
}

const MAX_UI_FRAMES: usize = 50;
const MAX_TEXT: usize = 300;

fn clip(text: String) -> String {
    text.chars().take(MAX_TEXT).collect()
}

fn ui_error_event(name: String, message: Option<String>, frames: Vec<UiFrame>) -> Event<'static> {
    // The window lists the newest call first; Sentry wants it last.
    let frames: Vec<Frame> = frames
        .into_iter()
        .take(MAX_UI_FRAMES)
        .map(|f| Frame {
            function: f.function.map(clip),
            filename: f.file.map(clip),
            lineno: f.line,
            colno: f.column,
            ..Default::default()
        })
        .rev()
        .collect();
    let mut event = Event {
        level: sentry::Level::Error,
        exception: vec![Exception {
            ty: clip(name),
            value: message.map(clip),
            stacktrace: (!frames.is_empty()).then(|| Stacktrace {
                frames,
                ..Default::default()
            }),
            ..Default::default()
        }]
        .into(),
        ..Default::default()
    };
    event.tags.insert("source".into(), "window".into());
    event
}

/// Report that the engine stopped when nobody asked it to.
pub fn report_engine_exit(code: Option<i32>, signal: Option<i32>, version: Option<&str>) {
    if !CRASH_REPORTS_ON.load(Ordering::Relaxed) {
        return;
    }
    let mut event = Event {
        level: sentry::Level::Error,
        message: Some("the engine stopped unexpectedly".into()),
        ..Default::default()
    };
    event.tags.insert("source".into(), "engine".into());
    if let Some(code) = code {
        event.tags.insert("exit_code".into(), code.to_string());
    }
    if let Some(signal) = signal {
        event.tags.insert("signal".into(), signal.to_string());
    }
    if let Some(version) = version {
        event
            .tags
            .insert("engine_version".into(), clip(version.to_string()));
    }
    sentry::capture_event(event);
}

// ─── Commands ────────────────────────────────────────────────────

#[tauri::command]
pub fn privacy_get() -> PrivacyChoices {
    load()
}

#[tauri::command]
pub fn privacy_set(choices: PrivacyChoices) -> Result<PrivacyChoices, String> {
    let path = choices_path().ok_or_else(|| "could not determine the peko folder".to_string())?;
    save_to(&path, &choices)?;
    apply(&choices);
    Ok(choices)
}

/// An error the window caught. The window sends the error's class and
/// stack; it sends a message only for the JavaScript engine's own error
/// classes, whose text is about code (`src/lib/errorReporting.ts`).
#[tauri::command]
pub fn report_ui_error(name: String, message: Option<String>, frames: Vec<UiFrame>) {
    if !CRASH_REPORTS_ON.load(Ordering::Relaxed) {
        return;
    }
    sentry::capture_event(ui_error_event(name, message, frames));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_sent_before_the_privacy_screen_is_passed() {
        let fresh = PrivacyChoices::default();
        assert!(fresh.crash_reports && fresh.usage_events);
        assert!(!fresh.sends_crash_reports());
        let passed = PrivacyChoices {
            acknowledged: true,
            ..fresh
        };
        assert!(passed.sends_crash_reports());
        let off = PrivacyChoices {
            crash_reports: false,
            ..passed
        };
        assert!(!off.sends_crash_reports());
    }

    #[test]
    fn choices_survive_a_restart_and_a_missing_file_means_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop").join("privacy.json");
        assert_eq!(load_from(&path), PrivacyChoices::default());
        let chosen = PrivacyChoices {
            acknowledged: true,
            crash_reports: false,
            usage_events: true,
        };
        save_to(&path, &chosen).unwrap();
        assert_eq!(load_from(&path), chosen);
    }

    #[test]
    fn a_file_from_an_older_build_keeps_the_switches_on() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("privacy.json");
        std::fs::write(&path, r#"{"acknowledged":true}"#).unwrap();
        let loaded = load_from(&path);
        assert!(loaded.acknowledged && loaded.crash_reports && loaded.usage_events);
    }

    #[test]
    fn a_build_with_no_address_or_a_mistyped_one_reports_nothing() {
        assert_eq!(usable_dsn(None), None);
        assert_eq!(usable_dsn(Some("")), None);
        assert_eq!(usable_dsn(Some("not an address")), None);
        let good = "https://abc123@o1.ingest.sentry.io/42";
        assert_eq!(usable_dsn(Some(good)), Some(good));
    }

    #[test]
    fn a_report_carries_no_home_folder_host_user_or_breadcrumbs() {
        let home = Path::new("/Users/ada");
        let mut event = Event {
            server_name: Some("adas-macbook".into()),
            user: Some(sentry::User {
                username: Some("ada".into()),
                ..Default::default()
            }),
            message: Some("could not open /Users/ada/.peko/config.toml".into()),
            exception: vec![Exception {
                ty: "Panic".into(),
                value: Some("no such file: /Users/ada/notes/plan.md".into()),
                stacktrace: Some(Stacktrace {
                    frames: vec![Frame {
                        abs_path: Some("/Users/ada/src/app/main.rs".into()),
                        filename: Some("/Users/ada/src/app/main.rs".into()),
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
                ..Default::default()
            }]
            .into(),
            ..Default::default()
        };
        event.breadcrumbs.values.push(Default::default());
        event.extra.insert("note".into(), "anything".into());

        let sent = scrub(event, Some(home));
        let text = serde_json::to_string(&sent).unwrap();
        assert!(!text.contains("ada"), "{text}");
        assert!(text.contains("~/.peko/config.toml"));
        assert!(sent.breadcrumbs.values.is_empty() && sent.extra.is_empty());
    }

    #[test]
    fn a_window_error_keeps_its_class_and_stack_oldest_call_first() {
        let event = ui_error_event(
            "TypeError".into(),
            Some("x is undefined".into()),
            vec![
                UiFrame {
                    function: Some("render".into()),
                    file: Some("assets/index.js".into()),
                    line: Some(10),
                    column: Some(4),
                },
                UiFrame {
                    function: Some("main".into()),
                    file: Some("assets/index.js".into()),
                    line: Some(1),
                    column: Some(1),
                },
            ],
        );
        let exception = &event.exception.values[0];
        assert_eq!(exception.ty, "TypeError");
        let frames = &exception.stacktrace.as_ref().unwrap().frames;
        assert_eq!(frames[0].function.as_deref(), Some("main"));
        assert_eq!(frames[1].function.as_deref(), Some("render"));
        assert_eq!(event.tags.get("source").map(String::as_str), Some("window"));
    }
}
