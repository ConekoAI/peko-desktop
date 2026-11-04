//! Channel Tauri commands (peko-channel cross-runtime desktop UI).
//!
//! PR-1 shipped the read-only surface (list / get / events / members).
//! PR-2a adds `channel_post`. PR-3 adds `channel_create`,
//! `channel_invite`, and `channel_leave` to close the loop on
//! channel creation, member management, and (for cross-runtime
//! channels) the receiver-bootstrap path that the runtime's
//! `TunnelChannelInvite` envelope drives.
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
//! - `channel_events` → `RequestPacket::ChannelPeek { since, tail,
//!   before, query, author }` (reads are membership-gated runtime-side,
//!   ADR-057)
//!   → response: `channel_peek_result` with `events: Vec<ChannelEvent>`
//! - `channel_members` → `RequestPacket::ChannelMembers`
//!   → response: `channel_members_result` with `members: Vec<PrincipalId>`
//! - `channel_post` → `RequestPacket::ChannelPost { sender_name, text, parent }`
//!   → response: `channel_posted` with `task_id: String` (PR-2a)
//! - `channel_create` → `RequestPacket::ChannelCreate { creator_name, name }`
//!   → response: `channel_created` with `channel: ChannelId` (PR-3)
//! - `channel_invite` → `RequestPacket::ChannelInvite { channel, inviter_name, invitee_name }`
//!   → response: `channel_invited` with `channel + invitee` (PR-3)
//! - `channel_leave` → `RequestPacket::ChannelLeave { channel, principal_name }`
//!   → response: `channel_left` with `channel + principal` (PR-3)
//!
//! All commands thread `runtime_id` for cross-runtime routing
//! (`hub:<url>` style ids route through `HubRemoteClient` in PR #5;
//! `None` / `"local"` resolve to the local IPC client). Mirrors the
//! pattern at `principal.rs:35-71` (PR #3 / PR #5).

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

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

/// PR-3: ack envelope for `channel_invite`. Mirrors the runtime's
/// `ResponsePacket::ChannelInvited { channel, invitee }` shape so the
/// React side can refresh the optimistic invitee list without a
/// follow-up `channel_members` round-trip. `runtime_id` is the
/// echoed Tauri-side identifier so multi-runtime routing stays
/// consistent with `ChannelMembers`.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInviteResult {
    pub channel_id: String,
    pub invitee: String,
    pub runtime_id: String,
}

/// PR-3: ack envelope for `channel_leave`. Mirrors the runtime's
/// `ResponsePacket::ChannelLeft { channel, principal }` shape. The
/// React side uses this to drop the principal from its optimistic
/// member list and (if the leaver was the last local member)
/// navigate away from the channel route.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChannelLeaveResult {
    pub channel_id: String,
    pub principal: String,
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
        .channel_peek(&channel_id, None, None, None, None, None)
        .await
        .map_err(|e| format!("channel_get failed: {e}"))?;

    Ok(project_channel_get_envelope(
        &value,
        &channel_id,
        &runtime_id,
    ))
}

/// List events on `channel_id` since `since` (None = from start).
/// Returns an empty Vec if the channel doesn't exist.
///
/// The optional `tail`/`before`/`query`/`author` filters map to the
/// runtime's `ChannelPeek` tail-read and search modes (ADR-057): with
/// `tail` set the daemon returns the newest N events at or before the
/// `before` line cursor; with `query` or `author` set it runs a
/// backward filtered scan instead of the forward `since` walk. All
/// filters are optional and additive — existing callers pass `None`.
///
/// Reads are membership-gated runtime-side; a non-member caller gets
/// a `[forbidden]` error packet which surfaces here as `Err`.
#[allow(clippy::too_many_arguments)] // Tauri command args stay flat to keep the JS call shape additive
#[tauri::command]
pub async fn channel_events(
    state: tauri::State<'_, AppState>,
    channel_id: String,
    since: Option<String>,
    tail: Option<usize>,
    before: Option<String>,
    query: Option<String>,
    author: Option<String>,
    runtime_id: Option<String>,
) -> Result<Vec<ChannelEvent>, String> {
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    let _ = resolved;
    let runtime_id_echo = runtime_id.unwrap_or_else(|| "local".to_string());

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_peek(
            &channel_id,
            since.as_deref(),
            tail,
            before.as_deref(),
            query.as_deref(),
            author.as_deref(),
        )
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

    Ok(project_channel_members_envelope(
        &value,
        &channel_id,
        &runtime_id,
    ))
}

/// One peko hosted on this runtime in a [`ChannelInfo`].
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPekoWake {
    pub name: String,
    pub local_id: String,
    /// `human` / `mention` / `off` (ADR-082).
    pub wake: String,
}

/// A channel's kind, name, members (`kind:id` text), and how each
/// member peko hosted here wakes in it.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInfo {
    pub channel_id: String,
    /// `dm` or `group`.
    pub kind: String,
    pub name: String,
    pub members: Vec<String>,
    pub pekos: Vec<ChannelPekoWake>,
    /// A group's home and PekoHub registration (runtime ADR-092 D1/D5).
    pub group: Option<ChannelGroupSummary>,
}

