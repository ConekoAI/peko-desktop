//! Channel Tauri commands (peko-channel cross-runtime desktop UI).
//!
//! PR-1 shipped the read-only surface (list / get / events / members);
//! PR-2a adds `channel_post`. Invites + leaves arrive in PR-3.
//!
//! Wire shape mirrors `peko_runtime::ipc::packet::RequestPacket`:
//!
//! - `channel_list` → `RequestPacket::ChannelList { principal_name }`
//!   → response: `channel_list_result` with `channels: Vec<ChannelId>`
//! - `channel_get` → `RequestPacket::ChannelShow` (currently a thin
//!   wrapper around `ChannelMembers` on the runtime side — the
//!   authoritative metadata lives in the event log's first `Created`
//!   event, so `channel_get` actually calls `ChannelPeek` and projects
//!   from the events).
//! - `channel_events` → `RequestPacket::ChannelPeek { since }`
//!   → response: `channel_peek_result` with `events: Vec<ChannelEvent>`
//! - `channel_members` → `RequestPacket::ChannelMembers`
//!   → response: `channel_members_result` with `members: Vec<PrincipalId>`
//! - `channel_post` → `RequestPacket::ChannelPost { sender_name, text, parent }`
//!   → response: `channel_posted` with `task_id: String` (PR-2a)
//!
//! All commands thread `runtime_id` for cross-runtime routing
//! (`hub:<url>` style ids route through `HubRemoteClient` in PR #5;
//! `None` / `"local"` resolve to the local IPC client). Mirrors the
//! pattern at `principal.rs:35-71` (PR #3 / PR #5).

use serde::{Deserialize, Serialize};

use crate::state::AppState;

// ---------------------------------------------------------------------------
// Wire types — projected from the runtime's `serde_json::Value` envelopes
// ---------------------------------------------------------------------------

/// Summary row for the channel sidebar. The runtime returns only
/// `ChannelId` values from `ChannelList`; we project them to a
/// desktop-shaped struct that the React sidebar can consume.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSummary {
    pub channel_id: String,
    pub runtime_id: String,
}

/// Single channel's full metadata + recent activity snapshot.
/// Projected from the runtime's `ChannelPeek` response — the first
/// `Created` event gives name/creator/at, and the `Member*` events
/// give the membership timeline. Returned as `null` for a miss (the
/// runtime signals "unknown channel" by an empty events list).
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChannelDetail {
    pub channel_id: String,
    pub name: String,
    pub creator: String,
    pub created_at: String,
    pub member_count: usize,
    pub runtime_id: String,
}

/// Mirrors `peko_protocol::channel::ChannelEvent`'s
/// `#[serde(tag = "kind", rename_all = "snake_case")]` shape so the
/// React side can switch on `kind` directly. Fields kept camelCase
/// to match the rest of the desktop's wire convention
/// (`src/types/index.ts` uses `rename_all = "camelCase"`).
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChannelEvent {
    Created {
        channel: String,
        creator: String,
        name: String,
        at: String,
    },
    Posted {
        channel: String,
        author: String,
        parent: Option<String>,
        text: String,
        at: String,
    },
    MemberJoined {
        channel: String,
        member: String,
        at: String,
    },
    MemberLeft {
        channel: String,
        member: String,
        at: String,
    },
}

/// Mirrors `peko_protocol::channel::ChannelMembership`'s field set
/// (which is what `ChannelMembersResult.members` carries in the IPC
/// response). Returned as `Vec<String>` of principal DIDs.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMembers {
    pub channel_id: String,
    pub members: Vec<String>,
    pub runtime_id: String,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// List channels the named principal is a member of. The desktop
/// sidebar dedupes across principals by `channel_id` to render a
/// unified list.
///
/// `principal_name` is required (channel membership is per-principal).
/// Pass the active principal's name; the frontend will issue N
/// queries (one per principal) and merge.
#[tauri::command]
pub async fn channel_list(
    state: tauri::State<'_, AppState>,
    principal_name: String,
    runtime_id: Option<String>,
) -> Result<Vec<ChannelSummary>, String> {
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    let _ = resolved; // PR #5 will branch on `resolved`.
    let runtime_id = runtime_id.unwrap_or_else(|| "local".to_string());

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_list(&principal_name)
        .await
        .map_err(|e| format!("channel_list failed: {e}"))?;

    Ok(project_channel_list_envelope(&value, &runtime_id))
}

