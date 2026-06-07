use tauri::State;

use crate::dal::Dal;

/// Read a `.lua` script's contents by logical name (the value in an object's
/// `script` / `aiController` field). Returns `null` when the object is genuinely
/// script-less, an error when the manifest references a file that's missing on
/// disk, or the file contents otherwise.
#[tauri::command]
pub fn get_script(name: String, dal: State<Dal>) -> Result<Option<String>, String> {
    dal.get_script(&name)
}

/// Overwrite an existing `.lua` script's contents. Errors if `name` is not
/// already registered in the asset manifest — new-file creation is not yet
/// supported.
#[tauri::command]
pub fn save_script(name: String, contents: String, dal: State<Dal>) -> Result<(), String> {
    dal.save_script(&name, contents)
}
