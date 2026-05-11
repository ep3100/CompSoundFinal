/* app.js — wires everything together, owns the dom */

import {
  NOTE_NAMES, BLACK_KEYS,
  buildChord, getAxis, invertChord,
  nameChord, transformProgression,
} from './theory.js';

import {
  playProgression, playBoth, stopAll,
  previewChord, stopOscs, getContext,
} from './audio.js';

import { TonnetzRenderer } from './tonnetz.js';


/* ── state ── */

let tonic       = 0;      /* current key — pitch class 0-11 */
let octave      = 4;
let waveform    = "triangle";
let bpm         = 80;
let chordType   = "maj";  /* selected chord quality for keyboard input */

let heldKeys    = new Set();   /* roots currently pressed on keyboard */
let lastChord   = [];          /* last built chord (full pitch classes) */
let progression = [];          /* array of pitch-class arrays (original chords) */
let previewOscs = [];          /* oscs from keyboard preview, stopped on release */

let tonnetz;   /* TonnetzRenderer instance, set after dom ready */


/* ── dom refs ── */

const keyboardEl      = document.getElementById("keyboard");
const originalList    = document.getElementById("original-list");
const mirrorList      = document.getElementById("mirror-list");
const keySelect       = document.getElementById("key-select");
const octaveSelect    = document.getElementById("octave-select");
const waveformSelect  = document.getElementById("waveform-select");
const chordTypeSelect = document.getElementById("chord-type-select");
const tempoInput      = document.getElementById("tempo-input");
const btnAddChord     = document.getElementById("btn-add-chord");
const btnClear        = document.getElementById("btn-clear");
const btnPlayOriginal = document.getElementById("btn-play-original");
const btnPlayMirror   = document.getElementById("btn-play-mirror");
const btnPlayBoth     = document.getElementById("btn-play-both");
const btnStop         = document.getElementById("btn-stop");
const tonnetzCanvas   = document.getElementById("tonnetz-canvas");


/* ── keyboard builder ── */

/* white key pitch classes in order (one octave) */
const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];

/* black key pitch classes and which white key gap they sit in
   gap index = position between white keys */
const BLACK_MAP = [
  { pc: 1,  gap: 0 },   /* C# after C */
  { pc: 3,  gap: 1 },   /* D# after D */
  { pc: 6,  gap: 3 },   /* F# after F */
  { pc: 8,  gap: 4 },   /* G# after G */
  { pc: 10, gap: 5 },   /* A# after A */
];

/* build two octaves of piano keys and inject into #keyboard */
function buildKeyboard() {
  const octaves = [octave - 1, octave];

  octaves.forEach((oct, octIdx) => {
    WHITE_PCS.forEach((pc, wIdx) => {
      const key  = document.createElement("div");
      key.className   = "key-white";
      key.dataset.pc  = pc;
      key.dataset.oct = oct;

      const label = document.createElement("span");
      label.className   = "key-label";
      label.textContent = NOTE_NAMES[pc] + oct;
      key.appendChild(label);

      keyboardEl.appendChild(key);

      key.addEventListener("mousedown", () => pressKey(pc));
      key.addEventListener("mouseup",   () => releaseKey(pc));
      key.addEventListener("mouseleave", () => releaseKey(pc));
    });

    /* black keys — absolute positioned over the white keys */
    BLACK_MAP.forEach(({ pc, gap }) => {
      const key = document.createElement("div");
      key.className   = "key-black";
      key.dataset.pc  = pc;
      key.dataset.oct = oct;

      const keyW    = 48;
      const blackW  = 32;
      const leftPx  = (octIdx * WHITE_PCS.length + gap) * keyW + keyW - blackW / 2;
      key.style.left = leftPx + "px";

      key.addEventListener("mousedown", () => pressKey(pc));
      key.addEventListener("mouseup",   () => releaseKey(pc));
      key.addEventListener("mouseleave", () => releaseKey(pc));

      keyboardEl.appendChild(key);
    });
  });

  updateTonicHighlight();
}


/* ── key press / release ── */

/* pressing a key builds a full chord using selected chord type
   the pressed pitch becomes the root of the chord */
function pressKey(pc) {
  getContext();

  const chord = buildChord(pc, chordType);

  heldKeys.add(pc);
  lastChord = chord;
  markKeysActive();

  stopOscs(previewOscs);
  previewOscs = previewChord(chord, octave, waveform);

  const axis = getAxis(tonic);
  const mirror = invertChord(chord, axis);
  tonnetz.update({ tonic, axis, highlighted: chord, mirrored: mirror });
}

function releaseKey(pc) {
  heldKeys.delete(pc);
  markKeysActive();

  if (heldKeys.size === 0) {
    stopOscs(previewOscs);
    previewOscs = [];
    tonnetz.update({ tonic, axis: getAxis(tonic), highlighted: [], mirrored: [] });
  }
}

/* add/remove .active class on key elements to match heldKeys */
function markKeysActive() {
  document.querySelectorAll(".key-white, .key-black").forEach(el => {
    const pc = parseInt(el.dataset.pc);
    el.classList.toggle("active", heldKeys.has(pc));
  });
}


