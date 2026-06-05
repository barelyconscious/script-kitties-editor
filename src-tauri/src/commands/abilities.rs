use std::sync::Arc;

use tauri::State;

use crate::{dal::Dal, model::Ability};

#[tauri::command]
pub fn get_abilities(dal: State<Dal>) -> Result<Arc<Vec<Ability>>, String> {
    dal.get_abilities()
}

#[tauri::command]
pub fn save_ability(ability: Ability, dal: State<Dal>) -> Result<(), String> {
    dal.save_ability(ability)
}
