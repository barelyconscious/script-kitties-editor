use std::{fs, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, serialize_pretty, Dal},
    model::Season,
};

impl Dal {
    fn seasons_path(&self) -> PathBuf {
        self.data_dir().join("seasons.json")
    }

    pub fn get_seasons(&self) -> Result<Arc<Vec<Season>>, String> {
        if let Some(hit) = self.seasons.get(&()) {
            return Ok(hit);
        }
        // seasons.json is new and may not exist yet in an install — treat a
        // missing file as an empty list rather than erroring.
        let path = self.seasons_path();
        let list: Vec<Season> = if path.exists() {
            let contents = fs::read_to_string(&path)
                .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
            serde_json::from_str(&contents)
                .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?
        } else {
            Vec::new()
        };
        let arc = Arc::new(list);
        self.seasons.insert((), arc.clone());
        Ok(arc)
    }

    pub fn save_season(&self, season: Season) -> Result<(), String> {
        let path = self.seasons_path();

        // Re-read from disk (tolerating a missing file) so we upsert into the
        // current contents rather than the possibly-stale cache.
        let mut list: Vec<Season> = if path.exists() {
            let contents = fs::read_to_string(&path)
                .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
            serde_json::from_str(&contents)
                .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?
        } else {
            Vec::new()
        };

        if let Some(existing) = list.iter_mut().find(|b| b.id == season.id) {
            *existing = season;
        } else {
            list.push(season);
        }
        list.sort_by(|a, b| a.id.cmp(&b.id));

        let buf = serialize_pretty(&list)?;
        atomic_write(&path, &buf)?;

        self.seasons.insert((), Arc::new(list));
        Ok(())
    }
}
