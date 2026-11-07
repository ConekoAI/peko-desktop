//! A peko on another computer, reached through this computer's runtime.
//!
//! The conversation is a DM on the local runtime between you
//! (`user:local`, `user:hub:<account>` on the wire) and the peko
//! (`principal:hub:<UUID>`), carried over the PekoHub tunnel (runtime
//! ADR-090). The desktop opens it once with `channel_open_remote_dm`, then
//! posts, reads, and watches it with the ordinary channel verbs, so a
//! remote peko's thread works like a local one's: the record lives on
//! this machine, and a reply that arrives later shows up on its own.
//!
//! The peko is named by the share link it was added from
//! (`<hub>/@<owner>/<name>`, or an older `/peko/…` link); its Hub ID comes from the hub's public
//! profile the first time the DM is opened.

use std::sync::Arc;

use tokio::sync::Mutex;

/// One remote peko, pinned to the hub its share link named. Cheap to
/// clone; the opened DM is shared between clones.
#[derive(Debug, Clone)]
pub struct HubRemoteClient {
    pub hub_url: String,
    pub owner: String,
    pub principal_name: String,
    pub runtime_id: String,
    /// The share link's invite token, if any. Kept so the profile lookup
    /// can read an unlisted peko.
    pub invite_token: Option<String>,
    pub http: reqwest::Client,
    /// Its PekoHub ID when known up front (one of your own pekos, listed
    /// by your account); otherwise read from its public page.
    known_hub_id: Option<String>,
    /// The DM on the local runtime, once opened.
    channel: Arc<Mutex<Option<String>>>,
}

impl HubRemoteClient {
    pub fn new(
        hub_url: String,
        owner: String,
        principal_name: String,
        invite_token: Option<String>,
        http: reqwest::Client,
    ) -> Self {
        let runtime_id = format!("hub:{}", hub_url.trim_end_matches('/'));
        Self {
            hub_url,
            owner,
            principal_name,
            runtime_id,
            invite_token,
            http,
            known_hub_id: None,
            channel: Arc::new(Mutex::new(None)),
        }
    }

    /// Open the DM by this Hub ID instead of looking the peko up on its
    /// public page, which a private peko doesn't have.
    pub fn with_hub_id(mut self, hub_id: Option<String>) -> Self {
        self.known_hub_id = hub_id.filter(|id| !id.is_empty());
        self
    }

    /// The hub's API base: a record may carry the website the share link
    /// named (`pekohub.ai`), and calls go to its API (`api.pekohub.ai`).
    fn api_base(&self) -> String {
        crate::clients::hub_origin::hub_api_base(&self.hub_url)
    }

    /// The peko's Hub ID: the one it was saved with, else from the hub's
    /// public profile.
    async fn hub_id(&self) -> Result<String, String> {
        if let Some(id) = &self.known_hub_id {
            return Ok(id.clone());
        }
        let profile = crate::clients::pekohub::PekohubClient::new()
            .with_base_url(self.api_base())
            .get_public_principal(
                &self.owner,
                &self.principal_name,
                self.invite_token.as_deref(),
            )
            .await?;
        profile
            .get("liveInstance")
            .and_then(|live| live.get("hubId"))
            .and_then(|v| v.as_str())
            .filter(|id| !id.is_empty())
            .map(str::to_string)
            .ok_or_else(|| {
                format!(
                    "{} isn't registered with PekoHub, so it can't be reached from here.",
                    self.principal_name
                )
            })
    }

    /// The DM with this peko on the local runtime, opened on first use.
    pub async fn open_dm(&self) -> Result<String, String> {
        let mut cached = self.channel.lock().await;
        if let Some(channel) = cached.as_ref() {
            return Ok(channel.clone());
        }
        let hub_id = self.hub_id().await?;
        let token = crate::clients::hub_auth::access_token(&self.http, &self.api_base()).await;
        let client = crate::ipc::IpcClient::new()
            .await
            .map_err(|e| format!("IpcClient::new failed: {e}"))?;
        let answer = client
            .channel_open_remote_dm(&hub_id, token.as_deref())
            .await
            .map_err(|e| format!("channel_open_remote_dm failed: {e}"))?;
        let channel = opened_channel(&answer)?;
        *cached = Some(channel.clone());
        Ok(channel)
    }

