/**
 * GuiNode — the frontend's single source of truth for an open GUI component.
 *
 * The editor edits a parsed in-memory tree of {@link GuiNode}s; XML text is only
 * a serialization boundary (parse at load, serialize at save). Every editor
 * surface — tree, properties, preview, drag-writeback — reads and writes the
 * SAME node objects, joined by {@link GuiNode.nodeId}.
 *
 * This module is the model + parse + serialize ONLY. It does no semantic
 * interpretation of attribute values (tokens, palette names, position/size
 * fields are stored verbatim — those are render-time concerns) and no
 * rendering or UI.
 *
 * @see design/xgui_ta.md — "XML Elements", "Elements in more detail", and the
 *   worked `bag.xml` example, which the round-trip reproduces losslessly
 *   (modulo insignificant whitespace).
 */

/** The element tags the editor models. */
export type GuiTag = "View" | "Panel" | "Text" | "Component" | "GridLayout";

/** The modeled tags, as a runtime set for parse-time validation. */
const KNOWN_TAGS = new Set<GuiTag>(["View", "Panel", "Text", "Component", "GridLayout"]);

/**
 * Tags the parser ENCOUNTERS but deliberately IGNORES — dropped along with their
 * whole subtree at parse time, as if they were never in the XML. `<Event>` handling
 * moved entirely into the Lua controller (contract update 2026-07-11): the editor no
 * longer authors, reads, or preserves event registrations, so an `<Event>` in a
 * component's XML is skipped on load and is absent from the re-serialized file.
 */
const IGNORED_TAGS = new Set<string>(["Event"]);

/** The tags a {@link GuiTag GridLayout} may wrap as its single child. */
const GRID_CHILD_TAGS = new Set<GuiTag>(["Panel", "Text", "Component"]);

/**
 * A single element in a GUI component tree.
 *
 * - `nodeId` is an editor-internal handle, minted at parse/create time, stable
 *   for the node's lifetime within a session, and NEVER serialized. It is
 *   distinct from the authored `id` attribute (which lives in `attrs.id`).
 * - `attrs` stores every attribute as a RAW VERBATIM string exactly as authored
 *   (`"0.5"`, `"{healthRatio}"`, `"TextDefault"`, `"1,0,0,5"`). Binding / literal
 *   / palette interpretation is a render-time concern, not stored state.
 */
export type GuiNode = {
  /** Editor-internal, stable for the node's lifetime; NOT serialized. */
  nodeId: string;
  tag: GuiTag;
  /** Raw authored attribute strings, in authored order, verbatim. */
  attrs: Record<string, string>;
  children: GuiNode[];
};

/** Monotonic counter backing {@link mintNodeId}; session-only. */
let nodeIdCounter = 0;

/**
 * Mint a fresh, session-only node id. Stable within a session, never
 * serialized. Exposed so editor surfaces that create nodes (add-child, paste)
 * mint ids the same way parse does.
 */
export function mintNodeId(): string {
  nodeIdCounter += 1;
  return `n${nodeIdCounter}`;
}

/** An error raised when XML cannot be parsed into a valid GuiNode tree. */
export class GuiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuiParseError";
  }
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

type Token =
  | { kind: "open"; tag: string; attrs: Record<string, string>; selfClosing: boolean }
  | { kind: "close"; tag: string };

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_:.-]/;

/**
 * Tokenize the XML into a flat stream of open/close element tokens. Text nodes,
 * XML declarations, comments, and processing instructions are skipped — GUI
 * components are pure element trees (no significant text content), so anything
 * between tags that is not whitespace is a parse error.
 */
