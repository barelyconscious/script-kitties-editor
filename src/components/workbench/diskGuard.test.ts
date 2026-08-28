import { describe, expect, it, vi } from "vitest";
import { guardedWrite } from "./diskGuard";

/** A guardedWrite harness with spy-able hooks and sensible defaults. */
function harness(over: {
  capturedSig?: string | null;
  currentSig?: string;
  postWriteSig?: string;
  choice?: "reload" | "overwrite" | "cancel";
}) {
  let written = false;
  const write = vi.fn(async () => {
    written = true;
  });
  const reload = vi.fn(async () => {});
  const confirmConflict = vi.fn(async () => over.choice ?? "cancel");
  // fetchSig reports the current on-disk signature until the write lands, then the
  // post-write signature — so the count of calls doesn't have to be tracked.
  const fetchSig = vi.fn(async () => (written ? (over.postWriteSig ?? "sig2") : (over.currentSig ?? "sig")));
  const run = () =>
    guardedWrite({
      capturedSig: over.capturedSig === undefined ? "sig" : over.capturedSig,
      fetchSig,
      confirmConflict,
      reload,
      write,
    });
  return { run, write, reload, confirmConflict, fetchSig };
}

describe("guardedWrite", () => {
  it("writes without prompting when the signature is unchanged", async () => {
    const h = harness({ capturedSig: "sig", currentSig: "sig", postWriteSig: "sig2" });
    const outcome = await h.run();
    expect(h.confirmConflict).not.toHaveBeenCalled();
    expect(h.write).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ kind: "written", sig: "sig2" });
  });

  it("skips the conflict check entirely when there is no captured baseline", async () => {
    const h = harness({ capturedSig: null, currentSig: "anything", postWriteSig: "fresh" });
    const outcome = await h.run();
    expect(h.confirmConflict).not.toHaveBeenCalled();
    expect(h.write).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ kind: "written", sig: "fresh" });
  });

  it("prompts on a changed signature and cancels without writing", async () => {
    const h = harness({ capturedSig: "sig", currentSig: "moved", choice: "cancel" });
    const outcome = await h.run();
    expect(h.confirmConflict).toHaveBeenCalledOnce();
    expect(h.write).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: "cancelled" });
  });

  it("prompts on a changed signature and reloads without writing", async () => {
    const h = harness({ capturedSig: "sig", currentSig: "moved", choice: "reload" });
    const outcome = await h.run();
    expect(h.reload).toHaveBeenCalledOnce();
    expect(h.write).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: "reloaded" });
  });

  it("prompts on a changed signature and overwrites when chosen", async () => {
    const h = harness({
      capturedSig: "sig",
      currentSig: "moved",
      postWriteSig: "afterOverwrite",
      choice: "overwrite",
    });
    const outcome = await h.run();
    expect(h.confirmConflict).toHaveBeenCalledOnce();
    expect(h.write).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ kind: "written", sig: "afterOverwrite" });
  });

  it("propagates a write failure (the caller keeps the target dirty)", async () => {
    const write = vi.fn(async () => {
      throw new Error("disk full");
    });
    await expect(
      guardedWrite({
        capturedSig: "sig",
        fetchSig: async () => "sig",
        confirmConflict: async () => "overwrite",
        reload: async () => {},
        write,
      }),
    ).rejects.toThrow("disk full");
  });
});
