use std::{fs, path::Path, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, serialize_pretty, Dal},
    model::Palette,
};

/// Read and parse the palette at `path`. A MISSING file is a legitimate empty
/// state — a fresh project simply has no named colors yet — so it returns an
/// empty `Palette` as `Ok`, NOT an error. (Contrast the domain files, whose
/// absence signals a broken install.) Any other read/parse failure is an error.
fn read_palette_from_disk(path: &Path) -> Result<Palette, String> {
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Palette::new()),
        Err(e) => Err(format!("failed to read {}: {}", path.display(), e)),
    }
}

impl Dal {
    fn palette_path(&self) -> PathBuf {
        self.data_dir().join("gui_palette.json")
    }

    pub fn get_palette(&self) -> Result<Arc<Palette>, String> {
        if let Some(hit) = self.palette.get(&()) {
            return Ok(hit);
        }
        let palette = read_palette_from_disk(&self.palette_path())?;
        let arc = Arc::new(palette);
        self.palette.insert((), arc.clone());
        Ok(arc)
    }

    pub fn save_palette(&self, palette: Palette) -> Result<(), String> {
        let path = self.palette_path();

        // serialize_pretty over an IndexMap emits keys in insertion order, and
        // atomic_write creates the file on first save — so a fresh project's
        // first palette write lands cleanly without a pre-existing file.
        let buf = serialize_pretty(&palette)?;
        atomic_write(&path, &buf)?;

        self.palette.insert((), Arc::new(palette));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn missing_file_returns_empty_palette_ok() {
        // A path that does not exist must read as an empty palette, NOT an error.
        let dir = std::env::temp_dir().join(format!("skp-palette-missing-{}", std::process::id()));
        let path = dir.join("gui_palette.json");
        // Deliberately do NOT create the file (or even the dir).
        let result = read_palette_from_disk(&path);
        let palette = result.expect("missing file must be Ok, not Err");
        assert!(palette.is_empty(), "missing file must yield an empty palette");
    }

    #[test]
    fn parses_name_to_code_map() {
        let dir = std::env::temp_dir().join(format!("skp-palette-parse-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("gui_palette.json");
        let mut f = fs::File::create(&path).unwrap();
        write!(
            f,
            r#"{{"TextDefault":"185,178,165,255","PanelBg":"0,0,0,200"}}"#
        )
        .unwrap();

        let palette = read_palette_from_disk(&path).unwrap();
        assert_eq!(palette.get("TextDefault").map(String::as_str), Some("185,178,165,255"));
        assert_eq!(palette.get("PanelBg").map(String::as_str), Some("0,0,0,200"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_preserves_key_order_on_round_trip() {
        // Insertion order, deliberately NOT alphabetical, must survive a
        // serialize -> read round trip so re-saves don't churn the file.
        let mut palette = Palette::new();
        palette.insert("Zebra".to_string(), "1,1,1,255".to_string());
        palette.insert("Apple".to_string(), "2,2,2,255".to_string());
        palette.insert("Mango".to_string(), "3,3,3,255".to_string());

        let dir = std::env::temp_dir().join(format!("skp-palette-order-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("gui_palette.json");

        let buf = serialize_pretty(&palette).unwrap();
        // Creates the file on first write.
        atomic_write(&path, &buf).unwrap();

        let reloaded = read_palette_from_disk(&path).unwrap();
        let keys: Vec<&str> = reloaded.keys().map(String::as_str).collect();
        assert_eq!(keys, vec!["Zebra", "Apple", "Mango"], "key order must be preserved, not sorted");

        // And re-serializing the reloaded palette is byte-identical (minimal diff).
        let buf2 = serialize_pretty(&reloaded).unwrap();
        assert_eq!(buf, buf2, "re-save of an untouched palette must be byte-identical");

        fs::remove_dir_all(&dir).ok();
    }
}
