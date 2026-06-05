use std::{fs, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, serialize_pretty, Dal},
    model::Ability,
};

impl Dal {
    fn abilities_path(&self) -> PathBuf {
        self.data_dir().join("abilities.json")
    }

    pub fn get_abilities(&self) -> Result<Arc<Vec<Ability>>, String> {
        if let Some(hit) = self.abilities.get(&()) {
            return Ok(hit);
        }
        let path = self.abilities_path();
        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let list: Vec<Ability> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;
        let arc = Arc::new(list);
        self.abilities.insert((), arc.clone());
        Ok(arc)
    }

    pub fn save_ability(&self, ability: Ability) -> Result<(), String> {
        let path = self.abilities_path();

        // Always re-read from disk so an external edit between the last load
        // and this save isn't silently clobbered.
        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let mut list: Vec<Ability> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;

        if let Some(existing) = list.iter_mut().find(|a| a.id == ability.id) {
            *existing = ability;
        } else {
            list.push(ability);
        }
        // Sort by id so diffs stay readable across saves.
        list.sort_by(|a, b| a.id.cmp(&b.id));

        let buf = serialize_pretty(&list)?;
        atomic_write(&path, &buf)?;

        self.abilities.insert((), Arc::new(list));
        Ok(())
    }
}
