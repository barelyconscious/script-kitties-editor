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
///
/// `xml` is included so the rescan catalogues GUI component layouts
/// (`gui/**/*.xml`) — without it, the walk would not only miss new components but
/// actively DROP any `.xml` entry registered on save (the walk is authoritative,
/// so an unfound key is treated as removed). The editor's register-on-save handles
/// immediate registration; tracking `.xml` here keeps a full rescan consistent with
/// it instead of clobbering it.
const ASSET_EXTENSIONS: &[&str] = &["lua", "png", "json", "xml"];

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

    /// Surgically register one new asset in `assets.json`, inserting it in
    /// **alphabetical position** among the existing keys (rather than appending to
    /// the end) so a freshly-registered component lands where it sorts in the list.
    /// Every existing key keeps its relative order, so an already-sorted manifest
    /// stays sorted and the on-disk diff is a single inserted line. We re-read the
    /// raw file into an ordered `serde_json::Value` (the crate's `preserve_order`
    /// feature keeps Object key order) rather than round-tripping the `HashMap`-typed
    /// manifest, which would scramble the file.
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

        // Place the new key in ALPHABETICAL position: rebuild the object, inserting
        // the new entry just before the first existing key that sorts after it.
        // Existing keys keep their relative order, so a sorted manifest stays sorted
        // (single-line diff) and an unsorted one still slots the new key sensibly.
        let mut rebuilt = Map::with_capacity(obj.len() + 1);
        let mut inserted = false;
        for (k, v) in obj.iter() {
            if !inserted && name < k.as_str() {
                rebuilt.insert(name.to_string(), Value::Object(entry.clone()));
                inserted = true;
            }
            rebuilt.insert(k.clone(), v.clone());
        }
        if !inserted {
            // The new key sorts after every existing one — it belongs at the end.
            rebuilt.insert(name.to_string(), Value::Object(entry));
        }
        *obj = rebuilt;

        // Match the game's on-disk style: 2-space pretty, no trailing newline.
        let serialized = serde_json::to_string_pretty(&root)
            .map_err(|e| format!("failed to serialize manifest: {}", e))?;
        crate::dal::atomic_write(&path, serialized.as_bytes())?;

        // Re-typed map for the caller to seed the cache with.
        let map: HashMap<String, AssetEntry> = serde_json::from_value(root)
            .map_err(|e| format!("failed to re-read manifest after insert: {}", e))?;
        Ok(map)
    }

    /// Remove a single entry from `assets.json` by name, preserving the order of
    /// every remaining entry. The rollback counterpart of [`Dal::insert_manifest_entry`]:
    /// used to undo a just-inserted entry when a later step of a multi-write create
    /// fails (e.g. the `.xml` manifest entry landed but the controller `.lua` entry
    /// failed). Best-effort by nature of rollback, but it fails loudly if the file
    /// can't be read/parsed/written so callers can surface a wedged manifest.
    ///
    /// Returns the updated, ordered `HashMap` so the caller can re-seed the manifest
    /// cache. A no-op (name absent) is not an error — removing an entry that was
    /// never inserted is the benign case for a rollback that didn't get that far.
    pub(crate) fn remove_manifest_entry(
        &self,
        name: &str,
    ) -> Result<HashMap<String, AssetEntry>, String> {
        let path = self.manifest_path();
        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let mut root: Value = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;

        let obj = root
            .as_object_mut()
            .ok_or_else(|| format!("{} is not a JSON object", path.display()))?;

        obj.remove(name);

        // Match the manifest's on-disk style: 2-space pretty, no trailing newline.
        let serialized = serde_json::to_string_pretty(&root)
            .map_err(|e| format!("failed to serialize manifest: {}", e))?;
        crate::dal::atomic_write(&path, serialized.as_bytes())?;

        let map: HashMap<String, AssetEntry> = serde_json::from_value(root)
            .map_err(|e| format!("failed to re-read manifest after remove: {}", e))?;
        Ok(map)
    }

    /// Rescan the entire game install tree and rebuild `assets.json` so newly
    /// added sprites, scripts, data files, and GUI component layouts become
    /// resolvable. Ported from the game's Electron `assetUpdater`, with the
    /// extension filter widened to include `.xml` (so GUI components are
    /// catalogued, not dropped — see [`ASSET_EXTENSIONS`]); same ignore rules
    /// (Visual Studio `x64` build output and the `std.*` module artifacts), and the
    /// same "a `Tiles\` path wins over a duplicate basename" override.
    ///
    /// The rebuilt manifest is written in **alphabetical key order** (not the raw
    /// filesystem-walk order the original used, and not "existing keys then new ones
    /// appended"): a newly-scanned file lands where it sorts, never at the bottom —
    /// matching [`Dal::insert_manifest_entry`]'s alphabetical placement. Once sorted,
    /// subsequent rescans and register-on-save inserts both keep it sorted, so the
    /// steady-state diff stays minimal. Entries whose file has vanished are dropped
    /// (the walk is authoritative). Returns a per-name summary of what changed.
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

        // Accumulate the final entries, then sort by key so the written manifest is
        // alphabetical (see the doc note). Order of accumulation doesn't matter here.
        let mut entries: Vec<(String, Value)> = Vec::new();
        let mut updated = Vec::new();
        let mut removed = Vec::new();

        // 1. Existing keys: keep if the file still exists (refreshing its path),
        //    otherwise record it as removed.
        for (key, old_val) in old_obj {
            match collected_paths.get(key.as_str()) {
                Some(&new_fp) => {
                    let old_fp = old_val.get("filepath").and_then(Value::as_str).unwrap_or("");
                    if old_fp != new_fp {
                        updated.push(key.clone());
                    }
                    entries.push((key.clone(), asset_entry_value(new_fp)));
                }
                None => removed.push(key.clone()),
            }
        }

        // 2. Newly discovered keys.
        let mut added = Vec::new();
        for (name, fp) in &collected {
            if !old_obj.contains_key(name) {
                added.push(name.clone());
                entries.push((name.clone(), asset_entry_value(fp)));
            }
        }

        // Sort the whole manifest alphabetically by key so new files land in place
        // rather than at the bottom, and the on-disk order is deterministic.
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let out: Map<String, Value> = entries.into_iter().collect();

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
