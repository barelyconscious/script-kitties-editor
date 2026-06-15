use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
};

use moka::sync::Cache;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;

use crate::{
    config::EditorConfig,
    model::{
        Ability, AssetEntry, Biogram, Bundle, Charm, Creature, Dlc, Effect, Item, ItemDrop, Pack,
    },
};

pub mod abilities;
pub mod assets;
pub mod biograms;
pub mod bundles;
pub mod charms;
pub mod creatures;
pub mod dlc;
pub mod effects;
pub mod item_drops;
pub mod items;
pub mod packs;
pub mod scripts;
pub mod sprites;

pub struct Dal {
    // Config is mutable at runtime via `update_config`; readers take a snapshot
    // through a short-lived read lock so they don't hold it across file I/O.
    config: RwLock<EditorConfig>,
    pub(crate) abilities: Cache<(), Arc<Vec<Ability>>>,
    pub(crate) biograms: Cache<(), Arc<Vec<Biogram>>>,
    pub(crate) charms: Cache<(), Arc<Vec<Charm>>>,
    pub(crate) creatures: Cache<(), Arc<Vec<Creature>>>,
    pub(crate) dlcs: Cache<(), Arc<Vec<Dlc>>>,
    pub(crate) effects: Cache<(), Arc<Vec<Effect>>>,
    pub(crate) items: Cache<(), Arc<Vec<Item>>>,
    pub(crate) item_drops: Cache<(), Arc<Vec<ItemDrop>>>,
    pub(crate) bundles: Cache<(), Arc<Vec<Bundle>>>,
    pub(crate) packs: Cache<(), Arc<Vec<Pack>>>,
    // The game's assets.json manifest (logical name -> on-disk path).
    pub(crate) manifest: Cache<(), Arc<HashMap<String, AssetEntry>>>,
    // Resolved sprite data URLs, keyed by logical sprite name.
    pub(crate) sprites: Cache<String, Arc<Option<String>>>,
    // Script file contents, keyed by logical script name. `None` = script-less
    // (name absent from the manifest); `Some` = file contents.
    pub(crate) scripts: Cache<String, Arc<Option<String>>>,
    // Swapped out by `update_config` so a new install path starts watching the
    // new Data dir and the old watcher (dropped here) stops firing.
    watcher: Mutex<RecommendedWatcher>,
}

impl Dal {
    pub fn new(config: EditorConfig) -> Result<Self, String> {
        let abilities: Cache<(), Arc<Vec<Ability>>> = Cache::builder().max_capacity(1).build();
        let biograms: Cache<(), Arc<Vec<Biogram>>> = Cache::builder().max_capacity(1).build();
        let charms: Cache<(), Arc<Vec<Charm>>> = Cache::builder().max_capacity(1).build();
        let creatures: Cache<(), Arc<Vec<Creature>>> = Cache::builder().max_capacity(1).build();
        let dlcs: Cache<(), Arc<Vec<Dlc>>> = Cache::builder().max_capacity(1).build();
        let effects: Cache<(), Arc<Vec<Effect>>> = Cache::builder().max_capacity(1).build();
        let items: Cache<(), Arc<Vec<Item>>> = Cache::builder().max_capacity(1).build();
        let item_drops: Cache<(), Arc<Vec<ItemDrop>>> = Cache::builder().max_capacity(1).build();
        let bundles: Cache<(), Arc<Vec<Bundle>>> = Cache::builder().max_capacity(1).build();
        let packs: Cache<(), Arc<Vec<Pack>>> = Cache::builder().max_capacity(1).build();
        let manifest: Cache<(), Arc<HashMap<String, AssetEntry>>> =
            Cache::builder().max_capacity(1).build();
        let sprites: Cache<String, Arc<Option<String>>> =
            Cache::builder().max_capacity(1024).build();
        let scripts: Cache<String, Arc<Option<String>>> =
            Cache::builder().max_capacity(1024).build();

        let game_root = PathBuf::from(&config.game_install_path);
        let watcher = build_watcher(
            &game_root, &abilities, &biograms, &charms, &creatures, &dlcs, &effects, &items,
            &item_drops, &bundles, &packs, &manifest, &sprites, &scripts,
        )?;

        Ok(Self {
            config: RwLock::new(config),
            abilities,
            biograms,
            charms,
            creatures,
            dlcs,
            effects,
            items,
            item_drops,
            bundles,
            packs,
            manifest,
            sprites,
            scripts,
            watcher: Mutex::new(watcher),
        })
    }

