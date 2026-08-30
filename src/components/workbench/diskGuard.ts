/**
 * diskGuard — the save-time optimistic-concurrency guard shared by every
 * Workbench editable target (data panes + the script pane). Nothing auto-saves;
 * a manual Save routes each dirty target through {@link guardedWrite}, which:
 *
 *  1. re-reads the target's on-disk mtime SIGNATURE (see `lib/entities/diskMtime`),
 *  2. if it moved since the signature captured at load, asks the user what to do
 *     (Reload from disk / Overwrite / Cancel),
 *  3. writes only when there's no conflict or the user chose Overwrite,
 *  4. returns the post-write signature so the caller can advance its baseline.
 *
 * The decision is intentionally tiny and pure of React so it reads the same for
 * data and scripts and can be unit-tested without rendering.
 */

/** The user's answer to a save-time disk-change conflict. */
export type ConflictChoice = "reload" | "overwrite" | "cancel";

/** The outcome of a guarded write, so the caller knows how to update its state. */
export type GuardOutcome =
  | { kind: "written"; sig: string }
  | { kind: "reloaded" }
  | { kind: "cancelled" };

export interface GuardedWriteOptions {
  /** The mtime signature captured when the record/script was loaded (or last
   *  saved). `null` means no baseline yet — skip the conflict check. */
  capturedSig: string | null;
  /** Re-read the current on-disk mtime signature for this target. */
  fetchSig: () => Promise<string>;
  /** Prompt the user; resolves with their choice. Called only on a real conflict. */
  confirmConflict: () => Promise<ConflictChoice>;
  /** Re-read the file and reseat the editor to disk truth (discarding edits). */
  reload: () => Promise<void>;
  /** Persist the current draft/buffer. Throws on backend failure (propagated). */
  write: () => Promise<void>;
}

/**
 * Run one target's save behind the disk-change guard. See the module doc for the
 * flow. A `write` failure propagates (the caller keeps the target dirty and shows
 * the error); a Cancel/Reload resolves without writing.
 */
export async function guardedWrite(opts: GuardedWriteOptions): Promise<GuardOutcome> {
  const { capturedSig, fetchSig, confirmConflict, reload, write } = opts;

  if (capturedSig !== null) {
    const current = await fetchSig();
    if (current !== capturedSig) {
      const choice = await confirmConflict();
      if (choice === "cancel") return { kind: "cancelled" };
      if (choice === "reload") {
        await reload();
        return { kind: "reloaded" };
      }
      // "overwrite" falls through to the write below.
    }
  }

  await write();
  return { kind: "written", sig: await fetchSig() };
}

/**
 * Thrown by a target's `save` when the user cancels at the disk-change prompt.
 * The save bus catches it and records the target as CANCELLED (neither saved nor
 * failed), so the toolbar never says "Saved" for a write the user declined.
 */
export class SaveCancelled extends Error {
  constructor() {
    super("save cancelled");
    this.name = "SaveCancelled";
  }
}
