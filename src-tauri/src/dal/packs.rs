use std::{fs, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, serialize_pretty, Dal},
    model::Pack,
};

impl Dal {
    fn packs_path(&self) -> PathBuf {
        self.data_dir().join("packs.json")
    }

    pub fn get_packs(&self) -> Result<Arc<Vec<Pack>>, String> {
        if let Some(hit) = self.packs.get(&()) {
            return Ok(hit);
        }
        // packs.json is new and may not exist yet in an install — treat a
        // missing file as an empty list rather than erroring.
        let path = self.packs_path();
        let list: Vec<Pack> = if path.exists() {
            let contents = fs::read_to_string(&path)
                .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
            serde_json::from_str(&contents)
                .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?
        } else {
            Vec::new()
        };
        let arc = Arc::new(list);
        self.packs.insert((), arc.clone());
        Ok(arc)
    }

    pub fn save_pack(&self, pack: Pack) -> Result<(), String> {
        let path = self.packs_path();

        // Re-read from disk (tolerating a missing file) so we upsert into the
        // current contents rather than the possibly-stale cache.
        let mut list: Vec<Pack> = if path.exists() {
            let contents = fs::read_to_string(&path)
                .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
            serde_json::from_str(&contents)
                .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?
        } else {
            Vec::new()
        };

        if let Some(existing) = list.iter_mut().find(|p| p.id == pack.id) {
            *existing = pack;
        } else {
            list.push(pack);
        }
        list.sort_by(|a, b| a.id.cmp(&b.id));

        let buf = serialize_pretty(&list)?;
        atomic_write(&path, &buf)?;

        self.packs.insert((), Arc::new(list));
        Ok(())
    }
}
