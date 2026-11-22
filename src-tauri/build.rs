fn main() {
    let is_win_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");

    if is_win_msvc {
        // Embed the Windows Common Controls v6 manifest via linker args so BOTH the main
        // desktop binary AND `cargo test --lib` test binaries resolve `comctl32.dll` v6
        // symbols (`TaskDialogIndirect`, `SetWindowSubclass`), while omitting the duplicate
        // `RT_MANIFEST` from `tauri-winres`'s `resource.lib` (preserving icon & version info).
        println!("cargo::rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo::rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );

        let attrs = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        tauri_build::try_build(attrs).expect("failed to run tauri-build");
    } else {
        tauri_build::build();
    }
}