/// Where a group is managed, and its PekoHub ID once registered.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelGroupSummary {
    /// This computer is the group's home: register it and make invite
    /// links here.
    pub home_here: bool,
    pub owner: String,
    pub hub_id: Option<String>,
    pub page: Option<String>,
    /// `invite_only` or `public`.
    pub visibility: Option<String>,
}

/// Read a channel's kind, members, and pekos' wake policies
/// (`channel_info`). The caller must be a member.
#[tauri::command]
pub async fn channel_info(channel_id: String) -> Result<ChannelInfo, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_info(&channel_id)
        .await
        .map_err(|e| format!("channel_info failed: {e}"))?;
    project_channel_info_envelope(&value)
}

/// Set how `principal_name` wakes in a group (`channel_set_wake`):
/// `human`, `mention`, or `off`. Returns the policy now stored.
#[tauri::command]
pub async fn channel_set_wake(
    channel_id: String,
    principal_name: String,
    wake: String,
) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_set_wake(&channel_id, &principal_name, &wake)
        .await
        .map_err(|e| format!("channel_set_wake failed: {e}"))?;
    if crate::ipc::is_error_response(&value) {
        return Err(runtime_error_message(&value));
    }
    Ok(value
        .get("wake")
        .and_then(|v| v.as_str())
        .unwrap_or(&wake)
        .to_string())
}

fn runtime_error_message(value: &serde_json::Value) -> String {
    value
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown runtime error")
        .to_string()
}

/// Project a `channel_info_result` envelope; a runtime `error` becomes `Err`.
fn project_channel_info_envelope(value: &serde_json::Value) -> Result<ChannelInfo, String> {
    if crate::ipc::is_error_response(value) {
        return Err(runtime_error_message(value));
    }
    let text = |key: &str| {
        value
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    };
    let list = |key: &str| {
        value
            .get(key)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    };
    Ok(ChannelInfo {
        channel_id: text("channel"),
        kind: text("kind"),
        name: text("name"),
        members: list("members").iter().filter_map(actor_text).collect(),
        pekos: list("pekos")
            .iter()
            .map(|p| {
                let field = |k: &str| {
                    p.get(k)
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string()
                };
                ChannelPekoWake {
                    name: field("name"),
                    local_id: field("local_id"),
                    wake: field("wake"),
                }
            })
            .collect(),
        group: value.get("group").filter(|g| g.is_object()).map(|g| {
            let opt = |k: &str| g.get(k).and_then(|v| v.as_str()).map(str::to_string);
            ChannelGroupSummary {
                home_here: g
                    .get("home_here")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
                owner: opt("owner").unwrap_or_default(),
                hub_id: opt("hub_id"),
                page: opt("page"),
                visibility: opt("visibility"),
            }
        }),
    })
}

/// PR-2a: post a message to `channel_id`. `sender_name` is `None` to
/// speak as the caller's own server-derived identity (ADR-057 — the
/// common "post as myself" case) or `Some(name)` for a principal the
/// caller operates. A `user:<id>` sender is impersonation and refused
/// by the runtime with `[forbidden]`; we reject it client-side first
/// for a clearer error. The runtime mints a fresh `task_id` for the
/// message, appends a `Posted` event to the channel log, and (for
/// cross-runtime channels) fans out via the `TunnelChannelEvent`
/// envelope. Returns the `task_id` so the frontend can correlate an
/// inbound peko-stream event back to its outbound post when PR-2b
/// lights up the live stream.
#[tauri::command]
pub async fn channel_post(
    state: tauri::State<'_, AppState>,
    channel_id: String,
    sender_name: Option<String>,
    text: String,
    parent: Option<String>,
    runtime_id: Option<String>,
    attachments: Option<Vec<String>>,
) -> Result<String, String> {
    let attachments = attachments.unwrap_or_default();
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    let _ = resolved;
    let _ = runtime_id.unwrap_or_else(|| "local".to_string());

    if let Some(raw) = sender_name.as_deref() {
        if raw.starts_with("user:") {
            return Err(format!(
                "channel_post: sender_name must be omitted (speak as yourself) or a peko \
                 name hosted by this runtime — never a user identity (got {raw:?})"
            ));
        }
    }

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_post(
            &channel_id,
            sender_name.as_deref(),
            &text,
            parent.as_deref(),
            &attachments,
        )
        .await
        .map_err(|e| format!("channel_post failed: {e}"))?;

    Ok(project_channel_posted_envelope(&value))
}

/// PR-3: create a new channel owned by `creator_name`. The runtime
/// validates the creator principal is loaded, mints a fresh
/// `ChannelId`, persists the channel directory + initial `Created`
/// event, and (for any peer runtime that already has the creator
/// in its member set) seeds the channel mirror through the
/// `TunnelChannelInvite` envelope. Returns the freshly minted
/// `channel_id` so the frontend can navigate to `/channels/$channelId`
/// without a follow-up list refresh.
#[tauri::command]
pub async fn channel_create(
    state: tauri::State<'_, AppState>,
    creator_name: String,
    name: String,
    runtime_id: Option<String>,
) -> Result<String, String> {
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    let _ = resolved;
    let _ = runtime_id.unwrap_or_else(|| "local".to_string());

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_create(&creator_name, &name)
        .await
        .map_err(|e| format!("channel_create failed: {e}"))?;

    Ok(project_channel_created_envelope(&value))
}

