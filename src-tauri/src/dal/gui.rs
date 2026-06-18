use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::dal::{atomic_write, Dal};
use crate::model::{GuiComponentKind, GuiComponentRef, GuiFolder};

impl Dal {
    /// The `gui/` folder of the configured install. Sibling of `Data/` and
    /// `Scripts/`, holding per-component `.xml` files and their controller
    /// `.lua` scripts, organized into arbitrary subfolders.
    pub(crate) fn gui_dir(&self) -> PathBuf {
        Path::new(&self.config().game_install_path).join("gui")
    }

    /// Read the whole `gui/` folder as a recursive tree: subfolders mirror the
    /// on-disk structure (empty folders included), each `.xml` file becomes a
    /// lightweight [`GuiComponentRef`] (root-tag classification + sibling
    /// controller detection — never a full body parse).
    ///
    /// The entire tree is cached as one `Arc<GuiFolder>` under the single key
    /// `()` (manifest-style), and invalidated wholesale by the recursive `gui/`
    /// watch on any change anywhere under the folder. A missing `gui/` folder is
    /// a legitimate empty state — it returns an empty root, not an error (a fresh
    /// project simply has no GUI components yet).
    pub fn get_gui_tree(&self) -> Result<Arc<GuiFolder>, String> {
        if let Some(hit) = self.gui_tree.get(&()) {
            return Ok(hit);
        }
        let tree = Arc::new(self.walk_gui_tree()?);
        self.gui_tree.insert((), tree.clone());
        Ok(tree)
    }

    /// Walk `gui/` from the root and build the nested tree. A missing root folder
    /// yields an empty root rather than an error.
    fn walk_gui_tree(&self) -> Result<GuiFolder, String> {
        let root = self.gui_dir();
        if !root.exists() {
            // Fresh project / no GUI authored yet — an empty root, not an error.
            return Ok(GuiFolder {
                name: String::new(),
                path: String::new(),
                folders: Vec::new(),
                components: Vec::new(),
            });
        }
        walk_folder(&root, "")
    }

    /// Read a GUI component's `.xml` body by its bare basename (`"bag"`), the
    /// value carried in a [`GuiComponentRef`]'s `name` and in a nested
    /// `<Component src="bag">`. The component is located through the **gui tree**
    /// (the on-disk walk) — the same source of truth the component list is built
    /// from — and read at its real on-disk path, so a component the list shows is
    /// always openable. Because component basenames are unique tree-wide (the B3
    /// guarantee), that lookup is unambiguous.
    ///
    /// The editor edits files that exist on disk, so the read gate is the
    /// filesystem, **not** the asset manifest: the manifest is a runtime
    /// `<Component src>` resolution concern, and the real game registers component
    /// `.lua` controllers but not their `.xml` files — gating the open path on the
    /// manifest made every existing component listable-but-unopenable. Reading by
    /// tree path reconciles the list and the open path onto the single on-disk
    /// truth.
    ///
    /// Mirrors [`Dal::get_script`]'s three-outcome discipline (it is the `.lua`
    /// reader; this is the `.xml` reader — controllers keep using `get_script`):
    ///
    /// - `Ok(None)` — no component with this basename exists anywhere in the gui
    ///   tree, so there is genuinely no such component. Not an error.
    /// - `Err(..)` — it is listed in the tree but the file is missing or unreadable
    ///   on disk (e.g. deleted out from under us between walk and read): surfaced
    ///   rather than handing back an editable blank a later save could materialize.
    /// - `Ok(Some(xml))` — located and read.
    ///
    /// Successful reads (`None` and `Some` alike) are cached by name. The not-found
    /// (`None`) and the read-error case are *not* cached, so a fixed/created
    /// install reads cleanly next call.
    pub fn get_component(&self, name: &str) -> Result<Option<String>, String> {
        if let Some(hit) = self.components.get(name) {
            return Ok((*hit).clone());
        }
        let result = self.load_component(name)?;
        // Only cache a positive hit. A `None` (genuinely absent) is left uncached so
        // that creating the component (which invalidates the tree, not necessarily
        // this cache key) reads cleanly on the next open without a stale `None`.
        if result.is_some() {
            self.components
                .insert(name.to_string(), Arc::new(result.clone()));
        }
        Ok(result)
    }

    fn load_component(&self, name: &str) -> Result<Option<String>, String> {
        // Locate the component by basename in the on-disk gui tree (the same source
        // the list uses), then read it at its real on-disk path. This is the read
        // gate — not the manifest — so a listed component is always openable.
        let tree = self.get_gui_tree()?;
        let Some(rel_path) = find_component_path(&tree, name) else {
            // No such component anywhere in the tree -> genuinely absent.
            return Ok(None);
        };
        let path = self.gui_path(&rel_path);
        // Listed in the tree but unreadable on disk (e.g. removed between walk and
        // read) -> surface it so the user isn't handed a phantom blank a save would
        // then create.
        let contents = std::fs::read_to_string(&path).map_err(|e| {
            format!(
                "component '{}' is listed in the gui tree at '{}' but could not be read at {}: {}",
                name,
                rel_path,
                path.display(),
                e
            )
        })?;
        Ok(Some(contents))
    }

    /// Absolute path to a gui-relative file path (`"abilityeditor/ability_editor.xml"`),
    /// joining each `/` segment under `gui/`. Used to read a component at the
    /// on-disk location the gui tree reports.
    fn gui_path(&self, rel_path: &str) -> PathBuf {
        let mut p = self.gui_dir();
        for segment in rel_path.split('/') {
            if !segment.is_empty() {
                p = p.join(segment);
            }
        }
        p
    }

