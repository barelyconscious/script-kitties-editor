use std::sync::Arc;

use tauri::State;

use crate::{dal::Dal, model::Season};

#[tauri::command]
pub fn get_seasons(dal: State<Dal>) -> Result<Arc<Vec<Season>>, String> {
    dal.get_seasons()
}

#[tauri::command]
pub fn save_season(season: Season, dal: State<Dal>) -> Result<(), String> {
    dal.save_season(season)
}
