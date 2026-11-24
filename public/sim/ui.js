// Carsim's interface for the sim's own page (ticket #320), over what the sim builds itself: ui.css is the look,
// this is what a stylesheet can't do.
//   - the rail under the minimap: one stand-in for each of the sim's buttons (Pause, Replay, Paint, Bots…), with its
//     key; the sim's own buttons stay in the page, off the screen, as its scripts measure and relabel them: a
//     stand-in copies its button's label, state and whether it shows, and clicks it;
//   - the keys: the sim's #help laid out as a sheet, closed until asked for (H, or the rail's Keys);
//   - the start menu's frame, and the menu again from the rail (Track, car and ground);
//   - the car's setup (U, or the rail's Car setup): a drawer for the drive and the tires, and what each choice means;
//   - the way home, and ?lab=1: the TNN lab's drawer opens once a car and a ground are picked (⤢ makes it full screen).
// It changes nothing in the sim: without this file the page is the sim as it was.
const ICON = {"brain": "<path d=\"M12 18V5\"/><path d=\"M15 13a4.17 4.17 0 01-3-4 4.17 4.17 0 01-3 4\"/><path d=\"M17.707 6.294A3 3 0 1012 5a3 3 0 10-5.707 1.294\"/><path d=\"M17.996 5.125a4 4 0 012.526 5.77\"/><path d=\"M18 18a4 4 0 002-7.465\"/><path d=\"M19.967 17.482a4 4 0 11-7.967.517 4 4 0 11-7.967-.517\"/><path d=\"M6 18a4 4 0 01-2-7.465\"/><path d=\"M6.004 5.125a4 4 0 00-2.526 5.77\"/>", "pause": "<rect x=\"14\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\"/><rect x=\"5\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\"/>", "play": "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\"/>", "replay": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/><path d=\"M3 3v5h5\"/>", "reset": "<path d=\"M10 2h4\"/><path d=\"M12 14v-4\"/><path d=\"M4 13a8 8 0 0 1 8-7 8 8 0 1 1-5.3 14L4 17.6\"/><path d=\"M9 17H4v5\"/>", "car": "<path d=\"m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8\"/><path d=\"M7 14h.01\"/><path d=\"M17 14h.01\"/><rect width=\"18\" height=\"8\" x=\"3\" y=\"10\" rx=\"2\"/><path d=\"M5 18v2\"/><path d=\"M19 18v2\"/>", "palette": "<path d=\"M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z\"/><circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>", "sun": "<path d=\"M12 2v2\"/><path d=\"m4.93 4.93 1.41 1.41\"/><path d=\"M20 12h2\"/><path d=\"m19.07 4.93-1.41 1.41\"/><path d=\"M15.947 12.65a4 4 0 0 0-5.925-4.128\"/><path d=\"M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z\"/>", "flag": "<path d=\"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528\"/>", "pencil": "<path d=\"M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13\"/><path d=\"m8 6 2-2\"/><path d=\"m18 16 2-2\"/><path d=\"m17 11 4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17\"/><path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"/><path d=\"m15 5 4 4\"/>", "keys": "<path d=\"M10 8h.01\"/><path d=\"M12 12h.01\"/><path d=\"M14 8h.01\"/><path d=\"M16 12h.01\"/><path d=\"M18 8h.01\"/><path d=\"M6 8h.01\"/><path d=\"M7 16h10\"/><path d=\"M8 12h.01\"/><rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\"/>", "claude": "<path d=\"m11 17 2 2a1 1 0 1 0 3-3\"/><path d=\"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4\"/><path d=\"m21 3 1 11h-2\"/><path d=\"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3\"/><path d=\"M3 4h8\"/>", "home": "<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"/><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>", "x": "<path d=\"M18 6 6 18\"/><path d=\"m6 6 12 12\"/>", "users": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><path d=\"M16 3.128a4 4 0 0 1 0 7.744\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/>"};
ICON.setup = '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>';
ICON.sound = '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>';
ICON.soundOff = '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z"/><path d="m16.5 14.5 5-5"/><path d="m16.5 9.5 5 5"/>';
// (two arcs, not a gradient: a gradient's id would be shared by every copy of the mark, and die with a hidden one)
const MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M22.4 8.3A10 10 0 0 0 6 16" fill="none" stroke="#ff7a33" stroke-width="4.2" stroke-linecap="round"/><path d="M6 16A10 10 0 0 0 22.4 23.7" fill="none" stroke="#58d6e6" stroke-width="4.2" stroke-linecap="round"/><circle cx="22.4" cy="8.3" r="3.4" fill="#ff7a33"/><circle cx="22.4" cy="23.7" r="3.4" fill="#58d6e6"/></svg>';
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const $ = id => document.getElementById(id);
const LAB = new URLSearchParams(location.search).get('lab') === '1';
const HOME = location.pathname.replace(/\/sim\/[^/]*$/, '') + '/';
const plain = s => s.replace(/^[^\p{L}\p{N}]+/u, '').trim();          // a button's label without its emoji

