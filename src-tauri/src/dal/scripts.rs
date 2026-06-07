use std::sync::Arc;

use crate::dal::{atomic_write, Dal};

impl Dal {
    /// Read a `.lua` script's contents by logical name — the value already stored
    /// in an object's `script` / `aiController` field. Resolves the name through
    /// the asset manifest (like `dal::sprites`) and only then touches disk, which
    /// is what makes the three outcomes cleanly distinguishable:
    ///
    /// - `Ok(None)` — the name isn't in the manifest, so the object is genuinely
    ///   script-less (e.g. a charm). Not an error.
    /// - `Err(..)` — the name resolves through the manifest but the file is missing
    ///   or unreadable on disk: a broken install. We surface it rather than hand
    ///   back an editable blank that a later save could silently materialize.
    /// - `Ok(Some(contents))` — resolved and read.
    ///
    /// Successful reads (both `None` and `Some`) are cached by name. Broken-install
    /// errors are *not* cached, so a fixed install reads cleanly on the next call.
    pub fn get_script(&self, name: &str) -> Result<Option<String>, String> {
        if let Some(hit) = self.scripts.get(name) {
            return Ok((*hit).clone());
        }
        let result = self.load_script(name)?;
        self.scripts
            .insert(name.to_string(), Arc::new(result.clone()));
        Ok(result)
    }

    fn load_script(&self, name: &str) -> Result<Option<String>, String> {
        let Some(path) = self.resolve_asset(name)? else {
            // Absent from the manifest -> genuinely script-less.
            return Ok(None);
        };
        // In the manifest but missing on disk -> broken install. Unlike sprites,
        // where a missing file is merely "no art", surface this so the user fixes
        // their install instead of editing a phantom blank a save would then create.
        let contents = std::fs::read_to_string(&path).map_err(|e| {
            format!(
                "script '{}' is registered in the asset manifest but could not be read at {}: {}",
                name,
                path.display(),
                e
            )
        })?;
        Ok(Some(contents))
    }

    /// Overwrite a `.lua` script's contents by logical name. Refuses any name that
    /// does not already resolve through `assets.json` — we never create an orphan
    /// file the manifest doesn't know about ('Add Script' is a deferred phase).
    /// Writes atomically (temp + rename), then refreshes the cache.
    pub fn save_script(&self, name: &str, contents: String) -> Result<(), String> {
        let Some(path) = self.resolve_asset(name)? else {
            return Err(format!(
                "refusing to save script '{}': it is not registered in the asset manifest. \
                 Creating new script files is not yet supported.",
                name
            ));
        };
        atomic_write(&path, contents.as_bytes())?;
        self.scripts
            .insert(name.to_string(), Arc::new(Some(contents)));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    use crate::config::EditorConfig;
    use crate::dal::Dal;

    /// A unique, freshly-created temp install root with the dirs `Dal::new`'s
    /// watcher expects (`Data/`, `Scripts/`). Avoids a tempfile dev-dependency.
    fn temp_install() -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "ske-scripts-test-{}-{}-{}",
            std::process::id(),
            nanos,
            n
        ));
        std::fs::create_dir_all(root.join("Data")).unwrap();
        std::fs::create_dir_all(root.join("Scripts")).unwrap();
        root
    }

    /// Build a Dal pointing at `root` with the given manifest JSON written out.
    fn dal_with_manifest(root: &Path, manifest_json: &str) -> Dal {
        std::fs::write(root.join("assets.json"), manifest_json).unwrap();
        Dal::new(EditorConfig {
            game_install_path: root.to_string_lossy().to_string(),
        })
        .unwrap()
    }

    #[test]
    fn read_state_scriptless_when_name_absent_from_manifest() {
        let root = temp_install();
        // Manifest has an unrelated entry; the queried name is not present.
        let dal = dal_with_manifest(
            &root,
            r#"{ "item_bandage.png": { "filepath": "Sprites\\item_bandage.png" } }"#,
        );

        let result = dal.get_script("not_a_script").unwrap();
        assert_eq!(result, None, "absent-from-manifest must read as script-less");
    }

    #[test]
    fn read_state_broken_install_when_manifest_entry_file_missing() {
        let root = temp_install();
        // Name IS in the manifest, but no file is written to Scripts/.
        let dal = dal_with_manifest(
            &root,
            r#"{ "bite.lua": { "filepath": "Scripts\\bite.lua" } }"#,
        );

        let err = dal
            .get_script("bite.lua")
            .expect_err("manifest entry with missing file must be a broken-install error");
        assert!(
            err.contains("bite.lua"),
            "error should name the offending script, got: {err}"
        );
    }

    #[test]
    fn read_state_returns_contents_when_resolved_and_present() {
        let root = temp_install();
        std::fs::write(root.join("Scripts").join("bite.lua"), "-- bite\nreturn {}\n").unwrap();
        let dal = dal_with_manifest(
            &root,
            r#"{ "bite.lua": { "filepath": "Scripts\\bite.lua" } }"#,
        );

        let result = dal.get_script("bite.lua").unwrap();
        assert_eq!(result, Some("-- bite\nreturn {}\n".to_string()));
    }

    #[test]
    fn save_refuses_name_not_in_manifest_and_creates_no_file() {
        let root = temp_install();
        let dal = dal_with_manifest(&root, r#"{}"#);

        let err = dal
            .save_script("orphan.lua", "-- nope\n".to_string())
            .expect_err("saving an unregistered name must be refused");
        assert!(
            err.contains("orphan.lua"),
            "refusal should name the script, got: {err}"
        );

        // No orphan file may be left behind anywhere under the install.
        assert!(
            !root.join("Scripts").join("orphan.lua").exists(),
            "refused save must not create an orphan .lua file"
        );
        assert!(
            !root.join("Scripts").join("orphan.lua.tmp").exists(),
            "refused save must not leave a temp sidecar"
        );
    }

    #[test]
    fn save_writes_registered_script_atomically_with_lua_temp() {
        let root = temp_install();
        let scripts_dir = root.join("Scripts");
        std::fs::write(scripts_dir.join("bite.lua"), "-- old\n").unwrap();
        let dal = dal_with_manifest(
            &root,
            r#"{ "bite.lua": { "filepath": "Scripts\\bite.lua" } }"#,
        );

        dal.save_script("bite.lua", "-- new contents\n".to_string())
            .unwrap();

        // Destination updated, and no temp sidecar (of any extension) left behind.
        assert_eq!(
            std::fs::read_to_string(scripts_dir.join("bite.lua")).unwrap(),
            "-- new contents\n"
        );
        assert!(!scripts_dir.join("bite.lua.tmp").exists());
        assert!(!scripts_dir.join("bite.json.tmp").exists());

        // Cache reflects the write without re-reading disk.
        assert_eq!(
            dal.get_script("bite.lua").unwrap(),
            Some("-- new contents\n".to_string())
        );
    }
}
