use thiserror::Error;

#[derive(Error, Debug)]
pub enum UpdaterError {
    #[error("update check failed: {0}")]
    CheckFailed(String),
    #[error("not implemented")]
    NotImplemented,
}

pub type Result<T> = std::result::Result<T, UpdaterError>;

pub struct Updater;

impl Default for Updater {
    fn default() -> Self {
        Self
    }
}

impl Updater {
    pub fn new() -> Self {
        Self
    }

    pub async fn check(&self) -> Result<bool> {
        Ok(false)
    }

    pub async fn download_and_install(&self) -> Result<()> {
        Ok(())
    }
}
