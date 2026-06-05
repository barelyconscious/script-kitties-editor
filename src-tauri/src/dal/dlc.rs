use std::{fs, path::PathBuf, sync::Arc};

use crate::{
    dal::{atomic_write, serialize_pretty, Dal},
    model::Dlc,
};

impl Dal {
    fn dlc_path(&self) -> PathBuf {
        self.data_dir().join("dlc.json")
    }

    pub fn get_dlcs(&self) -> Result<Arc<Vec<Dlc>>, String> {
        if let Some(hit) = self.dlcs.get(&()) {
            return Ok(hit);
        }
        let path = self.dlc_path();
        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let list: Vec<Dlc> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;
        let arc = Arc::new(list);
        self.dlcs.insert((), arc.clone());
        Ok(arc)
    }

    pub fn save_dlc(&self, dlc: Dlc) -> Result<(), String> {
        let path = self.dlc_path();

        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
        let mut list: Vec<Dlc> = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;

        if let Some(existing) = list.iter_mut().find(|d| d.id == dlc.id) {
            *existing = dlc;
        } else {
            list.push(dlc);
        }
        list.sort_by(|a, b| a.id.cmp(&b.id));

        let buf = serialize_pretty(&list)?;
        atomic_write(&path, &buf)?;

        self.dlcs.insert((), Arc::new(list));
        Ok(())
    }
}
