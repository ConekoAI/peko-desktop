//! Persistent storage modules for the desktop.
//!
//! Two surfaces live here:
//! - `remote_principals` — the `~/.peko/remote-principals.json` table
//!   that backs the "Connect to a remote principal" flow (PR #4).
//! - `local_chat_log` — the per-principal JSONL chat log that backs
//!   `principal_log` for remote principals, since pekohub has no
//!   read API for it yet (PR #5).

pub mod local_chat_log;
pub mod remote_principals;