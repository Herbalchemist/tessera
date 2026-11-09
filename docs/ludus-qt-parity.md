# Ludus (Qt): everything it must do before it replaces the current Ludus

The Qt version becomes the default only when every line here is done and checked: by tests, and by
screenshots of both versions side by side (every factory theme, every shell layout). Until then
the current Ludus is the default and nothing in it changes. Your library, themes, settings and
profiles are the same files in both, so switching never loses anything.

Status: ✅ done and tested · 🟡 partly · ⬜ not yet

## Pages and navigation
- 🟡 Tab bar (Browser, Home, Library, Apps, mosaics, + Mosaic, Settings), in all six tab looks — the Browser tab opens the built-in browser
- 🟡 Every controller moves the screen; keyboard — mouse and pointer not yet; per-pad glyphs (Xbox / PlayStation / Nintendo) not yet
- 🟡 Home: widgets on the 12 × 6 grid, add from the preset list, move / resize / remove, four widget styles — downloaded add-on widgets show their name; the frosted style is a tinted pane (no blur of what is behind it yet)
- ✅ Library and Apps lists
- 🟡 Mosaics: make, rename, reorder, delete — per-page grid size, holding Y to lift a tab, pick-up-and-move tiles not yet
- 🟡 Folders: open, back — new folder, rename, delete from inside not yet
- 🟡 Options menu — add a game / app from a file, scan for games, change picture, rename item, remove from library, delete files not yet
- ⬜ Game art (automatic and chosen pictures)
- ⬜ Recently played
- ⬜ Hover-to-select with the mouse, with the edge-scroll pause
- 🟨 The tour (first start, and from the guide) and Welcome: ported and picture-checked; the ring lights the whole page area rather than hugging the tiles
- 🟡 Status line and messages — shown under the tiles; the full set of messages not yet

## Themes and customization (docs/theming.md)
- 🟡 All 49 theme settings are read; drawn so far: colors, screen area, font size, radius, borders, shadows, selection ring and pastel glow, background picture and dim, backdrops, widgets, motion — checked side by side by the CI job (reports/ludus-qt-themes)
- 🟡 All 9 shell layouts and every layout part (menu position, tabs, clock, frame, title, tile shape and size, row, card look, spotlight, emblem, hints) — drawn; being matched against the current Ludus one theme at a time
- 🟡 Layout modes: rails, grid, flow; columns × rows, per-page grid sizes read — packed groups and the per-page grid-size editor not yet
- 🟡 The 10 factory themes draw; the differences found so far are listed in the side-by-side report
- ⬜ Themes from ~/Tessera/Themes (theme.json), with the same checks and limits
- 🟨 Theme Settings: ported (see Appearance below); the wheel is checked in CI pictures
- ⬜ Per-profile themes; "everyone" theme
- ⬜ Busy cursors, the boot art (unchanged files)

## The built-in browser
- 🟨 Browser tab: opens from A or after a moment on the tab (bumping onto it), leaves with LB / RB / B, returns to the same page (QtWebEngine; CI shows the frame, the page itself has not run in CI)
- 🟨 Transitions (slide, zoom, fade, rise, flip, doors, none) play on the live page; "doors" is a scale-and-fade, not two doors
- 🟨 Framed or full screen; the frame shows the neighbouring tabs, the address with lock, title and loading line, corner brackets
- 🟨 Address: Y opens the keyboard with the address selected and a row of www. .com .org .net / : ? =; the pull-out bubble animation is not ported (the keyboard's own field is used). Esc+Left/Right inside the page switch tabs
- 🟨 Controller as pointer (sticks, triggers, scroll, d-pad keys) runs on the full Ludus's own pointer code, played into the page as real mouse and key events; downloads go to the Downloads folder under a cleaned name; every permission refused; pop-ups refused; http(s) only
- ✅ PIN, profile PIN and guest rules (the same checks as the full Ludus, asked on the screen)
- 🟨 The guide over the browser; "Back to the browser" (the guide opens over the page and hands it back on close; not run with a live page yet)

## People and safety
- ⬜ PIN (set, change, remove; never waits for the admin PIN)
- 🟨 Profiles ported (who's playing, switch, add, Guest options, profile options: rename, theme, PINs, admin, remove). The page closes before switching
- ⬜ Xbox games gate
- ⬜ All the IPC checks (ipcGuard) and security standards in SECURITY.md

## Settings
- ✅ Wi-Fi, Bluetooth (live lists, pairing and joining with Cancel, password keyboard with symbols and Show, PIN prompt)
- 🟨 Appearance, Theme Settings (every setting type, color wheel, boot screen, boot menu, save/rename/overwrite/delete). Screens ported (with the keep-or-revert countdown). Display calibration ported (steps, test patterns, a shader over the whole screen; Y toggles "as it was" instead of hold). "New screen plugged in" and "drive plugged in" offers ported
- ✅ Sound (volume bars with left/right, mute, outputs, microphone, headset mode)
- 🟨 Controller and Keyboard & mouse menus (choices, deadzone, vibration, key layout, mouse). The live controller test (buttons, sticks, triggers, raw numbers, hold B; vibration while testing not yet) stick calibration and Button mapping (keyboard and per-family controller buttons, press-the-button capture, Confirm/remap applied to Qt navigation) are ported. Change grip/order (live Joy-Con cards from the pads service) is ported too; the card layout with real Joy-Cons has not been run. Still to do: adding and removing single keys
- 🟨 PIN ported (set, change, remove, lock, browser, Xbox). the first-run welcome ported (with the quick tour)
- 🟨 Storage ported (drives with usage bars, manage by size, scan, library folders, install location, downloads, clean up, backup, restore, drive names, hidden drives). Not yet: "drive plugged in" offer
- ✅ Update software (check, download, restart, go back, graphics builds, and the "new graphics card?" prompt at start; not seen with a real card swap)
- 🟨 Add-ons ported (widgets, themes, shards with safety settings, built in, get add-ons, download folders). Shard pages that open a web address open them in the browser
- 🟨 Report a problem (save, read, delete, build the GitHub issue; opens in the browser)
- 🟡 Power and Opus — sleep, restart, shut down not yet
- ⬜ Tessera USB: Install Tessera (all of the installer, next to Windows), Recover

## Around the screen
- 🟨 Guide: panel with Go, quick settings (volume, Wi-Fi, Bluetooth, batteries), profiles, help, power, notifications panel (X/Y), Resume/Close for a running game. Picture-checked. Still to do: the floating and compact guide styles (side panel only for now), the Opus helper mode (guide over the desktop), the installer entry
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
