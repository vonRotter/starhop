// Tiny synthesized sound effects (no files): blips, chimes, whooshes and a soft engine hum.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

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
  ring: () => {
    tone(988, 0.12, 'triangle', 0.25);
    tone(1480, 0.18, 'triangle', 0.2, 0, 0.07);
  },
  medal: () => {
    [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, 'square', 0.12, 0, i * 0.09));
  },
  bump: () => {
    noise(0.3, 0.3, 500, 100);
    tone(110, 0.2, 'square', 0.15, -40);
  },
  lowAir: () => {
    tone(880, 0.1, 'square', 0.1);
    tone(660, 0.12, 'square', 0.1, 0, 0.14);
  },
  craft: () => {
    [392, 523, 659, 784].forEach((f, i) => tone(f, 0.18, 'triangle', 0.22, 0, i * 0.07));
    noise(0.25, 0.12, 3000, 800);
  },
  wind: () => noise(2.5, 0.18, 400, 900),
};

let noiseBuf: AudioBuffer | null = null;
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

interface Hum {
  osc: OscillatorNode;
  osc2: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  rumble: GainNode;
  rumbleFilter: BiquadFilterNode;
  whine: OscillatorNode;
  whineGain: GainNode;
}
let engine: Hum | null = null;

/** Engine sound; level 0..1 (0 = silent). A warbling hum, a rumble of air and a whine on boost. */
export function setHum(level: number, boost: boolean): void {
  if (!ctx || !master) return;
  if (!engine) {
    const c = ctx;
    const osc = c.createOscillator();
    const osc2 = c.createOscillator();
    const gain = c.createGain();
    const filter = c.createBiquadFilter();
    osc.type = 'sawtooth';
    osc2.type = 'triangle';
    osc.frequency.value = 55;
    osc2.frequency.value = 82;
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 4;
    gain.gain.value = 0;
    // a slow wobble makes it chug like a little toy rocket
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = 7;
    lfoGain.gain.value = 4;
    lfo.connect(lfoGain).connect(osc.frequency);
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(master);
    // rumble: filtered noise
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const rumbleFilter = c.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 400;
    const rumble = c.createGain();
    rumble.gain.value = 0;
    src.connect(rumbleFilter).connect(rumble).connect(master);
    // boost whine
    const whine = c.createOscillator();
    whine.type = 'square';
    whine.frequency.value = 330;
    const wf = c.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 900;
    const whineGain = c.createGain();
    whineGain.gain.value = 0;
    whine.connect(wf).connect(whineGain).connect(master);
    for (const o of [osc, osc2, lfo, whine]) o.start();
    src.start();
    engine = { osc, osc2, gain, filter, rumble, rumbleFilter, whine, whineGain };
  }
  const e = engine;
  const t = ctx.currentTime;
  e.gain.gain.setTargetAtTime(level * 0.11, t, 0.15);
  e.osc.frequency.setTargetAtTime(48 + level * 34 + (boost ? 26 : 0), t, 0.2);
  e.osc2.frequency.setTargetAtTime(72 + level * 50 + (boost ? 40 : 0), t, 0.2);
  e.filter.frequency.setTargetAtTime(240 + level * 420 + (boost ? 600 : 0), t, 0.2);
  e.rumble.gain.setTargetAtTime(level * (boost ? 0.16 : 0.07), t, 0.2);
  e.rumbleFilter.frequency.setTargetAtTime(300 + level * 500 + (boost ? 900 : 0), t, 0.2);
  e.whineGain.gain.setTargetAtTime(boost && level > 0 ? 0.025 : 0, t, 0.25);
  e.whine.frequency.setTargetAtTime(boost ? 520 : 300, t, 0.6);
}

// ------------------------------------------------------------------ music
// Little synthesized loops per area: a soft pad, a bass, an arpeggio, a bell line and, for some
// areas, light drums. Each song is four bars of four chords (MIDI notes).

export type MusicArea = 'title' | 'space' | 'pebble' | 'bloom' | 'frost' | 'dune' | 'race';

interface Song {
  bpm: number;
  chords: number[][];
  arp: OscillatorType;
  pad: OscillatorType;
  drums: 0 | 1 | 2;
  bell: boolean;
  cutoff?: number;
}

