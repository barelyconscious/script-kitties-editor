use std::{fs, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, serialize_pretty, Dal},
    model::Biogram,
};

impl Dal {
    fn biograms_path(&self) -> PathBuf {
        self.data_dir().join("biograms.json")
    }

    pub fn get_biograms(&self) -> Result<Arc<Vec<Biogram>>, String> {
        if let Some(hit) = self.biograms.get(&()) {
            return Ok(hit);
        }
        let path = self.biograms_path();
        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let list: Vec<Biogram> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;
        let arc = Arc::new(list);
        self.biograms.insert((), arc.clone());
        Ok(arc)
    }

    pub fn save_biogram(&self, biogram: Biogram) -> Result<(), String> {
        let path = self.biograms_path();

        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let mut list: Vec<Biogram> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;

        if let Some(existing) = list.iter_mut().find(|b| b.id == biogram.id) {
            *existing = biogram;
        } else {
            list.push(biogram);
        }
        list.sort_by(|a, b| a.id.cmp(&b.id));

        let buf = serialize_pretty(&list)?;
        atomic_write(&path, &buf)?;

        self.biograms.insert((), Arc::new(list));
        Ok(())
    }
}
