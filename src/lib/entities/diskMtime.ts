/**
 * diskMtime — the Workbench's optimistic-concurrency signal. Every editable
 * target (a data record's backing `Data/*.json` file(s), or a script's `.lua`)
 * has a last-modified time on disk. A pane captures that mtime when it LOADS a
 * record and re-checks it when the user SAVES: if the on-disk mtime moved, the
 * file was edited out from under the editor, so the save must warn before
 * clobbering (see {@link import("../../components/workbench/diskGuard")}).
 *
 * We collapse the mtime(s) into a single opaque SIGNATURE string so a caller can
 * compare with `===` without caring how many files back the target (a joined
 * item row watches two files). A `null` signature means "no baseline captured
 * yet" — callers skip the conflict check until a real signature exists.
 *
 * The mtime lives on disk, not in the in-memory record, so this is immune to the
 * backend's save normalization (key ordering, zero-stripping) that made a
 * content-comparison echo filter so fragile.
 */

import { invoke } from "@tauri-apps/api/core";
import type { EntityKind } from "./dataVersion";

/** Sentinel in a signature for a file that is absent/unreadable (null mtime). */
const ABSENT = "∅";

/**
 * The mtime signature for a set of data domains — a stable, order-independent
 * string built from each kind's `Data/*.json` mtime (epoch millis). Two calls
 * return the same string iff none of the backing files changed on disk between
 * them.
 */
export async function fetchDataMtimeSig(kinds: readonly EntityKind[]): Promise<string> {
  const mtimes = await invoke<Record<string, number | null>>("get_data_mtimes", {
    kinds: [...kinds],
  });
  return [...kinds]
    .sort()
    .map((kind) => `${kind}:${mtimes[kind] ?? ABSENT}`)
    .join("|");
}

/**
 * The mtime signature for a single script `.lua`, resolved by logical name. The
 * script sibling of {@link fetchDataMtimeSig}.
 */
export async function fetchScriptMtimeSig(name: string): Promise<string> {
  const mtime = await invoke<number | null>("get_script_mtime", { name });
  return `${name}:${mtime ?? ABSENT}`;
}
