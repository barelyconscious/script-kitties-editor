# ForEach Element Design

## Supersessions

Any decision this document makes should be considered as superseding previously "locked-in" decisions around handling repeated elements.

1. Root access from nested components (eg the `$.thing`) is dropped
2. 

## How to use this doc

The purpose of this doc is to describe a new feature being added to the Script Kitties Editor project. The audience is an LLM and this file should be treated as instructions for how to build out the feature. As an LLM, your job is to respect the spirit of these instructions with the freedom to challenge anything that seems contradictory, inconsistent, incongruent, or introduces pitfalls the author did not consider. You may stop at any point during implementation to raise concerns to the user as they come up.

## Overview

For the GUI View XML behavior we will add a new element type, ForEach. The purpose of this element is to repeat the child element based on a specified iterable collection. Each item in a collection is forwarded as the data model to the child element. The child element is not made explicitly aware that it is in a ForEach (ie - no `index` property and no direct access to the collection). A ForEach contains exactly 1 child element. A repeated element gets its position and size assigned by the ForEach. The way in which the ForEach calculates the position and size is discussed further below.

## Requirements
1. The GUI editor must not allow more than 1 child element to be present in a ForEach. There should not be a `+` icon nor should the right-click context menu afford the option to add multiple child elements. Loading XML with multiple child elements 1) flags the element in the tree view with an error icon and 2) refuses to render anything to the screen until the user fixes the XML
2. The ForEach element does not have an `id` and cannot be referenced by any Lua code. The ForEach is used by the GUI engine to build components.
3. The GUI preview panel must:
   1. expand the ForEach element and render as many elements as declared as if they were individual elements but they cannot be individually selected (only the ForEach's containing element can be selected and moved around the preview).
   2. pass along iterable data declared in the data model preview panel so that the preview can be more accurate
   3. treat the ForEach's parent container as a single component when moving. ie- the user must not be able to move individual, repeated elements. The whole ForEach is essentially treated like a separate component
4. Components cannot override their position or size when a child of a ForEach. The ForEach thus exclusively owns the responsibility of calculating and setting these properties. The calculation is described in more detail below
5. The ForEach does not define position or size attributes directly. Instead, the ForEach effectively sets position="0,0,0,0" and size="1,1,0,0" so that it has the entire space of its container to fill out the repeated components

## Attributes

Unless explicitly noted below, tokens (eg, "{text}") are not supported and are instead processed as literals.

The ForEach element has the following attributes:
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

The ForEach element internally calculates the size and position of its expanded children. The child elements' position and size attributes, if specified in their own definitions, are thusly effectively ignored.

The ForEach element does not expose a size or position itself so as to avoid confusion - the user may think size/position refers to each child element instead of the ForEach as a container. Users are meant to use ForEach as a control element rather than a display element, similar to the Event element.

Children in a ForEach are rendered to fill the maximum amount of space in a grid based on the values of `rows` and `columns`. The `gutter` is included as part of the size of an element when factoring the size in. In the editor, the child element properties for size and position should not be editable.

Items are populated left-to-right, top-to-bottom:
+---+---+---+---+
| 1 | 2 | 3 | 4 |
+---+---+---+---+
| 5 | 6 | 7 | 8 |
+---+---+---+---+

## Caveats
1. A ForEach may appear as the root directly under a View. In this case, treat size="1,1,0,0" and position="0,0,0,0" for rendering.
2. A ForEach does not have an `id` and cannot be directly addressed by Lua controllers. 
   1. Instead, for Lua bindings to work, the child within a ForEach should use a plural name for its id. The id will be expanded in lua as the name of the iterable instead of a single element (eg - `view.items[1]` where `items` is the `id` of a child within a ForEach)
3. The editor's data model preview does not update when a forEach's `dataCollection` attribute is populated in the editor. In other words, if the user types `dataCollection="items"`, we will not add `items` to the data model automatically.
4. A ForEach may only contain a Panel, Text, or Component child element.
5. If a collection has more elements than a grid would support, the excess elements are effectively ignored and not rendered. If there are fewer elements than a grid would expect, all elements are still rendered, those excess elements will get `null` items

## Examples

Rendering a simple vertical list:
```xml
<View>
    <ForEach dataCollection="myListofItems">
        <!-- 
        Note the id is plural. This is so the GUI engine can generate lua bindings like this:
        view.items[1]:setBorderColor(...)
        view.items[2]:setBorderColor(...)
        -->
        <Text id="items" text="{name}" />
    </ForEach>
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
    <ForEach dataCollection="inventoryItems" rows="6" columns="6" gutter="5,5">
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
    </ForEach>
</View>
```

Rendering a component
```xml
<View>
    <ForEach dataCollection="inventoryItems" rows="6" columns="6" gutter="5,5">
        <!-- The `data` property is overridden by elements in the dataCollection model -->
        <Component id="slots" src="bag_slot.xml" />
    </ForEach>
</View>

```
