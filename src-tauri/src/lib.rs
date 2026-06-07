use crate::commands::abilities::{get_abilities, save_ability};
use crate::commands::biograms::{get_biograms, save_biogram};
use crate::commands::charms::{get_charms, save_charm};
use crate::commands::config::{get_config, save_config};
use crate::commands::creatures::{get_creatures, save_creature};
use crate::commands::dlc::{get_dlcs, save_dlc};
use crate::commands::effects::{get_effects, save_effect};
use crate::commands::game_objects::get_game_objects;
use crate::commands::item_drops::{get_item_drops, save_item_drop};
use crate::commands::items::{get_items, save_item};
use crate::commands::scripts::{create_script, get_script, save_script};
use crate::commands::sprites::{get_sprite, list_sprites};
use crate::config::get_or_create_config;
use crate::dal::Dal;

mod commands;
mod config;
mod dal;
mod model;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dal = Dal::new(get_or_create_config()).expect("failed to initialize DAL");

    let builder = tauri::Builder::default();

    #[cfg(target_os = "macos")]
    let builder = builder.menu(build_macos_menu);

    builder
        .plugin(tauri_plugin_opener::init())
        .manage(dal)
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
