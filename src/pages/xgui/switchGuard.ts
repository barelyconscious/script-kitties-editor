/**
 * switchGuard — the pure warn-on-switch decision (F11). Given the current
 * dirty/open state and the component the user is trying to open, decide whether
 * the switch is allowed to proceed immediately or must be intercepted by the
 * Save / Discard / Cancel prompt.
 *
 * This is the tool's most likely trust-breaking moment (manual save + switching
 * components is the main navigation move — design section 7), so the decision is
 * isolated here and unit-tested off-React: the React shell only renders the
 * prompt the decision asks for and dispatches the choice.
 *
 * @see design/xgui_ta.md — section 7 "Warn on switch".
 */

/** The minimal slice of editor state the switch decision needs. */
export type SwitchGuardState = {
  /** The basename of the currently-open component, or `null` if none is open. */
  openName: string | null;
  /** Whether the open component has unsaved edits. */
  dirty: boolean;
};

/**
 * `"proceed"` — open the target now, no prompt.
 * `"prompt"` — intercept and ask Save / Discard / Cancel before discarding.
 */
export type SwitchDecision = "proceed" | "prompt";

/**
 * Decide whether opening `targetName` should prompt before discarding edits.
 *
 * Prompt ONLY when there is genuinely something to lose: the open component is
 * dirty AND the user is navigating to a DIFFERENT component. Re-selecting the
 * already-open component (even while dirty) is a no-op switch, so it proceeds
 * without nagging. A clean component, or nothing open, always proceeds.
 */
export function decideSwitch(state: SwitchGuardState, targetName: string): SwitchDecision {
  if (!state.dirty) return "proceed";
  if (state.openName == null) return "proceed";
  // Re-opening the same component discards nothing — never prompt for it.
  if (state.openName === targetName) return "proceed";
  return "prompt";
}

/** The user's answer to the Save / Discard / Cancel prompt. */
export type SwitchChoice = "save" | "discard" | "cancel";
