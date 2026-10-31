// Study sounds: soft background noise generated live with the Web Audio API, so there is nothing to
// download, nothing to license and no loop seam. The chosen sound and volume are remembered; playback
// always starts with a click (browsers block sound that starts by itself).

export type SoundId = "rain" | "ocean" | "brown" | "fan";
export const SOUNDS: { id: SoundId; label: string; tip: string }[] = [
  { id: "rain", label: "Rain", tip: "Steady rain with scattered drops" },
  { id: "ocean", label: "Ocean", tip: "Slow waves rolling in and out" },
  { id: "brown", label: "Brown noise", tip: "Deep, even rumble that masks voices" },
  { id: "fan", label: "Fan", tip: "Low, soft hum" },
];

const KEY = "distil.sound";
const FADE_S = 0.6;

function saved(): { id: SoundId; volume: number } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { id: SOUNDS.some((s) => s.id === v.id) ? v.id : "rain", volume: typeof v.volume === "number" ? Math.min(1, Math.max(0, v.volume)) : 0.4 };
  } catch {
    return { id: "rain", volume: 0.4 };
  }
}

export const sound = $state({ ...saved(), playing: false, open: false });

const remember = () => {
  try { localStorage.setItem(KEY, JSON.stringify({ id: sound.id, volume: sound.volume })); } catch { /* lasts for this page only */ }
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let voice: { out: GainNode; stop: () => void } | null = null;

// Loudness feels logarithmic, so the slider is squared.
const level = () => sound.volume ** 2;

function noise(c: AudioContext, colour: "white" | "pink" | "brown", seconds = 5): AudioBuffer {
  const buffer = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < data.length; i++) {
    const w = Math.random() * 2 - 1;
    if (colour === "white") data[i] = w * 0.5;
    else if (colour === "pink") {
      // Paul Kellet's economy pink filter.
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    } else {
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

// Sparse, short decaying ticks: raindrops on a roof.
function drops(c: AudioContext, seconds = 7): AudioBuffer {
  const buffer = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let n = 0; n < seconds * 14; n++) {
    const start = Math.floor(Math.random() * (data.length - c.sampleRate * 0.03));
    const length = Math.floor(c.sampleRate * (0.004 + Math.random() * 0.02));
    const amp = 0.05 + Math.random() * 0.25;
    for (let i = 0; i < length; i++) data[start + i]! += (Math.random() * 2 - 1) * amp * Math.exp((-6 * i) / length);
  }
  return buffer;
}

function build(c: AudioContext, id: SoundId): { out: GainNode; stop: () => void } {
  const out = c.createGain();
  const sources: AudioScheduledSourceNode[] = [];
  const loop = (buffer: AudioBuffer) => {
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    sources.push(src);
    return src;
  };
  const filter = (type: BiquadFilterType, frequency: number, q = 0.7) => {
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  };

  if (id === "rain") {
    const bed = loop(noise(c, "pink"));
    const bedGain = c.createGain();
    bedGain.gain.value = 0.7;
    bed.connect(filter("highpass", 400)).connect(filter("lowpass", 6000)).connect(bedGain).connect(out);
    const tick = loop(drops(c));
    tick.connect(filter("bandpass", 2500, 0.8)).connect(out);
  } else if (id === "ocean") {
    const body = loop(noise(c, "brown"));
    const swell = c.createGain();
    swell.gain.value = 0.55;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.09; // a wave about every 11 seconds
    const depth = c.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth).connect(swell.gain);
    sources.push(lfo);
    body.connect(filter("lowpass", 1000)).connect(swell).connect(out);
  } else if (id === "brown") {
    loop(noise(c, "brown")).connect(filter("lowpass", 1200)).connect(out);
  } else {
    const hum = c.createGain();
    hum.gain.value = 1.4;
    loop(noise(c, "pink")).connect(filter("lowpass", 450)).connect(hum).connect(out);
  }

  sources.forEach((s) => s.start());
  out.connect(master!);
  return { out, stop: () => sources.forEach((s) => s.stop()) };
}

function fade(node: GainNode, to: number) {
  const now = ctx!.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(node.gain.value, now);
  node.gain.linearRampToValueAtTime(to, now + FADE_S);
}

function release() {
  if (!voice) return;
  const old = voice;
  voice = null;
  fade(old.out, 0);
  setTimeout(() => { old.stop(); old.out.disconnect(); }, FADE_S * 1000 + 50);
}

export async function play(id: SoundId = sound.id) {
  ctx ??= new AudioContext();
  if (!master) {
    master = ctx.createGain();
    master.gain.value = level();
    master.connect(ctx.destination);
  }
  await ctx.resume();
  if (voice && sound.id === id && sound.playing) return;
  release();
  sound.id = id;
  remember();
  voice = build(ctx, id);
  voice.out.gain.value = 0;
  fade(voice.out, 1);
  sound.playing = true;
}

export function pause() {
  release();
  sound.playing = false;
}

export function setVolume(volume: number) {
  sound.volume = Math.min(1, Math.max(0, volume));
  remember();
  if (master && ctx) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.05);
}
