use serde_json::Value;
use std::{fs, path::Path};

use crate::dal::atomic_write;

// Editor-owned talent-tree design data (trees, clusters, editor notes). Committed
// alongside editor.registry.json and NOT read by the game yet. The frontend owns
// the schema (`src/lib/talentTree.ts` normalizes on load and canonicalizes on
// save), so the backend passes the document through as opaque JSON rather than
// mirroring it in Serde structs. See design/talent_tree.md.
const TALENTS_PATH: &str = "./editor.talents.json";

/// Load the talent document. A missing file is an empty document (it is created
/// on first save); a malformed one is an error so a hand-edit isn't clobbered.
pub fn read() -> Result<Value, String> {
    let path = Path::new(TALENTS_PATH);
    if !path.exists() {
        return Ok(serde_json::json!({ "version": 1, "seq": 0, "trees": [] }));
    }
    let contents = fs::read_to_string(path)
        .map_err(|e| format!("failed to read {}: {}", TALENTS_PATH, e))?;
    serde_json::from_str(&contents).map_err(|e| format!("failed to parse {}: {}", TALENTS_PATH, e))
}

/// Write the already-canonicalized document text atomically. Validates it is
/// JSON first so a frontend bug can never leave an unreadable file behind.
pub fn write(contents: &str) -> Result<(), String> {
    serde_json::from_str::<Value>(contents)
        .map_err(|e| format!("refusing to save invalid talent JSON: {}", e))?;
    atomic_write(Path::new(TALENTS_PATH), contents.as_bytes())
}
