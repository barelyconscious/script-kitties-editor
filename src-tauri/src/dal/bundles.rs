use std::{fs, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, serialize_pretty, Dal},
    model::Bundle,
};

impl Dal {
    fn bundles_path(&self) -> PathBuf {
        self.data_dir().join("bundles.json")
    }

    pub fn get_bundles(&self) -> Result<Arc<Vec<Bundle>>, String> {
        if let Some(hit) = self.bundles.get(&()) {
            return Ok(hit);
        }
        // bundles.json is new and may not exist yet in an install — treat a
        // missing file as an empty list rather than erroring.
        let path = self.bundles_path();
        let list: Vec<Bundle> = if path.exists() {
            let contents = fs::read_to_string(&path)
                .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
            serde_json::from_str(&contents)
                .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?
        } else {
            Vec::new()
        };
        let arc = Arc::new(list);
        self.bundles.insert((), arc.clone());
        Ok(arc)
    }

    pub fn save_bundle(&self, bundle: Bundle) -> Result<(), String> {
        let path = self.bundles_path();

        // Re-read from disk (tolerating a missing file) so we upsert into the
        // current contents rather than the possibly-stale cache.
        let mut list: Vec<Bundle> = if path.exists() {
            let contents = fs::read_to_string(&path)
                .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
            serde_json::from_str(&contents)
                .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?
        } else {
            Vec::new()
        };

        if let Some(existing) = list.iter_mut().find(|b| b.id == bundle.id) {
            *existing = bundle;
        } else {
            list.push(bundle);
        }
        list.sort_by(|a, b| a.id.cmp(&b.id));

        let buf = serialize_pretty(&list)?;
        atomic_write(&path, &buf)?;

        self.bundles.insert((), Arc::new(list));
        Ok(())
    }
}
