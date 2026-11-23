// Claude bridge, the sim's side: a Claude session working in this page, seen by the user (lib/bridge/store.mjs has
// the server's side and the plan; scripts/bridge.mjs, the agent's). The super admin only: the 🤝 Claude button shows
// for them. Connect shows a 6-digit code; the agent claims it and sends commands, carried out here and logged in the
// panel; the user can write to it; Disconnect ends it. A reload keeps the pairing (this tab's sessionStorage).
//
// Commands (type → args → data):
//   state      {}                          → the sim at a glance: car, lap, autopilot, race, what the panels say
//   screenshot {maxWidth?, quality?}       → { dataUrl } (the 3D view as drawn, JPEG; not the HTML panels over it)
//   text       {selector?, max?}           → { text } (what an element shows, the page by default)
//   click      {selector? | text?, nth?}   → { clicked } (a button, a checkbox, a summary… by CSS or by its text)
//   set        {selector, value}           → { set } (an input: its value, or a checkbox ticked; change fired)
//   key        {code, ms?}                 → {} (a key pressed, held ms: KeyW, ArrowLeft, KeyI…)
//   sim        {fn, args?}                 → what it returns (a few of window.__sim's functions, by name: SIM_FNS)
//   get        {path, slice?, pick?}       → its value (window.__sim's, e.g. "ai.hist", "lap.best", "VEH.key"; read only; a list:
//                                            slice [from, to], and of its items the fields picked)
//   reload     {}                          → {} (then the page reloads, and pairs again by itself)
// No arbitrary JavaScript; never the bridge's own panel, password fields, or the app's API.
const BASE = location.pathname.replace(/\/sim\/[^/]*$/, ''), API = BASE + '/api/bridge/page';
const SIM_FNS = ['restartRun', 'respawn', 'switchVehicle', 'setSurface', 'setCamMode', 'placeAtGate', 'step', 'toggleEditor', 'setBots',
  'aiTrainSync', 'aiTry', 'aiDrive', 'aiDemo', 'aiSaveServer', 'aiForget', 'repairCar', 'startReplay', 'stopReplay'];
const KEEP = 'carsim.bridge';
const st = { pageId: null, token: null, es: null, agent: null, code: null, codeUntil: 0, log: [], shot: null, el: null, btn: null };
const S = () => window.__sim;

