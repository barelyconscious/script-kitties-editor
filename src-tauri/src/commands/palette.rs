use std::sync::Arc;

use tauri::State;

use crate::{dal::Dal, model::Palette};

#[tauri::command]
pub fn get_palette(dal: State<Dal>) -> Result<Arc<Palette>, String> {
    dal.get_palette()
}

#[tauri::command]
pub fn save_palette(palette: Palette, dal: State<Dal>) -> Result<(), String> {
    dal.save_palette(palette)
}
