use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::dal::Dal;
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
}
