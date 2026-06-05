use std::sync::Arc;

use tauri::State;

use crate::{dal::Dal, model::Effect};

#[tauri::command]
pub fn get_effects(dal: State<Dal>) -> Result<Arc<Vec<Effect>>, String> {
    dal.get_effects()
}

#[tauri::command]
pub fn save_effect(effect: Effect, dal: State<Dal>) -> Result<(), String> {
    dal.save_effect(effect)
}
