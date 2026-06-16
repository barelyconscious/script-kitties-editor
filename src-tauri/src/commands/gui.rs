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

/// Read a GUI component's `.xml` body by its bare basename (resolved to
/// `{name}.xml` via the asset manifest). Returns `null` when no such component is
/// registered, an error when the manifest references a file that's missing on
/// disk (broken install), or the XML contents otherwise. This is the XML reader —
/// controller `.lua` text is read via `get_script`.
#[tauri::command]
pub fn get_component(name: String, dal: State<Dal>) -> Result<Option<String>, String> {
    dal.get_component(&name)
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

/// Create a brand-new GUI component: write its `.xml` (and optional controller
/// `.lua`) under `gui/<folderRel>/` and register BOTH in the asset manifest. This
/// is the first-time-creation door `save_component` refuses. `name` is the bare
/// basename; `folderRel` is the gui-relative destination (`""` = `gui/` root);
/// `controller`, when present, is `[filename, contents]`. Refuses (writing nothing)
/// if the basename already resolves ANYWHERE in the manifest (tree-wide uniqueness),
/// if the controller name already resolves, or if either file already exists on
/// disk. Files land first, both manifest inserts last; any failure rolls back to
/// zero residue.
#[tauri::command]
pub fn create_component(
    folder_rel: String,
    name: String,
    xml: String,
    controller: Option<(String, String)>,
    dal: State<Dal>,
) -> Result<(), String> {
    dal.create_component(&folder_rel, &name, xml, controller)
}

/// Create an empty GUI subfolder at `gui/<parentRel>/<name>`. Folders are not
/// assets, so this touches no manifest. Refuses if the directory already exists.
#[tauri::command]
pub fn create_folder(parent_rel: String, name: String, dal: State<Dal>) -> Result<(), String> {
    dal.create_folder(&parent_rel, &name)
}