    /// Save an **existing** component's `.xml` layout and, if present, its
    /// controller `.lua` — **registering either in `assets.json` on first save**
    /// (option A, "register-on-save"; design `xgui_ta.md`). This is the
    /// per-component "Save" of the GUI editor (design section 7).
    ///
    /// `name` is the component's bare basename (`"bag"`). The component is located
    /// through the **gui tree** (the on-disk walk) — the same source of truth the
    /// read path (`get_component`) and the component list use — NOT through the
    /// asset manifest. The `.xml` is written at its real on-disk path; the
    /// controller `.lua` (when `controller` is `Some((filename, contents))`) is
    /// written **alongside it** in the same folder, **creating the file if it does
    /// not exist yet** (the F10 Add-script case, where the `<View controller>` attr
    /// is set but no `.lua` was authored).
    ///
    /// **Why register-on-save (not manifest-gated).** Existing gui component `.xml`
    /// files are not in `assets.json` (the manifest walk only catalogues
    /// `.lua`/`.png`/`.json`, never `.xml`), so the old manifest-gated save refused
    /// every real component. Product intent is that gui files *must* be in
    /// `assets.json`, so saving now **registers** the `.xml` (and the controller)
    /// when absent rather than refusing. Registration is **register-if-absent**: an
    /// already-registered entry is never duplicated.
    ///
    /// **Save is still a separate door from create.** Like [`Dal::save_script`]
    /// versus [`Dal::create_script`], `save_component` does NOT create from scratch:
    /// a `name` that exists nowhere in the gui tree (no `.xml` on disk) is refused —
    /// first-time creation is [`Dal::create_component`]. What save *does* generalize
    /// is no longer requiring prior manifest registration.
    ///
    /// **Ordering + rollback (the `create_component` discipline).** File-bearing
    /// writes first; the rollback-able manifest inserts last and adjacent; zero
    /// residue on any failure. The only newly-materialized artifacts a failed save
    /// can leave are a brand-new controller file and freshly-inserted manifest
    /// entries — those are exactly what rollback removes. The `.xml` overwrite of an
    /// already-existing component is the intended persistence and is not "residue".
    /// 1. Write the controller `.lua` (if any) — atomic, self-cleaning on its own
    ///    failure. We record whether the controller file pre-existed so a later
    ///    rollback only deletes a file *this* save created.
    /// 2. Write the `.xml`. On failure, delete a newly-created controller, then
    ///    propagate.
    /// 3. Insert the `.xml` manifest entry if absent, then the controller entry if
    ///    absent — adjacent at the end. If either insert fails, remove any entry
    ///    inserted in this step and delete a newly-created controller, then propagate.
    /// 4. On success, seed the manifest cache and invalidate the gui tree.
    pub fn save_component(
        &self,
        name: &str,
        xml: String,
        controller: Option<(String, String)>,
    ) -> Result<(), String> {
        // Locate the component by basename in the on-disk gui tree (the read gate,
        // NOT the manifest). A name that exists nowhere in the tree is genuinely
        // nonexistent — save does not create from scratch (use create_component).
        let tree = self.get_gui_tree()?;
        let Some(rel_path) = find_component_path(&tree, name) else {
            return Err(format!(
                "refusing to save component '{name}': no '{name}.xml' exists in the gui tree. \
                 Save persists an existing component (use create_component to make a new one)."
            ));
        };

        let xml_name = format!("{name}.xml");
        let xml_path = self.gui_path(&rel_path);
        // The component's gui-relative folder (e.g. "profile/cards" for
        // "profile/cards/bag.xml", "" for a root-level "bag.xml"). The controller
        // lives here, alongside the .xml, and the manifest filepaths are built from it.
        let folder_rel = parent_rel(&rel_path);

        // Controller target (path + contents) and whether its file already exists —
        // a brand-new controller (Add-script) is created here; a pre-existing one is
        // overwritten. The pre-existence flag scopes rollback to only delete a file
        // this save created.
        let controller_target = controller.as_ref().map(|(file_name, contents)| {
            let path = self.gui_folder_path(&folder_rel).join(file_name);
            let pre_existed = path.exists();
            (file_name.clone(), path, contents.clone(), pre_existed)
        });

        // Which manifest entries are absent and must be inserted (register-if-absent).
        // Resolved BEFORE any write so step 3 only ever inserts a genuinely-missing key.
        let xml_needs_register = self.resolve_asset(&xml_name)?.is_none();
        let controller_needs_register = match &controller_target {
            Some((file_name, _, _, _)) => self.resolve_asset(file_name)?.is_none(),
            None => false,
        };

        // Step 1: write the controller first (the safe-to-land-first half), if any.
        // atomic_write self-cleans on its own failure, leaving zero residue.
        if let Some((_, path, contents, _)) = &controller_target {
            atomic_write(path, contents.as_bytes())?;
        }

        // Step 2: write the .xml. On failure, roll back a controller THIS save
        // created (never one that pre-existed), then propagate — zero residue.
        if let Err(e) = atomic_write(&xml_path, xml.as_bytes()) {
            if let Some((_, path, _, pre_existed)) = &controller_target {
                if !pre_existed {
                    let _ = std::fs::remove_file(path);
                }
            }
            return Err(e);
        }

        // Step 3: register absent entries — .xml first, then the controller, kept
        // adjacent at the end. Already-registered entries are skipped (no duplicate).
        // On failure, remove any entry inserted in this step and delete a
        // newly-created controller, then propagate — zero residue.
        let mut last_update = None;
        if xml_needs_register {
            let xml_filepath = gui_manifest_filepath(&folder_rel, &xml_name);
            match self.insert_manifest_entry(&xml_name, &xml_filepath) {
                Ok(updated) => last_update = Some(updated),
                Err(e) => {
                    if let Some((_, path, _, false)) = &controller_target {
                        let _ = std::fs::remove_file(path);
                    }
                    return Err(e);
                }
            }
        }
        if controller_needs_register {
            if let Some((file_name, path, _, pre_existed)) = &controller_target {
                let controller_filepath = gui_manifest_filepath(&folder_rel, file_name);
                match self.insert_manifest_entry(file_name, &controller_filepath) {
                    Ok(updated) => last_update = Some(updated),
                    Err(e) => {
                        // The .xml entry may have landed in this step — remove it so
                        // we never leave a manifest entry the rollback didn't undo.
                        if xml_needs_register {
                            let _ = self.remove_manifest_entry(&xml_name);
                        }
                        if !pre_existed {
                            let _ = std::fs::remove_file(path);
                        }
                        return Err(e);
                    }
                }
            }
        }

        // Step 4: if anything was registered, seed the manifest cache with the final
        // map and drop the gui tree cache (a newly-created controller changes the
        // tree's controller hint). When nothing was registered (already-registered
        // overwrite, no new controller file), there is nothing to refresh.
        if let Some(updated) = last_update {
            self.manifest.insert((), Arc::new(updated));
        }
        if controller_target
            .as_ref()
            .is_some_and(|(_, _, _, pre_existed)| !pre_existed)
        {
            self.gui_tree.invalidate(&());
        }
        Ok(())
    }

    /// Create a brand-new GUI component: write its `.xml` (and optional controller
    /// `.lua`) to disk and register BOTH in `assets.json`. This is the separate
    /// "first-time creation" door that [`Dal::save_component`] deliberately refuses
    /// — mirroring how [`Dal::create_script`] is kept distinct from `save_script`.
    /// (design `xgui_ta.md` section (1) "Create-component flow".)
    ///
    /// `name` is the bare basename without extension (`"bag_slot"`). `folder_rel`
    /// is the gui-relative destination folder (`""` for the `gui/` root, `"widgets"`,
    /// `"profile/cards"`, …); the `.xml` lands at
    /// `<gameInstallPath>/gui/<folder_rel>/<name>.xml`. `controller`, when `Some`, is
    /// `(filename, contents)` — e.g. `("bag_slot_controller.lua", "…")` — and is
    /// written as a sibling of the `.xml`. Manifest filepaths use the existing
    /// backslash convention (`gui\<folder_rel>\<name>.xml`).
    ///
    /// **Both the `.xml` AND the controller `.lua` get manifest entries** — the
    /// built-out runtime manifest-resolves both (product-confirmed), so the create
    /// flow registers both immediately rather than waiting on a bulk rescan.
    ///
    /// **Pre-flight no-clobber, with TREE-WIDE basename uniqueness.** Refuse before
    /// writing anything if `"{name}.xml"` already resolves ANYWHERE in the manifest
    /// (not merely within `folder_rel` — the manifest is basename-keyed, so two
    /// same-basename components in different folders would collide and make
    /// `<Component src>` ambiguous; design section (3)), or if the controller name
    /// already resolves, or if either target file already exists on disk.
    ///
    /// **Multi-write ordering and rollback — the `create_script` discipline, widened
    /// to two files + two manifest inserts.** The invariant: never leave a manifest
    /// entry pointing at no file, and never wedge the name so a retry is impossible.
    /// Files land first, both manifest inserts last and adjacent (least-rollback-able):
    /// 1. Write the controller `.lua` (if any). `atomic_write` self-cleans on its own
    ///    failure, so a failure here leaves zero residue — propagate.
    /// 2. Write the `.xml`. On failure, delete the controller from step 1 (best-effort),
    ///    then propagate — zero residue.
    /// 3. Insert the `.xml` manifest entry, then the controller entry (if any). If
    ///    either insert fails, remove any entry inserted in this step and delete both
    ///    files (best-effort), then propagate — zero residue, name not wedged.
    /// 4. On full success, seed the manifest cache with the inserts' result and
    ///    invalidate the gui tree cache so the new component lists without a watcher
    ///    round-trip.
    pub fn create_component(
        &self,
        folder_rel: &str,
        name: &str,
        xml: String,
        controller: Option<(String, String)>,
    ) -> Result<(), String> {
        let xml_name = format!("{name}.xml");

        // Pre-flight (a): TREE-WIDE basename uniqueness. Refuse if "{name}.xml"
        // already resolves through the manifest ANYWHERE — a same-basename file in a
        // *different* folder still collides on the basename-keyed manifest and would
        // make <Component src> ambiguous. This is stricter than a per-folder check.
        if self.resolve_asset(&xml_name)?.is_some() {
            return Err(format!(
                "refusing to create component '{name}': '{xml_name}' already resolves in the asset \
                 manifest (component basenames must be unique across the whole gui/ tree)."
            ));
        }

        // Pre-flight (b): if a controller is supplied, its name must be free too.
        if let Some((controller_file_name, _)) = &controller {
            if self.resolve_asset(controller_file_name)?.is_some() {
                return Err(format!(
                    "refusing to create component '{name}': controller '{controller_file_name}' \
                     already resolves in the asset manifest."
                ));
            }
        }

        // Resolve on-disk target paths.
        let folder_dir = self.gui_folder_path(folder_rel);
        let xml_path = folder_dir.join(&xml_name);
        let controller_path = controller
            .as_ref()
            .map(|(file_name, _)| folder_dir.join(file_name));

        // Pre-flight (c): never clobber an existing on-disk file (even one absent
        // from the manifest). Check both targets before writing anything.
        if xml_path.exists() {
            return Err(format!(
                "refusing to create component '{name}': a file already exists at {}.",
                xml_path.display()
            ));
        }
        if let Some(path) = &controller_path {
            if path.exists() {
                return Err(format!(
                    "refusing to create component '{name}': a controller file already exists at {}.",
                    path.display()
                ));
            }
        }

        // Manifest filepaths the entries will point at, in the install's backslash
        // convention: gui\<folder_rel-with-backslashes>\<file>.
        let xml_filepath = gui_manifest_filepath(folder_rel, &xml_name);

        // Ensure the destination folder exists before any write — atomic_write stages
        // a `.tmp` sibling and renames, so it needs the parent dir to already exist
        // (unlike create_script, which always writes into the pre-existing Scripts/).
        // create-in-place into the gui/ root on a fresh project, or into a folder the
        // user just made, are both legitimate. We deliberately do NOT track this dir
        // for rollback: an empty gui subfolder is a benign, legitimate state (it's
        // exactly what create_folder leaves) and carries nothing the runtime resolves,
        // and create_dir_all is idempotent so a retry is unaffected.
        std::fs::create_dir_all(&folder_dir)
            .map_err(|e| format!("failed to create folder {}: {}", folder_dir.display(), e))?;

        // Step 1: write the controller first (the safe-to-land-first half). On its
        // own failure atomic_write leaves nothing — propagate, zero residue.
        if let (Some(path), Some((_, contents))) = (&controller_path, &controller) {
            atomic_write(path, contents.as_bytes())?;
        }

        // Step 2: write the .xml. On failure, roll back step 1's controller (if any)
        // before propagating, so a failed create leaves zero residue.
        if let Err(e) = atomic_write(&xml_path, xml.as_bytes()) {
            if let Some(path) = &controller_path {
                let _ = std::fs::remove_file(path);
            }
            return Err(e);
        }

        // Step 3: insert the manifest entries — .xml first, then the controller (if
        // any), kept adjacent at the end. If either insert fails, roll back: remove
        // any entry inserted in this step, then delete both files, then propagate.
        let updated = match self.insert_manifest_entry(&xml_name, &xml_filepath) {
            Ok(updated) => updated,
            Err(e) => {
                // The .xml entry never landed; just delete both files.
                let _ = std::fs::remove_file(&xml_path);
                if let Some(path) = &controller_path {
                    let _ = std::fs::remove_file(path);
                }
                return Err(e);
            }
        };

        let updated = if let Some((controller_file_name, _)) = &controller {
            let controller_filepath = gui_manifest_filepath(folder_rel, controller_file_name);
            match self.insert_manifest_entry(controller_file_name, &controller_filepath) {
                Ok(updated) => updated,
                Err(e) => {
                    // The .xml entry DID land — remove it before deleting files so we
                    // never leave a manifest entry pointing at a deleted file (which
                    // would wedge the name against every retry).
                    let _ = self.remove_manifest_entry(&xml_name);
                    let _ = std::fs::remove_file(&xml_path);
                    if let Some(path) = &controller_path {
                        let _ = std::fs::remove_file(path);
                    }
                    return Err(e);
                }
            }
        } else {
            updated
        };

        // Step 4: all writes landed — seed the manifest cache with the final map and
        // drop the gui tree cache so the new component lists immediately.
        self.manifest.insert((), Arc::new(updated));
        self.gui_tree.invalidate(&());
        Ok(())
    }