// ---------------------------------------------------------------- talking to the server
async function post(path, body = {}) {
  const r = await fetch(API + path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-bridge-page': st.token || '' }, body: JSON.stringify({ pageId: st.pageId, ...body }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(b.error || `${r.status}`); e.status = r.status; throw e; }
  return b;
}
function keep() { try { st.pageId ? sessionStorage.setItem(KEEP, JSON.stringify({ pageId: st.pageId, token: st.token })) : sessionStorage.removeItem(KEEP); } catch (e) { } }
function listen() {
  st.es?.close();
  const es = st.es = new EventSource(`${API}/stream?pageId=${encodeURIComponent(st.pageId)}&t=${encodeURIComponent(st.token)}`);
  es.addEventListener('status', e => { const d = JSON.parse(e.data); st.agent = d.agent; st.code = d.code; st.codeUntil = d.codeUntil || 0; show(); });
  es.addEventListener('command', e => run(JSON.parse(e.data)));
  es.addEventListener('ended', e => { const d = JSON.parse(e.data); end(`Pairing ended: ${d.why}`); });
  es.onerror = () => { if (st.pageId) show('reconnecting…'); };
  es.onopen = () => { post('/hello', { url: location.href, title: document.title }).catch(() => { }); show(); };
}
async function connect() {
  try { Object.assign(st, (({ pageId, pageToken, code, expiresAt }) => ({ pageId, token: pageToken, code, codeUntil: expiresAt }))(await post('/pair')), { agent: null }); }
  catch (e) { note(`Could not pair: ${e.message}`); return; }
  keep(); listen(); note('Waiting for Claude: give it the code'); show();
}
function end(why) {
  st.es?.close(); st.es = null;
  Object.assign(st, { pageId: null, token: null, agent: null, code: null });
  keep(); if (why) note(why); show();
}
async function disconnect() { try { await post('/close'); } catch (e) { } end('Disconnected'); }

// ---------------------------------------------------------------- the commands
async function run({ id, type, args = {}, agent }) {
  const line = `${type}${Object.keys(args).length ? ' ' + JSON.stringify(args).slice(0, 80) : ''}`;
  note(`▸ ${agent || 'Claude'}: ${line}`);
  let res;
  try {
    if (!Object.hasOwn(COMMANDS, type)) throw new Error(`No such command: ${type} (${Object.keys(COMMANDS).join(', ')})`);
    res = { ok: true, data: (await COMMANDS[type](args)) ?? {} };
  }
  catch (e) { res = { ok: false, error: e.message || String(e) }; note(`  ✕ ${res.error}`); }
  try { await post('/result', { id, ...res }); } catch (e) { note(`  ✕ could not answer: ${e.message}`); }
  if (type === 'reload' && res.ok) setTimeout(() => location.reload(), 100);
}
const mine = el => !el || st.el?.contains(el) || st.btn?.contains(el);
function find({ selector, text, nth = 0 }) {
  let els = [];
  if (selector) els = [...document.querySelectorAll(selector)];
  else if (text) {
    const t = String(text).toLowerCase();
    els = [...document.querySelectorAll('button, summary, label, a, [role=button], input[type=checkbox]')]
      .filter(e => (e.textContent || e.value || '').trim().toLowerCase().includes(t));
  } else throw new Error('Give a selector or a text');
  els = els.filter(e => !mine(e) && !(e.type === 'password'));
  const el = els[nth | 0];
  if (!el) throw new Error(`Nothing matches ${selector ? 'selector ' + selector : '"' + text + '"'}`);
  return el;
}
const flashEl = el => { try { el.animate([{ outline: '3px solid #ff5a00', outlineOffset: '2px' }, { outline: '3px solid transparent', outlineOffset: '6px' }], { duration: 700 }); } catch (e) { } };
const desc = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.textContent || el.value || '').trim().slice(0, 40)}"`;
// a value fit to send: plain data only (vectors as {x,y,z}), lists cut to 300, 4 levels deep
function plain(v, d = 0) {
  if (v == null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return typeof v === 'number' && !Number.isFinite(v) ? null : v;
  if (typeof v === 'function') return undefined;
  if (ArrayBuffer.isView(v)) return Array.from(v.slice(0, 300), x => Math.round(x * 1e4) / 1e4);
  if (v.isVector3 || v.isVector2 || v.isQuaternion) return { x: v.x, y: v.y, ...(v.z !== undefined ? { z: v.z } : {}), ...(v.w !== undefined ? { w: v.w } : {}) };
  if (v.isObject3D || v.isMaterial || v.isTexture || v.isBufferGeometry || v instanceof Node) return `[${v.type || v.constructor?.name || 'object'}]`;
  if (d >= 4) return '…';
  if (Array.isArray(v)) return v.slice(0, 300).map(x => plain(x, d + 1));
  const o = {}; for (const k of Object.keys(v).slice(0, 80)) { const x = plain(v[k], d + 1); if (x !== undefined) o[k] = x; }
  return o;
}
const text = sel => document.querySelector(sel)?.innerText?.trim() || '';
const COMMANDS = {
  state() {
    const s = S(); if (!s) throw new Error('The sim is still loading');
    const c = s.car, A = s.ai, C = s.COURSE();
    return {
      url: location.href, visible: document.visibilityState, race: s.MP?.on ? { phase: s.MP.phase, laps: s.MP.laps } : null,
      vehicle: s.VEH.key, ground: C.road ? 'road' : C.base, editor: s.ed.on, paused: s.paused,
      car: { kmh: Math.round(c.vel.length() * 36) / 10, pos: [c.pos.x, c.pos.y, c.pos.z].map(v => Math.round(v * 10) / 10), condition: Math.round(s.carCondition() * 100), wrecked: !!c.wrecked },
      lap: { lapNo: s.lap.lapNo, started: s.lap.started, time: +s.lap.time.toFixed(2), last: s.lap.last, best: s.lap.best },
      autopilot: A && { open: A.open, training: A.training, drive: A.drive, watch: !!A.watch, gen: A.gen, weights: A.np, hidden: A.h, inputs: A.inputs, handbrake: A.hb, keyPedals: A.kp, keySteering: A.ks, noBrake: A.nb,
        bestFit: Math.round(A.bestFit), bestLap: A.bestLap, sinceBest: A.sinceBest, lastExam: A.lastExam || null, hist: (A.hist || []).slice(-12), rate: A.rate },
      panels: { timer: text('#timer'), autopilot: text('#aiStat'), toast: text('#toast') },
    };
  },
  screenshot({ maxWidth = 960, quality = 0.8 } = {}) {
    const s = S(), r = s?.renderer;
    if (!r) throw new Error('No renderer yet');
    if (document.hidden) throw new Error('The tab is in the background: it draws nothing until it is in front');
    hook(r);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { st.shot = null; reject(new Error('No frame drawn within 3 s')); }, 3000);
      st.shot = { maxWidth, quality, done: d => { clearTimeout(t); resolve(d); }, fail: e => { clearTimeout(t); reject(e); } };
    });
  },
  text({ selector = 'body', max = 4000 } = {}) {
    const el = document.querySelector(selector); if (!el || mine(el)) throw new Error(`Nothing matches ${selector}`);
    return { text: (el.innerText || '').trim().slice(0, max) };
  },
  click(a) { const el = find(a), what = desc(el); flashEl(el); el.click(); return { clicked: what }; },
  set({ selector, value }) {
    const el = find({ selector });
    if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA') throw new Error(`${desc(el)} is not a field`);
    if (el.type === 'checkbox') el.checked = !!value; else el.value = String(value);
    flashEl(el);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    return { set: desc(el), value: el.type === 'checkbox' ? el.checked : el.value };
  },
  async key({ code, ms = 60 }) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9]{2,20}$/.test(code)) throw new Error('A key code, e.g. KeyW, ArrowLeft, Space');
    dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
    await new Promise(r => setTimeout(r, Math.min(Math.max(ms, 0), 20_000)));
    dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
    return {};
  },
  async sim({ fn, args = [] }) {
    if (!SIM_FNS.includes(fn)) throw new Error(`Not one of: ${SIM_FNS.join(', ')}`);
    const f = S()?.[fn]; if (typeof f !== 'function') throw new Error(`${fn} isn't there (yet)`);
    return { result: plain(await f(...(Array.isArray(args) ? args : [args]))) ?? null };   // (a promise's value: aiSaveServer)
  },
  get({ path, slice, pick }) {
    if (typeof path !== 'string' || !path) throw new Error('A path, e.g. ai.hist');
    let v = S();
    for (const k of path.split(/[./]/)) { if (v == null || !(k in Object(v))) throw new Error(`${path}: no ${k} there`); v = v[k]; }
    // a long list: a slice of it ([from, to], up to 2000), and of each item only the fields picked
    if (Array.isArray(slice) && v && typeof v.length === 'number') v = Array.prototype.slice.call(v, slice[0] | 0, Math.min((slice[1] | 0) || v.length, (slice[0] | 0) + 2000));
    if (Array.isArray(pick) && Array.isArray(v)) v = v.map(x => Object.fromEntries(pick.filter(k => x && k in x).map(k => [k, typeof x[k] === 'number' ? Math.round(x[k] * 1000) / 1000 : x[k]])));
    return { value: Array.isArray(v) && Array.isArray(slice) ? v.map(x => plain(x, 1)) : plain(v) ?? null };
  },
  reload() { return {}; },
};
// a picture of the 3D view, taken just after it is drawn (WebGL keeps nothing after)
function hook(r) {
  if (r.__bridgeHook) return;
  const draw = r.render.bind(r);
  r.render = (scene, cam) => {
    draw(scene, cam);
    const w = st.shot; if (!w || cam !== S()?.camera) return;
    st.shot = null;
    try {
      const src = r.domElement, k = Math.min(1, w.maxWidth / src.width), cv = document.createElement('canvas');
      cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k);
      cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
      w.done({ dataUrl: cv.toDataURL('image/jpeg', w.quality), width: cv.width, height: cv.height });
    } catch (e) { w.fail(e); }
  };
  r.__bridgeHook = true;
}

