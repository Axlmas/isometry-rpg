// Sounds are made on the spot with the browser's audio synthesiser, so the
// game ships no audio files. Each one is a short burst of noise or a tone
// with a shaped loudness; together they give blows weight and rhythm.

const STORE_KEY = 'isometry-rpg.sound';

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let enabled = true;

try {
  enabled = localStorage.getItem(STORE_KEY) !== 'off';
} catch {
  // Storage may be blocked; sound simply starts switched on.
}

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORE_KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered, but still switched for this visit.
  }
}

/** Browsers only allow sound after the player has touched the page; call this from a click or a key press. */
export function unlockSound(): void {
  if (context) {
    if (context.state === 'suspended') void context.resume();
    return;
  }
  const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Audio) return;
  try {
    context = new Audio();
    master = context.createGain();
    master.gain.value = 0.5;
    master.connect(context.destination);
    noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1; // Sound only; not a game rule.
  } catch {
    context = null;
  }
}

interface Shape {
  /** Loudness at its peak, 0 to 1. */
  volume: number;
  /** Seconds to reach the peak and to die away. */
  attack: number;
  decay: number;
  /** Seconds from now. */
  delay?: number;
}

function envelope(shape: Shape): { gain: GainNode; start: number; end: number } | null {
  if (!enabled || !context || !master || context.state !== 'running') return null;
  const start = context.currentTime + (shape.delay ?? 0);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(shape.volume, start + shape.attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + shape.attack + shape.decay);
  gain.connect(master);
  return { gain, start, end: start + shape.attack + shape.decay + 0.02 };
}

/** A tone that slides from one pitch to another. */
function tone(type: OscillatorType, from: number, to: number, shape: Shape): void {
  const env = envelope(shape);
  if (!env || !context) return;
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, env.start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), env.end);
  oscillator.connect(env.gain);
  oscillator.start(env.start);
  oscillator.stop(env.end);
}

/** A burst of noise through a filter that sweeps from one frequency to another. */
function hiss(kind: BiquadFilterType, from: number, to: number, shape: Shape, sharpness = 1): void {
  const env = envelope(shape);
  if (!env || !context || !noise) return;
  const source = context.createBufferSource();
  source.buffer = noise;
  const filter = context.createBiquadFilter();
  filter.type = kind;
  filter.Q.value = sharpness;
  filter.frequency.setValueAtTime(from, env.start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(30, to), env.end);
  source.connect(filter);
  filter.connect(env.gain);
  source.start(env.start, Math.random() * 0.5); // Sound only; not a game rule.
  source.stop(env.end);
}

export const sound = {
  /** The weapon cuts the air. */
  swing(): void {
    hiss('bandpass', 900, 2600, { volume: 0.22, attack: 0.02, decay: 0.11 }, 1.4);
  },
  /** A bowstring or a cast. */
  shot(magic: boolean): void {
    if (magic) tone('sine', 520, 1100, { volume: 0.2, attack: 0.01, decay: 0.16 });
    else tone('triangle', 240, 90, { volume: 0.3, attack: 0.004, decay: 0.09 });
    hiss('highpass', 2500, 5000, { volume: 0.1, attack: 0.005, decay: 0.08 });
  },
  /** The blow lands: a thud, heavier and brighter for a critical one. */
  hit(crit: boolean): void {
    tone('sine', crit ? 190 : 150, 45, { volume: crit ? 0.75 : 0.5, attack: 0.003, decay: crit ? 0.2 : 0.13 });
    hiss('lowpass', crit ? 4200 : 2200, 300, { volume: crit ? 0.5 : 0.32, attack: 0.002, decay: 0.09 });
    if (crit) tone('square', 1500, 500, { volume: 0.12, attack: 0.002, decay: 0.1 });
  },
  /** A weapon charge goes off: a bright ringing burst over the blow. */
  charge(): void {
    tone('sine', 1900, 3200, { volume: 0.22, attack: 0.004, decay: 0.24 });
    tone('sine', 2850, 4300, { volume: 0.12, attack: 0.004, decay: 0.2 });
    hiss('highpass', 5000, 9000, { volume: 0.16, attack: 0.003, decay: 0.12 });
  },
  /** The hero is hurt. */
  hurt(): void {
    tone('sawtooth', 120, 60, { volume: 0.3, attack: 0.004, decay: 0.16 });
    hiss('lowpass', 900, 200, { volume: 0.3, attack: 0.003, decay: 0.12 });
  },
  /** A monster falls. */
  kill(): void {
    tone('sine', 110, 38, { volume: 0.6, attack: 0.004, decay: 0.3, delay: 0.03 });
    hiss('lowpass', 600, 120, { volume: 0.35, attack: 0.01, decay: 0.28, delay: 0.03 });
  },
  coins(): void {
    tone('triangle', 2100, 2300, { volume: 0.14, attack: 0.002, decay: 0.07 });
    tone('triangle', 2800, 3000, { volume: 0.12, attack: 0.002, decay: 0.09, delay: 0.06 });
  },
  pickup(): void {
    tone('triangle', 660, 990, { volume: 0.16, attack: 0.004, decay: 0.1 });
  },
  /** Something worth stopping for has dropped or been picked up. */
  treasure(): void {
    [880, 1109, 1319, 1760].forEach((pitch, i) => tone('triangle', pitch, pitch, { volume: 0.2, attack: 0.005, decay: 0.26, delay: i * 0.07 }));
  },
  levelUp(): void {
    [523, 659, 784, 1047].forEach((pitch, i) => tone('triangle', pitch, pitch, { volume: 0.26, attack: 0.01, decay: 0.34, delay: i * 0.11 }));
    tone('sine', 262, 262, { volume: 0.2, attack: 0.02, decay: 0.8 });
  },
  death(): void {
    tone('sawtooth', 220, 55, { volume: 0.35, attack: 0.01, decay: 0.9 });
  },
  potion(): void {
    tone('sine', 300, 620, { volume: 0.18, attack: 0.02, decay: 0.2 });
  },
  denied(): void {
    tone('square', 160, 120, { volume: 0.08, attack: 0.004, decay: 0.09 });
  },
};
