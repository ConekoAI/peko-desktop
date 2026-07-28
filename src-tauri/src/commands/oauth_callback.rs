// Tauri command: `start_oauth_callback_listener`.
//
// Spawns a localhost HTTP server on the configured port and waits
// for PekoHub to redirect the user's browser back to
// `http://localhost:<port><path>?code=…&state=…`. The server
// captures the `code` and `state` query parameters, replies with a
// tiny "you can close this tab" HTML page, and resolves the future
// with the captured values.
//
// We don't pull in `tiny_http`/`axum` for this — the request is
// 100% GET with a known path and a tiny response. Parsing
// HTTP/1.1 by hand keeps the dependency footprint at zero.
//
// The function holds the listener alive until either:
//   (a) a single callback request arrives (success), or
//   (b) the spawned `tokio::time::sleep` deadline expires
//       (timeout, the user walked away from the browser).
//
// On timeout the listener is dropped (port freed) and the future
// rejects. The SPA surfaces this as "Sign-in timed out — try again".

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use urlencoding::decode;

const CALLBACK_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_REQUEST_BYTES: usize = 8 * 1024;

#[derive(Debug, serde::Serialize)]
pub struct OAuthCallbackPayload {
    pub code: String,
    pub state: String,
}

/// Start listening for the OAuth redirect on `127.0.0.1:port`.
///
/// Returns the captured `code`/`state` once PekoHub's browser
/// redirect lands, or rejects after `CALLBACK_TIMEOUT`.
#[tauri::command]
pub async fn start_oauth_callback_listener(
    port: u16,
    path: Option<String>,
) -> Result<OAuthCallbackPayload, String> {
    let path = path.unwrap_or_else(|| "/callback".to_string());
    let bind_addr = format!("127.0.0.1:{port}");

    let listener = TcpListener::bind(&bind_addr)
        .await
        .map_err(|e| format!("failed to bind {bind_addr}: {e}"))?;

    let (tx, rx) = oneshot::channel::<Result<OAuthCallbackPayload, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    // Drive the accept loop on a background task so this future
    // can `select!` between the channel and the timeout.
    let path_for_task = path.clone();
    let tx_for_task = tx.clone();
    tokio::spawn(async move {
        accept_loop(listener, &path_for_task, tx_for_task).await;
    });

    tokio::select! {
        res = rx => res.map_err(|_| "callback channel closed".to_string())?,
        _ = tokio::time::sleep(CALLBACK_TIMEOUT) => {
            Err(format!(
                "OAuth callback timed out after {}s — did the browser redirect land?",
                CALLBACK_TIMEOUT.as_secs()
            ))
        }
    }
}