// ---------------------------------------------------------------- the panel
function note(s) { st.log.push(`${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${s}`); if (st.log.length > 40) st.log.shift(); show(); }
function show(extra) {
  if (!st.el) return;
  const on = !!st.pageId, q = s => st.el.querySelector(s);
  st.btn.classList.toggle('on', !!st.agent);
  st.btn.textContent = st.agent ? `🤝 ${st.agent}` : '🤝 Claude';
  q('#brStat').textContent = !on ? 'Not connected.' : st.agent ? `${st.agent} is connected and can work in this page.${extra ? ' (' + extra + ')' : ''}`
    : `Give Claude this code (valid ${Math.max(0, Math.ceil((st.codeUntil - Date.now()) / 60000))} min)${extra ? ' · ' + extra : ''}:`;
  q('#brCode').textContent = on && !st.agent && st.code ? st.code.replace(/(\d{3})(\d{3})/, '$1 $2') : '';
  q('#brConnect').style.display = on ? 'none' : '';
  q('#brClose').style.display = on ? '' : 'none';
  q('#brMsgRow').style.display = st.agent ? '' : 'none';
  q('#brLog').textContent = st.log.slice(-14).join('\n');
}
function ui() {
  document.head.insertAdjacentHTML('beforeend', `<style>
    #brBtn{position:fixed;top:492px;right:12px;font:inherit;font-size:13px;font-weight:700;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;color:#fff;background:rgba(20,14,6,.65);z-index:4}
    #brBtn:hover{background:rgba(255,90,0,.85)} #brBtn.on{background:#7a3cff}
    body.mp-race #brBtn{display:none!important}
    #brPanel{display:none;position:fixed;width:300px;max-height:calc(100vh - 24px);overflow:auto;pointer-events:auto;z-index:5;background:rgba(20,14,6,.88)}
    #brPanel .lt{font-size:12px;letter-spacing:2px;opacity:.85} #brPanel button{font:inherit;font-size:12px;font-weight:700;border:0;border-radius:6px;padding:6px 10px;margin:6px 4px 0 0;cursor:pointer;color:#fff;background:#ffffff26}
    #brPanel button:hover{background:#ffffff40} #brCode{font-size:30px;font-weight:800;letter-spacing:4px;font-variant-numeric:tabular-nums;margin:4px 0}
    #brLog{white-space:pre-wrap;font:11px/1.35 ui-monospace,monospace;opacity:.8;max-height:180px;overflow:auto;margin-top:6px}
    #brMsg{width:100%;box-sizing:border-box;font:inherit;font-size:12px;background:#ffffff1f;color:#fff;border:1px solid #ffffff40;border-radius:4px;padding:4px;margin-top:6px}
  </style>`);
  const b = st.btn = document.createElement('button'); b.id = 'brBtn'; b.textContent = '🤝 Claude'; b.title = 'Let a Claude session work in this page (you see what it does)';
  const p = st.el = document.createElement('div'); p.id = 'brPanel'; p.className = 'panel';
  p.innerHTML = `<div class="lt">CLAUDE BRIDGE</div><div id="brStat"></div><div id="brCode"></div>
    <button id="brConnect">Connect</button><button id="brClose">Disconnect</button>
    <div id="brMsgRow"><input id="brMsg" placeholder="Write to Claude, Enter to send"></div><div id="brLog"></div>`;
  document.body.append(b, p);
  b.addEventListener('click', e => { e.currentTarget.blur(); p.style.display = p.style.display === 'block' ? 'none' : 'block'; place(); show(); });
  p.querySelector('#brConnect').addEventListener('click', e => { e.currentTarget.blur(); connect(); });
  p.querySelector('#brClose').addEventListener('click', e => { e.currentTarget.blur(); disconnect(); });
  p.addEventListener('keydown', e => { e.stopPropagation(); });           // typing here isn't driving
  p.querySelector('#brMsg').addEventListener('keydown', async e => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    const t = e.target.value.trim(); e.target.value = '';
    try { await post('/message', { text: t }); note(`✉ you: ${t}`); } catch (err) { note(`✕ not sent: ${err.message}`); }
  });
  // under the Autopilot button (single player), or left of it (a race room: the right column is the room's)
  const place = () => {
    const a = document.getElementById('aiBtn')?.getBoundingClientRect(), mp = document.body.classList.contains('mp');
    if (a?.width) { b.style.top = (mp ? a.top : a.bottom + 8) + 'px'; b.style.right = (mp ? innerWidth - a.left + 8 : 12) + 'px'; }
    const r = b.getBoundingClientRect();                                  // the panel: left of the buttons, within the window
    p.style.right = (innerWidth - r.left + 8) + 'px'; p.style.top = Math.max(12, Math.min(r.top, innerHeight - p.offsetHeight - 12)) + 'px';
  };
  setInterval(() => { place(); if (st.pageId && !st.agent) show(); }, 1000);
  place();
}

// ---------------------------------------------------------------- start: for the super admin only
(async () => {
  try { const r = await fetch(API + '/can', { credentials: 'same-origin' }); if (!(await r.json()).can) return; } catch (e) { return; }
  while (!S()) await new Promise(r => setTimeout(r, 300));
  ui();
  try { const k = JSON.parse(sessionStorage.getItem(KEEP) || 'null'); if (k) { Object.assign(st, { pageId: k.pageId, token: k.token }); await post('/hello', { url: location.href, title: document.title }); listen(); note('Reconnected'); } }
  catch (e) { end(e.status === 404 ? 'The pairing ended (the server restarted?): Connect again' : ''); }
})();
