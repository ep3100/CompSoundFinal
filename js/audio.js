/* audio.js — webaudio engine, oscillators, adsr, sequencer */

import { pitchToFreq } from './theory.js';


/* ── context ── */

/* single shared audio context + master gain bus
   everything routes through master so we can control overall volume
   and avoid clipping when many oscs are stacked */
let ctx        = null;
let masterBus  = null;

export function getContext() {
  if (!ctx) {
    ctx = new AudioContext();
    /* master gain — slight headroom so stacked chords dont clip */
    masterBus = ctx.createGain();
    masterBus.gain.value = 0.4;
    masterBus.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/* every voice should connect here instead of ctx.destination */
function getMaster() {
  getContext();
  return masterBus;
}


/* ── adsr envelope ── */

/* default envelope shape — tweak these for different feels */
const DEFAULT_ADSR = {
  attack:  0.06,   /* seconds to reach full volume */
  decay:   0.15,   /* seconds to fall to sustain level */
  sustain: 0.6,    /* 0-1 gain level held during note */
  release: 0.25,   /* shorter release so chords dont bleed into each other */
};

/* per-waveform gain scaling — square + sawtooth have way more harmonic
   content so they sound much louder at the same amplitude. scale them
   down so all waveforms feel roughly equal loudness */
const WAVEFORM_GAIN = {
  sine:     1.0,
  triangle: 0.85,
  sawtooth: 0.35,
  square:   0.3,
};

function gainForWaveform(wave) {
  return WAVEFORM_GAIN[wave] ?? 1.0;
}

/* apply adsr to a gainNode
   duration is the held time before release begins
   leaves a gap before the next chord to avoid overlap clicks */
function applyAdsr(gainNode, startTime, duration, adsr = DEFAULT_ADSR) {
  const g = gainNode.gain;
  const { attack, decay, sustain, release } = adsr;

  /* leave last 10% of chord duration as pre-release gap */
  const heldUntil = startTime + duration * 0.9;

  g.setValueAtTime(0, startTime);
  g.linearRampToValueAtTime(1, startTime + attack);
  g.linearRampToValueAtTime(sustain, startTime + attack + decay);
  g.setValueAtTime(sustain, heldUntil);
  g.linearRampToValueAtTime(0, heldUntil + release);

  return heldUntil + release;
}


/* ── single note ── */

/* play one frequency for a given duration
   returns the oscillator so caller can stop it early if needed */
export function playNote(freq, startTime, duration, waveform = "triangle", adsr = DEFAULT_ADSR) {
  const ac = getContext();

  const osc  = ac.createOscillator();
  const gain = ac.createGain();

  osc.type      = waveform;
  osc.frequency.setValueAtTime(freq, startTime);

  osc.connect(gain);
  gain.connect(ac.destination);

  const endTime = applyAdsr(gain, startTime, duration, adsr);

  osc.start(startTime);
  osc.stop(endTime);   /* auto cleanup after release tail */

  return osc;
}


/* ── chord playback ── */

/* play an array of pitch classes as a chord
   pitchClass array + octave → frequencies → playNote for each */
export function playChord(pitchClasses, startTime, duration, octave = 4, waveform = "triangle") {
  const ac = getContext();

  /* master gain so whole chord has unified volume
     also scales by waveform — square + saw are way louder than sine/tri */
  const master = ac.createGain();
  const waveScale = gainForWaveform(waveform);
  master.gain.setValueAtTime(waveScale / Math.sqrt(pitchClasses.length), startTime);
  master.connect(getMaster());

  const oscs = pitchClasses.map(pc => {
    const freq = pitchToFreq(pc, octave);
    const osc  = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = waveform;
    osc.frequency.setValueAtTime(freq, startTime);

    osc.connect(gain);
    gain.connect(master);

    const endTime = applyAdsr(gain, startTime, duration);
    osc.start(startTime);
    osc.stop(endTime);

    /* stash gain ref so stopOscs can ramp it down cleanly */
    osc._gain = gain;

    return osc;
  });

  return oscs;
}


/* ── sequencer ── */

/* state for the running sequencer */
let seqTimeouts = [];   /* timeout ids so we can cancel */
let seqOscs     = [];   /* active oscillators for hard stop */

/* play a progression (array of pitch-class arrays)
   onStep(index) fires each time a new chord starts — used to
   light up the chord list in the ui */
export function playProgression(progression, {
  bpm       = 80,
  octave    = 4,
  waveform  = "triangle",
  onStep    = () => {},
  onEnd     = () => {},
} = {}) {
  stopAll();   /* cancel anything already playing */

  const ac       = getContext();
  const beatSec  = 60 / bpm;
  const chordDur = beatSec * 2;   /* each chord = 2 beats */

  progression.forEach((chord, i) => {
    const startTime = ac.currentTime + i * chordDur;

    /* schedule the actual audio */
    const oscs = playChord(chord, startTime, chordDur, octave, waveform);
    seqOscs.push(...oscs);

    /* schedule the ui callback via setTimeout
       converts audio time to wall clock ms */
    const delayMs = (startTime - ac.currentTime) * 1000;
    const tid = setTimeout(() => onStep(i), delayMs);
    seqTimeouts.push(tid);
  });

  /* fire onEnd after last chord finishes */
  const totalMs = progression.length * chordDur * 1000;
  const endTid  = setTimeout(onEnd, totalMs + 500);
  seqTimeouts.push(endTid);
}

/* play original and mirror side by side at same time
   slight octave offset so they don't clash
   reduces volume since we're playing twice as many notes */
export function playBoth(original, mirror, options = {}) {
  stopAll();

  const ac      = getContext();
  const beatSec = 60 / (options.bpm ?? 80);
  const dur     = beatSec * 2;
  const wave    = options.waveform ?? "triangle";
  const oct     = options.octave   ?? 4;

  /* duck master while playing both — twice the voices means we need less per voice */
  const m = getMaster();
  m.gain.cancelScheduledValues(ac.currentTime);
  m.gain.setValueAtTime(0.25, ac.currentTime);

  original.forEach((chord, i) => {
    const t = ac.currentTime + i * dur;
    seqOscs.push(...playChord(chord,          t, dur, oct,     wave));
    seqOscs.push(...playChord(mirror[i] ?? [], t, dur, oct - 1, wave));
  });

  original.forEach((_, i) => {
    const delayMs = i * dur * 1000;
    const tid = setTimeout(() => (options.onStep ?? (() => {}))(i), delayMs);
    seqTimeouts.push(tid);
  });

  const endTid = setTimeout(() => {
    /* restore master volume when done */
    m.gain.setValueAtTime(0.4, ac.currentTime);
    (options.onEnd ?? (() => {}))();
  }, original.length * dur * 1000 + 500);
  seqTimeouts.push(endTid);
}


/* ── stop ── */

/* cancel all scheduled timeouts + ramp down active oscillators */
export function stopAll() {
  seqTimeouts.forEach(id => clearTimeout(id));
  seqTimeouts = [];

  const ac = getContext();

  /* restore master in case playBoth was ducking it */
  if (masterBus) {
    masterBus.gain.cancelScheduledValues(ac.currentTime);
    masterBus.gain.setValueAtTime(0.4, ac.currentTime + 0.1);
  }

  seqOscs.forEach(osc => {
    try {
      const gain = osc._gain;
      if (gain) {
        gain.gain.cancelScheduledValues(ac.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, ac.currentTime);
        gain.gain.linearRampToValueAtTime(0, ac.currentTime + 0.08);
        osc.stop(ac.currentTime + 0.09);
      } else {
        osc.stop(ac.currentTime + 0.08);
      }
    } catch (_) {}
  });
  seqOscs = [];
}


/* ── preview ── */

/* short one-shot chord preview when user holds keys on keyboard
   not sequenced, just immediate */
export function previewChord(pitchClasses, octave = 4, waveform = "triangle") {
  const ac = getContext();
  return playChord(pitchClasses, ac.currentTime, 1.2, octave, waveform);
}

/* stop a specific set of oscillators (used to end keyboard preview) */
export function stopOscs(oscs) {
  const ac = getContext();
  oscs.forEach(osc => {
    try {
      /* ramp gain to 0 first, then stop — prevents the click */
      const gain = osc._gain;
      if (gain) {
        gain.gain.cancelScheduledValues(ac.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, ac.currentTime);
        gain.gain.linearRampToValueAtTime(0, ac.currentTime + 0.08);
        osc.stop(ac.currentTime + 0.09);
      } else {
        osc.stop(ac.currentTime + 0.08);
      }
    } catch (_) {}
  });
}