    /// Create an empty GUI subfolder at `<gameInstallPath>/gui/<parent_rel>/<name>`
    /// via a plain `std::fs::create_dir`. Folders are **not** assets — they carry
    /// nothing the runtime resolves — so there is **no manifest involvement**.
    /// Refuses if the directory already exists. On success, invalidates the gui tree
    /// cache so the next read surfaces the (legitimately empty) folder.
    /// (design `xgui_ta.md` section (2) "Create-folder".)
    pub fn create_folder(&self, parent_rel: &str, name: &str) -> Result<(), String> {
        let dir = self.gui_folder_path(parent_rel).join(name);
        if dir.exists() {
            return Err(format!(
                "refusing to create folder '{name}': a directory already exists at {}.",
                dir.display()
            ));
        }
        // create_dir (not create_dir_all): the parent must already exist; a missing
        // parent is a real error worth surfacing, not silently materializing a chain.
        std::fs::create_dir(&dir)
            .map_err(|e| format!("failed to create folder {}: {}", dir.display(), e))?;
        self.gui_tree.invalidate(&());
        Ok(())
    }

    /// Absolute path to a gui-relative folder. `""` is the `gui/` root; otherwise the
    /// gui-relative path's `/` segments are joined under `gui/`.
    fn gui_folder_path(&self, folder_rel: &str) -> PathBuf {
        let mut dir = self.gui_dir();
        if !folder_rel.is_empty() {
            for segment in folder_rel.split('/') {
                dir = dir.join(segment);
            }
        }
        dir
    }
}

/// Build a manifest filepath for a file inside `gui/<folder_rel>/`, using the
/// install's Windows-style `\` separators regardless of host OS. `""` folder_rel
/// yields `gui\<file>`; `"profile/cards"` yields `gui\profile\cards\<file>`.
fn gui_manifest_filepath(folder_rel: &str, file_name: &str) -> String {
    if folder_rel.is_empty() {
        format!("gui\\{file_name}")
    } else {
        let folder = folder_rel.replace('/', "\\");
        format!("gui\\{folder}\\{file_name}")
    }
}

/// Find a component's gui-relative on-disk `path` by its bare basename, searching
/// the tree depth-first. Returns the first match (basenames are unique tree-wide,
/// so there is at most one) or `None` if no component carries that name.
fn find_component_path(folder: &GuiFolder, name: &str) -> Option<String> {
    for c in &folder.components {
        if c.name == name {
            return Some(c.path.clone());
        }
    }
    for sub in &folder.folders {
        if let Some(found) = find_component_path(sub, name) {
            return Some(found);
        }
    }
    None
}

/// The gui-relative parent folder of a gui-relative file path. `"bag.xml"` (a
/// root-level file) yields `""`; `"profile/cards/bag.xml"` yields
/// `"profile/cards"`. The inverse direction of [`join_rel`], used by
/// `save_component` to place a controller alongside its component and to build the
/// component's manifest filepath.
fn parent_rel(rel_path: &str) -> String {
    match rel_path.rsplit_once('/') {
        Some((parent, _)) => parent.to_string(),
        None => String::new(),
    }
}

/// Recursively read one folder at `dir` whose gui-relative path is `rel` (""
/// for the root). Directories are listed regardless of whether they contain any
/// `.xml`, so empty folders surface in the tree. Folders and components are each
/// sorted by name for a stable, deterministic listing.
fn walk_folder(dir: &Path, rel: &str) -> Result<GuiFolder, String> {
    let mut folders: Vec<GuiFolder> = Vec::new();
    let mut components: Vec<GuiComponentRef> = Vec::new();

    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("failed to read gui folder {}: {}", dir.display(), e))?;

    for entry in entries {
        let entry =
            entry.map_err(|e| format!("failed to read entry in {}: {}", dir.display(), e))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("failed to stat {}: {}", path.display(), e))?;

        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            // Non-UTF-8 names: skip rather than fail the whole walk.
            continue;
        };

        if file_type.is_dir() {
            let child_rel = join_rel(rel, file_name);
            folders.push(walk_folder(&path, &child_rel)?);
        } else if file_type.is_file() && has_xml_extension(file_name) {
            // Basename without the ".xml" extension.
            let stem = &file_name[..file_name.len() - ".xml".len()];
            let kind = classify_kind(&path)?;
            let controller_file_name = detect_controller(dir, stem);
            components.push(GuiComponentRef {
                name: stem.to_string(),
                file_name: file_name.to_string(),
                path: join_rel(rel, file_name),
                kind,
                controller_file_name,
            });
        }
    }

    // Stable ordering: folders and components each alphabetical by name.
    folders.sort_by(|a, b| a.name.cmp(&b.name));
    components.sort_by(|a, b| a.name.cmp(&b.name));

    let name = rel.rsplit('/').next().unwrap_or("").to_string();
    Ok(GuiFolder {
        name,
        path: rel.to_string(),
        folders,
        components,
    })
}

/// Join a gui-relative parent path with a child segment using `/` separators.
/// The root's empty path joins to just the child (no leading slash).
fn join_rel(parent: &str, child: &str) -> String {
    if parent.is_empty() {
        child.to_string()
    } else {
        format!("{parent}/{child}")
    }
}

/// Case-insensitive `.xml` extension check (avoids missing `.XML` on
/// case-preserving-but-insensitive filesystems).
fn has_xml_extension(file_name: &str) -> bool {
    Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("xml"))
}

/// Classify a component as a `view` or `widget` by peeking ONLY its root element
/// tag — NOT a full body parse. A component is a `view` iff the first XML element
/// tag is `View`; anything else is a `widget`. Reading the file is required (the
/// root tag is the one place the list read peeks inside a file).
///
/// A file that can't be read, or has no element tag at all, defaults to `widget`
/// — the list stays robust against a malformed/empty file rather than failing the
/// whole walk. The real root is reconciled when the component is opened.
fn classify_kind(path: &Path) -> Result<GuiComponentKind, String> {
    // The root tag is near the top; reading the whole (small) file is fine, but
    // a read failure shouldn't sink the listing — degrade to widget.
    let Ok(contents) = std::fs::read_to_string(path) else {
        return Ok(GuiComponentKind::Widget);
    };
    Ok(match root_element_tag(&contents).as_deref() {
        Some("View") => GuiComponentKind::View,
        _ => GuiComponentKind::Widget,
    })
}

