//! Files attached to messages (runtime ADR-088). The engine copies each
//! attachment into the peko's workspace and reports its absolute path;
//! these commands show and open those copies. Both refuse any path
//! outside the engine's folder, so the webview cannot read or launch
//! arbitrary files through them.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use tauri_plugin_opener::OpenerExt;

/// The largest image returned for a thumbnail.
const MAX_PREVIEW_BYTES: u64 = 10 * 1024 * 1024;

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

fn image_mime(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn read_preview(path: &str, root: &Path) -> Result<String, String> {
    let path = confined(path, root)?;
    let mime = image_mime(&path).ok_or("not an image")?;
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

/// An attached image as a `data:` URL, for its thumbnail.
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
    }
}