async fn accept_loop(
    listener: TcpListener,
    path: &str,
    tx: Arc<Mutex<Option<oneshot::Sender<Result<OAuthCallbackPayload, String>>>>>,
) {
    loop {
        let (mut socket, _peer) = match listener.accept().await {
            Ok(s) => s,
            Err(_) => return, // listener dropped → task ends
        };

        let mut buf = vec![0u8; MAX_REQUEST_BYTES];
        let n = match socket.read(&mut buf).await {
            Ok(n) if n > 0 => n,
            _ => continue,
        };
        buf.truncate(n);
        let request = String::from_utf8_lossy(&buf).to_string();

        let (status_line, body) = handle_request(&request, path, &tx);

        let response = format!(
            "{status_line}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    }
}

/// Parse `request` for the first GET on `path`. If it carries
/// `code`+`state` query params, ship them off via the oneshot and
/// return a friendly HTML success body. Otherwise return a 4xx
/// status with an error body.
fn handle_request(
    request: &str,
    path: &str,
    tx: &Mutex<Option<oneshot::Sender<Result<OAuthCallbackPayload, String>>>>,
) -> (String, String) {
    // First line: "GET /path?… HTTP/1.1"
    let first_line = request.lines().next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");

    if method != "GET" {
        return (
            "HTTP/1.1 405 Method Not Allowed".to_string(),
            error_page("Method not allowed"),
        );
    }

    // Split off the query string for path matching.
    let (req_path, query) = match target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (target, ""),
    };
    if req_path != path {
        return (
            "HTTP/1.1 404 Not Found".to_string(),
            error_page("Not found"),
        );
    }

    let params: HashMap<String, String> = parse_query(query);

    let code = match params.get("code") {
        Some(c) if !c.is_empty() => c.clone(),
        _ => {
            return (
                "HTTP/1.1 400 Bad Request".to_string(),
                error_page("Missing `code` query parameter"),
            );
        }
    };
    let state = match params.get("state") {
        Some(s) if !s.is_empty() => s.clone(),
        _ => {
            return (
                "HTTP/1.1 400 Bad Request".to_string(),
                error_page("Missing `state` query parameter"),
            );
        }
    };

    // Send exactly once — take() the oneshot sender.
    if let Some(sender) = tx.lock().unwrap().take() {
        let _ = sender.send(Ok(OAuthCallbackPayload { code, state }));
    }

    ("HTTP/1.1 200 OK".to_string(), success_page())
}

fn success_page() -> String {
    r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Peko sign-in complete</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 24px; color: #0f172a; }
    h1 { font-size: 1.5rem; margin: 0 0 12px; }
    p { line-height: 1.5; color: #475569; }
  </style>
</head>
<body>
  <h1>Sign-in complete</h1>
  <p>You can close this tab and return to Peko.</p>
</body>
</html>"#
        .to_string()
}

fn error_page(msg: &str) -> String {
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Peko sign-in failed</title>
  <style>
    body {{ font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 24px; color: #0f172a; }}
    h1 {{ font-size: 1.5rem; margin: 0 0 12px; color: #b91c1c; }}
    p {{ line-height: 1.5; color: #475569; }}
  </style>
</head>
<body>
  <h1>Sign-in failed</h1>
  <p>{msg}</p>
  <p>Return to Peko and try again.</p>
</body>
</html>"#
    )
}

/// Parse a `key=value&key2=value2` query string into a HashMap.
/// Values are percent-decoded; keys are kept as-is (OAuth only
/// cares about `code` and `state` which are well-known ASCII).
fn parse_query(query: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (k, v) = match pair.split_once('=') {
            Some((k, v)) => (k, v),
            None => (pair, ""),
        };
        let v_decoded = decode(v).map(|c| c.into_owned()).unwrap_or_default();
        out.insert(k.to_string(), v_decoded);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_query_extracts_code_and_state() {
        let p = parse_query("code=abc%20123&state=xyz");
        assert_eq!(p.get("code").map(|s| s.as_str()), Some("abc 123"));
        assert_eq!(p.get("state").map(|s| s.as_str()), Some("xyz"));
    }

    #[test]
    fn parse_query_handles_empty_value() {
        let p = parse_query("code=&state=ok");
        assert_eq!(p.get("code").map(|s| s.as_str()), Some(""));
        assert_eq!(p.get("state").map(|s| s.as_str()), Some("ok"));
    }

    #[test]
    fn parse_query_handles_no_equals() {
        let p = parse_query("code=ok&bare");
        assert_eq!(p.get("code").map(|s| s.as_str()), Some("ok"));
        assert_eq!(p.get("bare").map(|s| s.as_str()), Some(""));
    }

    #[test]
    fn handle_request_sends_payload_via_oneshot() {
        let (tx, rx) = oneshot::channel();
        let tx_slot = Arc::new(Mutex::new(Some(tx)));
        let req = "GET /callback?code=the-code&state=the-state HTTP/1.1\r\nHost: localhost\r\n\r\n";
        let (status, _body) = handle_request(req, "/callback", &tx_slot);
        assert!(status.starts_with("HTTP/1.1 200"));
        let captured = rx.blocking_recv().unwrap().unwrap();
        assert_eq!(captured.code, "the-code");
        assert_eq!(captured.state, "the-state");
    }

    #[test]
    fn handle_request_rejects_wrong_path() {
        let (tx, _rx) = oneshot::channel();
        let tx_slot = Arc::new(Mutex::new(Some(tx)));
        let req = "GET /not-callback HTTP/1.1\r\n\r\n";
        let (status, _) = handle_request(req, "/callback", &tx_slot);
        assert!(status.starts_with("HTTP/1.1 404"));
        // Sender still in the slot (no fire).
        assert!(tx_slot.lock().unwrap().is_some());
    }

    #[test]
    fn handle_request_rejects_missing_code() {
        let (tx, _rx) = oneshot::channel();
        let tx_slot = Arc::new(Mutex::new(Some(tx)));
        let req = "GET /callback?state=ok HTTP/1.1\r\n\r\n";
        let (status, _) = handle_request(req, "/callback", &tx_slot);
        assert!(status.starts_with("HTTP/1.1 400"));
    }

    #[tokio::test]
    async fn start_listener_captures_real_redirect() {
        // Bind to 0 to let the OS pick a free port, then call
        // the same flow the Tauri command does. We can't use
        // the public command (it requires a fixed port and would
        // race the test), so we drive the internals via a
        // port-zero bind helper.
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let path = "/callback".to_string();
        let (tx, rx) = oneshot::channel();
        let tx_slot = Arc::new(Mutex::new(Some(tx)));
        let path_for_task = path.clone();
        let tx_for_task = tx_slot.clone();
        tokio::spawn(async move {
            accept_loop(listener, &path_for_task, tx_for_task).await;
        });

        // Fake a PekoHub redirect using std::net so we don't pull
        // in reqwest as a dev-dep just for this test.
        let url = format!(
            "GET /callback?code=real-code&state=real-state HTTP/1.1\r\nHost: localhost\r\n\r\n"
        );
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect");
        use tokio::io::AsyncWriteExt;
        stream.write_all(url.as_bytes()).await.expect("write");
        // Drop the write half so the server sees EOF.
        drop(stream);

        let payload = rx.await.expect("oneshot").expect("callback");
        assert_eq!(payload.code, "real-code");
        assert_eq!(payload.state, "real-state");
    }
}
