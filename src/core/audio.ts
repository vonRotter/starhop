// Tiny synthesized sound effects (no files): blips, chimes, whooshes and a soft engine hum.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let hum: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

export function unlockAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, slide = 0, delay = 0): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, vol = 0.2, from = 800, to = 200): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  click: () => tone(660, 0.08, 'triangle', 0.2),
  scanTick: () => tone(1200, 0.05, 'sine', 0.08),
  scanDone: () => {
    tone(880, 0.12, 'triangle', 0.25);
    tone(1320, 0.2, 'triangle', 0.25, 0, 0.1);
  },
  pickup: () => {
    tone(740, 0.08, 'square', 0.12);
    tone(1110, 0.14, 'square', 0.12, 0, 0.07);
  },
  mine: () => tone(300 + Math.random() * 200, 0.06, 'sawtooth', 0.06),
  jump: () => tone(320, 0.18, 'triangle', 0.2, 300),
  land: () => noise(0.5, 0.25, 600, 120),
  whoosh: () => noise(1.4, 0.3, 300, 2000),
  quest: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.25, 0, i * 0.11));
  },
  deny: () => tone(200, 0.25, 'square', 0.12, -60),
  geyser: () => noise(0.9, 0.25, 1500, 400),
};

/** Engine hum; level 0..1 (0 = silent). */
export function setHum(level: number, boost: boolean): void {
  if (!ctx || !master) return;
  if (!hum) {
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = 'sawtooth';
    osc2.type = 'triangle';
    osc.frequency.value = 55;
    osc2.frequency.value = 82;
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    gain.gain.value = 0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(master);
    osc.start();
    osc2.start();
    hum = { osc, osc2, gain, filter };
  }
  const t = ctx.currentTime;
  hum.gain.gain.setTargetAtTime(level * 0.12, t, 0.15);
  hum.osc.frequency.setTargetAtTime(50 + level * 30 + (boost ? 25 : 0), t, 0.2);
  hum.filter.frequency.setTargetAtTime(250 + level * 400 + (boost ? 500 : 0), t, 0.2);
}
