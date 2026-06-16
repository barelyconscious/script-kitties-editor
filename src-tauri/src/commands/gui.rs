use std::sync::Arc;

use tauri::State;

use crate::dal::Dal;
use crate::model::GuiFolder;

/// Read the `gui/` folder as a recursive tree for the component list: nested
/// folders mirroring the on-disk structure (empty folders included), each `.xml`
/// file as a lightweight ref carrying a `view`/`widget` kind (root-tag only) and
/// a sibling-controller hint. A missing `gui/` folder returns an empty root, not
/// an error.
#[tauri::command]
pub fn get_gui_tree(dal: State<Dal>) -> Result<Arc<GuiFolder>, String> {
    dal.get_gui_tree()
}

/// Save an already-registered component's `.xml` layout and (if present) its
/// controller `.lua` together — the GUI editor's manual Save. `name` is the bare
/// component basename (resolved to `{name}.xml` via the manifest); `controller`,
/// when present, is `[filename, contents]`. Writes the controller first, then the
/// XML; surfaces a single error if either write fails (so the caller keeps its
/// dirty state). Refuses any unregistered component or controller — creation is
/// `create_component`, not this — and never touches the manifest.
#[tauri::command]
pub fn save_component(
    name: String,
    xml: String,
    controller: Option<(String, String)>,
    dal: State<Dal>,
) -> Result<(), String> {
    dal.save_component(&name, xml, controller)
}
