// The downloaded car models (models/, not in git) and how build-car.mjs makes them into the sim's.
//   file: the model (in the last of zip: [the zip, a zip inside it, ...], if any); kind: 'glb' | 'fbx'
//   root: only the subtree under the node of that name (a pack of cars)
//   axes: the source's forward and left directions (up is +y); scale: source units → metres
//   spin / stat: what turns with the wheels / the callipers (path + material name), split by corner
//   steer: the steering wheel: the connected pieces of the parts it matches lying wholly in box [min, max] (sim axes);
//     --probe minx,miny,minz,maxx,maxy,maxz lists the pieces in a box, to find it
//   rearMat: [{ match, name }]: a material used front and back (one lights texture) gets a rear copy (the brake lights)
//   drop: never seen (engine bay under a shut bonnet, a showroom floor); parts: [regex, 'kind_side']
//   mirror: { replace, from, renameFrom, renameTo }: replace one side's part by the other's, mirrored
//   mats: [regex on the material name, overrides]: the sim finds paint, glass, tires, lights by name
//   ratio: triangles kept per node (all, body, spin, ...); texMax: texture size per kind
export const CARS = {
  xjr: {
    file: 'models/jaguardaimler_xj_x308_pack.glb', kind: 'glb', root: /^XJR_\d+$/,
    axes: { fwd: '+x', left: '-z' }, scale: 0.981,       // to the real car's 5.02 m
    spin: /_Wheel_/, stat: /_Brakes_/,
    rearMat: [{ match: /^Lights$/, name: 'taillight_lamp' }],
    steer: { match: /_Interior_/, box: [[-0.6, 0.55, 0.25], [-0.14, 1.05, 0.6]] },      // right-hand drive
    mats: [
      [/^PaintGreen$/, { name: 'paint_body', color: 0x0f3b26, metal: 0.6, rough: 0.3 }],
      [/^PaintedBlack$/, { name: 'trim_black', metal: 0.1, rough: 0.3 }],
      [/^Window$/, { name: 'window_glass' }],
      [/^Lens$/, { name: 'headlight_lens' }],
      [/^Tire$/, { name: 'tire' }],
      [/^Chrome$/, { name: 'chrome', metal: 1, rough: 0.12 }],
    ],
    ratio: { all: 1 }, texMax: { all: 512 },
  },
  sl63: {
    zip: ['models/2022-mercedes-benz-sl-63-amg.zip', 'source/FINAL_MODEL_22.zip'], file: 'FINAL_MODEL_22.fbx', kind: 'fbx',
    axes: { fwd: '+z', left: '+x' }, scale: 1,
    spin: /Ani_Wheel_(FL|FR|BL|BR)\d/, stat: /Wheel_Caliper|SK_Brake_101/,
    drop: [/SM_Engine_101/],
    rearMat: [{ match: /MI_Light1$/, name: 'taillight_lamp' }],
    steer: { match: /SK_Body_Bones/, box: [[0.17, 0.68, -0.04], [0.59, 1.08, 0.21]] },
    parts: [[/SideMirror_L/, 'mirror_l'], [/SideMirror_R/, 'mirror_r'], [/Bumper_F/, 'bumper_f'], [/Bumper_B/, 'bumper_r'], [/Door_FL/, 'door_l'], [/Door_FR/, 'door_r'], [/SK_Hood/, 'hood'], [/SK_Trunk/, 'tailgate'], [/SK_Spoiler/, 'spoiler']],
    mats: [
      [/MI_1238030001_002/, { name: 'paint_body', color: 0x3a3d42, metal: 0.6, rough: 0.3 }],
    ],
    ratio: { all: 0.3 }, texMax: { all: 512 },
  },
  p911: {
    zip: ['models/porsche-911-with-interior.zip'], file: 'source/porsche_911_turbo.fbx', kind: 'fbx',
    axes: { fwd: '+x', left: '-z' }, scale: 0.01,
    spin: /\/(wheel_rim|AO_tire_main|discs) /, stat: /\/brakes_all /,
    mirror: [{ replace: /\/door_2\//, from: /\/door_1\//, renameFrom: 'door_1', renameTo: 'door_2' }],
    parts: [[/\/door_1\//, 'door_r'], [/\/door_2\//, 'door_l']],
    steer: { match: /\/(carbon_all|plast_leather_all|leather_all|plastic_all|chrome_int|glossy_plastic|logo_all) /, box: [[0.14, 0.58, 0.13], [0.54, 0.99, 0.32]] },
    mats: [
      [/^body_main$/, { name: 'paint_body', color: 0x9a9da1, metal: 0.6, rough: 0.3 }],
      [/^reisin$/, { name: 'rubber_seal', color: 0x0a0a0a, rough: 0.8 }],
      [/^bl_pl_M_ext$/, { name: 'plastic_ext', color: 0x111214, rough: 0.6 }],
      [/^windows$/, { name: 'window_glass', color: 0x0a0d11 }],
      [/^windows_edge$/, { name: 'trim_frit', color: 0x050505, rough: 0.3, alpha: 1, blend: false }],
      [/^black_metal$/, { name: 'metal_black', color: 0x111111, metal: 0.5, rough: 0.5 }],
      [/^Mirror$/, { name: 'mirror_glass', color: 0xcccccc, metal: 1, rough: 0.05 }],
      [/^carbon_int$/, { name: 'carbon', color: 0x1a1a1a, rough: 0.4 }],
      [/^headlights_pattern$/, { name: 'lamp_pattern', color: 0x888888, metal: 0.8, rough: 0.2 }],
      [/^windows_dots$/, { name: 'trim_dots', color: 0x050505, rough: 0.5 }],
      [/^brakes$/, { name: 'caliper', color: 0xb3121b, rough: 0.3 }],
      [/^invisible_all$/, { name: 'black', color: 0x050505, rough: 0.8 }],
      [/^number_plate1$/, { name: 'plate', color: 0xeeeeea, rough: 0.5 }],
      [/^monitor$/, { name: 'screen', color: 0x050608, rough: 0.1, alpha: 1, blend: false }],
      [/^reflectors$/, { name: 'reflector', color: 0x9a1010, rough: 0.3 }],
      [/^red_light_main$/, { name: 'taillight', color: 0x7a0808, rough: 0.2 }],
      [/^bl_pl__GL_int_ext$/, { name: 'plastic_gloss', color: 0x0b0b0c, rough: 0.15 }],
      [/^chrom_int$/, { name: 'chrome_int', color: 0xcfd3d6, metal: 1, rough: 0.12 }],
      [/^Discs$/, { name: 'disc', color: 0x5c5e61, metal: 0.85, rough: 0.45 }],
      [/^rim_black$/, { name: 'rim_dark', color: 0x1c1d1f, metal: 0.6, rough: 0.35 }],
      [/^rim_chrome$/, { name: 'rim_chrome', color: 0xc8ccd0, metal: 1, rough: 0.15 }],
      [/^lights$/, { name: 'headlight_glass', color: 0xffffff, rough: 0.05, alpha: 0.25 }],
      [/^pipes_chrom$/, { name: 'chrome_pipes', color: 0xd0d0d0, metal: 1, rough: 0.15 }],
      [/^pl_leather_int$/, { name: 'int_leather_plastic', color: 0x161616, rough: 0.6 }],
      [/^dynamics$/, { name: 'int_speaker', color: 0x333333, rough: 0.5 }],
      [/^upholstery$/, { name: 'int_headliner', color: 0x2a2a2a, rough: 0.9 }],
      [/^tires$/, { name: 'tire', color: 0x121212, rough: 0.92 }],
      [/^LOGO1$/, { name: 'badge', color: 0x9a9a9a, metal: 0.8, rough: 0.3 }],
      [/^belts$/, { name: 'int_belts', color: 0x111111, rough: 0.8 }],
      [/^hedlights_grid$/, { name: 'lamp_grid', color: 0x222222, rough: 0.4 }],
      [/^headlights_plastic_ring$/, { name: 'lamp_ring', color: 0x0e0e0e, rough: 0.4 }],
      [/^rug_interior$/, { name: 'int_carpet', color: 0x1a1a1a, rough: 0.95 }],
      [/^leather_(int|seam|perforated)$/, { name: 'int_leather', color: 0x1c1c1c, rough: 0.55 }],
      [/^bl_pl_M_int$/, { name: 'int_plastic', color: 0x141414, rough: 0.7 }],
      [/^interior_grid$/, { name: 'int_grid', color: 0x202020, rough: 0.6 }],
    ],
    ratio: { all: 0.25 }, texMax: { all: 512 },
  },
};
