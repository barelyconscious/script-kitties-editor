use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde_json::{Map, Value};

use crate::{
    dal::Dal,
    model::{AssetEntry, ManifestUpdate},
};

/// File extensions the manifest tracks (lowercased, no leading dot).
const ASSET_EXTENSIONS: &[&str] = &["lua", "png", "json"];

/// Files that show up in the install tree but must never be catalogued: C++
/// `std`-module build artifacts that share the `.json` extension but aren't game
/// assets. Mirrors the original Electron asset updater's ignore list.
const IGNORED_ASSET_NAMES: &[&str] = &[
    "std.compat.ixx.ifc.dt.d.json",
    "std.compat.ixx.ifc.dt.module.json",
    "std.ixx.ifc.dt.d.json",
    "std.ixx.ifc.dt.module.json",
];

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

    /// Rescan the entire game install tree and rebuild `assets.json` so newly
    /// added sprites, scripts, and data files become resolvable. Ported from the
    /// game's Electron `assetUpdater` — same extension filter (`.lua`/`.png`/
    /// `.json`), same ignore rules (Visual Studio `x64` build output and the
    /// `std.*` module artifacts), and the same "a `Tiles\` path wins over a
    /// duplicate basename" override.
    ///
    /// Unlike the original (which rewrote the file in raw filesystem-walk order),
    /// we preserve the order of every pre-existing key and append only the newly
    /// discovered ones, so a rescan that finds N new files produces an N-line
    /// diff rather than reshuffling the whole manifest. Entries whose file has
    /// vanished are dropped (the walk is authoritative). Returns a per-name
    /// summary of what changed.
    pub fn update_asset_manifest(&self) -> Result<ManifestUpdate, String> {
        let root = PathBuf::from(&self.config().game_install_path);
        let manifest_path = self.manifest_path();

        // Read the prior manifest raw (ordered Value) to preserve key order and to
        // classify each scanned asset as added / updated / unchanged.
        let old_contents = fs::read_to_string(&manifest_path)
            .map_err(|e| format!("failed to read {}: {}", manifest_path.display(), e))?;
        let old_root: Value = serde_json::from_str(&old_contents)
            .map_err(|e| format!("failed to parse {}: {}", manifest_path.display(), e))?;
        let old_obj = old_root
            .as_object()
            .ok_or_else(|| format!("{} is not a JSON object", manifest_path.display()))?;

        // Walk the tree. `collected` keeps first-seen (walk) order; `index` maps a
        // basename to its slot so the Tiles override can rewrite an earlier entry.
        let mut collected: Vec<(String, String)> = Vec::new();
        let mut index: HashMap<String, usize> = HashMap::new();
        collect_assets(&root, &root, &mut collected, &mut index)?;
        let collected_paths: HashMap<&str, &str> = collected
            .iter()
            .map(|(name, fp)| (name.as_str(), fp.as_str()))
            .collect();

        let mut out = Map::new();
        let mut updated = Vec::new();
        let mut removed = Vec::new();

        // 1. Existing keys, in their original order. Keep if the file still exists
        //    (refreshing its path), otherwise record it as removed.
        for (key, old_val) in old_obj {
            match collected_paths.get(key.as_str()) {
                Some(&new_fp) => {
                    let old_fp = old_val.get("filepath").and_then(Value::as_str).unwrap_or("");
                    if old_fp != new_fp {
                        updated.push(key.clone());
                    }
                    out.insert(key.clone(), asset_entry_value(new_fp));
                }
                None => removed.push(key.clone()),
            }
        }

        // 2. Newly discovered keys, appended in walk order.
        let mut added = Vec::new();
        for (name, fp) in &collected {
            if !old_obj.contains_key(name) {
                added.push(name.clone());
                out.insert(name.clone(), asset_entry_value(fp));
            }
        }

        let total = out.len();
        // Match the manifest's on-disk style: 2-space pretty, no trailing newline.
        let serialized = serde_json::to_string_pretty(&Value::Object(out))
            .map_err(|e| format!("failed to serialize manifest: {}", e))?;
        crate::dal::atomic_write(&manifest_path, serialized.as_bytes())?;

        // The manifest changed and resolved sprite paths derive from it, so drop
        // both caches (the file watcher would do this too, but don't depend on its
        // timing — the next read repopulates from the file we just wrote).
        self.manifest.invalidate(&());
        self.sprites.invalidate_all();

        Ok(ManifestUpdate {
            total,
            added,
            updated,
            removed,
        })
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

/// One manifest entry as a `{ "filepath": "<path>" }` object.
fn asset_entry_value(filepath: &str) -> Value {
    let mut entry = Map::new();
    entry.insert("filepath".to_string(), Value::String(filepath.to_string()));
    Value::Object(entry)
}

/// Recursively catalogue every asset file under `dir`. `root` is the install root
/// that filepaths are made relative to; `collected`/`index` accumulate one entry
/// per basename in walk order (see [`Dal::update_asset_manifest`]).
fn collect_assets(
    dir: &Path,
    root: &Path,
    collected: &mut Vec<(String, String)>,
    index: &mut HashMap<String, usize>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("failed to read directory {}: {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read entry in {}: {}", dir.display(), e))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("failed to stat {}: {}", path.display(), e))?;

        if file_type.is_dir() {
            collect_assets(&path, root, collected, index)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }

        // Extension filter (case-insensitive against the lowercased set).
        let tracked = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| ASSET_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false);
        if !tracked {
            continue;
        }

        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let name = name.to_string();

        // Path relative to the install root, using the manifest's Windows-style
        // `\` separators regardless of host OS so entries stay consistent.
        let relative = path.strip_prefix(root).unwrap_or(&path);
        let filepath = relative.to_string_lossy().replace('/', "\\");

        // Skip Visual Studio `x64` build output and the known `std.*` module noise.
        if filepath.contains("x64") || IGNORED_ASSET_NAMES.contains(&name.as_str()) {
            continue;
        }

        if let Some(&pos) = index.get(&name) {
            // Duplicate basename: a `Tiles\` path is authoritative and wins;
            // otherwise the later file overwrites the earlier one's path.
            if !collected[pos].1.starts_with("Tiles") {
                collected[pos].1 = filepath;
            }
        } else {
            index.insert(name.clone(), collected.len());
            collected.push((name, filepath));
        }
    }

    Ok(())
}
