use std::sync::Arc;

use tauri::State;

use crate::{dal::Dal, model::ArenaSurface};

#[tauri::command]
pub fn get_arena_surfaces(dal: State<Dal>) -> Result<Arc<Vec<ArenaSurface>>, String> {
    dal.get_arena_surfaces()
}

#[tauri::command]
pub fn save_arena_surface(surface: ArenaSurface, dal: State<Dal>) -> Result<(), String> {
    dal.save_arena_surface(surface)
}
