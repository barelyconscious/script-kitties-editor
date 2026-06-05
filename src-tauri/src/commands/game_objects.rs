use tauri::State;

use crate::dal::Dal;
use crate::model::{GameObject, GameObjectType};

#[tauri::command]
pub fn get_game_objects(dal: State<Dal>) -> Result<Vec<GameObject>, String> {
    let abilities = dal.get_abilities()?;
    let biograms = dal.get_biograms()?;
    let charms = dal.get_charms()?;
    let creatures = dal.get_creatures()?;
    let effects = dal.get_effects()?;
    let items = dal.get_items()?;

    let mut all = Vec::with_capacity(
        abilities.len()
            + biograms.len()
            + charms.len()
            + creatures.len()
            + effects.len()
            + items.len(),
    );

    for a in abilities.iter() {
        all.push(GameObject {
            object_type: GameObjectType::Ability,
            id: a.id.clone(),
            name: a.name.clone(),
            sprite: a.sprite.clone(),
            script: a.script.clone(),
            description: a.description.clone(),
        });
    }

    for b in biograms.iter() {
        all.push(GameObject {
            object_type: GameObjectType::Biogram,
            id: b.id.clone(),
            name: b.name.clone(),
            sprite: b.sprite.clone(),
            script: b.script.clone(),
            description: b.description.clone(),
        });
    }

    for c in charms.iter() {
        all.push(GameObject {
            object_type: GameObjectType::Charm,
            id: c.id.clone(),
            name: c.name.clone(),
            sprite: c.sprite.clone(),
            // Charms have no script field in the source data.
            script: String::new(),
            description: c.description.clone(),
        });
    }

    for c in creatures.iter() {
        all.push(GameObject {
            object_type: GameObjectType::Creature,
            id: c.id.clone(),
            name: c.name.clone(),
            sprite: c.sprite.clone(),
            // Creatures call their script `aiController` in the source data.
            script: c.ai_controller.clone(),
            description: c.description.clone(),
        });
    }

    for e in effects.iter() {
        all.push(GameObject {
            object_type: GameObjectType::Effect,
            id: e.id.clone(),
            name: e.name.clone(),
            sprite: e.sprite.clone(),
            script: e.script.clone(),
            description: e.description.clone(),
        });
    }

    for i in items.iter() {
        all.push(GameObject {
            object_type: GameObjectType::Item,
            id: i.id.clone(),
            name: i.name.clone(),
            sprite: i.sprite.clone(),
            script: i.script.clone(),
            description: i.description.clone(),
        });
    }

    Ok(all)
}
