#!/bin/bash

set -ouex pipefail

# Copy the contents of system_files/ of the git repo to /
cp -avf "/ctx/system_files"/. /

# A zip, a download or some editors can drop the executable bit of a script on its way into the
# repo. Every script in system_files starts with "#!", so exactly those are made executable here.
find /ctx/system_files -type f -print0 | while IFS= read -r -d '' f; do
  if IFS= read -r -n 2 magic < "$f" && [ "$magic" = '#!' ]; then
    chmod 0755 "${f#/ctx/system_files}"
  fi
done
# The session cannot start without this one: fail the build now rather than ship an image that
# drops back to the login screen.
if [ ! -x /usr/bin/tessera-session ]; then
  echo "tessera-session is missing or not executable" >&2
  exit 1
fi

# tessera-fix-graphics (switching builds after a graphics card swap) is a Python script.
command -v python3 >/dev/null || dnf5 install -y python3

### Tessera launcher
# Node is only needed here, to fetch Electron into the launcher folder.
dnf5 install -y nodejs npm wtype
# Which Electron: the version in launcher/electron-version (one line, like 38.2.0) if that
# file exists, so every build uses the same one and an update only carries what really
# changed. Without the file the newest is used, as before.
ELECTRON_VERSION=latest
if [ -f /usr/lib/tessera/launcher/electron-version ]; then
  ELECTRON_VERSION="$(tr -d '[:space:]v' < /usr/lib/tessera/launcher/electron-version)"
fi
# npm keeps its cache and its logs in a home directory, and Electron's installer keeps its
# download there too. In a bootc image /root is a link to /var/roothome, which does not exist
# while the image is being built, so npm stopped with "ENOTDIR ... mkdir '/root'". Give it a
# scratch home on the tmpfs the Containerfile mounts at /tmp, and remove it again afterwards so
# that no cache or download ends up in the image.
NPM_HOME=/tmp/tessera-npm
mkdir -p "$NPM_HOME"
HOME="$NPM_HOME" \
npm_config_cache="$NPM_HOME/cache" \
npm_config_update_notifier=false \
npm_config_fund=false \
npm_config_audit=false \
  npm install --prefix /usr/lib/tessera/launcher --omit=dev --save-exact "electron@${ELECTRON_VERSION}"
# Older Electron packages fetched the actual program (dist/electron) in a postinstall script while
# the package was being installed. Newer ones have no such script: the program is fetched by Electron's own
# installer (the "install-electron" command) when it is first needed. So a build could finish
# "successfully" with no Electron program inside and the console would boot to the desktop.
# Run the installer ourselves when the program is not there yet (the download is cached in the
# scratch home and thrown away below), and stop the build if there is still no program.
ELECTRON_PKG=/usr/lib/tessera/launcher/node_modules/electron
if [ ! -x "$ELECTRON_PKG/dist/electron" ]; then
  HOME="$NPM_HOME" \
  XDG_CACHE_HOME="$NPM_HOME/cache-xdg" \
  electron_config_cache="$NPM_HOME/cache-electron" \
    node "$ELECTRON_PKG/install.js"
fi
if [ ! -x "$ELECTRON_PKG/dist/electron" ]; then
  echo "Electron was installed but $ELECTRON_PKG/dist/electron is missing: the console could not start" >&2
  exit 1
fi
rm -rf "$NPM_HOME"
# Tessera is English only. Electron ships dozens of other translations (about 40 MB) that are never used.
if [ -d /usr/lib/tessera/launcher/node_modules/electron/dist/locales ]; then
  find /usr/lib/tessera/launcher/node_modules/electron/dist/locales -type f ! -name 'en-US.pak' -delete
fi

### Tessera's name and look over Bazzite's (boot menu, About, logos, splash, wallpaper, terminal,
### the computer's name). See branding.sh for what changes and what stays Bazzite's.
bash /ctx/branding.sh

### Boot into Tessera. tessera-autologin.service signs the account in to the Tessera session at boot;
### it was never turned on, so new installs stopped at the login screen. Enabled here for machines
### that update, and by the preset (40-tessera.preset) for fresh installs.
systemctl enable tessera-autologin.service
systemctl is-enabled tessera-autologin.service

### The boot splash runs from the initramfs, which Bazzite built before branding.sh changed its
### logo: build it again from this image's own files and dracut settings, the way Universal Blue
### images do. (The kernel is signed for Secure Boot; the initramfs never is, so that's unchanged.)
KVER="$(ls /usr/lib/modules)"
if [ "$(printf '%s\n' "$KVER" | wc -l)" -ne 1 ] || [ ! -d "/usr/lib/modules/$KVER" ]; then
  echo "Expected exactly one kernel in /usr/lib/modules, found: $KVER" >&2
  exit 1
fi
/usr/bin/dracut --no-hostonly --kver "$KVER" --reproducible --add ostree -f "/usr/lib/modules/$KVER/initramfs.img"
chmod 0600 "/usr/lib/modules/$KVER/initramfs.img"
lsinitrd "/usr/lib/modules/$KVER/initramfs.img" > /tmp/initramfs-files.txt || true
grep -q 'plymouth/themes/spinner/watermark.png' /tmp/initramfs-files.txt && echo "initramfs: Tessera's boot splash is in" || echo "note: the initramfs has no spinner watermark (Plymouth layout changed?)"
rm -f /tmp/initramfs-files.txt

### Tessera's images must carry Tessera's signature: /etc/containers/policy.json requires
### /etc/pki/containers/tessera.pub for ghcr.io/herbalchemist (registries.d/tessera.yaml says where
### the signatures are). Bazzite's own entries in the file are kept.
POLICY=/etc/containers/policy.json
[ -f "$POLICY" ] || echo '{"default":[{"type":"insecureAcceptAnything"}],"transports":{"docker":{}}}' > "$POLICY"
jq '.transports.docker["ghcr.io/herbalchemist"] = [{"type":"sigstoreSigned","keyPath":"/etc/pki/containers/tessera.pub","signedIdentity":{"type":"matchRepository"}}]' "$POLICY" > "$POLICY.new"
mv "$POLICY.new" "$POLICY"
jq -e '.transports.docker["ghcr.io/herbalchemist"][0].keyPath' "$POLICY"
