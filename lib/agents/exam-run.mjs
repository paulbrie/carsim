// One exam, in a process of its own (lib/agents/exam.mjs starts it): the job comes in on stdin as JSON
// ({ root, course, ground, car, network, laps }), the answer goes out on stdout as JSON. It builds the simulator module
// from the engine as it is (lib/sim-module), drives the network as sim.exam does, and says what it saw. A process of
// its own because a sim is 200 MB and a few seconds of one core: the server's own loop runs the races.
import { simModule } from '../sim-module/serve.mjs';

const out = process.stdout.write.bind(process.stdout);
for (const k of ['log', 'info', 'warn', 'debug']) console[k] = () => { };   // (the engine's own chatter: not our answer)

let text = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) text += chunk;

let answer;
try {
  const job = JSON.parse(text), m = simModule(job.root);
  const { createSim } = await import(`data:text/javascript;base64,${Buffer.from(m.source).toString('base64')}`);
  const sim = await createSim({ car: job.car, ground: job.ground, course: job.course ?? undefined });
  const exam = sim.exam(job.network, { laps: job.laps });
  const c = sim.course();
  answer = { ok: true, exam: { time: exam.time, laps: exam.laps, why: exam.why, seconds: exam.seconds }, file: sim.network(),
    course: { key: c.key, length: Math.round(c.length) }, car: sim.car, ground: sim.ground, build: m.build };
} catch (e) {
  answer = { ok: false, error: String(e?.message ?? e).slice(0, 300) };
}
out(JSON.stringify(answer), () => process.exit(0));
