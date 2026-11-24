// A tiny neural network as the sim's autopilot keeps it (scripts/patches/autopilot.py: AI_INPUTS, aiNet), for the
// pages that draw one. An input set is a list of ids; some ids are several inputs.
export const INPUT_NAMES: Record<string, string[]> = {
  speed: ['speed'], line6: ['line 6 m'], line15: ['line 15 m'], line30: ['line 30 m'], offset: ['offset'], yaw: ['yaw rate'],
  pace: ['pace note'], ahead: ['pace ahead'], edges: ['left edge', 'right edge'],
  rays: ['ray 60° L', 'ray 30° L', 'ray ahead', 'ray 30° R', 'ray 60° R'], slide: ['sideways'], wslip: ['front slip', 'rear slip'],
  sink: ['sinkage'], g: ['g forward', 'g sideways'], rival: ['rival ahead', 'rival behind', 'rival side', 'rival closing'], tilt: ['roll', 'pitch'],
};
/** What each input tells the network, in a few words. */
export const INPUT_HINTS: Record<string, string> = {
  speed: 'how fast it is going', 'line 6 m': 'where the racing line is 6 m ahead', 'line 15 m': 'the bend it is turning into', 'line 30 m': 'the next bend, early',
  offset: 'how far it is off the line', 'yaw rate': 'how fast it is turning', 'pace note': 'the speed this bit can take, less its own', 'pace ahead': 'the same, a moment ahead: time to brake',
  'left edge': 'room to the left', 'right edge': 'room to the right', sideways: 'how fast it slides sideways', 'front slip': 'front wheels spinning or locking', 'rear slip': 'rear wheels spinning or locking',
  sinkage: 'how deep the wheels sink', 'g forward': 'accelerating or braking, in g', 'g sideways': 'cornering, in g', roll: 'leaning to the side', pitch: 'nose up or down',
};

export interface NetShape { inputs: string[]; outputs: string[]; hidden: number; weights: number }

/** The network's inputs and outputs by name, and how many weights that makes. */
export function netShape(n: { inputs: string[]; handbrake: boolean; h: number }): NetShape {
  const inputs = n.inputs.flatMap(id => INPUT_NAMES[id] ?? [id]);
  const outputs = n.handbrake ? ['steer', 'pedal', 'handbrake'] : ['steer', 'pedal'];
  const I = inputs.length, O = outputs.length, h = n.h;
  return { inputs, outputs, hidden: h, weights: h ? I * h + h + h * O + O : I * O + O };
}

export interface NetLinks {
  /** without a hidden layer: io[output][input]; with one: ih[hidden][input] and ho[hidden][output] */
  io: number[][] | null; ih: number[][] | null; ho: number[][] | null; bias: number[]; max: number;
}

/** The weights as links between the dots (aiNet's layout), or null when they don't fit the shape. */
export function netLinks(shape: NetShape, w: number[] | null): NetLinks | null {
  if (!w || w.length !== shape.weights) return null;
  const I = shape.inputs.length, O = shape.outputs.length, h = shape.hidden;
  const max = Math.max(1e-9, ...w.map(Math.abs));
  if (!h) return { io: Array.from({ length: O }, (_, k) => w.slice(k * I, k * I + I)), ih: null, ho: null, bias: w.slice(I * O), max };
  const b1 = I * h, w2 = b1 + h;
  return {
    io: null, ih: Array.from({ length: h }, (_, j) => w.slice(j * I, j * I + I)), ho: Array.from({ length: h }, (_, j) => w.slice(w2 + j * O, w2 + j * O + O)),
    bias: w.slice(w2 + h * O), max,
  };
}

/** "27 weights", "a hidden layer of 8", for a line under a network's name. */
export const sizeText = (n: { weights: number; h: number }) => `${n.weights} weights${n.h ? ` · hidden layer of ${n.h}` : ''}`;
