/**
 * componentTemplates — the starter XML bodies the New-component dialog can seed a
 * fresh component with (task 507). Kept as a pure data module (no React) so the
 * dialog stays a thin shell and each template's XML is unit-tested against
 * {@link import("../../lib/guiNode").parseGui} and the tooltip lints directly.
 *
 * A template is just a label + a description + the exact XML a `create_component`
 * call writes. The BLANK template reproduces the dialog's prior default (an empty
 * `<View>`), so choosing it is byte-for-byte the old behavior; the TOOLTIP template
 * scaffolds the shape a `tooltip=` component ref expects — an absolute pixel-sized
 * panel with a bound text line and NO controller (v1 tooltips are presentation-only;
 * see the tooltip lints in {@link import("./guiLints")}).
 *
 * @see design/xgui_ta.md — interaction attributes (tooltip conventions). Ground
 *   truth example: `<gameInstallPath>/gui/kittypacks/gui.kittypacks-tooltip.xml`.
 */

/** One selectable New-component starter. */
export type ComponentTemplate = {
  /** Stable id used for selection state. */
  id: string;
  /** Short human label for the picker. */
  label: string;
  /** One-line description of what the template scaffolds. */
  description: string;
  /** The exact XML body a new component of this template is created with. */
  xml: string;
};

/** The empty `<View>` body a brand-new component defaults to (the prior behavior). */
const BLANK_XML = "<View>\n</View>\n";

/**
 * A tooltip component: a root `<View>` wrapping an ABSOLUTE pixel-sized `<Panel>`
 * (relative width/height zero, so it lays out predictably) with a single bound
 * `<Text>` placeholder. No controller — a tooltip is presentation-only in v1, and
 * its model is seeded by the referencing widget's `tooltipData` binding. Wire it via
 * a widget's `tooltip="<name>.xml"` attribute; the bound `{$.title}` reads from that
 * seeded model.
 */
const TOOLTIP_XML = `<View>
    <Panel id="background" backgroundColor="33,33,33,255" position="0,0,0,0" size="0,0,280,140">
        <Text id="title" text="{$.title}" color="255,255,0,255" position="0,0,8,8" />
    </Panel>
</View>
`;

/** The templates the New-component dialog offers, in display order. */
export const COMPONENT_TEMPLATES: readonly ComponentTemplate[] = [
  {
    id: "blank",
    label: "Blank",
    description: "An empty View to build up from scratch.",
    xml: BLANK_XML,
  },
  {
    id: "tooltip",
    label: "Tooltip",
    description:
      "A pixel-sized panel with a bound text line, no controller — wire it via a widget's tooltip attribute.",
    xml: TOOLTIP_XML,
  },
];

/** The default template id (the blank View — the dialog's prior behavior). */
export const DEFAULT_TEMPLATE_ID = "blank";

/** The template for an id, falling back to the first (blank) when unknown. */
export function templateById(id: string): ComponentTemplate {
  return COMPONENT_TEMPLATES.find((t) => t.id === id) ?? COMPONENT_TEMPLATES[0];
}