function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = xml.length;

  while (i < n) {
    if (xml[i] !== "<") {
      // Outside a tag: only insignificant whitespace is permitted.
      const start = i;
      while (i < n && xml[i] !== "<") i += 1;
      const text = xml.slice(start, i);
      if (text.trim() !== "") {
        throw new GuiParseError(
          `Unexpected text content outside of a tag: ${JSON.stringify(text.trim())}`,
        );
      }
      continue;
    }

    // Comments / declarations / processing instructions — skip wholesale.
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end === -1) throw new GuiParseError("Unterminated comment");
      i = end + 3;
      continue;
    }
    if (xml[i + 1] === "?" || xml[i + 1] === "!") {
      const end = xml.indexOf(">", i);
      if (end === -1) throw new GuiParseError("Unterminated declaration / processing instruction");
      i = end + 1;
      continue;
    }

    // Closing tag: </tag>
    if (xml[i + 1] === "/") {
      i += 2;
      const nameStart = i;
      while (i < n && NAME_CHAR.test(xml[i])) i += 1;
      const tag = xml.slice(nameStart, i);
      while (i < n && /\s/.test(xml[i])) i += 1;
      if (xml[i] !== ">") throw new GuiParseError(`Malformed closing tag for </${tag}>`);
      i += 1;
      tokens.push({ kind: "close", tag });
      continue;
    }

    // Opening (or self-closing) tag.
    i += 1; // consume '<'
    if (!NAME_START.test(xml[i] ?? "")) throw new GuiParseError("Expected element name after '<'");
    const nameStart = i;
    while (i < n && NAME_CHAR.test(xml[i])) i += 1;
    const tag = xml.slice(nameStart, i);

    const attrs: Record<string, string> = {};
    while (true) {
      while (i < n && /\s/.test(xml[i])) i += 1;
      if (i >= n) throw new GuiParseError(`Unterminated tag <${tag}>`);
      if (xml[i] === ">" || (xml[i] === "/" && xml[i + 1] === ">")) break;

      // Attribute name.
      if (!NAME_START.test(xml[i])) {
        throw new GuiParseError(
          `Malformed attribute in <${tag}> near ${JSON.stringify(xml.slice(i, i + 12))}`,
        );
      }
      const attrNameStart = i;
      while (i < n && NAME_CHAR.test(xml[i])) i += 1;
      const attrName = xml.slice(attrNameStart, i);
      while (i < n && /\s/.test(xml[i])) i += 1;
      if (xml[i] !== "=") {
        throw new GuiParseError(`Attribute "${attrName}" in <${tag}> must have a value`);
      }
      i += 1; // consume '='
      while (i < n && /\s/.test(xml[i])) i += 1;
      const quote = xml[i];
      if (quote !== '"' && quote !== "'") {
        throw new GuiParseError(`Attribute "${attrName}" in <${tag}> must be quoted`);
      }
      i += 1; // consume opening quote
      const valStart = i;
      while (i < n && xml[i] !== quote) i += 1;
      if (i >= n)
        throw new GuiParseError(`Unterminated value for attribute "${attrName}" in <${tag}>`);
      const rawValue = xml.slice(valStart, i);
      i += 1; // consume closing quote
      if (attrName in attrs) {
        throw new GuiParseError(`Duplicate attribute "${attrName}" in <${tag}>`);
      }
      attrs[attrName] = unescapeXml(rawValue);
    }

    let selfClosing = false;
    if (xml[i] === "/") {
      selfClosing = true;
      i += 1; // consume '/'
    }
    if (xml[i] !== ">") throw new GuiParseError(`Malformed tag <${tag}>`);
    i += 1; // consume '>'
    tokens.push({ kind: "open", tag, attrs, selfClosing });
  }

  return tokens;
}

/**
 * Auto-migrate legacy attribute names at parse time.
 *
 * The editor historically wrote `textColor` on `<Text>` — but that was a typo:
 * the shipped C++ engine reads `color` for every widget (`GUILoader.cpp:713`),
 * so an authored `textColor` is silently dropped in-game. We rewrite it to
 * `color` here (preserving its authored position) so a loaded component upgrades
 * on its next save, and emit a WARN-ONLY lint so any straggler in the live gui
 * tree — which isn't visible from this repo — is surfaced rather than dropped
 * silently. If a node somehow carries both, the authored `color` wins and the
 * legacy `textColor` is discarded.
 */
function normalizeLegacyAttrs(tag: string, attrs: Record<string, string>): Record<string, string> {
  if (!("textColor" in attrs)) return attrs;

  const idPart = attrs.id ? ` id="${attrs.id}"` : "";
  console.warn(
    `[xgui] <${tag}${idPart}> uses legacy "textColor"; the engine reads "color". ` +
      'Migrating to "color" — save the component to persist the fix.',
  );

  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "textColor") {
      // Slot `color` into `textColor`'s position — unless an authored `color`
      // already exists, in which case keep that and drop the legacy alias.
      if (!("color" in attrs)) next.color = value;
    } else {
      next[key] = value;
    }
  }
  return next;
}

/**
 * Parse XML text into a GuiNode tree.
 *
 * Mints a fresh session-only `nodeId` per node and stores every attribute as a
 * raw verbatim string. Enforces the structural rules:
 * - exactly one top-level element, which MUST be `<View>`;
 * - `<Event>` elements (and their subtrees) are IGNORED wherever they appear —
 *   skipped at parse time so they never enter the tree (see {@link IGNORED_TAGS});
 * - `<Component>` may not have children;
 * - `<GridLayout>` is a non-visual control element that repeats a single child:
 *   it may appear ONLY as a child of `<Panel>` or `<View>` (so it can never nest
 *   inside another GridLayout); it may have AT MOST ONE child, whose tag must be
 *   `<Panel>`, `<Text>`, or `<Component>`; and a `<Panel>`/`<View>` may contain at
 *   most ONE `<GridLayout>` among its children (a grid fills its container, so
 *   sibling grids are meaningless). Lenient repair is NOT wanted — invalid
 *   hand-authored XML throws here, and the tree editor prevents authoring it.
 */