    /// Post `text` to the DM, with `attachments` (absolute paths on this
    /// computer; the peko's runtime pulls them through PekoHub, runtime
    /// ADR-094). The reply arrives later, on the thread. `model` asks the
    /// peko to answer with one of its host's models (runtime ADR-097); its
    /// host honours it only for the peko's owner.
    pub async fn send(
        &self,
        text: &str,
        attachments: &[String],
        model: Option<&str>,
    ) -> Result<(), String> {
        let channel = self.open_dm().await?;
        let client = crate::ipc::IpcClient::new()
            .await
            .map_err(|e| format!("IpcClient::new failed: {e}"))?;
        let answer = client
            .channel_post(&channel, None, text, None, attachments, model)
            .await
            .map_err(|e| format!("channel_post failed: {e}"))?;
        if crate::ipc::is_error_response(&answer) {
            return Err(error_message(&answer, "The message wasn't sent."));
        }
        Ok(())
    }

    /// The models this peko's host can answer you with (runtime ADR-097
    /// D1), as the model picker lists them: `{ id, displayName }`. Empty
    /// when the host offers you none (a peko that isn't yours).
    pub async fn models(&self) -> Result<Vec<PekoModel>, String> {
        let channel = self.open_dm().await?;
        let client = crate::ipc::IpcClient::new()
            .await
            .map_err(|e| format!("IpcClient::new failed: {e}"))?;
        let answer = client
            .channel_peko_models(&channel)
            .await
            .map_err(|e| format!("channel_peko_models failed: {e}"))?;
        peko_models(&answer)
    }

    /// The approval requests waiting for you on this peko's host (runtime
    /// ADR-099 D1), in `approval_list`'s shape (snake_case, passed
    /// through). Empty when the host shows you none (a peko that isn't
    /// yours).
    pub async fn approvals(&self) -> Result<serde_json::Value, String> {
        let channel = self.open_dm().await?;
        let client = crate::ipc::IpcClient::new()
            .await
            .map_err(|e| format!("IpcClient::new failed: {e}"))?;
        let answer = client
            .channel_peko_approvals(&channel)
            .await
            .map_err(|e| format!("channel_peko_approvals failed: {e}"))?;
        peko_approvals(&answer)
    }

    /// Approve (`always`: and remember it) or deny a waiting request on
    /// this peko's host (runtime ADR-099 D2). Resolves to what the host
    /// did ("Approved apr_… Running it …"), or its reason it didn't.
    pub async fn decide_approval(
        &self,
        id: &str,
        approve: bool,
        always: bool,
    ) -> Result<String, String> {
        let channel = self.open_dm().await?;
        let client = crate::ipc::IpcClient::new()
            .await
            .map_err(|e| format!("IpcClient::new failed: {e}"))?;
        let answer = client
            .channel_peko_approval_decide(&channel, id, approve, always)
            .await
            .map_err(|e| format!("channel_peko_approval_decide failed: {e}"))?;
        approval_decided(&answer)
    }

    /// The thread as `principal_log` returns it for a local peko: the
    /// newest `limit` rows, or the rows before `cursor` when paging back.
    /// Past the start of this computer's copy, paging goes on in the
    /// peko's host (runtime ADR-091): those cursors are `msg:<id>`.
    pub async fn log_page(
        &self,
        limit: Option<usize>,
        cursor: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let channel = self.open_dm().await?;
        let client = crate::ipc::IpcClient::new()
            .await
            .map_err(|e| format!("IpcClient::new failed: {e}"))?;
        if let Some(before) = cursor.as_deref().and_then(|c| c.strip_prefix(HOST_CURSOR)) {
            let answer = client
                .channel_history_older(&channel, before)
                .await
                .map_err(|e| format!("channel_history_older failed: {e}"))?;
            if crate::ipc::is_error_response(&answer) {
                return Err(error_message(
                    &answer,
                    "Older messages couldn't be read from the computer hosting this peko.",
                ));
            }
            return Ok(host_page(&self.peer(), &answer));
        }
        let answer = client
            .channel_peek(
                &channel,
                None,
                Some(limit.unwrap_or(100)),
                cursor.as_deref(),
                None,
                None,
            )
            .await
            .map_err(|e| format!("channel_peek failed: {e}"))?;
        if crate::ipc::is_error_response(&answer) {
            return Err(error_message(&answer, "The conversation couldn't be read."));
        }
        Ok(log_page(&self.peer(), &answer))
    }

