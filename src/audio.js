// Hupen als MP3-Dateien: car_mercedes/car_kaefer/car_ente.mp3 fuer die Verkehrsautos,
// campervan_horn.mp3 fuer den Van (Taste H). Die WebAudio-Synthese bleibt
// als Fallback, falls eine Datei nicht geladen werden kann.

const SOUND_DIR = 'assets/sound/';
const HORN_FILES = ['car_mercedes.mp3', 'car_kaefer.mp3', 'car_ente.mp3']
  .map((f) => SOUND_DIR + f);
const TRUCK_HORN_FILE = SOUND_DIR + 'campervan_horn.mp3';

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

// Drei verschiedene Synthese-Hupen als Fallback fuer car_mercedes/car_kaefer/car_ente.
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

// Ein-/Ausschalten der Verkehrshupen-Ducking: Laeuft das Autoradio, werden
// die Hupen der Verkehrsautos (Ente, Mercedes, Kaefer) deutlich leiser
// gezogen, damit Hans' Musik nicht uebertoent wird. main.js meldet den
// Radiostatus (siehe renderRadio).
let radioDucking = false;
export function setRadioDucking(on) { radioDucking = !!on; }

// variant = 0, 1 oder 2 -> car_mercedes.mp3 / car_kaefer.mp3 / car_ente.mp3
export function carHonk(variant = 0) {
  const v = ((variant % HORN_FILES.length) + HORN_FILES.length) % HORN_FILES.length;
  // Ducking: 0.7 auf 0.18 (deutlich leiser), Synth-Fallback im gleichen Zug
  const vol = radioDucking ? 0.18 : 0.7;
  playFile(HORN_FILES[v], vol, () =>
    synthHonk({ ...CAR_HONKS[v], gain: CAR_HONKS[v].gain * (radioDucking ? 0.3 : 1) })
  );
}

// LKW-Hupe des Campers (Taste H) -> campervan_horn.mp3.
// Hans' eigene Hupe darf immer voll aufdrehen (volume = 1).
export function truckHonk(volume = 1) {
  const vol = Math.min(1, Math.max(0, volume));
  playFile(TRUCK_HORN_FILE, vol, () =>
    synthHonk({ freqs: [196, 233], dur: 0.7, gain: 0.25 * vol, type: 'sawtooth', attack: 0.02, detune: 4 })
  );
}

// Motor-Sterben bei leerem Tank (siehe fuel.js): drei kurze, immer leiser
// und tiefer werdende Saegezahn-Hoepfer, wie wenn der Vergaser nur noch
// Luft saeuft. Rein synthetisch, kein Sample noetig.
export function engineSputter() {
  const c = ensureCtx();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime;
  for (let i = 0; i < 3; i++) {
    const t = t0 + i * 0.17;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120 - i * 28, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.13);
    const g = c.createGain();
    g.gain.setValueAtTime(0.14 - i * 0.035, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }
}

// Blitzer-Ausloeser (Kapitel 2: Hans wird beim Erreichen des Zieltempos
// geblitzt), rein synthetisch: zwei kurze Klicks (Verschluss auf/zu) ueber
// Hochpass - klingt wie ein Kamera-Ausloeser.
export function cameraShutter() {
  const c = ensureCtx();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime;
  for (const [dt, dur, freq] of [[0, 0.045, 3200], [0.09, 0.06, 2400]]) {
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const t = i / d.length;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 6);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const flt = c.createBiquadFilter();
    flt.type = 'highpass';
    flt.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = 0.35;
    src.connect(flt).connect(g).connect(c.destination);
    src.start(t0 + dt);
  }
}

// Crash-Geraeusch (Blechschaden), rein synthetisch: abklingendes Rauschen
// (Krachen) ueber Tiefpass + dumpfer Tiefton-Schlag (Aufprall-Masse).
// intensity: 0..1 nach Crash-Haerte - lauter, laenger und haerter.
export function crashSound(intensity = 0.5) {
  const c = ensureCtx();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime;
  const amp = 0.08 + Math.min(1, intensity) * 0.28;

  // 1) Blech-Krachen: weisses Rauschen mit quadratischem Abklingprofil
  const dur = 0.22 + intensity * 0.3;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    data[i] = (Math.random() * 2 - 1) * (1 - t) * (1 - t);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const flt = c.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.value = 800 + intensity * 2600; // haerter = mehr Hoell-Anteil
  const g = c.createGain();
  g.gain.value = amp;
  src.connect(flt).connect(g).connect(c.destination);
  src.start(t0);

  // 2) Dumpfer Aufprall: tiefe Sinus-Schwingung mit starkem Sweep nach unten
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(110, t0);
  osc.frequency.exponentialRampToValueAtTime(36, t0 + 0.22);
  const og = c.createGain();
  og.gain.setValueAtTime(amp * 1.25, t0);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
  osc.connect(og).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.32);
}

