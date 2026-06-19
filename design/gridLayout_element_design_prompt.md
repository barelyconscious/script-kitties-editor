# GridLayout Element Design

## Supersessions

Any decision this document makes should be considered as superseding previously "locked-in" decisions around handling repeated elements. 

1. the forEach attribute and its surface semantics are removed; the scoping/stamping/scaffold internals are retained
  and simplified
   1. All existing forEach code should be removed
   2. The forEach's purpose will be replaced with GridLayout, VerticalLayout, HorizontalLayout, and others as needed to backfill its intended purpose
2. Root access from nested components (eg the `$.thing`) is dropped. YAGNI
3. GridLayouts cannot be nested

## How to use this doc

The purpose of this doc is to describe a new feature being added to the Script Kitties Editor project. The audience is an LLM and this file should be treated as instructions for how to build out the feature. As an LLM, your job is to respect the spirit of these instructions with the freedom to challenge anything that seems contradictory, inconsistent, incongruent, or introduces pitfalls the author did not consider. You may stop at any point during implementation to raise concerns to the user as they come up.

## Overview

For the GUI View XML behavior we will add a new element type, GridLayout. The purpose of this element is to repeat the child element based on a specified iterable collection. Each item in a collection is forwarded as the data model to the child element. The child element is not made explicitly aware that it is in a GridLayout (ie - no `index` property and no direct access to the collection). A GridLayout contains exactly 1 child element. A repeated element gets its position and size assigned by the GridLayout. The way in which the GridLayout calculates the position and size is discussed further below.

