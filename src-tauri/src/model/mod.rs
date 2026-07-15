use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
// BTreeMap (not HashMap) for stat maps: it iterates keys in sorted order, so
// serde emits them alphabetically and deterministically. HashMap's randomized
// iteration order churned the whole stats block on every save.
use std::collections::BTreeMap;

/// The GUI color palette AS THE EDITOR HOLDS IT: a flat, **order-preserving** map of
/// palette name (an identifier, e.g. `TextDefault`) -> color-code string (`r,g,b,a`,
/// e.g. `185,178,165,255`). This is the app/wire shape the frontend binding pipeline
/// consumes and the `get_palette`/`save_palette` commands exchange — NOT the on-disk
/// shape. On disk the palette is the engine's array of {@link PaletteColor} objects
/// (`Data/palette.json`); `dal::palette` translates between the two.
///
/// `IndexMap` (not `BTreeMap`) because key order is author-controlled and must
/// round-trip: re-saving an untouched palette should produce a byte-identical file,
/// so an edit yields a minimal diff.
pub type Palette = IndexMap<String, String>;

/// One on-disk palette entry, matching the engine's `Data/palette.json` schema:
/// a named color with 0–255 RGBA channels, e.g.
/// `{ "name": "TextDefault", "r": 185, "g": 178, "b": 165, "a": 255 }`. This is the
/// ground-truth format the C++ runtime reads; `dal::palette` maps a file of these to
/// and from the editor's `name -> "r,g,b,a"` {@link Palette} map.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PaletteColor {
    pub name: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

#[derive(Serialize, Deserialize)]
pub enum GameObjectType {
    Ability,
    Biogram,
    Effect,
    Charm,
    Item,
    Creature,
    Bundle,
    Pack,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameObject {
    pub object_type: GameObjectType,
    pub id: String,
    pub name: String,
    pub sprite: String,
    pub script: String,
    pub description: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ability {
    pub id: String,
    pub name: String,
    pub sprite: String,
    pub script: String,
    pub description: String,
    pub shape: String,
    pub tags: Vec<String>,
    pub range: i32,
    pub radius: i32,
    pub max_num_targets: i32,
    pub cost: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Biogram {
    pub id: String,
    pub name: String,
    pub sprite: String,
    pub script: String,
    pub description: String,
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    pub id: String,
    pub name: String,
    pub sprite: String,
    pub script: String,
    pub description: String,
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Charm {
    pub id: String,
    pub name: String,
    pub sprite: String,
    // Charms MAY carry a script, but it is optional: `default` lets pre-existing
    // charms.json entries (which have no script key) deserialize, and
    // `skip_serializing_if` keeps script-less charms from gaining an empty
    // `"script": ""` on save — so untouched files stay byte-identical.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub script: String,
    pub description: String,
    pub stats: BTreeMap<String, i32>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub name: String,
    pub sprite: String,
    pub script: String,
    pub description: String,
    pub item_tags: Vec<String>,
}

/// An entry in `itemDropTable.json` — the loot/economy attributes for an item,
/// keyed by the item's `id`. min/max level and drop_chance are skipped when
/// absent so the common rows round-trip without churning the file.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDrop {
    pub id: String,
    pub rarity: String,
    pub value: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_level: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_level: Option<i32>,
    #[serde(default)]
    pub biomes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drop_chance: Option<f64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatureLevelUp {
    pub level: i32,
    pub abilities_gained: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Creature {
    pub id: String,
    pub name: String,
    pub sprite: String,
    pub description: String,
    pub ai_controller: String, // shoulda been script
    // Gacha rarity (a Registry `rarities` value). Optional so pre-existing
    // creatures.json entries deserialize and script-less round-trips stay clean.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub rarity: String,
    // Stat values are `serde_json::Number`, not `i32`, so creature stats and
    // per-level gains can be fractional (e.g. a 0.5 gain). Number preserves the
    // JSON representation as sent: a whole value stays an integer (`12`), only an
    // actually-fractional value writes as a float (`12.5`) — so existing
    // integer-only creature files don't churn to `12.0` on save.
    pub base_stats: BTreeMap<String, serde_json::Number>,
    pub base_abilities: Vec<String>,
    #[serde(default)]
    pub stat_gains_per_level: BTreeMap<String, serde_json::Number>,
    #[serde(default)]
    pub abilities_by_level: Vec<CreatureLevelUp>,
}

/// A gacha **bundle**: a named, customizable collection of creatures (seasons &
/// promotions). Each member may override a handful of the creature's draw-time
/// attributes; everything else (growth curve, per-level unlocks, id, AI script)
/// comes from the base creature.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sprite: String,
    #[serde(default)]
    pub creatures: Vec<BundleCreature>,
}

/// One member of a `Bundle`: a reference to a creature by `id` plus the optional
/// per-creature overrides applied when the creature is drawn from this bundle.
/// Empty overrides are skipped on save so untouched members stay minimal.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleCreature {
    pub id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name_override: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description_override: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sprite_override: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub base_stats_override: BTreeMap<String, i32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub abilities_override: Vec<String>,
}

/// A gacha **pack**: a card pack whose `slots` each define a draw pool. The C++
/// draw system consumes these; the editor just authors them.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pack {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sprite: String,
    #[serde(default)]
    pub slots: Vec<PackSlot>,
}

/// One card slot in a `Pack`. For now a slot carries only its `drawRules`; the
/// design's "guaranteed creature" slot variant is deferred.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackSlot {
    pub draw_rules: DrawRules,
    /// How many identical cards this slot represents (a "stack"). Defaults to 1
    /// and is omitted from JSON when 1 so single slots stay compact.
    #[serde(default = "default_slot_count", skip_serializing_if = "slot_count_is_one")]
    pub count: u32,
}

fn default_slot_count() -> u32 {
    1
}

fn slot_count_is_one(count: &u32) -> bool {
    *count == 1
}

/// The weighted draw configuration for a `PackSlot`: which bundles can be drawn
/// from (by weight) and the rarity distribution (weights that should sum to 1).
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawRules {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub bundles: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub rarity: BTreeMap<String, f64>,
}

/// One entry in the game's `assets.json` manifest. Maps a logical asset name
/// (the map key, e.g. "ability_bite.png") to its on-disk location relative to
/// the game install root. Paths use Windows-style `\` separators.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetEntry {
    pub filepath: String,
}