export function parseGui(xml: string): GuiNode {
  const tokens = tokenize(xml);
  if (tokens.length === 0)
    throw new GuiParseError("Empty document — expected a <View> root element");

  let pos = 0;

  /**
   * Consume an IGNORED element (e.g. `<Event>`) and its entire subtree from the token
   * stream WITHOUT emitting a node — the element is treated as if it weren't in the
   * XML. Balances open/close depth (a self-closing open needs no matching close), so a
   * nested body is skipped wholesale.
   */
  function skipIgnoredElement(): void {
    const open = tokens[pos];
    pos += 1; // consume the opening token
    if (open.kind !== "open" || open.selfClosing) return;
    let depth = 1;
    while (pos < tokens.length && depth > 0) {
      const t = tokens[pos];
      pos += 1;
      if (t.kind === "open") {
        if (!t.selfClosing) depth += 1;
      } else {
        depth -= 1;
      }
    }
  }

  function parseElement(parentTag: GuiTag | null): GuiNode {
    const token = tokens[pos];
    if (!token || token.kind !== "open") {
      throw new GuiParseError("Expected an opening element");
    }
    pos += 1;

    if (!KNOWN_TAGS.has(token.tag as GuiTag)) {
      throw new GuiParseError(`Unknown element <${token.tag}>`);
    }
    const tag = token.tag as GuiTag;

    // Structural rules.
    if (tag === "View" && parentTag !== null) {
      throw new GuiParseError("<View> may only appear as the top-level element");
    }
    if (tag === "GridLayout") {
      // A GridLayout fills its container, so it lives ONLY under a Panel or View.
      // This also forbids nesting a GridLayout inside another GridLayout (a
      // GridLayout's only legal child is Panel/Text/Component — see below — so a
      // nested grid is rejected both ways).
      if (parentTag !== "Panel" && parentTag !== "View") {
        throw new GuiParseError("<GridLayout> may only appear as a child of <Panel> or <View>");
      }
    }

    const node: GuiNode = {
      nodeId: mintNodeId(),
      tag,
      attrs: normalizeLegacyAttrs(tag, token.attrs),
      children: [],
    };

    if (token.selfClosing) return node;

    if (tag === "Component") {
      // A <Component> with an explicit body is only valid if that body is empty.
      // Parse to its matching close, rejecting any child element.
      while (pos < tokens.length) {
        const next = tokens[pos];
        if (next.kind === "close") {
          if (next.tag !== tag)
            throw new GuiParseError(`Mismatched closing tag </${next.tag}> (expected </${tag}>)`);
          pos += 1;
          return node;
        }
        if (next.kind === "open" && IGNORED_TAGS.has(next.tag)) {
          skipIgnoredElement();
          continue;
        }
        throw new GuiParseError("<Component> cannot have children");
      }
      throw new GuiParseError(`Unclosed <${tag}>`);
    }

    while (pos < tokens.length) {
      const next = tokens[pos];
      if (next.kind === "close") {
        if (next.tag !== tag) {
          throw new GuiParseError(`Mismatched closing tag </${next.tag}> (expected </${tag}>)`);
        }
        pos += 1;
        return node;
      }
      if (next.kind === "open" && IGNORED_TAGS.has(next.tag)) {
        // Ignored elements (e.g. <Event>) are dropped wholesale — never a child.
        skipIgnoredElement();
        continue;
      }
      const child = parseElement(tag);
      node.children.push(child);

      if (tag === "GridLayout") {
        // A GridLayout repeats a SINGLE child, whose tag must be one of
        // Panel | Text | Component.
        if (!GRID_CHILD_TAGS.has(child.tag)) {
          throw new GuiParseError(
            `<GridLayout> may only contain a <Panel>, <Text>, or <Component> child, found <${child.tag}>`,
          );
        }
        if (node.children.length > 1) {
          throw new GuiParseError("<GridLayout> may have at most one child element");
        }
      } else if ((tag === "Panel" || tag === "View") && child.tag === "GridLayout") {
        // A Panel/View may contain at most ONE GridLayout among its children
        // (a grid fills its container, so sibling grids are meaningless).
        if (node.children.filter((c) => c.tag === "GridLayout").length > 1) {
          throw new GuiParseError(`<${tag}> may contain at most one <GridLayout> child`);
        }
      }
    }

    throw new GuiParseError(`Unclosed <${tag}>`);
  }

  const root = parseElement(null);
  if (root.tag !== "View") {
    throw new GuiParseError(`Top-level element must be <View>, found <${root.tag}>`);
  }
  if (pos !== tokens.length) {
    throw new GuiParseError("Unexpected content after the top-level element");
  }
  return root;
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

const INDENT = "  ";

/**
 * Serialize a GuiNode tree back to XML text. Attributes are written back
 * verbatim (escaped only as needed for XML validity) and `nodeId` is omitted.
 * A node with no children is written as a self-closing tag.
 */
export function serializeGui(root: GuiNode): string {
  const lines: string[] = [];

  function write(node: GuiNode, depth: number): void {
    const pad = INDENT.repeat(depth);
    const attrs = Object.entries(node.attrs)
      .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
      .join("");

    if (node.children.length === 0) {
      lines.push(`${pad}<${node.tag}${attrs}/>`);
      return;
    }

    lines.push(`${pad}<${node.tag}${attrs}>`);
    for (const child of node.children) write(child, depth + 1);
    lines.push(`${pad}</${node.tag}>`);
  }

  write(root, 0);
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// XML entity escaping
// ---------------------------------------------------------------------------

/** Decode the five predefined XML entities found in an attribute value. */
function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Encode the characters that must be escaped inside a double-quoted attribute
 * value. `&` is escaped first so it does not double-encode the others.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
