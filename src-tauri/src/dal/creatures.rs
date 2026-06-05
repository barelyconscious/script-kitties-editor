use std::{fs, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, serialize_pretty, Dal},
    model::Creature,
};

impl Dal {
    fn creatures_path(&self) -> PathBuf {
        self.data_dir().join("creatures.json")
    }

    pub fn get_creatures(&self) -> Result<Arc<Vec<Creature>>, String> {
        if let Some(hit) = self.creatures.get(&()) {
            return Ok(hit);
        }
        let path = self.creatures_path();
        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let list: Vec<Creature> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;
        let arc = Arc::new(list);
        self.creatures.insert((), arc.clone());
        Ok(arc)
    }

    pub fn save_creature(&self, creature: Creature) -> Result<(), String> {
        let path = self.creatures_path();

        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let mut list: Vec<Creature> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;

        if let Some(existing) = list.iter_mut().find(|c| c.id == creature.id) {
            *existing = creature;
        } else {
            list.push(creature);
        }
        list.sort_by(|a, b| a.id.cmp(&b.id));

        let buf = serialize_pretty(&list)?;
        atomic_write(&path, &buf)?;

        self.creatures.insert((), Arc::new(list));
        Ok(())
    }
}
