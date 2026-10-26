use crate::talents;
use serde_json::Value;

#[tauri::command]
pub fn get_talents() -> Result<Value, String> {
    talents::read()
}

#[tauri::command]
pub fn save_talents(contents: String) -> Result<(), String> {
    talents::write(&contents)
}