/* ── tonic highlight ── */

/* mark whichever key matches the current tonic with .tonic class */
function updateTonicHighlight() {
  document.querySelectorAll(".key-white, .key-black").forEach(el => {
    el.classList.toggle("tonic", parseInt(el.dataset.pc) === tonic);
  });
}


/* ── progression management ── */

/* snapshot lastChord into the progression */
function addChord() {
  if (lastChord.length === 0) return;
  progression.push([...lastChord]);
  renderProgressionLists();
}

/* wipe everything */
function clearProgression() {
  stopAll();
  progression = [];
  renderProgressionLists();
  tonnetz.update({ tonic, axis: getAxis(tonic), highlighted: [], mirrored: [] });
}

/* rebuild both chord list uls from current progression state */
function renderProgressionLists() {
  const mirrors = transformProgression(progression, tonic);
  console.log("mirrors recomputed:", mirrors, "for tonic", tonic);

  originalList.innerHTML = "";
  mirrorList.innerHTML   = "";

  if (progression.length === 0) {
    originalList.innerHTML = `<li class="empty-hint">click keys above to add chords</li>`;
    mirrorList.innerHTML   = `<li class="empty-hint">mirror will appear here</li>`;
    return;
  }

  progression.forEach((chord, i) => {
    const origLi   = document.createElement("li");
    origLi.textContent = nameChord(chord) ?? chord.map(p => NOTE_NAMES[p]).join(" ");
    originalList.appendChild(origLi);

    const mirrorLi = document.createElement("li");
    mirrorLi.textContent = nameChord(mirrors[i]) ?? mirrors[i].map(p => NOTE_NAMES[p]).join(" ");
    mirrorList.appendChild(mirrorLi);
  });
}

/* highlight the chord at index i in both lists + on the tonnetz */
function setPlayingIndex(i) {
  document.querySelectorAll("#original-list li").forEach((li, idx) => {
    li.classList.toggle("playing", idx === i);
  });
  document.querySelectorAll("#mirror-list li").forEach((li, idx) => {
    li.classList.toggle("playing", idx === i);
  });

  const axis   = getAxis(tonic);
  const mirror = transformProgression(progression, tonic);
  tonnetz.update({
    tonic,
    axis,
    highlighted: progression[i] ?? [],
    mirrored:    mirror[i]       ?? [],
  });
}

/* clear playing highlights from both lists */
function clearPlayingIndex() {
  document.querySelectorAll("#original-list li, #mirror-list li")
    .forEach(li => li.classList.remove("playing"));
  tonnetz.update({ tonic, axis: getAxis(tonic), highlighted: [], mirrored: [] });
}


/* ── playback handlers ── */

function handlePlayOriginal() {
  if (progression.length === 0) return;
  playProgression(progression, {
    bpm, octave, waveform,
    onStep: i  => setPlayingIndex(i),
    onEnd:  () => clearPlayingIndex(),
  });
}

function handlePlayMirror() {
  if (progression.length === 0) return;
  const mirrors = transformProgression(progression, tonic);
  playProgression(mirrors, {
    bpm, octave, waveform,
    onStep: i  => setPlayingIndex(i),
    onEnd:  () => clearPlayingIndex(),
  });
}

function handlePlayBoth() {
  if (progression.length === 0) return;
  const mirrors = transformProgression(progression, tonic);
  playBoth(progression, mirrors, {
    bpm, octave, waveform,
    onStep: i  => setPlayingIndex(i),
    onEnd:  () => clearPlayingIndex(),
  });
}

function handleStop() {
  stopAll();
  clearPlayingIndex();
}


/* ── control listeners ── */

keySelect.addEventListener("change", e => {
  tonic = parseInt(e.target.value);
  console.log("tonic now:", tonic, "axis:", getAxis(tonic));
  updateTonicHighlight();
  renderProgressionLists();
  tonnetz.update({ tonic, axis: getAxis(tonic), highlighted: [], mirrored: [] });
});

octaveSelect.addEventListener("change",     e => { octave    = parseInt(e.target.value); });
waveformSelect.addEventListener("change",   e => { waveform  = e.target.value; });
chordTypeSelect.addEventListener("change",  e => { chordType = e.target.value; });
tempoInput.addEventListener("input",        e => { bpm       = parseInt(e.target.value) || 80; });

btnAddChord.addEventListener("click",     addChord);
btnClear.addEventListener("click",        clearProgression);
btnPlayOriginal.addEventListener("click", handlePlayOriginal);
btnPlayMirror.addEventListener("click",   handlePlayMirror);
btnPlayBoth.addEventListener("click",     handlePlayBoth);
btnStop.addEventListener("click",         handleStop);


/* ── init ── */

tonnetz = new TonnetzRenderer(tonnetzCanvas);
buildKeyboard();
tonnetz.update({ tonic, axis: getAxis(tonic), highlighted: [], mirrored: [] });