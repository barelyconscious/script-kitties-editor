use std::{path::Path, sync::Arc};

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::dal::Dal;

impl Dal {
    /// Return a sprite as a `data:` URL ready to drop into an `<img src>`, or
    /// `None` when the sprite has no art on disk (absent from the manifest, or
    /// the referenced file is missing). Results are cached by name.
    pub fn get_sprite_data_url(&self, name: &str) -> Result<Option<String>, String> {
        if let Some(hit) = self.sprites.get(name) {
            return Ok((*hit).clone());
        }
        let result = self.load_sprite_data_url(name)?;
        self.sprites
            .insert(name.to_string(), Arc::new(result.clone()));
        Ok(result)
    }

    /// List the logical names of every `.png` sprite in the manifest, sorted.
    /// Backs the sprite picker. Keyed off the `.png` extension (not a folder) so
    /// art outside `Sprites/` — notably the GUI textures under `gui/` — is also
    /// pickable; the project only uses `.png` art, so other image formats are
    /// intentionally excluded.
    pub fn list_sprites(&self) -> Result<Vec<String>, String> {
        let manifest = self.get_asset_manifest()?;
        let mut names: Vec<String> = manifest
            .iter()
            .filter(|(_, entry)| entry.filepath.to_ascii_lowercase().ends_with(".png"))
            .map(|(name, _)| name.clone())
            .collect();
        names.sort();
        Ok(names)
    }

    fn load_sprite_data_url(&self, name: &str) -> Result<Option<String>, String> {
        let Some(path) = self.resolve_asset(name)? else {
            return Ok(None);
        };
        // A manifest entry can still point at a file that isn't there; treat a
        // read failure as "no art" rather than a hard error so the table renders.
        let Ok(bytes) = std::fs::read(&path) else {
            return Ok(None);
        };
        let encoded = STANDARD.encode(&bytes);
        Ok(Some(format!("data:{};base64,{}", mime_for(&path), encoded)))
    }
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        _ => "application/octet-stream",
    }
}
