# Tessera

**A controller-first, themeable gaming OS built on [Bazzite](https://bazzite.gg). Community-made tiles.**

![Tessera's Library in the Mosaic Dark theme](docs/screenshots/hero.jpg)

Tessera starts straight into a console-style launcher that you drive with a gamepad: pick a game, press A, play. Everything else a gaming PC needs (Wi-Fi, Bluetooth, sound, updates, storage) lives in the same controller-friendly Settings. The full desktop is one login away when you want it.

> **Status: early preview.** Tessera is a one-person project that has so far been tried on one machine. It works, but expect rough edges, and please keep a backup of anything you care about. Sections marked *Not yet* below are planned, not built.

## What you get

**A launcher made for a controller**
- Tabs you switch with LB / RB: Browser, Home, Library, Apps, your own *mosaics* (tabs you build yourself), and Settings.
- Home is a page of widgets: a clock, recently played games, six built-in system widgets (CPU, Memory, Storage, Battery, Network, Uptime), and community-made widgets from Add-ons.
- Add games from Steam, Lutris, Heroic and installed apps with one scan, or pick them from your folders. Box art is found automatically and can be replaced per game.
- Mosaics can hold games, apps, widgets and folders. Press Y on a tile for its options.
- An on-screen keyboard (with a symbols layer) for names and passwords, and a keypad for the PIN.

**Make it yours**
- Four factory themes: *Tessera Bright*, *Tessera Dark*, *Tessera Mosaic* and *Tessera Mosaic Dark*. Every setting is yours to change: screen area, text size, colors, corners, borders, background picture or effect, widget style and more.
- Themes aren't locked to the four factory ones. Drop a `theme.json` in `~/Tessera/Themes/<your-theme-id>/` and it shows up alongside them — a theme is values only (colors, layout, grid density, icon style and more), never code, so nothing it ships can do more than Settings itself already allows.
- Theme Settings can also save, rename, overwrite and delete the themes you make right there in the console — no file editing needed. The four factory themes stay read-only. Deleting or renaming a theme someone else is relying on asks for the PIN first, then falls them back to *Tessera Bright*.
- Profiles (Settings > Profiles): name more than one person who uses this Tessera and, optionally, give each their own theme — or leave it following whatever's active. This is the foundation piece, not yet a full switch-user experience with its own library or controls.
- Three tile layouts: **Rails** (sideways rows), **Grid** and **Flow**. Grid and Flow come in ready-made sizes, or set your own (up to 12 columns).
- Display calibration for the launcher and, optionally, for games.
- Controller settings: dead zones, rumble, button mapping, automatic button glyphs (Xbox, PlayStation, Nintendo).
- Nintendo Switch Pro Controllers and Joy-Cons work in the launcher. Two Joy-Cons can be one controller or two players, switched like on the Switch (*Change grip/order*), and the controller test shows their motion sensors.
- A mouse works too: the pointer appears in the theme's colors when you move it, click opens, right-click goes back.

**Settings that don't need a keyboard**

| Group | What's inside |
|---|---|
| Connections | **Wi-Fi** (join with the on-screen keyboard, password hidden unless you press Show, hidden networks, forget), **Bluetooth** (pair controllers and headsets), **Sound** (volume, microphone, output, headset mode) |
| Controllers | Controller settings, button mapping |
| Appearance | Theme settings, profiles, display calibration |
| System | **Storage** (drives, clean-up, backups), **Update software** (with *go back to the previous version*), Add-ons, PIN |
| Power | Sleep, restart, shut down, Desktop Mode |

Every Settings tile shows its status (free space, version, theme, PIN, controller) under a full-bleed icon that colors the whole tile edge to edge. In *Theme Settings > Settings page* you can put small groups side by side, and turn the icons, their motion and the status lines off.

**Family friendly**: an optional PIN guards Settings, deleting things and the browser.

![Tessera's three layouts: Rails, Grid and Flow](docs/screenshots/layouts.jpg)

![The four factory themes](docs/screenshots/themes.jpg)

![Settings, in groups](docs/screenshots/settings.jpg)

![Sound, Bluetooth, Wi-Fi and Update software](docs/screenshots/screens.jpg)

## Install

Tessera is an image of Bazzite with the Tessera session on top, so you start from a Bazzite install and switch to Tessera with one command. Your games, saves and settings stay where they are.

**You need**
- A PC running the current **Bazzite** (install it from [bazzite.gg](https://bazzite.gg); the [Bazzite docs](https://docs.bazzite.gg) cover that part).
- Tessera is built on Bazzite's standard desktop image, so it is aimed at **AMD and Intel graphics for now**. NVIDIA machines have not been tried.

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
- **Not yet:** a built-in web browser for streaming services, Bluetooth keyboards that ask you to type a code, enterprise (802.1X) and WEP Wi-Fi, parental controls beyond the PIN.

## How it's built

- `Containerfile`: starts from `ghcr.io/ublue-os/bazzite:stable` and adds Tessera.
- `system_files/`: files copied into the image. The launcher is plain Electron + HTML/CSS/JavaScript in `system_files/usr/lib/tessera/launcher`, run inside [Gamescope](https://github.com/ValveSoftware/gamescope) by `tessera-session`.
- `build_files/build.sh`: the image build steps.
- GitHub Actions builds the image and publishes it to `ghcr.io/herbalchemist/tessera`. This repo started from the [Universal Blue image template](https://github.com/ublue-os/image-template).
- Want your own spin? Fork the repo, enable Actions, and `bootc switch` to your fork's image.

Bug reports and ideas are welcome as GitHub issues.

## License and credits

Tessera is free software, licensed under the **GNU General Public License v3.0** (see `LICENSE`).

It stands on the shoulders of [Bazzite](https://bazzite.gg), [Universal Blue](https://universal-blue.org), Fedora, [Gamescope](https://github.com/ValveSoftware/gamescope) and [Electron](https://www.electronjs.org). Tessera is an independent project and is not affiliated with or endorsed by any of them. Product and brand names are the property of their owners.