const SONGS: Record<MusicArea, Song> = {
  title: { bpm: 80, chords: [[50, 57, 62, 65], [46, 53, 58, 62], [41, 53, 57, 60], [48, 55, 60, 64]], arp: 'sine', pad: 'triangle', drums: 0, bell: true },
  space: { bpm: 84, chords: [[50, 57, 62, 65], [46, 53, 58, 62], [41, 53, 57, 60], [48, 55, 60, 64]], arp: 'sine', pad: 'sine', drums: 0, bell: true },
  pebble: { bpm: 100, chords: [[48, 55, 60, 64], [45, 52, 57, 60], [41, 53, 57, 60], [43, 55, 59, 62]], arp: 'triangle', pad: 'triangle', drums: 1, bell: true },
  bloom: { bpm: 116, chords: [[43, 55, 59, 62], [40, 52, 55, 59], [48, 55, 60, 64], [50, 57, 62, 66]], arp: 'square', pad: 'triangle', drums: 1, bell: false, cutoff: 1800 },
  frost: { bpm: 72, chords: [[45, 57, 60, 64], [41, 57, 60, 65], [48, 55, 60, 67], [43, 55, 59, 62]], arp: 'sine', pad: 'sine', drums: 0, bell: true },
  dune: { bpm: 92, chords: [[50, 57, 62, 65], [51, 58, 63, 67], [50, 57, 62, 65], [48, 55, 60, 63]], arp: 'sawtooth', pad: 'triangle', drums: 2, bell: false, cutoff: 1200 },
  race: { bpm: 140, chords: [[40, 52, 55, 59], [48, 55, 60, 64], [43, 55, 59, 62], [50, 57, 62, 66]], arp: 'square', pad: 'sawtooth', drums: 1, bell: false, cutoff: 2200 },
};

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

let musicOn = true;
let area: MusicArea | null = null;
let musicGain: GainNode | null = null;
let song: Song | null = null;
let nextStep = 0;
let stepIdx = 0;
let timer: number | null = null;

function note(dest: AudioNode, freq: number, at: number, dur: number, type: OscillatorType, vol: number, attack = 0.01, cutoff = 0): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  if (cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    o.connect(f).connect(g);
  } else o.connect(g);
  g.connect(dest);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function drum(dest: AudioNode, at: number, kind: 'kick' | 'hat' | 'tom'): void {
  if (!ctx) return;
  if (kind === 'kick' || kind === 'tom') {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(kind === 'kick' ? 120 : 220, at);
    o.frequency.exponentialRampToValueAtTime(kind === 'kick' ? 45 : 110, at + 0.15);
    g.gain.setValueAtTime(kind === 'kick' ? 0.35 : 0.18, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + 0.25);
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 6000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.06, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  src.connect(f).connect(g).connect(dest);
  src.start(at, Math.random());
  src.stop(at + 0.08);
}

// a fixed little bell melody pattern (chord tone index per 16th step, -1 = rest)
const BELL = [3, -1, -1, 2, -1, -1, 1, -1, 2, -1, -1, -1, 0, -1, 1, -1];
const ARP = [0, 1, 2, 3, 2, 1, 2, 3];

function schedule(): void {
  if (!ctx || !musicGain || !song) return;
  const sp = 60 / song.bpm / 4;
  while (nextStep < ctx.currentTime + 0.25) {
    const bar = Math.floor(stepIdx / 16) % 4;
    const st = stepIdx % 16;
    const ch = song.chords[bar];
    const at = nextStep;
    if (st === 0) for (const n of ch.slice(1)) note(musicGain, midi(n), at, sp * 16, song.pad, 0.035, 0.4, song.cutoff ?? 0);
    if (st === 0 || st === 8 || (song.drums && (st === 6 || st === 14))) note(musicGain, midi(ch[0] - 12), at, sp * 3, 'triangle', 0.12, 0.01);
    if (st % 2 === 0) note(musicGain, midi(ch[1 + (ARP[(st / 2) % 8] % 3)] + 12), at, sp * 1.8, song.arp, song.arp === 'sine' ? 0.05 : 0.025, 0.005, song.cutoff ?? 0);
    if (song.bell && BELL[st] >= 0 && bar % 2 === 1) note(musicGain, midi(ch[BELL[st]] + 24), at, sp * 6, 'sine', 0.04, 0.005);
    if (song.drums === 1) {
      if (st === 0 || st === 8) drum(musicGain, at, 'kick');
      if (st % 4 === 2) drum(musicGain, at, 'hat');
    } else if (song.drums === 2) {
      if (st === 0 || st === 10) drum(musicGain, at, 'tom');
      if (st === 4 || st === 12) drum(musicGain, at, 'hat');
    }
    nextStep += sp;
    stepIdx++;
  }
}

function startSong(): void {
  if (!ctx || !master) return;
  if (musicGain) {
    const old = musicGain;
    old.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
    setTimeout(() => old.disconnect(), 2000);
    musicGain = null;
  }
  song = null;
  if (!musicOn || !area) return;
  musicGain = ctx.createGain();
  musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  musicGain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 1.5);
  musicGain.connect(master);
  song = SONGS[area];
  nextStep = ctx.currentTime + 0.1;
  stepIdx = 0;
  if (timer === null) timer = window.setInterval(schedule, 60);
}

/** Switches the background loop (null = silence). Safe to call every frame. */
export function setMusic(a: MusicArea | null): void {
  if (a === area && (musicGain || !ctx)) return;
  area = a;
  startSong();
}

export function setMusicOn(on: boolean): void {
  musicOn = on;
  startSong();
}
