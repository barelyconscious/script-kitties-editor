use tauri::State;

use crate::{dal::Dal, model::ManifestUpdate};

/// Rescan the game install tree and rebuild `assets.json`, registering any newly
/// added sprites, scripts, and data files. Returns a summary of what changed.
#[tauri::command]
pub fn update_asset_manifest(dal: State<Dal>) -> Result<ManifestUpdate, String> {
    dal.update_asset_manifest()
}
