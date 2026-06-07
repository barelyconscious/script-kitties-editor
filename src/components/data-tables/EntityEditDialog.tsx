import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type EntityField, EntityFieldsForm } from "./EntityFieldsForm";

// Re-exported so existing callers can keep importing the schema type from here.
export type { EntityField } from "./EntityFieldsForm";

/**
 * Generic, schema-driven edit dialog. Owns draft state, dirty tracking, the
 * save lifecycle (in-flight + error), and cancel. The field grid itself is the
 * controlled `EntityFieldsForm`; entity-specific knowledge lives entirely in the
 * `fields` schema passed by the caller, so the same dialog edits abilities,
 * items, biograms, etc.
 */
export function EntityEditDialog<T extends { id: string }>({
  entity,
  fields,
  title,
  description,
  onOpenChange,
  onSave,
}: {
  /** The row being edited, or `null` when the dialog is closed. */
  entity: T | null;
  fields: EntityField<T>[];
  title?: string;
  description?: string;
  onOpenChange: (open: boolean) => void;
  /** Persist the edited entity. Throw to surface an error and keep the dialog open. */
  onSave: (updated: T) => Promise<void>;
}) {
  const [draft, setDraft] = useState<T | null>(entity);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the draft whenever a different entity is opened.
  useEffect(() => {
    setDraft(entity);
    setError(null);
  }, [entity]);

  const dirty = !!draft && !!entity && !shallowEqual(draft, entity);

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={entity !== null} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title ?? "Edit"}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {draft && (
          <EntityFieldsForm fields={fields} value={draft} onChange={setDraft} disabled={saving} />
        )}

        {error && <p className="px-1 text-destructive text-sm">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  // Cheap structural compare; values here are primitives or string[]. JSON is
  // sufficient and avoids a dependency for dirty-tracking.
  return JSON.stringify(a) === JSON.stringify(b);
}

export default EntityEditDialog;
