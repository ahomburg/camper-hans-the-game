// Hupen als MP3-Dateien: car1/car2/car3_horn.mp3 fuer die Verkehrsautos,
// campervan_horn.mp3 fuer den Van (Taste H). Die WebAudio-Synthese bleibt
// als Fallback, falls eine Datei nicht geladen werden kann.

const HORN_FILES = ['car1_horn.mp3', 'car2_horn.mp3', 'car3_horn.mp3'];
const TRUCK_HORN_FILE = 'campervan_horn.mp3';

// --- Fallback-Synthese (WebAudio) ---
let ctx = null;

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Auf erste Eingabe reagieren, damit Audio-Context UND HTMLAudio entsperrt sind.
for (const ev of ['keydown', 'pointerdown']) {
  window.addEventListener(ev, () => { ensureCtx(); unlockAudio(); }, { passive: true });
}

// freqs: Liste von Grundfrequenzen, dur: Dauer in s, gain: Lautstaerke.
function synthHonk({ freqs, dur = 0.3, gain = 0.12, type = 'square', attack = 0.01, detune = 6 }) {
  const c = ensureCtx();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime;
  const master = c.createGain();
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  master.gain.setValueAtTime(gain, t0 + dur - 0.05);
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  master.connect(c.destination);
  for (const f of freqs) {
    for (const det of [-detune, detune]) {
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      osc.detune.value = det;
      const g = c.createGain();
      g.gain.value = 1 / (freqs.length * 2);
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
  }
}

// Drei verschiedene Synthese-Hupen als Fallback fuer car1/car2/car3.
const CAR_HONKS = [
  { freqs: [392, 494], dur: 0.26, gain: 0.10, type: 'square' },
  { freqs: [330, 415], dur: 0.34, gain: 0.11, type: 'square' },
  { freqs: [262, 349], dur: 0.42, gain: 0.12, type: 'triangle' },
];

// Vorab geladene Audio-Elemente pro Datei (cloneNode zum Abspielen, damit
// mehrere Hupen gleichzeitig moeglich sind und nichts neu geladen wird).
const audioCache = {};
function getAudio(url) {
  if (!audioCache[url]) {
    const a = new Audio(url);
    a.preload = 'auto';
    audioCache[url] = a;
  }
  return audioCache[url];
}

// Entsperrt die gecachten Dateien stumm bei der ersten Nutzerinteraktion,
// damit spaetere play()-Aufrufe nicht mehr abgelehnt werden.
function unlockAudio() {
  if (typeof Audio === 'undefined') return;
  for (const url of [TRUCK_HORN_FILE, ...HORN_FILES]) {
    const a = getAudio(url).cloneNode();
    a.volume = 0;
    const p = a.play();
    if (p && p.then) p.then(() => a.pause()).catch(() => {});
  }
}

function playFile(url, volume, synthFallback) {
  if (typeof Audio === 'undefined') { synthFallback(); return; }
  const a = getAudio(url).cloneNode();
  a.volume = volume;
  let fellBack = false;
  const fb = () => { if (!fellBack) { fellBack = true; synthFallback(); } };
  // Echter Lade-/Dekodierfehler -> Synth-Fallback
  a.addEventListener('error', fb, { once: true });
  const p = a.play();
  if (p && p.catch) {
    p.catch((err) => {
      // Autoplay noch nicht erlaubt (keine Interaktion bisher): leise
      // ueberspringen, NICHT den Synth spielen – sonst klingt es im Spiel
      // voellig anders als die mp3-Dateien.
      if (err && err.name === 'NotAllowedError') return;
      fb();
    });
  }
}

// variant = 0, 1 oder 2 -> car1_horn.mp3 / car2_horn.mp3 / car3_horn.mp3
export function carHonk(variant = 0) {
  const v = ((variant % HORN_FILES.length) + HORN_FILES.length) % HORN_FILES.length;
  playFile(HORN_FILES[v], 0.7, () => synthHonk(CAR_HONKS[v]));
}

// LKW-Hupe des Campers (Taste H) -> campervan_horn.mp3
export function truckHonk() {
  playFile(TRUCK_HORN_FILE, 0.9, () =>
    synthHonk({ freqs: [196, 233], dur: 0.7, gain: 0.22, type: 'sawtooth', attack: 0.02, detune: 4 })
  );
}