document.title = LAB ? 'TNN lab · Carsim' : 'Carsim';
if (LAB) document.body.classList.add('ui-lab');
while (!window.__sim) await new Promise(r => setTimeout(r, 100));     // the sim has built its page
// in a race room, or the map editor's page: the sim is inside the app's page, which has the way home and picks the car
const MP = document.body.classList.contains('mp') || new URLSearchParams(location.search).get('edit') === '1';

// ---------------------------------------------------------------- the keys
const help = $('help');
const helpOpen = () => help.style.display !== 'none';
const helpToggle = () => { help.style.display = helpOpen() ? 'none' : ''; };
let helpSrc = null;
function helpLayout() {
  if (help.querySelector('.keys') || !help.innerHTML.trim()) return;
  helpSrc = help.innerHTML;
  const keys = [], notes = [];
  for (const line of helpSrc.split(/<br\s*\/?>/i).map(l => l.trim()).filter(Boolean)) {
    if (!/^<b>/i.test(line)) { notes.push(line); continue; }
    for (const part of line.split(/(?:&nbsp;| )\s*(?=<b>)/i)) {
      const m = part.match(/^((?:<b>[^<]*<\/b>\s*)+)([\s\S]*)$/i);
      if (m) keys.push([m[1].replace(/<\/?b>/gi, ' ').trim(), m[2].replace(/&nbsp;| /g, ' ').trim()]);
    }
  }
  help.innerHTML = `<button class="close" type="button">Esc · close</button><h3>Keys</h3><p class="sub">H opens and closes this.</p>`
    + `<div class="keys">${keys.map(([k, t]) => `<div><kbd>${k}</kbd><span>${t}</span></div>`).join('')}</div>${notes.map(n => `<p class="note">${n}</p>`).join('')}`;
  help.querySelector('.close').addEventListener('click', e => { e.currentTarget.blur(); helpToggle(); });
}
help.style.display = 'none';                                          // closed until asked for
helpLayout();
new MutationObserver(() => helpLayout()).observe(help, { childList: true });   // the sim writes other keys in a room
addEventListener('keydown', e => { if (e.code === 'Escape' && helpOpen()) helpToggle(); });