    /// Follow the DM from row `since`, handing each new message to
    /// `on_row` in the `principal_log` row shape. Returns when the
    /// daemon ends the watch.
    pub async fn watch<F>(&self, since: Option<&str>, on_row: F) -> Result<(), String>
    where
        F: Fn(serde_json::Value) + Send + Sync + 'static,
    {
        let channel = self.open_dm().await?;
        let client = crate::ipc::IpcClient::new()
            .await
            .map_err(|e| format!("IpcClient::new failed: {e}"))?;
        client
            .channel_events_watch_each(&channel, since, move |_, event| {
                // Live events carry no store line; the message id stands in.
                let id = event
                    .get("msg_id")
                    .and_then(|v| v.as_str())
                    .map(|id| format!("msg_{id}"))
                    .unwrap_or_else(|| "live".to_string());
                if let Some(row) = posted_row(id, &event) {
                    on_row(row);
                }
            })
            .await
            .map_err(|e| e.to_string())
    }

    /// How the thread names this peko until the DM is open.
    fn peer(&self) -> String {
        format!("principal:hub:{}/{}", self.owner, self.principal_name)
    }
}

/// The channel from a `channel_remote_dm_opened` answer, or the reason
/// the runtime gave.
fn opened_channel(answer: &serde_json::Value) -> Result<String, String> {
    match answer.get("type").and_then(|t| t.as_str()) {
        Some("channel_remote_dm_opened") => answer
            .get("channel")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| "the runtime opened the conversation but named no channel".to_string()),
        Some("error") => {
            let message = error_message(answer, "The conversation couldn't be opened.");
            // A runtime not linked to a PekoHub account can't reach other
            // computers: say what to do about it.
            if message.contains("Register this runtime with PekoHub")
                || message.contains("no PekoHub connection")
            {
                Err("Sign in to PekoHub (the account menu, top right) so this computer can reach pekos on other computers.".to_string())
            } else {
                Err(message)
            }
        }
        _ => Err(
            "This runtime is too old to reach pekos on other computers. Update Peko.".to_string(),
        ),
    }
}

/// A model of a peko's host, as the picker shows it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PekoModel {
    pub id: String,
    pub display_name: String,
}

/// The models in a `channel_peko_models_result` answer.
fn peko_models(answer: &serde_json::Value) -> Result<Vec<PekoModel>, String> {
    match answer.get("type").and_then(|t| t.as_str()) {
        Some("channel_peko_models_result") => serde_json::from_value(
            answer
                .get("models")
                .cloned()
                .unwrap_or(serde_json::Value::Array(Vec::new())),
        )
        .map_err(|e| format!("the runtime's model list didn't parse: {e}")),
        _ => Err(error_message(
            answer,
            "The computer hosting this peko didn't list its models.",
        )),
    }
}

/// The requests in a `channel_peko_approvals_result` answer.
fn peko_approvals(answer: &serde_json::Value) -> Result<serde_json::Value, String> {
    match answer.get("type").and_then(|t| t.as_str()) {
        Some("channel_peko_approvals_result") => Ok(answer
            .get("approvals")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([]))),
        _ => Err(error_message(
            answer,
            "The computer hosting this peko didn't list its approval requests.",
        )),
    }
}

/// What an `approval_decided` answer says happened.
fn approval_decided(answer: &serde_json::Value) -> Result<String, String> {
    match answer.get("type").and_then(|t| t.as_str()) {
        Some("approval_decided") => Ok(answer
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or_default()
            .to_string()),
        _ => Err(error_message(
            answer,
            "The computer hosting this peko didn't take the decision.",
        )),
    }
}

