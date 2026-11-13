import * as THREE from 'three';
import { buildWorld } from './world.js';
import { buildArc, loadArcMonument } from './arc.js';
import { Car } from './car.js';
import { Controls } from './controls.js';
import { Traffic } from './traffic.js';
import { QuestManager, createArcLapQuest, createSpeedQuest } from './quests.js';
import { truckHonk } from './audio.js';
import { placeBuildings } from './buildings.js';
import { isMobile } from './device.js';

const app = document.getElementById('app');
// Auf Mobilgeraeten sparsamer rendern: MSAA + hohe Aufloesung + weiche
// Schatten treiben mobile GPUs sonst leicht in Kontext-Verlust.
// isMobile kommt aus device.js (pointer: coarse ODER mobile UA).
// Schatten sind auf Mobilgeraeten standardmaessig AUS: auf manchen Android-
// GPUs (z.B. Pixel 10/Chrome) killt der Shadow-Pass den WebGL-Kontext direkt
// beim Start (webglcontextlost ohne webglcontextrestored) — ohne Schatten
// laeuft es stabil. Debug-Parameter: ?shadow (Schatten auf Mobil erzwingen),
// ?noshadow (auf Desktop abschalten), ?scale=0.7 (Aufloesung reduzieren).
const qs = new URLSearchParams(location.search);
const resScale = Math.min(1, parseFloat(qs.get('scale')) || 1);
const shadowsOff = qs.has('noshadow') || (isMobile && !qs.has('shadow'));
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, stencil: false, powerPreference: 'high-performance' });
// Basis-Aufloesung (Mobil: auf 1x begrenkt). adaptScale (in der Hauptschleife)
// reduziert die Aufloesung auf schwachen Geraeten automatisch weiter, statt
// nur ruckelig zu laufen.
const basePixelRatio = Math.min(window.devicePixelRatio, isMobile ? 1 : 2) * resScale;
let adaptScale = 1;
renderer.setPixelRatio(basePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !shadowsOff;
renderer.shadowMap.type = isMobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

// GPU-Kontext verloren (z.B. zu wenig GPU-Speicher auf dem Telefon)?
// preventDefault() erlaubt die Wiederherstellung; three.js initialisiert den
// GL-Kontext bei 'webglcontextrestored' selbst neu und laedt alle Texturen/
// Puffer beim naechsten Render automatisch wieder hoch. Erst wenn die
// Wiederherstellung ausbleibt, wird Neuladen angeboten.
let reloadFallbackTimer = null;
// Optionaler On-Screen-Log (?log in der URL): schreibt Warnungen zusaetzlich
// unten ins Bild, damit man sie auf dem Handy ohne Remote-Debugging sieht.
const debugOnScreen = qs.has('log');
function debugLog(...args) {
  console.warn(...args);
  if (!debugOnScreen) return;
  let el = document.getElementById('debuglog');
  if (!el) {
    el = document.createElement('div');
    el.id = 'debuglog';
    el.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:99;max-width:94vw;font:10px monospace;color:#ffd27a;background:rgba(0,0,0,.7);padding:4px 6px;border-radius:6px;pointer-events:none;white-space:pre-wrap;';
    document.body.appendChild(el);
  }
  el.textContent = (el.textContent + '\n' + args.join(' ')).split('\n').slice(-8).join('\n');
}
renderer.domElement.addEventListener('webglcontextcreationerror', (e) => {
  debugLog('[webgl] creation error:', e.statusMessage || '(kein statusMessage)');
});
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  // Diagnose: wie viele Texturen/Geometrien/Programme hielt der Kontext zuletzt?
  debugLog('[webgl] LOST', new Date().toISOString(), JSON.stringify(renderer.info.memory), JSON.stringify(renderer.info.render));
  const loading = document.getElementById('loading');
  loading.classList.remove('done');
  document.getElementById('loadtext').textContent = 'Grafik wurde unterbrochen - wird wiederhergestellt …';
  clearTimeout(reloadFallbackTimer);
  reloadFallbackTimer = setTimeout(() => {
    document.getElementById('loadtext').textContent = 'Grafik wurde unterbrochen - bitte neu laden';
    loading.addEventListener('click', () => location.reload(), { once: true });
  }, 8000);
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  clearTimeout(reloadFallbackTimer);
  debugLog('[webgl] RESTORED', new Date().toISOString());
  document.getElementById('loading').classList.add('done');
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Im Menue rendert die Hauptschleife nicht: Standbild einmal auffrischen.
  if (state === 'menu') renderer.render(scene, camera);
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec3e8);
scene.fog = new THREE.Fog(0x8ec3e8, 70, 260);

