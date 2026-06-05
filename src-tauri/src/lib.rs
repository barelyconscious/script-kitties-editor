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
use crate::commands::sprites::{get_sprite, list_sprites};
use crate::config::get_or_create_config;
use crate::dal::Dal;

mod commands;
mod config;
mod dal;
mod model;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dal = Dal::new(get_or_create_config()).expect("failed to initialize DAL");

    tauri::Builder::default()
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
            get_game_objects
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