// ---------------------------------------------------------------- the start menu
const menu = $('menu');
const menuOpen = () => !MP && menu.style.display !== 'none';
if (!MP) {
  const card = menu.querySelector('.card'), h2 = card.querySelectorAll(':scope > h2'), p = card.querySelectorAll(':scope > p');   // (not the tracks' row's, #trkSec)
  const top = document.createElement('div'); top.className = 'uiTop';
  top.innerHTML = `${MARK}<span>Carsim</span><span class="mode">${LAB ? 'TNN lab' : 'Solo drive'}</span><button class="x" type="button" title="Keep this track, car and ground">Close</button>`;
  card.prepend(top);
  top.querySelector('.x').addEventListener('click', () => { menu.style.display = 'none'; });
  if (h2[0]) h2[0].textContent = LAB ? 'Choose the car your network will drive' : 'Choose your car';
  if (p[0]) p[0].textContent = LAB ? 'It learns this car on this ground: another car is another training.' : 'From 120 kW on long-travel springs to a 567 kW muscle car. V switches it any time.';
  if (h2[1]) { h2[1].textContent = LAB ? 'Pick a ground to open the lab' : 'Pick a ground to drive'; h2[1].style.marginTop = '22px'; }
  if (p[1]) p[1].textContent = 'It sets the grip, the ruts and the dust. G switches it any time.';
  const grounds = document.createElement('div'); grounds.className = 'uiGrounds';
  const gb = [...card.querySelectorAll('button[data-s]')];
  if (gb.length) { gb[0].before(grounds); grounds.append(...gb); }
  const k = document.createElement('div'); k.className = 'uiKeys';
  k.innerHTML = '<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>or the arrows: drive</span><span><kbd>Space</kbd>handbrake</span><span><kbd>R</kbd>back to the last gate</span><span><kbd>C</kbd>camera</span><span><kbd>H</kbd>every key</span>';
  card.append(k);
  // the lab: once the menu is first closed, its drawer slides in (#331; ⤢ there for the whole screen)
  if (LAB) {
    const open = () => { if (menuOpen()) return; mo.disconnect(); setTimeout(() => { if (!$('aiPanel') || $('aiPanel').style.display !== 'block') $('aiBtn')?.click(); }, 150); };
    const mo = new MutationObserver(open); mo.observe(menu, { attributes: true, attributeFilter: ['style'] });
  }
}

// ---------------------------------------------------------------- the rail
const ITEMS = [
  { id: 'aiBtn', icon: 'brain', label: 'TNN lab', key: 'I', cls: 'tnn' },
  null,
  { id: 'pauseBtn', icon: 'pause', key: 'P', text: true },
  { id: 'replayBtn', icon: 'replay', key: 'Y', text: true },
  { id: 'bestBtn', icon: 'reset', label: 'Reset best lap', key: 'B' },
  null,
  { own: 'garage', icon: 'car', label: 'Track, car and ground', title: 'Choose another track, car or ground' },
  { own: 'setup', icon: 'setup', label: 'Car setup', key: 'U', title: 'The drive and the tires, and what each choice changes' },
  { id: 'paintBtn', icon: 'palette', label: 'Paint', key: 'K' },
  { id: 'wxBtn', icon: 'sun', label: 'Weather', key: 'O', value: t => t },
  { id: 'botBtn', icon: 'flag', label: 'Bots', key: 'N', value: t => t.replace(/^.*:\s*/, '') },
  { id: 'editBtn', icon: 'pencil', label: 'Course editor', key: 'E' },
  null,
  { own: 'sound', icon: 'sound', label: 'Sound', key: 'M', value: true, title: 'The sound on or off (it is remembered)' },
  { own: 'keys', icon: 'keys', label: 'Keys', key: 'H', title: 'Every key' },
  { id: 'brBtn', icon: 'claude', label: 'Claude' },
];
const rail = document.createElement('div'); rail.id = 'uiRail'; rail.className = 'panel';
for (const it of ITEMS) {
  if (!it) { rail.append(document.createElement('hr')); continue; }
  const b = it.el = document.createElement('button'); b.type = 'button';
  b.innerHTML = `${svg(it.icon)}<span class="l">${it.label || ''}</span>${it.value ? '<span class="v"></span>' : ''}${it.key ? `<kbd>${it.key}</kbd>` : ''}`;
  if (it.id) b.dataset.for = it.id;                                     // the button it stands in for (bridge.js places its panel by it)
  if (it.cls) b.classList.add(it.cls);
  if (it.title) b.title = it.title;
  b.addEventListener('click', () => {
    b.blur();
    if (it.own === 'garage') menu.style.display = '';
    else if (it.own === 'keys') helpToggle();
    else if (it.own === 'setup') setupToggle();
    else if (it.own === 'sound') { window.__sim.sound?.set(); sync(); }
    else $(it.id)?.click();
  });
  rail.append(b);
}
document.body.append(rail);
document.body.classList.add('ui-rail');

