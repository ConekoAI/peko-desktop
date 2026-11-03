fn main() {
    // Windows: the app needs Common Controls v6 (comctl32 `TaskDialogIndirect`,
    // which Tauri's dialogs link), declared in its manifest. tauri-build
    // embeds that manifest in the app binary only, so the unit-test binary
    // failed to start (STATUS_ENTRYPOINT_NOT_FOUND). Embed the same manifest
    // (`windows-app-manifest.xml`, tauri-build's default) in every binary
    // this crate links, the tests included.
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    let mut attributes = tauri_build::Attributes::new();
    if windows_msvc {
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
