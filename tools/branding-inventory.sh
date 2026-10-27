#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Lists where an image shows the Bazzite name or logo, so Tessera can rebrand all of it.
# Runs INSIDE the image:  podman run --rm -v "$PWD/tools:/t:ro" IMAGE bash /t/branding-inventory.sh
set -u
sec() { printf '\n===== %s =====\n' "$1"; }
sec os-release; cat /usr/lib/os-release
sec "hostname / machine-info"; cat /etc/hostname 2>&1; cat /etc/machine-info 2>&1; grep -rn -i hostname /usr/lib/os-release /etc/os-release 2>/dev/null
sec "files named like bazzite/ublue/universal blue"
find / -xdev \( -path /proc -o -path /sys -o -path /var/lib/flatpak -o -path /usr/lib/modules -o -path /sysroot -o -path /ostree \) -prune -o \( -iname '*bazzite*' -o -iname '*ublue*' -o -iname '*universal-blue*' \) -print 2>/dev/null | sort | head -600
sec "text files mentioning Bazzite (per folder counts)"
grep -rIl -i bazzite /etc /usr/share /usr/lib /usr/libexec /usr/bin 2>/dev/null | grep -v -e '/usr/lib/modules' -e '/usr/share/doc' -e '/usr/share/licenses' -e '/usr/share/locale' | sort > /tmp/hits
wc -l < /tmp/hits; cat /tmp/hits | head -500
sec "plymouth"; cat /etc/plymouth/plymouthd.conf 2>&1; cat /usr/share/plymouth/plymouthd.defaults 2>&1; ls -la /usr/share/plymouth/themes; ls -la /usr/share/plymouth/themes/*/ 2>/dev/null | head -60
sec "sddm"; ls /etc/sddm.conf.d 2>&1; cat /etc/sddm.conf.d/* 2>/dev/null; cat /etc/sddm.conf 2>/dev/null; ls /usr/share/sddm/themes 2>&1
sec "kde about / defaults"; for f in /etc/xdg/kcm-about-distrorc /etc/xdg/kdeglobals /etc/xdg/plasma-org.kde.plasma.desktop-appletsrc /etc/xdg/ksplashrc /etc/xdg/plasmarc /etc/xdg/kscreenlockerrc /etc/xdg/kwinrc; do echo "--- $f"; cat "$f" 2>&1 | head -60; done
ls /usr/share/plasma/look-and-feel 2>&1; ls /usr/share/plasma/desktoptheme 2>&1
grep -rn -i -e 'Image=' -e 'wallpaper' -e 'icon=' /usr/share/plasma/look-and-feel/*/contents/defaults 2>/dev/null | head -40
grep -rln -i bazzite /usr/share/plasma 2>/dev/null | head -40
sec wallpapers; ls /usr/share/wallpapers /usr/share/backgrounds 2>&1 | head -80
sec "icons with bazzite/ublue in name"; find /usr/share/icons /usr/share/pixmaps -iname '*bazzite*' -o -iname '*ublue*' -o -iname 'fedora-logo*' -o -iname 'start-here*' -o -iname 'distributor-logo*' 2>/dev/null | head -120
sec "logo links"; ls -la /usr/share/pixmaps | head -60
sec fastfetch; ls -la /usr/share/ublue-os 2>&1; find / -xdev -path /proc -prune -o -name '*fastfetch*' -print 2>/dev/null | head -20; cat /usr/share/ublue-os/fastfetch.jsonc 2>/dev/null | head -60
sec "desktop entries naming Bazzite"; grep -l -i bazzite /usr/share/applications/*.desktop /etc/xdg/autostart/*.desktop 2>/dev/null | while read f; do echo "--- $f"; grep -i -e '^Name' -e '^Icon' -e '^Exec' -e bazzite "$f" | head -8; done
sec "motd / profile / ujust banners"; grep -rln -i bazzite /etc/profile.d /etc/motd* /usr/share/ublue-os/motd* /usr/share/ublue-os/just 2>/dev/null | head -40
sec "gamescope / steam session names"; grep -rn -i bazzite /usr/share/wayland-sessions /usr/share/xsessions /usr/share/gamescope-session* 2>/dev/null | head -40
sec "grub / bootloader"; ls /usr/lib/bootupd 2>&1; grep -rn -i -e bazzite /usr/lib/bootupd /usr/lib/ostree 2>/dev/null | head -20
sec "systemd units named bazzite/ublue"; ls /usr/lib/systemd/system /usr/lib/systemd/user /etc/systemd/system 2>/dev/null | grep -i -e bazzite -e ublue
sec "rpm packages with bazzite/ublue in name"; rpm -qa 2>/dev/null | grep -i -e bazzite -e ublue -e branding -e logos -e plymouth-theme | sort
sec "flatpak remotes and preinstalls"; ls /etc/flatpak/remotes.d 2>&1; ls /usr/share/ublue-os/ 2>/dev/null
sec "done"
