'use strict';
// Which Tessera build suits the graphics in this machine, and whether the running one does.
//
// Bazzite (and so Tessera) ships the NVIDIA driver inside the system image, so there are three
// builds of the same Tessera:
//   tessera              AMD and Intel (and NVIDIA cards too old for NVIDIA's driver)
//   tessera-nvidia       NVIDIA GTX 900 / 1000 and Titan V (Maxwell, Pascal, Volta)
//   tessera-nvidia-open  NVIDIA GTX 16 / RTX and newer (Turing onwards)
// Swapping a graphics card means switching builds, which keeps every game, save and setting:
// it's the same `bootc switch` that put Tessera on the machine. Settings > Update software
// offers it when the card and the build don't match (see main.js and tessera-fix-graphics).

const VARIANTS = ['standard', 'nvidia', 'nvidia-open'];
const SUFFIX = { standard: '', nvidia: '-nvidia', 'nvidia-open': '-nvidia-open' };
const VARIANT_NAMES = {
  standard: 'AMD / Intel',
  nvidia: 'NVIDIA, GTX 900–1000',
  'nvidia-open': 'NVIDIA, GTX 16 / RTX',
};
const VENDORS = { '1002': 'AMD', '1022': 'AMD', '8086': 'Intel', '10de': 'NVIDIA' };

// NVIDIA PCI device ids by generation. Turing (the first card NVIDIA's open driver runs) starts at
// 0x1e00; Maxwell (the oldest the current proprietary driver runs) at 0x1300; Kepler and older
// sit below that and only have the open-source nouveau driver.
function nvidiaGeneration(device) {
  const d = parseInt(device, 16);
  if (!Number.isFinite(d)) return 'unknown';
  if (d >= 0x1e00) return 'open';
  if (d >= 0x1300) return 'legacy';
  return 'unsupported';
}

// gpus: [{ vendor: '10de', device: '1c81', cls: '030000', name? }] (hex, no 0x). Display devices only.
function needFor(gpus) {
  const list = (Array.isArray(gpus) ? gpus : []).filter((g) => g && /^03/.test(String(g.cls || '')));
  const nv = list.filter((g) => String(g.vendor).toLowerCase() === '10de');
  const gens = nv.map((g) => nvidiaGeneration(g.device));
  // A machine with any NVIDIA card NVIDIA's driver runs wants an NVIDIA build (laptops with Intel or
  // AMD graphics plus NVIDIA too). If an older card is in there, the classic driver covers both.
  if (gens.includes('legacy')) return { variant: 'nvidia', why: 'legacy' };
  if (gens.includes('open')) return { variant: 'nvidia-open', why: 'open' };
  if (gens.includes('unsupported')) return { variant: 'standard', why: 'nvidia-too-old' };
  if (gens.includes('unknown')) return { variant: null, why: 'unknown' };
  if (!list.length) return { variant: null, why: 'none' };
  return { variant: 'standard', why: 'amd-intel' };
}

// "ghcr.io/me/tessera-nvidia:latest" -> 'nvidia'; null when it isn't a Tessera image at all.
function splitRef(ref) {
  const s = String(ref || '').trim();
  const m = /^(.*\/)?([a-z0-9._-]+?)(-nvidia-open|-nvidia)?(:[A-Za-z0-9._-]+|@sha256:[0-9a-f]{64})?$/.exec(s);
  if (!m || !m[2]) return null;
  return { prefix: m[1] || '', name: m[2], variant: m[3] === '-nvidia-open' ? 'nvidia-open' : m[3] === '-nvidia' ? 'nvidia' : 'standard', tag: m[4] && m[4][0] === ':' ? m[4] : ':latest' };
}
const variantOfRef = (ref) => { const p = splitRef(ref); return p ? p.variant : null; };
// The same image, in another build. Keeps the registry, owner and tag (a fork switches within the fork).
function refFor(ref, variant) {
  const p = splitRef(ref);
  if (!p || !VARIANTS.includes(variant)) return null;
  return `${p.prefix}${p.name}${SUFFIX[variant]}${p.tag}`;
}

function describe(gpus) {
  const list = (Array.isArray(gpus) ? gpus : []).filter((g) => g && /^03/.test(String(g.cls || '')));
  return list.map((g) => g.name || `${VENDORS[String(g.vendor).toLowerCase()] || 'Unknown'} graphics (${g.vendor}:${g.device})`);
}

// Everything Settings needs: the cards, the build that suits them, the one running, and whether they differ.
function match(gpus, bootedRef) {
  const need = needFor(gpus);
  const have = variantOfRef(bootedRef);
  return {
    cards: describe(gpus),
    need: need.variant,
    why: need.why,
    have,
    mismatch: Boolean(need.variant && have && need.variant !== have),
    target: need.variant && have && need.variant !== have ? refFor(bootedRef, need.variant) : null,
  };
}

module.exports = { VARIANTS, VARIANT_NAMES, nvidiaGeneration, needFor, splitRef, variantOfRef, refFor, describe, match };