    /// Replace the in-memory config and rewire the filesystem watcher to the
    /// new Data directory. All domain caches are invalidated because their
    /// contents were loaded from the old path.
    pub fn update_config(&self, new_config: EditorConfig) -> Result<(), String> {
        // Build the new watcher BEFORE touching state — if it fails (e.g. the
        // new game_install_path doesn't exist) we leave the Dal as it was.
        let new_root = PathBuf::from(&new_config.game_install_path);
        let new_watcher = build_watcher(
            &new_root,
            &self.abilities,
            &self.biograms,
            &self.charms,
            &self.creatures,
            &self.dlcs,
            &self.effects,
            &self.items,
            &self.item_drops,
            &self.bundles,
            &self.packs,
            &self.manifest,
            &self.sprites,
            &self.scripts,
        )?;

        *self.config.write().unwrap() = new_config;
        // Dropping the old watcher here stops it from firing on the old dir.
        *self.watcher.lock().unwrap() = new_watcher;

        self.abilities.invalidate_all();
        self.biograms.invalidate_all();
        self.charms.invalidate_all();
        self.creatures.invalidate_all();
        self.dlcs.invalidate_all();
        self.effects.invalidate_all();
        self.items.invalidate_all();
        self.item_drops.invalidate_all();
        self.bundles.invalidate_all();
        self.packs.invalidate_all();
        self.manifest.invalidate_all();
        self.sprites.invalidate_all();
        self.scripts.invalidate_all();

        Ok(())
    }

    pub fn config(&self) -> EditorConfig {
        self.config.read().unwrap().clone()
    }

    pub(crate) fn data_dir(&self) -> PathBuf {
        Path::new(&self.config.read().unwrap().game_install_path).join("Data")
    }
}

#[allow(clippy::too_many_arguments)]
fn build_watcher(
    game_root: &Path,
    abilities: &Cache<(), Arc<Vec<Ability>>>,
    biograms: &Cache<(), Arc<Vec<Biogram>>>,
    charms: &Cache<(), Arc<Vec<Charm>>>,
    creatures: &Cache<(), Arc<Vec<Creature>>>,
    dlcs: &Cache<(), Arc<Vec<Dlc>>>,
    effects: &Cache<(), Arc<Vec<Effect>>>,
    items: &Cache<(), Arc<Vec<Item>>>,
    item_drops: &Cache<(), Arc<Vec<ItemDrop>>>,
    bundles: &Cache<(), Arc<Vec<Bundle>>>,
    packs: &Cache<(), Arc<Vec<Pack>>>,
    manifest: &Cache<(), Arc<HashMap<String, AssetEntry>>>,
    sprites: &Cache<String, Arc<Option<String>>>,
    scripts: &Cache<String, Arc<Option<String>>>,
) -> Result<RecommendedWatcher, String> {
    let data_dir = game_root.join("Data");
    let scripts_dir = game_root.join("Scripts");

    // (path the watcher reacts to, closure that invalidates the matching cache).
    // To register a new domain: clone its cache handle and push a row here.
    type Invalidator = Box<dyn Fn() + Send + Sync + 'static>;
    let invalidators: Vec<(PathBuf, Invalidator)> = vec![
        (data_dir.join("abilities.json"), {
            let c = abilities.clone();
            Box::new(move || c.invalidate(&()))
        }),
        (data_dir.join("biograms.json"), {
            let c = biograms.clone();
            Box::new(move || c.invalidate(&()))
        }),
        (data_dir.join("charms.json"), {
            let c = charms.clone();
            Box::new(move || c.invalidate(&()))
        }),
        (data_dir.join("creatures.json"), {
            let c = creatures.clone();
            Box::new(move || c.invalidate(&()))
        }),
        (data_dir.join("dlc.json"), {
            let c = dlcs.clone();
            Box::new(move || c.invalidate(&()))
        }),
        (data_dir.join("effects.json"), {
            let c = effects.clone();
            Box::new(move || c.invalidate(&()))
        }),
        (data_dir.join("items.json"), {
            let c = items.clone();
            Box::new(move || c.invalidate(&()))
        }),
        (data_dir.join("itemDropTable.json"), {
            let c = item_drops.clone();
            Box::new(move || c.invalidate(&()))
        }),
        (data_dir.join("bundles.json"), {
            let c = bundles.clone();
            Box::new(move || c.invalidate(&()))
        }),
        (data_dir.join("packs.json"), {
            let c = packs.clone();
            Box::new(move || c.invalidate(&()))
        }),
        // assets.json lives at the game root. When it changes, both the manifest
        // and every resolved sprite (paths derived from it) may be stale.
        (game_root.join("assets.json"), {
            let manifest = manifest.clone();
            let sprites = sprites.clone();
            Box::new(move || {
                manifest.invalidate(&());
                sprites.invalidate_all();
            })
        }),
    ];

    // Scripts/ holds ~134 `.lua` files; we can't cheaply map a changed file back
    // to its logical name, so any `.lua` change invalidates the whole scripts cache
    // (wholesale, like sprites on an assets.json change). Captured separately from
    // the exact-path invalidators above.
    let scripts_cache = scripts.clone();
    let scripts_dir_match = scripts_dir.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else { return };
        // Ignore access-only events; only react when the file's bytes change.
        match event.kind {
            EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {}
            _ => return,
        }
        for path in &event.paths {
            for (watched_path, invalidate) in &invalidators {
                if path == watched_path {
                    invalidate();
                }
            }
            if path.starts_with(&scripts_dir_match)
                && path.extension().and_then(|e| e.to_str()) == Some("lua")
            {
                scripts_cache.invalidate_all();
            }
        }
    })
    .map_err(|e| format!("failed to create filesystem watcher: {}", e))?;

    // Watch Data/ for the domain JSON files, and the game root (non-recursively)
    // for assets.json. Two shallow watches rather than one recursive watch over
    // the whole install (which would also cover the large Sprites/ tree).
    watcher
        .watch(&data_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("failed to watch {}: {}", data_dir.display(), e))?;
    watcher
        .watch(game_root, RecursiveMode::NonRecursive)
        .map_err(|e| format!("failed to watch {}: {}", game_root.display(), e))?;
    // Best-effort: a valid install has Scripts/, but an install missing it should
    // still start (Data Tables / Creature Editor don't need scripts). If the watch
    // can't be set up, the scripts cache simply won't auto-freshen on external edits.
    let _ = watcher.watch(&scripts_dir, RecursiveMode::NonRecursive);

    Ok(watcher)
}

