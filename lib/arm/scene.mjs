// The arm sim's picture (#359): the table, the arm, its fingers, the cube and the tray, drawn from what core's
// `pose()` says. THREE is given (the page's own copy), as the physics is given to core: nothing here knows where it
// runs. The arm's colour says who is at the controls: cyan for a network, orange for a person (the site's rule).
import { ARM, CUBE, TRAY } from './core.mjs';

export const WHO = { net: 0x38d6f5, human: 0xff8a3d, none: 0x9aa3b2 };

export function createScene(THREE, canvas, { shadows = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  renderer.shadowMap.enabled = shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c11);
  scene.fog = new THREE.Fog(0x0a0c11, 2.2, 4.5);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 20);
  const look = new THREE.Vector3(0.14, 0.15, -0.04), view = { az: 0.62, el: 0.42, dist: 1.55 };
  const aim = () => { camera.position.set(look.x + view.dist * Math.cos(view.el) * Math.cos(view.az), look.y + view.dist * Math.sin(view.el), look.z + view.dist * Math.cos(view.el) * Math.sin(view.az)); camera.lookAt(look); };
  aim();

  scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x2a2e38, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
  sun.position.set(0.7, 1.5, 0.9); sun.castShadow = shadows; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.01;
  Object.assign(sun.shadow.camera, { left: -0.9, right: 0.9, top: 0.9, bottom: -0.9, near: 0.2, far: 4 });
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x6fb6ff, 0.7); rim.position.set(-1, 0.6, -0.8); scene.add(rim);

  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...o });
  const mesh = (geo, m, parent, cast = true) => { const x = new THREE.Mesh(geo, m); x.castShadow = cast; x.receiveShadow = true; parent.add(x); return x; };

  // the table: a round top with the reach marked on it
  const top = mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.04, 96), mat(0x222835, { roughness: 0.9 }), scene, false); top.position.y = -0.02;
  mesh(new THREE.CylinderGeometry(0.756, 0.756, 0.014, 96), mat(0x343c4a, { roughness: 0.5, metalness: 0.4 }), scene, false).position.y = -0.009;
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x3a4454, transparent: true, opacity: 0.8 });
  for (const r of [0.2, 0.42]) { const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.0015, r + 0.0015, 96, 1, -1, 2), lineMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.0008; scene.add(ring); }
  // the tray: a low frame
  const tray = new THREE.Group(); scene.add(tray); tray.visible = false;
  { const s = TRAY.half, w = 0.006, m = mat(0x4b5565, { roughness: 0.4, metalness: 0.5 });
    for (const [x, z, sx, sz] of [[0, s, 2 * s + w, w], [0, -s, 2 * s + w, w], [s, 0, w, 2 * s + w], [-s, 0, w, 2 * s + w]]) mesh(new THREE.BoxGeometry(sx, 0.012, sz), m, tray).position.set(x, 0.006, z);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(2 * s, 2 * s), new THREE.MeshBasicMaterial({ color: 0x7ee0a1, transparent: true, opacity: 0.12 })); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.001; tray.add(pad); tray.userData.pad = pad; }

  // the arm
  const shell = mat(0xe9edf2, { roughness: 0.35 }), dark = mat(0x343b48, { roughness: 0.55, metalness: 0.3 }), accent = mat(WHO.none, { roughness: 0.3, emissive: WHO.none, emissiveIntensity: 0.35 });
  mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.03, 48), dark, scene).position.y = 0.015;
  const turret = new THREE.Group(); scene.add(turret);
  mesh(new THREE.CylinderGeometry(0.055, 0.065, ARM.S - 0.03, 48), shell, turret).position.y = 0.03 + (ARM.S - 0.03) / 2;
  mesh(new THREE.CylinderGeometry(0.0665, 0.0665, 0.008, 48), accent, turret).position.y = 0.045;
  const link = (len, parent) => {
    const g = new THREE.Group(); parent.add(g);
    const hub = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.078, 32), dark, g); hub.rotation.x = Math.PI / 2;
    const ring = mesh(new THREE.CylinderGeometry(0.0375, 0.0375, 0.012, 32), accent, g); ring.rotation.x = Math.PI / 2;
    const body = mesh(new THREE.CapsuleGeometry(0.026, len - 0.03, 8, 20), shell, g); body.rotation.z = -Math.PI / 2; body.position.x = len / 2;
    return g;
  };
  const shoulder = link(ARM.L1, turret); shoulder.position.y = ARM.S;
  const elbow = link(ARM.L2, shoulder); elbow.position.x = ARM.L1;
  const wrist = new THREE.Group(); elbow.add(wrist); wrist.position.x = ARM.L2;
  const wh = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.066, 32), dark, wrist); wh.rotation.x = Math.PI / 2;
  const tool = new THREE.Group(); wrist.add(tool);
  mesh(new THREE.CylinderGeometry(0.016, 0.016, ARM.TL - 0.065, 24), shell, tool).position.y = -(ARM.TL - 0.065) / 2 - 0.01;
  mesh(new THREE.BoxGeometry(0.125, 0.02, 0.042), dark, tool).position.y = -ARM.TL + 0.055;
  const fingers = [1, -1].map(() => { const f = mesh(new THREE.BoxGeometry(0.01, 0.06, 0.024), mat(0x6b7686, { roughness: 0.6 }), tool); f.position.y = -ARM.TL + 0.01; return f; });

  // the cube
  const cube = mesh(new THREE.BoxGeometry(CUBE, CUBE, CUBE), mat(0xf2e9d0, { roughness: 0.6 }), scene);
  cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE, CUBE, CUBE)), new THREE.LineBasicMaterial({ color: 0x8a7f62 })));

  return {
    camera, renderer, view,
    size(w, h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
    /** Turn the camera round the table (radians) and nearer or further. */
    orbit(daz, del = 0, zoom = 1) { view.az += daz; view.el = Math.max(0.12, Math.min(1.35, view.el + del)); view.dist = Math.max(0.6, Math.min(2.4, view.dist * zoom)); aim(); },
    /** Draw a pose; who: 'net', 'human' or 'none' (the arm's colour). */
    draw(p, who = 'none') {
      const [q0, a1, e, q3] = p.q;
      turret.rotation.y = q0; shoulder.rotation.z = a1; elbow.rotation.z = -e; wrist.rotation.z = e - a1; tool.rotation.y = q3;
      fingers[0].position.x = p.half; fingers[1].position.x = -p.half;
      cube.position.set(...p.cube.p); cube.quaternion.set(...p.cube.q);
      tray.visible = !!p.tray; if (p.tray) tray.position.set(p.tray.x, 0, p.tray.z);
      tray.userData.pad.material.opacity = p.done != null && p.tray ? 0.4 : 0.12;
      accent.color.setHex(WHO[who] ?? WHO.none); accent.emissive.setHex(WHO[who] ?? WHO.none);
      renderer.render(scene, camera);
    },
    dispose() { renderer.dispose(); },
  };
}
