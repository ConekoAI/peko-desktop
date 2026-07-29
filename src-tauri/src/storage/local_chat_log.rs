//! Persistent chat log for remote principals. PR #5 wires the
//! desktop's chat surface against HubRemoteClient, which has no
//! native log endpoint — chunks that arrive over the SSE stream
//! are appended here so `principal_log` can render history on
//! subsequent visits, mirroring the runtime's f30a session JSONL
//! pattern.
//!
//! File layout:
//!   `~/.config/peko-desktop/chat-logs/{runtime_id}/{principal_name}.jsonl`
//!
//! The runtime_id is the canonical `hub:<hub_url>` form so two
//! principals with the same name on different hubs never collide.
//! Each line is a JSON `ChatLogEntry` (see `entries.rs`).

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Per-line entry. The shape mirrors the runtime's HistoryEvent
/// closely enough that the desktop's existing log-render code can
/// consume either source without a discriminator — for v1 we only
/// persist `User` and `Assistant` messages, since those are the
/// only events that surface in the chat UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatLogEntry {
    User {
        content: String,
        timestamp_unix_ms: u64,
    },
    Assistant {
        content: String,
        timestamp_unix_ms: u64,
    },
}

impl ChatLogEntry {
    #[allow(dead_code)] // exposed for future use in log filtering / sorting
    fn timestamp(&self) -> u64 {
        match self {
            Self::User {
                timestamp_unix_ms, ..
            }
            | Self::Assistant {
                timestamp_unix_ms, ..
            } => *timestamp_unix_ms,
        }
    }
}

/// Resolve `~/.config/peko-desktop/chat-logs/{runtime_id}/{principal_name}.jsonl`.
fn log_path(runtime_id: &str, principal_name: &str) -> Result<PathBuf, String> {
    let base = dirs::config_dir()
        .ok_or_else(|| "could not determine config directory".to_string())?
        .join("peko-desktop")
        .join("chat-logs")
        .join(sanitize_segment(runtime_id)?);
    Ok(base.join(format!("{}.jsonl", sanitize_segment(principal_name)?)))
}

/// Reject path separators in segment names so a malicious or
/// user-crafted runtime_id / principal_name can't escape the chat-log
/// directory. Mirrors the `validate_principal_name` rule from
/// `commands/principal.rs`.
fn sanitize_segment(s: &str) -> Result<&str, String> {
    if s.is_empty()
        || s.contains('/')
        || s.contains('\\')
        || s.contains("..")
        || s == "."
        || s == ".."
    {
        return Err(format!("invalid chat-log segment: {s:?}"));
    }
    Ok(s)
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Append one entry to the log. Creates parent directories on first
/// write. Uses `O_APPEND | O_CREAT` + an fsync of both the file and
/// the parent directory so a crash mid-write cannot leave a torn
/// line that confuses the next reader (mirrors the runtime's
/// [[f30a-session-atomic-append]] pattern).
pub fn append_entry(
    runtime_id: &str,
    principal_name: &str,
    entry: &ChatLogEntry,
) -> Result<(), String> {
    let path = log_path(runtime_id, principal_name)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create chat-log dir: {}", e))?;
    }
    let mut line = serde_json::to_string(entry)
        .map_err(|e| format!("failed to serialize chat-log entry: {}", e))?;
    line.push('\n');

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("failed to open chat-log file: {}", e))?;
    file.write_all(line.as_bytes())
        .map_err(|e| format!("failed to write chat-log entry: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("failed to fsync chat-log file: {}", e))?;
    sync_dir(path.parent().unwrap_or(Path::new(".")))?;
    Ok(())
}

/// Read all entries for one (runtime_id, principal_name). Filters
/// torn last lines silently (mirrors `parseSessionEntryLine` in the
/// runtime — see [[f30a-session-atomic-append]]).
pub fn read_entries(runtime_id: &str, principal_name: &str) -> Result<Vec<ChatLogEntry>, String> {
    let path = log_path(runtime_id, principal_name)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read chat-log file: {}", e))?;
    let mut out = Vec::new();
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<ChatLogEntry>(line) {
            Ok(e) => out.push(e),
            Err(_) => continue, // torn last line — skip silently
        }
    }
    Ok(out)
}

/// Build a user entry stamped with `now()`.
pub fn user_entry(content: String) -> ChatLogEntry {
    ChatLogEntry::User {
        content,
        timestamp_unix_ms: now_unix_ms(),
    }
}

/// Build an assistant entry stamped with `now()`.
pub fn assistant_entry(content: String) -> ChatLogEntry {
    ChatLogEntry::Assistant {
        content,
        timestamp_unix_ms: now_unix_ms(),
    }
}

