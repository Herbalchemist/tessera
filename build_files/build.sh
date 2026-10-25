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
