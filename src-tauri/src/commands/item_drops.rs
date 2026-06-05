use std::sync::Arc;

use tauri::State;

use crate::{dal::Dal, model::ItemDrop};

#[tauri::command]
pub fn get_item_drops(dal: State<Dal>) -> Result<Arc<Vec<ItemDrop>>, String> {
    dal.get_item_drops()
}

#[tauri::command]
pub fn save_item_drop(item_drop: ItemDrop, dal: State<Dal>) -> Result<(), String> {
    dal.save_item_drop(item_drop)
}