// Far plane knapp ueber der Nebelgrenze (scene.fog endet bei 260): alles
// dahinter ist restlos Hintergrundfarbe und wird von der Frustum-Cullung
// komplett weggelassen — ein massiver Gewinn auf aelteren iPad-GPUs, die
// sonst unsichtbare Dreiecke mitladen.
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 300);

// --- Licht ---
scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x51604a, 0.9));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 512 : 2048, isMobile ? 512 : 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 220;
const sc = 60;
sun.shadow.camera.left = -sc;
sun.shadow.camera.right = sc;
sun.shadow.camera.top = sc;
sun.shadow.camera.bottom = -sc;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// --- Welt, Auto, Steuerung ---
const world = buildWorld(scene);
const arc = buildArc(scene);
const car = new Car(scene);
const controls = new Controls();

// --- Verkehr auf dem Kreisverkehr (alle Quests starten mit 30 Autos) ---
const START_TRAFFIC = 30;
const traffic = new Traffic(scene, arc);
traffic.setTarget(START_TRAFFIC);

// --- Quests ---
const ROUNDS_TARGET = 5;
const quests = new QuestManager();
quests.add(createArcLapQuest(arc, traffic, { target: ROUNDS_TARGET, startTraffic: START_TRAFFIC }));
quests.add(createSpeedQuest({ target: 100 }));

// --- Spielzustand: 'menu' | 'playing' | 'success' ---
let state = 'menu';
let activeQuest = null;

const questEl = document.getElementById('quest');
const toastEl = document.getElementById('toast');
const menuEl = document.getElementById('menu');
const menuQuestsEl = document.getElementById('menu-quests');
const menuHighscoreEl = document.getElementById('menu-highscore');
const successEl = document.getElementById('success');
const successTimeEl = document.getElementById('success-time');
const successHsEl = document.getElementById('success-highscore');
let toastTimer = null;

// --- Zeitmessung & Highscore (bleibt ueber Sitzungen gespeichert) ---
const HS_KEY = 'camperHansHighscore';
const DONE_KEY = 'camperHansQuestsDone';
const timeEl = document.getElementById('time');
const highscoreEl = document.getElementById('highscore');
let elapsed = 0;
let timerRunning = false;

function loadHighscore() {
  const v = parseFloat(localStorage.getItem(HS_KEY));
  return Number.isFinite(v) ? v : null;
}
function fmtTime(t) {
  return `${t.toFixed(1)} s`;
}
function renderHighscore() {
  const hs = loadHighscore();
  const txt = hs === null ? 'Highscore: –' : `Highscore: ${fmtTime(hs)}`;
  highscoreEl.textContent = txt;
  menuHighscoreEl.textContent = txt;
}

function loadDone() {
  try { return JSON.parse(localStorage.getItem(DONE_KEY)) || []; } catch { return []; }
}
function saveDone(id) {
  const d = loadDone();
  if (!d.includes(id)) {
    d.push(id);
    localStorage.setItem(DONE_KEY, JSON.stringify(d));
  }
}
function isDone(id) {
  return loadDone().includes(id);
}

// --- Hauptmenue: Uebersicht ueber alle Quests mit Status ---
function renderMenu() {
  menuQuestsEl.innerHTML = quests.quests.map((q) => {
    const done = isDone(q.id);
    return `<div class="menu-quest${done ? ' done' : ''}">
      <div class="mq-head"><span class="mq-title">${q.title}</span><span class="mq-badge">${done ? 'Erledigt' : 'Offen'}</span></div>
      <div class="mq-desc">${q.desc}</div>
      <button class="mq-start" data-id="${q.id}">${done ? 'Erneut starten' : 'Starten'}</button>
    </div>`;
  }).join('');
  menuQuestsEl.querySelectorAll('button[data-id]').forEach((b) => {
    b.addEventListener('click', () => startQuest(quests.quests.find((q) => q.id === b.dataset.id)));
  });
  renderHighscore();
}

