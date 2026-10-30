//! Files attached to messages (runtime ADR-088). The engine copies each
//! attachment into the peko's workspace and reports its absolute path;
//! these commands show and open those copies. Both refuse any path
//! outside the engine's folder, so the webview cannot read or launch
//! arbitrary files through them.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use tauri_plugin_opener::OpenerExt;

/// The largest file returned for a thumbnail or an inline player.
const MAX_PREVIEW_BYTES: u64 = 20 * 1024 * 1024;

/// The largest pasted file, the engine's per-attachment limit.
const MAX_STAGED_BYTES: usize = 20 * 1024 * 1024;

/// `path`, resolved, when it lies inside `root`.
fn confined(path: &str, root: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("cannot read the peko folder: {e}"))?;
    let path = Path::new(path)
        .canonicalize()
        .map_err(|e| format!("cannot find {path}: {e}"))?;
    if path.starts_with(&root) && path.is_file() {
        Ok(path)
    } else {
        Err("only files a peko keeps can be opened here".to_string())
    }
}

/// The MIME type of a file the webview can show or play.
fn media_mime(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "wav" => Some("audio/wav"),
        "mp3" => Some("audio/mpeg"),
        "m4a" => Some("audio/mp4"),
        "ogg" => Some("audio/ogg"),
        "flac" => Some("audio/flac"),
        "mp4" | "m4v" => Some("video/mp4"),
        "mov" => Some("video/quicktime"),
        "webm" => Some("video/webm"),
        _ => None,
    }
}

fn read_preview(path: &str, root: &Path) -> Result<String, String> {
    let path = confined(path, root)?;
    let mime = media_mime(&path).ok_or("not an image, audio, or video file")?;
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_PREVIEW_BYTES {
        return Err("image is too large to preview".to_string());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn peko_root() -> Result<PathBuf, String> {
    crate::commands::system::peko_home().ok_or_else(|| "could not determine the peko folder".into())
}

/// Save a pasted file (it has no path) to a temporary folder so it can
/// be attached like any other; returns its path. The engine copies it
/// into the peko's workspace when the message is sent.
fn stage(dir: &Path, name: &str, data: &str) -> Result<PathBuf, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("pasted data is not base64: {e}"))?;
    if bytes.len() > MAX_STAGED_BYTES {
        return Err("pasted file is over the 20 MB attachment limit".to_string());
    }
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let safe = safe.trim_start_matches('.');
    let file = if safe.is_empty() { "pasted" } else { safe };
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let id = uuid_like();
    let path = dir.join(format!("{id}-{file}"));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

/// A short unique prefix for staged files.
fn uuid_like() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{nanos:x}")
}

/// Stage a pasted file for attaching; see [`stage`].
#[tauri::command]
pub async fn attachment_stage(name: String, data: String) -> Result<String, String> {
    let dir = std::env::temp_dir().join("peko-pasted");
    stage(&dir, &name, &data).map(|p| p.display().to_string())
}

/// An attached image, audio, or video file as a `data:` URL, for its
/// thumbnail or inline player.
#[tauri::command]
pub async fn attachment_preview(path: String) -> Result<String, String> {
    read_preview(&path, &peko_root()?)
}

/// Open an attached file with the system's default app.
#[tauri::command]
pub async fn attachment_open(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = confined(&path, &peko_root()?)?;
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previews_only_images_inside_the_peko_folder() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let image = root.path().join("a.png");
        std::fs::write(&image, b"png-bytes").unwrap();
        let text = root.path().join("a.txt");
        std::fs::write(&text, b"hi").unwrap();
        let elsewhere = outside.path().join("b.png");
        std::fs::write(&elsewhere, b"png-bytes").unwrap();

        let url = read_preview(&image.display().to_string(), root.path()).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        assert!(read_preview(&text.display().to_string(), root.path()).is_err());
        assert!(read_preview(&elsewhere.display().to_string(), root.path()).is_err());
        // `..` cannot climb out.
        let climb = root.path().join("..").join(
            elsewhere
                .strip_prefix(outside.path().parent().unwrap())
                .unwrap(),
        );
        assert!(read_preview(&climb.display().to_string(), root.path()).is_err());

        let clip = root.path().join("memo.wav");
        std::fs::write(&clip, b"RIFF").unwrap();
        let url = read_preview(&clip.display().to_string(), root.path()).unwrap();
        assert!(url.starts_with("data:audio/wav;base64,"));
    }

    #[test]
    fn a_pasted_file_is_staged_under_a_safe_name() {
        use base64::Engine as _;
        let dir = tempfile::tempdir().unwrap();
        let data = base64::engine::general_purpose::STANDARD.encode(b"png-bytes");
        let path = stage(dir.path(), "../screen shot.png", &data).unwrap();
        assert!(path.starts_with(dir.path()));
        assert!(path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with("-_screen_shot.png"));
        assert_eq!(std::fs::read(&path).unwrap(), b"png-bytes");
        assert!(stage(dir.path(), "x.png", "not base64!").is_err());
    }
}
