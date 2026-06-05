use std::sync::Arc;

use tauri::State;

use crate::{dal::Dal, model::Biogram};

#[tauri::command]
pub fn get_biograms(dal: State<Dal>) -> Result<Arc<Vec<Biogram>>, String> {
    dal.get_biograms()
}

#[tauri::command]
pub fn save_biogram(biogram: Biogram, dal: State<Dal>) -> Result<(), String> {
    dal.save_biogram(biogram)
}
