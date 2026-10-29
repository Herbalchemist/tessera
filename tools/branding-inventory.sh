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

# ---- details: exactly what each branded piece contains, so the overrides match it
sec "DETAIL wallpapers"; ls -laR /usr/share/wallpapers/Default /usr/share/wallpapers/bazzite 2>&1 | head -60; ls -la /usr/share/wallpapers/convergence* /usr/share/wallpapers/*.png 2>&1
sec "DETAIL vapor look-and-feel"; find /usr/share/plasma/look-and-feel/com.valve.vapor.desktop -maxdepth 3 | head -60; cat /usr/share/plasma/look-and-feel/com.valve.vapor.desktop/contents/defaults 2>&1; cat /usr/share/plasma/look-and-feel/com.valve.vapor.desktop/metadata.json 2>&1 | head -30
sec "DETAIL vapor splash"; cat /usr/share/plasma/look-and-feel/com.valve.vapor.desktop/contents/splash/Splash.qml 2>&1 | head -120
sec "DETAIL bazzite-pins.js"; cat /usr/share/plasma/shells/org.kde.plasma.desktop/contents/updates/bazzite-pins.js 2>&1 | head -80
sec "DETAIL plasma layouts and kickoff icon"; grep -rn -i -e icon -e wallpaper -e image /usr/share/plasma/look-and-feel/com.valve.vapor.desktop/contents/layouts 2>/dev/null | head -40; grep -rln -e 'start-here' -e 'distributor-logo' -e 'bazzite-logo' /usr/share/plasma /etc/xdg 2>/dev/null | head -30
grep -rn -e 'icon' /usr/share/plasma/plasmoids/org.kde.plasma.kickoff/contents/config/main.xml 2>/dev/null | head; ls /usr/share/plasma/shells/org.kde.plasma.desktop/contents/updates/ 2>&1; ls /usr/share/plasma/layout-templates 2>&1
sec "DETAIL distributor/start-here links"; ls -la /usr/share/icons/hicolor/scalable/places/ /usr/share/icons/hicolor/48x48/places/ 2>&1 | head -40; ls -la /usr/share/pixmaps/system-logo* /usr/share/pixmaps/bootloader 2>&1
sec "DETAIL fastfetch"; cat /usr/share/ublue-os/bazzite/fastfetch.jsonc 2>&1 | head -80; cat /etc/profile.d/bazzite-neofetch.sh; cat /usr/libexec/bazzite-bling-fastfetch 2>&1 | head -40; ls -la /usr/share/ublue-os/bazzite/
sec "DETAIL motd"; cat /usr/libexec/ublue-motd 2>&1 | head -60; cat /usr/share/ublue-os/motd/template.md 2>&1; ls /etc/profile.d/ | head -40
sec "DETAIL image-info"; cat /usr/share/ublue-os/image-info.json
sec "DETAIL autostart"; ls -la /etc/xdg/autostart /etc/skel/.config/autostart 2>&1; cat /etc/skel/.config/autostart/bazzite-portal.desktop /etc/xdg/autostart/bazzite-announcement.desktop 2>&1; cat /usr/share/applications/io.github.rfrench3.bazzite-updater.desktop | head -20
sec "DETAIL user setup (what runs at first login)"; head -80 /usr/libexec/bazzite-user-setup
sec "DETAIL hostname setters"; grep -rn -e hostnamectl -e '/etc/hostname' /usr/libexec/bazzite-* /usr/bin/bazzite-* 2>/dev/null | head -20
sec "DETAIL kde about + skel kde"; ls -la /etc/skel /etc/skel/.config 2>&1 | head -40; cat /etc/skel/.config/kdeglobals 2>&1 | head -20; cat /etc/skel/.config/plasma-org.kde.plasma.desktop-appletsrc 2>&1 | head -60
sec "DETAIL grub / bls titles"; ls -la /boot /usr/lib/bootupd/grub2-static 2>&1 | head; grep -rn -i -e bazzite -e PRETTY /usr/lib/bootupd 2>/dev/null | head
sec "DETAIL gamescope session + steam"; ls /usr/share/wayland-sessions /usr/share/xsessions 2>&1; grep -rn -i -e 'Name=' /usr/share/wayland-sessions/*.desktop 2>/dev/null | head
sec "DETAIL ujust banner"; head -40 /usr/share/ublue-os/just/80-bazzite.just; head -20 /usr/share/ublue-os/justfile
sec "DETAIL end"

sec "DETAIL2 who sets the wallpaper"; grep -rn -i -e 'wallpaper' -e 'convergence' -e 'plasma-apply' /usr/libexec/bazzite-* /usr/share/plasma/shells/org.kde.plasma.desktop/contents/updates/*.js /usr/share/plasma/look-and-feel/com.valve.vapor.desktop /etc/xdg 2>/dev/null | grep -v '\.svgz' | head -40
grep -rn -i 'Image=' /usr/share/plasma/wallpapers/*/contents/config/main.xml /usr/share/plasma/shells/org.kde.plasma.desktop/contents/defaults 2>/dev/null | head; cat /usr/share/plasma/shells/org.kde.plasma.desktop/contents/defaults 2>/dev/null | head -30
ls -la /usr/share/wallpapers/F44 /usr/share/wallpapers/F44/contents /usr/share/wallpapers/F44/contents/images 2>&1 | head -30; cat /usr/share/wallpapers/F44/metadata.json 2>/dev/null | head -20
sec "DETAIL2 start-here / distributor svg"; head -c 400 /usr/share/icons/hicolor/scalable/apps/start-here.svg; echo; head -c 300 /usr/share/icons/hicolor/scalable/places/distributor-logo.svg; echo; ls -la /usr/share/icons/hicolor/*/apps/start-here* /usr/share/icons/hicolor/*/places/start-here* 2>/dev/null | head -20; rpm -qf /usr/share/icons/hicolor/scalable/apps/start-here.svg /usr/share/icons/hicolor/scalable/places/distributor-logo.svg /usr/share/pixmaps/system-logo-white.png /usr/share/pixmaps/bootloader/bootlogo_128.png 2>&1
sec "DETAIL2 kickoff icon config"; cat /usr/share/plasma/look-and-feel/com.valve.vapor.desktop/contents/plasmoidsetupscripts/org.kde.plasma.kickoff.js 2>&1 | head -20; cat /usr/share/plasma/shells/org.kde.plasma.desktop/contents/updates/00-start-here-2.js | head -30
sec "DETAIL2 hardware-setup hostname context"; grep -n -B8 -A6 'set-hostname' /usr/libexec/bazzite-hardware-setup
sec "DETAIL3 boot splash inside the initramfs (what is actually shown at boot)"
for img in /usr/lib/modules/*/initramfs.img; do
  echo "initramfs: $img"
  for t in spinner bgrt; do
    f="usr/share/plymouth/themes/$t/watermark.png"
    sum=$(lsinitrd -f "$f" "$img" 2>/dev/null | md5sum | cut -d' ' -f1)
    echo "  $f md5=$sum"
  done
done
echo "  tessera watermark md5=$(md5sum < /usr/share/tessera/branding/tessera-plymouth-watermark.png 2>/dev/null | cut -d' ' -f1)"
echo "  on-disk spinner watermark md5=$(md5sum < /usr/share/plymouth/themes/spinner/watermark.png 2>/dev/null | cut -d' ' -f1)"
sec "DETAIL2 plymouth watermarks"; ls -la /usr/share/plymouth/themes/spinner/ /usr/share/plymouth/themes/bgrt/ | grep -i -e water -e logo; cat /usr/share/plymouth/themes/bgrt/bgrt.plymouth | head -30
sec "DETAIL2 sddm / login screen"; ls /usr/share/sddm 2>&1; ls /etc/sddm* 2>&1; systemctl get-default 2>&1; ls -la /etc/systemd/system/display-manager.service 2>&1
sec "DETAIL2 end"