/// PR-3: invite `invitee_name` to `channel_id` (issued by
/// `inviter_name`). The runtime adds the invitee to the channel's
/// membership log (local + remote members), and for any peer runtime
/// that hosts the invitee it emits a signed `TunnelChannelInvite`
/// envelope to bootstrap the receiver's local mirror. Returns the
/// joined channel + invitee principal ids so the React side can
/// update its optimistic state without a follow-up `channel_members`
/// round-trip.
#[tauri::command]
pub async fn channel_invite(
    state: tauri::State<'_, AppState>,
    channel_id: String,
    inviter_name: String,
    invitee_name: String,
    runtime_id: Option<String>,
) -> Result<ChannelInviteResult, String> {
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    let _ = resolved;
    let runtime_id_echo = runtime_id.unwrap_or_else(|| "local".to_string());

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_invite(&channel_id, &inviter_name, &invitee_name)
        .await
        .map_err(|e| format!("channel_invite failed: {e}"))?;

    Ok(project_channel_invited_envelope(
        &value,
        &channel_id,
        &runtime_id_echo,
    ))
}

/// PR-3: remove `principal_name` from `channel_id`. The runtime
/// appends a `MemberLeft` event to the log and (for cross-runtime
/// channels) fans out a `TunnelChannelEvent` envelope so the
/// remote members see the leave in their mirrors. Returns the
/// channel + principal ids so the React side can update its
/// optimistic state.
///
/// The local channel directory is NOT auto-removed when the last
/// local member leaves — the local mirror persists until the
/// creator explicitly deletes it (out of scope for PR-3).
#[tauri::command]
pub async fn channel_leave(
    state: tauri::State<'_, AppState>,
    channel_id: String,
    // `None`: you leave the group yourself.
    principal_name: Option<String>,
    runtime_id: Option<String>,
) -> Result<ChannelLeaveResult, String> {
    let resolved = state.resolve_runtime(runtime_id.as_deref()).await;
    let _ = resolved;
    let runtime_id_echo = runtime_id.unwrap_or_else(|| "local".to_string());

    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_leave(&channel_id, principal_name.as_deref())
        .await
        .map_err(|e| format!("channel_leave failed: {e}"))?;

    Ok(project_channel_left_envelope(
        &value,
        &channel_id,
        &runtime_id_echo,
    ))
}

/// PR-2b: subscribe to live events for `channel_id`. The runtime
/// replays events from `since` (None = from start) then forwards
/// live events until the connection closes. Each event is emitted
/// on Tauri's `peko-stream` event channel as a
/// `StreamEvent::ChannelEvent { channel_id, payload, timestamp }`
/// — the React `useChannelStreamInvalidator` hook subscribes to
/// those and invalidates the `["channel-events", channelId]` query
/// when the payload's `channel` field matches.
///
/// The command returns `Ok(())` only when the runtime closes the
/// stream cleanly (`done` packet). Any socket error or runtime
/// error surfaces as a `String` error so the JS caller can show a
/// reconnect toast.
#[tauri::command]
pub async fn channel_events_watch(
    app: AppHandle,
    channel_id: String,
    since: Option<String>,
    _runtime_id: Option<String>,
) -> Result<(), String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    client
        .channel_events_watch(&app, &channel_id, since.as_deref())
        .await
        .map_err(|e| format!("channel_events_watch failed: {e}"))?;
    Ok(())
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
/// An actor from the wire in the desktop's `kind:id` text form. Members
/// and invitees are `ActorRef`s (`{"kind": "user", "id": "local"}`,
/// ADR-081); older runtimes sent the text form directly.
fn actor_text(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    let kind = value.get("kind")?.as_str()?;
    Some(match value.get("id").and_then(|v| v.as_str()) {
        Some(id) => format!("{kind}:{id}"),
        None => kind.to_string(),
    })
}

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
        .filter_map(actor_text)
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

/// PR-3: extract the freshly minted `channel` id from a
/// `ChannelCreated` envelope. Falls back to the request-supplied
/// `channel_id` argument (which is empty for create) and finally to
/// an empty string — surfaced as a UI error so the user can retry
/// rather than silently failing.
fn project_channel_created_envelope(value: &serde_json::Value) -> String {
    value
        .get("channel")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string()
}

/// PR-3: extract `channel` + `invitee` from a `ChannelInvited`
/// envelope. Falls back to the request-supplied `channel_id` arg
/// when the runtime's wire shape is missing — this keeps the
/// frontend's optimistic state in sync with what the user just
/// clicked even on a malformed response. `invitee` falls back to
/// empty string on a malformed envelope.
fn project_channel_invited_envelope(
    value: &serde_json::Value,
    channel_id: &str,
    runtime_id: &str,
) -> ChannelInviteResult {
    let channel = value
        .get("channel")
        .and_then(|c| c.as_str())
        .unwrap_or(channel_id)
        .to_string();
    let invitee = value
        .get("invitee")
        .and_then(actor_text)
        .unwrap_or_default();
    ChannelInviteResult {
        channel_id: channel,
        invitee,
        runtime_id: runtime_id.to_string(),
    }
}