/// Scan XML text for the name of the first *element* tag, skipping the optional
/// `<?xml …?>` declaration and `<!-- … -->` comments. Returns the tag name (e.g.
/// "View", "Panel") or `None` if no element tag is found. This is intentionally a
/// minimal scan, not a parser — it only needs the root tag for view/widget
/// classification.
fn root_element_tag(xml: &str) -> Option<String> {
    let bytes = xml.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // Find the next '<'.
        if bytes[i] != b'<' {
            i += 1;
            continue;
        }
        // Look at what follows the '<'.
        let next = bytes.get(i + 1).copied();
        match next {
            // XML declaration <?xml ...?> or processing instruction — skip to '>'.
            Some(b'?') => {
                i = find_byte(bytes, i + 2, b'>').map(|p| p + 1)?;
            }
            // Comment <!-- ... --> or doctype <! ... > — skip past it.
            Some(b'!') => {
                if bytes[i + 2..].starts_with(b"--") {
                    // Find the closing "-->".
                    i = find_subslice(bytes, i + 4, b"-->").map(|p| p + 3)?;
                } else {
                    i = find_byte(bytes, i + 2, b'>').map(|p| p + 1)?;
                }
            }
            // Anything else after '<' that's a name-start char begins an element.
            Some(c) if is_name_start(c) => {
                let start = i + 1;
                let mut j = start;
                while j < bytes.len() && is_name_char(bytes[j]) {
                    j += 1;
                }
                return std::str::from_utf8(&bytes[start..j]).ok().map(String::from);
            }
            // A stray '<' (e.g. malformed) — advance and keep scanning.
            _ => {
                i += 1;
            }
        }
    }
    None
}

/// Detect a sibling controller `{stem}_controller.lua` next to the component
/// `.xml` in the same directory. Returns the filename if it exists, else `None`.
/// This is the cheap list-time signal; the authoritative `<View controller=…>`
/// attribute is reconciled when the component is opened.
fn detect_controller(dir: &Path, stem: &str) -> Option<String> {
    let file_name = format!("{stem}_controller.lua");
    if dir.join(&file_name).is_file() {
        Some(file_name)
    } else {
        None
    }
}

/// XML name-start char (a deliberately small subset sufficient for the tag names
/// this editor authors: letters and `_`).
fn is_name_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_'
}

/// XML name char (after the first): name-start plus digits, `-`, and `.`.
fn is_name_char(c: u8) -> bool {
    is_name_start(c) || c.is_ascii_digit() || c == b'-' || c == b'.'
}

/// Index of the first `needle` byte at or after `from`, if any.
fn find_byte(haystack: &[u8], from: usize, needle: u8) -> Option<usize> {
    (from..haystack.len()).find(|&k| haystack[k] == needle)
}

