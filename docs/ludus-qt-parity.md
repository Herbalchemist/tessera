# Ludus (Qt): everything it must do before it replaces the current Ludus

The Qt version becomes the default only when every line here is done and checked: by tests, and by
screenshots of both versions side by side (every factory theme, every shell layout). Until then
the current Ludus is the default and nothing in it changes. Your library, themes, settings and
profiles are the same files in both, so switching never loses anything.

Status: ✅ done and tested · 🟡 partly · ⬜ not yet

## Pages and navigation
- 🟡 Tab bar (Library, Apps, mosaics, + Mosaic, Settings, Browser) — Home and Browser tabs not yet
- 🟡 Every controller moves the screen; keyboard — mouse and pointer not yet; per-pad glyphs (Xbox / PlayStation / Nintendo) not yet
- ⬜ Home: widgets (inlays) placed on its grid, add / move / resize / remove
- ✅ Library and Apps lists
- 🟡 Mosaics: make, rename, reorder, delete — per-page grid size, holding Y to lift a tab, pick-up-and-move tiles not yet
- 🟡 Folders: open, back — new folder, rename, delete from inside not yet
- 🟡 Options menu — add a game / app from a file, scan for games, change picture, rename item, remove from library, delete files not yet
- ⬜ Game art (automatic and chosen pictures)
- ⬜ Recently played
- ⬜ Hover-to-select with the mouse, with the edge-scroll pause
- ⬜ The tour (first start) and Welcome
- ⬜ Status line and messages in the theme's style

## Themes and customization (docs/theming.md)
- ⬜ All 49 theme settings (colors, sizes, radius, shadows, fonts, motion, background picture and dim…)
- ⬜ All 9 shell layouts: classic, dock, crossbar, dashboard, switch, hero, pivot, cube, channel
- ⬜ Layout modes: rails, grid, flow; columns × rows; packed groups
- ⬜ The 10 factory themes, looking the same as today
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
- ⬜ Wi-Fi, Bluetooth
- ⬜ Appearance: Theme Settings, Screens (resolution, refresh, orientation, restart), Display calibration
- ⬜ Sound
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

## Checks before the switch
- ⬜ Every QA check of the current Ludus has a Qt counterpart that passes
- ⬜ Side-by-side screenshots: every factory theme × every shell, both versions
- ⬜ A week as an opt-in on real hardware with no regressions
