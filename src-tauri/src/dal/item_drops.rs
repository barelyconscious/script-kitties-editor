use std::{fs, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, serialize_pretty, Dal},
    model::ItemDrop,
};

impl Dal {
    fn item_drops_path(&self) -> PathBuf {
        self.data_dir().join("itemDropTable.json")
    }

    pub fn get_item_drops(&self) -> Result<Arc<Vec<ItemDrop>>, String> {
        if let Some(hit) = self.item_drops.get(&()) {
            return Ok(hit);
        }
        let path = self.item_drops_path();
        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let list: Vec<ItemDrop> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;
        let arc = Arc::new(list);
        self.item_drops.insert((), arc.clone());
        Ok(arc)
    }

    pub fn save_item_drop(&self, item_drop: ItemDrop) -> Result<(), String> {
        let path = self.item_drops_path();

        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let mut list: Vec<ItemDrop> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;

        if let Some(existing) = list.iter_mut().find(|d| d.id == item_drop.id) {
            *existing = item_drop;
        } else {
            list.push(item_drop);
        }
        list.sort_by(|a, b| a.id.cmp(&b.id));

        let buf = serialize_pretty(&list)?;
        atomic_write(&path, &buf)?;

        self.item_drops.insert((), Arc::new(list));
        Ok(())
    }
}
