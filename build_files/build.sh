#!/bin/bash

set -ouex pipefail

# Copy the contents of system_files/ of the git repo to /
cp -avf "/ctx/system_files"/. /

# Files copied from a git checkout can lose their executable bit.
chmod 0755 /usr/bin/tessera-session

### Tessera launcher
# Node is only needed here, to fetch Electron into the launcher folder.
dnf5 install -y nodejs npm

# /root is a dangling link during the image build, so npm can't create its
# cache there. Point HOME (npm and Electron caches) at a scratch folder.
export HOME=/tmp/build-home
mkdir -p "$HOME"
npm install --prefix /usr/lib/tessera/launcher --omit=dev --save-exact electron

# The package installed but its binary download step did not run, so run it
# explicitly. If it still downloads nothing, the check below fails the build.
unset ELECTRON_SKIP_BINARY_DOWNLOAD
node /usr/lib/tessera/launcher/node_modules/electron/install.js
test -x /usr/lib/tessera/launcher/node_modules/electron/dist/electron

### Don't start Steam automatically for new users
# /etc/skel is copied into each new account's home at creation time.
rm -f /etc/skel/.config/autostart/steam.desktop

### Boot straight into Tessera
systemctl enable tessera-autologin.service
