use std::{fs, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, serialize_pretty, Dal},
    model::ArenaSurface,
};

impl Dal {
    fn arena_surfaces_path(&self) -> PathBuf {
        self.data_dir().join("arena_surfaces.json")
    }

    pub fn get_arena_surfaces(&self) -> Result<Arc<Vec<ArenaSurface>>, String> {
        if let Some(hit) = self.arena_surfaces.get(&()) {
            return Ok(hit);
        }
        // arena_surfaces.json is new and may not exist yet in an install (the
        // feature is still WIP in the engine) — treat a missing file as an empty
        // list rather than erroring, so the editor can author the first entry.
        let path = self.arena_surfaces_path();
        let list: Vec<ArenaSurface> = if path.exists() {
            let contents = fs::read_to_string(&path)
                .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
            serde_json::from_str(&contents)
                .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?
        } else {
            Vec::new()
        };
        let arc = Arc::new(list);
        self.arena_surfaces.insert((), arc.clone());
        Ok(arc)
    }

    pub fn save_arena_surface(&self, surface: ArenaSurface) -> Result<(), String> {
        let path = self.arena_surfaces_path();

        // Re-read from disk (tolerating a missing file) so we upsert into the
        // current contents rather than the possibly-stale cache. Surfaces are
        // keyed by `kind` (not `id` like other domains) — that's the engine's
        // lookup key — so the upsert and sort both use it.
        let mut list: Vec<ArenaSurface> = if path.exists() {
            let contents = fs::read_to_string(&path)
                .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
            serde_json::from_str(&contents)
                .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?
        } else {
            Vec::new()
        };

        if let Some(existing) = list.iter_mut().find(|s| s.kind == surface.kind) {
            *existing = surface;
        } else {
            list.push(surface);
        }
        list.sort_by(|a, b| a.kind.cmp(&b.kind));

        let buf = serialize_pretty(&list)?;
        atomic_write(&path, &buf)?;

        self.arena_surfaces.insert((), Arc::new(list));

        // Register-on-save: unlike the other domain files (which ship pre-catalogued
        // in a real install), `arena_surfaces.json` is new — the game feature is
        // still WIP — so the editor may be creating it for the first time. The
        // engine's `LoadJson` resolves through `assets.json`, so an unregistered
        // file would make `ArenaSurfaceDataTable::Load()` fail. Insert the manifest
        // entry on first write (mirroring the GUI editor's register-on-save) so the
        // game can load surfaces authored here without a manual manifest rescan.
        let manifest = self.get_asset_manifest()?;
        if !manifest.contains_key("arena_surfaces.json") {
            let updated =
                self.insert_manifest_entry("arena_surfaces.json", "Data\\arena_surfaces.json")?;
            self.manifest.insert((), Arc::new(updated));
        }

        Ok(())
    }
}
