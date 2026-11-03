//! The desktop's connection to the daemon's local IPC endpoint.
//!
//! - **Unix**: a datagram socket bound at a per-client temp path. Each
//!   request is sent to `~/.peko/run/daemon.sock`, and the daemon replies
//!   to the path it came from.
//! - **Windows**: the daemon's named pipe (runtime ADR-038), `PEKO_DAEMON_PIPE`
//!   or `\\.\pipe\peko-{user}`. Each `send` opens a fresh connection for one
//!   request; `recv` reads that request's responses one message at a time.
//!   The pipe's DACL admits only the user the daemon runs as.

use super::{IpcError, Result};

pub(crate) struct Transport {
    #[cfg(unix)]
    socket: tokio::net::UnixDatagram,
    #[cfg(unix)]
    tmp_path: std::path::PathBuf,
    #[cfg(windows)]
    pipe_name: String,
    #[cfg(windows)]
    pipe: tokio::sync::Mutex<Option<tokio::net::windows::named_pipe::NamedPipeClient>>,
}

impl Transport {
    #[cfg(unix)]
    pub(crate) async fn open() -> Result<Self> {
        use std::sync::atomic::Ordering;

        let counter = super::IPC_CLIENT_COUNTER.fetch_add(1, Ordering::Relaxed);
        let tmp = std::env::temp_dir().join(format!(
            "peko_desktop_ipc_{}_{}.sock",
            std::process::id(),
            counter
        ));
        let _ = tokio::fs::remove_file(&tmp).await;
        let socket = tokio::net::UnixDatagram::bind(&tmp)
            .map_err(|e| IpcError::ConnectionFailed(e.to_string()))?;
        super::bump_recv_buffer(&socket);
        Ok(Self {
            socket,
            tmp_path: tmp,
        })
    }

    #[cfg(windows)]
    pub(crate) async fn open() -> Result<Self> {
        Ok(Self::with_pipe_name(pipe_name()))
    }

    #[cfg(windows)]
    fn with_pipe_name(pipe_name: String) -> Self {
        Self {
            pipe_name,
            pipe: tokio::sync::Mutex::new(None),
        }
    }

    /// Send one request. On Windows this replaces the previous request's
    /// connection, so `recv` reads only this request's responses.
    pub(crate) async fn send(&self, bytes: &[u8]) -> Result<()> {
        #[cfg(unix)]
        {
            self.socket
                .send_to(bytes, super::default_socket_path())
                .await
                .map_err(|e| IpcError::SendFailed(e.to_string()))?;
        }
        #[cfg(windows)]
        {
            use tokio::io::AsyncWriteExt;

            let mut pipe = self.pipe.lock().await;
            *pipe = None;
            let mut client = connect_pipe(&self.pipe_name)
                .await
                .map_err(|e| IpcError::SendFailed(format!("{}: {e}", self.pipe_name)))?;
            client
                .write_all(bytes)
                .await
                .map_err(|e| IpcError::SendFailed(e.to_string()))?;
            *pipe = Some(client);
        }
        Ok(())
    }

    /// Receive the next response packet into `buf`, returning its length.
    pub(crate) async fn recv(&self, buf: &mut [u8]) -> std::io::Result<usize> {
        #[cfg(unix)]
        {
            self.socket.recv_from(buf).await.map(|(len, _)| len)
        }
        #[cfg(windows)]
        {
            use tokio::io::AsyncReadExt;

            let mut pipe = self.pipe.lock().await;
            let client = pipe.as_mut().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::NotConnected, "no request sent")
            })?;
            match client.read(buf).await? {
                0 => Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "the daemon closed the connection",
                )),
                len => Ok(len),
            }
        }
    }
}

#[cfg(unix)]
impl Drop for Transport {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.tmp_path);
    }
}

