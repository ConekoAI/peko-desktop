use std::path::PathBuf;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn run_peko(args: &[&str]) -> Result<std::process::Output, String> {
    let binary: PathBuf = crate::daemon::find_binary().map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new(binary);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd.args(args)
        .output()
        .map_err(|e| e.to_string())
}

pub fn run_peko_json<T: serde::de::DeserializeOwned>(args: &[&str]) -> Result<T, String> {
    let output = run_peko(args)?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("peko command failed: {}", err.trim()));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("failed to parse JSON: {}", e))
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
