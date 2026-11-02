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

# the menu's files, with fonts made the way build.sh makes them (DejaVu here)
cp -a "$ROOT/system_files/usr/share/tessera/grub" "$W/src"
mkdir -p "$W/src/fonts"
range='0x20-0x7E,0xA0-0x17F,0x2010-0x2027,0x2190-0x2193'
for s in 16 20 28; do grub-mkfont -n Tessera -s "$s" -r "$range" -o "$W/src/fonts/tessera-$s.pf2" /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf; done
grub-mkfont -n Tessera -s 28 -r "$range" -o "$W/src/fonts/tessera-bold-28.pf2" /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
cp /usr/share/grub/unicode.pf2 "$W/boot/grub2/" 2>/dev/null || true
mkdir -p "$W/boot/grub2/fonts"; cp /usr/share/grub/unicode.pf2 "$W/boot/grub2/fonts/" 2>/dev/null || true
cp "$ROOT/tools/boot-menu-test/grub.cfg" "$W/boot/grub2/grub.cfg"
grub-editenv "$W/boot/grub2/grubenv" create
TESSERA_BOOT="$W/boot" TESSERA_SRC="$W/src" TESSERA_ETC="$W/etc" bash "$ROOT/system_files/usr/libexec/tessera/boot-menu"

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
grub-mkrescue -o "$W/system.iso" "$W/iso"
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
