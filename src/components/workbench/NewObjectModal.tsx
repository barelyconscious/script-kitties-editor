import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type GameObject, type GameObjectType, GROUP_LABELS, GROUP_ORDER } from "./gameObjects";
import { createObject } from "./newObject";
import {
  hasScriptField,
  initialFormState,
  isValid,
  reduceForm,
  validateNewObject,
} from "./newObjectForm";

export interface NewObjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The preselected type (from a group's "+"), or undefined to default. */
  type?: GameObjectType;
  /** The full loaded object list — drives the id/script uniqueness checks. */
  objects: GameObject[];
  /**
   * Called after a successful create with the new object's identity, so the
   * Workbench can refresh the list and open+focus the new tab.
   */
  onCreated: (created: { objectType: GameObjectType; id: string }) => void;
}

/**
 * The "New X" dialog. Mints a brand-new game object of any type via the headless
 * {@link createObject} core, with a name → id → script derivation chain (each
 * downstream field freezes once hand-edited) and inline validation that blocks
 * Create — most importantly the id-collision guard, since save_<entity> upserts
 * by id and a collision would SILENTLY OVERWRITE an existing object.
 *
 * All field-derivation and validation logic lives in the pure `newObjectForm`
 * module; this component is the React shell around it (state, busy/error, the
 * createObject call, and handing the result back to the Workbench).
 */
export function NewObjectModal({
  open,
  onOpenChange,
  type,
  objects,
  onCreated,
}: NewObjectModalProps) {
  const initialType = type ?? GROUP_ORDER[0];
  const [form, setForm] = useState(() => initialFormState(initialType));
  const [busy, setBusy] = useState(false);
  // A backend/partial-failure message from createObject — shown as a banner; the
  // modal stays OPEN so the user never has to guess the disk state.
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Re-seed the form (and clear flags/errors) every time the modal opens, using
  // the (possibly newly preselected) type. Depending on `type` too means opening
  // from a different group resets the preselection even if `open` was already true.
  useEffect(() => {
    if (open) {
      setForm(initialFormState(type ?? GROUP_ORDER[0]));
      setBusy(false);
      setSubmitError(null);
    }
  }, [open, type]);

  const errors = useMemo(() => validateNewObject(form, objects), [form, objects]);
  const canSubmit = isValid(errors) && !busy;
  const showScript = hasScriptField(form.type);

  async function handleCreate() {
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(null);
    const result = await createObject(form.type, {
      name: form.name.trim(),
      id: form.id.trim(),
      // Pass the (possibly hand-edited) script through; createObject ignores it
      // for a "none" policy and resolves blanks to its own default.
      script: showScript ? form.script.trim() : undefined,
    });
    if (result.ok) {
      onOpenChange(false);
      onCreated({ objectType: result.type, id: result.id });
      return;
    }
    // Keep the modal open and surface the legible failure.
    setBusy(false);
    setSubmitError(result.message);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New object</DialogTitle>
          <DialogDescription>
            Create a new game object. The id and script name are derived from the name; edit either
            to override.
          </DialogDescription>
        </DialogHeader>

        {submitError && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
            {submitError}
          </div>
        )}

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="new-object-type">Type</Label>
            <Select
              value={form.type}
              disabled={busy}
              onValueChange={(v) =>
                setForm((f) => reduceForm(f, { kind: "type", value: v as GameObjectType }))
              }
            >
              <SelectTrigger id="new-object-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUP_ORDER.map((t) => (
                  <SelectItem key={t} value={t}>
                    {GROUP_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="new-object-name">Name</Label>
            <Input
              id="new-object-name"
              autoFocus
              value={form.name}
              disabled={busy}
              onChange={(e) => {
                // Read the value BEFORE setForm: the functional updater runs after
                // the handler returns, by which point React has nulled currentTarget.
                const value = e.currentTarget.value;
                setForm((f) => reduceForm(f, { kind: "name", value }));
              }}
              placeholder="Display name"
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-destructive text-xs">{errors.name}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="new-object-id">ID</Label>
            <Input
              id="new-object-id"
              value={form.id}
              disabled={busy}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setForm((f) => reduceForm(f, { kind: "id", value }));
              }}
              placeholder="lower_snake_case"
              aria-invalid={!!errors.id}
            />
            {errors.id && <p className="text-destructive text-xs">{errors.id}</p>}
          </div>

          {showScript && (
            <div className="grid gap-1.5">
              <Label htmlFor="new-object-script">Script</Label>
              <Input
                id="new-object-script"
                value={form.script}
                disabled={busy}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setForm((f) => reduceForm(f, { kind: "script", value }));
                }}
                placeholder="script_name.lua"
                aria-invalid={!!errors.script}
              />
              {errors.script && <p className="text-destructive text-xs">{errors.script}</p>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NewObjectModal;