/// PR-3: extract `channel` + `principal` from a `ChannelLeft`
/// envelope. Same fallback contract as
/// `project_channel_invited_envelope` — keep the user's optimistic
/// state in sync with the request arg when the runtime's response
/// is malformed.
fn project_channel_left_envelope(
    value: &serde_json::Value,
    channel_id: &str,
    runtime_id: &str,
) -> ChannelLeaveResult {
    let channel = value
        .get("channel")
        .and_then(|c| c.as_str())
        .unwrap_or(channel_id)
        .to_string();
    // `channel_left` names the peko; `channel_member_left` (you left)
    // names no peko.
    let principal = value
        .get("principal")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    ChannelLeaveResult {
        channel_id: channel,
        principal,
        runtime_id: runtime_id.to_string(),
    }
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
                {"kind": "created", "channel": "chan_aaaaaaaa", "creator": "principal:did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2mKLpbHYkdWfyyEbAm", "name": "team", "at": "2026-08-06T12:00:00Z"},
                {"kind": "posted", "channel": "chan_aaaaaaaa", "author": "principal:did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2mKLpbHYkdWfyyEbAm", "parent": null, "text": "hi", "at": "2026-08-06T12:01:00Z"},
                {"kind": "member_joined", "channel": "chan_aaaaaaaa", "member": "principal:did:key:z6MkrJVnaZkeF9e2r6f3KRxnZK1fDbVcjdMsCbtQYaCVYefn", "at": "2026-08-06T12:00:30Z"},
            ],
        });
        let detail = project_channel_get_envelope(&v, "chan_aaaaaaaa", "local").unwrap();
        assert_eq!(detail.name, "team");
        assert_eq!(
            detail.creator,
            "principal:did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2mKLpbHYkdWfyyEbAm"
        );
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
    fn project_channel_info_envelope_reads_the_runtime_shape() {
        let v = json!({
            "type": "channel_info_result",
            "request_id": 1,
            "channel": "chan_01qwjy2l",
            "kind": "group",
            "name": "team",
            "members": [{"kind": "principal", "id": "prin_alice"}, {"kind": "user", "id": "local"}],
            "pekos": [{"name": "alice", "local_id": "prin_alice", "wake": "mention"}],
            "group": {"home_here": true, "owner": "principal:local:prin_alice", "hub_id": "123",
                "page": "https://pekohub.ai/g/123", "visibility": "invite_only"},
        });
        let info = project_channel_info_envelope(&v).unwrap();
        assert_eq!(info.kind, "group");
        let group = info.group.clone().unwrap();
        assert!(group.home_here);
        assert_eq!(group.hub_id.as_deref(), Some("123"));
        assert_eq!(info.members, vec!["principal:prin_alice", "user:local"]);
        assert_eq!(
            info.pekos,
            vec![ChannelPekoWake {
                name: "alice".into(),
                local_id: "prin_alice".into(),
                wake: "mention".into(),
            }]
        );
        let err = project_channel_info_envelope(&json!({
            "type": "error",
            "message": "requester 'user:local' is not a member of the channel",
        }))
        .unwrap_err();
        assert!(err.contains("not a member"));
    }

    #[test]
    fn project_channel_members_envelope_reads_actor_refs() {
        // The live runtime shape (ADR-081): members are ActorRefs.
        let v = json!({
            "type": "channel_members_result",
            "channel": "chan_000peo0o",
            "members": [
                {"kind": "principal", "id": "prin_6d03818fddf24187a72119c6d395a3d3"},
                {"kind": "user", "id": "local"}
            ],
        });
        let m = project_channel_members_envelope(&v, "chan_000peo0o", "local");
        assert_eq!(
            m.members,
            vec![
                "principal:prin_6d03818fddf24187a72119c6d395a3d3",
                "user:local"
            ]
        );
    }

    #[test]
    fn project_channel_invited_envelope_reads_an_actor_ref() {
        let v = json!({
            "type": "channel_invited",
            "channel": "chan_000peo0o",
            "invitee": {"kind": "user", "id": "local"},
        });
        let r = project_channel_invited_envelope(&v, "chan_000peo0o", "local");
        assert_eq!(r.invitee, "user:local");
    }

    #[test]
    fn project_channel_members_envelope_extracts_dids() {
        let v = json!({
            "type": "channel_members_result",
            "channel": "chan_aaaaaaaa",
            "members": ["principal:did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2mKLpbHYkdWfyyEbAm", "principal:did:key:z6MkrJVnaZkeF9e2r6f3KRxnZK1fDbVcjdMsCbtQYaCVYefn"],
        });
        let m = project_channel_members_envelope(&v, "chan_aaaaaaaa", "local");
        assert_eq!(m.channel_id, "chan_aaaaaaaa");
        assert_eq!(
            m.members,
            vec![
                "principal:did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2mKLpbHYkdWfyyEbAm",
                "principal:did:key:z6MkrJVnaZkeF9e2r6f3KRxnZK1fDbVcjdMsCbtQYaCVYefn"
            ]
        );
    }

    #[test]
    fn parse_channel_event_handles_missing_channel_field() {
        // A posted event with no `channel` field falls back to the
        // `fallback_channel` argument (defensive — runtime always
        // populates it, but the projector should not panic on
        // malformed envelopes).
        let v = json!({
            "kind": "posted",
            "author": "principal:did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2mKLpbHYkdWfyyEbAm",
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
        assert_eq!(project_channel_posted_envelope(&v), "task_0123456789abcdef");
    }

    #[test]
    fn project_channel_posted_envelope_returns_empty_on_missing_field() {
        let v = json!({"type": "channel_posted", "channel": "chan_aaaaaaaa"});
        assert_eq!(project_channel_posted_envelope(&v), "");
    }

    /// PR-3: `channel_create` returns the runtime-minted `channel`
    /// id. We surface it directly to the frontend so the modal can
    /// navigate to `/channels/<id>` without a list refresh.
    #[test]
    fn project_channel_created_envelope_extracts_channel() {
        let v = json!({
            "type": "channel_created",
            "channel": "chan_abcdefgh",
        });
        assert_eq!(project_channel_created_envelope(&v), "chan_abcdefgh");
    }

    /// PR-3: a malformed `channel_created` envelope (no `channel`
    /// field) yields an empty string. The frontend surfaces this as
    /// a UI error rather than navigating to `/channels/`.
    #[test]
    fn project_channel_created_envelope_returns_empty_on_missing_field() {
        let v = json!({"type": "channel_created"});
        assert_eq!(project_channel_created_envelope(&v), "");
    }

    /// PR-3: `channel_invite` echoes both `channel` (falling back to
    /// the request-supplied id) and `invitee` so the React side can
    /// refresh the optimistic invitee list without a follow-up
    /// `channel_members` round-trip.
    #[test]
    fn project_channel_invited_envelope_extracts_fields() {
        let v = json!({
            "type": "channel_invited",
            "channel": "chan_aaaaaaaa",
            "invitee": "principal:did:key:z6MkrJVnaZkeF9e2r6f3KRxnZK1fDbVcjdMsCbtQYaCVYefn",
        });
        let r = project_channel_invited_envelope(&v, "chan_aaaaaaaa", "local");
        assert_eq!(r.channel_id, "chan_aaaaaaaa");
        assert_eq!(
            r.invitee,
            "principal:did:key:z6MkrJVnaZkeF9e2r6f3KRxnZK1fDbVcjdMsCbtQYaCVYefn"
        );
        assert_eq!(r.runtime_id, "local");
    }

    /// PR-3: when the runtime omits `channel` (malformed envelope),
    /// we fall back to the request-supplied id so the frontend's
    /// optimistic state stays in sync with the user's click. An
    /// empty `invitee` becomes the empty string — surfaced as a UI
    /// error rather than silently succeeding.
    #[test]
    fn project_channel_invited_envelope_falls_back_on_missing_channel() {
        let v = json!({"type": "channel_invited", "invitee": "principal:did:key:z6MkrJVnaZkeF9e2r6f3KRxnZK1fDbVcjdMsCbtQYaCVYefn"});
        let r = project_channel_invited_envelope(&v, "chan_fallback", "local");
        assert_eq!(r.channel_id, "chan_fallback");
        assert_eq!(
            r.invitee,
            "principal:did:key:z6MkrJVnaZkeF9e2r6f3KRxnZK1fDbVcjdMsCbtQYaCVYefn"
        );
    }

    /// PR-3: `channel_leave` echoes both `channel` (falling back to
    /// the request-supplied id) and `principal` so the React side
    /// can drop the right member from its optimistic state without
    /// a follow-up `channel_members` round-trip.
    #[test]
    fn project_channel_left_envelope_extracts_fields() {
        let v = json!({
            "type": "channel_left",
            "channel": "chan_aaaaaaaa",
            "principal": "principal:did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2mKLpbHYkdWfyyEbAm",
        });
        let r = project_channel_left_envelope(&v, "chan_aaaaaaaa", "local");
        assert_eq!(r.channel_id, "chan_aaaaaaaa");
        assert_eq!(
            r.principal,
            "principal:did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2mKLpbHYkdWfyyEbAm"
        );
        assert_eq!(r.runtime_id, "local");
    }

    /// PR-3: malformed `channel_left` envelope falls back to the
    /// request-supplied `channel_id` and an empty `principal`.
    #[test]
    fn project_channel_left_envelope_falls_back_on_missing_principal() {
        let v = json!({"type": "channel_left", "channel": "chan_aaaaaaaa"});
        let r = project_channel_left_envelope(&v, "chan_aaaaaaaa", "local");
        assert_eq!(r.channel_id, "chan_aaaaaaaa");
        assert_eq!(r.principal, "");
    }
}

/// A group on another computer inviting you (runtime ADR-092 D2).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupInvitationSummary {
    pub channel_id: String,
    pub name: String,
    pub inviter: String,
    pub members: usize,
}

