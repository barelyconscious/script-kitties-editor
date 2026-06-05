use tauri::State;

use crate::dal::Dal;

/// Resolve a logical sprite name (e.g. "ability_bite.png") to a `data:` URL for
/// rendering, or `null` when there's no art for it.
#[tauri::command]
pub fn get_sprite(name: String, dal: State<Dal>) -> Result<Option<String>, String> {
    dal.get_sprite_data_url(&name)
}

/// All available sprite names (manifest entries under `Sprites/`), for pickers.
#[tauri::command]
pub fn list_sprites(dal: State<Dal>) -> Result<Vec<String>, String> {
    dal.list_sprites()
}
