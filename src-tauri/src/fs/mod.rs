use notify::{Config, Event as NotifyEvent, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FsError {
    #[error("watch error: {0}")]
    Watch(#[from] notify::Error),
    #[error("not implemented")]
    NotImplemented,
}

pub type Result<T> = std::result::Result<T, FsError>;

pub struct AgentWatcher {
    _watcher: RecommendedWatcher,
}

impl AgentWatcher {
    pub fn new(_watcher: RecommendedWatcher) -> Self {
        Self { _watcher }
    }
}

pub fn watch_agent_dir(path: PathBuf) -> Result<Receiver<NotifyEvent>> {
    let (tx, rx) = channel();
    let mut watcher = RecommendedWatcher::new(
        move |res: std::result::Result<NotifyEvent, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        Config::default(),
    )?;
    watcher.watch(&path, RecursiveMode::Recursive)?;
    let _agent_watcher = AgentWatcher::new(watcher);
    Ok(rx)
}
