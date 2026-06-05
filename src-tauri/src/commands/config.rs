use tauri::State;

use crate::{config, config::EditorConfig, dal::Dal};

#[tauri::command]
pub fn save_config(new_config: EditorConfig, dal: State<Dal>) -> Result<(), String> {
    // Persist to disk first so the on-disk file is the source of truth — if
    // this fails, the in-memory Dal stays at the previous value.
    config::write_to_disk(&new_config)?;
    // Then swap the live Dal state. Failure here means disk and memory are
    // briefly out of sync, but a restart re-loads from disk and reconciles.
    dal.update_config(new_config)
}

#[tauri::command]
pub fn get_config(dal: State<Dal>) -> EditorConfig {
    dal.config()
}
