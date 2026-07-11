import { afterEach, describe, expect, it, vi } from "vitest";
import { type GuiNode, GuiParseError, mintNodeId, parseGui, serializeGui } from "./guiNode";

/**
 * The worked example from design/xgui_ta.md (Examples section). The round-trip
 * MUST reproduce this losslessly, modulo insignificant whitespace.
 */
const BAG_XML = `<View controller="bag_controller.lua">
  <Event name="OnItemSold" handler="refresh"/>
  <Event name="OnItemBought" handler="refresh"/>

  <Panel id="root" position="1,0,-300,0" size="0,1,300,-32"
         borderColor="0,0,0,255" backgroundColor="0,0,0,255">

    <Component id="closeButton" src="close_button.xml"
               position="1,0,-50,8" size="0,0,32,32"/>

    <Text id="title" position="0,0,0,18" size="1,0,0,32"
          textAlign="CENTER" fontSize="22" text="Bag"/>

    <Panel id="moneyBg" position="0,0,18,318" size="1,0,-38,36"
           borderColor="255,255,0,255"
           onMouseEntered="showHint" onMouseExited="hideHint">
      <Panel id="coin" position="0,0,2,2" size="0,0,32,32"
             texture="gui_kittycoin.png"/>
      <Text  id="money" position="0,0,40,12" size="1,1,0,0"
             text="{money}"/>
      <Text  id="hint" position="0,0,0,40" size="1,0,0,0"
             text="Money used to buy things." visible="false"/>
    </Panel>

    <Component id="slot1" src="bag_slot.xml"
               actionText="Right click to sell" onMouseClicked="sellItem"/>
    <Component id="slot2" src="bag_slot.xml"
               actionText="Right click to sell" onMouseClicked="sellItem"/>
    <Component id="slot3" src="bag_slot.xml"
               actionText="Right click to sell" onMouseClicked="sellItem"/>
  </Panel>
</View>`;

/** Structural projection of a tree with nodeId stripped — the round-trip invariant. */
type Shape = { tag: string; attrs: Record<string, string>; children: Shape[] };
function shapeOf(node: GuiNode): Shape {
  return {
    tag: node.tag,
    attrs: node.attrs,
    children: node.children.map(shapeOf),
  };
}

describe("parseGui + serializeGui round-trip", () => {
  it("re-parsing serialized bag.xml yields an identical tree shape (modulo whitespace)", () => {
    const tree = parseGui(BAG_XML);
    const serialized = serializeGui(tree);
    const reparsed = parseGui(serialized);
    expect(shapeOf(reparsed)).toEqual(shapeOf(tree));
  });

  it("serialize is idempotent: serialize(parse(serialize(parse(x)))) === serialize(parse(x))", () => {
    const once = serializeGui(parseGui(BAG_XML));
    const twice = serializeGui(parseGui(once));
    expect(twice).toBe(once);
  });

  it("preserves every element, attribute, nesting, and value from bag.xml", () => {
    const root = parseGui(BAG_XML);

    expect(root.tag).toBe("View");
    expect(root.attrs).toEqual({ controller: "bag_controller.lua" });

    // The two <Event> children are IGNORED (dropped at parse) — the root Panel is the
    // View's only surviving child.
    expect(root.children).toHaveLength(1);
    const [rootPanel] = root.children;
    expect(rootPanel.tag).toBe("Panel");
    expect(rootPanel.attrs).toEqual({
      id: "root",
      position: "1,0,-300,0",
      size: "0,1,300,-32",
      borderColor: "0,0,0,255",
      backgroundColor: "0,0,0,255",
    });

    // close_button Component, title Text, moneyBg Panel, then 3 slot Components.
    const childTags = rootPanel.children.map((c) => c.tag);
    expect(childTags).toEqual([
      "Component",
      "Text",
      "Panel",
      "Component",
      "Component",
      "Component",
    ]);

    const moneyBg = rootPanel.children[2];
    expect(moneyBg.children.map((c) => c.tag)).toEqual(["Panel", "Text", "Text"]);

    const hint = moneyBg.children[2];
    expect(hint.attrs).toEqual({
      id: "hint",
      position: "0,0,0,40",
      size: "1,0,0,0",
      text: "Money used to buy things.",
      visible: "false",
    });
  });
});

