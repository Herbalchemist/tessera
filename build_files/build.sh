#!/bin/bash

set -ouex pipefail

# Copy the contents of system_files/ of the git repo to /
cp -avf "/ctx/system_files"/. /

# Files copied from a git checkout can lose their executable bit.
chmod 0755 /usr/bin/tessera-session

### Tessera launcher
# Node is only needed here, to fetch Electron into the launcher folder.
dnf5 install -y nodejs npm
npm install --prefix /usr/lib/tessera/launcher --omit=dev --save-exact electron
