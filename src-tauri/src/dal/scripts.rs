use std::path::{Path, PathBuf};
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

    /// Create a brand-new `.lua` script file and register it in `assets.json`.
    /// This is the separate "first-time creation" door that `save_script`
    /// deliberately refuses — the prerequisite for creating a fresh entity whose
    /// script isn't in the manifest yet.
    ///
    /// `name` includes the `.lua` extension. The file is written to
    /// `<gameInstallPath>/Scripts/<name>` (Scripts is a sibling of Data, not under
    /// it) and a single manifest entry `name -> { filepath: "Scripts\\<name>" }`
    /// is inserted, matching the manifest's existing Windows-separator convention.
    ///
    /// We never clobber: refuses if `name` already resolves through the manifest
    /// OR if the target file already exists on disk, leaving no file or temp
    /// sidecar behind. On success, both the manifest cache (key `()`) and the
    /// scripts cache (key `name`) are refreshed so resolution/reads see the new
    /// script without waiting on the filesystem watcher.
    ///
    /// The two mutating steps are all-or-nothing: a failure at either step leaves
    /// zero residue (no manifest entry, no `.lua` file), so the operation is
    /// retryable. We write the file FIRST (atomic_write self-cleans on its own
    /// failure, leaving nothing), then insert the manifest entry — and if the
    /// manifest insert fails, we delete the just-written file before returning the
    /// error. Doing it manifest-first would risk wedging the name: a failed file
    /// write would leave a manifest entry pointing at a missing file, and the
    /// no-clobber guard (`resolve_asset(name).is_some()`) would then refuse every
    /// retry.
    pub fn create_script(&self, name: &str, contents: String) -> Result<(), String> {
        // Refuse if already registered — never create a second manifest entry or
        // overwrite a script the editor already knows about.
        if self.resolve_asset(name)?.is_some() {
            return Err(format!(
                "refusing to create script '{}': it is already registered in the asset manifest.",
                name
            ));
        }

        let path: PathBuf = Path::new(&self.config().game_install_path)
            .join("Scripts")
            .join(name);

        // Refuse if the file exists on disk even though it's absent from the
        // manifest — we never clobber an existing file.
        if path.exists() {
            return Err(format!(
                "refusing to create script '{}': a file already exists at {}.",
                name,
                path.display()
            ));
        }

        // Step 1: write the script file atomically. atomic_write leaves nothing
        // behind on its own failure (temp + rename), so a failure here needs no
        // cleanup — just propagate the error.
        atomic_write(&path, contents.as_bytes())?;

        // Step 2: register in the manifest. If this fails, roll back step 1 by
        // deleting the just-written file (best-effort) so no orphan remains and a
        // retry — which re-checks the now-clean manifest and disk — succeeds.
        let updated = match self.insert_manifest_entry(name, &format!("Scripts\\{name}")) {
            Ok(updated) => updated,
            Err(e) => {
                let _ = std::fs::remove_file(&path);
                return Err(e);
            }
        };

        // Both steps succeeded: refresh caches so resolve/get see the new script
        // without a watcher round-trip.
        self.manifest.insert((), Arc::new(updated));
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

    #[test]
    fn create_writes_file_registers_manifest_and_seeds_both_caches() {
        let root = temp_install();
        let dal = dal_with_manifest(
            &root,
            r#"{ "item_bandage.png": { "filepath": "Sprites\\item_bandage.png" } }"#,
        );

        dal.create_script("ability_bite.lua", "-- bite\nreturn {}\n".to_string())
            .unwrap();

        // File written to Scripts/ (sibling of Data/), no temp sidecar.
        let script_path = root.join("Scripts").join("ability_bite.lua");
        assert_eq!(
            std::fs::read_to_string(&script_path).unwrap(),
            "-- bite\nreturn {}\n"
        );
        assert!(!root.join("Scripts").join("ability_bite.lua.tmp").exists());

        // Manifest on disk gained the entry with a backslash filepath.
        let manifest_raw = std::fs::read_to_string(root.join("assets.json")).unwrap();
        let manifest: serde_json::Value = serde_json::from_str(&manifest_raw).unwrap();
        assert_eq!(
            manifest["ability_bite.lua"]["filepath"],
            serde_json::json!("Scripts\\ability_bite.lua")
        );
        assert!(!root.join("assets.json.tmp").exists());

        // Resolution sees the new script (manifest cache refreshed in-process).
        let resolved = dal.resolve_asset("ability_bite.lua").unwrap();
        assert_eq!(resolved, Some(script_path));

        // Scripts cache reflects the contents without re-reading disk.
        assert_eq!(
            dal.get_script("ability_bite.lua").unwrap(),
            Some("-- bite\nreturn {}\n".to_string())
        );
    }

    #[test]
    fn create_refuses_name_already_in_manifest_and_writes_nothing() {
        let root = temp_install();
        let dal = dal_with_manifest(
            &root,
            r#"{ "bite.lua": { "filepath": "Scripts\\bite.lua" } }"#,
        );

        let err = dal
            .create_script("bite.lua", "-- nope\n".to_string())
            .expect_err("creating an already-registered name must be refused");
        assert!(
            err.contains("bite.lua"),
            "refusal should name the script, got: {err}"
        );

        // No file or temp may be written for a refused create.
        assert!(!root.join("Scripts").join("bite.lua").exists());
        assert!(!root.join("Scripts").join("bite.lua.tmp").exists());
    }

    #[test]
    fn create_refuses_when_file_already_exists_on_disk() {
        let root = temp_install();
        // File exists on disk but is NOT in the manifest.
        std::fs::write(root.join("Scripts").join("orphan.lua"), "-- existing\n").unwrap();
        let dal = dal_with_manifest(&root, r#"{}"#);

        let err = dal
            .create_script("orphan.lua", "-- new\n".to_string())
            .expect_err("creating over an existing on-disk file must be refused");
        assert!(
            err.contains("orphan.lua"),
            "refusal should name the script, got: {err}"
        );

        // The existing file must be untouched and no manifest entry added.
        assert_eq!(
            std::fs::read_to_string(root.join("Scripts").join("orphan.lua")).unwrap(),
            "-- existing\n"
        );
        let manifest_raw = std::fs::read_to_string(root.join("assets.json")).unwrap();
        assert!(!manifest_raw.contains("orphan.lua"));
        assert!(!root.join("Scripts").join("orphan.lua.tmp").exists());
    }

    #[test]
    fn create_rolls_back_file_when_manifest_insert_fails_and_retry_succeeds() {
        let root = temp_install();
        let dal = dal_with_manifest(
            &root,
            r#"{ "item_bandage.png": { "filepath": "Sprites\\item_bandage.png" } }"#,
        );

        // Prime the in-process manifest cache with the VALID manifest so the
        // no-clobber guard (resolve_asset) passes from cache, then corrupt the
        // on-disk file. create_script's step-2 insert_manifest_entry re-reads the
        // raw file from disk and will fail to parse it — a deterministic failure
        // of the SECOND step while the FIRST step (the file write) succeeds.
        let _ = dal.resolve_asset("item_bandage.png").unwrap();
        std::fs::write(root.join("assets.json"), "{ this is not valid json").unwrap();

        let name = "new_script.lua";
        let err = dal
            .create_script(name, "-- first attempt\n".to_string())
            .expect_err("manifest insert over a corrupt file must fail");
        // (a) an Err is returned — and it points at the manifest parse failure.
        assert!(
            err.contains("assets.json") || err.to_lowercase().contains("parse"),
            "error should describe the manifest failure, got: {err}"
        );

        // (b) no orphan .lua file (or temp sidecar) remains — step 1 was rolled back.
        let script_path = root.join("Scripts").join(name);
        assert!(
            !script_path.exists(),
            "failed create must not leave an orphan .lua behind"
        );
        assert!(
            !root.join("Scripts").join("new_script.lua.tmp").exists(),
            "failed create must not leave a temp sidecar"
        );

        // (c) no manifest entry was added — and the on-disk manifest never gained
        // the key (the corrupt write is what we left; the point is the entry the
        // operation would have added is absent).
        let manifest_raw = std::fs::read_to_string(root.join("assets.json")).unwrap();
        assert!(
            !manifest_raw.contains(name),
            "failed create must not register a manifest entry"
        );

        // (d) a subsequent create_script with the SAME name SUCCEEDS — proving the
        // name was not wedged. Restore a valid manifest on disk (the corruption
        // was the injected fault, not the residue under test) and invalidate the
        // primed cache so resolution reflects the restored file.
        std::fs::write(
            root.join("assets.json"),
            r#"{ "item_bandage.png": { "filepath": "Sprites\\item_bandage.png" } }"#,
        )
        .unwrap();
        dal.manifest.invalidate_all();

        dal.create_script(name, "-- retry\n".to_string())
            .expect("retry after rollback must succeed — the name must not be wedged");

        // The retry actually wrote the file and registered exactly that name.
        assert_eq!(
            std::fs::read_to_string(&script_path).unwrap(),
            "-- retry\n"
        );
        let manifest: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join("assets.json")).unwrap())
                .unwrap();
        assert_eq!(
            manifest[name]["filepath"],
            serde_json::json!("Scripts\\new_script.lua")
        );
    }

    #[test]
    fn create_preserves_existing_manifest_order_and_adds_exactly_one_key() {
        let root = temp_install();
        // A manifest whose key order would NOT survive a HashMap round-trip.
        let original = r#"{
  "zeta.json": {
    "filepath": "Data\\zeta.json"
  },
  "alpha.json": {
    "filepath": "Data\\alpha.json"
  },
  "mid.png": {
    "filepath": "Sprites\\mid.png"
  }
}"#;
        let dal = dal_with_manifest(&root, original);

        let before: Vec<String> = {
            let v: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(root.join("assets.json")).unwrap())
                    .unwrap();
            v.as_object().unwrap().keys().cloned().collect()
        };

        dal.create_script("new_script.lua", "-- x\n".to_string())
            .unwrap();

        let after: Vec<String> = {
            let v: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(root.join("assets.json")).unwrap())
                    .unwrap();
            v.as_object().unwrap().keys().cloned().collect()
        };

        // Exactly one key added, in alphabetical position, with every prior key
        // keeping its relative order. `new_script.lua` sorts before `zeta.json`
        // (the first existing key), so it lands at the front.
        assert_eq!(after.len(), before.len() + 1);
        assert!(after.contains(&"new_script.lua".to_string()));
        // Drop the new key and the rest must equal `before` in the same order.
        let without_new: Vec<String> = after
            .iter()
            .filter(|k| *k != "new_script.lua")
            .cloned()
            .collect();
        assert_eq!(without_new, before);
        // Alphabetical placement: new key sorts before the first existing key.
        assert_eq!(after.first().unwrap(), "new_script.lua");
    }
}