/// Look up a single channel's metadata + member count. Returns
/// `Ok(None)` if the channel doesn't exist on the runtime (empty
/// events list is the runtime's miss signal).
#[tauri::command]
pub async fn channel_get(
    state: tauri::State<'_, AppState>,
    channel_id: String,
    runtime_id: Option<String>,
) -> Result<Option<ChannelDetail>, String> {
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    let _ = resolved;
    let runtime_id = runtime_id.unwrap_or_else(|| "local".to_string());

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_peek(&channel_id, None)
        .await
        .map_err(|e| format!("channel_get failed: {e}"))?;

    Ok(project_channel_get_envelope(&value, &channel_id, &runtime_id))
}

/// List events on `channel_id` since `since` (None = from start).
/// Returns an empty Vec if the channel doesn't exist.
#[tauri::command]
pub async fn channel_events(
    state: tauri::State<'_, AppState>,
    channel_id: String,
    since: Option<String>,
    runtime_id: Option<String>,
) -> Result<Vec<ChannelEvent>, String> {
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    let _ = resolved;
    let runtime_id_echo = runtime_id.unwrap_or_else(|| "local".to_string());

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_peek(&channel_id, since.as_deref())
        .await
        .map_err(|e| format!("channel_events failed: {e}"))?;

    Ok(project_channel_events_envelope(
        &value,
        &channel_id,
        &runtime_id_echo,
    ))
}

/// List the principal DIDs currently in `channel_id`. Delegates to
/// the runtime's `ChannelMembers` IPC variant, which derives the
/// authoritative membership from the `MemberJoined` / `MemberLeft`
/// event log.
#[tauri::command]
pub async fn channel_members(
    state: tauri::State<'_, AppState>,
    channel_id: String,
    runtime_id: Option<String>,
) -> Result<ChannelMembers, String> {
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    let _ = resolved;
    let runtime_id = runtime_id.unwrap_or_else(|| "local".to_string());

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_members(&channel_id)
        .await
        .map_err(|e| format!("channel_members failed: {e}"))?;

    Ok(project_channel_members_envelope(&value, &channel_id, &runtime_id))
}

/// PR-2a: post a message to `channel_id` from `sender_name`. The
/// runtime mints a fresh `task_id` for the message, appends a
/// `Posted` event to the channel log, and (for cross-runtime
/// channels) fans out via the `TunnelChannelEvent` envelope. Returns
/// the `task_id` so the frontend can correlate an inbound peko-stream
/// event back to its outbound post when PR-2b lights up the live
/// stream.
#[tauri::command]
pub async fn channel_post(
    state: tauri::State<'_, AppState>,
    channel_id: String,
    sender_name: String,
    text: String,
    parent: Option<String>,
    runtime_id: Option<String>,
) -> Result<String, String> {
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    let _ = resolved;
    let _ = runtime_id.unwrap_or_else(|| "local".to_string());

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_post(&channel_id, &sender_name, &text, parent.as_deref())
        .await
        .map_err(|e| format!("channel_post failed: {e}"))?;

    Ok(project_channel_posted_envelope(&value))
}

// ---------------------------------------------------------------------------
// Envelope projectors (extracted for unit-testability)
// ---------------------------------------------------------------------------

/// Project `{"type": "channel_list_result", "channels": [...]}` into
/// `Vec<ChannelSummary>`.
fn project_channel_list_envelope(
    value: &serde_json::Value,
    runtime_id: &str,
) -> Vec<ChannelSummary> {
    let empty = Vec::new();
    let items = value
        .get("channels")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    items
        .iter()
        .filter_map(|v| v.as_str())
        .map(|id| ChannelSummary {
            channel_id: id.to_string(),
            runtime_id: runtime_id.to_string(),
        })
        .collect()
}

