use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use crate::{dal::Dal, model::AssetEntry};

impl Dal {
    /// `assets.json` lives at the game install root, not under `Data/`.
    fn manifest_path(&self) -> PathBuf {
        Path::new(&self.config().game_install_path).join("assets.json")
    }

    pub fn get_asset_manifest(&self) -> Result<Arc<HashMap<String, AssetEntry>>, String> {
        if let Some(hit) = self.manifest.get(&()) {
            return Ok(hit);
        }
        let path = self.manifest_path();
        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let map: HashMap<String, AssetEntry> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;
        let arc = Arc::new(map);
        self.manifest.insert((), arc.clone());
        Ok(arc)
    }

    /// Resolve a logical asset name (e.g. "ability_bite.png") to an absolute path
    /// via the game's `assets.json` manifest. Returns `None` when the name isn't
    /// in the manifest — e.g. art that doesn't exist yet.
    pub fn resolve_asset(&self, name: &str) -> Result<Option<PathBuf>, String> {
        let manifest = self.get_asset_manifest()?;
        let Some(entry) = manifest.get(name) else {
            return Ok(None);
        };
        // Manifest paths use Windows separators; normalize for the host OS.
        let relative = entry.filepath.replace('\\', "/");
        let abs = Path::new(&self.config().game_install_path).join(relative);
        Ok(Some(abs))
    }
}
