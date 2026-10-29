#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Tessera's name and look, over Bazzite's: the boot menu, About this system, the desktop's logos,
# splash, wallpaper and lock screen, the terminal's logo and banner, and the computer's name.
#
# What stays Bazzite's, on purpose:
#   - os-release ID, ID_LIKE, VARIANT_ID and IMAGE_ID, and /usr/share/ublue-os/image-info.json:
#     Bazzite's own tools (ujust, its first-login setup, its hardware setup) read them to know what
#     they're running on, and Tessera is still that underneath.
#   - Bazzite's tools and their names (ujust, Bazzite Portal, the rollback helper, its documentation):
#     they are Bazzite's, and their documentation is about the system Tessera is built on.
# Each step says what it changed; a piece Bazzite has moved or renamed is reported, not fatal, so a
# Bazzite update can't stop the build. tools/branding-inventory.sh lists what's still branded.
set -uo pipefail

BR=/usr/share/tessera/branding
note() { echo "branding: $*"; }
missing() { echo "branding: (not found, skipped) $*"; }

# ---- the system's name: os-release (boot menu entries, About this system, fastfetch, hostnamectl)
for f in /usr/lib/os-release /etc/os-release; do
  [ -L "$f" ] && continue # /etc/os-release is usually a link to the first one
  [ -f "$f" ] || { missing "$f"; continue; }
  sed -i \
    -e 's|^NAME=.*|NAME="Tessera"|' \
    -e 's|^PRETTY_NAME=.*|PRETTY_NAME="Tessera"|' \
    -e 's|^LOGO=.*|LOGO=tessera-logo|' \
    -e 's|^DEFAULT_HOSTNAME=.*|DEFAULT_HOSTNAME="tessera"|' \
    -e 's|^HOME_URL=.*|HOME_URL="https://github.com/Herbalchemist/tessera"|' \
    -e 's|^DOCUMENTATION_URL=.*|DOCUMENTATION_URL="https://github.com/Herbalchemist/tessera#readme"|' \
    -e 's|^SUPPORT_URL=.*|SUPPORT_URL="https://github.com/Herbalchemist/tessera/issues"|' \
    -e 's|^BUG_REPORT_URL=.*|BUG_REPORT_URL="https://github.com/Herbalchemist/tessera/issues"|' \
    -e 's|^ANSI_COLOR=.*|ANSI_COLOR="0;38;2;180;167;255"|' \
    -e 's|^BOOTLOADER_NAME=.*|BOOTLOADER_NAME="Tessera"|' \
    "$f"
  for kv in 'LOGO=tessera-logo' 'DEFAULT_HOSTNAME="tessera"'; do
    grep -q "^${kv%%=*}=" "$f" || echo "$kv" >> "$f"
  done
  note "$f: $(grep -E '^(NAME|PRETTY_NAME|DEFAULT_HOSTNAME)=' "$f" | tr '\n' ' ')"
done

# ---- the computer's name: Bazzite's hardware setup names a fresh install "bazzite"
f=/usr/libexec/bazzite-hardware-setup
if [ -f "$f" ] && grep -q 'set-hostname bazzite' "$f"; then
  sed -i 's/set-hostname bazzite/set-hostname tessera/g' "$f"
  note "$f now names a fresh install tessera"
else
  missing "the hostname line in $f"
fi

# ---- logos: every icon name Bazzite's logo goes by now shows Tessera's
install -Dm644 "$BR/tessera-logo.svg" /usr/share/icons/hicolor/scalable/apps/tessera-logo.svg
install -Dm644 "$BR/tessera-logo.svg" /usr/share/icons/hicolor/scalable/places/tessera-logo.svg
install -Dm644 "$BR/tessera-logo-white.svg" /usr/share/icons/hicolor/scalable/places/tessera-logo-white.svg
for n in 16 22 24 32 36 48 64 96 128 256 512; do
  install -Dm644 "$BR/tessera-logo-$n.png" "/usr/share/icons/hicolor/${n}x${n}/apps/tessera-logo.png"
done
# distributor-logo*.svg are files (bazzite-logo*.svg link to them); start-here is the menu button
for f in /usr/share/icons/hicolor/scalable/places/distributor-logo.svg /usr/share/icons/hicolor/scalable/places/bazzite-logo-le.svg \
         /usr/share/icons/hicolor/scalable/apps/start-here.svg; do
  if [ -e "$f" ]; then rm -f "$f"; install -m644 "$BR/tessera-logo.svg" "$f"; note "$f"; else missing "$f"; fi
done
f=/usr/share/icons/hicolor/scalable/places/distributor-logo-white.svg
if [ -e "$f" ]; then rm -f "$f"; install -m644 "$BR/tessera-logo-white.svg" "$f"; note "$f"; else missing "$f"; fi
for n in 16 22 24 32 36 48 96 256; do
  for f in "/usr/share/icons/hicolor/${n}x${n}/bazzite-logo-icon.png" "/usr/share/icons/hicolor/${n}x${n}/places/start-here.png" "/usr/share/icons/hicolor/${n}x${n}/apps/start-here.png"; do
    [ -e "$f" ] && { rm -f "$f"; install -m644 "$BR/tessera-logo-$n.png" "$f"; }
  done
done
note "bazzite-logo-icon.png and start-here.png, every size"
for f in /usr/share/pixmaps/system-logo-white.png; do
  if [ -e "$f" ]; then rm -f "$f"; install -m644 "$BR/tessera-logo-white-256.png" "$f"; note "$f"; else missing "$f"; fi
done
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -qf /usr/share/icons/hicolor || true