let home = null;
if (!MP) {
  home = document.createElement('a'); home.id = 'uiHome'; home.className = 'panel'; home.href = HOME; home.title = 'Carsim: the leaderboard, the networks, race rooms';
  home.innerHTML = `${MARK}<span>Carsim</span>`;
  document.body.append(home);
}

// ---------------------------------------------------------------- the car's setup (#332)
// A drawer down the left side (as the lab's; one of the two at a time): which axles drive and how the torque is
// shared between them, the tires' pressure, and what each choice means: the car from above with the grip each tire
// is spending as you drive (the sim's wheels: fx, fy of fm), and the tire model's own figures for the ground under
// the car. The settings, their keeping and the sums are the sim's (__sim.setup, scripts/patches/setup.py).
const S = window.__sim.setup;
const su = { el: null, open: false, sig: '', k: {}, w: {}, liveT: 0, told: false, editing: false };
// in a race room the room's own panel runs down the same side, over the sim: the page is told when a drawer (this
// one, the lab's) is open, moves its panel away, and asks for the drawers to close when its panel comes back
const ROOM = document.body.classList.contains('mp') && parent !== window;
const labOpen = () => $('aiPanel')?.style.display === 'block';
const setupCan = () => !!S && $('editor')?.style.display !== 'block' && !window.__sim.rp?.on && !window.__sim.MP?.spectator;
const pc = v => Math.round(v * 100);
const cm = (m, d = 1) => (m * 100).toFixed(m * 100 >= 9.95 ? 0 : d);
const KMH60 = 60 / 3.6;                                              // the speed the rolling drag is told at
const P_NAMES = ['Soft', 'Standard', 'Hard'];