/// A group you joined from another computer (runtime ADR-092 D2).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonGroupSummary {
    pub channel_id: String,
    pub name: String,
    pub home: Option<String>,
}

/// One of your DMs with another person (runtime ADR-095 D6).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonDmSummary {
    pub channel_id: String,
    /// The other person, `user:hub:<account>`.
    pub peer: String,
    /// Their PekoHub account ID.
    pub account: String,
    pub name: Option<String>,
    /// They haven't accepted yet: nothing you wrote has reached them.
    pub waiting: bool,
}

/// A person asking to DM you (runtime ADR-095 D6). It names only who
/// asks: what they wrote arrives once you accept.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DmRequestSummary {
    pub channel_id: String,
    /// Who asks, `user:hub:<account>`.
    pub from: String,
    /// Their PekoHub account ID.
    pub account: String,
    pub name: Option<String>,
    pub received_at: String,
}

/// The account in `user:hub:<account>`, or the address unchanged.
fn hub_account(address: &str) -> String {
    address
        .strip_prefix("user:hub:")
        .unwrap_or(address)
        .to_string()
}

fn str_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

fn person_dms_from(value: &serde_json::Value) -> Result<Vec<PersonDmSummary>, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    Ok(value
        .get("dms")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .map(|d| {
            let peer = str_field(d, "peer").unwrap_or_default();
            PersonDmSummary {
                channel_id: str_field(d, "channel").unwrap_or_default(),
                account: hub_account(&peer),
                peer,
                name: str_field(d, "name"),
                waiting: d.get("waiting").and_then(|v| v.as_bool()).unwrap_or(false),
            }
        })
        .collect())
}

