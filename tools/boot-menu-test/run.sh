#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Builds a small UEFI disk with GRUB, a stand-in for the installed GRUB config and Tessera's boot
# menu (installed by the real boot-menu script), boots it in QEMU and runs run.py's scenarios.
# Then boot-once (the real script) reads a "this time" choice back out of GRUB's settings file.
#   tools/boot-menu-test/run.sh OUTDIR      (needs qemu-system-x86, ovmf, grub-efi-amd64-bin,
#                                            grub-common, mtools, dosfstools, xorriso, fonts-dejavu-core, python3-pil)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(realpath -m "${1:-boot-menu-out}")"
W="$(mktemp -d)"
mkdir -p "$OUT" "$W/boot/grub2" "$W/etc"
exec > >(tee "$OUT/run.log") 2>&1   # the log goes to the reports branch too
set -x

# the menu's files, with fonts made the way build.sh makes them. FEDORA=1: everything as on a real
# install, made in a Fedora container: Fedora's own signed shim and GRUB (modules built in), and the
# fonts from Noto Sans by Fedora's grub2-mkfont, exactly as the image build does.
cp -a "$ROOT/system_files/usr/share/tessera/grub" "$W/src"
mkdir -p "$W/src/fonts"
range='0x20-0x7E,0xA0-0x17F,0x2010-0x2027,0x2190-0x2193'
if [ -n "${FEDORA:-}" ]; then
  mkdir -p "$W/fedora"
  docker run --rm -v "$W:/w" "${FEDORA_IMAGE:-registry.fedoraproject.org/fedora:44}" bash -c "
    set -e
    dnf -y -q install grub2-efi-x64 shim-x64 grub2-tools-minimal grub2-tools-extra google-noto-sans-fonts >/dev/null
    rpm -q grub2-efi-x64 shim-x64 > /w/fedora/versions.txt
    cp /boot/efi/EFI/fedora/shimx64.efi /boot/efi/EFI/fedora/grubx64.efi /w/fedora/
    reg=/usr/share/fonts/google-noto/NotoSans-Regular.ttf; bold=/usr/share/fonts/google-noto/NotoSans-Bold.ttf
    for s in 16 20 28; do grub2-mkfont -n Tessera -s \$s -r '$range' -o /w/src/fonts/tessera-\$s.pf2 \$reg; done
    grub2-mkfont -n Tessera -s 28 -r '$range' -o /w/src/fonts/tessera-bold-28.pf2 \$bold
    cp /usr/share/grub/unicode.pf2 /w/fedora/ 2>/dev/null || true
    cd /tmp && dnf -y -q download kernel-core >/dev/null && rpm2cpio kernel-core-*.rpm | cpio -idm --quiet './lib/modules/*/vmlinuz' && cp lib/modules/*/vmlinuz /w/fedora/vmlinuz
    chmod -R a+rwX /w"
  cat "$W/fedora/versions.txt"; mkdir -p "$OUT"; cp "$W/fedora/versions.txt" "$OUT/fedora-versions.txt"
else
  for s in 16 20 28; do grub-mkfont -n Tessera -s "$s" -r "$range" -o "$W/src/fonts/tessera-$s.pf2" /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf; done
  grub-mkfont -n Tessera -s 28 -r "$range" -o "$W/src/fonts/tessera-bold-28.pf2" /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
fi
cp /usr/share/grub/unicode.pf2 "$W/boot/grub2/" 2>/dev/null || true
mkdir -p "$W/boot/grub2/fonts"; cp /usr/share/grub/unicode.pf2 "$W/boot/grub2/fonts/" 2>/dev/null || true
if [ -n "${FEDORA:-}" ]; then
  # Fedora's GRUB has blscfg built in: the stand-in's function is dropped, the real one reads the entries
  python3 -c "import re,sys; s=open(sys.argv[1]).read(); print(re.sub(r'function blscfg \{.*?\n\}\n', '', s, flags=re.S), end='')" "$ROOT/tools/boot-menu-test/grub.cfg" > "$W/boot/grub2/grub.cfg"
else
  cp "$ROOT/tools/boot-menu-test/grub.cfg" "$W/boot/grub2/grub.cfg"
fi
grub-editenv "$W/boot/grub2/grubenv" create
TESSERA_BOOT="$W/boot" TESSERA_SRC="$W/src" TESSERA_ETC="$W/etc" bash "$ROOT/system_files/usr/libexec/tessera/boot-menu"
if [ -n "${FEDORA:-}" ]; then
  # (test only) GRUB's text keeps going to the serial log after the wait screen turns graphics on,
  # and loader messages are printed, so what happens when a version starts is on record
  sed -i 's/^terminal_output gfxterm$/terminal_output gfxterm serial/' "$W/boot/grub2/tessera/splash.cfg"
fi

# GRUB's settings file lives on its own small writable disk (FAT, no partitions)
mkfs.vfat -C "$W/env.img" 4096 >/dev/null
touch "$W/tessera-env-disk"
mcopy -i "$W/env.img" "$W/tessera-env-disk" ::/tessera-env-disk
mcopy -i "$W/env.img" "$W/boot/grub2/grubenv" ::/grubenv
rm -f "$W/boot/grub2/grubenv"
# the system: a CD image made by GRUB's own tool. Its GRUB loads modules from /boot/grub, so the
# installed tree goes there (on Fedora the modules are built into GRUB and the folder is grub2;
# Tessera's files only ever use ${prefix}, so either works). GRUB's text also goes to the serial
# port (a log file per scenario).
mkdir -p "$W/iso/boot"
cp -a "$W/boot/grub2" "$W/iso/boot/grub"
{ printf 'serial --unit=0 --speed=115200\nterminal_input --append serial\nterminal_output --append serial\n'; cat "$W/boot/grub2/grub.cfg"; } > "$W/iso/boot/grub/grub.cfg"
if [ -n "${FEDORA:-}" ]; then
  # A CD that starts the way a Tessera install does: shim, then Fedora's GRUB, whose first config
  # finds the installed tree and hands over to it (as bootupd's grub.cfg on the start-up partition does).
  cp "$W/fedora/unicode.pf2" "$W/iso/boot/grub/fonts/" 2>/dev/null || true
  printf 'search --no-floppy --file --set=root /boot/grub/grub.cfg\nset prefix=($root)/boot/grub\nconfigfile $prefix/grub.cfg\n' > "$W/stub.cfg"
  mkfs.vfat -C "$W/iso/efiboot.img" 20480 >/dev/null
  mmd -i "$W/iso/efiboot.img" ::/EFI ::/EFI/BOOT ::/EFI/fedora
  mcopy -i "$W/iso/efiboot.img" "$W/fedora/shimx64.efi" ::/EFI/BOOT/BOOTX64.EFI
  for d in BOOT fedora; do mcopy -i "$W/iso/efiboot.img" "$W/fedora/grubx64.efi" ::/EFI/$d/grubx64.efi; mcopy -i "$W/iso/efiboot.img" "$W/stub.cfg" ::/EFI/$d/grub.cfg; done
  mkdir -p "$W/iso/EFI/BOOT" "$W/iso/EFI/fedora"; cp "$W/stub.cfg" "$W/iso/EFI/BOOT/grub.cfg"; cp "$W/stub.cfg" "$W/iso/EFI/fedora/grub.cfg"
  # Real boot entries, the way ostree writes them (the newest has the higher version), for Fedora's
  # own blscfg; the "system" is Fedora's kernel with an initrd that only reports what it was started
  # with, on the serial port, and powers off.
  cp "$W/fedora/vmlinuz" "$W/iso/vmlinuz"
  mkdir -p "$W/initrd/bin" "$W/iso/loader/entries"
  cp "$(command -v busybox)" "$W/initrd/bin/busybox"
  printf '#!/bin/busybox sh\n/bin/busybox mkdir -p /proc /dev\n/bin/busybox mount -t proc proc /proc\n/bin/busybox mount -t devtmpfs dev /dev\necho "TESSERA-BOOTED $(/bin/busybox cat /proc/cmdline)" > /dev/ttyS0\n/bin/busybox sleep 2\n/bin/busybox poweroff -f\n' > "$W/initrd/init"
  chmod 755 "$W/initrd/init"
  (cd "$W/initrd" && find . | cpio -o -H newc --quiet) | gzip > "$W/iso/initrd.img"
  for n in 0 1; do
    printf 'title Tessera 43.2026110%s.0 (ostree:%s)\nversion %s\noptions console=ttyS0,115200 tessera_booted=ostree:%s\nlinux /vmlinuz\ninitrd /initrd.img\n' "$((1 - n))" "$n" "$((2 - n))" "$n" > "$W/iso/loader/entries/ostree-$((2 - n))-default.conf"
  done
  xorriso -as mkisofs -quiet -R -J -o "$W/system.iso" -e efiboot.img -no-emul-boot "$W/iso"
else
  grub-mkrescue -o "$W/system.iso" "$W/iso"
fi
find "$W/iso" -type f | sed "s#$W/iso##" | sort > "$OUT/disk-listing.txt"
I="$W/env.img"
cp "$W/boot/grub2/custom.cfg" "$OUT/custom.cfg"

python3 "$ROOT/tools/boot-menu-test/run.py" "$W" "$OUT" || status=$?

# boot-once, the real script, on a settings file that GRUB itself wrote ("this time": console)
mkdir -p "$W/b1/grub2" "$W/run1"
mcopy -o -i "$I" ::/grubenv "$W/b1/grub2/grubenv"
{
  echo "--- boot-once on the settings file GRUB left after the last 'this time' scenario:"
  grub-editenv "$W/b1/grub2/grubenv" set tessera_once=console
  TESSERA_BOOT="$W/b1" TESSERA_RUN="$W/run1" bash "$ROOT/system_files/usr/libexec/tessera/boot-once" || true
  echo "note: $(cat "$W/run1/boot-once" 2>/dev/null)  console-once: $([ -e "$W/run1/console-once" ] && echo yes || echo no)"
  echo "left in grubenv: $(grub-editenv "$W/b1/grub2/grubenv" list | tr '\n' ' ')"
} | tee -a "$OUT/results.txt"
if ! grep -q "note: console  console-once: yes" "$OUT/results.txt" || grep -q "tessera_once=" <(grub-editenv "$W/b1/grub2/grubenv" list); then echo "FAIL boot-once" | tee -a "$OUT/results.txt"; status=1; else echo "PASS boot-once: read, cleared, note left" | tee -a "$OUT/results.txt"; fi
exit "${status:-0}"
