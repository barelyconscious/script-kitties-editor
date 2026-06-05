use std::{fs, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, serialize_pretty, Dal},
    model::Charm,
};

impl Dal {
    fn charms_path(&self) -> PathBuf {
        self.data_dir().join("charms.json")
    }

    pub fn get_charms(&self) -> Result<Arc<Vec<Charm>>, String> {
        if let Some(hit) = self.charms.get(&()) {
            return Ok(hit);
        }
        let path = self.charms_path();
        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let list: Vec<Charm> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;
        let arc = Arc::new(list);
        self.charms.insert((), arc.clone());
        Ok(arc)
    }

    pub fn save_charm(&self, charm: Charm) -> Result<(), String> {
        let path = self.charms_path();

        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let mut list: Vec<Charm> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;

        if let Some(existing) = list.iter_mut().find(|c| c.id == charm.id) {
            *existing = charm;
        } else {
            list.push(charm);
        }
        list.sort_by(|a, b| a.id.cmp(&b.id));

        let buf = serialize_pretty(&list)?;
        atomic_write(&path, &buf)?;

        self.charms.insert((), Arc::new(list));
        Ok(())
    }
}
