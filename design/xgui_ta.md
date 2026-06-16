# XGUI

## Context

We are improving the GUI engine for Script Kitties and to start with we are creating a GUI editor in the Script Kitties Editor. 

## Purpose

The purpose is to create a fully functioning MVP GUI editor in the Script Kitties Editor. This document describes clearly the requirements to achieve that.

## Overview

The GUI editor lives as a new tool in the navrail (the icon signifies this is for editing GUIs) and a whole new page separate from the other existing tools. It is positioned immediately below the workbench tool and above the data tables tool. 

## XML Elements

XML is used to describe the visual layout of the component. The following elements are supported in phase 1:
```xml
<View> - the top level element, optionally defines a lua controller
<Panel> - a flexible UI element that can be positioned, textured, and sized
<Text> - a flexible UI element identical to a Panel except more explicitly a Text field
<Component> - signifies this element is defined in another source file
<Event> - registers an event listener. Events may only be present as an immediate child of `<View>`
```

In phase 2, we would consider the following additional elements. Phase 1's implementation must support these seamlessly:
```xml
<HorizontalLayout> - automatically places child elements in a horizontal pattern
<VerticalLayout> - similar but for vertical patterns
<GridLayout> - renders vertically and horizontally
```

### Elements in more detail

Supported properties for each element

**<View>**
- `controller` - a lua file attached to this view. Not required

**<Panel>**
- `id` - required, this is the name used to reference the elmeent in lua. follows parent hierarchical structure (see examples below)
- `position` - optional, follows a format of `"relativeX,relativeY,absoluteX,absoluteY"` eg `position="1,0,0,5"` puts the element at the top right corner and 5 pixels down. default is `"0,0,0,0"`
- `size` - optional, same format as position. default is `"1,1,0,0"`
- `borderColor` - optional, color of the border. default is transparent
- `borderSize` - optional, size of the border. default is 1 pixel
- `texture` - optional, sprite used as the background. default is none
- `backgroundColor` - optional, color of the background. default is transparent
- `visible` - optional, signifies the starting visibility state of the element. default is true
- component event handlers (`onKeyPressed`, `onMouseMoved`, `onMouseEntered`, `onMouseExited`, `onMouseClicked`) - optional, value is a function name

**<Text>**
everything in `<Panel>` plus:
- `text` - required, the string to display. Can use `{}` to denote parameterization eg `{health}` will read the `health` attribute of the model and replace the text with that value automatically. eg `Health: {health}/{maxHealth}` might result in the produced string `Health: 15/25`
- `textColor` - optional, default is Color(185,178,165,255)
- `textAlign` - optional, default is left-aligned
- `fontSize` - optional, the size of the text, default is 14

**<Component>**
Note: `<Component>`s cannot have children. The _definition_ of that component (the source file) can obviously have children, but you can't nest elements inside a `<Component>` directly.

Properties:
- `id` - required, this is the name used to reference the elmeent in lua. follows parent hierarchical structure (see examples below)
- `src` - required, the name of the source file eg `button.xml` 
- `position` - optional, follows a format of `"relativeX,relativeY,absoluteX,absoluteY"` eg `position="1,0,0,5"` puts the element at the top right corner and 5 pixels down. default is `"0,0,0,0"`
- `size` - optional, same position as position. default is `"1,1,0,0"`
- `visible` - optional, signifies the starting visibility state of the element. default is true
- other properties can be defined on the component which will translate to overrides in the component

**<Event>**
- `name` - required, the name of the event eg `Battle:OnCreatureDied`
- `handler` - required, lua function name defined in the controller

### High Level Visual Layout

1. The visual layout is similar to the workbench. On the leftmost side next to the navrail is a list view similar to the object list panel. Here, all of the components we've created are shown. Everything is a component, even top-level things like "Profile" and "Battle" are components (though they are defined as `<View>`s in code of course since that's the top level element). We source them from the `gui` folder in the project directory from the config. The Rust backend will need to be updated to support this. This panel is collapsable similar to the workbench where you can click to toggle the icon in the navrail to collapse it. There is a `+` button to create new components at the top next to the search bar similar to the workbench.
    1. Creating a new component will ask for the component's name (which translates to the file name `{component_name_in_snake_case}.xml` and will be stored in the `gui` folder) along with whether you want to create a script, which will automatically default to `{component_name_in_snake_case}_controller.lua`
1. The main content spread is a tabbed panel with 2 tabs. The left-most tab is "View", which shows an exact preview of the selected component (including rendering nested components). The second tab next to it is "Controller", which shows a monaco editor of the controller defined by the View element
1. There is another panel on the left, to the right of the list items. This panel contains a tree view of the components rendered. Right click any element to add a child to it, which may be another component, which automatically updates the XML and the render.
    1. Within this panel, horizontally split at the bottom, is Properties, which reflects the properties of the currently selected element in the tree view. Events are also defined/added here and are visible in this panel. There is a computed `id` readonly text field at the top which is computed from the hierarchy of parents (eg `grandparentid.parentid.childid`, `view.stats.statText`).
1. Within the View tab:
    1. There is the preview render in the center and a panel to the left for `properties` which lets the user specify values for the selected element's properites like `id`, `src` (for components), `texture` (with the sprite selector UI component)
    1. In `View` component, you can also register events (these are new lists with an event name and a handler function name)
1. Within the Controller tab:
    1. The main content is a lua monaco editor for the controller script. If no script has been added, this panel shows a "Add script" button which will update the `<View>`'s `controller` property with the name of the script created. By default, the controller name will be `{component_name_in_snake_case}_controller.lua` but the user may specify any name they want. These files are created in the `gui` folder, alongside the component files.
    1. Note that the data model editor and tree view  is still visible (and collapsable) even in controller mode
1.  To the right of this main content is another panel with "Data Model", which lets the user define, with raw json, the data model that would be injected into the GUI. The preview render automatically updates to match the provided data model. This can be collapsed

# Clarifications
1. Tree panel and Properites panel share the same panel on the left, to the immediate right of the collapsable component list panel.

# Examples

```xml
  <View controller="bag_controller.lua">
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
  </View>
```
