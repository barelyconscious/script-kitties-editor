use std::{fs, path::Path, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, Dal},
    model::{Palette, PaletteColor},
};

/// Read and parse the palette at `path`, translating the engine's on-disk array of
/// {@link PaletteColor} into the editor's `name -> "r,g,b,a"` {@link Palette} map. A
/// MISSING file is a legitimate empty state — a fresh project simply has no named
/// colors yet — so it returns an empty `Palette` as `Ok`, NOT an error. (Contrast the
/// domain files, whose absence signals a broken install.) Any other read/parse
/// failure is an error. A duplicate name keeps the LAST entry (map semantics),
/// matching how the runtime's last-write-wins lookup would resolve it.
fn read_palette_from_disk(path: &Path) -> Result<Palette, String> {
    match fs::read_to_string(path) {
        Ok(contents) => {
            let colors: Vec<PaletteColor> = serde_json::from_str(&contents)
                .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;
            Ok(colors_to_palette(colors))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Palette::new()),
        Err(e) => Err(format!("failed to read {}: {}", path.display(), e)),
    }
}

/// Fold the on-disk color list into the editor's ordered `name -> code` map. Order is
/// preserved (IndexMap) so a re-save round-trips the file's order; a repeated name
/// overwrites, keeping the last occurrence.
fn colors_to_palette(colors: Vec<PaletteColor>) -> Palette {
    let mut palette = Palette::new();
    for c in colors {
        palette.insert(c.name, format!("{},{},{},{}", c.r, c.g, c.b, c.a));
    }
    palette
}

/// Expand the editor's `name -> "r,g,b,a"` map back into the on-disk color list, in
/// map (author) order. Codes come from the frontend already canonicalized to four
/// channels, but parsing is lenient anyway: missing/short channels default to 0, a
/// missing alpha to 255, and every channel is clamped to 0–255.
fn palette_to_colors(palette: &Palette) -> Vec<PaletteColor> {
    palette
        .iter()
        .map(|(name, code)| {
            let mut ch = code.split(',').map(|p| {
                p.trim()
                    .parse::<i64>()
                    .ok()
                    .map(|n| n.clamp(0, 255) as u8)
            });
            PaletteColor {
                name: name.clone(),
                r: ch.next().flatten().unwrap_or(0),
                g: ch.next().flatten().unwrap_or(0),
                b: ch.next().flatten().unwrap_or(0),
                a: ch.next().flatten().unwrap_or(255),
            }
        })
        .collect()
}

/// Serialize the color list in the engine's `palette.json` house style: one compact
/// object per line, 2-space indented, with a trailing newline — matching the format
/// the palette was authored in so editor saves produce a minimal diff rather than
/// reflowing the whole file. An empty palette serializes to `[]`.
fn serialize_palette(colors: &[PaletteColor]) -> Result<Vec<u8>, String> {
    if colors.is_empty() {
        return Ok(b"[]\n".to_vec());
    }
    let mut out = String::from("[\n");
    for (i, c) in colors.iter().enumerate() {
        // serde_json escapes the name exactly as a JSON string literal would.
        let name = serde_json::to_string(&c.name)
            .map_err(|e| format!("failed to serialize palette name: {}", e))?;
        out.push_str(&format!(
            "  {{ \"name\": {}, \"r\": {}, \"g\": {}, \"b\": {}, \"a\": {} }}",
            name, c.r, c.g, c.b, c.a
        ));
        out.push_str(if i + 1 < colors.len() { ",\n" } else { "\n" });
    }
    out.push_str("]\n");
    Ok(out.into_bytes())
}

impl Dal {
    fn palette_path(&self) -> PathBuf {
        self.data_dir().join("palette.json")
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

        // Translate to the on-disk color list (map order preserved) and write in the
        // engine's house style. atomic_write creates the file on first save, so a
        // fresh project's first palette write lands cleanly without a pre-existing file.
        let buf = serialize_palette(&palette_to_colors(&palette))?;
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
        let path = dir.join("palette.json");
        // Deliberately do NOT create the file (or even the dir).
        let result = read_palette_from_disk(&path);
        let palette = result.expect("missing file must be Ok, not Err");
        assert!(palette.is_empty(), "missing file must yield an empty palette");
    }

    #[test]
    fn parses_color_array_into_name_to_code_map() {
        let dir = std::env::temp_dir().join(format!("skp-palette-parse-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("palette.json");
        let mut f = fs::File::create(&path).unwrap();
        write!(
            f,
            r#"[
  {{ "name": "TextDefault", "r": 185, "g": 178, "b": 165, "a": 255 }},
  {{ "name": "PanelBg", "r": 0, "g": 0, "b": 0, "a": 200 }}
]"#
        )
        .unwrap();

        let palette = read_palette_from_disk(&path).unwrap();
        assert_eq!(palette.get("TextDefault").map(String::as_str), Some("185,178,165,255"));
        assert_eq!(palette.get("PanelBg").map(String::as_str), Some("0,0,0,200"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_writes_engine_array_format_and_round_trips_order() {
        // Insertion order, deliberately NOT alphabetical, must survive a
        // serialize -> read round trip so re-saves don't churn the file.
        let mut palette = Palette::new();
        palette.insert("Zebra".to_string(), "1,1,1,255".to_string());
        palette.insert("Apple".to_string(), "2,2,2,255".to_string());
        palette.insert("Mango".to_string(), "3,3,3,255".to_string());

        let dir = std::env::temp_dir().join(format!("skp-palette-order-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("palette.json");

        let buf = serialize_palette(&palette_to_colors(&palette)).unwrap();
        atomic_write(&path, &buf).unwrap();

        // The on-disk bytes are the engine's compact array format.
        let written = fs::read_to_string(&path).unwrap();
        assert_eq!(
            written,
            "[\n  { \"name\": \"Zebra\", \"r\": 1, \"g\": 1, \"b\": 1, \"a\": 255 },\n  \
             { \"name\": \"Apple\", \"r\": 2, \"g\": 2, \"b\": 2, \"a\": 255 },\n  \
             { \"name\": \"Mango\", \"r\": 3, \"g\": 3, \"b\": 3, \"a\": 255 }\n]\n"
        );

        let reloaded = read_palette_from_disk(&path).unwrap();
        let keys: Vec<&str> = reloaded.keys().map(String::as_str).collect();
        assert_eq!(keys, vec!["Zebra", "Apple", "Mango"], "key order must be preserved, not sorted");

        // Re-serializing the reloaded palette is byte-identical (minimal diff).
        let buf2 = serialize_palette(&palette_to_colors(&reloaded)).unwrap();
        assert_eq!(buf, buf2, "re-save of an untouched palette must be byte-identical");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_palette_serializes_to_empty_array() {
        let buf = serialize_palette(&palette_to_colors(&Palette::new())).unwrap();
        assert_eq!(String::from_utf8(buf).unwrap(), "[]\n");
    }

    #[test]
    fn code_missing_alpha_defaults_to_opaque_on_save() {
        // A three-channel code (no alpha) must serialize with a=255, and out-of-range
        // channels clamp into 0–255.
        let mut palette = Palette::new();
        palette.insert("NoAlpha".to_string(), "10,20,30".to_string());
        palette.insert("OverRange".to_string(), "300,-5,40,999".to_string());
        let colors = palette_to_colors(&palette);
        assert_eq!(colors[0].a, 255, "missing alpha must default to opaque");
        assert_eq!((colors[1].r, colors[1].g, colors[1].a), (255, 0, 255), "channels clamp to 0–255");
    }
}
