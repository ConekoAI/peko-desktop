//! Client for chatting with a remote principal over pekohub's HTTPS +
//! SSE bridge. PR #5 fills in the PR #3 plumbing stub at
//! `state::ResolvedRuntime::HubRemote` so a user can add a remote
//! principal in the sidebar and have the desktop route `principal_send`,
//! `principal_send_stream`, and `principal_log` straight to the hub
//! without dropping them to the browser.
//!
//! Wire shape (matches `pekohub/backend/src/services/tunnel-router.ts`):
//!   POST `${base}/v1/public/principals/${owner}/${name}/chat`
//!   body: `{ "message": "...", "tos_acknowledged": true }`
//!   optional `?token=...` query when the share link carries an invite token
//!   response: SSE stream
//!     `data: {"chunk":"...", "done":false}\n\n` — text delta
//!     `event: iteration\ndata: {"iteration":N}\n\n` — agentic boundary
//!     `event: error\ndata: {"message":"..."}\n\n` — fatal
//!
//! The response body on a non-200 (rate limit, ToS, 404) is JSON, NOT
//! SSE — the streaming consumer checks status before entering the
//! event loop so error envelopes surface cleanly to the UI.

use futures::stream::StreamExt;
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};

use crate::ipc::ChatStreamMsg;
use crate::storage::local_chat_log;

/// Wire struct for the JSON body POSTed to
/// `/v1/public/principals/{owner}/{name}/chat`.
#[derive(Debug, Clone, Serialize)]
struct ChatRequestBody<'a> {
    message: &'a str,
    /// ToS acknowledgement is not enforced by pekohub for public
    /// principals that don't set `tosRequired`; sending `true`
    /// unconditionally keeps the contract uniform. (The hub returns
    /// 428 with the ToS text if it does require acknowledgement and
    /// we don't send this.)
    #[serde(rename = "tos_acknowledged")]
    tos_acknowledged: bool,
}

/// Chunk envelope on the SSE `data:` lines.
#[derive(Debug, Clone, Deserialize)]
struct ChunkEnvelope {
    chunk: String,
    #[allow(dead_code)]
    done: bool,
}

/// Iteration envelope on `event: iteration` lines.
#[derive(Debug, Clone, Deserialize)]
struct IterationEnvelope {
    iteration: u32,
}

/// Error envelope on `event: error` lines.
#[derive(Debug, Clone, Deserialize)]
struct ErrorEnvelope {
    message: String,
}

/// One remote principal pinned to its hub URL. Cheap to clone (two
/// `String`s + one `Option<String>`); instances live behind an `Arc`
/// in `AppState` so each Tauri command can grab a clone without
/// serializing through the runtime-id registry.
#[derive(Debug, Clone)]
pub struct HubRemoteClient {
    pub hub_url: String,
    pub owner: String,
    pub principal_name: String,
    pub runtime_id: String,
    /// Optional invite token from the share URL. Forwarded as
    /// `?token=...` on every chat request so the runtime's tunnel
    /// layer can match it against the principal's `invite:v1` ACL
    /// table (PR #11).
    pub invite_token: Option<String>,
    pub http: reqwest::Client,
}