function setupBuild() {
  const el = su.el = document.createElement('aside'); el.id = 'uiSetup'; el.className = 'panel'; el.inert = true; el.setAttribute('aria-label', 'Car setup');
  const wheel = (k, x, y) => `<g class="wh" data-w="${k}"><rect class="t" x="${x}" y="${y}" width="50" height="17" rx="5.5"/><rect class="d" x="${x + 5}" y="${y + 3.5}" width="0" height="4" rx="2"/><rect class="c" x="${x + 5}" y="${y + 9.5}" width="0" height="4" rx="2"/></g>`;
  el.innerHTML = `<header><div><div class="lt">Car setup</div><div class="sub" data-k="car"></div></div><button class="x" type="button" title="Close (U)" aria-label="Close the car's setup">✕</button></header>
  <svg class="car" viewBox="0 0 320 152" role="img" aria-label="The car from above, its front to the left: the torque on each axle and the grip each tire is spending">
    <path class="body" d="M76 34H262Q286 34 286 58V94Q286 118 262 118H76Q50 113 50 76Q50 39 76 34Z"/>
    <path class="cab" d="M138 46H212Q226 46 226 60V92Q226 106 212 106H138Q126 92 126 76Q126 60 138 46Z"/>
    <line class="ax f" x1="98" y1="40" x2="98" y2="112"/><line class="ax r" x1="236" y1="40" x2="236" y2="112"/>
    <line class="sh f" x1="98" y1="76" x2="167" y2="76"/><line class="sh r" x1="167" y1="76" x2="236" y2="76"/>
    <circle class="diff" cx="167" cy="76" r="5.5"/>
    <text class="pct f" x="108" y="66"></text><text class="pct r" x="226" y="66" text-anchor="end"></text>
    <text class="lab" x="108" y="97">front</text><text class="lab" x="226" y="97" text-anchor="end">rear</text>
    ${wheel('FR', 73, 22)}${wheel('FL', 73, 113)}${wheel('RR', 211, 22)}${wheel('RL', 211, 113)}
    <path class="nose" d="M34 76H20M26 70l-6 6 6 6"/>
  </svg>
  <p class="legend"><span><i class="d"></i>driving or braking</span><span><i class="c"></i>cornering</span><span><i class="l"></i>at its limit</span></p>
  <p class="note">Live as you drive. A tire has one budget of grip: what it spends on driving is not there for cornering.</p>
  <section class="drive">
    <h4><span>Drive</span><b data-k="driveV"></b></h4>
    <div class="seg" data-k="axles"><button type="button" data-awd="0"><b>Rear</b><small>two wheels drive</small></button><button type="button" data-awd="1"><b>All four</b><small>four wheels drive</small></button></div>
    <div class="split" data-k="splitBox">
      <div class="ends"><span>Front <b data-k="f"></b></span><span><b data-k="r"></b> Rear</span></div>
      <div class="range"><i data-k="own" title="The car's own split"></i><input type="range" min="0" max="100" step="5" aria-label="The share of the torque sent to the rear axle"></div>
      <div class="ownRow"><span data-k="ownSay"></span><button type="button" class="link" data-k="ownBtn">Back to its own</button></div>
    </div>
    <p class="say" data-k="driveSay"></p>
  </section>
  <section class="tires">
    <h4><span>Tires</span><b data-k="tireV"></b></h4>
    <div class="seg" data-k="pSeg"></div>
    <table class="fig" data-k="fig"></table>
    <p class="cap" data-k="figCap"></p>
    <p class="say" data-k="tireSay"></p>
  </section>
  <footer>Kept for this car in this browser, wherever you drive it. A network learns the car as it is set up: after a change, its best lap is driven again.<span class="k"><kbd>4</kbd> drive <kbd>Shift</kbd><kbd>P</kbd> tires <kbd>U</kbd> this drawer</span></footer>`;
  document.body.append(el);
  for (const n of el.querySelectorAll('[data-k]')) su.k[n.dataset.k] = n;
  for (const g of el.querySelectorAll('.wh')) su.w[g.dataset.w] = { g, d: g.querySelector('.d'), c: g.querySelector('.c'), dv: 0, cv: 0 };
  const range = su.range = el.querySelector('input[type=range]');
  el.querySelector('.x').addEventListener('click', () => setupToggle(false));
  // (everything lets go of the focus once used: Space and the arrows are the car's)
  su.k.axles.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; b.blur(); S.drive(b.dataset.awd === '1'); setupSync(); });
  su.k.pSeg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; b.blur(); S.pressure(+b.dataset.p); setupSync(); });
  su.k.ownBtn.addEventListener('click', e => { e.currentTarget.blur(); S.split(S.get().ownSplit); setupSync(); });
  // while a network trains, each change starts its training again: the slider then sets the split when let go
  range.addEventListener('input', () => { if (!window.__sim.ai?.training) S.split(1 - range.value / 100); setupSync(1 - range.value / 100); });
  range.addEventListener('change', () => { S.split(1 - range.value / 100); range.blur(); setupSync(); });
}

