use std::sync::Arc;

use tauri::State;

use crate::{dal::Dal, model::Bundle};

#[tauri::command]
pub fn get_bundles(dal: State<Dal>) -> Result<Arc<Vec<Bundle>>, String> {
    dal.get_bundles()
}

#[tauri::command]
pub fn save_bundle(bundle: Bundle, dal: State<Dal>) -> Result<(), String> {
    dal.save_bundle(bundle)
}
