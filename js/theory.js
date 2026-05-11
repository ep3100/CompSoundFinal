/* theory.js — all the music math, no dom, no audio */


/* ── pitch classes ── */

/* 12 notes, C=0 through B=11 */
export const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F",
  "F#", "G", "G#", "A", "A#", "B"
];

/* enharmonic display names (used in ui) */
export const NOTE_DISPLAY = [
  "C", "C#/Db", "D", "D#/Eb", "E", "F",
  "F#/Gb", "G", "G#/Ab", "A", "A#/Bb", "B"
];

/* which pitch classes are black keys */
export const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);


/* ── interval structures ── */

/* semitone intervals from root for common chord types */
export const CHORD_TYPES = {
  maj:   [0, 4, 7],          /* major triad */
  min:   [0, 3, 7],          /* minor triad */
  dim:   [0, 3, 6],          /* diminished */
  aug:   [0, 4, 8],          /* augmented */
  maj7:  [0, 4, 7, 11],      /* major 7th */
  min7:  [0, 3, 7, 10],      /* minor 7th */
  dom7:  [0, 4, 7, 10],      /* dominant 7th */
  hdim7: [0, 3, 6, 10],      /* half-diminished 7th (m7b5) */
  dim7:  [0, 3, 6, 9],       /* fully diminished 7th */
  minMaj7: [0, 3, 7, 11],    /* minor major 7th */
  min6:  [0, 3, 7, 9],       /* minor 6th */
  maj6:  [0, 4, 7, 9],       /* major 6th */
  sus2:  [0, 2, 7],          /* suspended 2nd */
  sus4:  [0, 5, 7],          /* suspended 4th */
};

/* given a root pitch class + chord type, return array of pitch classes */
export function buildChord(root, type = "maj") {
  const intervals = CHORD_TYPES[type] ?? CHORD_TYPES.maj;
  return intervals.map(i => (root + i) % 12);
}


/* ── tni inversion (the core transform) ── */

/* reflect a single pitch class over the axis
   axis is the midpoint between tonic and its fifth
   formula: (axis - note + 12) % 12 */
export function invertNote(note, axis) {
  return (axis - note + 12) % 12;
}

/* reflect an entire chord — maps each note through invertNote */
export function invertChord(notes, axis) {
  return notes.map(n => invertNote(n, axis));
}

/* compute the reflection axis for a given tonic
   in neo-riemannian theory the axis sits between
   the tonic and its perfect fifth, i.e. tonic + 3.5
   we use tonic*2 + 7 to keep it integer math friendly
   then halve when applying — see invertNote */
export function getAxis(tonic) {
  /* axis = tonic + 3.5, but we double everything:
     axisDouble = tonic*2 + 7
     then invertNote uses: (axisDouble - note*2) / 2
     simplified back to: (tonic + 7 - note + 12) % 12
     which is just: (tonic + 7) % 12 as the axis value */
  return (tonic + 7) % 12;
}


/* ── chord naming ── */

/* try to name a set of pitch classes as a known chord
   brute-forces all roots + types — returns best match or null */
export function nameChord(notes) {
  if (!notes || notes.length === 0) return null;

  const noteSet = new Set(notes.map(n => ((n % 12) + 12) % 12));

  for (const [typeName, intervals] of Object.entries(CHORD_TYPES)) {
    /* only try chord types with matching note count */
    if (intervals.length !== noteSet.size) continue;

    for (let root = 0; root < 12; root++) {
      const candidate = new Set(intervals.map(i => (root + i) % 12));
      if (setsEqual(noteSet, candidate)) {
        return `${NOTE_NAMES[root]} ${typeName}`;
      }
    }
  }

  /* no match — just list the note names */
  return [...noteSet]
    .sort((a, b) => a - b)
    .map(n => NOTE_NAMES[n])
    .join(" ");
}

/* helper: are two sets identical */
function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}


/* ── frequency conversion ── */

/* midi note number to frequency in hz
   midi 69 = A4 = 440hz */
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* pitch class + octave to midi note number */
export function pitchToMidi(pitchClass, octave = 4) {
  return (octave + 1) * 12 + pitchClass;
}

/* pitch class + octave → frequency, convenience wrapper */
export function pitchToFreq(pitchClass, octave = 4) {
  return midiToFreq(pitchToMidi(pitchClass, octave));
}


/* ── neo-riemannian operations ── */

/* P (parallel) — flip major <-> minor, root stays same */
export function opP(notes) {
  const sorted = [...notes].sort((a, b) => a - b);
  const root = sorted[0];
  const isMajor = (sorted[1] - root + 12) % 12 === 4;
  return isMajor ? buildChord(root, "min") : buildChord(root, "maj");
}

/* L (leading tone) — move root down a half step
   major triad: root drops to become new chord's fifth
   minor triad: fifth raises to become major chord's third */
export function opL(notes) {
  const sorted = [...notes].sort((a, b) => a - b);
  const root = sorted[0];
  const isMajor = (sorted[1] - root + 12) % 12 === 4;
  if (isMajor) {
    /* e.g. C maj -> E min */
    const newRoot = (root + 4) % 12;
    return buildChord(newRoot, "min");
  } else {
    /* e.g. E min -> C maj */
    const newRoot = (root - 4 + 12) % 12;
    return buildChord(newRoot, "maj");
  }
}

/* R (relative) — relative major/minor swap */
export function opR(notes) {
  const sorted = [...notes].sort((a, b) => a - b);
  const root = sorted[0];
  const isMajor = (sorted[1] - root + 12) % 12 === 4;
  if (isMajor) {
    /* e.g. C maj -> A min */
    const newRoot = (root + 9) % 12;
    return buildChord(newRoot, "min");
  } else {
    /* e.g. A min -> C maj */
    const newRoot = (root + 3) % 12;
    return buildChord(newRoot, "maj");
  }
}


/* ── progression transform ── */

/* take a full progression (array of note arrays) and return
   the negative harmony version of each chord */
export function transformProgression(progression, tonic) {
  const axis = getAxis(tonic);
  return progression.map(chord => invertChord(chord, axis));
}