# Ludus (Qt): everything it must do before it replaces the current Ludus

The Qt version becomes the default only when every line here is done and checked: by tests, and by
screenshots of both versions side by side (every factory theme, every shell layout). Until then
the current Ludus is the default and nothing in it changes. Your library, themes, settings and
profiles are the same files in both, so switching never loses anything.

Status: ✅ done and tested · 🟡 partly · ⬜ not yet

## Pages and navigation
- 🟡 Tab bar (Browser, Home, Library, Apps, mosaics, + Mosaic, Settings), in all six tab looks — the Browser tab opens in the full Ludus until the browser port
- 🟡 Every controller moves the screen; keyboard — mouse and pointer not yet; per-pad glyphs (Xbox / PlayStation / Nintendo) not yet
- 🟡 Home: widgets on the 12 × 6 grid, add from the preset list, move / resize / remove, four widget styles — downloaded add-on widgets show their name until the browser engine port; the frosted style is a tinted pane (no blur of what is behind it yet)
- ✅ Library and Apps lists
- 🟡 Mosaics: make, rename, reorder, delete — per-page grid size, holding Y to lift a tab, pick-up-and-move tiles not yet
- 🟡 Folders: open, back — new folder, rename, delete from inside not yet
- 🟡 Options menu — add a game / app from a file, scan for games, change picture, rename item, remove from library, delete files not yet
- ⬜ Game art (automatic and chosen pictures)
- ⬜ Recently played
- ⬜ Hover-to-select with the mouse, with the edge-scroll pause
- ⬜ The tour (first start) and Welcome
- 🟡 Status line and messages — shown under the tiles; the full set of messages not yet

## Themes and customization (docs/theming.md)
- 🟡 All 49 theme settings are read; drawn so far: colors, screen area, font size, radius, borders, shadows, selection ring and pastel glow, background picture and dim, backdrops, widgets, motion — checked side by side by the CI job (reports/ludus-qt-themes)
- 🟡 All 9 shell layouts and every layout part (menu position, tabs, clock, frame, title, tile shape and size, row, card look, spotlight, emblem, hints) — drawn; being matched against the current Ludus one theme at a time
- 🟡 Layout modes: rails, grid, flow; columns × rows, per-page grid sizes read — packed groups and the per-page grid-size editor not yet
- 🟡 The 10 factory themes draw; the differences found so far are listed in the side-by-side report
- ⬜ Themes from ~/Tessera/Themes (theme.json), with the same checks and limits
- ⬜ Theme Settings: change live, save as new, rename, overwrite, delete; the color wheel
- ⬜ Per-profile themes; "everyone" theme
- ⬜ Busy cursors, the boot art (unchanged files)

## The built-in browser
- ⬜ Browser tab: open, leave with LB/RB, return without reloading
- ⬜ All seven transitions (slide, zoom, fade, rise, flip, doors, none), screenshot curtain
- ⬜ Framed or full screen; the frame shows title and address
- ⬜ Address bubble and on-screen keyboard; Esc+Left/Right inside the page
- ⬜ Controller as pointer inside pages; downloads
- ⬜ PIN and guest rules for the browser

## People and safety
- ⬜ PIN (set, change, remove; never waits for the admin PIN)
- ⬜ Profiles, guest (locked down by default), admin, per-profile PINs and pages
- ⬜ Xbox games gate
- ⬜ All the IPC checks (ipcGuard) and security standards in SECURITY.md

## Settings
- ✅ Wi-Fi, Bluetooth (live lists, pairing and joining with Cancel, password keyboard with symbols and Show, PIN prompt)
- ⬜ Appearance: Theme Settings, Screens (resolution, refresh, orientation, restart), Display calibration
- ✅ Sound (volume bars with left/right, mute, outputs, microphone, headset mode)
- ⬜ Controller: test, Joy-Con setup (grips), buttons, confirm button, glyphs
- ⬜ Keyboard & mouse
- ⬜ Profiles, PIN
- ⬜ Storage: drives, cleaning, hidden / ignored drives, backups and restore
- ⬜ Update software: update, previous version, graphics build choice, boot menu settings, boot screen
- ⬜ Add-ons: store, shards (signed / unsigned with the admin switch), widgets, themes, reload
- ⬜ Report a problem
- 🟡 Power and Opus — sleep, restart, shut down not yet
- ⬜ Tessera USB: Install Tessera (all of the installer, next to Windows), Recover

## Around the screen
- ⬜ Guide (Guide button over games and over Opus)
- ⬜ Steam: library import, launching, Big Picture
- ✅ Starting games and apps; coming back when they end
- ⬜ Game logs and "exited with code" messages with details
- ⬜ Display restart, nested in Opus, safe mode
- ⬜ Calibration
- ⬜ Updates status

## Changes you may want to approve (nothing is removed without asking)
- New settings planned for both versions: add-tile outline (dashed, solid, none), clock size, tab bar alignment
- The cube emblem is drawn as a floating isometric cube instead of the turning 3D one
- Text in widgets shrinks to fit instead of being cut off

## Checks before the switch
- ⬜ Every QA check of the current Ludus has a Qt counterpart that passes
- ⬜ Side-by-side screenshots: every factory theme × every shell, both versions
- ⬜ A week as an opt-in on real hardware with no regressions
