use keyring_core::Entry;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum VaultError {
    #[error("keyring error: {0}")]
    Keyring(#[from] keyring_core::error::Error),
    #[error("not found")]
    NotFound,
}

pub type Result<T> = std::result::Result<T, VaultError>;

fn ensure_store() -> Result<()> {
    if keyring_core::get_default_store().is_none() {
        keyring::use_native_store(false).map_err(VaultError::Keyring)?;
    }
    Ok(())
}

pub fn get_credential(service: &str, account: &str) -> Result<Option<String>> {
    ensure_store()?;
    let entry = Entry::new(service, account).map_err(VaultError::Keyring)?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring_core::error::Error::NoEntry) => Ok(None),
        Err(e) => Err(VaultError::Keyring(e)),
    }
}

pub fn set_credential(service: &str, account: &str, password: &str) -> Result<()> {
    ensure_store()?;
    let entry = Entry::new(service, account).map_err(VaultError::Keyring)?;
    entry.set_password(password).map_err(VaultError::Keyring)?;
    Ok(())
}

pub fn delete_credential(service: &str, account: &str) -> Result<()> {
    ensure_store()?;
    let entry = Entry::new(service, account).map_err(VaultError::Keyring)?;
    entry.delete_credential().map_err(VaultError::Keyring)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vault_error_display() {
        let err = VaultError::NotFound;
        assert_eq!(err.to_string(), "not found");
    }

    #[test]
    fn test_credential_roundtrip() {
        let service = "peko-test-service";
        let account = "peko-test-account";
        let password = "test-password-123";

        // Set credential
        let set_result = set_credential(service, account, password);
        if set_result.is_ok() {
            // Get credential
            let get_result = get_credential(service, account).unwrap();
            assert_eq!(get_result, Some(password.to_string()));

            // Delete credential
            delete_credential(service, account).unwrap();

            // Verify deletion
            let after_delete = get_credential(service, account).unwrap();
            assert_eq!(after_delete, None);
        } else {
            // Keyring may not be available in CI, so just verify the error is handled
            println!("Keyring not available in test environment: {:?}", set_result);
        }
    }
}
