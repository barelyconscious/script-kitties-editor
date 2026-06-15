use std::sync::Arc;

use tauri::State;

use crate::{dal::Dal, model::Pack};

#[tauri::command]
pub fn get_packs(dal: State<Dal>) -> Result<Arc<Vec<Pack>>, String> {
    dal.get_packs()
}

#[tauri::command]
pub fn save_pack(pack: Pack, dal: State<Dal>) -> Result<(), String> {
    dal.save_pack(pack)
}