function driveSay(s, f) {
  if (!s.awd) return s.awdFixed
    ? 'Rear-wheel drive, with nothing to set: this car has no shaft to its front axle. The front tires only steer, the rear ones take all the torque, and the tail steps out when you ask too much of them.'
    : 'The rear wheels push and the front ones only steer. Lively, and the easiest to bog down on loose ground: two tires dig where four would share the work.';
  const w = ` Standing still, the front axle carries ${pc(s.frontWeight)} % of this car's weight; hard acceleration moves weight to the rear.`;
  if (f <= 0) return 'Everything to the rear: it drives as a rear-wheel-drive car. The front tires keep all their grip for steering; the rear ones spin first, and the tail steps out on throttle.' + w;
  if (f < 0.3) return 'Mostly to the rear: the car turns in sharply and tightens its line on throttle. Ask too much and the rear slides before the front; from a standstill it has less traction than an even split.' + w;
  if (f < 0.5) return 'A little more to the rear, close to how the weight sits while the car accelerates: the four tires work about as hard as each other. Strong traction, and it still turns on throttle.' + w;
  if (f === 0.5) return 'Even: the most traction from a standstill and on loose ground. In a corner the front tires drive as hard as the rear ones, so on throttle the car pushes wide (understeer).' + w;
  if (f < 1) return 'Mostly to the front: the car pulls itself straight and is hard to spin. But the front tires steer and do most of the driving: on throttle it pushes wide, and they are the first to spin.' + w;
  return 'Everything to the front: it drives as a front-wheel-drive car. Stable, and it pushes wide on throttle: the front tires steer and drive, and they lose weight when the car accelerates.' + w;
}
function tireSay(s, F) {
  const lo = F[0], hi = F[F.length - 1], g = lo.ground.toLowerCase(), mm = Math.round((lo.squash - hi.squash) * 1000);
  const kw = f => Math.round(f.drag * KMH60 / 1000), grip = (lo.grip / hi.grip - 1) * 100, soft = hi.sink - lo.sink >= 0.01;
  if (lo.rigid) return `On ${g} the sim's tire grips the same at every pressure: its model was made for soft ground, where the pressure decides how deep the tire sinks, and ${g} does not give. Only the squash changes: soft sits ${mm} mm lower than hard, so each gear is about ${((1 - lo.radius / hi.radius) * 100).toFixed(0)} % shorter.`;
  return `${soft ? `On ${g} this is the big setting. A soft tire floats` : `On ${g} the ground is firm and the tire sinks little, but it still counts. A soft tire spreads the car's weight`}: its patch is longer and wider, so it sinks ${cm(lo.sink)} cm where a hard one sinks ${cm(hi.sink)}, and ploughs less. `
    + `At 60 km/h, rolling over fresh ${g} takes ${kw(lo)} kW soft and ${kw(hi)} kW hard, of this engine's ${Math.round(s.power)} kW.`
    + `${grip >= 1.5 ? ` The bigger patch also holds better: about ${Math.round(grip)} % more grip than hard.` : ' The grip itself hardly changes (under 1 %).'} The price of soft: the car sits ${mm} mm lower${soft ? ' over the ruts' : ''}.`;
}

