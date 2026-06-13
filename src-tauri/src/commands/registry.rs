use crate::registry::{self, Registry};

#[tauri::command]
pub fn get_registry() -> Registry {
    registry::get_or_create_registry()
}

#[tauri::command]
pub fn save_registry(new_registry: Registry) -> Result<(), String> {
    registry::write_to_disk(&new_registry)
}
