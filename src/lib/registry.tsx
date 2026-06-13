import { invoke } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * The editor's source of truth for tweakable enums (tags, ability shapes,
 * rarities, biomes, damage types). Persisted by the backend in an editor-owned
 * config file (editor.registry.json) — see src-tauri/src/registry. The forms'
 * dropdowns read their options FROM here, so editing the Registry tab changes
 * them everywhere.
 */

/** One enum value plus an editor-only description. `value` is what's written
 *  into game data; `description` documents it for the Registry tab. */
export type RegistryEntry = { value: string; description: string };

export type Registry = {
  /** Shared by abilities, biograms, and effects. */
  combatTags: RegistryEntry[];
  itemTags: RegistryEntry[];
  abilityShapes: RegistryEntry[];
  rarities: RegistryEntry[];
  biomes: RegistryEntry[];
  damageTypes: RegistryEntry[];
};

export type RegistryEnumKey = keyof Registry;

const v = (value: string): RegistryEntry => ({ value, description: "" });

/**
 * A values-only fallback used until the backend responds (and if it ever
 * fails). The descriptions and the authoritative lists live on disk; this just
 * keeps dropdowns populated for the brief moment before the load resolves.
 */
export const DEFAULT_REGISTRY: Registry = {
  combatTags: [
    "AREA",
    "AUTO_TARGET",
    "BENEFICIAL",
    "BLEED",
    "BUFF",
    "BURN",
    "CONJURE",
    "CONTACT",
    "DEBUFF",
    "ELECTRIFIED",
    "HARMFUL",
    "HELPFUL",
    "PROJECTILE",
    "REQUIRES_TARGET",
    "SET_LOCATION",
  ].map(v),
  itemTags: [
    "CONSUMABLE",
    "HARMFUL",
    "HELPFUL",
    "REQUIRES_TARGET",
    "STACKABLE",
    "USABLE_IN_COMBAT",
    "USABLE_OUTSIDE_COMBAT",
  ].map(v),
  abilityShapes: ["POINT", "SPHERE", "CONE", "SELF"].map(v),
  rarities: ["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "UNIQUE"].map(v),
  biomes: ["DESERT", "FOREST", "MOUNTAINS", "PLAINS", "SWAMP"].map(v),
  damageTypes: ["PHYSICAL", "FIRE", "WATER", "ELECTRIC", "POISON"].map(v),
};

export function loadRegistry(): Promise<Registry> {
  return invoke<Registry>("get_registry");
}

export function saveRegistry(registry: Registry): Promise<void> {
  // Arg key must match the Rust parameter name (new_registry → newRegistry).
  return invoke("save_registry", { newRegistry: registry });
}

type RegistryContextValue = {
  registry: Registry;
  loading: boolean;
  /** Persist a new registry; on success the context (and every dropdown) updates. */
  save: (next: Registry) => Promise<void>;
  reload: () => Promise<void>;
};

const RegistryContext = createContext<RegistryContextValue>({
  registry: DEFAULT_REGISTRY,
  loading: false,
  save: async () => {},
  reload: async () => {},
});

/**
 * Loads the registry once and shares it app-wide. Mount at the app root so the
 * edit forms (Data Tables dialog, Workbench data pane) and the Registry tab all
 * read the same values.
 */
export function RegistryProvider({ children }: { children: ReactNode }) {
  const [registry, setRegistry] = useState<Registry>(DEFAULT_REGISTRY);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRegistry(await loadRegistry());
    } catch {
      // Keep whatever we have (defaults or last-loaded) so dropdowns still work.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (next: Registry) => {
    await saveRegistry(next);
    setRegistry(next);
  }, []);

  const value = useMemo<RegistryContextValue>(
    () => ({ registry, loading, save, reload }),
    [registry, loading, save, reload],
  );

  return <RegistryContext.Provider value={value}>{children}</RegistryContext.Provider>;
}

export function useRegistry(): RegistryContextValue {
  return useContext(RegistryContext);
}

/** The plain value list for one enum — what a select/tags control needs. */
export function useEnumValues(key: RegistryEnumKey): string[] {
  const { registry } = useRegistry();
  return useMemo(() => registry[key].map((e) => e.value), [registry, key]);
}
