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

/// The largest pasted file, the engine's per-attachment limit.
const MAX_STAGED_BYTES: usize = 20 * 1024 * 1024;

/// The largest page served (runtime ADR-118).
pub const MAX_PAGE_BYTES: u64 = 2 * 1024 * 1024;

/// What a page may do: run its own inline scripts and styles, show
/// `data:` images, fonts and media, and nothing else — no network, no
/// frames, no forms, in an opaque origin (runtime ADR-118 D2).
pub const PAGE_POLICY: &str = "sandbox allow-scripts; default-src 'none'; \
    script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; \
    font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'";

/// `path` names a page.
fn is_page(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm"))
}

/// The page `encoded` names (the percent-encoded absolute path
/// `convertFileSrc(path, "pekopage")` puts in the URL), when it is a page
/// inside `root` no larger than [`MAX_PAGE_BYTES`].
fn read_page(encoded: &str, root: &Path) -> Result<Vec<u8>, String> {
    let decoded = urlencoding::decode(encoded.trim_start_matches('/'))
        .map_err(|e| format!("bad page address: {e}"))?;
    let path = confined(&decoded, root)?;
    if !is_page(&path) {
        return Err("not a page".to_string());
    }
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_PAGE_BYTES {
        return Err("page is too large to show".to_string());
    }
    std::fs::read(&path).map_err(|e| e.to_string())
}

/// Serve a page for the `pekopage:` protocol, with its own policy.
pub fn serve_page(
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<std::borrow::Cow<'static, [u8]>> {
    let page = peko_root().and_then(|root| read_page(request.uri().path(), &root));
    let builder = tauri::http::Response::builder()
        .header("Content-Security-Policy", PAGE_POLICY)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store");
    match page {
        Ok(bytes) => builder
            .status(200)
            .header("Content-Type", "text/html; charset=utf-8")
            .body(std::borrow::Cow::Owned(bytes)),
        Err(e) => builder
            .status(404)
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(std::borrow::Cow::Owned(e.into_bytes())),
    }
    .unwrap_or_else(|_| tauri::http::Response::new(std::borrow::Cow::Borrowed(&b""[..])))
}

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
        // Shown through <img>, which runs no scripts and loads nothing
        // external from it.
        "svg" => Some("image/svg+xml"),
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
    // Each paste gets its own folder, so the file keeps a clean name
    // (it becomes the attachment's name) and pastes never collide.
    let folder = dir.join(uuid_like());
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(file);
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

/// An attached image as a `data:` URL, for its thumbnail. (Audio and
/// video play through the asset protocol, scoped to the pekos' folders.)
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
    fn serves_only_pages_inside_the_peko_folder() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let page = root.path().join("chart.html");
        std::fs::write(&page, b"<h1>hi</h1>").unwrap();
        let text = root.path().join("notes.txt");
        std::fs::write(&text, b"hi").unwrap();
        let elsewhere = outside.path().join("x.html");
        std::fs::write(&elsewhere, b"<h1>no</h1>").unwrap();
        let big = root.path().join("big.html");
        std::fs::File::create(&big)
            .unwrap()
            .set_len(MAX_PAGE_BYTES + 1)
            .unwrap();
        let enc = |p: &Path| format!("/{}", urlencoding::encode(&p.display().to_string()));

        assert_eq!(read_page(&enc(&page), root.path()).unwrap(), b"<h1>hi</h1>");
        assert!(read_page(&enc(&text), root.path()).is_err());
        assert!(read_page(&enc(&elsewhere), root.path()).is_err());
        assert!(read_page(&enc(&big), root.path()).is_err());
        assert!(read_page("/%2Fetc%2Fpasswd", root.path()).is_err());
        assert!(PAGE_POLICY.starts_with("sandbox allow-scripts;"));
        assert!(PAGE_POLICY.contains("default-src 'none'"));
        assert!(!PAGE_POLICY.contains("connect-src"));
    }

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
        let svg = root.path().join("chart.svg");
        std::fs::write(&svg, b"<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
        let url = read_preview(&svg.display().to_string(), root.path()).unwrap();
        assert!(url.starts_with("data:image/svg+xml;base64,"));
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

    #[test]
    fn a_pasted_file_is_staged_under_a_safe_name() {
        use base64::Engine as _;
        let dir = tempfile::tempdir().unwrap();
        let data = base64::engine::general_purpose::STANDARD.encode(b"png-bytes");
        let path = stage(dir.path(), "../screen shot.png", &data).unwrap();
        assert!(path.starts_with(dir.path()));
        assert_eq!(path.file_name().unwrap(), "_screen_shot.png");
        assert_eq!(std::fs::read(&path).unwrap(), b"png-bytes");
        assert!(stage(dir.path(), "x.png", "not base64!").is_err());
    }
}
