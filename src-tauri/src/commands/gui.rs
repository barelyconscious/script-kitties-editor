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