/// Summary of a full `assets.json` rescan, surfaced to the UI so the user can see
/// exactly what the scan changed rather than a bare success/fail.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestUpdate {
    /// Number of assets in the manifest after the scan.
    pub total: usize,
    /// Asset names newly discovered on disk (absent from the prior manifest).
    pub added: Vec<String>,
    /// Asset names whose on-disk path changed.
    pub updated: Vec<String>,
    /// Asset names dropped because their file no longer exists on disk.
    pub removed: Vec<String>,
}

/// Whether a GUI component's root XML element is a `<View>` (a top-level screen)
/// or anything else (a reusable widget). Classified by peeking only the root tag,
/// never by parsing the component's body. Serialized lowercase to match the
/// design's `"view" | "widget"` shape.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GuiComponentKind {
    View,
    Widget,
}

/// One `.xml` component file in the `gui/` tree, as surfaced to the component
/// list. Deliberately lightweight: name + path + a root-tag classification +
/// a sibling-controller hint. The full element tree is parsed only when the
/// component is opened, not at list time.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GuiComponentRef {
    /// Basename without extension, e.g. "bag_slot".
    pub name: String,
    /// Full filename, e.g. "bag_slot.xml".
    pub file_name: String,
    /// gui-relative path to the file, e.g. "widgets/bag_slot.xml".
    pub path: String,
    /// "view" if the root element is `<View>`, else "widget".
    pub kind: GuiComponentKind,
    /// Sibling "{name}_controller.lua" if one exists alongside the .xml, else null.
    pub controller_file_name: Option<String>,
}

/// A folder in the `gui/` tree, recursive. The root folder has an empty `name`
/// and empty `path`. Mirrors the on-disk subfolder structure exactly, including
/// empty folders.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GuiFolder {
    /// Folder name ("" for the gui/ root).
    pub name: String,
    /// gui-relative path ("" root, "widgets", "profile/cards").
    pub path: String,
    /// Subfolders, recursive.
    pub folders: Vec<GuiFolder>,
    /// `.xml` component files directly in this folder.
    pub components: Vec<GuiComponentRef>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dlc {
    pub id: String,
    pub name: String,
    pub sprite: String,
    pub description: String,
    #[serde(default)]
    pub creatures: Vec<String>,
    #[serde(default)]
    pub abilities: Vec<String>,
    #[serde(default)]
    pub dungeons: Vec<String>,
    pub script: Option<String>,
}
