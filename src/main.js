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
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 2) * resScale);
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
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec3e8);
scene.fog = new THREE.Fog(0x8ec3e8, 70, 260);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 600);

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
try {
  // await car.load('assets/campervan-optimized.glb', (e) => {
  //   if (e.total) loadtext.textContent = `Lade Campervan … ${Math.round((e.loaded / e.total) * 100)} %`;
  // });
  // await traffic.loadCarModels((i, n) => {
  //   loadtext.textContent = `Lade Autos … ${i}/${n}`;
  // });
  // loadtext.textContent = 'Lade Arc de Triomphe …';
  // await loadArcMonument(scene, arc.cx, arc.cz);
  // await placeBuildings(scene, world, arc, (i, n) => {
  //   loadtext.textContent = `Lade Gebäude … ${i}/${n}`;
  // });
} catch (err) {
  loadtext.textContent = 'Fehler beim Laden der Modelle: ' + err.message;
  throw err;
}
loading.classList.add('done');

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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
const speedEl = document.getElementById('speed');

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // Im Menue/Erfolgsbildschirm laeuft die Simulation nicht weiter
  if (state === 'playing') {
    traffic.update(dt, car);
    // Verkehrs-Colliders bewusst nicht hier: ein treffendes Auto prallt zurueck,
    // der Van wird nicht verschoben (siehe traffic.update).
    car.update(dt, controls.state, world.colliders.concat(arc.colliders), world.half, arc);
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

  speedEl.innerHTML = `${Math.round(Math.abs(car.speed) * 3.6)} <small>km/h</small>`;

  renderer.render(scene, camera);
}
animate();

// Debug-/Test-Zugang
window.__game = { scene, camera, renderer, car, controls, world, arc, traffic, quests, get state() { return state; }, startQuest, toMenu };
