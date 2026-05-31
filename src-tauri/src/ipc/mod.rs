use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum IpcError {
    #[error("connection failed: {0}")]
    ConnectionFailed(String),
    #[error("send failed: {0}")]
    SendFailed(String),
    #[error("receive failed: {0}")]
    ReceiveFailed(String),
    #[error("not implemented")]
    NotImplemented,
}

pub type Result<T> = std::result::Result<T, IpcError>;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PongResponse {
    pub ok: bool,
    pub version: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum StreamEvent {
    Text(String),
    ToolCall { name: String },
    ToolResult { output: String },
    Done,
    Error(String),
}

pub struct IpcClient;

impl IpcClient {
    pub fn new() -> Self {
        Self
    }
}

pub fn connect() -> Result<IpcClient> {
    Ok(IpcClient::new())
}

pub fn send_ping() -> Result<PongResponse> {
    Ok(PongResponse {
        ok: true,
        version: "0.0.0".to_string(),
    })
}

pub fn send_execute(
    _agent: String,
    _message: String,
) -> Result<mpsc::Receiver<StreamEvent>> {
    let (_tx, rx) = mpsc::channel();
    Ok(rx)
}