function renderQuest() {
  if (!activeQuest) { questEl.innerHTML = ''; return; }
  const q = activeQuest;
  const pct = Math.min(100, (q.progress / q.target) * 100);
  const extra = q.extra ? `<div class="q-text">${q.extra()}</div>` : '';
  questEl.innerHTML = `<div class="quest${q.completed ? ' done' : ''}">
    <div class="q-title">${q.title}</div>
    <div class="q-desc">${q.desc}</div>
    <div class="q-bar"><div class="q-fill" style="width:${pct}%"></div></div>
    <div class="q-text">${q.completed ? 'Erledigt!' : `${q.progress} / ${q.target}`}</div>
    ${extra}
  </div>`;
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

function startQuest(q) {
  activeQuest = q;
  q.reset();
  car.reset();
  traffic.setTarget(0); // alle Autos weg, damit die Verteilung 10/10/10 von vorne beginnt
  traffic.setTarget(START_TRAFFIC);
  elapsed = 0;
  timerRunning = true;
  state = 'playing';
  menuEl.classList.add('hidden');
  successEl.classList.add('hidden');
  renderQuest();
}

function toMenu() {
  state = 'menu';
  activeQuest = null;
  timerRunning = false;
  successEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
  renderMenu();
  renderQuest();
  // Ein Standbild hinter dem (fast deckenden) Menue genuegt; die Hauptschleife
  // rendert im Menue-Zustand nicht weiter.
  renderer.render(scene, camera);
}

quests.on('progress', (q) => {
  if (q.id === 'arc-de-triomphe' && activeQuest === q) {
    traffic.setTarget(START_TRAFFIC + q.progress * 5); // pro Runde +5 Autos
  }
  renderQuest();
});

quests.on('completed', (q) => {
  timerRunning = false;
  saveDone(q.id);
  state = 'success';
  successTimeEl.textContent = `Zeit: ${fmtTime(elapsed)}`;
  if (q.id === 'arc-de-triomphe') {
    const hs = loadHighscore();
    if (hs === null || elapsed < hs) {
      localStorage.setItem(HS_KEY, String(elapsed));
      successHsEl.textContent = `Neuer Highscore: ${fmtTime(elapsed)}!`;
    } else {
      successHsEl.textContent = `Highscore: ${fmtTime(hs)}`;
    }
  } else {
    successHsEl.textContent = '';
  }
  renderHighscore();
  renderQuest();
  successEl.classList.remove('hidden');
});

document.getElementById('btn-to-menu').addEventListener('click', toMenu);

controls.onReset = () => {
  car.reset();
  if (activeQuest) activeQuest.onCarReset();
  elapsed = 0;
  timerRunning = state === 'playing';
};
controls.onHonk = () => truckHonk();
controls.onEscape = () => {
  if (state === 'playing' || state === 'success') toMenu(); // Quest abbrechen -> Startbildschirm
};

renderHighscore();
renderMenu();

const loading = document.getElementById('loading');
const loadtext = document.getElementById('loadtext');

// Wird nach dem Laden befüllt (siehe try-Block weiter unten).
const allColliders = [];        // Collider-Liste, einmalig statt concat() pro Frame
const staticCullables = [];    // Gebaeude + Monument, fuer Distanz-Culling
let monument = null;

// Distanz-Culling: der Nebel verschluckt alles ab ~260 Einheiten, weiter
// entfernte Objekte sind also garantiert unsichtbar und muessen nicht
// gezeichnet werden. Die Pruefung pro Frame ist O(n) und spart auf
// aelteren Tablets den Grossteil der Draw Calls und Dreiecke.
const CULL_DIST2 = 290 * 290; // kleiner Puffer ueber der Nebelgrenze
function cullByDistance(px, pz) {
  for (const o of staticCullables) {
    const dx = o.position.x - px, dz = o.position.z - pz;
    o.visible = dx * dx + dz * dz < CULL_DIST2;
  }
  for (const t of traffic.cars) {
    const dx = t.mesh.position.x - px, dz = t.mesh.position.z - pz;
    t.mesh.visible = dx * dx + dz * dz < CULL_DIST2;
  }
}

try {
  await car.load('assets/campervan-optimized.glb', (e) => {
    if (e.total) loadtext.textContent = `Lade Campervan … ${Math.round((e.loaded / e.total) * 100)} %`;
  });
  await traffic.loadCarModels((i, n) => {
    loadtext.textContent = `Lade Autos … ${i}/${n}`;
  });
  loadtext.textContent = 'Lade Arc de Triomphe …';
  monument = await loadArcMonument(scene, arc.cx, arc.cz);
  const { buildings } = await placeBuildings(scene, world, arc, (i, n) => {
    loadtext.textContent = `Lade Gebäude … ${i}/${n}`;
  });
  staticCullables.push(...buildings, monument);
  allColliders.push(...world.colliders, ...arc.colliders);
} catch (err) {
  loadtext.textContent = 'Fehler beim Laden der Modelle: ' + err.message;
  throw err;
}
loading.classList.add('done');
// Vor dem ersten Menue einmal rendern: die Hauptschleife pausiert im Menue.
placeCameraBehindCar();
renderer.render(scene, camera);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (state === 'menu') renderer.render(scene, camera); // Standbild auffrischen
});

// --- Chase-Kamera ---
const desired = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
function placeCameraBehindCar() {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  camera.position.set(car.pos.x - fx * 9, 4.4, car.pos.z - fz * 9);
  camera.lookAt(car.pos.x + fx * 7, 1.8, car.pos.z + fz * 7);
}
placeCameraBehindCar();

// --- Hauptschleife ---
const clock = new THREE.Clock();
const speedValEl = document.getElementById('speed-val');

