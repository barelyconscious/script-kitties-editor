use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
};

use moka::sync::Cache;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{
    config::EditorConfig,
    model::{
        Ability, AssetEntry, Biogram, Bundle, Charm, Creature, Dlc, Effect, GuiFolder, Item,
        ItemDrop, Pack, Palette,
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
pub mod gui;
pub mod item_drops;
pub mod items;
pub mod packs;
pub mod palette;
pub mod scripts;
pub mod sprites;

/// The Tauri event name emitted to the frontend when anything under `gui/`
/// changes on disk (external editor, file move, etc.). The payload is the
/// gui-relative path of the changed file when it can be derived, else `null`
/// (a coarse "something under gui/ changed" signal). The XGUI editor listens
/// for this to live-reload an open component and refresh the component list.
pub const GUI_CHANGED_EVENT: &str = "gui-changed";

/// The Tauri event name emitted to the frontend when a `.png` under a watched
/// image root (`Sprites/` or `gui/`) changes on disk. Coarse — no payload —
/// because the frontend sprite cache is keyed by logical name and reverse-mapping
/// a changed path to its name(s) isn't worth it (one file can resolve under
/// multiple names via `resolve_asset`'s `<name>.png` fallback); the frontend
/// clears its whole cache. Emitted AFTER the Rust sprites cache is invalidated so
/// the frontend's re-fetch reads fresh bytes (mirrors the gui-changed ordering).
/// The editor never authors PNGs, so this is always a genuine external edit — no
/// self-echo dedup is needed (unlike gui-changed).
pub const SPRITES_CHANGED_EVENT: &str = "sprites-changed";

/// A shared slot holding the `AppHandle` the filesystem watcher emits through.
/// The watcher is built inside `Dal::new`, BEFORE the Tauri app (and thus its
/// `AppHandle`) exists, so the watcher captures this empty slot and the setup
/// hook fills it once the handle is available (see [`Dal::set_app_handle`]).
/// Until then, watcher fires simply invalidate caches without emitting.
type EmitSlot = Arc<Mutex<Option<AppHandle>>>;

pub struct Dal {
    // Config is mutable at runtime via `update_config`; readers take a snapshot
    // through a short-lived read lock so they don't hold it across file I/O.
    config: RwLock<EditorConfig>,
    // Shared with every watcher built for this Dal so a re-watch (config change)
    // keeps emitting through the same handle without re-plumbing setup.
    emit_slot: EmitSlot,
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
    // The GUI color palette (name -> "r,g,b,a"), from Data/gui_palette.json. A
    // single coarse cache unit under key `()`, like the per-domain caches above.
    pub(crate) palette: Cache<(), Arc<Palette>>,
    // The game's assets.json manifest (logical name -> on-disk path).
    pub(crate) manifest: Cache<(), Arc<HashMap<String, AssetEntry>>>,
    // Resolved sprite data URLs, keyed by logical sprite name.
    pub(crate) sprites: Cache<String, Arc<Option<String>>>,
    // Script file contents, keyed by logical script name. `None` = script-less
    // (name absent from the manifest); `Some` = file contents.
    pub(crate) scripts: Cache<String, Arc<Option<String>>>,
    // The whole `gui/` folder as one recursive tree (the component list source).
    // A single coarse cache unit under key `()` (manifest-style), invalidated
    // wholesale by the recursive `gui/` watch — the read model is a tree, so the
    // cache unit is the tree.
    pub(crate) gui_tree: Cache<(), Arc<GuiFolder>>,
    // A GUI component's `.xml` body, keyed by its bare basename (e.g. `bag`).
    // `None` = absent from the manifest (genuinely no such component); `Some` =
    // the file contents. Mirrors `scripts`, but reads `.xml` rather than `.lua`.
    pub(crate) components: Cache<String, Arc<Option<String>>>,
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
        let palette: Cache<(), Arc<Palette>> = Cache::builder().max_capacity(1).build();
        let manifest: Cache<(), Arc<HashMap<String, AssetEntry>>> =
            Cache::builder().max_capacity(1).build();
        let sprites: Cache<String, Arc<Option<String>>> =
            Cache::builder().max_capacity(1024).build();
        let scripts: Cache<String, Arc<Option<String>>> =
            Cache::builder().max_capacity(1024).build();
        let gui_tree: Cache<(), Arc<GuiFolder>> = Cache::builder().max_capacity(1).build();
        let components: Cache<String, Arc<Option<String>>> =
            Cache::builder().max_capacity(1024).build();

        let game_root = PathBuf::from(&config.game_install_path);
        let emit_slot: EmitSlot = Arc::new(Mutex::new(None));
        let watcher = build_watcher(
            &game_root, &abilities, &biograms, &charms, &creatures, &dlcs, &effects, &items,
            &item_drops, &bundles, &packs, &palette, &manifest, &sprites, &scripts, &gui_tree,
            &components, &emit_slot,
        )?;

        Ok(Self {
            config: RwLock::new(config),
            emit_slot,
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
            palette,
            manifest,
            sprites,
            scripts,
            gui_tree,
            components,
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
            &self.palette,
            &self.manifest,
            &self.sprites,
            &self.scripts,
            &self.gui_tree,
            &self.components,
            // Reuse the same slot so the rebuilt watcher keeps emitting through
            // the AppHandle the setup hook already installed.
            &self.emit_slot,
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
        self.palette.invalidate_all();
        self.manifest.invalidate_all();
        self.sprites.invalidate_all();
        self.scripts.invalidate_all();
        self.gui_tree.invalidate_all();
        self.components.invalidate_all();

        Ok(())
    }

    pub fn config(&self) -> EditorConfig {
        self.config.read().unwrap().clone()
    }

    /// Install the `AppHandle` the filesystem watcher emits frontend events
    /// through. Called once from the Tauri `setup` hook, after the app (and its
    /// handle) exists — the watcher itself is built earlier, in `Dal::new`, so it
    /// captures an initially-empty slot this fills in. Idempotent: a later call
    /// just replaces the stored handle.
    pub fn set_app_handle(&self, handle: AppHandle) {
        *self.emit_slot.lock().unwrap() = Some(handle);
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
    palette: &Cache<(), Arc<Palette>>,
    manifest: &Cache<(), Arc<HashMap<String, AssetEntry>>>,
    sprites: &Cache<String, Arc<Option<String>>>,
    scripts: &Cache<String, Arc<Option<String>>>,
    gui_tree: &Cache<(), Arc<GuiFolder>>,
    components: &Cache<String, Arc<Option<String>>>,
    emit_slot: &EmitSlot,
) -> Result<RecommendedWatcher, String> {
    let data_dir = game_root.join("Data");
    let scripts_dir = game_root.join("Scripts");
    let gui_dir = game_root.join("gui");
    let sprites_dir = game_root.join("Sprites");

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
        // The GUI palette lives under the already-watched Data/, so no new watch
        // is needed — just an exact-path invalidator like the domain files above.
        (data_dir.join("gui_palette.json"), {
            let c = palette.clone();
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

    // The `scripts` cache is keyed by a `.lua` file's logical name and is populated
    // by `get_script` for BOTH Scripts/ entity scripts (~134 `.lua`) AND gui/
    // controller `.lua` files. We can't cheaply map a changed file back to its
    // logical name, so ANY `.lua` change under a watched root invalidates the whole
    // scripts cache (wholesale, like sprites on an assets.json change). It must fire
    // for gui/ controllers too, not only Scripts/: a controller edited on disk is
    // read through the same `scripts` cache, and scoping this to Scripts/ left gui
    // controllers serving stale bytes forever (get_script never re-read them, so a
    // component switch "reloaded" stale contents and a later Save clobbered disk).
    let scripts_cache = scripts.clone();
    // The whole gui/ tree is a single coarse cache unit: any create/delete/edit
    // anywhere under gui/ (including nested folders) invalidates it wholesale, and
    // the next read re-walks. Captured separately from the exact-path invalidators,
    // like the Scripts/ wholesale rule.
    let gui_cache = gui_tree.clone();
    // Component `.xml` bodies are cached per-basename; like Scripts/, we can't
    // cheaply map a changed gui file back to its logical name, so any change under
    // gui/ invalidates the whole components cache wholesale.
    let components_cache = components.clone();
    let gui_dir_match = gui_dir.clone();
    // Sprite data URLs are cached per logical name and are fed by `.png` files under
    // BOTH Sprites/ (creature/item/charm/ability art) AND gui/ (GUI textures). A
    // same-path edit to an existing `.png` fires no domain/assets.json invalidator,
    // so it needs its own branch: any `.png` change under either root evicts the
    // whole sprites cache and signals the frontend. Wholesale eviction mirrors the
    // assets.json precedent and sidesteps reverse-mapping a path to its logical
    // name(s) (the `<name>.png` fallback makes that one-to-many).
    let sprites_cache = sprites.clone();
    let sprites_dir_match = sprites_dir.clone();
    // The handle the gui/ branch emits `gui-changed` through. Cloned into the
    // closure; empty until the setup hook installs the AppHandle, at which point
    // every subsequent gui/ change emits to the frontend.
    let emit_slot = emit_slot.clone();
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
            // Any `.lua` change under a watched root (Scripts/ entity scripts OR
            // gui/ controllers — both read through `get_script`) invalidates the
            // whole scripts cache. Runs before the gui/ branch's `gui-changed` emit
            // below, so the frontend's post-emit re-fetch reads fresh controller
            // bytes rather than the stale cache.
            if path.extension().and_then(|e| e.to_str()) == Some("lua") {
                scripts_cache.invalidate_all();
            }
            // Any change anywhere under gui/ (the recursive watch covers nested
            // folders) invalidates the single tree cache key and every cached
            // component body (wholesale, like the Scripts/ rule).
            if path.starts_with(&gui_dir_match) {
                gui_cache.invalidate(&());
                components_cache.invalidate_all();
                // Emit AFTER invalidation so the frontend's re-fetch (get_gui_tree
                // / get_component) reads fresh data, never the stale cache. The
                // payload is the gui-relative path (forward-slashed) so the editor
                // can tell whether the CURRENTLY-OPEN component changed; if the
                // path can't be made relative it falls back to `None` (a coarse
                // "something under gui/ changed" signal — the list still refreshes).
                if let Some(handle) = emit_slot.lock().unwrap().as_ref() {
                    let rel = gui_relative_path(&gui_dir_match, path);
                    let _ = handle.emit(GUI_CHANGED_EVENT, rel);
                }
            }
            // A `.png` edit under Sprites/ or gui/ evicts the whole sprites cache
            // and signals the frontend. Runs alongside (not instead of) the gui/
            // branch above: a gui texture change refreshes both the tree cache and
            // the sprite cache. Emit AFTER invalidation so the frontend's re-fetch
            // reads fresh bytes, mirroring the gui ordering.
            if is_sprite_change(path, &sprites_dir_match, &gui_dir_match) {
                sprites_cache.invalidate_all();
                if let Some(handle) = emit_slot.lock().unwrap().as_ref() {
                    let _ = handle.emit(SPRITES_CHANGED_EVENT, ());
                }
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

    // The gui/ folder is the app's one RECURSIVE watch: the component tree is
    // deeply nested (gui/profile/, gui/battle/, …), so a non-recursive watch would
    // miss edits inside subfolders — which is most of the tree. Best-effort: a
    // fresh project may not have gui/ yet (the read returns an empty root), and the
    // tree cache simply won't auto-freshen until the folder exists and is rewatched
    // on the next config update.
    let _ = watcher.watch(&gui_dir, RecursiveMode::Recursive);

    // Watch Sprites/ so an external `.png` edit refreshes on-screen art. This is a
    // TARGETED watch, NOT a whole-install recursion: the install root holds a
    // `cmake-build-debug-*` output dir that churns on every compile, so recursing
    // the root would flood events. Sprites/ is ~450 files but only ~2 directories,
    // and a watch registers paths (not bytes), so PNG size is irrelevant — one
    // coalesced FSEvents stream on macOS / 2 inotify descriptors on Linux. Sprites
    // are static art, so event throughput is ~zero except on a deliberate edit.
    // Best-effort: an install missing Sprites/ still starts (the cache just won't
    // auto-freshen until the folder exists and is rewatched on the next config
    // update). Recursive to catch any nested art subfolders.
    let _ = watcher.watch(&sprites_dir, RecursiveMode::Recursive);

    Ok(watcher)
}

/// True when `path` is a `.png` under one of the watched image roots (`Sprites/`
/// or `gui/`) — an edit that may have changed on-disk sprite bytes and so should
/// evict the sprites cache. Extracted from the watcher closure so the predicate is
/// unit-testable without a live filesystem watch.
fn is_sprite_change(path: &Path, sprites_dir: &Path, gui_dir: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()) == Some("png")
        && (path.starts_with(sprites_dir) || path.starts_with(gui_dir))
}

/// Derive the gui-relative, forward-slashed path of a changed file for the
/// `gui-changed` event payload. Returns `Some("widgets/bag.xml")` when `path`
/// lives under `gui_dir`, or `None` when it can't be made relative (a coarse
/// "something under gui/ changed" signal — the editor still refreshes the list).
/// Backslashes are normalized to `/` so the payload matches the gui-relative
/// `path` the frontend's `get_gui_tree` refs already use on every platform.
fn gui_relative_path(gui_dir: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(gui_dir)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
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
    fn gui_relative_path_strips_gui_dir_and_forward_slashes() {
        // A nested change yields the gui-relative path the frontend's tree refs use.
        let gui_dir = Path::new("/games/install/gui");
        let changed = Path::new("/games/install/gui/widgets/bag.xml");
        assert_eq!(
            gui_relative_path(gui_dir, changed),
            Some("widgets/bag.xml".to_string())
        );
    }

    #[test]
    fn gui_relative_path_handles_top_level_file() {
        let gui_dir = Path::new("/games/install/gui");
        let changed = Path::new("/games/install/gui/main.xml");
        assert_eq!(gui_relative_path(gui_dir, changed), Some("main.xml".to_string()));
    }

    #[test]
    fn gui_relative_path_returns_none_when_outside_gui_dir() {
        // A path not under gui/ can't be made relative → coarse signal (None).
        let gui_dir = Path::new("/games/install/gui");
        let changed = Path::new("/games/install/Data/items.json");
        assert_eq!(gui_relative_path(gui_dir, changed), None);
    }

    #[test]
    fn is_sprite_change_true_for_png_under_sprites_dir() {
        let sprites_dir = Path::new("/games/install/Sprites");
        let gui_dir = Path::new("/games/install/gui");
        let changed = Path::new("/games/install/Sprites/bitlynx.png");
        assert!(is_sprite_change(changed, sprites_dir, gui_dir));
    }

    #[test]
    fn is_sprite_change_true_for_png_under_gui_dir() {
        // GUI textures live under gui/ and feed the same sprite cache.
        let sprites_dir = Path::new("/games/install/Sprites");
        let gui_dir = Path::new("/games/install/gui");
        let changed = Path::new("/games/install/gui/kittypacks/panel_bg.png");
        assert!(is_sprite_change(changed, sprites_dir, gui_dir));
    }

    #[test]
    fn is_sprite_change_true_for_png_in_nested_sprites_subfolder() {
        let sprites_dir = Path::new("/games/install/Sprites");
        let gui_dir = Path::new("/games/install/gui");
        let changed = Path::new("/games/install/Sprites/creatures/bitlynx.png");
        assert!(is_sprite_change(changed, sprites_dir, gui_dir));
    }

    #[test]
    fn is_sprite_change_false_for_non_png() {
        // A `.lua`/`.xml` under gui/ is handled by other branches, not this one.
        let sprites_dir = Path::new("/games/install/Sprites");
        let gui_dir = Path::new("/games/install/gui");
        let changed = Path::new("/games/install/gui/kittypacks/bag.xml");
        assert!(!is_sprite_change(changed, sprites_dir, gui_dir));
    }

    #[test]
    fn is_sprite_change_false_for_png_outside_watched_roots() {
        // A `.png` under Data/ (or anywhere else) isn't sprite art we cache.
        let sprites_dir = Path::new("/games/install/Sprites");
        let gui_dir = Path::new("/games/install/gui");
        let changed = Path::new("/games/install/Data/whatever.png");
        assert!(!is_sprite_change(changed, sprites_dir, gui_dir));
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