describe("attrs are raw, verbatim strings", () => {
  it("stores {token}, palette names, and comma-strings untouched", () => {
    const root = parseGui(`<View>
      <Text id="money" text="{money}" color="TextDefault" position="1,0,0,5"/>
    </View>`);
    const text = root.children[0];
    expect(text.attrs.text).toBe("{money}");
    expect(text.attrs.color).toBe("TextDefault");
    expect(text.attrs.position).toBe("1,0,0,5");
  });

  it("does not interpret interpolated string values", () => {
    const root = parseGui(`<View><Text text="Health: {health}/{maxHealth}"/></View>`);
    expect(root.children[0].attrs.text).toBe("Health: {health}/{maxHealth}");
  });

  it("preserves authored attribute order through a round-trip", () => {
    const xml = `<View><Panel z="1" a="2" m="3"/></View>`;
    const serialized = serializeGui(parseGui(xml));
    expect(serialized).toContain(`<Panel z="1" a="2" m="3"/>`);
  });

  it("round-trips XML entities in attribute values", () => {
    const root = parseGui(`<View><Text text="a &lt; b &amp; c &gt; d &quot;q&quot;"/></View>`);
    expect(root.children[0].attrs.text).toBe('a < b & c > d "q"');
    const serialized = serializeGui(root);
    expect(serialized).toContain(`text="a &lt; b &amp; c &gt; d &quot;q&quot;"`);
    // And it parses back to the same decoded value.
    expect(parseGui(serialized).children[0].attrs.text).toBe('a < b & c > d "q"');
  });
});

