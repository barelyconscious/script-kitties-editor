use std::sync::Arc;

use tauri::State;

use crate::{dal::Dal, model::Charm};

#[tauri::command]
pub fn get_charms(dal: State<Dal>) -> Result<Arc<Vec<Charm>>, String> {
    dal.get_charms()
}

#[tauri::command]
pub fn save_charm(charm: Charm, dal: State<Dal>) -> Result<(), String> {
    dal.save_charm(charm)
}
