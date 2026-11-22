// The downloaded car models (models/, not in git) and how build-car.mjs makes them into the sim's.
//   file: the model (in the last of zip: [the zip, a zip inside it, ...], if any); kind: 'glb' | 'fbx'
//   root: only the subtree under the node of that name (a pack of cars)
//   axes: the source's forward and left directions (up is +y); scale: source units → metres
//   spin / stat: what turns with the wheels / the callipers (path + material name), split by corner
//   steer: the steering wheel: the connected pieces of the parts it matches lying wholly in box [min, max] (sim axes);
//     --probe minx,miny,minz,maxx,maxy,maxz lists the pieces in a box, to find it
//   rearMat: [{ match, name }]: a material used front and back (one lights texture) gets a rear copy (the brake lights)
//   split: [{ mat, box, name, sym, path }]: the triangles of a material in a box [min, max] (sim axes; sym: either side) become
//     a material of that name (one "glass" for windows and lamp covers); mats' rules then apply to it by its new name
//   drop: never seen (engine bay under a shut bonnet, a showroom floor); parts: [regex, 'kind_side'] ('kind_*': one
//     mesh holding both sides' part, split down the middle into kind_l and kind_r)
//   panes: [{ like, half }]: a window the source left out, as a pane of the material named like `like`: half its outline
//     ([x, y, z] in the sim's axes, up the left side from the bottom), mirrored and filled
//   texSplit: [{ mat, name, test(r, g, b) }]: a body painted in its texture: the triangles whose texels all pass the test
//     become a plain material of that name (the paint), the others keep the texture (lamps, grilles in the same atlas)
//   mirror: { replace, from, renameFrom, renameTo }: replace one side's part by the other's, mirrored
//   mats: [regex on the material name, overrides]: the sim finds paint, glass, tires, lights by name; mask: true keeps
//     a texture's cut-out alpha (badges, a mesh grille): name those decal_*, the sim makes everything else opaque
//   ratio: triangles kept per node (all, body, spin, ...); texMax: texture size per kind
//   loose: [regex on path + material, ratio, error]: meshes of many small pieces (grilles, lamp internals, tyre treads),
//     simplified without keeping their borders and dropping their smallest pieces; merge: true: a model in hundreds
//     of small meshes is first joined into one per material (meshes under 300 triangles are left as they are)
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
  x5m: {
    zip: ['models/bmw-x5-m-g05.zip'], file: 'source/2020_bmw_x5_m_competition.glb', kind: 'glb',
    axes: { fwd: '+z', left: '+x' }, scale: 0.011,         // a SketchUp model in its own units: to the real car's 2.97 m wheelbase
    spin: /Wheel_02_LF_/, stat: /CSB_(paint1|Coloured)Mtl$|CalliperBadge/,      // all four wheels carry the LF names
    drop: [/ material$/],
    steer: { match: / (Color_M08|Interior1)$/, box: [[0.19, 0.9, 0.2], [0.63, 1.32, 0.44]] },      // rim, spokes, buttons and paddles
    // it has no rear window: one across the tailgate's opening (measured off the model), its edge tucked behind the frame
    panes: [{ like: /^Windows$/, half: [[0.6, 1.262], [0.66, 1.3], [0.685, 1.342], [0.672, 1.39], [0.66, 1.442], [0.648, 1.49], [0.632, 1.538], [0.6, 1.585], [0.5, 1.612]].map(([x, y]) => [x, y, +(-2.302 + 1.008 * (y - 1.29)).toFixed(3)]) }],
    // its glass is also the gear lever's crystal knob and the side markers; its lamp covers front, side and rear are one material
    split: [{ mat: /^Windows$/, name: 'chrome_knob', box: [[-0.1, 0.7, 0.2], [0.15, 0.9, 0.4]] }, { mat: /^Windows$/, name: 'marker_lens', sym: true, box: [[0.8, 0.85, -1.4], [1, 1.02, -1.1]] },
      { mat: /^Lights$/, name: 'rear_lens', box: [[-1.3, 0.4, -2.6], [1.3, 1.2, -1.9]] }],
    mats: [
      [/^Marina_Bay_Blue_Metallic$/, { name: 'paint_body', color: 0x1c4f91, metal: 0.6, rough: 0.3 }],
      [/^Windows$/, { name: 'window_glass' }],
      [/^chrome_knob$/, { color: 0xcfd3d6, metal: 1, rough: 0.1, alpha: 1, blend: false }],
      [/^HeadLights_Glass$/, { name: 'headlight_lens' }],
      [/^Lights$/, { name: 'lamp_lens' }],
      [/^rear_lens$/, { color: 0x8a0808 }],
      [/^Color_A0[78]$/, { name: m => 'taillight_' + m.slice(-3) }],
      [/^Interior1?$/, { name: m => 'int_' + m.toLowerCase() }],
      [/CSB_Tire$/, { name: 'tire' }],
      [/CSB_paint1Mtl$/, { name: 'caliper_gold' }],        // or the sim takes it for the body's paint
      [/CSB_ColouredMtl$/, { name: 'caliper_black' }],
    ],
    loose: [[/ (Grille[12]|taillight_A0[78]|Color_M0[1238]|int_interior1?|jean_blue|UnderCarriage|Rims1|.*CSB_Rim)$/, 0.3]],      // by their names after `mats`
    merge: true, ratio: { all: 0.5 }, texMax: { all: 512 },
  },
  gle63: {
    zip: ['models/mercedes-amg_gle_63_coupe_2022.zip'], file: 'scene.gltf', kind: 'glb', root: /^AMG_31$/,       // not its stone floor
    axes: { fwd: '-x', left: '+z' }, scale: 1,
    // wheels: Object032..037 (rims, tyres in pairs), the discs of Object031/038; their callipers steer but do not spin
    spin: /\/Object03[2-7]_\d+\/|\/Object03[18]_\d+\/Object_\d+ Iron_Clean/, stat: /\/Object03[18]_\d+\/Object_\d+ Material_2125641720/,
    split: [{ mat: /^plasticB$/, path: /\/interior_8\//, name: 'int_plastic' }],
    steer: { match: /\/interior_8\//, box: [[0.28, 1.0, 0.36], [0.625, 1.35, 0.495]] },
    parts: [[/\/side mirrors_29\//, 'mirror_*']],
    mats: [
      [/^Material_2125660675$/, { name: 'paint_body', color: 0x7a1218, metal: 0.6, rough: 0.3 }],
      [/^Material_2125660666$/, { name: 'window_glass' }],
      [/^Material_2125660006$/, { name: 'roof_glass', alpha: 0.4, blend: true }],
      [/^565625660666$/, { name: 'headlight_lens' }],
      [/^Material_2125648194$/, { name: 'rear_lens' }],
      [/^Red_Light22$/, { name: 'taillight_led', color: 0x7a0808 }],
      [/^Material_2125656983$/, { name: 'drl_led', color: 0xffffff }],
      [/^Material_2125641720$/, { name: 'caliper_red', color: 0x9a1616, rough: 0.35 }],
      [/^Material_2125648019$/, { name: 'tire' }],
      [/^Material_2125651335$/, { name: 'tire_wall' }],
      [/^Material_2125663859$/, { name: 'rim_dark', color: 0x1c1d1f, metal: 0.7, rough: 0.35 }],
      [/^Iron_Clean_Distorted$/, { name: 'disc', color: 0x6a6c70, metal: 0.85, rough: 0.45 }],
      [/^Material_212565056834$/, { name: 'trim_gloss', color: 0x08080a, metal: 0.4, rough: 0.2 }],
      [/^plasticB$/, { name: 'plastic_black', color: 0x0c0c0d, metal: 0, rough: 0.7 }],
      [/^int_plastic$/, { color: 0x151515, metal: 0, rough: 0.75 }],
      [/^Standard_20$/, { name: 'mirror_glass', color: 0xcccccc, metal: 1, rough: 0.05 }],
      [/^Material_2125648019\.001$/, { name: 'plate_frame', color: 0x0c0c0d }],
      [/^04_-_Default$/, { name: 'plate', color: 0xeeeeea, rough: 0.5 }],
    ],
    loose: [[/ tire$/, 0.2], [/ rim_dark$/, 0.4], [/front bumper splitter001_6\/Object_20 /, 0.2], [/ int_plastic$/, 0.6]],
    ratio: { all: 0.6 }, texMax: { all: 512 },
  },
  gt500: {
    zip: ['models/2020-ford-shelby-gt500.zip', 'source/Unity2Skfb.zip'], file: 'Unity2Skfb.gltf', kind: 'glb',
    axes: { fwd: '-z', left: '-x' }, scale: 1.04,          // to the real car's 2.72 m wheelbase
    spin: /LOD_A_(TYRE|WHEEL)_/,
    steer: { match: /INT_STEERING_WHEEL/ },
    parts: [[/DOOR_LEFT_/, 'door_l'], [/DOOR_RIGHT_/, 'door_r'], [/FRONTBUMPER_/, 'bumper_f'], [/REARBUMPER_/, 'bumper_r'], [/LOD_A_HOOD_/, 'hood'], [/LOD_A_BOOT_/, 'tailgate'],
      [/MIRROR_(GLASS_)?LEFT_/, 'mirror_l'], [/MIRROR_(GLASS_)?RIGHT_/, 'mirror_r']],
    // the body's colour is in its texture (blue, white stripes) with lamps and grilles beside it: the blue and the stripes become the paint
    texSplit: [{ mat: /_ext_performance_blue/, name: 'paint_body', test: (r, g, b) => (b > 40 && b - r > 12 && b >= g && g >= r - 8) || (Math.min(r, g, b) > 165 && Math.max(r, g, b) - Math.min(r, g, b) < 30) }],
    split: [{ mat: /^car_windows\.etc$/, path: /HEADLIGHT_LENS/, name: 'headlight_lens' }, { mat: /^car_windows\.etc$/, path: /TAILLIGHT_LENS/, name: 'rear_lens' }],
    rearMat: [{ match: /gt500_lights\.etc$/, name: 'taillight_lamp' }],
    mats: [
      [/^paint_body$/, { color: 0x12407c, metal: 0.6, rough: 0.3 }],
      [/_ext_performance_blue/, { name: 'ext_detail' }],
      [/^car_windows\.etc$/, { name: 'window_glass', color: 0x0a0d11, alpha: 0.4, blend: true, map: false }],
      [/^car_windows_02\.etc$/, { name: 'window_glass_inner', color: 0x0a0d11, alpha: 0.4, blend: true, map: false }],
      [/^headlight_lens$/, { color: 0xffffff, alpha: 0.2, blend: true, map: false }],
      [/^rear_lens$/, { color: 0x8a0808, alpha: 0.4, blend: true, map: false }],
      [/gt500_badges\.etc$/, { name: 'decal_badges', mask: true, blend: false }],
      [/gt500_lights\.etc$/, { name: 'lights' }],
      [/gt500_misc\.etc$/, { name: 'misc' }],
      [/^car_chassis\.etc$/, { name: 'chassis' }],
      [/^car_tyre_tread\.etc$/, { name: 'tire' }],
      [/gt500_wheel\.etc$/, { name: 'rim', metal: 0.6, rough: 0.35 }],
      [/^Chrome$/, { name: 'chrome_mirror', metal: 1, rough: 0.05 }],
      [/gt500_cab\.etc$/, { name: 'int_cab' }],
      [/gt500_int\.etc 1$/, { name: 'int_display' }],
      [/gt500_int\.etc$/, { name: 'int_trim' }],
      [/gt500_sw\.etc$/, { name: 'int_steering' }],
      [/^(leather|stitching|plastic|speaker_mesh|rubber|carpet|carbon_fibre|suede)_/, { name: m => 'int_' + m.replace(/_(black\d*_)?mat\d+\.etc$/, '') }],
      [/^LOD_A_INT_INTERIOR_mm_extMat$/, { name: 'int_none' }],
    ],
    ratio: { all: 1 }, texMax: { all: 512 },
  },
  cayennets: {
    zip: ['models/2009-porsche-cayenne-turbo-s.zip', 'source/FINAL_MODEL.zip'], file: 'FINAL_MODEL.fbx', kind: 'fbx',
    axes: { fwd: '+z', left: '+x' }, scale: 1,
    spin: /^\/Group(13|17|21|25)\//,                      // tyre, rim and brake disc of each corner; it has no callipers
    rearMat: [{ match: /^CAYENNE_luz$/, name: 'taillight_lamp' }],
    steer: { match: /\/Mesh4 /, box: [[0.18, 0.87, 0.19], [0.65, 1.32, 0.41]] },
    // one clear material (phong1) is every pane: the windows, the headlamps' covers, the tail lamps'
    split: [{ mat: /^phong1$/, name: 'headlight_lens', box: [[-1.2, 0.2, 1.6], [1.2, 1.15, 2.6]] }, { mat: /^phong1$/, name: 'rear_lens', box: [[-1.2, 0.8, -2.6], [1.2, 1.18, -1.95]] }],
    mats: [
      [/^CAYENNE$/, { name: 'paint_body', color: 0x4a3a2c, metal: 0.6, rough: 0.3 }],
      [/^cromo$/, { name: 'chrome', metal: 1, rough: 0.12 }],
      [/^(vidrios|phong1)$/, { name: 'window_glass', color: 0x0a0d11, alpha: 0.4, blend: true, map: false }],
      [/^d_glass$/, { name: 'roof_glass' }],
      [/^headlight_lens$/, { color: 0xffffff, alpha: 0.2, blend: true }],
      [/^rear_lens$/, { color: 0x8a0808, alpha: 0.4, blend: true }],
      [/^CAYENNE_luz2$/, { name: 'taillight_cover', alpha: 1, blend: false }],
      [/^CAYENNE_int$/, { name: 'int_trim' }],
      [/^llanta$/, { name: 'tire' }],
    ],
    ratio: { all: 1 }, texMax: { all: 512 },
  },
};