fn dm_requests_from(value: &serde_json::Value) -> Result<Vec<DmRequestSummary>, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    Ok(value
        .get("requests")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .map(|r| {
            let from = str_field(r, "from").unwrap_or_default();
            DmRequestSummary {
                channel_id: str_field(r, "channel").unwrap_or_default(),
                account: hub_account(&from),
                from,
                name: str_field(r, "name"),
                received_at: str_field(r, "received_at").unwrap_or_default(),
            }
        })
        .collect())
}

fn blocked_from(value: &serde_json::Value) -> Result<Vec<String>, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    Ok(value
        .get("people")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|p| p.as_str().map(hub_account))
        .collect())
}

/// Whether a refusal only says this computer isn't signed in to PekoHub,
/// so lists read as empty.
fn not_signed_in(message: &str) -> bool {
    message.contains("Register this runtime") || message.contains("no PekoHub connection")
}

fn refusal_of(value: &serde_json::Value) -> Option<String> {
    (value.get("type").and_then(|t| t.as_str()) == Some("error")).then(|| {
        value
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("refused")
            .to_string()
    })
}

fn invitations_from(value: &serde_json::Value) -> Result<Vec<GroupInvitationSummary>, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    Ok(value
        .get("invitations")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .map(|i| GroupInvitationSummary {
            channel_id: i
                .get("channel")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            name: i
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            inviter: i
                .get("inviter")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            members: i
                .get("initial_members")
                .and_then(|v| v.as_array())
                .map_or(0, Vec::len),
        })
        .collect())
}

fn person_groups_from(value: &serde_json::Value) -> Result<Vec<PersonGroupSummary>, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    Ok(value
        .get("groups")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .map(|g| PersonGroupSummary {
            channel_id: g
                .get("channel")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            name: g
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            home: g.get("home").and_then(|v| v.as_str()).map(str::to_string),
        })
        .collect())
}

/// Groups on other computers inviting you (runtime ADR-092 D2). Empty when
/// this computer isn't signed in to PekoHub.
#[tauri::command]
pub async fn group_invitations() -> Result<Vec<GroupInvitationSummary>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_invitations()
        .await
        .map_err(|e| format!("channel_invitations failed: {e}"))?;
    match invitations_from(&value) {
        Err(message)
            if message.contains("Register this runtime")
                || message.contains("no PekoHub connection") =>
        {
            Ok(Vec::new())
        }
        other => other,
    }
}

/// Accept or decline a group's invitation (runtime ADR-092 D2).
#[tauri::command]
pub async fn group_invitation_answer(channel_id: String, accept: bool) -> Result<(), String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_invitation_answer(&channel_id, accept)
        .await
        .map_err(|e| format!("channel_invitation_answer failed: {e}"))?;
    refusal_of(&value).map_or(Ok(()), Err)
}

/// Your DMs with other people (runtime ADR-095 D6). Empty when this
/// computer isn't signed in to PekoHub.
#[tauri::command]
pub async fn person_dms() -> Result<Vec<PersonDmSummary>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_person_dms()
        .await
        .map_err(|e| format!("channel_person_dms failed: {e}"))?;
    match person_dms_from(&value) {
        Err(message) if not_signed_in(&message) => Ok(Vec::new()),
        other => other,
    }
}

/// Open, or find, a DM with another person by their PekoHub account ID
/// (runtime ADR-095 D6). Returns its channel id.
#[tauri::command]
pub async fn person_dm_open(account: String, name: Option<String>) -> Result<String, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_open_person_dm(account.trim(), name.as_deref().filter(|n| !n.is_empty()))
        .await
        .map_err(|e| format!("channel_open_person_dm failed: {e}"))?;
    if let Some(message) = refusal_of(&value) {
        return Err(message);
    }
    str_field(&value, "channel").ok_or_else(|| "The runtime didn't say which DM it opened.".into())
}

