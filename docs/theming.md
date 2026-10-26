# Making a Tessera theme

A Tessera theme is one small file, `theme.json`, in a folder of its own. It holds **values only**: colors, sizes, which layout pieces to use, how things move. It never holds code, CSS or links. Tessera checks every value against a fixed list and quietly ignores anything it doesn't recognise, so a theme can't break the launcher or do more than Theme Settings already can.

This guide covers everything a theme file can do today. A visual theme creator is planned; until it exists, this page and the checker in `tools/check-theme.cjs` are the tools.

![The ten factory themes](screenshots/themes.jpg)

## Contents

- [The fastest way: design it in the console](#the-fastest-way-design-it-in-the-console)
- [Where themes live](#where-themes-live)
- [The file](#the-file)
- [Check your theme before you copy it over](#check-your-theme-before-you-copy-it-over)
- [How Tessera reads a theme](#how-tessera-reads-a-theme)
- [Layout: shell arrangements and layout parts](#layout-shell-arrangements-and-layout-parts)
- [Every setting](#every-setting)
- [Settings of your own](#settings-of-your-own)
- [Examples](#examples)
- [Tips for themes that look good everywhere](#tips-for-themes-that-look-good-everywhere)
- [Sharing a theme](#sharing-a-theme)
- [Troubleshooting](#troubleshooting)

## The fastest way: design it in the console

You don't have to start from an empty file.

1. Open **Settings › Theme Settings** and pick the factory theme closest to what you want.
2. Change things. Every change shows live behind the menu.
3. Choose **Save current as a new theme…** and give it a name. Tessera writes a complete `theme.json` for you in `~/Tessera/Themes/<name>/`.
4. Open that file in Desktop Mode (or on another computer) to fine-tune it, share it, or add the few things the console menu doesn't offer, such as narrowing a setting's choices.

**Rename this theme…**, **Overwrite this theme with current** and **Delete this theme…** in the same menu manage the themes you've made. Factory themes are read-only.

## Where themes live

```
~/Tessera/Themes/
  my-theme/          ← the folder name is the theme's id
    theme.json
```

- **The folder name is the id.** Use lowercase letters, digits, `.`, `_` and `-`, start with a letter or digit, and keep it to 40 characters. `Sunset Arcade/` is skipped; `sunset-arcade/` works.
- The ten factory ids are taken: `stock`, `dark`, `mosaic`, `mosaic-dark`, `cartridge-pop`, `nova-black`, `dashboard-steel`, `indigo-cube`, `channel-white`, `arcade-marquee`.
- Linked folders (symlinks) are skipped, and Tessera looks at no more than 64 theme folders.
- `theme.json` has to be under 64 KB. A real theme is usually under 2 KB.

After adding or editing a file, open **Settings › Add-ons** and choose **Reload add-ons** (or restart Tessera). Then pick the theme from the top row of **Theme Settings** or from **Add-ons › Themes**. Each profile can have its own theme (**Settings › Profiles**).

## The file

```json
{
  "name": "Sunset Arcade",
  "author": "You",
  "defaults": {
    "accent": "#ff8a3d",
    "bg": "#1b0f24",
    "radius": "20px",
    "shellLayout": "switch"
  }
}
```

| Key | What it is |
|---|---|
| `name` | What people see in the theme list. Up to 40 characters. Defaults to the folder name. |
| `author` | Shown next to the name. Up to 60 characters. |
| `defaults` | The heart of a theme: a value for any setting in [Every setting](#every-setting), keyed by its id. Leave out anything you're happy with; it keeps the stock value. Up to 80 entries. |
| `settings` | Optional. Settings of your own, or a stock setting redefined. See [Settings of your own](#settings-of-your-own). Up to 40. |

Anything else in the file is ignored.

### Value types

| Type | Write it as | Example |
|---|---|---|
| color | a six-digit hex string, `#rrggbb` | `"accent": "#ff8a3d"` (not `#f83`, not `orange`) |
| choice | one of the setting's listed values, exactly as written | `"radius": "20px"`, `"layout": "grid"` |
| range | a number, no quotes and no unit, within the range | `"shadow": 80`, `"fontScale": 110` |
| toggle | `true` or `false`, no quotes | `"motion": false` |
| image | can't be set from a file: pick the picture in Theme Settings | |

## Check your theme before you copy it over

The repo has a checker that uses the launcher's own loading rules, read straight from `main.js`, so it always matches what Tessera does:

```bash
node tools/check-theme.cjs ~/Tessera/Themes/my-theme/theme.json
```

```
/tmp/Bad Theme/theme.json
  ✗ the folder name "Bad Theme" is the theme id: use lowercase a-z, 0-9, ".", "_" or "-", …
  ✗ default "radius": "13px" is not allowed, so the stock value is used. Expected one of "4px", "10px", "14px", "20px", "28px", "40px"
  ✗ default "motion": "true" is not allowed, so the stock value is used. Expected true or false (no quotes)
  ✗ default "shadow": 55 becomes 60 (ranges snap to their step)
  ✗ default "nope" is not a setting, so it is ignored
```

It needs Node.js 18 or newer, which Desktop Mode can install with Homebrew or a toolbox.

## How Tessera reads a theme

Knowing the order saves a lot of head-scratching:

1. **Stock values** come first: the defaults in the table below.
2. **The theme's `defaults`** replace them, one by one. A value that doesn't fit its setting is dropped and the stock value stays. Nothing warns you inside Tessera, which is why the checker exists.
3. **Changes made in Theme Settings** go on top, and they're saved **per theme**. So if you tweaked your theme in the console and then edit `theme.json`, your console tweaks still win. Use **Theme Settings › Reset this theme to defaults** to see the file's values again.

Colors, sizes and toggles end up as CSS custom properties (the `--name` shown next to each setting below). Layout choices end up as switches on the page that pick between built-in, tested arrangements. A theme can never add CSS of its own.

## Layout: shell arrangements and layout parts

`shellLayout` is the big one. It moves the menu, reshapes the tiles and changes how rows scroll. Each arrangement is really a preset of twelve **layout parts**:

| shellLayout | partNav | partTabs | partClock | partFrame | partTitle | partTile | partSize | partRow | partCard | partSpot | partEmblem | partHints |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `classic` | top | pills | off | glow | below | portrait | medium | center | standard | off | none | center |
| `dock` | bottom-dock | pills | off | glow | below | wide | medium | center | standard | off | none | left |
| `crossbar` | top | segments | off | glow | below | portrait | medium | center | standard | off | none | center |
| `dashboard` | left | pills | off | glow | below | portrait | medium | center | standard | off | none | left |
| `switch` | bottom | round | topbar | framed | above | square | large | focus | flat | off | none | right |
| `hero` | top-left | text | corner | glow | big | square | small | start | flat | on | none | left |
| `pivot` | top-left | pivots | corner | white | below | square | medium | center | metro | off | none | left |
| `cube` | left | chunky | off | glow | below | portrait | medium | center | glossy | off | cube | left |
| `channel` | bottom-bar | pills | bar | halo | below | wide | medium | center | bezel | off | none | center |

Set any `part…` setting to override just that piece, and leave the rest on `"auto"` to follow the arrangement. For example, `"shellLayout": "switch"` with `"partTabs": "chunky"` gives the home-row layout with glossy pill buttons instead of round ones.

A few combinations to know:

- **Menu down the side** (`partNav: "left"`): up and down move between tabs and right enters the tiles.
- **Menu at the bottom** (`bottom`, `bottom-dock`, `bottom-bar`): down from the tiles reaches the menu.
- `partSpot: "on"` paints the selected game's art behind everything. It suits dark themes with `partCard: "flat"`.
- `partEmblem: "cube"` puts a turning cube over the menu. It's made for `partNav: "left"`.
- `partClock: "bar"` only makes sense with `partNav: "bottom-bar"`; elsewhere it falls back to the corner.

Arrangements only move Tessera's own menus and tile areas. Your Home widgets keep their positions whichever you choose. A freeform drag-and-drop layout editor is planned.

## Every setting

Generated from the launcher's schema (`STOCK_THEME` in `main.js`). The id is what goes in `defaults`.
### Screen

| id | What it changes | Type | Values | Default |
|---|---|---|---|---|
| `screenUse` | Screen area used (`--use`) | range | 70 to 100, step 5 (%) | `100` |
| `fontScale` | Text size (`--font-scale`) | range | 80 to 160, step 10 (%) | `100` |

### Shape

| id | What it changes | Type | Values | Default |
|---|---|---|---|---|
| `radius` | Corner roundness (`--radius`) | choice | `4px` Sharp<br>`10px` Slight<br>`14px` Normal<br>`20px` Soft<br>`28px` Round<br>`40px` Pill | `"14px"` |
| `borderW` | Border thickness (`--border-w`) | choice | `0px` None<br>`2px` Thin<br>`4px` Medium<br>`6px` Thick | `"0px"` |
| `shadow` | Tile shadow (`--shadow`) | range | 0 to 100, step 10 (%) | `100` |
| `tabShadow` | Tab highlight shadow (`--tab-shadow`) | range | 0 to 100, step 10 (%) | `100` |
| `selectRing` | Selection outline (`--ring`) | choice | `0px` None<br>`2px` Thin<br>`3px` Normal<br>`5px` Thick | `"3px"` |

### Colors

| id | What it changes | Type | Values | Default |
|---|---|---|---|---|
| `accent` | Highlight color (`--accent`) | color | `#rrggbb` | `"#7fb2ff"` |
| `selColor` | Selector glow | choice | `accent` Highlight color<br>`pastel` Random pastel | `"accent"` |
| `border` | Border color (`--border`) | color | `#rrggbb` | `"#3b475a"` |
| `card` | Tile fill (`--card`) | color | `#rrggbb` | `"#1a222c"` |
| `panel` | Menu fill (`--panel`) | color | `#rrggbb` | `"#161d27"` |
| `bg` | Background color (`--bg`) | color | `#rrggbb` | `"#10151c"` |
| `text` | Text color (`--text`) | color | `#rrggbb` | `"#e9e4d8"` |
| `muted` | Small text color (`--muted`) | color | `#rrggbb` | `"#8b95a3"` |

### Background

| id | What it changes | Type | Values | Default |
|---|---|---|---|---|
| `background` | Background picture (`--bg-image`) | image | set in the console only | none |
| `bgDim` | Picture dimming (`--bg-dim`) | range | 0 to 90, step 10 (%) | `50` |
| `backdrop` | Backdrop effect | choice | `none` None<br>`glow` Glow<br>`mystic` Mystic<br>`tiles` Mosaic tiles<br>`cubes` Drifting cubes<br>`stripes` Pinstripes | `"none"` |

### Buttons

| id | What it changes | Type | Values | Default |
|---|---|---|---|---|
| `confirm` | Done / Yes button color (`--ok`) | color | `#rrggbb` | `"#3ddc97"` |
| `cancel` | Cancel / Close button color (`--danger`) | color | `#rrggbb` | `"#ff6b6b"` |

### Layout

| id | What it changes | Type | Values | Default |
|---|---|---|---|---|
| `shellLayout` | Shell arrangement | choice | `classic` Classic (top navigation)<br>`dock` Bottom dock / card strip<br>`crossbar` Crossbar (top categories)<br>`dashboard` Dashboard (left sidebar)<br>`switch` Home row (square tiles over round buttons)<br>`hero` Spotlight (the selection fills the screen)<br>`pivot` Pivot (text headers over flat tiles)<br>`cube` Cube (chunky menu down the left)<br>`channel` Channels (wide tiles over a curved clock bar) | `"classic"` |

### Layout parts

| id | What it changes | Type | Values | Default |
|---|---|---|---|---|
| `partNav` | Menu position | choice | `auto` Auto (follow the arrangement)<br>`top` Top, centered<br>`top-left` Top left<br>`bottom` Bottom<br>`bottom-dock` Bottom dock<br>`bottom-bar` Curved bottom bar<br>`left` Left sidebar | `"auto"` |
| `partTabs` | Tab look | choice | `auto` Auto (follow the arrangement)<br>`pills` Pills<br>`text` Plain text<br>`pivots` Large text pivots<br>`round` Round icon buttons<br>`chunky` Chunky glossy buttons<br>`segments` Full-width segments | `"auto"` |
| `partClock` | Clock | choice | `auto` Auto (follow the arrangement)<br>`off` Off<br>`corner` Top corner<br>`topbar` Across the top, with a profile icon<br>`bar` In the curved bottom bar | `"auto"` |
| `partFrame` | Selection frame | choice | `auto` Auto (follow the arrangement)<br>`glow` Glow<br>`framed` Frame with a gap<br>`white` White outline<br>`halo` Soft halo | `"auto"` |
| `partTitle` | Name of the selection | choice | `auto` Auto (follow the arrangement)<br>`below` Under the tiles<br>`above` Above the tiles<br>`big` Big, on the left | `"auto"` |
| `partTile` | Tile shape | choice | `auto` Auto (follow the arrangement)<br>`portrait` Tall (box art)<br>`square` Square<br>`wide` Wide | `"auto"` |
| `partSize` | Tile size (rows) | choice | `auto` Auto (follow the arrangement)<br>`small` Small<br>`medium` Medium<br>`large` Large | `"auto"` |
| `partRow` | Row movement | choice | `auto` Auto (follow the arrangement)<br>`center` Selection stays in the middle<br>`focus` Middle, other rows faded<br>`start` Selection at the front, and it grows | `"auto"` |
| `partCard` | Tile look | choice | `auto` Auto (follow the arrangement)<br>`standard` Standard<br>`flat` Picture only<br>`metro` Flat with color<br>`glossy` Glossy<br>`bezel` Rounded bezel | `"auto"` |
| `partSpot` | Selection art behind everything | choice | `auto` Auto (follow the arrangement)<br>`off` Off<br>`on` On | `"auto"` |
| `partEmblem` | Emblem over the menu | choice | `auto` Auto (follow the arrangement)<br>`none` None<br>`cube` Turning cube | `"auto"` |
| `partHints` | Button hints | choice | `auto` Auto (follow the arrangement)<br>`center` Centered<br>`left` Left<br>`right` Right | `"auto"` |

### Layout

| id | What it changes | Type | Values | Default |
|---|---|---|---|---|
| `layout` | Tile layout | choice | `rails` Rails (sideways, like a console)<br>`grid` Grid<br>`flow` Flow grid (scrolls up and down) | `"rails"` |
| `gridPreset` | Grid size (default for every page) | choice | `c3r2` 3 × 2<br>`c4r2` 4 × 2<br>`c5r3` 5 × 3<br>`c6r3` 6 × 3<br>`c6r4` 6 × 4<br>`c8r4` 8 × 4<br>`custom` Custom (use the two settings below) | `"c5r3"` |
| `tileGap` | Space between tiles (grid and flow) | range | 20 to 240, step 10 (%) | `100` |
| `gridCols` | Custom grid: columns | range | 2 to 12, step 1 | `5` |
| `gridRows` | Custom grid: rows on screen | range | 1 to 8, step 1 | `3` |

### Settings page

| id | What it changes | Type | Values | Default |
|---|---|---|---|---|
| `setPack` | Small groups side by side (grid) | toggle | `true` / `false` | `false` |
| `setNotes` | Status under every tile | toggle | `true` / `false` | `true` |
| `setIcons` | Icons on tiles | choice | `animated` Animated (the selected tile moves)<br>`still` Still<br>`off` Off | `"animated"` |

### Widgets

| id | What it changes | Type | Values | Default |
|---|---|---|---|---|
| `widgetStyle` | Widget style | choice | `frosted` Frosted (even, like sandblasted glass)<br>`glass` Glass (a see-through pane)<br>`outline` Outline only (see-through)<br>`solid` Solid color | `"frosted"` |
| `widgetTint` | Frosted: how opaque (`--wg-tint`) | range | 0 to 100, step 5 (%) | `55` |
| `widgetBlur` | Frosted: diffusion (blur) (`--wg-blur`) | range | 0 to 40, step 2 (px) | `16` |
| `widgetClear` | Glass: transparency (`--wg-clear`) | range | 0 to 100, step 5 (%) | `60` |
| `widgetColor` | Solid color: fill (`--wg-color`) | color | `#rrggbb` | `"#ffffff"` |
| `widgetSheen` | Glass: shine (`--wg-sheen`) | toggle | `true` / `false` | `true` |

### Motion

| id | What it changes | Type | Values | Default |
|---|---|---|---|---|
| `motion` | Animations (`--motion`) | toggle | `true` / `false` | `true` |
| `browserAnim` | Browser transition | choice | `slide` Slide (from the side you came from)<br>`zoom` Zoom (grows out of the Browser tab)<br>`fade` Fade<br>`rise` Rise (comes up like a sheet)<br>`flip` Flip (turns like a card)<br>`doors` Doors (opens from the middle)<br>`none` None (instant) | `"slide"` |

### What the factory themes use

| Theme | id | shellLayout | browserAnim | backdrop |
|---|---|---|---|---|
| Tessera Bright | `stock` | `classic` | `slide` | `glow` |
| Tessera Dark | `dark` | `classic` | `slide` | `mystic` |
| Tessera Mosaic | `mosaic` | `classic` | `slide` | `tiles` |
| Tessera Mosaic Dark | `mosaic-dark` | `classic` | `slide` | `tiles` |
| Cartridge Pop | `cartridge-pop` | `switch` | `zoom` | `none` |
| Nova Black | `nova-black` | `hero` | `fade` | `none` |
| Dashboard Steel | `dashboard-steel` | `pivot` | `slide` | `none` |
| Indigo Cube | `indigo-cube` | `cube` | `flip` | `cubes` |
| Channel White | `channel-white` | `channel` | `zoom` | `stripes` |
| Arcade Marquee | `arcade-marquee` | `crossbar` | `slide` | `glow` |

To read the rest of a factory theme's values, look for `BUILTIN_THEMES` in `system_files/usr/lib/tessera/launcher/main.js`. Or pick it in Theme Settings, choose **Save current as a new theme…**, and read the file it writes.

## Settings of your own

`settings` adds rows to Theme Settings, or replaces a stock setting with your own version of it:

```json
"settings": [
  { "id": "radius", "group": "Shape", "label": "Corner roundness", "type": "choice", "var": "--radius",
    "default": "10px",
    "options": [ { "label": "Square", "value": "2px" }, { "label": "Soft", "value": "10px" } ] }
]
```

| Field | Rules |
|---|---|
| `id` | Letters and digits, starting with a letter, up to 24 characters. Reusing a stock id replaces that setting. |
| `type` | `range`, `choice`, `color`, `toggle` or `image`. |
| `label`, `group`, `hint` | What Theme Settings shows: up to 40, 30 and 120 characters. The group defaults to "Theme". |
| `var` | Optional. The CSS variable it sets: one of the stock ones (`--accent`, `--bg`, `--card`, `--panel`, `--text`, `--muted`, `--border`, `--radius`, `--border-w`, `--shadow`, `--ring`, `--tab-shadow`, `--use`, `--font-scale`, `--ok`, `--danger`, `--motion`, `--bg-dim`, `--wg-tint`, `--wg-blur`, `--wg-color`, `--wg-sheen`, `--wg-clear`), or your own starting with `--theme-`. |
| `default` | The starting value, following the [value types](#value-types). |
| range: `min`, `max`, `step`, `unit`, `scale` | `scale` multiplies the value before it becomes CSS. For example, a percent with `scale: 0.01` becomes 0–1. |
| choice: `options` | Up to 12 `{ "label", "value" }` pairs. Values may only use letters, digits, spaces and `# . % ( ) , + -`, up to 40 characters, and never `url(`. |
| toggle: `on`, `off` | The CSS values for on and off. They default to `"1"` and `"0"`. |

Good to know:

- **Redefining a stock setting** is the most useful trick here. It narrows choices, renames them, or changes a range. Keep the stock `var` (the checker reminds you), or the setting stops changing the look.
- **`--theme-…` variables are saved and shown, but nothing in the launcher reads them yet.** They're reserved for upcoming theme features, so a setting that only sets a `--theme-` variable appears in Theme Settings without changing anything on screen today.

## Examples

Complete, checked examples are in [`examples/themes/`](../examples/themes). Copy a folder into `~/Tessera/Themes/` to try one.

**Sunset Arcade**: warm, glossy, the home-row arrangement with chunky menu buttons, glass widgets and a doors transition into the browser.

```json
{
  "name": "Sunset Arcade",
  "author": "Tessera examples",
  "defaults": {
    "bg": "#1b0f24",
    "panel": "#24132f",
    "card": "#2e1a3c",
    "text": "#fff1e6",
    "muted": "#c7a7c9",
    "accent": "#ff8a3d",
    "border": "#ff8a3d",
    "confirm": "#3ddcb0",
    "cancel": "#ff4f6d",
    "borderW": "2px",
    "radius": "20px",
    "shadow": 90,
    "tabShadow": 80,
    "selectRing": "5px",
    "backdrop": "glow",
    "shellLayout": "switch",
    "partTabs": "chunky",
    "partClock": "corner",
    "partCard": "glossy",
    "partHints": "center",
    "layout": "rails",
    "widgetStyle": "glass",
    "widgetClear": 55,
    "widgetSheen": true,
    "motion": true,
    "browserAnim": "doors"
  }
}
```

**Quiet Paper**: calm and readable. Big text, no animation, a pivot menu over flat tiles, wide gaps, and the corner choice cut down to two options.

```json
{
  "name": "Quiet Paper",
  "author": "Tessera examples",
  "defaults": {
    "bg": "#f6f3ec",
    "panel": "#fbf9f4",
    "card": "#ffffff",
    "text": "#24211c",
    "muted": "#6f685c",
    "accent": "#2f6f5e",
    "border": "#d8d2c4",
    "confirm": "#2f6f5e",
    "cancel": "#b3412f",
    "borderW": "2px",
    "radius": "10px",
    "shadow": 20,
    "tabShadow": 0,
    "selectRing": "3px",
    "backdrop": "none",
    "fontScale": 110,
    "shellLayout": "pivot",
    "partFrame": "framed",
    "layout": "grid",
    "gridPreset": "custom",
    "gridCols": 5,
    "gridRows": 2,
    "tileGap": 140,
    "setPack": true,
    "setIcons": "still",
    "widgetStyle": "outline",
    "motion": false,
    "browserAnim": "fade"
  },
  "settings": [
    { "id": "radius", "group": "Shape", "label": "Corner roundness", "type": "choice", "var": "--radius",
      "default": "10px",
      "options": [ { "label": "Square", "value": "2px" }, { "label": "Soft", "value": "10px" } ] }
  ]
}
```

**My Dashboard**: the smallest useful theme, a recolor plus the sidebar arrangement. See [`examples/themes/my-dashboard`](../examples/themes/my-dashboard/theme.json).

## Tips for themes that look good everywhere

- **Contrast first.** `text` on `bg` and `text` on `card` should both be easy to read from a couch: aim for a contrast ratio of at least 4.5:1. `muted` is for small print, so keep it readable too.
- Tessera picks the text color *on* the `accent`, `confirm` and `cancel` colors by itself (dark or light), so any accent works on buttons.
- A dark `bg` (low brightness) switches the launcher's glows and shadows to their dark-mode versions automatically.
- **Test at two sizes.** The launcher scales with the screen, but a 7-inch handheld and a 65-inch TV stress different things. `screenUse` is there for TVs that cut off the edges; don't use it for style.
- Leave `motion` on unless the theme is meant to be still. Anyone who needs less movement can turn it off for themselves.
- `selColor: "pastel"` (the Mosaic look) gives the selection glow a new random pastel on every move. It looks best on soft, light backgrounds.

## Sharing a theme

A theme is just its folder. Zip `my-theme/` and share it; others unzip it into `~/Tessera/Themes/` and reload add-ons. Because themes carry no code, there's nothing to trust or sign. A background picture isn't included, since each person picks their own in Theme Settings.

## Troubleshooting

| What you see | Why, and the fix |
|---|---|
| The theme isn't in the list | Check the folder name (lowercase, no spaces), that the file is called `theme.json`, that it's valid JSON (`node tools/check-theme.cjs` reports both), and choose **Reload add-ons**. |
| One value is ignored | It doesn't fit its setting: a color that isn't `#rrggbb`, a choice value that isn't listed, `"true"` in quotes, or a misspelt id. Run the checker. |
| My edits to `theme.json` don't show | Changes made in Theme Settings for this theme win over the file. Use **Reset this theme to defaults**. |
| A range came out slightly different | Ranges snap to their step (`shadow` goes up in 10s, for example). |
| A part setting does nothing | Some parts only make sense together; see [Layout](#layout-shell-arrangements-and-layout-parts). |
| A custom `--theme-…` setting does nothing | Expected for now: nothing reads `--theme-` variables yet. |
| Two themes with the same name | Both show, each tagged with its id. Rename one in Theme Settings or edit its `name`. |