impl HubRemoteClient {
    /// Build a client from a remote-principal record (PR #4) and a
    /// pre-constructed HTTP client (shared with the rest of the
    /// desktop's networking layer).
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
        }
    }

    fn chat_url(&self) -> String {
        let base = self.hub_url.trim_end_matches('/');
        let mut url = format!(
            "{}/v1/public/principals/{}/{}/chat",
            base, self.owner, self.principal_name
        );
        if let Some(token) = &self.invite_token {
            url.push_str(&format!("?token={}", urlencoded(token)));
        }
        url
    }

    /// Send a single message and stream the response. Each chunk is
    /// pushed to the supplied `on_event` channel; the resolved
    /// `String` is the concatenated final content (suitable for
    /// rendering as one assistant bubble).
    ///
    /// On success, the assembled assistant content is also persisted
    /// to the local chat log so `principal_log` returns it on
    /// subsequent visits. The user message is persisted by the caller
    /// (the chat UI knows the optimistic timestamp).
    pub async fn send_stream<F>(&self, message: &str, on_event: F) -> Result<String, String>
    where
        F: Fn(ChatStreamMsg) + Send + Sync + 'static,
    {
        let url = self.chat_url();
        let body = ChatRequestBody {
            message,
            tos_acknowledged: true,
        };
        let resp = self
            .http
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("hub remote send failed: {e}"))?;

        let status = resp.status();
        if !status.is_success() {
            // Non-2xx → JSON error body (rate limit, ToS gate, 404).
            // Read the whole body so the caller gets a useful message.
            let text = resp
                .text()
                .await
                .map_err(|e| format!("failed to read error body: {e}"))?;
            return Err(format!("hub returned {status}: {text}"));
        }

        let mut content = String::new();
        let mut stream = resp.bytes_stream();
        let mut sse_buf = SseBuffer::new();

        while let Some(chunk_result) = stream.next().await {
            let bytes = chunk_result.map_err(|e| format!("hub stream read failed: {e}"))?;
            for frame in sse_buf.push(&bytes) {
                match frame {
                    SseFrame::Chunk { delta } => {
                        content.push_str(&delta);
                        on_event(ChatStreamMsg::Chunk { delta });
                    }
                    SseFrame::Iteration { iteration } => {
                        on_event(ChatStreamMsg::Iteration { iteration });
                    }
                    SseFrame::Error { message } => {
                        return Err(format!("hub stream error: {message}"));
                    }
                }
            }
        }

        // Persist the assembled assistant content so a subsequent
        // `principal_log` returns the same history.
        if !content.is_empty() {
            let entry = local_chat_log::assistant_entry(content.clone());
            if let Err(e) =
                local_chat_log::append_entry(&self.runtime_id, &self.principal_name, &entry)
            {
                tracing::warn!(error = %e, "failed to persist remote chat-log entry");
            }
        }

        Ok(content)
    }

    /// Fetch the persisted chat history for this principal. The hub
    /// has no read endpoint for chat history yet; the desktop keeps
    /// its own JSONL appender (`local_chat_log`) so this just reads
    /// back what's been written.
    pub async fn list_chat_log(
        &self,
        _limit: Option<usize>,
        _since_secs: Option<u64>,
        _cursor: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let entries = local_chat_log::read_entries(&self.runtime_id, &self.principal_name)?;
        Ok(serde_json::json!({
            "kind": "remote_chat_log",
            "runtime_id": self.runtime_id,
            "principal_name": self.principal_name,
            "entries": entries,
        }))
    }
}

/// URL-encode a single query-string value. Avoids dragging in a new
/// crate just for this — `urlencoding` is already a workspace dep.
fn urlencoded(s: &str) -> String {
    urlencoding::encode(s).into_owned()
}

/// A buffer that ingests raw SSE bytes and emits logical frames.
///
/// SSE over HTTP/1.1 is a stream of `event: foo\ndata: bar\n\n`
/// records separated by blank lines; a single chunk can land
/// anywhere on those boundaries, so we accumulate until we see a
/// blank line. Comments (`:`) and unknown event names are skipped
/// silently — the desktop only cares about `data:`, `event:
/// iteration`, and `event: error`.
struct SseBuffer {
    buf: Vec<u8>,
}

#[derive(Debug, PartialEq)]
enum SseFrame {
    Chunk { delta: String },
    Iteration { iteration: u32 },
    Error { message: String },
}

impl SseBuffer {
    fn new() -> Self {
        Self { buf: Vec::new() }
    }