/// People asking to DM you (runtime ADR-095 D6). Empty when this computer
/// isn't signed in to PekoHub.
#[tauri::command]
pub async fn dm_requests() -> Result<Vec<DmRequestSummary>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_dm_requests()
        .await
        .map_err(|e| format!("channel_dm_requests failed: {e}"))?;
    match dm_requests_from(&value) {
        Err(message) if not_signed_in(&message) => Ok(Vec::new()),
        other => other,
    }
}

/// Accept, decline, or block a person's message request (runtime ADR-095
/// D6). Accepting returns the DM's channel id.
#[tauri::command]
pub async fn dm_request_answer(
    channel_id: String,
    answer: String,
) -> Result<Option<String>, String> {
    if !matches!(answer.as_str(), "accept" | "decline" | "block") {
        return Err(format!("Answer accept, decline, or block, not {answer:?}"));
    }
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_dm_request_answer(&channel_id, &answer)
        .await
        .map_err(|e| format!("channel_dm_request_answer failed: {e}"))?;
    if let Some(message) = refusal_of(&value) {
        return Err(message);
    }
    Ok(str_field(&value, "channel"))
}

/// The people you blocked, as account IDs (runtime ADR-095 D6).
#[tauri::command]
pub async fn blocked_people() -> Result<Vec<String>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_blocked()
        .await
        .map_err(|e| format!("channel_blocked failed: {e}"))?;
    match blocked_from(&value) {
        Err(message) if not_signed_in(&message) => Ok(Vec::new()),
        other => other,
    }
}

/// Block or unblock a person by account ID; returns everyone blocked now.
#[tauri::command]
pub async fn set_person_blocked(account: String, blocked: bool) -> Result<Vec<String>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_block_person(hub_account(account.trim()).as_str(), blocked)
        .await
        .map_err(|e| format!("channel_block_person failed: {e}"))?;
    blocked_from(&value)
}

/// Groups you joined from other computers (runtime ADR-092 D2). Empty when
/// this computer isn't signed in to PekoHub.
#[tauri::command]
pub async fn person_groups() -> Result<Vec<PersonGroupSummary>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_person_groups()
        .await
        .map_err(|e| format!("channel_person_groups failed: {e}"))?;
    match person_groups_from(&value) {
        Err(message)
            if message.contains("Register this runtime")
                || message.contains("no PekoHub connection") =>
        {
            Ok(Vec::new())
        }
        other => other,
    }
}

/// One older page of a group you joined from another computer, read from
/// the group's home and not stored here (runtime ADR-092 D3).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupHistoryPage {
    pub events: Vec<serde_json::Value>,
    pub has_more: bool,
}

#[tauri::command]
pub async fn group_history_older(
    channel_id: String,
    before: String,
) -> Result<GroupHistoryPage, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_history_older(&channel_id, &before)
        .await
        .map_err(|e| format!("channel_history_older failed: {e}"))?;
    if let Some(message) = refusal_of(&value) {
        return Err(message);
    }
    Ok(GroupHistoryPage {
        events: value
            .get("events")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default(),
        has_more: value
            .get("has_more")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

/// What joining by link or ID asked for (runtime ADR-092 D5).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupJoinRequested {
    pub channel_id: String,
    pub name: String,
}

/// A group's PekoHub registration (runtime ADR-092 D5).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupRegistration {
    pub id: String,
    pub page: String,
    pub visibility: String,
}

/// A new invite link, or how many `revoke` stopped (runtime ADR-092 D5).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupLink {
    pub link: Option<String>,
    pub expires: Option<String>,
    pub revoked: Option<u64>,
}

fn str_of(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

fn group_joined_from(value: &serde_json::Value) -> Result<GroupJoinRequested, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    Ok(GroupJoinRequested {
        channel_id: str_of(value, "channel"),
        name: str_of(value, "name"),
    })
}

fn group_registered_from(value: &serde_json::Value) -> Result<GroupRegistration, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    Ok(GroupRegistration {
        id: str_of(value, "id"),
        page: str_of(value, "page"),
        visibility: str_of(value, "visibility"),
    })
}

fn group_link_from(value: &serde_json::Value) -> Result<GroupLink, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    Ok(GroupLink {
        link: value
            .get("link")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        expires: value
            .get("expires")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        revoked: value.get("revoked").and_then(serde_json::Value::as_u64),
    })
}

/// Join a group by its invite link, or a public one by its ID (runtime
/// ADR-092 D5). The group appears once its home lets you in.
#[tauri::command]
pub async fn group_join(link: String) -> Result<GroupJoinRequested, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_group_join(&link)
        .await
        .map_err(|e| format!("channel_group_join failed: {e}"))?;
    group_joined_from(&value)
}

/// Give a group an ID on PekoHub, or change who may find it (runtime
/// ADR-092 D5). `visibility` is `invite_only` or `public`.
#[tauri::command]
pub async fn group_register(
    channel_id: String,
    visibility: String,
) -> Result<GroupRegistration, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_group_register(&channel_id, &visibility)
        .await
        .map_err(|e| format!("channel_group_register failed: {e}"))?;
    group_registered_from(&value)
}