fn error_message(answer: &serde_json::Value, fallback: &str) -> String {
    answer
        .get("message")
        .and_then(|m| m.as_str())
        .filter(|m| !m.trim().is_empty())
        .unwrap_or(fallback)
        .to_string()
}

/// A `posted` channel event as a `principal_log` row
/// (`{ schemaVersion, id, sender, timestamp, text, attachments, options }`); other
/// events (created, member changes) are not messages.
fn posted_row(id: String, event: &serde_json::Value) -> Option<serde_json::Value> {
    if event.get("kind").and_then(|k| k.as_str()) != Some("posted") {
        return None;
    }
    Some(serde_json::json!({
        "schemaVersion": 1,
        "id": id,
        "sender": event.get("author").and_then(|v| v.as_str()).unwrap_or("unknown"),
        "timestamp": event.get("at").and_then(|v| v.as_str()).unwrap_or_default(),
        "text": event.get("text").and_then(|v| v.as_str()).unwrap_or_default(),
        "attachments": event.get("attachments").cloned().unwrap_or_else(|| serde_json::json!([])),
        // Suggested replies (runtime ADR-093).
        "options": event.get("options").cloned().unwrap_or_else(|| serde_json::json!([])),
    }))
}

/// Cursors into the host's history rather than this computer's copy.
const HOST_CURSOR: &str = "msg:";

/// A `channel_history_page` from the peko's host as a log page. Rows are
/// `msg_<id>`; the cursor for older rows is the first row's message id.
fn host_page(peer: &str, answer: &serde_json::Value) -> serde_json::Value {
    let empty = Vec::new();
    let events = answer
        .get("events")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    let messages: Vec<serde_json::Value> = events
        .iter()
        .filter_map(|event| {
            let id = event.get("msg_id").and_then(|v| v.as_str())?;
            posted_row(format!("msg_{id}"), event)
        })
        .collect();
    let has_more = answer
        .get("has_more")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let oldest = events
        .iter()
        .find_map(|e| e.get("msg_id").and_then(|v| v.as_str()));
    serde_json::json!({
        "principal": peer,
        "peer": "user:local",
        "messages": messages,
        "next_cursor": if has_more { oldest.map(|id| format!("{HOST_CURSOR}{id}")) } else { None },
        "has_more": has_more && oldest.is_some(),
    })
}

