// The exams of the networks agents send in (docs/agents.md): the server drives each one itself, in the simulator module
// (lib/sim-module: the game's own engine, sim.exam), and what it times is the network's lap on the leaderboard. Nobody's
// word is taken for a lap time. One exam at a time, each in a process of its own (exam-run.mjs: a sim is 200 MB and
// some seconds of a core, and this process runs the races), a few waiting, each agent one at a time and so many an hour.
// The route that asked waits for the answer; if its caller hangs up meanwhile, the exam still ends and the network is
// saved (it shows in the agent's list).
import { spawn } from 'node:child_process';
import path from 'node:path';

// (an exam is about 5 s, some 15 s on the longest track with a network that crawls: whoever waits behind four of them at their
// worst still hears within a few minutes; the request that asked is held open meanwhile)
export const EXAM_LIMITS = { laps: 3, waiting: 4, timeoutMs: 60_000, perHour: 30, hourMs: 3600_000, heapMb: 1024, outMax: 2 * 1024 * 1024 };

export class ExamError extends Error {
  constructor(status, message) { super(message); this.name = 'ExamError'; this.status = status; }
}

/** an exam in a new process; resolves with exam-run.mjs's answer, rejects with ExamError */
export function runExam(job, { root = process.cwd(), timeoutMs = EXAM_LIMITS.timeoutMs } = {}) {
  return new Promise((yes, no) => {
    // (nothing of the server's environment: the child reads the engine's files and a job, no secret, no database)
    const child = spawn(process.execPath, [`--max-old-space-size=${EXAM_LIMITS.heapMb}`, path.join(root, 'lib', 'agents', 'exam-run.mjs')],
      { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '', NODE_ENV: process.env.NODE_ENV || 'production' } });
    let out = '', err = '', done = false;
    const end = (e, v) => { if (done) return; done = true; clearTimeout(timer); if (e) no(e); else yes(v); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); end(new ExamError(504, 'The exam took too long and was stopped.')); }, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { out += d; if (out.length > EXAM_LIMITS.outMax) { child.kill('SIGKILL'); end(new ExamError(500, 'The exam went wrong.')); } });
    child.stderr.on('data', d => { if (err.length < 4000) err += d; });
    child.on('error', e => end(new ExamError(500, `The exam could not start: ${e.message}`)));
    child.on('close', code => {
      let a = null; try { a = JSON.parse(out); } catch { /* below */ }
      if (a?.ok === true) return end(null, a);
      if (a && typeof a.error === 'string') return end(new ExamError(422, `The simulator refused it: ${a.error}`));
      console.error(`[exam] the exam's process ended with ${code}: ${err.slice(0, 1000)}`);
      end(new ExamError(500, 'The exam went wrong.'));
    });
    child.stdin.on('error', () => { });
    child.stdin.end(JSON.stringify({ ...job, root, laps: EXAM_LIMITS.laps }));
  });
}

const EXAMS_VERSION = 1;
export class Exams {
  version = EXAMS_VERSION;
  /** @param {{ run?: (job: object) => Promise<any>, now?: () => number }} [opts] run: the exam itself (tests give their own) */
  constructor({ run = runExam, now = Date.now } = {}) {
    this.run = run; this.now = now;
    /** @type {{ who: string, job: object, yes: Function, no: Function }[]} */ this.queue = [];
    this.busy = false;
    /** @type {Map<string, number>} who has one waiting or running */ this.open = new Map();
    /** @type {Map<string, number[]>} when each asked, this last hour */ this.asked = new Map();
  }

  /**
   * An exam for `who` (an agent's user id): { course, ground, car, network } → exam-run.mjs's answer.
   * Refused (ExamError 429 / 503) when they have one under way, have asked too often, or too many are waiting.
   */
  submit(who, job) {
    const L = EXAM_LIMITS, now = this.now();
    if (this.open.get(who)) return Promise.reject(new ExamError(429, 'One exam at a time: wait for the answer to your last network.'));
    const mine = (this.asked.get(who) || []).filter(t => now - t < L.hourMs);
    if (mine.length >= L.perHour) return Promise.reject(new ExamError(429, `${L.perHour} networks an hour is the limit: send the next one in ${Math.ceil((mine[0] + L.hourMs - now) / 60_000)} min. Time them yourself first (sim.exam).`));
    if (this.queue.length >= L.waiting) return Promise.reject(new ExamError(503, 'Too many exams are waiting. Try again in a minute.'));
    mine.push(now); this.asked.set(who, mine);
    for (const [k, v] of this.asked) if (!v.some(t => now - t < L.hourMs)) this.asked.delete(k);
    this.open.set(who, 1);
    return new Promise((yes, no) => { this.queue.push({ who, job, yes, no }); this.#next(); });
  }

  #next() {
    if (this.busy) return;
    const x = this.queue.shift();
    if (!x) return;
    this.busy = true;
    // (its agent is free again before it hears the answer: the next network may follow at once)
    const done = settle => v => { this.open.delete(x.who); this.busy = false; settle(v); this.#next(); };
    Promise.resolve().then(() => this.run(x.job)).then(done(x.yes), done(x.no));
  }
}

/** The app's: one for the process (the dev server's reloads keep it, unless it is an older version's). */
export function exams() {
  const e = globalThis.__carsimExams;
  return e?.version === EXAMS_VERSION ? e : (globalThis.__carsimExams = new Exams());
}
