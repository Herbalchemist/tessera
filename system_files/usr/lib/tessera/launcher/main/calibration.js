// SPDX-License-Identifier: GPL-3.0-or-later
// Display calibration made by eye, and handing it to Gamescope.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get CAL_FAILED() { return CAL_FAILED; },
  get calPayload() { return calPayload; },
  get cleanCal() { return cleanCal; },
  get display() { return display; },
  get syncCalFx() { return syncCalFx; },
};

const path = require('path');
const fs = require('fs');
const os = require('os');
const config = require('./config');
const prefs = require('./prefs');

// ------------------------------------------------------- display calibration
// A calibration made by eye with test patterns (no measuring device), so it is
// a good correction, not a lab one. It is a few numbers, not code:
//   black    -0.10..0.10  brightness: positive darkens shadows, negative lifts them
//   white    0.80..1      highest level, below 1 gives bright detail room
//   gamma    3 x 0.6..1.6 a correction exponent per colour (1 = leave alone)
//   gain     3 x 0.85..1  white balance (only ever turns a colour down)
//   sat      0.5..1.5     saturation
// For each colour:  out = (clamp((in - black) / (1 - black)) ^ gamma) * white * gain
// The page draws it with an SVG filter. For games it can also be written as a
// ReShade shader that Gamescope loads (--reshade-effect), see tessera-session.
const CAL_RANGES = { black: [-0.1, 0.1], white: [0.8, 1], gamma: [0.6, 1.6], gain: [0.85, 1], sat: [0.5, 1.5] };
function cleanCal(c) {
  if (!c || typeof c !== 'object') return null;
  const num = (v, [lo, hi], dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 10000) / 10000)) : dflt);
  const tri = (v, r, dflt) => (Array.isArray(v) && v.length === 3 ? v.map((x) => num(x, r, dflt)) : [dflt, dflt, dflt]);
  return {
    black: num(c.black, CAL_RANGES.black, 0),
    white: num(c.white, CAL_RANGES.white, 1),
    gamma: tri(c.gamma, CAL_RANGES.gamma, 1),
    gain: tri(c.gain, CAL_RANGES.gain, 1),
    sat: num(c.sat, CAL_RANGES.sat, 1),
    enabled: c.enabled !== false,
    mode: c.mode === 'thorough' ? 'thorough' : 'quick',
    at: typeof c.at === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(c.at) ? c.at : '',
  };
}
const calIsIdentity = (c) => !c || (c.black === 0 && c.white === 1 && c.sat === 1 && c.gamma.every((g) => g === 1) && c.gain.every((g) => g === 1));
const CAL_DIR = path.join(config.DATA_DIR, 'calibration');
const CAL_FX = path.join(CAL_DIR, 'tessera-calibration.fx');
const CAL_FAILED = path.join(path.dirname(config.LOG_DIR), 'calibration-failed'); // written by tessera-session if Gamescope wouldn't start with the shader
const f5 = (n) => Number(n).toFixed(5);
function calFx(c) {
  return `// Tessera display calibration. Written by Tessera (Settings > Display calibration). Don't edit.
texture2D texColor : COLOR;
sampler2D samplerColor { Texture = texColor; AddressU = Clamp; AddressV = Clamp; MinFilter = Point; MagFilter = Point; };
void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
	texcoord.x = (id == 2) ? 2.0 : 0.0;
	texcoord.y = (id == 1) ? 2.0 : 0.0;
	position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}
float4 PS_TesseraCalibration(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
	float3 c = tex2D(samplerColor, texcoord).rgb;
	c = saturate((c - ${f5(c.black)}) / ${f5(1 - c.black)});
	c = pow(c, float3(${c.gamma.map(f5).join(', ')}));
	c = saturate(c * ${f5(c.white)} * float3(${c.gain.map(f5).join(', ')}));
	float l = dot(c, float3(0.2126, 0.7152, 0.0722));
	c = saturate(lerp(float3(l, l, l), c, ${f5(c.sat)}));
	return float4(c, 1.0);
}
technique TesseraCalibration
{
	pass
	{
		VertexShader = PostProcessVS;
		PixelShader = PS_TesseraCalibration;
	}
}
`;
}
// Keep the shader file in step with what is saved: present only when the person turned it on.
function syncCalFx() {
  const want = prefs.settings.calibrationSystem && prefs.settings.calibration && prefs.settings.calibration.enabled && !calIsIdentity(prefs.settings.calibration);
  try {
    if (want) { fs.mkdirSync(CAL_DIR, { recursive: true }); fs.writeFileSync(CAL_FX, calFx(prefs.settings.calibration)); }
    else fs.rmSync(CAL_FX, { force: true });
  } catch { /* can't write: the page filter still works */ }
}
function calPayload() {
  const c = prefs.settings.calibration;
  const systemActive = process.env.TESSERA_CAL_SYSTEM === '1' && prefs.settings.calibrationSystem && Boolean(c && c.enabled);
  return {
    cal: c, // null = never calibrated
    system: prefs.settings.calibrationSystem,
    systemActive, // Gamescope is already applying it, so the page must not apply it a second time
    systemFailed: fs.existsSync(CAL_FAILED),
  };
}

const display = (p) => {
  const home = os.homedir();
  return p === home ? '~' : p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
};