/// Make an invite link to a registered group, or stop them all (runtime
/// ADR-092 D5).
#[tauri::command]
pub async fn group_link(
    channel_id: String,
    days: Option<u32>,
    revoke: bool,
) -> Result<GroupLink, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_group_link(&channel_id, days, revoke)
        .await
        .map_err(|e| format!("channel_group_link failed: {e}"))?;
    group_link_from(&value)
}

#[cfg(test)]
mod group_hub_tests {
    use super::*;

    #[test]
    fn join_register_and_link_read_from_the_runtime() {
        let joined = serde_json::json!({"type": "channel_group_joined", "channel": "chan_a", "name": "book club"});
        assert_eq!(
            group_joined_from(&joined).unwrap(),
            GroupJoinRequested {
                channel_id: "chan_a".into(),
                name: "book club".into()
            }
        );
        let registered = serde_json::json!({"type": "channel_group_registered", "channel": "chan_a",
            "id": "123", "page": "https://pekohub.ai/g/123", "visibility": "public"});
        assert_eq!(group_registered_from(&registered).unwrap().id, "123");
        let link = serde_json::json!({"type": "channel_group_link_result", "channel": "chan_a",
            "link": "https://pekohub.ai/g/123?invite=t", "expires": "2026-11-10T00:00:00+00:00"});
        assert_eq!(
            group_link_from(&link).unwrap().link.as_deref(),
            Some("https://pekohub.ai/g/123?invite=t")
        );
        let revoked = serde_json::json!({"type": "channel_group_link_result", "channel": "chan_a", "revoked": 2});
        assert_eq!(group_link_from(&revoked).unwrap().revoked, Some(2));
        let refused = serde_json::json!({"type": "error", "message": "No group 1 is open to you"});
        assert_eq!(
            group_joined_from(&refused).unwrap_err(),
            "No group 1 is open to you"
        );
    }
}

#[cfg(test)]
mod group_people_tests {
    use super::*;

    #[test]
    fn invitations_and_groups_read_from_the_runtime() {
        let invitations = serde_json::json!({
            "type": "channel_invitations_result",
            "invitations": [{"channel": "chan_a", "name": "book club", "inviter": "principal:hub:x",
                "home_runtime": "did:key:zH", "account": "acct", "initial_members": [{}, {}],
                "received_at": "2026-11-02T10:00:00Z"}],
        });
        assert_eq!(
            invitations_from(&invitations).unwrap(),
            [GroupInvitationSummary {
                channel_id: "chan_a".into(),
                name: "book club".into(),
                inviter: "principal:hub:x".into(),
                members: 2,
            }]
        );
        let groups = serde_json::json!({"type": "channel_person_groups_result",
            "groups": [{"channel": "chan_a", "name": "book club", "home": "did:key:zH"}]});
        assert_eq!(
            person_groups_from(&groups).unwrap()[0].home.as_deref(),
            Some("did:key:zH")
        );
        let refused = serde_json::json!({"type": "error", "message": "nope"});
        assert_eq!(invitations_from(&refused).unwrap_err(), "nope");
    }

    /// Runtime ADR-095 D6: the person-DM answers, in the runtime's wire
    /// shapes (snake_case fields).
    #[test]
    fn person_dms_requests_and_blocks_read_from_the_runtime() {
        let dms = serde_json::json!({
            "type": "channel_person_dms_result", "request_id": 1,
            "dms": [{"channel": "dm_ab", "peer": "user:hub:bob-id", "name": "bob", "waiting": true},
                    {"channel": "dm_cd", "peer": "user:hub:eve-id", "waiting": false}],
        });
        assert_eq!(
            person_dms_from(&dms).unwrap(),
            [
                PersonDmSummary {
                    channel_id: "dm_ab".into(),
                    peer: "user:hub:bob-id".into(),
                    account: "bob-id".into(),
                    name: Some("bob".into()),
                    waiting: true,
                },
                PersonDmSummary {
                    channel_id: "dm_cd".into(),
                    peer: "user:hub:eve-id".into(),
                    account: "eve-id".into(),
                    name: None,
                    waiting: false,
                },
            ]
        );
        let requests = serde_json::json!({
            "type": "channel_dm_requests_result", "request_id": 1,
            "requests": [{"channel": "dm_ab", "from": "user:hub:alice-id", "name": "alice",
                "source_runtime": "did:key:zA", "account": "bob-id",
                "received_at": "2026-11-04T10:00:00Z"}],
        });
        assert_eq!(
            dm_requests_from(&requests).unwrap(),
            [DmRequestSummary {
                channel_id: "dm_ab".into(),
                from: "user:hub:alice-id".into(),
                account: "alice-id".into(),
                name: Some("alice".into()),
                received_at: "2026-11-04T10:00:00Z".into(),
            }]
        );
        let blocked = serde_json::json!({"type": "channel_blocked_people", "request_id": 1,
            "people": ["user:hub:eve-id"]});
        assert_eq!(blocked_from(&blocked).unwrap(), ["eve-id"]);
        let unregistered = serde_json::json!({"type": "error",
            "message": "Register this runtime with PekoHub first (peko runtime register)"});
        assert!(not_signed_in(&dm_requests_from(&unregistered).unwrap_err()));
    }
}
