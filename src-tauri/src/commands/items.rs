use std::sync::Arc;

use tauri::State;

use crate::{dal::Dal, model::Item};

#[tauri::command]
pub fn get_items(dal: State<Dal>) -> Result<Arc<Vec<Item>>, String> {
    dal.get_items()
}

#[tauri::command]
pub fn save_item(item: Item, dal: State<Dal>) -> Result<(), String> {
    dal.save_item(item)
}