# ---- KDE: About this system, the splash while the desktop starts
mkdir -p /etc/xdg
cat > /etc/xdg/kcm-about-distrorc <<'EOF'
[General]
LogoPath=/usr/share/tessera/branding/tessera-logo-256.png
Name=Tessera
Website=https://github.com/Herbalchemist/tessera
Variant=Built on Bazzite
EOF
note /etc/xdg/kcm-about-distrorc
found=0
for f in /usr/share/plasma/look-and-feel/*/contents/splash/images/bazzite_logo.svgz; do
  [ -e "$f" ] || continue
  gzip -9nc "$BR/tessera-logo.svg" > "$f"; found=1; note "$f"
done
[ "$found" = 1 ] || missing "the splash logo (bazzite_logo.svgz)"

# ---- wallpaper and lock screen (the Tessera wallpaper is in /usr/share/wallpapers/Tessera)
if [ -d /usr/share/wallpapers/Tessera ]; then
  ln -sfn Tessera /usr/share/wallpapers/Default
  note "/usr/share/wallpapers/Default -> Tessera"
fi
WP=/usr/share/wallpapers/Tessera/contents/images/3840x2160.jpg
f=/etc/xdg/kscreenlockerrc
if [ -f "$f" ]; then
  sed -i -e "s|^Image=.*|Image=$WP|" -e "s|^PreviewImage=.*|PreviewImage=$WP|" "$f"; note "$f"
else
  printf '[Greeter][Wallpaper][org.kde.image][General]\nImage=%s\nPreviewImage=%s\n' "$WP" "$WP" > "$f"; note "$f (new)"
fi
# The desktop's wallpaper is set by the Plasma look-and-feel setup scripts (Vapor's points at
# convergence.jxl, Bazzite's picture): every Plasma file naming it gets Tessera's instead.
found=0
while IFS= read -r f; do
  sed -i "s|/usr/share/wallpapers/convergence\.jxl|$WP|g" "$f"; found=1; note "$f: wallpaper"
done < <(grep -rl 'wallpapers/convergence\.jxl' /usr/share/plasma /etc/xdg 2>/dev/null)
[ "$found" = 1 ] || missing "the Plasma script that sets convergence.jxl"
# Bazzite's own wallpapers stay as they are and can still be picked: Tessera's sits beside them
# (and is the default). An account that started on Bazzite is switched over once, at its first
# Tessera session (/usr/libexec/tessera/desktop-wallpaper). Bazzite's pictures go before 1.0.0,
# once Tessera has enough of its own.

# ---- the terminal: fastfetch's logo and the banner (motd)
f=/usr/share/ublue-os/bazzite/fastfetch.jsonc
if [ -f "$f" ]; then
  sed -i \
    -e "s|\"source\": \"/usr/share/ublue-os/bazzite/logo.txt\"|\"source\": \"$BR/logo.txt\"|" \
    -e 's|"1": "[^"]*"|"1": "38;2;180;167;255"|' -e 's|"2": "[^"]*"|"2": "38;2;255;179;199"|' \
    -e 's|"3": "[^"]*"|"3": "38;2;143;227;207"|' -e 's|"4": "[^"]*"|"4": "38;2;255;217;143"|' \
    -e 's|"text": "/usr/libexec/bazzite-fetch-image"|"text": "/usr/libexec/tessera-fetch-image"|' \
    "$f"
  note "$f"
else
  missing "$f"
fi
f=/usr/share/ublue-os/motd/template.md
if [ -f "$f" ]; then install -m644 "$BR/motd.md" "$f"; note "$f"; else missing "$f"; fi

# ---- the boot splash (Plymouth). Bazzite's theme, bgrt, draws the spinner theme's watermark at the
# bottom: the Bazzite wordmark. Every theme's watermark becomes Tessera's. The splash runs from the
# initramfs, so build.sh rebuilds that afterwards (a changed file here alone would never be seen).
found=0
for f in /usr/share/plymouth/themes/*/watermark.png; do
  [ -e "$f" ] || continue
  install -m644 "$BR/tessera-plymouth-watermark.png" "$f"; found=1; note "$f"
done
[ "$found" = 1 ] || missing "a Plymouth watermark (/usr/share/plymouth/themes/*/watermark.png)"

# ---- Bazzite's own pop-ups and pins: Tessera has its own first-run setup and updates
for f in /etc/skel/.config/autostart/bazzite-portal.desktop /etc/xdg/autostart/bazzite-announcement.desktop; do
  if [ -e "$f" ]; then rm -f "$f"; note "no longer starts by itself: $f"; else missing "$f"; fi
done
# Bazzite's updater rebases to Bazzite images; Tessera updates itself (Settings > Update software).
# Its forum link is Bazzite's community. Both stay installed, out of the app menu.
for f in /usr/share/applications/io.github.rfrench3.bazzite-updater.desktop /usr/share/applications/discourse.desktop; do
  if [ -f "$f" ]; then grep -q '^NoDisplay=true' "$f" || sed -i '/^\[Desktop Entry\]/a NoDisplay=true' "$f"; note "hidden from the menu: $f"; else missing "$f"; fi
done
f=/usr/share/applications/bazzite-documentation.desktop
if [ -f "$f" ]; then sed -i 's/^Name=Documentation$/Name=Bazzite documentation/' "$f"; note "$f: Bazzite documentation"; fi
f=/usr/share/plasma/shells/org.kde.plasma.desktop/contents/updates/bazzite-pins.js
if [ -f "$f" ]; then sed -i '/"applications:io.github.ublue_os.yafti_gtk.desktop",/d' "$f"; note "$f: Bazzite Portal not pinned"; fi
true