    fn push(&mut self, bytes: &[u8]) -> Vec<SseFrame> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        // Split on the SSE record separator (`\n\n`). Each record is
        // processed; partial trailing bytes stay in the buffer.
        loop {
            let Some(idx) = find_double_newline(&self.buf) else {
                break;
            };
            let raw = self.buf.drain(..idx + 2).collect::<Vec<u8>>();
            let s = match std::str::from_utf8(&raw) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if let Some(frame) = parse_sse_record(s) {
                out.push(frame);
            }
        }
        out
    }
}

fn find_double_newline(buf: &[u8]) -> Option<usize> {
    // SSE spec uses `\n\n` as the record separator; CRLF is also
    // permitted. We accept both.
    for i in 0..buf.len().saturating_sub(1) {
        if buf[i] == b'\n' && buf[i + 1] == b'\n' {
            return Some(i);
        }
        if buf[i] == b'\r'
            && buf[i + 1] == b'\n'
            && i + 3 < buf.len()
            && buf[i + 2] == b'\r'
            && buf[i + 3] == b'\n'
        {
            return Some(i);
        }
    }
    None
}

fn parse_sse_record(s: &str) -> Option<SseFrame> {
    let mut event: Option<&str> = None;
    let mut data_lines: Vec<&str> = Vec::new();
    for line in s.lines() {
        if line.starts_with(':') {
            continue; // comment / heartbeat
        }
        if let Some(rest) = line.strip_prefix("event:") {
            event = Some(rest.trim());
        } else if let Some(rest) = line.strip_prefix("data:") {
            // SSE permits leading space after the colon.
            data_lines.push(rest.strip_prefix(' ').unwrap_or(rest));
        }
    }
    let data = data_lines.join("\n");
    if data.is_empty() {
        return None;
    }
    match event.unwrap_or("message") {
        "iteration" => match serde_json::from_str::<IterationEnvelope>(&data) {
            Ok(env) => Some(SseFrame::Iteration {
                iteration: env.iteration,
            }),
            Err(_) => None,
        },
        "error" => match serde_json::from_str::<ErrorEnvelope>(&data) {
            Ok(env) => Some(SseFrame::Error {
                message: env.message,
            }),
            Err(_) => Some(SseFrame::Error {
                message: data.to_string(),
            }),
        },
        // Default `message` event carries the chunk envelope.
        _ => match serde_json::from_str::<ChunkEnvelope>(&data) {
            Ok(env) => Some(SseFrame::Chunk { delta: env.chunk }),
            Err(_) => None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The chunk envelope the hub emits on every text delta must
    /// round-trip into `SseFrame::Chunk` with the delta preserved
    /// verbatim. Pin the wire shape — the desktop's chat UI
    /// concatenates the deltas into the assistant bubble, so a
    /// single dropped character surfaces as broken text.
    #[test]
    fn parse_chunk_envelope() {
        let raw = "data: {\"chunk\":\"hello world\",\"done\":false}\n\n";
        let frame = parse_sse_record(raw).expect("chunk parses");
        assert_eq!(
            frame,
            SseFrame::Chunk {
                delta: "hello world".to_string()
            }
        );
    }

    /// Iteration envelopes land on `event: iteration\ndata: ...`.
    /// The frontend uses these to break bubbles + drive the
    /// "Thinking…" pill.
    #[test]
    fn parse_iteration_envelope() {
        let raw = "event: iteration\ndata: {\"iteration\":3}\n\n";
        let frame = parse_sse_record(raw).expect("iteration parses");
        assert_eq!(frame, SseFrame::Iteration { iteration: 3 });
    }

    /// Error envelopes carry a user-friendly message that the chat
    /// UI surfaces inline. Decode must work whether the message is
    /// a JSON string or just a raw payload — pekohub could in theory
    /// forward either.
    #[test]
    fn parse_error_envelope() {
        let raw = "event: error\ndata: {\"message\":\"rate limited\"}\n\n";
        let frame = parse_sse_record(raw).expect("error parses");
        assert_eq!(
            frame,
            SseFrame::Error {
                message: "rate limited".to_string()
            }
        );
    }

    /// Records may be split across chunks — verify the buffer
    /// accumulates until it sees `\n\n`. The desktop sees hundreds of
    /// small chunks per second over SSE; a naive line-by-line reader
    /// would drop every frame that crosses a chunk boundary.
    #[test]
    fn buffer_accumulates_partial_records() {
        let mut buf = SseBuffer::new();
        let first = b"data: {\"chunk\":\"hel";
        let rest = b"lo\",\"done\":false}\n\n";
        assert!(buf.push(first).is_empty(), "no complete records yet");
        let frames = buf.push(rest);
        assert_eq!(
            frames,
            vec![SseFrame::Chunk {
                delta: "hello".to_string()
            }]
        );
    }

    /// Multiple records in a single chunk must all parse, in order.
    #[test]
    fn buffer_emits_multiple_records() {
        let mut buf = SseBuffer::new();
        let raw =
            b"data: {\"chunk\":\"a\",\"done\":false}\n\ndata: {\"chunk\":\"b\",\"done\":false}\n\n";
        let frames = buf.push(raw);
        assert_eq!(frames.len(), 2);
        assert_eq!(
            frames[0],
            SseFrame::Chunk {
                delta: "a".to_string()
            }
        );
        assert_eq!(
            frames[1],
            SseFrame::Chunk {
                delta: "b".to_string()
            }
        );
    }

    /// Comment lines (`: heartbeat`) must not break parsing and must
    /// not be emitted as frames.
    #[test]
    fn ignores_heartbeat_comments() {
        let mut buf = SseBuffer::new();
        let raw = b": heartbeat\ndata: {\"chunk\":\"ok\",\"done\":false}\n\n";
        let frames = buf.push(raw);
        assert_eq!(frames.len(), 1);
        assert_eq!(
            frames[0],
            SseFrame::Chunk {
                delta: "ok".to_string()
            }
        );
    }

    /// The chat URL must append the invite token as `?token=...`
    /// when one is present (URL-encoded to handle tokens with `+/=`
    /// characters from base64). The runtime's tunnel layer matches
    /// this header against the principal's ACL.
    #[test]
    fn chat_url_appends_token_when_present() {
        let client = HubRemoteClient::new(
            "https://pekohub.org".to_string(),
            "alice".to_string(),
            "coding-assistant".to_string(),
            Some("abc/def=ghi".to_string()),
            reqwest::Client::new(),
        );
        let url = client.chat_url();
        assert!(
            url.contains("token=abc%2Fdef%3Dghi"),
            "token must be url-encoded: {url}"
        );
        assert!(
            url.starts_with("https://pekohub.org/v1/public/principals/alice/coding-assistant/chat")
        );
    }

    /// No token → no query string. Pin the canonical anonymous path.
    #[test]
    fn chat_url_no_token() {
        let client = HubRemoteClient::new(
            "https://pekohub.org".to_string(),
            "alice".to_string(),
            "coding-assistant".to_string(),
            None,
            reqwest::Client::new(),
        );
        let url = client.chat_url();
        assert!(!url.contains("?token"));
        assert!(url.ends_with("/chat"));
    }

    /// runtime_id follows the canonical `hub:<hub_url>` shape so the
    /// PR #3 routing layer can match registered clients by id.
    #[test]
    fn runtime_id_has_canonical_shape() {
        let trailing = HubRemoteClient::new(
            "https://pekohub.org/".to_string(),
            "alice".to_string(),
            "coding-assistant".to_string(),
            None,
            reqwest::Client::new(),
        );
        assert_eq!(trailing.runtime_id, "hub:https://pekohub.org");

        let bare = HubRemoteClient::new(
            "https://pekohub.org".to_string(),
            "alice".to_string(),
            "coding-assistant".to_string(),
            None,
            reqwest::Client::new(),
        );
        assert_eq!(bare.runtime_id, "hub:https://pekohub.org");
    }
}
