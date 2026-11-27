// MuJoCo for the page and its workers (#359): loaded as it is from public/arm/vendor (scripts/vendor-three.mjs puts it
// there on install), not through the bundler: its loader finds its WebAssembly next to itself. Node takes the package
// itself (`import loadMujoco from '@mujoco/mujoco'`).
export const mujocoUrl = () => `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/arm/vendor/mujoco/mujoco.js`;
/** MuJoCo, loaded and ready: what lib/arm/core.mjs calls M. */
export async function loadMujoco() {
  const { default: load } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ mujocoUrl());
  return load();
}
