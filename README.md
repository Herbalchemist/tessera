<div align="center">

# Tessera

**A gaming OS you drive from the couch.**<br>
Controller-first, themeable down to the layout, built on [Bazzite](https://bazzite.gg).

[![Build](https://github.com/Herbalchemist/tessera/actions/workflows/build.yml/badge.svg)](https://github.com/Herbalchemist/tessera/actions/workflows/build.yml)
![Version](https://img.shields.io/badge/launcher-0.21.0-6a58d8)
![License](https://img.shields.io/badge/license-GPL--3.0-12a37f)
![Status](https://img.shields.io/badge/status-early%20preview-ff8a3d)

[Install](#install) · [Controls](#controls) · [Make it yours](#make-it-yours) · [Theming guide](docs/theming.md) · [How it's built](#how-its-built)

![Tessera's Library in the Mosaic Dark theme](docs/screenshots/hero.jpg)

</div>

Turn the PC on and you're in a console-style launcher: pick a game, press A, play. Everything else a gaming PC needs (Wi-Fi, Bluetooth, sound, updates, storage) lives in the same controller-friendly Settings. A keyboard and mouse work just as well. The full KDE desktop is one menu away when you want it.

> **Status: early preview.** Tessera is a one-person project tested on one machine so far. It works, but expect rough edges, and keep a backup of anything you care about. Anything marked *Not yet* is planned, not built.

## Highlights

| | |
|---|---|
| 🎮 **Couch-first** | Every screen works with a controller: Xbox, PlayStation, Switch Pro and Joy-Cons, with button labels that match the pad in your hands. |
| ⌨️ **Keyboard & mouse too** | Hints switch to keycaps or *Click* the moment you touch a keyboard or mouse. Every key can be rebound, with layouts for WASD, H J K L and TV remotes. |
| 🧩 **Themes that change the layout** | Ten factory themes, and every part of the layout is a setting: where the menu sits, tile shape, clock, selection frame, the art behind everything. |
| 🏠 **The guide** | Press Guide from anywhere, even mid-game or on the desktop, for quick settings, controller batteries, profiles and power. |
| 🌐 **A real browser** | Full-screen pages with a stick-driven cursor, analog scrolling and trigger clicks. |
| 👋 **A friendly first run** | Setup asks who's playing, lets you pick a look with the launcher previewing live, and ends with an optional guided tour. |
| 🔒 **Family friendly** | An optional PIN guards Settings, deleting things and the browser. |
| 🕊️ **Yours** | No telemetry, no account, and Steam never starts unless you start it. |

## Ten looks out of the box

![The ten factory themes](docs/screenshots/themes.jpg)

*Tessera Bright, Dark, Mosaic and Mosaic Dark; Arcade Marquee; and five homages to console home screens: Cartridge Pop, Nova Black, Dashboard Steel, Indigo Cube and Channel White. The homages echo layout, color and motion only; no console maker's logos, artwork or sounds are used.*

## Controls

The hints at the bottom of the screen always show the buttons for what you're holding.

| | Controller | Keyboard (Standard layout) | Mouse |
|---|---|---|---|
| Move | D-pad or left stick | Arrow keys (or the number pad) | Scroll wheel |
| Open / select | A | Enter or Space | Click |
| Back | B | Esc or Backspace | Right-click or the back thumb button |
| Options for a tile | Y (hold Y to pick a tile up and move it) | Y or the Menu key | Middle click |
| Switch tab | LB / RB | PgUp / PgDn, `[` / `]`, or Esc + ← / → | Click a tab, or the forward thumb button |
| The guide | Guide (Xbox / PS / Home button) | F1 or Home | |
| Volume | | Volume keys | |

Every keyboard action can be rebound in **Settings › Keyboard & mouse**. Bindings follow the key's position, so they survive a change of keyboard layout, and the hints show what's actually printed on your keys. Pick a starting layout there:

- **Standard**: arrows.
- **WASD**: Q / E for tabs, Space to select.
- **H J K L**: for vim hands.
- **TV remote / media keys**: OK, Back, Home and the channel keys.

You can also keep the hints on controller buttons, or hide the pointer sooner or never.

**In the browser:** the right stick moves a cursor and the left stick scrolls, both faster the further you push. RT clicks and LT right-clicks, Y types an address, X jumps to the next link, and LB / RB or B leave the page. Swap the sticks or change their speed in **Settings › Controller**.

## What you get

**A launcher made for a controller**
- Tabs: Browser, Home, Library, Apps, your own *mosaics* (tabs you build yourself) and Settings.
- **Home** is a page of widgets: a clock, recently played, six system widgets (CPU, Memory, Storage, Battery, Network, Uptime) and community widgets from Add-ons.
- Add games from Steam, Lutris, Heroic and installed apps with one scan, or pick them from your folders. Box art is found automatically and can be replaced per game.
- **The guide**: press Guide from anywhere, even in the middle of a game, for:
  - what's running (resume or close it);
  - volume, Wi-Fi and Bluetooth;
  - controller batteries and profiles;
  - recent notifications and power;
  - *Take the tour*.

  Holding Guide goes straight Home (swap press and hold in *Settings › Controller*). In Desktop Mode the same guide comes up over the desktop with *Return to Tessera*. It steps aside while Steam is running, since Steam takes the button for itself.
- **First-run setup**: who's playing (a profile), pick a look with the whole launcher previewing behind it, an optional PIN, and an optional **guided tour** that lights up each part of the screen in turn.
- An on-screen keyboard (with a symbols layer) for names and passwords, and a keypad for the PIN. With a real keyboard you just type.
- Nintendo Switch Pro Controllers and Joy-Cons work in the launcher. Two Joy-Cons can be one controller or two players, switched like on the Switch (*Change grip/order*), and the controller test shows their motion sensors.

**Settings that don't need a keyboard**

| Group | What's inside |
|---|---|
| Connections | **Wi-Fi** (join with the on-screen keyboard, password hidden unless you press Show, hidden networks, forget), **Bluetooth** (pair controllers and headsets), **Sound** (volume, microphone, output, headset mode) |
| Controllers | **Controller**: live test, Guide button, button mapping, dead zones, rumble, button labels, browser cursor and scroll. **Keyboard & mouse**: key layouts, every key rebindable, hint style, pointer and scroll wheel |
| Appearance | Theme settings, profiles, display calibration |
| System | **Storage** (drives, clean-up, backups), **Update software** (with *go back to the previous version*), Add-ons, PIN |
| Power | Sleep, restart, shut down, Desktop Mode |

![Settings, in groups](docs/screenshots/settings.jpg)

![Sound, Bluetooth, Wi-Fi and Update software](docs/screenshots/screens.jpg)

## Make it yours

- **Theme Settings** changes everything from the couch: screen area, text size, colors, corners, borders, background picture or effect, widget style, motion, and the browser's entrance animation (slide, zoom, fade, rise, flip, doors or none).
- **Shell arrangement** is a layout preset rather than a color swap: **Classic**, **Bottom dock**, **Crossbar**, **Dashboard**, **Home row**, **Spotlight**, **Pivot**, **Cube** and **Channels**.
- **Layout parts** let you pick each piece on its own, every one with an *Auto* option that follows the arrangement:
  - menu position and tab look;
  - clock and selection frame;
  - where the name goes;
  - tile shape, size and look;
  - how rows move;
  - the selection's art behind everything;
  - an emblem;
  - where the button hints sit.

  So round icon buttons and a curved clock bar can sit over spotlight art.
- **Three tile layouts**: **Rails** (sideways rows), **Grid** and **Flow**, in ready-made sizes or your own (up to 12 columns).
- **Your own themes**: *Save current as a new theme…* writes a `theme.json` you can rename, overwrite, share or hand-edit. Factory themes stay read-only. A theme is values only, never code, so nothing it ships can do more than Settings itself already allows.
- **Profiles**: each person can have their own theme.
- Display calibration for the launcher and, optionally, for games.

📘 **[The theming guide](docs/theming.md)** covers every setting a `theme.json` can hold, how the layout parts combine, worked examples, and a checker that tells you what Tessera will accept before you copy a theme over.

![Tessera's three layouts: Rails, Grid and Flow](docs/screenshots/layouts.jpg)

## Install

Tessera is an image of Bazzite with the Tessera session on top, so you start from a Bazzite install and switch to Tessera with one command. Your games, saves and settings stay where they are.

**You need**
- A PC running the current **Bazzite** (install it from [bazzite.gg](https://bazzite.gg); the [Bazzite docs](https://docs.bazzite.gg) cover that part).
- **AMD or Intel graphics, for now.** Bazzite itself supports NVIDIA cards, but through separate images (`bazzite-nvidia-open` for GTX 16 / RTX cards, `bazzite-nvidia` for older ones) that come with NVIDIA's driver. Tessera is currently built only from the standard `bazzite` image, which doesn't include that driver. An NVIDIA build of Tessera is planned.
  - **On an NVIDIA Bazzite install, don't switch to Tessera yet.** You'd lose the NVIDIA driver until you switch back.

**Switch to Tessera**

```bash
sudo bootc switch ghcr.io/herbalchemist/tessera:latest
systemctl reboot
```

After the restart the machine signs in to Tessera by itself.

**Update**: in Tessera, open *Settings > Update software*. Or, from a terminal: `sudo bootc upgrade`, then restart. An update starts after a restart and the old version is kept.

**Go back**
- In Tessera: *Settings > Update software > Go back to the previous version*, then restart. Right after your first switch, the previous version is your Bazzite.
- Or pick the previous entry in the boot menu.
- Or return to stock Bazzite for good: `sudo bootc switch ghcr.io/ublue-os/bazzite:stable`, then restart.

**Desktop Mode**
- In Tessera: *Settings > Power > Desktop Mode*. You land on the login screen, so you need your account password; choose the desktop session there.
- To come back, open *Return to Tessera* in the application menu. It asks first, then closes the desktop (your open programs ask to save their work) and starts Tessera, so nothing of the desktop is left running. Or log out and pick *Tessera* at the login screen.
- If automatic sign-in is switched off, or someone else is signed in, *Return to Tessera* opens Tessera on top of the running desktop instead and closes nothing. *Open Tessera on top of the desktop* in the application menu does that on purpose.
- Prefer to boot to the desktop? `sudo touch /etc/tessera/no-autologin`, then restart. Delete that file to turn it back on.

**Forgot the PIN?** From Desktop Mode, run `tessera-reset-pin` in a terminal. It removes the PIN so you can set a new one.

## Good to know

- **Steam never starts by itself.** Tessera starts programs only when you pick them, and it doesn't wrap games in a sandbox.
- **No telemetry.** The launcher makes no network requests of its own (its content-security policy forbids them). Updates are fetched by the system's own `bootc` tool.
- **Browser permissions:** the embedded browser is isolated from the launcher and currently denies camera, microphone, location, notifications and other permission requests. A controller-friendly website-permission prompt is not built yet. Typing into a page's own text fields with the on-screen keyboard is not built yet (the address bar works).
- **Not yet:** Bluetooth keyboards that ask you to type a code, enterprise (802.1X) and WEP Wi-Fi, parental controls beyond the PIN.

## Roadmap

- A freeform, drag-and-drop layout editor, and a separate theme creator app.
- Typing into a web page's own text fields with the on-screen keyboard, and a controller-friendly prompt for website permissions.
- Full profile switching: each person with their own library and controls.
- An NVIDIA build (on Bazzite's `-nvidia-open` image).

## How it's built

- `Containerfile`: starts from `ghcr.io/ublue-os/bazzite:stable` and adds Tessera.
- `system_files/`: files copied into the image. The launcher is plain Electron + HTML/CSS/JavaScript in `system_files/usr/lib/tessera/launcher`, run inside [Gamescope](https://github.com/ValveSoftware/gamescope) by `tessera-session`.
- `build_files/build.sh`: the image build steps.
- GitHub Actions builds the image and publishes it to `ghcr.io/herbalchemist/tessera`. This repo started from the [Universal Blue image template](https://github.com/ublue-os/image-template).
- Want your own spin? Fork the repo, enable Actions, and `bootc switch` to your fork's image.

**Theme checker**: `node tools/check-theme.cjs path/to/theme.json` (see [the theming guide](docs/theming.md)).

**Launcher checks** (Node.js required):

```bash
npm --prefix system_files/usr/lib/tessera/launcher run check
npm --prefix system_files/usr/lib/tessera/launcher test
```

These checks cover deterministic input/theme logic, not real controller hardware or a booted Bazzite image. See `docs/tessera-review-and-fixes.md` for the patch assessment and remaining design work.

Bug reports and ideas are welcome as GitHub issues.

## License and credits

Tessera is free software, licensed under the **GNU General Public License v3.0** (see `LICENSE`).

It stands on the shoulders of [Bazzite](https://bazzite.gg), [Universal Blue](https://universal-blue.org), Fedora, [Gamescope](https://github.com/ValveSoftware/gamescope) and [Electron](https://www.electronjs.org). Tessera is an independent project and is not affiliated with or endorsed by any of them. Product and brand names are the property of their owners.
