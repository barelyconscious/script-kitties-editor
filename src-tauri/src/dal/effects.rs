use std::{fs, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, serialize_pretty, Dal},
    model::Effect,
};

impl Dal {
    fn effects_path(&self) -> PathBuf {
        self.data_dir().join("effects.json")
    }

    pub fn get_effects(&self) -> Result<Arc<Vec<Effect>>, String> {
        if let Some(hit) = self.effects.get(&()) {
            return Ok(hit);
        }
        let path = self.effects_path();
        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let list: Vec<Effect> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;
        let arc = Arc::new(list);
        self.effects.insert((), arc.clone());
        Ok(arc)
    }

    pub fn save_effect(&self, effect: Effect) -> Result<(), String> {
        let path = self.effects_path();

        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let mut list: Vec<Effect> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;

        if let Some(existing) = list.iter_mut().find(|e| e.id == effect.id) {
            *existing = effect;
        } else {
            list.push(effect);
        }
        list.sort_by(|a, b| a.id.cmp(&b.id));

        let buf = serialize_pretty(&list)?;
        atomic_write(&path, &buf)?;

        self.effects.insert((), Arc::new(list));
        Ok(())
    }
}
