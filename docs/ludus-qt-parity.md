# Ludus (Qt): everything it must do before it replaces the current Ludus

The Qt version becomes the default only when every line here is done and checked: by tests, and by
screenshots of both versions side by side (every factory theme, every shell layout). Until then
the current Ludus is the default and nothing in it changes. Your library, themes, settings and
profiles are the same files in both, so switching never loses anything.

Status: ✅ done and tested · 🟡 partly · ⬜ not yet

## Pages and navigation
- 🟡 Tab bar (Browser, Home, Library, Apps, mosaics, + Mosaic, Settings), in all six tab looks — the Browser tab opens the built-in browser
- 🟡 Every controller moves the screen; keyboard — mouse and pointer not yet; per-pad glyphs (Xbox / PlayStation / Nintendo) are in Settings and Button mapping
- 🟡 Home: widgets on the 12 × 6 grid, add from the preset list, move / resize / remove, four widget styles — downloaded add-on widgets show their name; the frosted style is a tinted pane (no blur of what is behind it yet)
- ✅ Library and Apps lists
- 🟡 Mosaics: make, rename, reorder, delete — per-page grid size, holding Y to lift a tab, pick-up-and-move tiles not yet
- 🟡 Folders: open, back — new folder, rename, delete from inside not yet
- 🟡 Options menu — add a game / app from a file, scan for games, change picture, rename item, remove from library, delete files not yet
- ⬜ Game art (automatic and chosen pictures)
- ⬜ Recently played
- 🟨 Mouse: hover selects (with the pause after a row slides), click opens a tile or a tab, the wheel (move / tabs / off), right click = back, middle = options, side buttons, pointer hides after the set time. Written, builds clean in CI; not yet tried with a real mouse. Widgets on Home do not follow the pointer yet
- 🟨 The tour (first start, and from the guide) and Welcome: ported and compared side by side in all ten stock themes (Library and Home steps); ring, card and buttons match. Remaining: the ring in tall grids ends about 70 px short at the bottom; the sample game lists differ
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
- 🟨 Controller and Keyboard & mouse menus (choices, deadzone, vibration, key layout, mouse). The live controller test (buttons, sticks, triggers, raw numbers, hold B; the triggers rumble the pad through evdev force feedback in the chosen strength and style, not yet run on a real pad) stick calibration and Button mapping (keyboard and per-family controller buttons, press-the-button capture, Confirm/remap applied to Qt navigation) are ported. Change grip/order (live Joy-Con cards from the pads service) is ported too; the card layout with real Joy-Cons has not been run. Adding, removing and moving single keys is ported, and the saved key layout (presets and custom keys) now drives Qt navigation, with the full Ludus's names for the keys (keys are matched by their place on the keyboard, so AZERTY and Dvorak keep working; the scan-code offset is learned from Esc, Space and Enter; not run on a real keyboard)
- 🟨 PIN ported (set, change, remove, lock, browser, Xbox). the first-run welcome ported (with the quick tour)
- 🟨 Storage ported (drives with usage bars, manage by size, scan, library folders, install location, downloads, clean up, backup, restore, drive names, hidden drives). Not yet: "drive plugged in" offer
- ✅ Update software (check, download, restart, go back, graphics builds, and the "new graphics card?" prompt at start; not seen with a real card swap)
- 🟨 Add-ons ported (widgets, themes, shards with safety settings, built in, get add-ons, download folders). Shard pages that open a web address open them in the browser
- 🟨 Report a problem (save, read, delete, build the GitHub issue; opens in the browser)
- 🟡 Power and Opus — sleep, restart, shut down not yet
- 🟨 Tessera USB: Install Tessera (next to Windows too) and Recover run the full Ludus's own step code unchanged in the bridge (`backend/flowhost.js`); their menus, questions and progress go to the Qt menus. Entry points: first screen on the USB, Settings > Tessera USB, the guide. Not yet run on a real USB; needs a live-USB test

## Around the screen
- 🟨 Guide: panel with Go, quick settings (volume, Wi-Fi, Bluetooth, batteries), profiles, help, power, notifications panel (X/Y), Resume/Close for a running game. Picture-checked in all three styles (side panel, floating card, compact). The Opus helper (guide over the desktop) is written (`ludus.py --guide`: a hidden see-through always-on-top window that the main process shows when Guide is pressed, with Return to Ludus and no Home/Settings/Help; clicking away closes it) but has not been run on a real desktop; `usr/bin/tessera-guide` still starts the Electron one until the Qt screen is the default. The screen now also hides while a game runs and comes back after, as the full Ludus's window does
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
- 🟨 QA checks. The full Ludus's qa/ checks that test the main process (addons, profiles and PINs, installer and recovery helpers, graphics, report, boot screen, Steam library, screens' trial and restart) test code the Qt version runs unchanged, so they apply to it as they are. The ones that drive the Electron page need a Qt counterpart: `ludus.py --qa` (run in CI after the pictures) has 16 so far, and also found a real bug (controller presses were being dropped). Done: key layouts by place on the keyboard (standard and WASD, AZERTY-style key reports), tab keys, Guide key, the guide in its three styles. Still to write: hints following keyboard/mouse/controller (keyboard.cjs, input.cjs), hover selecting a tile, Confirm button choice and button mapping at the screen, key capture/binding, the guided tour steps (keyboard.cjs), "who's playing" and profile switching at the screen (profiles.cjs), screens settings flow (screens.cjs), browser pointer and transitions (browser-*.cjs, needs QtWebEngine in CI), first-run setup (guide.cjs)
- 🟨 Side-by-side screenshots: every stock theme, Library / Home / Settings / Tabs plus the tour, with layout numbers (CI "themes" job). Layout within 0-2 px in nine of ten; Indigo Cube within about 8 px. Still differing: Channel White tab icons and soft tile borders, Indigo Cube glow on the cube, Arcade Marquee tile title height. Other shells and add-on themes not yet
- ⬜ A week as an opt-in on real hardware with no regressions