/// A `channel_peek_result` (tail read) as the page `principal_log`
/// returns: `{ principal, peer, messages, next_cursor, has_more }`. Rows
/// are `chan_<line>`, so the log watch's cursor works on them; the
/// cursor for older rows is the first row's line. At the start of this
/// computer's copy, the cursor moves on to the host's history before the
/// oldest message held here.
fn log_page(peer: &str, answer: &serde_json::Value) -> serde_json::Value {
    let empty = Vec::new();
    let events = answer
        .get("events")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    let ids = answer
        .get("event_ids")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    let first_line = ids.first().and_then(|v| v.as_str()).map(str::to_string);
    let messages: Vec<serde_json::Value> = events
        .iter()
        .enumerate()
        .filter_map(|(i, event)| {
            let id = ids
                .get(i)
                .and_then(|v| v.as_str())
                .map_or_else(|| format!("row_{i}"), |l| format!("chan_{l}"));
            posted_row(id, event)
        })
        .collect();
    let has_more = answer
        .get("has_more")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    // At the start of this computer's copy, page on in the peko's copy
    // only while this one may lack older posts (runtime ADR-095 D1: a
    // copy fills back to the first post and says when it has). A
    // runtime that predates saying so may lack them.
    let older_elsewhere = answer
        .get("older_elsewhere")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let next_cursor = if has_more {
        first_line
    } else if older_elsewhere {
        events
            .iter()
            .find_map(|e| e.get("msg_id").and_then(|v| v.as_str()))
            .map(|id| format!("{HOST_CURSOR}{id}"))
    } else {
        None
    };
    serde_json::json!({
        "principal": peer,
        "peer": "user:local",
        "has_more": next_cursor.is_some(),
        "messages": messages,
        "next_cursor": next_cursor,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn posted(author: &str, text: &str) -> serde_json::Value {
        serde_json::json!({
            "kind": "posted",
            "channel": "dm_abc",
            "author": author,
            "parent": null,
            "text": text,
            "at": "2026-11-01T10:00:00Z",
            "msg_id": "m1",
        })
    }

    #[test]
    fn the_hosts_models_are_read_from_its_answer() {
        let answer = serde_json::json!({
            "type": "channel_peko_models_result",
            "request_id": 1,
            "models": [{"id": "work-model", "displayName": "Work model"}],
        });
        assert_eq!(
            peko_models(&answer).unwrap(),
            [PekoModel {
                id: "work-model".into(),
                display_name: "Work model".into(),
            }]
        );
        let offline = serde_json::json!({
            "type": "error",
            "message": "The computer hosting this peko did not answer; it may be offline",
        });
        assert!(peko_models(&offline)
            .unwrap_err()
            .contains("may be offline"));
    }

    #[test]
    fn the_hosts_approvals_and_decisions_are_read_from_its_answers() {
        let listed = serde_json::json!({
            "type": "channel_peko_approvals_result",
            "request_id": 1,
            "approvals": [{"id": "apr_0123456789ab", "actor": "user:hub:noah", "trust": "untrusted",
                "summary": "`Read`", "reason": "private", "created_at": "t0", "expires_at": "t1"}],
        });
        assert_eq!(
            peko_approvals(&listed).unwrap()[0]["id"],
            "apr_0123456789ab"
        );
        let decided = serde_json::json!({
            "type": "approval_decided",
            "request_id": 1,
            "id": "apr_0123456789ab",
            "approved": false,
            "message": "Denied apr_0123456789ab.",
        });
        assert_eq!(approval_decided(&decided).unwrap(), "Denied apr_0123456789ab.");
        let refused = serde_json::json!({
            "type": "error",
            "message": "Request apr_0123456789ab was already decided.",
        });
        assert!(approval_decided(&refused)
            .unwrap_err()
            .contains("already decided"));
        assert!(peko_approvals(&refused).is_err());
    }

    #[test]
    fn a_peek_becomes_a_log_page() {
        let answer = serde_json::json!({
            "type": "channel_peek_result",
            "channel": "dm_abc",
            "events": [
                {"kind": "created", "channel": "dm_abc", "creator": "user:hub:acct", "name": "dm", "at": "2026-11-01T09:59:00Z"},
                posted("user:local", "hi ada"),
                posted("principal:hub:156f1a95-d977-4c4a-979e-8ed4848ae6eb", "hello!"),
            ],
            "event_ids": ["1", "2", "3"],
            "has_more": true,
        });
        let page = log_page("principal:hub:alice/ada", &answer);
        let messages = page["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2, "only posts are messages");
        assert_eq!(messages[0]["id"], "chan_2");
        assert_eq!(messages[0]["sender"], "user:local");
        assert_eq!(messages[1]["text"], "hello!");
        assert_eq!(messages[1]["timestamp"], "2026-11-01T10:00:00Z");
        assert_eq!(page["has_more"], true);
        assert_eq!(
            page["next_cursor"], "1",
            "older rows page back from the first line"
        );
    }

    fn posted_id(author: &str, text: &str, id: &str) -> serde_json::Value {
        let mut event = posted(author, text);
        event["msg_id"] = serde_json::json!(id);
        event
    }

    /// Runtime ADR-091: at the start of this computer's copy, paging moves
    /// on to the peko's host, before the oldest message held here.
    #[test]
    fn the_start_of_the_local_copy_pages_on_into_the_host() {
        let answer = serde_json::json!({
            "events": [posted_id("user:local", "hi", "m7"), posted_id("principal:hub:x", "hello", "m8")],
            "event_ids": ["4", "5"],
            "has_more": false,
        });
        let page = log_page("p", &answer);
        assert_eq!(page["has_more"], true);
        assert_eq!(page["next_cursor"], "msg:m7");
    }

    /// Runtime ADR-095 D1: a copy that reached the first post has nothing
    /// older elsewhere, so the thread offers no "Load earlier messages"
    /// at its start — as for a peko on this computer.
    #[test]
    fn a_complete_copy_ends_where_the_conversation_begins() {
        let answer = serde_json::json!({
            "events": [posted_id("user:local", "hi", "m7"), posted_id("principal:hub:x", "hello", "m8")],
            "event_ids": ["4", "5"],
            "has_more": false,
            "older_elsewhere": false,
        });
        let page = log_page("p", &answer);
        assert_eq!(page["has_more"], false);
        assert!(page["next_cursor"].is_null());

        let filling = serde_json::json!({
            "events": [posted_id("user:local", "hi", "m7")],
            "event_ids": ["4"],
            "has_more": false,
            "older_elsewhere": true,
        });
        assert_eq!(log_page("p", &filling)["next_cursor"], "msg:m7");
    }

    #[test]
    fn a_host_page_becomes_a_log_page() {
        let answer = serde_json::json!({
            "type": "channel_history_page",
            "channel": "dm_abc",
            "events": [posted_id("user:local:local", "first", "m1"), posted_id("principal:hub:x", "second", "m2")],
            "has_more": true,
        });
        let page = host_page("p", &answer);
        let messages = page["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["id"], "msg_m1");
        assert_eq!(messages[1]["text"], "second");
        assert_eq!(page["next_cursor"], "msg:m1");
        assert_eq!(page["has_more"], true);

        let last = host_page(
            "p",
            &serde_json::json!({"events": [posted_id("a", "x", "m0")], "has_more": false}),
        );
        assert!(last["next_cursor"].is_null());
        assert_eq!(last["has_more"], false);
    }

    #[test]
    fn an_empty_thread_has_no_cursor() {
        let page = log_page("p", &serde_json::json!({"events": [], "event_ids": []}));
        assert!(page["messages"].as_array().unwrap().is_empty());
        assert!(page["next_cursor"].is_null());
        assert_eq!(page["has_more"], false);
    }

    #[test]
    fn opening_answers_map_to_a_channel_or_a_reason() {
        let ok = serde_json::json!({
            "type": "channel_remote_dm_opened",
            "channel": "dm_abc",
            "peer": "principal:hub:x",
            "hub_id": "x",
            "created": true,
        });
        assert_eq!(opened_channel(&ok).unwrap(), "dm_abc");

        let unregistered = serde_json::json!({
            "type": "error",
            "message": "Register this runtime with PekoHub first (peko runtime register)",
        });
        assert!(opened_channel(&unregistered)
            .unwrap_err()
            .contains("Sign in to PekoHub"));
        let disconnected = serde_json::json!({"type": "error", "message": "This runtime has no PekoHub connection"});
        assert!(opened_channel(&disconnected)
            .unwrap_err()
            .contains("Sign in to PekoHub"));

        let other = serde_json::json!({"type": "error", "message": "ada is local-only"});
        assert_eq!(opened_channel(&other).unwrap_err(), "ada is local-only");

        let old = serde_json::json!({"type": "error_unknown_packet"});
        assert!(opened_channel(&old).unwrap_err().contains("too old"));
    }

    #[test]
    fn non_posts_are_not_rows() {
        let joined = serde_json::json!({"kind": "member_joined", "member": "x", "at": "t"});
        assert!(posted_row("live".into(), &joined).is_none());
        let row = posted_row("msg_m1".into(), &posted("user:local", "hey")).unwrap();
        assert_eq!(row["attachments"], serde_json::json!([]));
        assert_eq!(row["options"], serde_json::json!([]));
    }

    #[test]
    fn posted_rows_keep_suggested_replies() {
        let mut event = posted("principal:hub:p", "Ship today?");
        event["options"] = serde_json::json!(["Ship it", "Hold off"]);
        let row = posted_row("msg_m2".into(), &event).unwrap();
        assert_eq!(row["options"], serde_json::json!(["Ship it", "Hold off"]));
    }
}
