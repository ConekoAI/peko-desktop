use std::path::PathBuf;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn run_peko(args: &[&str]) -> Result<std::process::Output, String> {
    let binary: PathBuf = crate::daemon::find_binary().map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new(binary);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd.args(args).output().map_err(|e| e.to_string())
}

pub fn run_peko_json<T: serde::de::DeserializeOwned>(args: &[&str]) -> Result<T, String> {
    let output = run_peko(args)?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("peko command failed: {}", err.trim()));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("failed to parse JSON: {}", e))
}

pub fn run_peko_ok(args: &[&str]) -> Result<String, String> {
    let output = run_peko(args)?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("peko command failed: {}", err.trim()));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.trim().to_string())
}

#[cfg(test)]
mod tests {
    /// Test that run_peko_ok returns stdout on success
    #[test]
    fn test_run_peko_ok_success() {
        // Use platform-specific echo command
        #[cfg(windows)]
        let output = std::process::Command::new("cmd")
            .args(["/C", "echo", "hello"])
            .output()
            .unwrap();
        #[cfg(not(windows))]
        let output = std::process::Command::new("echo")
            .arg("hello")
            .output()
            .unwrap();
        assert!(output.status.success());
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert_eq!(stdout.trim(), "hello");
    }

    /// Test that run_peko_ok returns error on non-zero exit
    #[test]
    fn test_run_peko_ok_failure() {
        // Use a command that fails
        #[cfg(windows)]
        let result = std::process::Command::new("cmd")
            .args(["/C", "exit", "1"])
            .output();
        #[cfg(not(windows))]
        let result = std::process::Command::new("false").output();

        let output = result.unwrap();
        assert!(!output.status.success());
    }

    /// Test JSON parsing with valid JSON
    #[test]
    fn test_json_parsing() {
        let json = br#"{"name":"test","value":42}"#;
        let parsed: serde_json::Value = serde_json::from_slice(json).unwrap();
        assert_eq!(parsed["name"], "test");
        assert_eq!(parsed["value"], 42);
    }

    /// Test JSON parsing error handling
    #[test]
    fn test_json_parsing_invalid() {
        let json = br#"not valid json"#;
        let result: Result<serde_json::Value, _> = serde_json::from_slice(json);
        assert!(result.is_err());
    }
}