// Die Km/h-Anzeige nur neu schreiben, wenn sich der gerundete Wert
// geaendert hat (vorher: innerHTML-Neuaufbau jeden Frame, was Safari
// auf dem iPad messbar bremsen kann).
let lastKmh = -1;

// Adaptive Aufloesung (nur Mobil): bleibt der FPS-Schnitt dauerhaft unter
// ~45, sinkt die Render-Aufloesung stufenweise bis auf 55% ab. Ruckeln
// wird so gegen eine etwas weichere Kante getauscht — das Bild bleibt
// fluessig, das Geraet entscheidet selbst, wie viel Pixel es schafft.
let perfTime = 0;
let perfFrames = 0;
let logTime = 0;
let logFrames = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // Das Menue ueberdeckt die Szene zu 93%: keine Simulation, kein Render.
  // Ein Standbild genuegt (siehe toMenu()); die GPU darf Pause machen.
  if (state === 'menu') return;

  // Im Menue/Erfolgsbildschirm laeuft die Simulation nicht weiter
  if (state === 'playing') {
    traffic.update(dt, car);
    // Verkehrs-Colliders bewusst nicht hier: ein treffendes Auto prallt zurueck,
    // der Van wird nicht verschoben (siehe traffic.update).
    car.update(dt, controls.state, allColliders, world.half, arc);
    if (activeQuest) activeQuest.update(dt, { car, arc }, quests);

    if (timerRunning) elapsed += dt;
    timeEl.textContent = `Zeit: ${fmtTime(elapsed)}`;
  }

  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  if (state === 'success' && activeQuest && activeQuest.id === 'arc-de-triomphe') {
    // Quest 1 geschafft: Bild bleibt stehen (keine Simulation mehr), die
    // Kamera faehrt nach hinten/oben und etwas zur Aussenseite des Kreises,
    // sodass der Arc de Triomphe im Hintergrund zu sehen ist.
    const dx = car.pos.x - arc.cx;
    const dz = car.pos.z - arc.cz;
    const d = Math.hypot(dx, dz) || 1;
    const ox = dx / d, oz = dz / d; // radial nach aussen
    desired.set(car.pos.x + ox * 14 - fx * 4, 9.5, car.pos.z + oz * 14 - fz * 4);
    camera.position.lerp(desired, 1 - Math.exp(-2.2 * dt));
    lookTarget.set(car.pos.x - ox * 6, 2.2, car.pos.z - oz * 6); // Blick ueber den Van zum Arc
    camera.lookAt(lookTarget);
  } else {
    desired.set(car.pos.x - fx * 9, 4.4, car.pos.z - fz * 9);
    camera.position.lerp(desired, 1 - Math.exp(-6 * dt));
    lookTarget.set(car.pos.x + fx * 7, 1.8, car.pos.z + fz * 7);
    camera.lookAt(lookTarget);
  }

  const targetFov = 62 + Math.min(Math.abs(car.speed) * 0.45, 12);
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * 0.1;
    camera.updateProjectionMatrix();
  }

  // Sonne (und Schatten) folgt dem Auto
  sun.position.set(car.pos.x + 45, 70, car.pos.z + 25);
  sun.target.position.set(car.pos.x, 0, car.pos.z);
  sun.target.updateMatrixWorld();

  const kmh = Math.round(Math.abs(car.speed) * 3.6);
  if (kmh !== lastKmh) {
    lastKmh = kmh;
    speedValEl.textContent = kmh;
  }

  // Objekte hinter dem Nebel verstecken (spart Draw Calls und Dreiecke)
  // und Statistik fuer ?log sammeln.
  cullByDistance(camera.position.x, camera.position.z);

  renderer.render(scene, camera);

  perfTime += dt;
  perfFrames++;
  logTime += dt;
  logFrames++;
  if (isMobile && perfTime >= 2) {
    const fps = perfFrames / perfTime;
    if (fps < 45 && adaptScale > 0.55) {
      adaptScale = Math.max(0.55, adaptScale * 0.85);
      renderer.setPixelRatio(basePixelRatio * adaptScale);
    }
    perfTime = 0;
    perfFrames = 0;
  }
  if (logTime >= 5) {
    const fps = logFrames / logTime;
    logTime = 0;
    logFrames = 0;
    if (debugOnScreen) {
      const r = renderer.info.render;
      debugLog(`fps=${fps.toFixed(0)} draws=${r.calls} tris=${((r.triangles / 1000) | 0)}k scale=${Math.round(adaptScale * 100)}%`);
    }
  }
}
animate();

// Debug-/Test-Zugang
window.__game = { scene, camera, renderer, car, controls, world, arc, traffic, quests, get state() { return state; }, startQuest, toMenu };
