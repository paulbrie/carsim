# Weather (ticket #296): clear, sunny with clouds, grey, light rain, sunset. A cloud layer in the sky
# dome (drifting fbm), and per preset the sky's colours, the sun (colour, strength, height), the
# hemisphere light, fog, exposure and the reflections (the environment map, re-rendered), plus rain.
# Single player: the Weather button / O, remembered in this browser. A race: the room's (?weather=
# and a 'weather' message, scripts/patches/mp-block.js).
# Applies to public/sim after the other patches:
#   python3 scripts/patches/weather.py <dir with engine.js and index.html>
import sys, os
d = sys.argv[1]
ep, hp = os.path.join(d, 'engine.js'), os.path.join(d, 'index.html')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

def span(a, b, new):
    """replace from a up to (not including) b"""
    global s
    assert s.count(a) == 1 and s.count(b) == 1, (s.count(a), s.count(b), a[:80], b[:80])
    i, j = s.index(a), s.index(b)
    assert i < j
    s = s[:i] + new + s[j:]

rep("""scene.add(new THREE.HemisphereLight(0xa9c8ff, 0xc89a62, 0.85));""",
    """const hemi = new THREE.HemisphereLight(0xa9c8ff, 0xc89a62, 0.85);
scene.add(hemi);""")

span("// Sky dome\n{", "// Procedural sand textures", r"""// Sky dome, with a cloud layer: fbm noise on a plane above, seen through the dome; thin toward the sun
// side of each cloud (lit), thick away from it (shaded). The weather sets its colours and cover.
const SKY = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    sunDir: { value: SUN_DIR }, haze: { value: HAZE }, zenith: { value: new THREE.Color(0.10, 0.24, 0.62) }, sunCol: { value: new THREE.Color(1, 0.85, 0.6) },
    sunGlow: { value: 1 }, cover: { value: 0 }, cloudLit: { value: new THREE.Color(1, 1, 1) }, cloudDark: { value: new THREE.Color(0.6, 0.64, 0.7) }, time: { value: 0 },
  },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
  fragmentShader: `uniform vec3 sunDir; uniform vec3 haze; uniform vec3 zenith; uniform vec3 sunCol; uniform float sunGlow; uniform float cover;
    uniform vec3 cloudLit; uniform vec3 cloudDark; uniform float time; varying vec3 vDir;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
      return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }
    float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
    void main(){ vec3 d = normalize(vDir); float h = clamp(d.y,0.,1.);
      vec3 col = mix(haze, zenith, pow(h,0.45));
      float s = max(dot(d, sunDir), 0.), dens = 0.;
      if (cover > 0.001 && d.y > 0.) {
        vec2 uv = d.xz / (d.y + 0.1) * 1.4 + vec2(time * 0.006, time * 0.0025);
        float n = fbm(uv), n2 = fbm(uv + normalize(sunDir.xz + 1e-4) * 0.09);
        dens = smoothstep(1. - cover, 1.25 - cover * 0.9, n) * smoothstep(0., 0.1, d.y);
        float lit = clamp(0.6 + (n - n2) * 3., 0., 1.);
        vec3 cc = mix(cloudDark, cloudLit, lit) + sunCol * pow(s, 5.) * 0.5 * sunGlow;
        col = mix(col, cc, dens);
      }
      col += sunCol * (pow(s,900.)*30. + pow(s,10.)*0.35) * sunGlow * (1. - dens);
      gl_FragColor = vec4(col,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
});
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), SKY);
  sky.frustumCulled = false; sky.renderOrder = -1;
  scene.add(sky);
  SKY.userData.envScene = new THREE.Scene(); SKY.userData.envScene.add(new THREE.Mesh(sky.geometry, SKY));
}
/* ---------- weather ---------- */
// sky: zenith / haze (horizon, fog) colours; sun: light colour, strength, height (rad; null = the usual 44 deg),
// sky's sun colour and glow; hemi: sky / ground colours, strength; clouds: cover 0-1, lit / shaded colour; rain 0-1
const WEATHERS = {
  clear: { name: 'Clear', icon: '☀', zenith: [0.10, 0.24, 0.62], haze: [0.78, 0.66, 0.52], sun: [0xfff0d8, 2.8, null], sunCol: [1, 0.85, 0.6], glow: 1, hemi: [0xa9c8ff, 0xc89a62, 0.85], cover: 0, lit: [1, 1, 1], dark: [0.6, 0.64, 0.7], fog: [70, 280], exposure: 1, rain: 0 },
  sunny: { name: 'Sunny, clouds', icon: '⛅', zenith: [0.12, 0.30, 0.70], haze: [0.80, 0.72, 0.62], sun: [0xfff2dc, 2.7, null], sunCol: [1, 0.88, 0.66], glow: 1, hemi: [0xb4cfff, 0xc89a62, 0.9], cover: 0.55, lit: [1, 0.99, 0.96], dark: [0.62, 0.66, 0.75], fog: [80, 320], exposure: 1, rain: 0 },
  grey: { name: 'Grey', icon: '☁', zenith: [0.46, 0.48, 0.52], haze: [0.66, 0.64, 0.61], sun: [0xe2e6ec, 0.55, 0.9], sunCol: [0.9, 0.9, 0.9], glow: 0.15, hemi: [0xc9cfd8, 0x8a7a66, 1.55], cover: 0.97, lit: [0.76, 0.77, 0.79], dark: [0.44, 0.46, 0.5], fog: [60, 250], exposure: 1.05, rain: 0 },
  rain: { name: 'Light rain', icon: '🌧', zenith: [0.32, 0.34, 0.38], haze: [0.50, 0.51, 0.52], sun: [0xd8e0ea, 0.35, 0.9], sunCol: [0.8, 0.8, 0.82], glow: 0, hemi: [0xaab4c4, 0x6a5e50, 1.4], cover: 1, lit: [0.56, 0.57, 0.61], dark: [0.26, 0.28, 0.32], fog: [35, 170], exposure: 1, rain: 1 },
  sunset: { name: 'Sunset', icon: '🌇', zenith: [0.14, 0.18, 0.40], haze: [0.98, 0.60, 0.38], sun: [0xffad73, 3.0, 0.16], sunCol: [1, 0.58, 0.3], glow: 1.3, hemi: [0x9c9cd4, 0xa87452, 0.95], cover: 0.5, lit: [1, 0.66, 0.5], dark: [0.40, 0.31, 0.38], fog: [70, 300], exposure: 1.15, rain: 0 },
};
const SUN_AZ = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize(), SUN_EL = Math.asin(SUN_DIR.y);
let WEATHER = WEATHERS.clear, weatherKey = 'clear', envTex = null;
// rain: streaks in a box that follows the camera
const RAIN_N = 1400, rainPos = new Float32Array(RAIN_N * 3), rainSeg = new Float32Array(RAIN_N * 6);
for (let i = 0; i < RAIN_N; i++) { rainPos[i * 3] = (Math.random() - 0.5) * 60; rainPos[i * 3 + 1] = (Math.random() - 0.5) * 30; rainPos[i * 3 + 2] = (Math.random() - 0.5) * 60; }
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainSeg, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xc8d0da, transparent: true, opacity: 0.32, depthWrite: false }));
rain.frustumCulled = false; rain.visible = false; scene.add(rain);
function setWeather(key, save = true) {
  const W = WEATHERS[key]; if (!W) return false;
  WEATHER = W; weatherKey = key;
  const U = SKY.uniforms;
  U.zenith.value.setRGB(...W.zenith); HAZE.setRGB(...W.haze); U.sunCol.value.setRGB(...W.sunCol); U.sunGlow.value = W.glow;
  U.cover.value = W.cover; U.cloudLit.value.setRGB(...W.lit); U.cloudDark.value.setRGB(...W.dark);
  const el = W.sun[2] ?? SUN_EL; SUN_DIR.copy(SUN_AZ).multiplyScalar(Math.cos(el)).setY(Math.sin(el));
  sun.color.setHex(W.sun[0]); sun.intensity = W.sun[1];
  hemi.color.setHex(W.hemi[0]); hemi.groundColor.setHex(W.hemi[1]); hemi.intensity = W.hemi[2];
  scene.fog.color.copy(HAZE);
  let edOn = false; try { edOn = ed.on; } catch (e) { }        // (at boot the editor doesn't exist yet)
  if (!edOn) { scene.fog.near = W.fog[0]; scene.fog.far = W.fog[1]; }
  renderer.toneMappingExposure = W.exposure;
  rain.visible = W.rain > 0; rain.material.opacity = 0.32 * W.rain;
  // reflections from this sky
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(SKY.userData.envScene, 0, 1, 3000);
  envTex?.dispose(); envTex = rt; scene.environment = rt.texture; pm.dispose();
  const btn = document.getElementById('wxBtn'); if (btn) btn.textContent = `${W.icon} ${W.name}`;
  if (save) try { localStorage.setItem('sandbuggy.weather', key); } catch (e) { }
  return true;
}
function updateWeather(dt) {
  SKY.uniforms.time.value += dt;
  if (!rain.visible) return;
  const c = camera.position, fall = 7.5 * dt, wx = 0.9, wz = 0.4;     // light rain: ~7.5 m/s, a little wind
  for (let i = 0; i < RAIN_N; i++) {
    const k = i * 3;
    let x = rainPos[k] + wx * dt, y = rainPos[k + 1] - fall, z = rainPos[k + 2] + wz * dt;
    if (y < -15) y += 30;
    rainPos[k] = x; rainPos[k + 1] = y; rainPos[k + 2] = z;
    // around the camera: wrap into the box it is in
    const X = c.x + ((((x - c.x) % 60) + 90) % 60) - 30, Y = c.y + y, Z = c.z + ((((z - c.z) % 60) + 90) % 60) - 30, o = i * 6;
    rainSeg[o] = X; rainSeg[o + 1] = Y; rainSeg[o + 2] = Z; rainSeg[o + 3] = X - wx * 0.06; rainSeg[o + 4] = Y + 0.45; rainSeg[o + 5] = Z - wz * 0.06;
  }
  rainGeo.attributes.position.needsUpdate = true;
}
{
  let k = MP.on ? MPQ.get('weather') : null;
  if (!MP.on) try { k = localStorage.getItem('sandbuggy.weather'); } catch (e) { }
  setWeather(WEATHERS[k] ? k : 'clear', false);
}

""")

