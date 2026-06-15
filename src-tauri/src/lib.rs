use crate::commands::abilities::{get_abilities, save_ability};
use crate::commands::biograms::{get_biograms, save_biogram};
use crate::commands::bundles::{get_bundles, save_bundle};
use crate::commands::charms::{get_charms, save_charm};
use crate::commands::config::{get_config, save_config};
use crate::commands::creatures::{get_creatures, save_creature};
use crate::commands::dlc::{get_dlcs, save_dlc};
use crate::commands::effects::{get_effects, save_effect};
use crate::commands::game_objects::get_game_objects;
use crate::commands::item_drops::{get_item_drops, save_item_drop};
use crate::commands::items::{get_items, save_item};
use crate::commands::packs::{get_packs, save_pack};
use crate::commands::registry::{get_registry, save_registry};
use crate::commands::scripts::{create_script, get_script, save_script};
use crate::commands::sprites::{get_sprite, list_sprites};
use crate::config::{get_or_create_config, write_to_disk, EditorConfig};
use crate::dal::Dal;
use std::path::Path;

mod commands;
mod config;
mod dal;
mod model;
mod registry;

// macOS owns Cmd+W via the default menu's "Close Window" item, and that native
// accelerator fires before the webview ever sees the keystroke — so the only way
// to stop Cmd+W from closing the window is to ship a menu that never binds it.
// This rebuilds the standard macOS menu (App / Edit / View / Window) minus the
// Close item. Cmd+Q (quit) and all the clipboard/edit accelerators are kept.
//
// Only macOS has a default app menu, so we only override there. Windows/Linux
// keep their default (no app menu); the frontend keydown guard covers Ctrl+W
// for those webviews.
#[cfg(target_os = "macos")]
fn build_macos_menu(
    handle: &tauri::AppHandle,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};

    // The first submenu is the app/about menu; its title is shown as the app name.
    let app_menu = SubmenuBuilder::new(handle, "Script Kitties Editor")
        .about(Some(AboutMetadata::default()))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit() // keeps Cmd+Q
        .build()?;

    // Powers copy/paste/undo/redo/select-all in the webview and Monaco.
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(handle, "View")
        .fullscreen()
        .build()?;

    // Deliberately omits close_window — that item is what carries Cmd+W.
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .maximize() // "Zoom"
        .build()?;

    MenuBuilder::new(handle)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()
}

/// WebView2 (the Windows webview runtime) ships its own "Saved info" form
/// autofill — a native popup over our text inputs that we neither control nor
/// style. Disable it for the WHOLE app by flipping the per-webview settings once
/// at startup. A DOM `autocomplete="off"` is unreliable here (Chromium-based
/// engines ignore it for general autofill), so we reach the CoreWebView2
/// settings directly. Best-effort: any failure just leaves the (cosmetic) popup.
#[cfg(windows)]
fn disable_webview_autofill(app: &tauri::App) {
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // `with_webview` hands us the platform webview on its own thread.
    let _ = window.with_webview(|webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4;
        use windows_core::Interface;

        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(settings) = core.Settings() else {
            return;
        };
        // IsGeneralAutofillEnabled (form data like the "asdf" popup) and
        // IsPasswordAutosaveEnabled live on the Settings4 revision of the
        // interface; cast up to reach them.
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings4>() {
            let _ = settings.SetIsGeneralAutofillEnabled(false);
            let _ = settings.SetIsPasswordAutosaveEnabled(false);
        }
    });
}

/// A path is a usable install when it exists and contains the `Data/` directory
/// the DAL reads from (and hard-watches at startup). We check `Data/` rather than
/// just the root because that's the subdir whose absence makes `Dal::new` fail.
fn install_path_is_valid(path: &str) -> bool {
    !path.is_empty() && Path::new(path).join("Data").is_dir()
}

/// Run before the Tauri runtime starts. If the configured install path is unset
/// or no longer points at a real install, block on a native folder picker until
/// the user selects a valid one (persisting it to config) or dismisses the
/// picker — in which case we exit, since there's nothing to edit without it.
fn ensure_valid_install_path(config: &mut EditorConfig) {
    if install_path_is_valid(&config.game_install_path) {
        return;
    }

    // Explain what we're asking for before the bare OS folder picker appears, so
    // the user knows which folder to point us at rather than guessing.
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Info)
        .set_title("Locate your game install")
        .set_description(
            "Script Kitties Editor needs your worlds-cpp game install folder.\n\n\
             Pick the folder that contains the 'Data' directory.",
        )
        .show();

    loop {
        let Some(dir) = rfd::FileDialog::new()
            .set_title("Select your worlds-cpp game install folder")
            .pick_folder()
        else {
            std::process::exit(0);
        };

        let path = dir.to_string_lossy().into_owned();
        if install_path_is_valid(&path) {
            config.game_install_path = path;
            if let Err(e) = write_to_disk(config) {
                // Non-fatal: the Dal still runs against the path this session; the
                // user just won't have it remembered on next launch.
                eprintln!("failed to persist install path: {}", e);
            }
            return;
        }

        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Warning)
            .set_title("Invalid install folder")
            .set_description(
                "That folder doesn't contain a 'Data' directory.\n\nPlease choose the \
                 root of your worlds-cpp game install.",
            )
            .show();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut config = get_or_create_config();
    ensure_valid_install_path(&mut config);
    let dal = Dal::new(config).expect("failed to initialize DAL");

    let builder = tauri::Builder::default();

    #[cfg(target_os = "macos")]
    let builder = builder.menu(build_macos_menu);

    builder
        .plugin(tauri_plugin_opener::init())
        .manage(dal)
        .setup(|_app| {
            // Kill WebView2's native form autofill ("Saved info") app-wide.
            #[cfg(windows)]
            disable_webview_autofill(_app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_abilities,
            save_ability,
            get_biograms,
            save_biogram,
            get_charms,
            save_charm,
            get_creatures,
            save_creature,
            get_dlcs,
            save_dlc,
            get_effects,
            save_effect,
            get_items,
            save_item,
            get_item_drops,
            save_item_drop,
            get_bundles,
            save_bundle,
            get_packs,
            save_pack,
            get_registry,
            save_registry,
            get_sprite,
            list_sprites,
            get_script,
            save_script,
            create_script,
            get_game_objects
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
