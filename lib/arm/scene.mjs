// The arm sim's picture (#359): the table, the arm, its fingers, the cubes, the tray and where a cube goes, drawn from what core's
// `pose()` says. THREE is given (the page's own copy), as the physics is given to core: nothing here knows where it
// runs. The arm's colour says who is at the controls: cyan for a network, orange for a person (the site's rule).
// Two arms (#361): the desk arm, and the reBot Arm B601-RS drawn link by link where core's model has them (its frames as
// in its makers' MuJoCo model, z up, turned to the picture's y up as a whole), in its colours: black, aluminium, Seeed green.
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

  // the desk arm
  const shell = mat(0xe9edf2, { roughness: 0.35 }), dark = mat(0x343b48, { roughness: 0.55, metalness: 0.3 }), accent = mat(WHO.none, { roughness: 0.3, emissive: WHO.none, emissiveIntensity: 0.35 });
  const desk = new THREE.Group(); scene.add(desk);
  mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.03, 48), dark, desk).position.y = 0.015;
  const turret = new THREE.Group(); desk.add(turret);
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

  const b601 = buildB601(THREE, mesh, mat, accent); scene.add(b601.root);

  // the cubes (as many as the scenario has; the one to move now has brighter edges), and where that one goes
  const box = new THREE.BoxGeometry(CUBE, CUBE, CUBE), edges = new THREE.EdgesGeometry(box);
  const cubes = Array.from({ length: 4 }, () => {
    const m = mesh(box, mat(0xf2e9d0, { roughness: 0.6 }), scene), line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x8a7f62 }));
    m.add(line); m.userData.line = line; m.visible = false;
    return m;
  });
  const goal = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x7ee0a1, transparent: true, opacity: 0.85 }));
  goal.visible = false; scene.add(goal);

  // one's own scenario (#365): its objects in their shapes, sizes and colours, and its trays with their names, made again
  // when the scenario changes (pose().items and .trays are the same objects while it doesn't)
  let own = { items: null, trays: null, objs: [], frames: [] };
  const drop = g => { scene.remove(g); g.traverse(o => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } }); };
  const objectMesh = it => {
    const [x, y, z] = it.dims, geo = it.shape === 'ball' ? new THREE.SphereGeometry(x / 2, 32, 20) : it.shape === 'cylinder' ? new THREE.CylinderGeometry(x / 2, x / 2, z, 32) : new THREE.BoxGeometry(x, z, y);
    const m = mesh(geo, mat(it.hex, { roughness: 0.5 }), scene);
    if (it.shape !== 'ball') { const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })); m.add(line); m.userData.line = line; }
    return m;
  };
  // a tray: its frame in its colour, faint inside (brighter while the object to move goes in it), its name beyond it
  // (on the arm's side the arm would hide it); turned to face the base (its local x is outwards from the base: its depth, d; z across: its width, w)
  const trayFrame = t => {
    const g = new THREE.Group(), w = 0.006, hx = t.d / 2, hz = t.w / 2, m = mat(t.hex, { roughness: 0.45, metalness: 0.2 });
    for (const [x, z, sx, sz] of [[0, hz, 2 * hx + w, w], [0, -hz, 2 * hx + w, w], [hx, 0, w, 2 * hz + w], [-hx, 0, w, 2 * hz + w]]) mesh(new THREE.BoxGeometry(sx, 0.012, sz), m, g).position.set(x, 0.006, z);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(2 * hx, 2 * hz), new THREE.MeshBasicMaterial({ color: t.hex, transparent: true, opacity: 0.1 })); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.001; g.add(pad); g.userData.pad = pad;
    if (globalThis.document) {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
      const cx = cv.getContext('2d'); cx.fillStyle = '#e8ecf2'; cx.font = '700 96px system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(t.name, 256, 68);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
      label.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); label.position.set(hx + 0.035, 0.0015, 0); g.add(label);
    }
    g.position.set(t.x, 0, t.z); g.rotation.y = t.turn;
    scene.add(g);
    return g;
  };
  const ownScene = p => {
    if (p.items !== own.items) { own.objs.forEach(drop); own.objs = (p.items ?? []).map(objectMesh); own.items = p.items ?? null; }
    if (p.trays !== own.trays) { own.frames.forEach(drop); own.frames = (p.trays ?? []).map(trayFrame); own.trays = p.trays ?? null; }
  };

  return {
    camera, renderer, view,
    size(w, h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
    /** Turn the camera round the table (radians) and nearer or further. */
    orbit(daz, del = 0, zoom = 1) { view.az += daz; view.el = Math.max(0.12, Math.min(1.35, view.el + del)); view.dist = Math.max(0.6, Math.min(2.4, view.dist * zoom)); aim(); },
    /** Draw a pose; who: 'net', 'human' or 'none' (the arm's colour). */
    draw(p, who = 'none') {
      desk.visible = p.arm !== 'b601'; b601.root.visible = p.arm === 'b601';
      if (p.arm === 'b601') b601.pose(p.j, p.open);
      else {
        const [q0, a1, e, q3] = p.q;
        turret.rotation.y = q0; shoulder.rotation.z = a1; elbow.rotation.z = -e; wrist.rotation.z = -(p.wrist ?? a1 - e); tool.rotation.y = q3;
        fingers[0].position.x = p.half; fingers[1].position.x = -p.half;
      }
      ownScene(p);
      own.objs.forEach((m, i) => {
        const at = p.cubes[i]; m.position.set(...at.p); m.quaternion.set(...at.q);
        if (m.userData.line) m.userData.line.material.opacity = i === p.now && p.done == null ? 0.9 : 0.35;
        if (m.userData.line) m.userData.line.material.color.setHex(i === p.now && p.done == null ? 0xffffff : 0x000000);
      });
      own.frames.forEach((g, k) => { g.userData.pad.material.opacity = p.done != null ? 0.35 : k === p.into ? 0.3 : 0.1; });
      cubes.forEach((c, i) => {
        const at = !p.items && p.cubes[i]; c.visible = !!at; if (!at) return;
        c.position.set(...at.p); c.quaternion.set(...at.q);
        c.userData.line.material.color.setHex(i === p.now && p.done == null && p.cubes.length > 1 ? 0xffffff : 0x8a7f62);
      });
      goal.visible = !!p.goal && !p.tray; if (p.goal) goal.position.set(...p.goal);
      tray.visible = !!p.tray; if (p.tray) tray.position.set(p.tray.x, 0, p.tray.z);
      tray.userData.pad.material.opacity = p.done != null && p.tray ? 0.4 : 0.12;
      accent.color.setHex(WHO[who] ?? WHO.none); accent.emissive.setHex(WHO[who] ?? WHO.none);
      renderer.render(scene, camera);
    },
    dispose() { renderer.dispose(); },
  };
}

