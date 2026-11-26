// The simulator as one module to download (#355): `carsim.mjs`, the sim's engine (public/sim/engine.js, as the game
// runs it) without a screen, with three.js inside it, for Node, a browser or a worker.
//
// The engine is a page's script: it expects a window, a document, a canvas. The autopilot's workers already run it
// without them (AI_WK: a stub DOM, no frames, nothing drawn; scripts/patches/autopilot.py), and this is the same trick,
// made a module: the engine's source goes whole inside a function whose parameters are the page's globals (`window`,
// `document`, `localStorage`, `globalThis`...), so each `createSim()` is a world of its own and nothing is written on
// the real globals. api.js (the module's own API) is put after it in the same scope: it reads the engine's own
// functions and state by name. A name the engine drops breaks the build's test (test/sim-module.test.mjs), not a user.
//
//   buildSimModule({ engine, three, api }) → the module's source
import crypto from 'node:crypto';

/** the page's globals the engine names, given to it as parameters: stand-ins, or (TIMERS) Node's own made harmless */
export const PAGE_GLOBALS = ['window', 'self', 'globalThis', 'document', 'localStorage', 'sessionStorage', 'location', 'navigator', 'history', 'screen', 'visualViewport',
  'parent', 'top', 'opener', 'alert', 'confirm', 'prompt', 'getComputedStyle', 'matchMedia', 'AudioContext', 'webkitAudioContext', 'AudioWorkletNode', 'Audio', 'Image',
  'HTMLElement', 'HTMLCanvasElement', 'HTMLImageElement', 'HTMLVideoElement', 'Element', 'Node', 'ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'CSS', 'scrollTo',
  'requestIdleCallback', 'speechSynthesis', 'SpeechSynthesisUtterance', 'DOMParser', 'XMLSerializer', 'getSelection', 'focus', 'blur', 'print', 'PointerEvent', 'KeyboardEvent',
  'MouseEvent', 'TouchEvent', 'CustomEvent', 'Worker', 'EventSource', 'WebSocket', 'FileReader', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'requestAnimationFrame',
  'cancelAnimationFrame', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'postMessage', 'setTimeout', 'setInterval', 'fetch'];

/** three.js's module as an expression: its one `export { … }` made the value of a function */
export function threeAsValue(three) {
  const at = three.lastIndexOf('\nexport {'), end = three.indexOf('};', at);
  if (at < 0 || end < 0 || /^(import|export) /m.test(three.slice(0, at))) throw new Error('three.module.js is not one module with one export list');
  const names = three.slice(at + 9, end).split(',').map(s => s.trim()).filter(Boolean).map(s => { const [a, b] = s.split(/\s+as\s+/); return b ? `${b}: ${a}` : a; });
  return `(() => {\n${three.slice(0, at)}\nreturn { ${names.join(', ')} };\n})()`;
}

/** the engine's source as a function's body: no imports, no WebGL renderer (as the autopilot's workers take it) */
export function engineAsBody(engine) {
  const s = engine.replace(/^(import [^\n]*\n)+/, '');
  if (s === engine || /^(import|export) /m.test(s)) throw new Error('engine.js: its imports are not where they were');
  if (!s.includes('new THREE.WebGLRenderer(')) throw new Error('engine.js: no WebGL renderer to stand in for');
  return s.replace(/new THREE\.WebGLRenderer\(/g, 'new __aiwStub(');
}

export function buildSimModule({ engine, three, api, built = new Date().toISOString() }) {
  const version = crypto.createHash('sha256').update(engine).update(api).digest('hex').slice(0, 12);
  const [head, tail] = api.split('/*__ENGINE__*/');
  if (tail === undefined) throw new Error('api.js: no /*__ENGINE__*/ mark');
  return `// carsim.mjs: the Carsim simulator as a module (build ${version}, ${built}).
// The game's own physics without a screen: import { createSim } from './carsim.mjs'. Its documentation is where you
// downloaded it (…/developers, …/developers.md). Generated from the site's engine: don't edit, download it again.
// Includes three.js r160 (MIT, © 2010-2023 three.js authors: https://threejs.org), used for its vectors and curves.
/* eslint-disable */
const THREE = ${threeAsValue(three)};
export const VERSION = ${JSON.stringify({ build: version, built })};
const __PAGE = ${JSON.stringify(PAGE_GLOBALS)};
${head.replace('/*__PARAMS__*/', PAGE_GLOBALS.join(', '))}
${engineAsBody(engine)}
${tail}`;
}
