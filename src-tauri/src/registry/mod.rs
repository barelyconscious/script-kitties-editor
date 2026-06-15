use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

// Editor-owned, user-tweakable enums (tags, ability shapes, rarities, biomes,
// damage types). Persisted next to editor.conf.json so the values survive
// restarts. NOT (yet) read by the game — this is the editor's source of truth
// for the dropdowns; a later step can point the game's Lua at this file.
const REGISTRY_PATH: &str = "./editor.registry.json";

/// One enum value plus a human description. `value` is what gets written into
/// game data (a tag, a rarity, …); `description` is editor-only documentation.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntry {
    pub value: String,
    #[serde(default)]
    pub description: String,
}

/// The full set of editable enums. Each field carries a per-field serde default
/// so a registry file written by an older build (missing a newer enum) fills the
/// gap with sane defaults instead of an empty list.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    /// Shared by abilities, biograms, and effects.
    #[serde(default = "default_combat_tags")]
    pub combat_tags: Vec<RegistryEntry>,
    #[serde(default = "default_item_tags")]
    pub item_tags: Vec<RegistryEntry>,
    #[serde(default = "default_ability_shapes")]
    pub ability_shapes: Vec<RegistryEntry>,
    #[serde(default = "default_rarities")]
    pub rarities: Vec<RegistryEntry>,
    #[serde(default = "default_biomes")]
    pub biomes: Vec<RegistryEntry>,
    #[serde(default = "default_damage_types")]
    pub damage_types: Vec<RegistryEntry>,
    /// Card rarity tiers for gacha draws. Editor-tweakable (unlike `rarities`,
    /// the fixed item tiers) since the gacha tiers are a design knob.
    #[serde(default = "default_creature_rarities")]
    pub creature_rarities: Vec<RegistryEntry>,
}

/// Load the registry, creating it with defaults on first run. A malformed file
/// falls back to defaults (without overwriting it, so a hand-edit can be fixed).
pub fn get_or_create_registry() -> Registry {
    let path = Path::new(REGISTRY_PATH);
    if !path.exists() {
        let registry = default_registry();
        if let Ok(json) = to_pretty(&registry) {
            let _ = fs::write(path, json);
        }
        return registry;
    }
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_else(|_| default_registry()),
        Err(_) => default_registry(),
    }
}

pub fn write_to_disk(registry: &Registry) -> Result<(), String> {
    let json = to_pretty(registry)?;
    fs::write(REGISTRY_PATH, json)
        .map_err(|e| format!("failed to write {}: {}", REGISTRY_PATH, e))
}

fn to_pretty(registry: &Registry) -> Result<String, String> {
    let mut json = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("failed to serialize registry: {}", e))?;
    json.push('\n');
    Ok(json)
}

fn entry(value: &str, description: &str) -> RegistryEntry {
    RegistryEntry {
        value: value.to_string(),
        description: description.to_string(),
    }
}

fn default_registry() -> Registry {
    Registry {
        combat_tags: default_combat_tags(),
        item_tags: default_item_tags(),
        ability_shapes: default_ability_shapes(),
        rarities: default_rarities(),
        biomes: default_biomes(),
        damage_types: default_damage_types(),
        creature_rarities: default_creature_rarities(),
    }
}

// Union of the old ability/biogram tags and effect tags, since combat tags are
// now one shared list across abilities, biograms, and effects.
fn default_combat_tags() -> Vec<RegistryEntry> {
    vec![
        entry("AREA", "Affects an area rather than a single target."),
        entry("AUTO_TARGET", "Picks its target automatically."),
        entry("BENEFICIAL", "A positive effect."),
        entry("BLEED", "Inflicts bleeding damage over time."),
        entry("BUFF", "Improves the target's stats."),
        entry("BURN", "Inflicts burning damage over time."),
        entry("CONJURE", "Summons or creates something."),
        entry("CONTACT", "Requires physical contact."),
        entry("DEBUFF", "Weakens the target's stats."),
        entry("ELECTRIFIED", "Applies an electric effect."),
        entry("HARMFUL", "Can hurt the target."),
        entry("HELPFUL", "Can help the target."),
        entry("PROJECTILE", "Fires a projectile."),
        entry("REQUIRES_TARGET", "Must be aimed at a target."),
        entry("SET_LOCATION", "Targets a chosen location."),
    ]
}

fn default_item_tags() -> Vec<RegistryEntry> {
    vec![
        entry("CONSUMABLE", "Used up when activated."),
        entry("HARMFUL", "Can hurt its target."),
        entry("HELPFUL", "Can help its target."),
        entry("REQUIRES_TARGET", "Must be used on a target."),
        entry("STACKABLE", "Multiple copies share one slot."),
        entry("USABLE_IN_COMBAT", "Can be used during combat."),
        entry("USABLE_OUTSIDE_COMBAT", "Can be used outside of combat."),
    ]
}

fn default_ability_shapes() -> Vec<RegistryEntry> {
    vec![
        entry("POINT", "A single point target."),
        entry("SPHERE", "A spherical area."),
        entry("CONE", "A cone-shaped area."),
        entry("SELF", "Targets the caster."),
    ]
}

// Ordered low → high; order drives the rarity dropdown.
fn default_rarities() -> Vec<RegistryEntry> {
    vec![
        entry("POOR", "The lowest rarity tier."),
        entry("COMMON", "A common item."),
        entry("UNCOMMON", "Less common than usual."),
        entry("RARE", "A rare find."),
        entry("EPIC", "A very rare, powerful item."),
        entry("UNIQUE", "One of a kind."),
    ]
}

fn default_biomes() -> Vec<RegistryEntry> {
    vec![
        entry("DESERT", "Arid, sandy biome."),
        entry("FOREST", "Wooded biome."),
        entry("MOUNTAINS", "High, rocky biome."),
        entry("PLAINS", "Open grassland biome."),
        entry("SWAMP", "Wet, marshy biome."),
    ]
}

fn default_damage_types() -> Vec<RegistryEntry> {
    vec![
        entry("PHYSICAL", "Physical damage."),
        entry("FIRE", "Fire damage."),
        entry("WATER", "Water damage."),
        entry("ELECTRIC", "Electric damage."),
        entry("POISON", "Poison damage."),
    ]
}

// Ordered low → high; order drives the creature-rarity dropdown.
fn default_creature_rarities() -> Vec<RegistryEntry> {
    vec![
        entry("COMMON", "Common"),
        entry("UNCOMMON", "Uncommon"),
        entry("RARE", "Rare."),
        entry("MYTHIC", "Mythic"),
    ]
}
