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
