use std::sync::Arc;

use tauri::State;

use crate::{dal::Dal, model::Dlc};

#[tauri::command]
pub fn get_dlcs(dal: State<Dal>) -> Result<Arc<Vec<Dlc>>, String> {
    dal.get_dlcs()
}

#[tauri::command]
pub fn save_dlc(dlc: Dlc, dal: State<Dal>) -> Result<(), String> {
    dal.save_dlc(dlc)
}
