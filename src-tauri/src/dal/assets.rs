use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde_json::{Map, Value};

use crate::{dal::Dal, model::AssetEntry};

impl Dal {
    /// `assets.json` lives at the game install root, not under `Data/`.
    pub(crate) fn manifest_path(&self) -> PathBuf {
        Path::new(&self.config().game_install_path).join("assets.json")
    }

    /// Surgically register one new asset in `assets.json`, preserving the exact
    /// order of every pre-existing entry so the on-disk diff is a single added
    /// entry. We re-read the raw file into an ordered `serde_json::Value` (the
    /// crate's `preserve_order` feature keeps Object key order) rather than
    /// round-tripping the `HashMap`-typed manifest, which would scramble the file.
    ///
    /// Returns the updated, ordered `HashMap` so callers can refresh the manifest
    /// cache without a disk re-read. Fails (writing nothing) if `name` is already
    /// present, so the caller's no-clobber check stays authoritative even against
    /// the raw file.
    pub(crate) fn insert_manifest_entry(
        &self,
        name: &str,
        filepath: &str,
    ) -> Result<HashMap<String, AssetEntry>, String> {
        let path = self.manifest_path();
        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let mut root: Value = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;

        let obj = root
            .as_object_mut()
            .ok_or_else(|| format!("{} is not a JSON object", path.display()))?;

        if obj.contains_key(name) {
            return Err(format!(
                "asset '{}' is already registered in the manifest",
                name
            ));
        }

        let mut entry = Map::new();
        entry.insert("filepath".to_string(), Value::String(filepath.to_string()));
        // Insertion appends to the end with `preserve_order`, keeping the existing
        // keys exactly where they were.
        obj.insert(name.to_string(), Value::Object(entry));

        // Match the game's on-disk style: 2-space pretty, no trailing newline.
        let serialized = serde_json::to_string_pretty(&root)
            .map_err(|e| format!("failed to serialize manifest: {}", e))?;
        crate::dal::atomic_write(&path, serialized.as_bytes())?;

        // Re-typed map for the caller to seed the cache with.
        let map: HashMap<String, AssetEntry> = serde_json::from_value(root)
            .map_err(|e| format!("failed to re-read manifest after insert: {}", e))?;
        Ok(map)
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
        // Most data references a sprite by its full filename (e.g. "bitlynx.png"),
        // but creatures store the bare stem ("bitlynx"). Fall back to "<name>.png"
        // so both conventions resolve to the same manifest entry.
        let entry = manifest.get(name).or_else(|| {
            if name.is_empty() || name.contains('.') {
                None
            } else {
                manifest.get(&format!("{name}.png"))
            }
        });
        let Some(entry) = entry else {
            return Ok(None);
        };
        // Manifest paths use Windows separators; normalize for the host OS.
        let relative = entry.filepath.replace('\\', "/");
        let abs = Path::new(&self.config().game_install_path).join(relative);
        Ok(Some(abs))
    }
}
