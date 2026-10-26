# Optional Electron integration checks

These checks run Tessera's actual launcher with temporary library/settings data and a local HTTP test page. They do not launch games, change your installed system, reboot, use your real library, or require a physical controller. The synthetic gamepad test exercises the renderer polling loop; it does not emulate Linux USB/Bluetooth hardware.

From the repository root on a Linux desktop with Node.js and npm:

```bash
npm --prefix qa ci
npm --prefix qa test
```

For a headless Linux machine with Xvfb installed:

```bash
xvfb-run -a npm --prefix qa test
```

The harness uses the QA-installed, pinned Electron executable. Set `TESSERA_ELECTRON` to use another installed executable. Pass an absolute launcher directory as the script's first argument if needed. Results and screenshots are written to `qa-output/` in the current working directory by default; override that with `TESSERA_QA_OUTPUT`.

The suite checks four shell arrangements at 1920×1080 and 1280×720, selected-card and controller-hint visibility, Home/Settings content preservation, saved structural-theme values, invalid shell rejection, a virtual D-pad movement, browser Tab/Enter activation, isolated browser configuration, address-keyboard cancellation, browser exit actions, and main-process PIN checks. It currently records 35 checks, covering every factory theme.

Five more checks drive the embedded browser with stand-in controller input (fed through a `TESSERA_DEV=1` hook in place of a physical pad), and one takes screenshots of the factory themes with a fictional library:

```bash
xvfb-run -a -s "-screen 0 1280x720x24" node qa/browser-pointer.cjs      # cursor, analog scroll, trigger clicks, stick swap
xvfb-run -a -s "-screen 0 1280x720x24" node qa/browser-transitions.cjs  # every entrance/exit animation, resume, Esc+arrow chord
xvfb-run -a -s "-screen 0 1280x720x24" node qa/guide.cjs                # the guide (launcher, over a game, over the browser), first-run setup, desktop helper
xvfb-run -a -s "-screen 0 1280x720x24" node qa/keyboard.cjs             # keyboard & mouse: input-aware hints, key layouts, rebinding, the guided tour
xvfb-run -a -s "-screen 0 1280x720x24" node qa/graphics.cjs             # a graphics card swap: noticed at start, matching build offered and switched to
ART_DIR=/path/to/pictures xvfb-run -a -s "-screen 0 1920x1080x24" node qa/theme-shots.cjs
```

The harness passes `--no-sandbox` because the containerized test environment does not permit normal Chromium sandbox startup. That is a **test-only launch flag**; production launcher code still configures context isolation, Node disabled, and renderer sandboxing. These tests verify the configuration and bridge isolation, not the operating system's enforcement of Chromium sandboxing. Do not use the QA launch flags for your normal browser session.

Physical-controller testing, controller device permissions and hotplug under Gamescope, OS image boot, suspend/resume, system services, and update/rollback behavior still need target-machine or VM validation. The deterministic tests run separately:

```bash
npm --prefix system_files/usr/lib/tessera/launcher run check
npm --prefix system_files/usr/lib/tessera/launcher test
```
