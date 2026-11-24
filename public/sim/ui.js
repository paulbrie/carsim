// Carsim's interface for the sim's own page (ticket #320), over what the sim builds itself: ui.css is the look,
// this is what a stylesheet can't do.
//   - the rail under the minimap: one stand-in for each of the sim's buttons (Pause, Replay, Paint, Bots…), with its
//     key; the sim's own buttons stay in the page, off the screen, as its scripts measure and relabel them: a
//     stand-in copies its button's label, state and whether it shows, and clicks it;
//   - the keys: the sim's #help laid out as a sheet, closed until asked for (H, or the rail's Keys);
//   - the start menu's frame, and the menu again from the rail (Track, car and ground);
//   - the way home, and ?lab=1: the TNN lab's drawer opens once a car and a ground are picked (⤢ makes it full screen).
// It changes nothing in the sim: without this file the page is the sim as it was.
const ICON = {"brain": "<path d=\"M12 18V5\"/><path d=\"M15 13a4.17 4.17 0 01-3-4 4.17 4.17 0 01-3 4\"/><path d=\"M17.707 6.294A3 3 0 1012 5a3 3 0 10-5.707 1.294\"/><path d=\"M17.996 5.125a4 4 0 012.526 5.77\"/><path d=\"M18 18a4 4 0 002-7.465\"/><path d=\"M19.967 17.482a4 4 0 11-7.967.517 4 4 0 11-7.967-.517\"/><path d=\"M6 18a4 4 0 01-2-7.465\"/><path d=\"M6.004 5.125a4 4 0 00-2.526 5.77\"/>", "pause": "<rect x=\"14\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\"/><rect x=\"5\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\"/>", "play": "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\"/>", "replay": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/><path d=\"M3 3v5h5\"/>", "reset": "<path d=\"M10 2h4\"/><path d=\"M12 14v-4\"/><path d=\"M4 13a8 8 0 0 1 8-7 8 8 0 1 1-5.3 14L4 17.6\"/><path d=\"M9 17H4v5\"/>", "car": "<path d=\"m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8\"/><path d=\"M7 14h.01\"/><path d=\"M17 14h.01\"/><rect width=\"18\" height=\"8\" x=\"3\" y=\"10\" rx=\"2\"/><path d=\"M5 18v2\"/><path d=\"M19 18v2\"/>", "palette": "<path d=\"M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z\"/><circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>", "sun": "<path d=\"M12 2v2\"/><path d=\"m4.93 4.93 1.41 1.41\"/><path d=\"M20 12h2\"/><path d=\"m19.07 4.93-1.41 1.41\"/><path d=\"M15.947 12.65a4 4 0 0 0-5.925-4.128\"/><path d=\"M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z\"/>", "flag": "<path d=\"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528\"/>", "pencil": "<path d=\"M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13\"/><path d=\"m8 6 2-2\"/><path d=\"m18 16 2-2\"/><path d=\"m17 11 4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17\"/><path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"/><path d=\"m15 5 4 4\"/>", "keys": "<path d=\"M10 8h.01\"/><path d=\"M12 12h.01\"/><path d=\"M14 8h.01\"/><path d=\"M16 12h.01\"/><path d=\"M18 8h.01\"/><path d=\"M6 8h.01\"/><path d=\"M7 16h10\"/><path d=\"M8 12h.01\"/><rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\"/>", "claude": "<path d=\"m11 17 2 2a1 1 0 1 0 3-3\"/><path d=\"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4\"/><path d=\"m21 3 1 11h-2\"/><path d=\"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3\"/><path d=\"M3 4h8\"/>", "home": "<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"/><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>", "x": "<path d=\"M18 6 6 18\"/><path d=\"m6 6 12 12\"/>", "users": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><path d=\"M16 3.128a4 4 0 0 1 0 7.744\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/>"};
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
  { id: 'paintBtn', icon: 'palette', label: 'Paint', key: 'K' },
  { id: 'wxBtn', icon: 'sun', label: 'Weather', key: 'O', value: t => t },
  { id: 'botBtn', icon: 'flag', label: 'Bots', key: 'N', value: t => t.replace(/^.*:\s*/, '') },
  { id: 'editBtn', icon: 'pencil', label: 'Course editor', key: 'E' },
  null,
  { own: 'keys', icon: 'keys', label: 'Keys', key: 'H', title: 'Every key' },
  { id: 'brBtn', icon: 'claude', label: 'Claude' },
];
const rail = document.createElement('div'); rail.id = 'uiRail'; rail.className = 'panel';
for (const it of ITEMS) {
  if (!it) { rail.append(document.createElement('hr')); continue; }
  const b = it.el = document.createElement('button'); b.type = 'button';
  b.innerHTML = `${svg(it.icon)}<span class="l">${it.label || ''}</span>${it.value ? '<span class="v"></span>' : ''}${it.key ? `<kbd>${it.key}</kbd>` : ''}`;
  if (it.cls) b.classList.add(it.cls);
  if (it.title) b.title = it.title;
  b.addEventListener('click', () => {
    b.blur();
    if (it.own === 'garage') menu.style.display = '';
    else if (it.own === 'keys') helpToggle();
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

function sync() {
  for (const it of ITEMS) {
    if (!it) continue;
    const b = it.el;
    if (it.own) { b.hidden = it.own === 'garage' && MP; if (it.own === 'keys') b.classList.toggle('on', helpOpen()); continue; }
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
  document.body.classList.toggle('ui-edit', $('editor')?.style.display === 'block');
  if (home) home.hidden = $('aiPanel')?.style.display === 'block' || menuOpen();   // the lab's column runs down that side
}
sync();
setInterval(sync, 200);