/// Project the events list returned by `channel_peek` into a
/// `ChannelDetail`. Returns `None` when no `Created` event exists
/// (i.e. unknown channel — the runtime's miss signal).
fn project_channel_get_envelope(
    value: &serde_json::Value,
    channel_id: &str,
    runtime_id: &str,
) -> Option<ChannelDetail> {
    let raw_events = value.get("events").and_then(|v| v.as_array())?;
    let parsed: Vec<ChannelEvent> = raw_events
        .iter()
        .filter_map(|e| parse_channel_event(e, channel_id))
        .collect();

    // First `Created` event gives us name + creator + at.
    let created = parsed
        .iter()
        .find(|e| matches!(e, ChannelEvent::Created { .. }))?;
    let (name, creator, created_at) = match created {
        ChannelEvent::Created {
            name, creator, at, ..
        } => (name.clone(), creator.clone(), at.clone()),
        _ => unreachable!("filtered to Created above"),
    };

    // Member count: #Joined - #Left. The runtime's `ChannelMembers`
    // IPC computes this authoritatively; the desktop uses the event
    // log so `channel_get` stays a single round-trip. Both arrive at
    // the same answer for any well-formed channel.
    let mut joined = 0usize;
    let mut left = 0usize;
    for e in &parsed {
        match e {
            ChannelEvent::MemberJoined { .. } => joined += 1,
            ChannelEvent::MemberLeft { .. } => left += 1,
            _ => {}
        }
    }
    let member_count = joined.saturating_sub(left);

    Some(ChannelDetail {
        channel_id: channel_id.to_string(),
        name,
        creator,
        created_at,
        member_count,
        runtime_id: runtime_id.to_string(),
    })
}

/// Project the events list into `Vec<ChannelEvent>`. Unknown variants
/// are skipped (forward-compat — the runtime may add new event
/// variants without breaking the desktop).
fn project_channel_events_envelope(
    value: &serde_json::Value,
    channel_id: &str,
    _runtime_id: &str,
) -> Vec<ChannelEvent> {
    let empty = Vec::new();
    let raw_events = value
        .get("events")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    raw_events
        .iter()
        .filter_map(|e| parse_channel_event(e, channel_id))
        .collect()
}

/// Project the members list into `ChannelMembers`.
fn project_channel_members_envelope(
    value: &serde_json::Value,
    channel_id: &str,
    runtime_id: &str,
) -> ChannelMembers {
    let empty = Vec::new();
    let members = value
        .get("members")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty)
        .iter()
        .filter_map(|m| m.as_str().map(|s| s.to_string()))
        .collect();
    ChannelMembers {
        channel_id: channel_id.to_string(),
        members,
        runtime_id: runtime_id.to_string(),
    }
}

/// PR-2a: extract `task_id` from a `ChannelPosted` envelope. Returns
/// an empty string on a malformed envelope — the caller surfaces it as
/// a UI error so the user retries rather than silently failing.
fn project_channel_posted_envelope(value: &serde_json::Value) -> String {
    value
        .get("task_id")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string()
}