/// The daemon's named pipe: `PEKO_DAEMON_PIPE`, else `\\.\pipe\peko-{user}`.
/// Mirrors the runtime's `ipc::default_pipe_name` character for character.
#[cfg(windows)]
pub(crate) fn pipe_name() -> String {
    if let Ok(name) = std::env::var("PEKO_DAEMON_PIPE") {
        return name;
    }
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "default".to_string());
    default_pipe_name_for(&user)
}

#[cfg(windows)]
fn default_pipe_name_for(user: &str) -> String {
    let safe: String = user
        .chars()
        .map(|c| {
            if matches!(c, '\\' | '?' | '*' | '<' | '>' | '|' | '"') {
                '_'
            } else {
                c
            }
        })
        .take(64)
        .collect();
    format!(r"\\.\pipe\peko-{safe}")
}

/// Open a client end of the daemon's pipe in message mode, so each read
/// returns one whole response packet. All instances can be briefly busy
/// while the daemon creates the next one; retry that for up to a second.
#[cfg(windows)]
async fn connect_pipe(
    name: &str,
) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    use std::time::{Duration, Instant};
    use tokio::net::windows::named_pipe::{ClientOptions, PipeMode};

    const ERROR_PIPE_BUSY: i32 = 231;
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        match ClientOptions::new().pipe_mode(PipeMode::Message).open(name) {
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            result => return result,
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::windows::named_pipe::{PipeMode, ServerOptions};

    #[test]
    fn default_pipe_name_matches_the_runtime() {
        assert_eq!(default_pipe_name_for("Megan"), r"\\.\pipe\peko-Megan");
        assert_eq!(
            default_pipe_name_for(r#"a\b?c"d"#),
            r"\\.\pipe\peko-a_b_c_d"
        );
        assert_eq!(
            default_pipe_name_for(&"x".repeat(100)),
            format!(r"\\.\pipe\peko-{}", "x".repeat(64))
        );
    }

    /// A request goes out on its own connection, and every response the
    /// daemon writes on it comes back as one whole packet per `recv`. A
    /// second request opens a new connection.
    #[tokio::test]
    async fn sends_each_request_on_its_own_connection_and_reads_every_response() {
        let name = format!(r"\\.\pipe\peko-desktop-test-{}", std::process::id());
        let mut opts = ServerOptions::new();
        opts.pipe_mode(PipeMode::Message);
        let mut first = opts.first_pipe_instance(true).create(&name).unwrap();
        let mut second = ServerOptions::new()
            .pipe_mode(PipeMode::Message)
            .create(&name)
            .unwrap();

        let daemon = tokio::spawn(async move {
            let mut buf = [0u8; 64];
            first.connect().await.unwrap();
            let n = first.read(&mut buf).await.unwrap();
            assert_eq!(&buf[..n], b"watch");
            first.write_all(b"one").await.unwrap();
            first.write_all(b"two").await.unwrap();

            second.connect().await.unwrap();
            let n = second.read(&mut buf).await.unwrap();
            assert_eq!(&buf[..n], b"ping");
            second.write_all(b"pong").await.unwrap();
            drop(second);
        });

        let transport = Transport::with_pipe_name(name);
        let mut buf = [0u8; 64];
        transport.send(b"watch").await.unwrap();
        let n = transport.recv(&mut buf).await.unwrap();
        assert_eq!(&buf[..n], b"one");
        let n = transport.recv(&mut buf).await.unwrap();
        assert_eq!(&buf[..n], b"two");

        transport.send(b"ping").await.unwrap();
        let n = transport.recv(&mut buf).await.unwrap();
        assert_eq!(&buf[..n], b"pong");
        daemon.await.unwrap();
        // The daemon closed the connection: an error, not an empty packet.
        assert!(transport.recv(&mut buf).await.is_err());
    }

    #[tokio::test]
    async fn no_daemon_is_a_send_error() {
        let transport =
            Transport::with_pipe_name(r"\\.\pipe\peko-desktop-test-nobody-home".to_string());
        assert!(matches!(
            transport.send(b"ping").await,
            Err(IpcError::SendFailed(_))
        ));
    }
}
