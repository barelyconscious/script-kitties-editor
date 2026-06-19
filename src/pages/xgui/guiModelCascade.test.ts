/**
 * Tests the pure save-time cascade core: given the component set + a resolver + a
 * model reader, it returns the persisted-model rewrites that bring every (closed)
 * component's `data=` objects back in sync with the freshly-saved child shapes.
 */

import { describe, expect, it } from "vitest";
import { parseGui } from "../../lib/guiNode";
import { cascadeModelWrites } from "./guiModelCascade";
import type { ComponentResolver } from "./guiModelScaffold";

const tree = (xml: string) => parseGui(xml);

// A "button" child that now binds only {label}; a "card" parent that includes it.
const button = tree('<View><Text text="{label}"/></View>');
const card = tree('<View><Component src="button" data="buttonProps"/></View>');
const plain = tree('<View><Text text="{title}"/></View>'); // references nothing

const resolve: ComponentResolver = (name) => (name.replace(/\.xml$/, "") === "button" ? button : undefined);

const components = [
  { name: "button", path: "button.xml", root: button },
  { name: "card", path: "widgets/card.xml", root: card },
  { name: "plain", path: "plain.xml", root: plain },
];

describe("cascadeModelWrites", () => {
  it("seeds a never-opened parent's data object from the child shape", () => {
    const writes = cascadeModelWrites(components, resolve, () => undefined);
    const cardWrite = writes.find((w) => w.path === "widgets/card.xml");
    expect(JSON.parse(cardWrite?.text ?? "null")).toEqual({ buttonProps: { label: "label" } });
  });

  it("prune-syncs an existing parent data object to the current child shape", () => {
    const stored: Record<string, string> = {
      "widgets/card.xml": JSON.stringify({ buttonProps: { label: "Save", tint: "stale" } }),
    };
    const writes = cascadeModelWrites(components, resolve, (p) => stored[p]);
    const cardWrite = writes.find((w) => w.path === "widgets/card.xml");
    // `label` value kept, stale `tint` pruned (child no longer binds it).
    expect(JSON.parse(cardWrite?.text ?? "null")).toEqual({ buttonProps: { label: "Save" } });
  });

  it("skips the open component (its model is owned by the live editor)", () => {
    const writes = cascadeModelWrites(components, resolve, () => undefined, "widgets/card.xml");
    expect(writes.some((w) => w.path === "widgets/card.xml")).toBe(false);
  });

  it("emits no write for a component already in sync", () => {
    const stored: Record<string, string> = {
      "widgets/card.xml": JSON.stringify({ buttonProps: { label: "Save" } }),
      "plain.xml": JSON.stringify({ title: "title" }),
    };
    const writes = cascadeModelWrites(components, resolve, (p) => stored[p]);
    expect(writes.some((w) => w.path === "widgets/card.xml")).toBe(false);
    expect(writes.some((w) => w.path === "plain.xml")).toBe(false);
  });
});