// what the drawer shows, written again only when it changes (f: a split being dragged, not set yet)
function setupSync(f) {
  if (!su.open) return;
  const s = S.get(), F = s.pressures.map((_, i) => S.figures(i)), k = su.k;
  if (f == null) f = s.split;
  const sig = JSON.stringify([s, F, f]);
  if (sig === su.sig) return; su.sig = sig;
  const P = s.pressures[s.p], shown = s.awd ? f : 0;
  k.car.textContent = `${s.name} · on ${F[0].ground.toLowerCase()}`;
  // the drive
  k.driveV.textContent = s.awd ? `${pc(f)} / ${pc(1 - f)}` : 'Rear';
  k.axles.hidden = s.awdFixed;
  for (const b of k.axles.children) b.classList.toggle('on', (b.dataset.awd === '1') === s.awd);
  k.splitBox.hidden = !s.awd;
  k.f.textContent = `${pc(f)} %`; k.r.textContent = `${pc(1 - f)} %`;
  if (document.activeElement !== su.range) su.range.value = pc(1 - f);
  su.range.style.setProperty('--at', pc(1 - f) + '%');
  k.own.style.left = `calc(9px + (100% - 18px) * ${1 - s.ownSplit})`;
  k.ownSay.textContent = f === s.ownSplit ? `The car's own split` : `Its own: ${pc(s.ownSplit)} / ${pc(1 - s.ownSplit)}`;
  k.ownBtn.hidden = f === s.ownSplit;
  k.driveSay.textContent = driveSay(s, f);
  su.el.querySelector('.pct.f').textContent = `${pc(shown)}%`; su.el.querySelector('.pct.r').textContent = `${pc(1 - shown)}%`;
  su.el.querySelector('.car').style.setProperty('--f', shown); su.el.querySelector('.car').style.setProperty('--r', 1 - shown);
  // the tires
  k.tireV.textContent = `${P.psi} psi · ${(P.kpa / 100).toFixed(1)} bar`;
  k.pSeg.innerHTML = s.pressures.map((p, i) => `<button type="button" data-p="${i}"${i === s.p ? ' class="on"' : ''}><b>${p.psi}<i> psi</i></b><small>${P_NAMES[i] ?? ''}${i === s.ownP ? ' · its own' : ''}</small></button>`).join('');
  const col = (fn) => F.map((x, i) => `<td${i === s.p ? ' class="on"' : ''}>${fn(x)}</td>`).join('');
  k.fig.innerHTML = `<tr><th></th>${F.map((x, i) => `<th${i === s.p ? ' class="on"' : ''}>${x.psi} psi</th>`).join('')}</tr>`
    + `<tr><th>Contact patch</th>${col(x => `${Math.round(x.length * 100)} × ${Math.round(x.width * 100)} cm`)}</tr>`
    + `<tr><th>Sinks</th>${col(x => x.rigid ? '0' : `${cm(x.sink)} cm`)}</tr>`
    + `<tr><th>Rolling drag</th>${col(x => `${(x.drag * KMH60 / 1000).toFixed(1)} kW`)}</tr>`
    + `<tr><th>Sits lower by</th>${col(x => `${Math.round(x.squash * 1000)} mm`)}</tr>`;
  k.figCap.textContent = `The sim's tire model, this car at rest on ${F[0].rigid ? '' : 'fresh '}${F[0].ground.toLowerCase()}, the ground under it now. Patch: length × width. Drag: the four tires at 60 km/h.`;
  k.tireSay.textContent = tireSay(s, F);
}

// the grip each tire is spending, a few times a second while the drawer is open
function setupLive(now) {
  if (!su.open) return;
  requestAnimationFrame(setupLive);
  if (now - su.liveT < 70) return; su.liveT = now;
  for (const W of window.__sim.car.wheels) {
    const o = su.w[(W.front ? 'F' : 'R') + (W.hp.x > 0 ? 'L' : 'R')]; if (!o) continue;
    const fm = W.contact && W.fm > 1 ? W.fm : 0, d = fm ? Math.min(1, Math.abs(W.fx || 0) / fm) : 0, c = fm ? Math.min(1, Math.abs(W.fy || 0) / fm) : 0;
    o.dv += (d - o.dv) * 0.5; o.cv += (c - o.cv) * 0.5;
    o.d.setAttribute('width', (40 * o.dv).toFixed(1)); o.c.setAttribute('width', (40 * o.cv).toFixed(1));
    o.g.classList.toggle('lim', !!fm && (Math.hypot(d, c) > 0.97 || W.slide > 0.3)); o.g.classList.toggle('air', !W.contact);
  }
}

function setupToggle(on = !su.open) {
  if (on === su.open || (on && !setupCan())) return;
  if (!su.el) setupBuild();
  if (on && labOpen()) $('aiBtn')?.click();                           // one drawer down that side at a time
  su.open = on; su.el.classList.toggle('open', on); su.el.inert = !on; document.body.classList.toggle('ui-setup', on);
  if (on) { su.sig = ''; setupSync(); requestAnimationFrame(setupLive); }
}
if (ROOM) addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== parent) return;
  if (e.data?.t === 'mute') { window.__sim.sound?.set(); sync(); }             // (M pressed in the room's own panel, #343)
  if (e.data?.t !== 'drawers' || !e.data.close) return;
  setupToggle(false); if (labOpen()) $('aiBtn')?.click();
});
addEventListener('keydown', e => {
  if (e.code === 'Escape' && su.open) { setupToggle(false); return; }
  if (e.code !== 'KeyU' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && t !== su.range) return;
  if (!su.open && (menuOpen() || $('aiPanel')?.classList.contains('big'))) return;
  setupToggle();
});

