#version 440
// Ludus (Qt): the display calibration, drawn over the whole screen (calibration.js setScreenFilter):
// calibrate.frag.qsb is this file built with `qsb --qt6` (the Ludus (Qt) workflow builds it on every push; rebuild and commit it when this changes).
// black level, white level, a gamma and a gain for each colour, then the colour strength.
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 gamma;
    vec4 gain;
    float black;
    float white;
    float sat;
};
layout(binding = 1) uniform sampler2D source;
void main() {
    vec4 c = texture(source, qt_TexCoord0);
    vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
    vec3 t = clamp((rgb - vec3(black)) / (1.0 - black), 0.0, 1.0);
    vec3 o = min(vec3(1.0), pow(t, gamma.rgb) * white * gain.rgb);
    float l = dot(o, vec3(0.213, 0.715, 0.072));
    o = mix(vec3(l), o, sat);
    fragColor = vec4(o * c.a, c.a) * qt_Opacity;
}
