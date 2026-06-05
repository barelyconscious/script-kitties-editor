use std::sync::Arc;

use tauri::State;

use crate::{dal::Dal, model::Creature};

#[tauri::command]
pub fn get_creatures(dal: State<Dal>) -> Result<Arc<Vec<Creature>>, String> {
    dal.get_creatures()
}

#[tauri::command]
pub fn save_creature(creature: Creature, dal: State<Dal>) -> Result<(), String> {
    dal.save_creature(creature)
}