describe("legacy attribute migration (textColor -> color)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rewrites textColor to color at parse time", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = parseGui(`<View><Text id="hp" textColor="255,0,0,255"/></View>`);
    const text = root.children[0];
    expect(text.attrs.color).toBe("255,0,0,255");
    expect("textColor" in text.attrs).toBe(false);
  });

  it("preserves the authored attribute position when migrating", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const xml = `<View><Text text="{n}" textColor="TextDefault" fontSize="18"/></View>`;
    const serialized = serializeGui(parseGui(xml));
    expect(serialized).toContain(`<Text text="{n}" color="TextDefault" fontSize="18"/>`);
  });

  it("emits a warn-only lint flagging the residual textColor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseGui(`<View><Text id="hp" textColor="255,0,0,255"/></View>`);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("textColor");
    expect(warn.mock.calls[0][0]).toContain(`id="hp"`);
  });

  it("keeps an authored color and drops the legacy textColor when both exist", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = parseGui(`<View><Text color="1,1,1,255" textColor="9,9,9,255"/></View>`);
    const text = root.children[0];
    expect(text.attrs.color).toBe("1,1,1,255");
    expect("textColor" in text.attrs).toBe(false);
  });

  it("does not warn or alter nodes without textColor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = parseGui(`<View><Text color="1,1,1,255"/></View>`);
    expect(root.children[0].attrs.color).toBe("1,1,1,255");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("nodeId", () => {
  it("mints a unique nodeId per node", () => {
    const root = parseGui(BAG_XML);
    const ids = new Set<string>();
    const visit = (n: GuiNode) => {
      ids.add(n.nodeId);
      n.children.forEach(visit);
    };
    visit(root);
    // 1 View + 1 Panel + (1 Component + 1 Text + 1 Panel + 3 Components)
    //   + (moneyBg: 1 Panel + 2 Text) = 11 nodes. The two <Event>s are ignored.
    const count = (n: GuiNode): number => 1 + n.children.reduce((s, c) => s + count(c), 0);
    expect(count(root)).toBe(11);
    expect(ids.size).toBe(11);
  });

  it("never appears in serialized output", () => {
    const serialized = serializeGui(parseGui(BAG_XML));
    expect(serialized).not.toContain("nodeId");
  });

  it("mintNodeId returns distinct values", () => {
    const a = mintNodeId();
    const b = mintNodeId();
    expect(a).not.toBe(b);
  });
});

describe("structural rules", () => {
  it("rejects a non-View top-level element", () => {
    expect(() => parseGui(`<Panel id="x"/>`)).toThrow(GuiParseError);
  });

  it("ignores an <Event> child of <View> (events live in Lua, not the XML)", () => {
    const root = parseGui(
      `<View><Event name="X" handler="h"/><Panel id="p"/><Event name="Y" handler="g"/></View>`,
    );
    // Both <Event>s are dropped; only the <Panel> survives.
    expect(root.children.map((c) => c.tag)).toEqual(["Panel"]);
  });

  it("ignores an <Event> wherever it appears, including nested under a Panel", () => {
    const root = parseGui(
      `<View><Panel id="p"><Event name="X" handler="h"/><Text id="t"/></Panel></View>`,
    );
    expect(root.children[0].children.map((c) => c.tag)).toEqual(["Text"]);
  });

  it("ignores an <Event> that has its own (dropped) subtree", () => {
    const root = parseGui(
      `<View><Event name="X" handler="h"><Panel id="ghost"/></Event><Panel id="real"/></View>`,
    );
    expect(root.children.map((c) => c.attrs.id)).toEqual(["real"]);
  });

  it("drops <Event> elements from the serialized output", () => {
    const serialized = serializeGui(
      parseGui(`<View><Event name="X" handler="h"/><Panel id="p"/></View>`),
    );
    expect(serialized).not.toContain("Event");
  });

  it("rejects a <Component> with children", () => {
    expect(() =>
      parseGui(`<View><Component id="c" src="s.xml"><Panel id="p"/></Component></View>`),
    ).toThrow("<Component> cannot have children");
  });

  it("accepts a self-closing <Component>", () => {
    const root = parseGui(`<View><Component id="c" src="s.xml"/></View>`);
    expect(root.children[0]).toMatchObject({ tag: "Component", children: [] });
  });

  it("accepts an empty-bodied <Component> and serializes it self-closing", () => {
    const root = parseGui(`<View><Component id="c" src="s.xml"></Component></View>`);
    expect(serializeGui(root)).toContain(`<Component id="c" src="s.xml"/>`);
  });

  it("rejects an unknown element", () => {
    expect(() => parseGui(`<View><Widget id="w"/></View>`)).toThrow(/Unknown element <Widget>/);
  });

  it("serializes a childless element as a self-closing tag", () => {
    const root = parseGui(`<View><Panel id="empty"></Panel></View>`);
    expect(serializeGui(root)).toContain(`<Panel id="empty"/>`);
  });
});

describe("GridLayout structural rules", () => {
  it("accepts a GridLayout with a single Text child under a View", () => {
    const root = parseGui(
      `<View><GridLayout dataCollection="items" rows="6" columns="6"><Text id="items" text="{name}"/></GridLayout></View>`,
    );
    const grid = root.children[0];
    expect(grid.tag).toBe("GridLayout");
    expect(grid.children).toHaveLength(1);
    expect(grid.children[0].tag).toBe("Text");
  });

  it("accepts a GridLayout under a Panel", () => {
    const root = parseGui(
      `<View><Panel id="p"><GridLayout><Panel id="slots"/></GridLayout></Panel></View>`,
    );
    expect(root.children[0].children[0].tag).toBe("GridLayout");
  });

  it("accepts a Panel and a Component as grid children", () => {
    expect(() =>
      parseGui(`<View><GridLayout><Panel id="slots"/></GridLayout></View>`),
    ).not.toThrow();
    expect(() =>
      parseGui(`<View><GridLayout><Component id="slots" src="bag_slot.xml"/></GridLayout></View>`),
    ).not.toThrow();
  });

  it("round-trips a GridLayout and its attributes verbatim through serializeGui", () => {
    const xml = `<View>\n  <GridLayout dataCollection="items" rows="6" columns="6" gutter="5,5">\n    <Text id="items" text="{name}"/>\n  </GridLayout>\n</View>\n`;
    expect(serializeGui(parseGui(xml))).toBe(xml);
  });

  it("rejects a GridLayout with more than one child element", () => {
    expect(() =>
      parseGui(`<View><GridLayout><Panel id="a"/><Panel id="b"/></GridLayout></View>`),
    ).toThrow(/at most one child/);
  });

  it("ignores an <Event> inside a GridLayout, leaving the grid empty", () => {
    // <Event> is dropped everywhere, so a grid whose only authored child is an
    // <Event> parses to an empty (childless) grid rather than throwing.
    const root = parseGui(`<View><GridLayout><Event name="X" handler="h"/></GridLayout></View>`);
    expect(root.children[0].tag).toBe("GridLayout");
    expect(root.children[0].children).toEqual([]);
  });

  it("rejects a GridLayout under a parent other than Panel/View (e.g. Text)", () => {
    expect(() =>
      parseGui(`<View><Text id="t"><GridLayout><Panel id="p"/></GridLayout></Text></View>`),
    ).toThrow(/child of <Panel> or <View>/);
  });

  it("rejects a nested GridLayout (a grid cannot contain another grid)", () => {
    // The inner GridLayout is rejected because its parent is a GridLayout, not
    // Panel/View — nesting is forbidden two ways.
    expect(() =>
      parseGui(`<View><GridLayout><GridLayout><Panel id="p"/></GridLayout></GridLayout></View>`),
    ).toThrow(/child of <Panel> or <View>/);
  });

  it("rejects more than one GridLayout among a View's children", () => {
    expect(() =>
      parseGui(
        `<View><GridLayout><Panel id="a"/></GridLayout><GridLayout><Panel id="b"/></GridLayout></View>`,
      ),
    ).toThrow(/at most one <GridLayout>/);
  });

  it("rejects more than one GridLayout among a Panel's children", () => {
    expect(() =>
      parseGui(
        `<View><Panel id="p"><GridLayout><Panel id="a"/></GridLayout><GridLayout><Panel id="b"/></GridLayout></Panel></View>`,
      ),
    ).toThrow(/at most one <GridLayout>/);
  });

  it("accepts a GridLayout as the only child directly under a View (root grid)", () => {
    expect(() =>
      parseGui(`<View><GridLayout dataCollection="items"><Panel id="slots"/></GridLayout></View>`),
    ).not.toThrow();
  });
});

describe("parse error handling", () => {
  it("rejects an empty document", () => {
    expect(() => parseGui("   ")).toThrow(/Empty document/);
  });

  it("rejects mismatched closing tags", () => {
    expect(() => parseGui(`<View><Panel id="p"></Text></View>`)).toThrow(GuiParseError);
  });

  it("rejects an unclosed element", () => {
    expect(() => parseGui(`<View><Panel id="p"></View>`)).toThrow(GuiParseError);
  });

  it("rejects unquoted attribute values", () => {
    expect(() => parseGui(`<View><Panel id=p/></View>`)).toThrow(/must be quoted/);
  });

  it("rejects significant text content between elements", () => {
    expect(() => parseGui(`<View>hello<Panel id="p"/></View>`)).toThrow(/Unexpected text content/);
  });

  it("rejects content after the top-level element", () => {
    expect(() => parseGui(`<View/><Panel id="p"/>`)).toThrow(/after the top-level element/);
  });

  it("ignores an XML declaration and comments", () => {
    const root = parseGui(`<?xml version="1.0"?>\n<!-- a bag --><View><Panel id="p"/></View>`);
    expect(root.tag).toBe("View");
    expect(root.children[0].attrs.id).toBe("p");
  });
});