# the editor's far view, then back to the weather's fog
rep("""    scene.fog.near = 70; scene.fog.far = 280;""", """    scene.fog.near = WEATHER.fog[0]; scene.fog.far = WEATHER.fog[1];""")

# every frame: the clouds drift, the rain falls
rep("""  updateCamera(dt);\n""", """  updateCamera(dt);\n  updateWeather(dt);\n""")

# O, and a button under Bots
rep("""  if (e.code === 'KeyN') { document.getElementById('botBtn').click(); return; }""",
    """  if (e.code === 'KeyN') { document.getElementById('botBtn').click(); return; }
  if (e.code === 'KeyO') { document.getElementById('wxBtn').click(); return; }""")
rep("""document.getElementById('botBtn').addEventListener('click', e => {""",
    """{
  const b = document.createElement('button'); b.id = 'wxBtn'; b.title = 'Weather: clear, sunny with clouds, grey, light rain, sunset (O)';
  b.textContent = `${WEATHER.icon} ${WEATHER.name}`;
  document.getElementById('botBtn').after(b);
  b.addEventListener('click', e => {
    e.currentTarget.blur(); const keys = Object.keys(WEATHERS), k = keys[(keys.indexOf(weatherKey) + 1) % keys.length];
    setWeather(k); flash(WEATHERS[k].name, '#fff', 1.5);
  });
}
document.getElementById('botBtn').addEventListener('click', e => {""")

open(ep, 'w').write(s)
h = open(hp).read()
for a, b in [('<b>N</b> bots (0-4) &nbsp; ', '<b>N</b> bots (0-4) &nbsp; <b>O</b> weather &nbsp; '),
             ('  #botBtn:hover{background:rgba(255,90,0,.85)}\n', '''  #botBtn:hover{background:rgba(255,90,0,.85)}
  #wxBtn{position:fixed;top:412px;right:12px;font:inherit;font-size:13px;font-weight:700;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;color:#fff;background:rgba(20,14,6,.65)}
  #wxBtn:hover{background:rgba(255,90,0,.85)}
  body.mp #wxBtn{display:none!important}
''')]:
    assert h.count(a) == 1, a
    h = h.replace(a, b)
open(hp, 'w').write(h)
print('weather patched')
