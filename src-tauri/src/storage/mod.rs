//! Persistent storage modules for the desktop.
//!
//! - `remote_principals` — the `~/.peko/remote-principals.json` table
//!   that backs the "Connect to a remote principal" flow (PR #4). A
//!   remote peko's conversation is not stored here: it is the DM this
//!   computer's runtime holds with it (runtime ADR-090).

pub mod remote_principals;