// The reBot Arm B601-RS: each link where core's model (from its makers') puts it on the one before, turned about its
// joint's axis; simple shapes where the real one has its meshes. MuJoCo's frames (z up) inside a group turned to y up.
export function buildB601(THREE, mesh, mat, accent) {
  const black = mat(0x16191a, { roughness: 0.5, metalness: 0.4 }), plastic = mat(0x1f2526, { roughness: 0.6 }), alu = mat(0xb8c2bb, { roughness: 0.25, metalness: 0.85 }), green = mat(0xb9d51e, { roughness: 0.4 });
  const root = new THREE.Group(); root.rotation.x = -Math.PI / 2; root.visible = false;
  const V = (x, y, z) => new THREE.Vector3(x, y, z), X = V(1, 0, 0), Y = V(0, 1, 0);
  // a body: placed on its parent, and a group inside it that its joint turns
  const body = (parent, pos, quat) => { const b = new THREE.Group(); parent.add(b); b.position.set(...pos); if (quat) b.quaternion.set(quat[1], quat[2], quat[3], quat[0]); const j = new THREE.Group(); b.add(j); return j; };
  // a bar from a to b (its cross-section w by h, h along z), and a round housing along an axis
  const bar = (parent, a, b, w, h, m) => { const d = b.clone().sub(a), x = mesh(new THREE.BoxGeometry(d.length(), w, h), m, parent); x.position.copy(a).addScaledVector(d, 0.5); x.quaternion.setFromUnitVectors(X, d.normalize()); return x; };
  const can = (parent, at, axis, r, len, m, seg = 32) => { const x = mesh(new THREE.CylinderGeometry(r, r, len, seg), m, parent); x.position.copy(at); x.quaternion.setFromUnitVectors(Y, axis.clone().normalize()); return x; };
  const Z = V(0, 0, 1), RISER = 0.12;
  mesh(new THREE.BoxGeometry(0.15, 0.15, RISER), mat(0x2b313b, { roughness: 0.7, metalness: 0.2 }), root).position.set(0, 0, RISER / 2);
  can(root, V(0, 0, RISER + 0.012), Z, 0.07, 0.024, alu, 48);
  can(root, V(0, 0, RISER + 0.045), Z, 0.05, 0.05, black, 48);
  const j1 = body(root, [0, 0, RISER + 0.075]);
  can(j1, V(0, 0, 0.03), Z, 0.048, 0.06, alu, 48);
  can(j1, V(0.02, 0.01, 0.07), Y, 0.045, 0.075, black);
  can(j1, V(0.02, -0.03, 0.07), Y, 0.046, 0.008, accent);
  const j2 = body(j1, [0.020343, 0.027237, 0.07], [0.7071055, -0.7071081, 0, 0]);
  bar(j2, V(0, 0, -0.027), V(-0.236, 0, -0.027), 0.056, 0.03, plastic);
  bar(j2, V(-0.02, 0, -0.008), V(-0.216, 0, -0.008), 0.03, 0.008, green);
  bar(j2, V(-0.02, 0, -0.046), V(-0.216, 0, -0.046), 0.03, 0.008, green);
  can(j2, V(-0.236, 0, -0.027), Z, 0.042, 0.07, black);
  can(j2, V(-0.236, 0, 0.01), Z, 0.043, 0.008, accent);
  const j3 = body(j2, [-0.236, 0, 0]);
  bar(j3, V(0.02, -0.006, -0.027), V(0.228, -0.072746, -0.027), 0.045, 0.034, alu);
  bar(j3, V(0.05, -0.016, -0.0455), V(0.2, -0.064, -0.0455), 0.03, 0.004, green);
  can(j3, V(0.228, -0.072746, -0.027), Z, 0.034, 0.06, black);
  can(j3, V(0.228, -0.072746, 0.004), Z, 0.035, 0.007, accent);
  const j4 = body(j3, [0.228, -0.072746, 0.0045]);
  bar(j4, V(0.01, -0.005, -0.031), V(0.087, -0.048, -0.031), 0.04, 0.04, alu);
  const j5 = body(j4, [0.087, -0.048, -0.03075], [0.7071055, -0.7071081, 0, 0]);
  can(j5, V(0, 0, 0.01), Z, 0.03, 0.045, black);
  bar(j5, V(0, 0, 0.03), V(0.0365, 0, 0.048), 0.04, 0.04, green);
  const j6 = body(j5, [0.0365, 0, 0.048], [0.7071055, 0, 0.7071081, 0]);
  can(j6, V(0, 0, 0.02), Z, 0.03, 0.04, black);
  can(j6, V(0, 0, 0.06), Z, 0.026, 0.05, green);
  can(j6, V(0, 0, 0.041), Z, 0.031, 0.006, accent);
  const tool = body(j6, [0, 0, 0.16621], [-0.0000026, 0.7071055, 0.0000026, 0.7071081]);
  mesh(new THREE.BoxGeometry(0.016, 0.1, 0.05), black, tool).position.set(-0.073, 0, 0);
  mesh(new THREE.BoxGeometry(0.008, 0.09, 0.03), alu, tool).position.set(-0.062, 0, 0);
  const fingers = [1, -1].map(s => { const f = new THREE.Group(); tool.add(f); mesh(new THREE.BoxGeometry(0.065, 0.0127, 0.021), plastic, f).position.set(-0.0325, s * 0.00635, 0); mesh(new THREE.BoxGeometry(0.03, 0.004, 0.022), alu, f).position.set(-0.05, s * 0.0147, 0); return f; });
  const grip = new THREE.Object3D(); tool.add(grip); grip.position.set(-0.025, 0, 0);       // core's site 'grip' (a test holds the two together)
  const turns = [[j1, V(0, 0, -1)], [j2, Z], [j3, V(0, 0, -1)], [j4, V(0, 0, -1)], [j5, V(0, 0, -1)], [j6, V(0, 0, -1)]];
  return {
    root, grip,
    /** j: the six joints (rad); open: each finger's travel from shut (m). */
    pose(j, open) { turns.forEach(([g, ax], i) => g.quaternion.setFromAxisAngle(ax, j[i])); fingers[0].position.y = open; fingers[1].position.y = -open; },
  };
}