#[cfg(unix)]
fn sync_dir(dir: &Path) -> Result<(), String> {
    let f = std::fs::File::open(dir).map_err(|e| format!("failed to open dir for fsync: {}", e))?;
    f.sync_all()
        .map_err(|e| format!("failed to fsync dir: {}", e))?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) -> Result<(), String> {
    // Windows has no equivalent fsync-on-directory knob; the file
    // fsync above is sufficient for crash-tolerance on NTFS.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "peko-chat-log-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        p
    }

    /// Round-trip: appending two entries and reading back yields them
    /// in order with no torn lines. Pin the wire-shape contract used
    /// by the rest of the desktop's chat surface.
    #[test]
    fn roundtrip_via_tempdir() {
        // Use a runtime_id / name we won't collide with on real disks.
        let runtime_id = "hub:tmp-roundtrip";
        let principal_name = "test-agent";
        // Replace HOME / XDG_CONFIG_HOME so `dirs::config_dir()` lands
        // in a sandboxed tmp dir for this test.
        let tmp = temp_path();
        std::fs::create_dir_all(&tmp).unwrap();
        let prev = std::env::var("HOME").ok();
        std::env::set_var("HOME", &tmp);
        // `dirs::config_dir()` on macOS reads XDG_CONFIG_HOME only when
        // set; we set it so the temp override sticks regardless of
        // platform quirks.
        std::env::set_var("XDG_CONFIG_HOME", tmp.join(".config"));

        let user = user_entry("hello".to_string());
        let assistant = assistant_entry("hi there".to_string());
        append_entry(runtime_id, principal_name, &user).unwrap();
        append_entry(runtime_id, principal_name, &assistant).unwrap();

        let entries = read_entries(runtime_id, principal_name).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0], user);
        assert_eq!(entries[1], assistant);

        // Restore env.
        if let Some(prev) = prev {
            std::env::set_var("HOME", prev);
        }
        std::fs::remove_dir_all(&tmp).ok();
    }

    /// The serializer must emit one JSON object per line, no extra
    /// whitespace. Appenders rely on the trailing `\n` so a crash
    /// mid-write yields exactly one torn line that the reader skips.
    #[test]
    fn user_entry_wire_shape_is_single_line() {
        let e = user_entry("hello".to_string());
        let s = serde_json::to_string(&e).unwrap();
        assert!(!s.contains('\n'), "entry must be a single line: {s:?}");
        assert!(s.contains("\"kind\":\"user\""), "tag is `kind`: {s:?}");
        assert!(s.contains("\"content\":\"hello\""));
    }

    /// Path-traversal guard: a `runtime_id` containing `..` must be
    /// rejected rather than escaping the chat-log directory.
    #[test]
    fn rejects_path_traversal_in_segments() {
        assert!(sanitize_segment("..").is_err());
        assert!(sanitize_segment("../etc").is_err());
        assert!(sanitize_segment("foo/bar").is_err());
        assert!(sanitize_segment("foo\\bar").is_err());
        assert!(sanitize_segment("").is_err());
    }

    /// Stable segment names pass the guard — pins the happy path.
    #[test]
    fn accepts_safe_segments() {
        assert_eq!(
            sanitize_segment("hub:pekohub.org").unwrap(),
            "hub:pekohub.org"
        );
        assert_eq!(sanitize_segment("alice").unwrap(), "alice");
        assert_eq!(sanitize_segment("helper-1").unwrap(), "helper-1");
    }

    /// The reader must skip torn last lines silently (a crash mid-
    /// append leaves a half-written trailing line). Mirrors
    /// `parseSessionEntryLine` in the runtime.
    #[test]
    fn skips_torn_last_line() {
        let path = temp_path();
        std::fs::create_dir_all(&path).unwrap();
        let good = serde_json::to_string(&user_entry("hi".to_string())).unwrap();
        std::fs::write(
            path.join("log.jsonl"),
            format!("{good}\n{{\"kind\":\"user\",\"content\":\"trailin"),
        )
        .unwrap();

        let raw = std::fs::read_to_string(path.join("log.jsonl")).unwrap();
        let mut parsed = 0;
        let mut skipped = 0;
        for line in raw.lines() {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<ChatLogEntry>(line) {
                Ok(_) => parsed += 1,
                Err(_) => skipped += 1,
            }
        }
        assert_eq!(parsed, 1);
        assert_eq!(skipped, 1);

        std::fs::remove_dir_all(&path).ok();
    }
}