function sync() {
  for (const it of ITEMS) {
    if (!it) continue;
    const b = it.el;
    if (it.own) {
      b.hidden = it.own === 'garage' ? MP : it.own === 'setup' ? !setupCan() : it.own === 'sound' && !window.__sim.sound;
      if (it.own === 'sound' && !b.hidden) {                          // (the sim's own switch, M: #343)
        const off = window.__sim.sound.muted(), v = b.querySelector('.v'), t = off ? 'Off' : 'On';
        if (v.textContent !== t) { v.textContent = t; b.querySelector('svg').innerHTML = ICON[off ? 'soundOff' : 'sound']; b.classList.toggle('off', off); }
      }
      if (it.own === 'keys') b.classList.toggle('on', helpOpen()); else if (it.own === 'setup') b.classList.toggle('on', su.open);
      continue;
    }
    const o = $(it.id), show = !!o && getComputedStyle(o).display !== 'none';
    b.hidden = !show;
    if (!show) continue;
    const t = plain(o.textContent);
    if (it.text) { const l = b.querySelector('.l'); if (l.textContent !== t) l.textContent = t; }
    if (it.value) { const v = b.querySelector('.v'), s = it.value(t); if (v.textContent !== s) v.textContent = s; }
    b.classList.toggle('on', o.classList.contains('on'));
    if (!it.title && o.title && b.title !== o.title) b.title = o.title;
  }
  // a separator with nothing shown after it (or before it) is not drawn
  let seen = false, pending = null;
  for (const n of rail.children) {
    if (n.tagName === 'HR') { n.hidden = true; if (seen) pending = n; continue; }
    if (n.hidden) continue;
    if (pending) { pending.hidden = false; pending = null; }
    seen = true;
  }
  // under the minimap, and under whatever the sim has put under it (a room's best laps, the network's pedals)
  const m = $('mapWrap').getBoundingClientRect(); let top = m.bottom + 10;
  for (const id of ['bestLaps', 'aiCtl']) {
    const r = $(id)?.getBoundingClientRect();
    if (r && r.width && r.right > innerWidth - 230 && r.top >= m.bottom - 4) top = Math.max(top, r.bottom + 10);
  }
  const d = $('dmgWrap').getBoundingClientRect(), room = (d.height ? d.top : innerHeight) - top - 10;
  rail.style.top = top + 'px'; rail.style.maxHeight = Math.max(72, room) + 'px';
  rail.style.display = m.width && !$('aiPanel')?.classList.contains('big') ? '' : 'none';
  document.body.style.setProperty('--ui-rail-top', top + 'px');
  const editing = $('editor')?.style.display === 'block';
  document.body.classList.toggle('ui-edit', editing);
  // the course editor moves beside the lab's drawer (ui.css, #339); a window too narrow for both: the lab makes way for it
  if (editing && !su.editing && labOpen() && !$('aiPanel').classList.contains('big') && innerWidth < 720) $('aiBtn')?.click();
  su.editing = editing;
  if (su.open && (labOpen() || !setupCan())) setupToggle(false);                 // (the lab opened over it; a replay, the editor)
  else if (su.open) setupSync();
  if (ROOM && su.told !== (su.open || labOpen())) parent.postMessage({ t: 'drawer', open: su.told = su.open || labOpen() }, location.origin);
  if (home) home.hidden = labOpen() || su.open || menuOpen();                    // the drawers run down that side
}
sync();
setInterval(sync, 200);