## Requirements
1. The GUI editor must not allow more than 1 child element to be present in a GridLayout. There should not be a `+` icon nor should the right-click context menu afford the option to add multiple child elements. Loading XML with multiple child elements 1) flags the element in the tree view with an error icon and 2) refuses to render anything to the screen until the user fixes the XML
2. The GridLayout element does not have an `id` and cannot be referenced by any Lua code. The GridLayout is used by the GUI engine to build components.
3. The GUI preview panel must:
   1. expand the GridLayout element and render as many elements as declared as if they were individual elements but they cannot be individually selected (only the GridLayout's parent element can be selected and moved around the preview).
   2. pass along iterable data declared in the data model preview panel so that the preview can be more accurate
   3. treat the GridLayout's parent container as a single component when moving. ie- the user must not be able to move individual, repeated elements. The whole GridLayout is essentially treated like a separate component
4. Components cannot override their position or size when a child of a GridLayout. The GridLayout thus exclusively owns the responsibility of calculating and setting these properties. The calculation is described in more detail below
5. The GridLayout does not define position or size attributes directly. Instead, the GridLayout effectively sets position="0,0,0,0" and size="1,1,0,0" so that it has the entire space of its container to fill out the repeated components
6. The expanded children will not be present in the Tree view - only the rendered preview.

## Out of scope

1. Lua bindings, C++ GUI engine implementation specifics

## Attributes

Unless explicitly noted below, tokens (eg, "{text}") are not supported and are instead processed as literals.

The GridLayout element has the following attributes:
- `dataCollection` - required - similar to `data` for other components, but is suffixed with `Collection` for clarity
  - Example: `dataCollection="items"` where items is an iterable collection
  - The value of `dataCollection` is treated like a token, not a literal, and is derived from the data model. ie - no need to use `{}`. This is similar to the `data` attribute implementation.
  - `dataCollection` will generally be an iterable collection of _objects_ so that child elements can index fields from the data model. A collection of non-object primitives and strings will be rendered but by fact there will be no indexable fields within the child element, which is fine behavior for our use cases
- `gutter` - optional - defines the space between elements
  - Example: `gutter="0,5"` means "0 horizontal spacing, 5px vertical spacing"
  - Default value: "0,0"
- `rows` - optional - defines how many rows to create
  - Example: `rows="1"`
  - Default value: "1". Raises a warning for "0" and safely renders nothing (since there are no slots to render an element)
- `columns` - optional - defines how many columns to create
  - Example: `columns="1"`
  - Default value: "1". Raises a warning for "0" and safely renders nothing (since there are no slots to render an element)

## Calculating Position and Size of Expanded Children

The GridLayout element internally calculates the size and position of its expanded children. The child elements' position and size attributes, if specified in their own definitions, are thusly effectively ignored.

The GridLayout element does not expose a size or position itself so as to avoid confusion - the user may think size/position refers to each child element instead of the GridLayout as a container. Users are meant to use GridLayout as a control element rather than a display element, similar to the Event element.

Children in a GridLayout are rendered to fill the maximum amount of space in a grid based on the values of `rows` and `columns`. The `gutter` is included as part of the size of an element when factoring the size in. In the editor, the child element properties for size and position should not be editable.

Items are populated left-to-right, top-to-bottom:
+---+---+---+---+
| 1 | 2 | 3 | 4 |
+---+---+---+---+
| 5 | 6 | 7 | 8 |
+---+---+---+---+

## Caveats
1. A GridLayout may appear as the root directly under a View. In this case, treat size="1,1,0,0" and position="0,0,0,0" for rendering.
2. A GridLayout does not have an `id` and cannot be directly addressed by Lua controllers. 
   1. Instead, for Lua bindings to work, the child within a GridLayout should use a plural name for its id. The id will be expanded in lua as the name of the iterable instead of a single element (eg - `view.items[1]` where `items` is the `id` of a child within a GridLayout). This is a convention _users_ should follow. It cannot be enforced and that's okay.
3. The editor's data model preview needs to be able to understand how a GridLayout's dataCollection interacts with child element's tokens in that the data model preview needs to recognize "this is an array called {...}" and the elements look like "{...}" based on the child elements specified tokens. By default it only adds 1 element to the array with this structure. If the user has already added multiple elements, add/adjust any tokens added/removed/edited across the entire list.
4. A GridLayout may only contain a Panel, Text, or Component child element.
5. If a collection has more elements than a grid would support, the excess elements are effectively ignored and not rendered. If there are fewer elements than a grid would expect, all elements are still rendered, those excess elements will get `null` items. Elements that attempt to access a token on an item that is `null` will treat that attribute as not specified. In effect, this means whatever attributes have tokens, for a null item, those attributes values will be "" (eg, `text="{name}"` for a null item would effectively be equivalent to `text=""`)
6. GridLayout's de facto cannot have siblings because they need to fill in their container's size. XML with multiple GridLayout's in a single Panel/View will refuse to render the XML and show an error to the user in the tree on all the problematic sibling GridLayout's
7. A GridLayout can only be a child of Panel or View.

## Examples

Rendering a simple vertical list:
```xml
<View>
    <GridLayout dataCollection="myListofItems" rows="6" columns="6">
        <!-- 
        Note the id is plural. This is so the GUI engine can generate lua bindings like this:
        view.items[1]:setBorderColor(...)
        view.items[2]:setBorderColor(...)
        -->
        <Text id="items" text="{name}" />
    </GridLayout>
</View>
```

Rendering a simple inventory:
```xml
<View>
    <!-- 
    "inventoryItems"=[
        {
            "name": "Milk",
            "sprite": "item_milk.png"
        }
    ]
     -->
    <GridLayout dataCollection="inventoryItems" rows="6" columns="6" gutter="5,5">
        <!-- 
        Note the id is plural. This is so the GUI engine can generate lua bindings like this:
        view.slots[1].spritePanel // reference to the panel called `spritePanel`
        view.slots[1].nameText
        -->
        <Panel id="slots">
            <!-- Note that {sprite} will come from a single item contained within inventoryItems -->
            <Panel id="spritePanel" texture="{sprite}" />
            <Text id="nameText" text="{name}" />
        </Panel>
    </GridLayout>
</View>
```

Rendering a component
```xml
<View>
    <GridLayout dataCollection="inventoryItems" rows="6" columns="6" gutter="5,5">
        <!-- The `data` property is overridden by elements in the dataCollection model -->
        <Component id="slots" src="bag_slot.xml" />
    </GridLayout>
</View>

```
