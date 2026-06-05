use std::{fs, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, serialize_pretty, Dal},
    model::Item,
};

impl Dal {
    fn items_path(&self) -> PathBuf {
        self.data_dir().join("items.json")
    }

    pub fn get_items(&self) -> Result<Arc<Vec<Item>>, String> {
        if let Some(hit) = self.items.get(&()) {
            return Ok(hit);
        }
        let path = self.items_path();
        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let list: Vec<Item> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;
        let arc = Arc::new(list);
        self.items.insert((), arc.clone());
        Ok(arc)
    }

    pub fn save_item(&self, item: Item) -> Result<(), String> {
        let path = self.items_path();

        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let mut list: Vec<Item> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;

        if let Some(existing) = list.iter_mut().find(|i| i.id == item.id) {
            *existing = item;
        } else {
            list.push(item);
        }
        list.sort_by(|a, b| a.id.cmp(&b.id));

        let buf = serialize_pretty(&list)?;
        atomic_write(&path, &buf)?;

        self.items.insert((), Arc::new(list));
        Ok(())
    }
}
