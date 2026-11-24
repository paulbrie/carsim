# The tracks (#329): driving alone (/drive, the lab), the start menu's first row is the race rooms' maps, from the
# server (/api/tracks: no sign-in), and the course this browser had of its own ("Your course": the editor's, the
# generator's). Picking one builds it at once, on the ground of the moment; it stays the sim's course (a reload keeps
# it), and the browser's own is kept aside (carsim.course.mine) to come back to. Which track the sim is on: the one it
# last loaded while the course is still that (its courseKey), or any whose key it has. A browser that never had a
# course of its own starts on the rooms' figure-8 (the server's, which may differ from the sim's built-in one).
# Not in a race room or the map editor (MP.on / MP.edit: their page picks the course), nor the autopilot's workers.
# Applies to public/sim/engine.js after the other patches (last in the chain):
#   python3 scripts/patches/tracks.py <dir with engine.js and index.html>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep, encoding='utf-8').read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

rep("""document.querySelectorAll('#menu button[data-s]').forEach(bt => bt.addEventListener('click', () => {
  setSurface(bt.dataset.s); document.getElementById('menu').style.display = 'none'; startAudio();
}));
""", """document.querySelectorAll('#menu button[data-s]').forEach(bt => bt.addEventListener('click', () => {
  setSurface(bt.dataset.s); document.getElementById('menu').style.display = 'none'; startAudio();
}));

// ---------- the tracks (#329): the race rooms' maps, to drive alone (the start menu's first row) ----------
// TRK.list: the server's ([{ id, name, v, key, wp, length, bridges }]; null until it answers, [] if it can't);
// carsim.track: { id, key } the track last loaded (key: courseKey() then); carsim.course.mine: this browser's own
// course, kept while it drives a track. (Not 'sandbuggy.': the autopilot's workers boot with a copy of those.)
const TRK = { list: null, busy: '', el: null, fresh: false };
const TRK_API = location.pathname.replace(/\\/sim\\/[^/]*$/, '') + '/api/tracks';
const trkGet = (k, d = null) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (e) { return d; } };
const trkSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
// the track the sim is on ('': its own course)
function trkNow() {
  const k = courseKey(), st = trkGet('carsim.track');
  if (st && st.key === k && (!TRK.list || TRK.list.some(t => t.id === st.id))) return st.id;
  return TRK.list?.find(t => t.key === k)?.id ?? '';
}
// this browser's own course: the sim's, if it is on no track; else the one kept aside
const trkMine = () => !trkNow() ? COURSE : trkGet('carsim.course.mine');
// a course as COURSE (checked as the editor's Import does), on the ground the sim is on
function trkCourse(c) {
  const pts = a => Array.isArray(a) ? a.filter(b => b && isFinite(b.x) && isFinite(b.z)).map(b => ({ x: +b.x, z: +b.z })) : [];
  const C = c && Array.isArray(c.wp) && c.wp.length >= 3
    ? { wp: c.wp.map(([x, z]) => [+x, +z]), bank: bankOf(c.bank), level: levelOf(c.level), even: evenOf(c.even), grade: gradeOf(c.grade), ops: Array.isArray(c.ops) ? c.ops : [], bridges: pts(c.bridges), noBridge: pts(c.noBridge) }
    : { wp: DEFAULT_WP.map(p => p.slice()), ops: [], bridges: [], noBridge: [] };
  C.base = ROAD || SURF === SURFACES.earth ? 'earth' : 'sand'; C.road = ROAD;
  return C;
}
// drive track id ('': this browser's own course), built now
async function trkPick(id) {
  if (TRK.busy || ed.on || id === trkNow()) return;
  const t = TRK.list?.find(x => x.id === id);
  if (id && !t) return;
  TRK.busy = id || 'mine'; trkShow();
  try {
    let c;
    if (id) {
      const r = await fetch(`${TRK_API}/${encodeURIComponent(id)}?v=${t.v}`);
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || `${r.status} ${r.statusText}`);
      c = b.track.course;
    } else if (!(c = trkGet('carsim.course.mine'))) return;
    if (ed.on) return;
    if (id && !trkNow() && !TRK.fresh && !trkSet('carsim.course.mine', COURSE)) { flash('Browser storage is full: Export your course first (course editor)', '#ff8a7a', 3); return; }
    COURSE = trkCourse(c); SURF = SURFACES[COURSE.base];
    saveCourse(); trkSet('carsim.track', id ? { id, key: courseKey() } : null);
    await new Promise(r => setTimeout(r, 20));                         // (the card says so before the build holds the page)
    clearSkids(); regenerateWorld();
    if (document.getElementById('menu').style.display === 'none') flash(id ? t.name : 'Your course', '#7dff9a', 1.8);   // (in the menu: its card says so)
  } catch (e) { console.warn('tracks:', e); flash(`That track could not load: ${e.message}`, '#ff8a7a', 3); }
  finally { TRK.busy = ''; TRK.fresh = false; trkShow(); }
}
// a course's outline, as the minimap draws it (+x to the left, +z up): a closed curve through its waypoints
function trkSvg(wp) {
  const W = 120, H = 72, pad = 7, P0 = wp.map(([x, z]) => [-x, -z]);
  const xs = P0.map(p => p[0]), ys = P0.map(p => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys);
  const k = Math.min((W - 2 * pad) / Math.max(1, Math.max(...xs) - x0), (H - 2 * pad) / Math.max(1, Math.max(...ys) - y0));
  const ox = (W - (Math.max(...xs) - x0) * k) / 2, oy = (H - (Math.max(...ys) - y0) * k) / 2;
  const P = P0.map(([x, y]) => [ox + (x - x0) * k, oy + (y - y0) * k]), n = P.length, f = v => v.toFixed(1);
  let d = `M${f(P[0][0])} ${f(P[0][1])}`;
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n], e = P[(i + 2) % n];
    d += `C${f(b[0] + (c[0] - a[0]) / 6)} ${f(b[1] + (c[1] - a[1]) / 6)} ${f(c[0] - (e[0] - b[0]) / 6)} ${f(c[1] - (e[1] - b[1]) / 6)} ${f(c[0])} ${f(c[1])}`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}Z" class="bed"/><path d="${d}Z" class="ln"/><circle cx="${f(P[0][0])}" cy="${f(P[0][1])}" r="3.2" class="st"/></svg>`;
}
const trkLen = wp => wp.reduce((d, p, i) => d + Math.hypot(wp[(i + 1) % wp.length][0] - p[0], wp[(i + 1) % wp.length][1] - p[1]), 0);
const trkKm = m => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
// the menu's row: the tracks, then this browser's own course (if it has one apart from them)
function trkShow() {
  if (!TRK.el) return;
  const grid = TRK.el.querySelector('.trkGrid'), now = trkNow(), mine = trkMine(), note = TRK.el.querySelector('p');
  if (!TRK.list) { grid.innerHTML = '<span class="trkWait">Loading the tracks…</span>'; return; }
  const cards = TRK.list.map(t => ({ id: t.id, name: t.name, wp: t.wp, sub: `${trkKm(t.length)}${t.bridges ? ` · ${t.bridges} bridge${t.bridges > 1 ? 's' : ''}` : ''}` }));
  if (mine?.wp?.length >= 3) cards.push({ id: '', name: 'Your course', wp: mine.wp, sub: `${trkKm(trkLen(mine.wp))} · the course editor's`, own: true });
  grid.innerHTML = cards.map(c => `<button type="button" class="trk${c.id === now ? ' on' : ''}${c.own ? ' own' : ''}" data-t="${c.id}"${TRK.busy ? ' disabled' : ''}>${trkSvg(c.wp)}<b></b><small>${TRK.busy === (c.id || 'mine') ? 'Building the track…' : c.sub}</small></button>`).join('');
  grid.querySelectorAll('button').forEach((b, i) => { b.querySelector('b').textContent = cards[i].name; b.addEventListener('click', () => { b.blur(); trkPick(b.dataset.t); }); });
  note.textContent = TRK.list.length ? 'The race rooms\\' tracks, and yours from the course editor. Each keeps its own best laps and trainings.' : 'The tracks could not be loaded: this is the course in this browser (E edits it).';
}
async function trkLoad() {
  try {
    const r = await fetch(TRK_API), b = await r.json();
    if (!r.ok || !Array.isArray(b.tracks)) throw new Error(b.error || r.status);
    TRK.list = b.tracks;
  } catch (e) { console.warn('tracks:', e); TRK.list = TRK.list || []; }
  trkShow();
  // never a course of its own: the rooms' figure-8, as the leaderboard has it (while the menu is still up)
  if (TRK.fresh && document.getElementById('menu').style.display !== 'none' && TRK.list.some(t => t.id === 'figure-8') && !trkNow()) trkPick('figure-8');
  else TRK.fresh = false;
}
if (!MP.on && !MP.edit && !AI_WK) {                                // (not the autopilot's workers: no page, their course is the tab's)
  const menu = document.getElementById('menu'), card = menu.querySelector('.card');
  TRK.el = document.createElement('div'); TRK.el.id = 'trkSec';
  TRK.el.innerHTML = `<h2>${MPQ.get('lab') === '1' ? 'Choose the track it learns' : 'Choose the track'}</h2><p></p><div class="trkGrid"></div>`;
  card.querySelector('h2')?.before(TRK.el);
  TRK.fresh = !localStorage.getItem('sandbuggy.course') && !trkGet('carsim.track');
  trkLoad();
  // the menu again (the rail's Track, car and ground): the list as it is now
  let was = menu.style.display;
  new MutationObserver(() => { const d = menu.style.display; if (d !== 'none' && was === 'none') trkLoad(); was = d; }).observe(menu, { attributes: true, attributeFilter: ['style'] });
}
""")
open(ep, 'w', encoding='utf-8').write(s)
print('tracks patched')