/// Start index of the first occurrence of `needle` at or after `from`, if any.
fn find_subslice(haystack: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || from >= haystack.len() {
        return None;
    }
    (from..=haystack.len().saturating_sub(needle.len()))
        .find(|&k| haystack[k..k + needle.len()] == *needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use crate::config::EditorConfig;

    // ---- pure-function tests: root-tag scan + name classification ----

    #[test]
    fn root_tag_plain_view() {
        assert_eq!(
            root_element_tag("<View controller=\"x.lua\">\n  <Panel/>\n</View>").as_deref(),
            Some("View")
        );
    }

    #[test]
    fn root_tag_widget_panel() {
        assert_eq!(
            root_element_tag("<Panel id=\"root\"><Text/></Panel>").as_deref(),
            Some("Panel")
        );
    }

    #[test]
    fn root_tag_skips_xml_declaration() {
        assert_eq!(
            root_element_tag("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<View/>").as_deref(),
            Some("View")
        );
    }

    #[test]
    fn root_tag_skips_leading_comment() {
        assert_eq!(
            root_element_tag("<!-- a banner comment <View> mention -->\n<Panel/>").as_deref(),
            Some("Panel")
        );
    }

    #[test]
    fn root_tag_skips_decl_and_comment_together() {
        let xml = "<?xml version=\"1.0\"?>\n<!-- header -->\n<View></View>";
        assert_eq!(root_element_tag(xml).as_deref(), Some("View"));
    }

    #[test]
    fn root_tag_handles_leading_whitespace() {
        assert_eq!(root_element_tag("\n\n   <View/>").as_deref(), Some("View"));
    }

    #[test]
    fn root_tag_none_when_no_element() {
        assert_eq!(root_element_tag("just text, no tags"), None);
        assert_eq!(root_element_tag(""), None);
        assert_eq!(root_element_tag("<!-- only a comment -->"), None);
    }

    #[test]
    fn join_rel_root_has_no_leading_slash() {
        assert_eq!(join_rel("", "widgets"), "widgets");
        assert_eq!(join_rel("profile", "cards"), "profile/cards");
    }

    #[test]
    fn xml_extension_is_case_insensitive() {
        assert!(has_xml_extension("a.xml"));
        assert!(has_xml_extension("a.XML"));
        assert!(!has_xml_extension("a.lua"));
        assert!(!has_xml_extension("a"));
    }

    // ---- DAL integration tests: real folders on disk ----

    fn temp_install() -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "ske-gui-test-{}-{}-{}",
            std::process::id(),
            nanos,
            n
        ));
        // Dal::new's watcher expects Data/ and Scripts/.
        std::fs::create_dir_all(root.join("Data")).unwrap();
        std::fs::create_dir_all(root.join("Scripts")).unwrap();
        root
    }

    fn dal_for(root: &Path) -> Dal {
        // A minimal manifest so Dal::new and any resolve paths are happy.
        std::fs::write(root.join("assets.json"), "{}").unwrap();
        Dal::new(EditorConfig {
            game_install_path: root.to_string_lossy().to_string(),
        })
        .unwrap()
    }

    /// Build a Dal pointing at `root` with the given manifest JSON written out
    /// (for save_component, which resolves the component/controller through the
    /// manifest exactly like the runtime resolves `<Component src>`).
    fn dal_with_manifest(root: &Path, manifest_json: &str) -> Dal {
        std::fs::write(root.join("assets.json"), manifest_json).unwrap();
        Dal::new(EditorConfig {
            game_install_path: root.to_string_lossy().to_string(),
        })
        .unwrap()
    }

    /// Locate a subfolder by gui-relative path within a tree.
    fn folder_at<'a>(root: &'a GuiFolder, path: &str) -> Option<&'a GuiFolder> {
        if root.path == path {
            return Some(root);
        }
        for f in &root.folders {
            if let Some(found) = folder_at(f, path) {
                return Some(found);
            }
        }
        None
    }

    #[test]
    fn missing_gui_folder_returns_empty_root_not_error() {
        let root = temp_install();
        let dal = dal_for(&root);
        // No gui/ dir created.
        let tree = dal.get_gui_tree().unwrap();
        assert_eq!(tree.name, "");
        assert_eq!(tree.path, "");
        assert!(tree.folders.is_empty());
        assert!(tree.components.is_empty());
    }

    #[test]
    fn nested_tree_mirrors_on_disk_subfolders() {
        let root = temp_install();
        let gui = root.join("gui");
        std::fs::create_dir_all(gui.join("profile/cards")).unwrap();
        std::fs::create_dir_all(gui.join("battle")).unwrap();
        // Root-level view.
        std::fs::write(gui.join("bag.xml"), "<View><Panel/></View>").unwrap();
        // A widget nested two deep.
        std::fs::write(
            gui.join("profile/cards/bag_slot.xml"),
            "<Panel id=\"root\"/>",
        )
        .unwrap();

        let dal = dal_for(&root);
        let tree = dal.get_gui_tree().unwrap();

        // Root component present.
        assert_eq!(tree.components.len(), 1);
        let bag = &tree.components[0];
        assert_eq!(bag.name, "bag");
        assert_eq!(bag.file_name, "bag.xml");
        assert_eq!(bag.path, "bag.xml");
        assert_eq!(bag.kind, GuiComponentKind::View);

        // Subfolders mirror disk: profile (with cards), battle.
        let profile = folder_at(&tree, "profile").expect("profile folder");
        assert_eq!(profile.name, "profile");
        let cards = folder_at(&tree, "profile/cards").expect("profile/cards folder");
        assert_eq!(cards.name, "cards");
        assert_eq!(cards.components.len(), 1);
        let slot = &cards.components[0];
        assert_eq!(slot.name, "bag_slot");
        assert_eq!(slot.path, "profile/cards/bag_slot.xml");
        assert_eq!(slot.kind, GuiComponentKind::Widget);
    }

    #[test]
    fn empty_folders_appear_in_tree() {
        let root = temp_install();
        let gui = root.join("gui");
        // An empty folder with no .xml at all.
        std::fs::create_dir_all(gui.join("widgets")).unwrap();
        let dal = dal_for(&root);

        let tree = dal.get_gui_tree().unwrap();
        let widgets = folder_at(&tree, "widgets").expect("empty folder must still appear");
        assert!(widgets.components.is_empty());
        assert!(widgets.folders.is_empty());
    }

    #[test]
    fn controller_detected_by_sibling_convention() {
        let root = temp_install();
        let gui = root.join("gui");
        std::fs::create_dir_all(&gui).unwrap();
        std::fs::write(gui.join("bag.xml"), "<View/>").unwrap();
        std::fs::write(gui.join("bag_controller.lua"), "-- ctrl\n").unwrap();
        // A widget with NO controller sibling.
        std::fs::write(gui.join("plain.xml"), "<Panel/>").unwrap();

        let dal = dal_for(&root);
        let tree = dal.get_gui_tree().unwrap();

        let bag = tree.components.iter().find(|c| c.name == "bag").unwrap();
        assert_eq!(
            bag.controller_file_name.as_deref(),
            Some("bag_controller.lua")
        );
        let plain = tree.components.iter().find(|c| c.name == "plain").unwrap();
        assert_eq!(plain.controller_file_name, None);
    }

    #[test]
    fn classify_kind_view_vs_widget_with_decl_and_comment() {
        let root = temp_install();
        let gui = root.join("gui");
        std::fs::create_dir_all(&gui).unwrap();
        std::fs::write(
            gui.join("screen.xml"),
            "<?xml version=\"1.0\"?>\n<!-- top -->\n<View/>",
        )
        .unwrap();
        std::fs::write(gui.join("widget.xml"), "<Text text=\"hi\"/>").unwrap();
        // Empty/garbage file degrades to widget rather than failing the walk.
        std::fs::write(gui.join("garbage.xml"), "not xml at all").unwrap();

        let dal = dal_for(&root);
        let tree = dal.get_gui_tree().unwrap();
        let by = |n: &str| tree.components.iter().find(|c| c.name == n).unwrap().kind;
        assert_eq!(by("screen"), GuiComponentKind::View);
        assert_eq!(by("widget"), GuiComponentKind::Widget);
        assert_eq!(by("garbage"), GuiComponentKind::Widget);
    }

    #[test]
    fn tree_is_cached_then_invalidation_reflects_external_change() {
        let root = temp_install();
        let gui = root.join("gui");
        std::fs::create_dir_all(&gui).unwrap();
        std::fs::write(gui.join("one.xml"), "<View/>").unwrap();
        let dal = dal_for(&root);

        let first = dal.get_gui_tree().unwrap();
        assert_eq!(first.components.len(), 1);

        // Add a file directly on disk. Without invalidation the cache is stale.
        std::fs::write(gui.join("two.xml"), "<Panel/>").unwrap();
        let cached = dal.get_gui_tree().unwrap();
        assert_eq!(
            cached.components.len(),
            1,
            "cache must serve the pre-change tree until invalidated"
        );

        // Simulate the recursive watcher firing: invalidate the single tree key.
        dal.gui_tree.invalidate(&());
        let refreshed = dal.get_gui_tree().unwrap();
        assert_eq!(
            refreshed.components.len(),
            2,
            "next read after invalidation must re-walk and see the new file"
        );
    }

    // ---- save_component: two-file ordered save over registered components ----

    /// Manifest registering a `bag` component (`bag.xml`) and its controller
    /// (`bag_controller.lua`) under `gui/`, both backslash-pathed like the real
    /// manifest. Mirrors what `create_component` would have written.
    const BAG_MANIFEST: &str = r#"{
  "bag.xml": { "filepath": "gui\\bag.xml" },
  "bag_controller.lua": { "filepath": "gui\\bag_controller.lua" }
}"#;

    /// Write the on-disk pair `create_component` would have left, so a save has
    /// existing files to overwrite. Returns (xml_path, controller_path).
    fn seed_bag_files(root: &Path) -> (PathBuf, PathBuf) {
        let gui = root.join("gui");
        std::fs::create_dir_all(&gui).unwrap();
        let xml = gui.join("bag.xml");
        let ctrl = gui.join("bag_controller.lua");
        std::fs::write(&xml, "<View><Panel id=\"old\"/></View>").unwrap();
        std::fs::write(&ctrl, "-- old controller\n").unwrap();
        (xml, ctrl)
    }

    #[test]
    fn save_writes_both_files_in_order_for_a_registered_component() {
        let root = temp_install();
        let (xml_path, ctrl_path) = seed_bag_files(&root);
        let dal = dal_with_manifest(&root, BAG_MANIFEST);

        dal.save_component(
            "bag",
            "<View><Panel id=\"new\"/></View>".to_string(),
            Some(("bag_controller.lua".to_string(), "-- new controller\n".to_string())),
        )
        .unwrap();

        // Both files updated to the new contents.
        assert_eq!(
            std::fs::read_to_string(&xml_path).unwrap(),
            "<View><Panel id=\"new\"/></View>"
        );
        assert_eq!(
            std::fs::read_to_string(&ctrl_path).unwrap(),
            "-- new controller\n"
        );
        // No temp sidecar from either atomic_write.
        assert!(!root.join("gui").join("bag.xml.tmp").exists());
        assert!(!root.join("gui").join("bag_controller.lua.tmp").exists());
    }

    #[test]
    fn save_xml_only_when_no_controller_supplied() {
        let root = temp_install();
        let (xml_path, ctrl_path) = seed_bag_files(&root);
        let dal = dal_with_manifest(&root, BAG_MANIFEST);

        dal.save_component("bag", "<View id=\"x\"/>".to_string(), None)
            .unwrap();

        assert_eq!(std::fs::read_to_string(&xml_path).unwrap(), "<View id=\"x\"/>");
        // The controller is left untouched — a None controller is not a delete.
        assert_eq!(
            std::fs::read_to_string(&ctrl_path).unwrap(),
            "-- old controller\n"
        );
    }

    #[test]
    fn save_refuses_a_component_that_exists_nowhere_in_the_gui_tree() {
        let root = temp_install();
        // gui/ exists but the component is NOT on disk and NOT in the manifest.
        std::fs::create_dir_all(root.join("gui")).unwrap();
        let dal = dal_with_manifest(&root, r#"{}"#);

        let err = dal
            .save_component("ghost", "<View/>".to_string(), None)
            .expect_err("saving a component that exists nowhere must be refused");
        assert!(
            err.contains("ghost") && err.contains("ghost.xml"),
            "refusal should name the component, got: {err}"
        );

        // No file (or temp sidecar) may be created for a refused save — save never
        // creates from scratch (that is create_component's door).
        assert!(!root.join("gui").join("ghost.xml").exists());
        assert!(!root.join("gui").join("ghost.xml.tmp").exists());
        // Manifest untouched.
        assert!(manifest_keys(&root).is_empty());
    }

    #[test]
    fn save_registers_an_existing_on_disk_component_absent_from_the_manifest() {
        // The core register-on-save case: an existing component .xml on disk that is
        // NOT in assets.json (the real-game state — only .lua controllers are
        // catalogued). Saving must write it by its disk path AND register it.
        let root = temp_install();
        let nested = root.join("gui").join("abilityeditor");
        std::fs::create_dir_all(&nested).unwrap();
        let xml_path = nested.join("ability_editor.xml");
        std::fs::write(&xml_path, "<View id=\"old\"/>").unwrap();
        let dal = dal_with_manifest(&root, r#"{}"#);

        // Precondition: genuinely absent from the manifest.
        assert_eq!(dal.resolve_asset("ability_editor.xml").unwrap(), None);

        dal.save_component("ability_editor", "<View id=\"new\"/>".to_string(), None)
            .unwrap();

        // File written by its real on-disk (nested) path.
        assert_eq!(
            std::fs::read_to_string(&xml_path).unwrap(),
            "<View id=\"new\"/>"
        );
        // Now registered, pointing at the nested backslash path.
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join("assets.json")).unwrap())
                .unwrap();
        assert_eq!(
            v["ability_editor.xml"]["filepath"],
            serde_json::json!("gui\\abilityeditor\\ability_editor.xml")
        );
        // In-process resolution sees it immediately (manifest cache refreshed).
        assert_eq!(
            dal.resolve_asset("ability_editor.xml").unwrap(),
            Some(xml_path)
        );
    }

    #[test]
    fn save_creates_and_registers_a_brand_new_controller_alongside_the_component() {
        // The F10 Add-script case: the component exists on disk, but its controller
        // .lua does NOT exist yet. Saving must CREATE the .lua alongside the .xml and
        // register it.
        let root = temp_install();
        let gui = root.join("gui");
        std::fs::create_dir_all(&gui).unwrap();
        let xml_path = gui.join("bag.xml");
        std::fs::write(&xml_path, "<View controller=\"bag_controller.lua\"/>").unwrap();
        // Manifest already knows the .xml but not the (not-yet-existing) controller.
        let dal = dal_with_manifest(&root, r#"{ "bag.xml": { "filepath": "gui\\bag.xml" } }"#);

        let ctrl_path = gui.join("bag_controller.lua");
        assert!(!ctrl_path.exists(), "precondition: controller does not exist yet");

        dal.save_component(
            "bag",
            "<View controller=\"bag_controller.lua\"/>".to_string(),
            Some(("bag_controller.lua".to_string(), "-- fresh controller\n".to_string())),
        )
        .unwrap();

        // The controller file was created alongside the component with its contents.
        assert_eq!(
            std::fs::read_to_string(&ctrl_path).unwrap(),
            "-- fresh controller\n"
        );
        // And it was registered (the .xml entry was already present, not duplicated).
        let keys = manifest_keys(&root);
        assert_eq!(
            keys,
            vec!["bag.xml".to_string(), "bag_controller.lua".to_string()],
            "the new controller is appended; the pre-existing .xml entry stays unique"
        );
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join("assets.json")).unwrap())
                .unwrap();
        assert_eq!(
            v["bag_controller.lua"]["filepath"],
            serde_json::json!("gui\\bag_controller.lua")
        );
    }

    #[test]
    fn save_an_already_registered_component_overwrites_with_no_duplicate_entries() {
        // Both .xml and controller are already registered; saving overwrites both
        // files in place and adds NO new manifest entries (no duplicates).
        let root = temp_install();
        let (xml_path, ctrl_path) = seed_bag_files(&root);
        let dal = dal_with_manifest(&root, BAG_MANIFEST);

        let keys_before = manifest_keys(&root);

        dal.save_component(
            "bag",
            "<View id=\"after\"/>".to_string(),
            Some(("bag_controller.lua".to_string(), "-- after\n".to_string())),
        )
        .unwrap();

        // Files overwritten.
        assert_eq!(std::fs::read_to_string(&xml_path).unwrap(), "<View id=\"after\"/>");
        assert_eq!(std::fs::read_to_string(&ctrl_path).unwrap(), "-- after\n");

        // Manifest keys are byte-for-byte unchanged — no duplicate entries.
        let keys_after = manifest_keys(&root);
        assert_eq!(
            keys_before, keys_after,
            "an already-registered save must not add or duplicate manifest entries"
        );
        assert_eq!(
            keys_after,
            vec!["bag.xml".to_string(), "bag_controller.lua".to_string()]
        );
    }

    #[test]
    fn save_rolls_back_to_zero_residue_when_the_manifest_insert_fails() {
        // Forced failure on the register step (option-A's only rollback-able write):
        // an existing-but-unregistered component with a brand-new controller, where
        // the manifest is corrupt on disk so insert_manifest_entry fails. The
        // newly-created controller must be deleted and no manifest entry must land —
        // zero residue. (The .xml overwrite of the already-existing component is the
        // intended save, not residue.)
        let root = temp_install();
        let gui = root.join("gui");
        std::fs::create_dir_all(&gui).unwrap();
        std::fs::write(gui.join("bag.xml"), "<View id=\"old\"/>").unwrap();
        let dal = dal_with_manifest(&root, r#"{}"#);
        // Prime the manifest cache from the empty manifest so the register-if-absent
        // checks pass, then corrupt the on-disk file so the insert (which re-reads
        // raw) fails to parse.
        let _ = dal.resolve_asset("bag.xml").unwrap();
        std::fs::write(root.join("assets.json"), "{ not valid json").unwrap();

        let ctrl_path = gui.join("bag_controller.lua");
        let err = dal
            .save_component(
                "bag",
                "<View id=\"new\"/>".to_string(),
                Some(("bag_controller.lua".to_string(), "-- ctrl\n".to_string())),
            )
            .expect_err("a manifest insert over a corrupt file must fail");
        assert!(
            err.contains("assets.json") || err.to_lowercase().contains("parse"),
            "error should describe the manifest failure, got: {err}"
        );

        // Zero residue: the brand-new controller created in step 1 was rolled back.
        assert!(
            !ctrl_path.exists(),
            "a failed register must delete the controller this save created"
        );
        assert!(!gui.join("bag_controller.lua.tmp").exists());
        // No manifest entry landed (the file is still the corrupt placeholder).
        assert_eq!(
            std::fs::read_to_string(root.join("assets.json")).unwrap(),
            "{ not valid json"
        );
    }

    #[test]
    fn save_rolls_back_the_xml_entry_when_the_controller_insert_fails() {
        // Both .xml and controller need registering; the .xml insert lands, then the
        // controller insert collides on a duplicate key planted on disk. The
        // just-inserted .xml entry must be removed and the brand-new controller file
        // deleted — zero residue, no half-registered pair.
        let root = temp_install();
        let gui = root.join("gui");
        std::fs::create_dir_all(&gui).unwrap();
        std::fs::write(gui.join("bag.xml"), "<View id=\"old\"/>").unwrap();
        let dal = dal_with_manifest(&root, r#"{}"#);
        // Prime the cache from the empty manifest so both register-if-absent checks
        // see "absent", then plant the controller key on disk so the SECOND insert
        // (the controller) collides on a duplicate.
        let _ = dal.resolve_asset("bag.xml").unwrap();
        let _ = dal.resolve_asset("bag_controller.lua").unwrap();
        std::fs::write(
            root.join("assets.json"),
            r#"{ "bag_controller.lua": { "filepath": "gui\\bag_controller.lua" } }"#,
        )
        .unwrap();

        let ctrl_path = gui.join("bag_controller.lua");
        let err = dal
            .save_component(
                "bag",
                "<View id=\"new\"/>".to_string(),
                Some(("bag_controller.lua".to_string(), "-- ctrl\n".to_string())),
            )
            .expect_err("a duplicate controller key on the second insert must fail");
        assert!(err.contains("bag_controller.lua"), "got: {err}");

        // The .xml entry inserted before the failed controller insert was rolled back:
        // the manifest holds only the pre-existing controller key, never bag.xml.
        assert_eq!(
            manifest_keys(&root),
            vec!["bag_controller.lua".to_string()],
            "the .xml entry must be removed when the controller insert fails"
        );
        // The brand-new controller file was deleted — zero residue.
        assert!(!ctrl_path.exists(), "a failed register must delete the new controller");
    }

    // ---- create_component: two files + two manifest entries, ordered, rollback ----

    /// Read the on-disk manifest as an ordered key list (preserve_order keeps file
    /// order) so tests can assert adjacency and append-at-end.
    fn manifest_keys(root: &Path) -> Vec<String> {
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join("assets.json")).unwrap())
                .unwrap();
        v.as_object().unwrap().keys().cloned().collect()
    }

    #[test]
    fn create_writes_both_files_and_both_adjacent_manifest_entries_last() {
        let root = temp_install();
        // A pre-existing manifest entry so we can assert the two new keys append at
        // the end, adjacent, after the existing one.
        let dal = dal_with_manifest(
            &root,
            r#"{ "item_bandage.png": { "filepath": "Sprites\\item_bandage.png" } }"#,
        );

        dal.create_component(
            "widgets",
            "bag_slot",
            "<Panel id=\"root\"/>".to_string(),
            Some((
                "bag_slot_controller.lua".to_string(),
                "-- ctrl\n".to_string(),
            )),
        )
        .unwrap();

        // Both files written under gui/widgets/, no temp sidecars.
        let gui = root.join("gui").join("widgets");
        assert_eq!(
            std::fs::read_to_string(gui.join("bag_slot.xml")).unwrap(),
            "<Panel id=\"root\"/>"
        );
        assert_eq!(
            std::fs::read_to_string(gui.join("bag_slot_controller.lua")).unwrap(),
            "-- ctrl\n"
        );
        assert!(!gui.join("bag_slot.xml.tmp").exists());
        assert!(!gui.join("bag_slot_controller.lua.tmp").exists());

        // Both manifest entries appended LAST and ADJACENT, .xml before controller,
        // with backslash filepaths under gui\widgets\.
        let keys = manifest_keys(&root);
        assert_eq!(
            keys,
            vec![
                "item_bandage.png".to_string(),
                "bag_slot.xml".to_string(),
                "bag_slot_controller.lua".to_string(),
            ],
            "the two new keys must be appended last, adjacent, xml then controller"
        );
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join("assets.json")).unwrap())
                .unwrap();
        assert_eq!(
            v["bag_slot.xml"]["filepath"],
            serde_json::json!("gui\\widgets\\bag_slot.xml")
        );
        assert_eq!(
            v["bag_slot_controller.lua"]["filepath"],
            serde_json::json!("gui\\widgets\\bag_slot_controller.lua")
        );

        // Resolution sees both immediately (manifest cache refreshed in-process).
        assert_eq!(
            dal.resolve_asset("bag_slot.xml").unwrap(),
            Some(gui.join("bag_slot.xml"))
        );
        assert_eq!(
            dal.resolve_asset("bag_slot_controller.lua").unwrap(),
            Some(gui.join("bag_slot_controller.lua"))
        );

        // The new component surfaces in the gui tree (cache was invalidated).
        let tree = dal.get_gui_tree().unwrap();
        let widgets = folder_at(&tree, "widgets").expect("widgets folder");
        let slot = widgets
            .components
            .iter()
            .find(|c| c.name == "bag_slot")
            .expect("new component must list");
        assert_eq!(slot.kind, GuiComponentKind::Widget);
        assert_eq!(
            slot.controller_file_name.as_deref(),
            Some("bag_slot_controller.lua")
        );
    }

    #[test]
    fn create_at_root_with_no_controller_registers_only_the_xml() {
        let root = temp_install();
        let dal = dal_with_manifest(&root, r#"{}"#);

        dal.create_component("", "screen", "<View/>".to_string(), None)
            .unwrap();

        // .xml at the gui/ root, registered as gui\screen.xml.
        let xml_path = root.join("gui").join("screen.xml");
        assert_eq!(std::fs::read_to_string(&xml_path).unwrap(), "<View/>");
        let keys = manifest_keys(&root);
        assert_eq!(keys, vec!["screen.xml".to_string()]);
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join("assets.json")).unwrap())
                .unwrap();
        assert_eq!(
            v["screen.xml"]["filepath"],
            serde_json::json!("gui\\screen.xml")
        );
    }

    #[test]
    fn create_refuses_basename_collision_across_a_different_folder() {
        let root = temp_install();
        // bag_slot.xml ALREADY exists in widgets/, registered in the manifest.
        let dal = dal_with_manifest(
            &root,
            r#"{ "bag_slot.xml": { "filepath": "gui\\widgets\\bag_slot.xml" } }"#,
        );

        // Attempt to create bag_slot in a DIFFERENT folder (screens/). Tree-wide
        // basename uniqueness must refuse this even though screens/ has no such file.
        let err = dal
            .create_component("screens", "bag_slot", "<Panel/>".to_string(), None)
            .expect_err("a basename collision in a DIFFERENT folder must be refused");
        assert!(
            err.contains("bag_slot"),
            "refusal should name the component, got: {err}"
        );

        // Nothing written into the (would-be) target folder, manifest unchanged.
        assert!(!root.join("gui").join("screens").join("bag_slot.xml").exists());
        let keys = manifest_keys(&root);
        assert_eq!(keys, vec!["bag_slot.xml".to_string()]);
    }

    #[test]
    fn create_refuses_when_controller_name_already_resolves() {
        let root = temp_install();
        // The controller name is taken (elsewhere); the .xml basename is free.
        let dal = dal_with_manifest(
            &root,
            r#"{ "shared_controller.lua": { "filepath": "gui\\shared_controller.lua" } }"#,
        );

        let err = dal
            .create_component(
                "widgets",
                "fresh",
                "<Panel/>".to_string(),
                Some(("shared_controller.lua".to_string(), "-- x\n".to_string())),
            )
            .expect_err("a controller name that already resolves must be refused");
        assert!(err.contains("shared_controller.lua"), "got: {err}");

        // Pre-flight refusal: no .xml written, manifest unchanged.
        assert!(!root.join("gui").join("widgets").join("fresh.xml").exists());
        assert_eq!(manifest_keys(&root), vec!["shared_controller.lua".to_string()]);
    }

    #[test]
    fn create_refuses_when_xml_file_already_exists_on_disk() {
        let root = temp_install();
        // File exists on disk but is NOT in the manifest.
        let gui = root.join("gui");
        std::fs::create_dir_all(&gui).unwrap();
        std::fs::write(gui.join("ghost.xml"), "<View id=\"old\"/>").unwrap();
        let dal = dal_with_manifest(&root, r#"{}"#);

        let err = dal
            .create_component("", "ghost", "<View id=\"new\"/>".to_string(), None)
            .expect_err("creating over an existing on-disk .xml must be refused");
        assert!(err.contains("ghost"), "got: {err}");

        // Existing file untouched, no manifest entry, no temp sidecar.
        assert_eq!(
            std::fs::read_to_string(gui.join("ghost.xml")).unwrap(),
            "<View id=\"old\"/>"
        );
        assert!(manifest_keys(&root).is_empty());
        assert!(!gui.join("ghost.xml.tmp").exists());
    }

    #[test]
    fn create_rolls_back_when_second_controller_insert_fails_via_duplicate_key() {
        // Exercise the step-3 SECOND-insert rollback branch specifically: the .xml
        // manifest entry lands, then the controller insert fails — and we must remove
        // the just-inserted .xml entry AND delete both files, leaving zero residue and
        // an un-wedged, retryable name.
        //
        // Construction: prime the in-process manifest cache from a manifest where the
        // controller key is ABSENT (so the pre-flight controller no-clobber passes),
        // then write to disk a manifest where the controller key IS present. Step 3's
        // first insert (the .xml) re-reads disk, succeeds, and rewrites the file
        // (still containing the controller key). The second insert (the controller)
        // re-reads disk and refuses the now-duplicate controller key — the deterministic
        // second-step failure we want.
        let root = temp_install();
        let dal = dal_with_manifest(&root, r#"{}"#);
        // Prime the cache with the empty manifest so both pre-flight guards pass.
        let _ = dal.resolve_asset("card.xml").unwrap();
        let _ = dal.resolve_asset("card_controller.lua").unwrap();
        // Now plant the controller key on disk so the SECOND insert collides.
        std::fs::write(
            root.join("assets.json"),
            r#"{ "card_controller.lua": { "filepath": "gui\\widgets\\card_controller.lua" } }"#,
        )
        .unwrap();

        let err = dal
            .create_component(
                "widgets",
                "card",
                "<Panel/>".to_string(),
                Some(("card_controller.lua".to_string(), "-- c\n".to_string())),
            )
            .expect_err("a duplicate controller key on the second insert must fail");
        assert!(
            err.contains("card_controller.lua"),
            "error should name the colliding controller, got: {err}"
        );

        // Zero file residue: both files deleted by the step-3 rollback.
        let gui = root.join("gui").join("widgets");
        assert!(!gui.join("card.xml").exists(), "no orphan .xml");
        assert!(
            !gui.join("card_controller.lua").exists(),
            "no orphan controller"
        );

        // The just-inserted .xml entry was REMOVED — the manifest holds only the
        // pre-existing controller key, never the card.xml key.
        let keys = manifest_keys(&root);
        assert_eq!(
            keys,
            vec!["card_controller.lua".to_string()],
            "the .xml entry inserted before the failed controller insert must be rolled back"
        );

        // The name is not wedged: clearing the planted collision lets a retry land
        // the whole component cleanly.
        std::fs::write(root.join("assets.json"), "{}").unwrap();
        dal.manifest.invalidate_all();
        dal.create_component(
            "widgets",
            "card",
            "<Panel/>".to_string(),
            Some(("card_controller.lua".to_string(), "-- c\n".to_string())),
        )
        .expect("retry after second-insert rollback must succeed");
        assert_eq!(
            manifest_keys(&root),
            vec!["card.xml".to_string(), "card_controller.lua".to_string()]
        );
    }

    #[test]
    fn create_rolls_back_both_files_when_first_xml_insert_fails() {
        // Step-3 FIRST-insert failure: corrupt the on-disk manifest after priming the
        // cache so the pre-flight guards pass, then the .xml insert (which re-reads
        // the raw file) fails to parse it. Both files must be deleted, no entry added,
        // and the name must remain retryable.
        let root = temp_install();
        let dal = dal_with_manifest(
            &root,
            r#"{ "item_bandage.png": { "filepath": "Sprites\\item_bandage.png" } }"#,
        );
        let _ = dal.resolve_asset("item_bandage.png").unwrap();
        std::fs::write(root.join("assets.json"), "{ this is not valid json").unwrap();

        let err = dal
            .create_component(
                "widgets",
                "card",
                "<Panel/>".to_string(),
                Some(("card_controller.lua".to_string(), "-- c\n".to_string())),
            )
            .expect_err("manifest insert over a corrupt file must fail");
        assert!(
            err.contains("assets.json") || err.to_lowercase().contains("parse"),
            "error should describe the manifest failure, got: {err}"
        );

        // Zero residue: neither file remains (step 3 rollback deleted both).
        let gui = root.join("gui").join("widgets");
        assert!(!gui.join("card.xml").exists(), "no orphan .xml");
        assert!(
            !gui.join("card_controller.lua").exists(),
            "no orphan controller"
        );
        assert!(!gui.join("card.xml.tmp").exists());
        assert!(!gui.join("card_controller.lua.tmp").exists());

        // The name is not wedged: restore a valid manifest, invalidate the primed
        // cache, and a retry of the SAME name succeeds end-to-end.
        std::fs::write(
            root.join("assets.json"),
            r#"{ "item_bandage.png": { "filepath": "Sprites\\item_bandage.png" } }"#,
        )
        .unwrap();
        dal.manifest.invalidate_all();

        dal.create_component(
            "widgets",
            "card",
            "<Panel/>".to_string(),
            Some(("card_controller.lua".to_string(), "-- c\n".to_string())),
        )
        .expect("retry after rollback must succeed — the name must not be wedged");

        assert_eq!(
            std::fs::read_to_string(gui.join("card.xml")).unwrap(),
            "<Panel/>"
        );
        let keys = manifest_keys(&root);
        assert_eq!(
            keys,
            vec![
                "item_bandage.png".to_string(),
                "card.xml".to_string(),
                "card_controller.lua".to_string(),
            ]
        );
    }

    #[test]
    fn create_rolls_back_when_xml_write_fails_leaving_no_controller() {
        // Step-2 failure: the .xml write fails (its parent path is occupied by a
        // FILE where create_component needs a directory), so the controller written
        // in step 1 must be rolled back. We make gui/<folder> a file so creating
        // gui/<folder>/<name>.xml fails, while the controller (same folder) also
        // can't be written — so to isolate step 2 we instead occupy only the .xml's
        // immediate parent for the xml and let the controller live in a writable
        // sibling. Simplest reliable construction: make the controller succeed by
        // putting the component at the root, and force the .xml write to fail by
        // pre-creating a DIRECTORY at the .xml's path (a dir can't be atomically
        // replaced by a file rename on the same path).
        let root = temp_install();
        let gui = root.join("gui");
        std::fs::create_dir_all(&gui).unwrap();
        // Occupy the .xml target path with a directory: atomic_write's final rename
        // onto this path fails. The controller path is a normal free file.
        std::fs::create_dir_all(gui.join("blocked.xml")).unwrap();
        let dal = dal_with_manifest(&root, r#"{}"#);

        let err = dal
            .create_component(
                "",
                "blocked",
                "<View/>".to_string(),
                Some((
                    "blocked_controller.lua".to_string(),
                    "-- ctrl\n".to_string(),
                )),
            )
            .expect_err("a failed .xml write must surface an error");
        assert!(!err.is_empty());

        // The controller written in step 1 was rolled back (deleted) — zero residue
        // apart from the directory we planted as the fault.
        assert!(
            !gui.join("blocked_controller.lua").exists(),
            "step-2 failure must roll back the step-1 controller"
        );
        assert!(!gui.join("blocked_controller.lua.tmp").exists());
        // No manifest entry was added (we never reached step 3).
        assert!(manifest_keys(&root).is_empty());
    }

    // ---- create_folder: empty dir, no manifest, refuse-if-exists ----

    #[test]
    fn create_folder_makes_empty_dir_surfaced_by_next_tree_read() {
        let root = temp_install();
        // gui/ root must exist for create_dir (not create_dir_all) to place a child.
        std::fs::create_dir_all(root.join("gui")).unwrap();
        let dal = dal_for(&root);

        // Prime the tree cache (so we also prove invalidation refreshes it).
        let _ = dal.get_gui_tree().unwrap();

        dal.create_folder("", "newfolder").unwrap();

        // The dir exists on disk and is empty.
        let dir = root.join("gui").join("newfolder");
        assert!(dir.is_dir());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);

        // The next tree read surfaces it (cache was invalidated).
        let tree = dal.get_gui_tree().unwrap();
        let f = folder_at(&tree, "newfolder").expect("new empty folder must list");
        assert!(f.components.is_empty());
        assert!(f.folders.is_empty());

        // No manifest involvement: assets.json is untouched.
        assert_eq!(
            std::fs::read_to_string(root.join("assets.json")).unwrap(),
            "{}"
        );
    }

    #[test]
    fn create_folder_nested_under_existing_parent() {
        let root = temp_install();
        std::fs::create_dir_all(root.join("gui").join("profile")).unwrap();
        let dal = dal_for(&root);

        dal.create_folder("profile", "cards").unwrap();

        let tree = dal.get_gui_tree().unwrap();
        let cards = folder_at(&tree, "profile/cards").expect("nested folder must list");
        assert_eq!(cards.name, "cards");
        assert_eq!(cards.path, "profile/cards");
    }

    // ---- get_component: XML body read with the three-outcome discipline ----

    #[test]
    fn get_component_returns_xml_for_a_component_on_disk() {
        let root = temp_install();
        let gui = root.join("gui");
        std::fs::create_dir_all(&gui).unwrap();
        std::fs::write(gui.join("bag.xml"), "<View><Panel id=\"x\"/></View>").unwrap();
        let dal = dal_for(&root);

        // Queried by BARE basename ("bag"); located in the gui tree and read at its
        // on-disk path — no manifest entry required.
        let result = dal.get_component("bag").unwrap();
        assert_eq!(result, Some("<View><Panel id=\"x\"/></View>".to_string()));
    }

    #[test]
    fn get_component_opens_a_tree_listed_component_absent_from_the_manifest() {
        // The bug-1 regression: in the real game, component .xml files are NOT
        // registered in assets.json (only their .lua controllers are). A component
        // listed by the on-disk tree walk MUST still be openable. Manifest is empty.
        let root = temp_install();
        let nested = root.join("gui").join("abilityeditor");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("ability_editor.xml"), "<View/>\n").unwrap();
        // Empty manifest — nothing for "ability_editor.xml" to resolve to.
        let dal = dal_with_manifest(&root, r#"{}"#);

        // Sanity: the manifest genuinely does not know this component.
        assert_eq!(
            dal.resolve_asset("ability_editor.xml").unwrap(),
            None,
            "precondition: the component is not in the manifest"
        );
        // ...yet it opens, read by its on-disk tree path.
        assert_eq!(
            dal.get_component("ability_editor").unwrap(),
            Some("<View/>\n".to_string()),
            "a tree-listed component must be openable regardless of manifest registration"
        );
    }

    #[test]
    fn get_component_returns_none_when_not_in_the_tree() {
        let root = temp_install();
        // A gui/ with one unrelated component; the queried name is not on disk.
        let gui = root.join("gui");
        std::fs::create_dir_all(&gui).unwrap();
        std::fs::write(gui.join("other.xml"), "<View/>").unwrap();
        let dal = dal_for(&root);

        let result = dal.get_component("not_a_component").unwrap();
        assert_eq!(result, None, "absent-from-tree must read as no-such-component");
    }

    #[test]
    fn get_component_errors_uncached_when_listed_but_file_unreadable() {
        // A component listed in the tree whose file then disappears (e.g. deleted
        // between the walk and the read) is a broken-install/read error — surfaced,
        // not handed back as an editable blank — and is NOT cached.
        let root = temp_install();
        let gui = root.join("gui");
        std::fs::create_dir_all(&gui).unwrap();
        let xml_path = gui.join("bag.xml");
        std::fs::write(&xml_path, "<View/>").unwrap();
        let dal = dal_for(&root);

        // Prime the tree cache so "bag" is listed, then delete the file so the read
        // fails while the cached tree still lists it.
        let _ = dal.get_gui_tree().unwrap();
        std::fs::remove_file(&xml_path).unwrap();

        let err = dal
            .get_component("bag")
            .expect_err("a listed-but-unreadable component must surface a read error");
        assert!(
            err.contains("bag"),
            "error should name the offending component, got: {err}"
        );
        // The read error must NOT be cached.
        assert!(
            dal.components.get("bag").is_none(),
            "a read error must not be cached"
        );

        // Proof it isn't cached: restore the file and the next read succeeds.
        std::fs::write(&xml_path, "<View id=\"back\"/>").unwrap();
        assert_eq!(
            dal.get_component("bag").unwrap(),
            Some("<View id=\"back\"/>".to_string()),
            "a restored file must read cleanly on the next call (error was not cached)"
        );
    }

    #[test]
    fn get_component_caches_successful_reads_by_name() {
        let root = temp_install();
        let gui = root.join("gui");
        std::fs::create_dir_all(&gui).unwrap();
        let xml_path = gui.join("bag.xml");
        std::fs::write(&xml_path, "<View id=\"first\"/>").unwrap();
        let dal = dal_for(&root);

        // First read populates the cache.
        assert_eq!(
            dal.get_component("bag").unwrap(),
            Some("<View id=\"first\"/>".to_string())
        );

        // Change the file on disk WITHOUT invalidating; the cache must serve the
        // original contents (proving the read is cached by name).
        std::fs::write(&xml_path, "<View id=\"second\"/>").unwrap();
        assert_eq!(
            dal.get_component("bag").unwrap(),
            Some("<View id=\"first\"/>".to_string()),
            "a cached component read must not re-touch disk"
        );

        // After an explicit invalidation (what the gui watcher does), the next read
        // re-walks disk and sees the new contents.
        dal.components.invalidate_all();
        assert_eq!(
            dal.get_component("bag").unwrap(),
            Some("<View id=\"second\"/>".to_string())
        );
    }

    #[test]
    fn create_folder_refuses_if_already_exists() {
        let root = temp_install();
        let existing = root.join("gui").join("widgets");
        std::fs::create_dir_all(&existing).unwrap();
        // Drop a marker file so we can prove the existing dir is left untouched.
        std::fs::write(existing.join("keep.xml"), "<Panel/>").unwrap();
        let dal = dal_for(&root);

        let err = dal
            .create_folder("", "widgets")
            .expect_err("creating an existing folder must be refused");
        assert!(err.contains("widgets"), "got: {err}");

        // The existing folder and its contents are untouched.
        assert!(existing.join("keep.xml").exists());
    }
}