/// Pretty-print a serializable value with 4-space indent and a trailing newline,
/// matching the game's existing JSON file style so saves produce minimal diffs.
pub(crate) fn serialize_pretty<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    let formatter = serde_json::ser::PrettyFormatter::with_indent(b"    ");
    let mut buf = Vec::new();
    let mut serializer = serde_json::Serializer::with_formatter(&mut buf, formatter);
    value
        .serialize(&mut serializer)
        .map_err(|e| format!("failed to serialize: {}", e))?;
    buf.push(b'\n');
    Ok(buf)
}

/// The temp sibling an atomic write stages bytes in before renaming over `path`.
/// Appends `.tmp` to the full filename rather than replacing the extension, so the
/// temp reflects the real target: `charms.json` -> `charms.json.tmp` (unchanged
/// from the old behavior) and `bite.lua` -> `bite.lua.tmp` (not a `.json.tmp`).
fn tmp_sibling(path: &Path) -> PathBuf {
    let mut os = path.as_os_str().to_owned();
    os.push(".tmp");
    PathBuf::from(os)
}

/// Write `buf` to `path` atomically: write to a sibling temp file then rename
/// over the destination. `fs::rename` is atomic on POSIX, and on Windows when
/// source and destination sit on the same volume — which is always the case
/// here because the temp file lives in the same directory.
pub(crate) fn atomic_write(path: &Path, buf: &[u8]) -> Result<(), String> {
    let tmp_path = tmp_sibling(path);

    fs::write(&tmp_path, buf)
        .map_err(|e| format!("failed to write {}: {}", tmp_path.display(), e))?;

    fs::rename(&tmp_path, path).map_err(|e| {
        // Best-effort cleanup so a failed rename doesn't leave the .tmp around.
        let _ = fs::remove_file(&tmp_path);
        format!(
            "failed to rename {} to {}: {}",
            tmp_path.display(),
            path.display(),
            e
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tmp_sibling_preserves_full_filename_for_json() {
        // Existing .json writes must stage in the identical temp path as before.
        let p = Path::new("/games/install/Data/charms.json");
        assert_eq!(tmp_sibling(p), PathBuf::from("/games/install/Data/charms.json.tmp"));
    }

    #[test]
    fn tmp_sibling_uses_lua_extension_for_scripts() {
        // A .lua write must NOT produce a misleading .json.tmp sidecar.
        let p = Path::new("/games/install/Scripts/bite.lua");
        let tmp = tmp_sibling(p);
        assert_eq!(tmp, PathBuf::from("/games/install/Scripts/bite.lua.tmp"));
        assert!(!tmp.to_string_lossy().contains("json"));
    }
}