/// Parse one `ChannelEvent` from the runtime's `serde_json::Value`
/// representation. Tolerates missing fields by returning `None` —
/// the frontend sees only well-formed events.
fn parse_channel_event(value: &serde_json::Value, fallback_channel: &str) -> Option<ChannelEvent> {
    let kind = value.get("kind").and_then(|k| k.as_str())?;
    let channel = value
        .get("channel")
        .and_then(|c| c.as_str())
        .unwrap_or(fallback_channel)
        .to_string();
    let at = value
        .get("at")
        .and_then(|a| a.as_str())
        .unwrap_or("")
        .to_string();
    match kind {
        "created" => Some(ChannelEvent::Created {
            channel,
            creator: value
                .get("creator")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string(),
            name: value
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string(),
            at,
        }),
        "posted" => Some(ChannelEvent::Posted {
            channel,
            author: value
                .get("author")
                .and_then(|a| a.as_str())
                .unwrap_or("")
                .to_string(),
            parent: value
                .get("parent")
                .and_then(|p| p.as_str())
                .map(|s| s.to_string()),
            text: value
                .get("text")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string(),
            at,
        }),
        "member_joined" => Some(ChannelEvent::MemberJoined {
            channel,
            member: value
                .get("member")
                .and_then(|m| m.as_str())
                .unwrap_or("")
                .to_string(),
            at,
        }),
        "member_left" => Some(ChannelEvent::MemberLeft {
            channel,
            member: value
                .get("member")
                .and_then(|m| m.as_str())
                .unwrap_or("")
                .to_string(),
            at,
        }),
        _ => None, // unknown variant — forward-compat skip
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn project_channel_list_envelope_extracts_ids() {
        let v = json!({
            "type": "channel_list_result",
            "channels": ["chan_aaaaaaaa", "chan_bbbbbbbb"],
        });
        let rows = project_channel_list_envelope(&v, "local");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].channel_id, "chan_aaaaaaaa");
        assert_eq!(rows[1].runtime_id, "local");
    }

    #[test]
    fn project_channel_list_envelope_handles_missing_field() {
        let v = json!({"type": "channel_list_result"});
        assert!(project_channel_list_envelope(&v, "local").is_empty());
    }

    #[test]
    fn project_channel_get_envelope_pulls_metadata_from_created() {
        let v = json!({
            "type": "channel_peek_result",
            "channel": "chan_aaaaaaaa",
            "events": [
                {"kind": "created", "channel": "chan_aaaaaaaa", "creator": "prin_alice", "name": "team", "at": "2026-08-06T12:00:00Z"},
                {"kind": "posted", "channel": "chan_aaaaaaaa", "author": "prin_alice", "parent": null, "text": "hi", "at": "2026-08-06T12:01:00Z"},
                {"kind": "member_joined", "channel": "chan_aaaaaaaa", "member": "prin_bob", "at": "2026-08-06T12:00:30Z"},
            ],
        });
        let detail = project_channel_get_envelope(&v, "chan_aaaaaaaa", "local").unwrap();
        assert_eq!(detail.name, "team");
        assert_eq!(detail.creator, "prin_alice");
        assert_eq!(detail.created_at, "2026-08-06T12:00:00Z");
        assert_eq!(detail.member_count, 1);
        assert_eq!(detail.runtime_id, "local");
    }

    #[test]
    fn project_channel_get_envelope_returns_none_without_created() {
        // Empty events = runtime's miss signal.
        let v = json!({"type": "channel_peek_result", "events": []});
        assert!(project_channel_get_envelope(&v, "chan_aaaaaaaa", "local").is_none());
    }

    #[test]
    fn project_channel_get_envelope_subtracts_left_from_joined() {
        let v = json!({
            "events": [
                {"kind": "created", "channel": "c", "creator": "a", "name": "n", "at": "t"},
                {"kind": "member_joined", "channel": "c", "member": "b", "at": "t1"},
                {"kind": "member_joined", "channel": "c", "member": "c", "at": "t2"},
                {"kind": "member_left", "channel": "c", "member": "b", "at": "t3"},
            ],
        });
        let detail = project_channel_get_envelope(&v, "c", "local").unwrap();
        assert_eq!(detail.member_count, 1); // c joined, b joined-then-left
    }

    #[test]
    fn project_channel_events_envelope_skips_unknown_variants() {
        let v = json!({
            "events": [
                {"kind": "created", "channel": "c", "creator": "a", "name": "n", "at": "t"},
                {"kind": "future_variant", "channel": "c", "at": "t"},
                {"kind": "posted", "channel": "c", "author": "a", "parent": null, "text": "hi", "at": "t"},
            ],
        });
        let events = project_channel_events_envelope(&v, "c", "local");
        assert_eq!(events.len(), 2);
        assert!(matches!(events[0], ChannelEvent::Created { .. }));
        assert!(matches!(events[1], ChannelEvent::Posted { .. }));
    }

    #[test]
    fn project_channel_members_envelope_extracts_dids() {
        let v = json!({
            "type": "channel_members_result",
            "channel": "chan_aaaaaaaa",
            "members": ["prin_alice", "prin_bob"],
        });
        let m = project_channel_members_envelope(&v, "chan_aaaaaaaa", "local");
        assert_eq!(m.channel_id, "chan_aaaaaaaa");
        assert_eq!(m.members, vec!["prin_alice", "prin_bob"]);
    }

    #[test]
    fn parse_channel_event_handles_missing_channel_field() {
        // A posted event with no `channel` field falls back to the
        // `fallback_channel` argument (defensive — runtime always
        // populates it, but the projector should not panic on
        // malformed envelopes).
        let v = json!({
            "kind": "posted",
            "author": "prin_alice",
            "parent": null,
            "text": "hi",
            "at": "t",
        });
        let e = parse_channel_event(&v, "chan_fallback").unwrap();
        if let ChannelEvent::Posted { channel, .. } = e {
            assert_eq!(channel, "chan_fallback");
        } else {
            panic!("expected Posted");
        }
    }

    #[test]
    fn project_channel_posted_envelope_extracts_task_id() {
        let v = json!({
            "type": "channel_posted",
            "channel": "chan_aaaaaaaa",
            "task_id": "task_0123456789abcdef",
        });
        assert_eq!(
            project_channel_posted_envelope(&v),
            "task_0123456789abcdef"
        );
    }

    #[test]
    fn project_channel_posted_envelope_returns_empty_on_missing_field() {
        let v = json!({"type": "channel_posted", "channel": "chan_aaaaaaaa"});
        assert_eq!(project_channel_posted_envelope(&v), "");
    }
}