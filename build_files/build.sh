#!/bin/bash

set -ouex pipefail

# Copy the contents of system_files/ of the git repo to /
cp -avf "/ctx/system_files"/. /

# Files copied from a git checkout can lose their executable bit.
chmod 0755 /usr/bin/tessera-session /usr/bin/tessera-reset-pin

### Tessera launcher
# Node is only needed here, to fetch Electron into the launcher folder.
dnf5 install -y nodejs npm
# Which Electron: the version in launcher/electron-version (one line, like 38.2.0) if that
# file exists, so every build uses the same one and an update only carries what really
# changed. Without the file the newest is used, as before.
ELECTRON_VERSION=latest
if [ -f /usr/lib/tessera/launcher/electron-version ]; then
  ELECTRON_VERSION="$(tr -d '[:space:]v' < /usr/lib/tessera/launcher/electron-version)"
fi
npm install --prefix /usr/lib/tessera/launcher --omit=dev --save-exact "electron@${ELECTRON_VERSION}"
# Tessera is English only. Electron ships dozens of other translations (about 40 MB) that are never used.
if [ -d /usr/lib/tessera/launcher/node_modules/electron/dist/locales ]; then
  find /usr/lib/tessera/launcher/node_modules/electron/dist/locales -type f ! -name 'en-US.pak' -delete
fi
