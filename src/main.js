import * as THREE from 'three';
import { buildWorld } from './world.js';
import { buildArc, loadArcMonument } from './arc.js';
import { Car } from './car.js';
import { Gespann } from './gespann.js';
import { Controls } from './controls.js';
import { Traffic } from './traffic.js';
import { QuestManager, createArcLapQuest, createSpeedQuest } from './quests.js';
import { truckHonk } from './audio.js';
import { placeBuildings } from './buildings.js';
import { isMobile } from './device.js';
import { applyView } from './views.js';

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
const campervan = new Car(scene);
const gespann = new Gespann(scene);
let car = campervan; // aktives Fahrzeug, im Menue umschaltbar
const controls = new Controls();

// --- Fahrzeugauswahl (bleibt ueber Sitzungen gespeichert) ---
const VEHICLE_KEY = 'camperHansVehicle';
function storedVehicle() {
  try {
    return localStorage.getItem(VEHICLE_KEY) === 'gespann' ? 'gespann' : 'campervan';
  } catch { return 'campervan'; }
}
function setVehicle(id) {
  car = id === 'gespann' ? gespann : campervan;
  campervan.group.visible = id !== 'gespann';
  gespann.group.visible = id === 'gespann';
  gespann.trailerGroup.visible = id === 'gespann';
  car.reset();
  try { localStorage.setItem(VEHICLE_KEY, id); } catch { /* Private Mode o. ae. */ }
  document.querySelectorAll('.veh-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.veh === id);
  });
}
document.querySelectorAll('.veh-btn').forEach((b) => {
  b.addEventListener('click', () => setVehicle(b.dataset.veh));
});
setVehicle(storedVehicle());

// --- Verkehr auf dem Kreisverkehr (alle Quests starten mit 30 Autos) ---
const START_TRAFFIC = 30;
const traffic = new Traffic(scene, arc);
traffic.setTarget(START_TRAFFIC);

// --- Quests ---
const ROUNDS_TARGET = 5;
const quests = new QuestManager();
quests.add(createArcLapQuest(arc, traffic, { target: ROUNDS_TARGET, startTraffic: START_TRAFFIC }));
quests.add(createSpeedQuest({ target: 100 }));

// --- Spielzustand: 'menu' | 'playing' | 'success' | 'failed' ---
let state = 'menu';
let activeQuest = null;
let failTimer = 0; // laeuft nach Umkippen/Abreissen, bis der Scheitern-Bildschirm kommt

const questEl = document.getElementById('quest');
const toastEl = document.getElementById('toast');
const menuEl = document.getElementById('menu');
const menuQuestsEl = document.getElementById('menu-quests');
const menuHighscoreEl = document.getElementById('menu-highscore');
const successEl = document.getElementById('success');
const successTimeEl = document.getElementById('success-time');
const successHsEl = document.getElementById('success-highscore');
const failedEl = document.getElementById('failed');
const failReasonEl = document.getElementById('fail-reason');
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
      <div class="mq-head"><span class="mq-title">${q.title}</span><span class="ch-badge${done ? ' ch-badge-forest' : ' ch-badge-sun'}">${done ? 'Erledigt' : 'Offen'}</span></div>
      <div class="mq-desc">${q.desc}</div>
      <button class="ch-btn ch-btn-primary mq-start" data-id="${q.id}">${done ? 'Erneut starten' : 'Starten'}</button>
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
  failTimer = 0;
  car.reset();
  traffic.setTarget(0); // alle Autos weg, damit die Verteilung 10/10/10 von vorne beginnt
  traffic.setTarget(START_TRAFFIC);
  elapsed = 0;
  timerRunning = true;
  state = 'playing';
  introT = 0; // Kamerafahrt: schraeg von vorne auf die Chase-Position
  menuEl.classList.add('hidden');
  successEl.classList.add('hidden');
  failedEl.classList.add('hidden');
  renderQuest();
}

// Kippen bzw. Abreissen beendet die Quest: kurz den Schwenk/Bruch zeigen,
// dann Scheitern-Bildschirm mit Neustart.
function failQuest(reason) {
  timerRunning = false;
  state = 'failed';
  failReasonEl.textContent = reason;
  failedEl.classList.remove('hidden');
  renderQuest();
}

function retryQuest() {
  if (activeQuest) startQuest(activeQuest);
  else toMenu();
}

function toMenu() {
  state = 'menu';
  activeQuest = null;
  timerRunning = false;
  successEl.classList.add('hidden');
  failedEl.classList.add('hidden');
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
  if (state === 'failed') { retryQuest(); return; } // R im Scheitern-Bildschirm = Neustart
  car.reset();
  if (activeQuest) activeQuest.onCarReset();
  elapsed = 0;
  timerRunning = state === 'playing';
  failTimer = 0;
};
controls.onHonk = () => truckHonk();

// --- Kamera-Ansichten (Taste C): 0 Standard, 1 First Person, 2 hinten links ---
let viewMode = 0;
controls.onCycleView = () => {
  viewMode = (viewMode + 1) % 3;
};

// --- First-Person-Tuning (?debugcam in der URL) ---------------------------
// I/K = Augenhoehe hoch/runter, J/L = Sitz vor/zurueck (Shift = fein, 0.01).
// Das HUD zeigt die Werte zum Zurueckmelden; jede Aenderung zusaetzlich in
// die Konsole. Ohne den URL-Parameter ist das Spiel unveraendert.
const debugCam = qs.has('debugcam');
let camDebugEl = null;
if (debugCam) {
  window.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.01 : 0.05;
    let changed = false;
    if (e.code === 'KeyI') { car.seatY += step; changed = true; }
    else if (e.code === 'KeyK') { car.seatY -= step; changed = true; }
    else if (e.code === 'KeyL') { car.seatFwd += step; changed = true; }
    else if (e.code === 'KeyJ') { car.seatFwd -= step; changed = true; }
    if (changed) {
      console.log(`[fpv] seatY=${car.seatY.toFixed(2)} seatFwd=${car.seatFwd.toFixed(2)} sizeY=${(car.modelSize?.y ?? 0).toFixed(2)}`);
    }
  });
  camDebugEl = document.createElement('div');
  camDebugEl.style.cssText = 'position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:99;font:12px monospace;color:#ffd27a;background:rgba(0,0,0,.75);padding:6px 10px;border-radius:6px;pointer-events:none;white-space:pre;text-align:center;';
  document.body.appendChild(camDebugEl);
}
controls.onEscape = () => {
  if (state !== 'menu') toMenu(); // Quest abbrechen / Scheitern-Bildschirm -> Startbildschirm
};

// Kippen oder Abreissen zeigt zunaechst einen Toast; die Quest scheitert
// kurz danach (failTimer in der Hauptschleife), damit man den Sturz noch sieht.
campervan.onTip = () => showToast('Umgekippt! Die Quest ist gescheitert …');
gespann.onTip = () => showToast('Umgekippt! Die Quest ist gescheitert …');
gespann.onBreakoff = () => showToast('Der Wohnwagen ist abgerissen!');

document.getElementById('btn-retry').addEventListener('click', retryQuest);
document.getElementById('btn-fail-menu').addEventListener('click', toMenu);

renderHighscore();
renderMenu();

const loading = document.getElementById('loading');
const loadtext = document.getElementById('loadtext');
try {
  await campervan.load('assets/3d/campervan-optimized.glb', (e) => {
    if (e.total) loadtext.textContent = `Lade Campervan … ${Math.round((e.loaded / e.total) * 100)} %`;
  });
  loadtext.textContent = 'Lade Gespann …';
  await gespann.load();
  await traffic.loadCarModels((i, n) => {
    loadtext.textContent = `Lade Autos … ${i}/${n}`;
  });
  loadtext.textContent = 'Lade Arc de Triomphe …';
  await loadArcMonument(scene, arc.cx, arc.cz);
  await placeBuildings(scene, world, arc, (i, n) => {
    loadtext.textContent = `Lade Gebäude … ${i}/${n}`;
  });
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
// --- Kamerafahrt bei Quest-Start ---
// Beginnt schraeg vor dem Fahrzeug (Blick auf das Fahrzeug) und schwenkt auf
// einem Kreisbogen um das Fahrzeug in die normale Chase-Position (Blick nach
// vorn). Pose in Polarkoordinaten um das Fahrzeug: Winkel relativ zur
// Fahrtrichtung, ~0.56 rad (32 Grad) seitlich vor der Front.
const INTRO_DURATION = 2.6; // Sekunden
let introT = 1;              // Fortschritt 0..1; 1 = Fahrt beendet
const INTRO_ANGLE = Math.atan2(5, 8); // Startwinkel vor der Front (seitlich)
const INTRO_RADIUS = Math.hypot(8, 5); // ~9.43, passend zur Front-Ansicht
const INTRO_HEIGHT = 2.6;
const CHASE_RADIUS = 9;
const CHASE_HEIGHT = 4.4;
const introLook = new THREE.Vector3();
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
    // Reihenfolge: erst den Van bewegen, dann den Verkehr. traffic.update
    // trennt den Van danach von getroffenen Autos ab (Positionskorrektur +
    // Bounce), damit nichts ineinander verschwinden kann.
    car.update(dt, controls.state, world.colliders.concat(arc.colliders), world.half, arc);
    // colliders/worldHalf: dafuer die Kollision des abgerissenen Wohnwagens
    // mit Hindernissen und Welt-Grenze (siehe traffic.update).
    traffic.update(dt, car, world.colliders.concat(arc.colliders), world.half);
    if (activeQuest) activeQuest.update(dt, { car, arc }, quests);

    // Umgekippt oder Wohnwagen abgerissen? Kurz zeigen, dann ist die
    // Quest gescheitert (Scheitern-Bildschirm mit Neustart).
    if (car.tipped || car.detached) {
      failTimer += dt;
      if (failTimer > 1.2) {
        failQuest(
          car.detached
            ? 'Der Wohnwagen ist abgerissen – nächstes Mal früher vom Gas.'
            : 'Das Fahrzeug ist umgekippt!'
        );
      }
    }

    if (timerRunning) elapsed += dt;
    timeEl.textContent = `Zeit: ${fmtTime(elapsed)}`;
  }

  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  // Ansicht 1/2 (Taste C): views.js setzt die Kamera; nur die Standard-
  // Ansicht durchlaeuft die folgenden Zwoege (Erfolg/Schwenk/Verfolgung).
  if (viewMode !== 0 && state !== 'menu') {
    applyView(camera, car, viewMode, 1 - Math.exp(-6 * dt));
  } else if (state === 'success' && activeQuest && activeQuest.id === 'arc-de-triomphe') {
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
    lookTarget.set(car.pos.x + fx * 7, 1.8, car.pos.z + fz * 7);
    if (introT < 1) {
      // Kamerafahrt nach dem Quest-Start: Kreisbogen um das Fahrzeug vom
      // Startwinkel (32 Grad vor der Front, Blick auf das Fahrzeug) bis
      // hinter das Auto (Chase-Pose). Winkel, Radius und Hoehe gehen per
      // Smoothstep ueber, das Blickziel wandert vom Auto auf die Fahrbahn.
      introT = Math.min(1, introT + dt / INTRO_DURATION);
      const e = introT * introT * (3 - 2 * introT); // smoothstep: weich an/aus
      const h = car.heading;
      const a = h + INTRO_ANGLE + (Math.PI - INTRO_ANGLE) * e;
      const r = INTRO_RADIUS + (CHASE_RADIUS - INTRO_RADIUS) * e;
      const y = INTRO_HEIGHT + (CHASE_HEIGHT - INTRO_HEIGHT) * e;
      camera.position.set(car.pos.x + Math.sin(a) * r, y, car.pos.z + Math.cos(a) * r);
      introLook.set(car.pos.x, 1.4, car.pos.z).lerp(lookTarget, e);
      camera.lookAt(introLook);
    } else {
      camera.position.lerp(desired, 1 - Math.exp(-6 * dt));
      camera.lookAt(lookTarget);
    }
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

  if (camDebugEl) {
    const veh = car === campervan ? 'Campervan' : 'Peugeot-Gespann';
    camDebugEl.textContent =
      `FPV-Tuning (${veh})  I/K Höhe  J/L vor/zurück  C Ansicht (${viewMode})\n` +
      `seatY=${car.seatY.toFixed(2)}  seatFwd=${car.seatFwd.toFixed(2)}  Modell sizeY=${(car.modelSize?.y ?? 0).toFixed(2)}\n` +
      `Kamera ${camera.position.x.toFixed(1)} / ${camera.position.y.toFixed(2)} / ${camera.position.z.toFixed(1)}  Auto ${car.pos.x.toFixed(1)} / ${car.pos.z.toFixed(1)}`;
  }

  renderer.render(scene, camera);
}
animate();

// Debug-/Test-Zugang
window.__game = { scene, camera, renderer, get car() { return car; }, controls, world, arc, traffic, quests, get state() { return state; }, startQuest, toMenu };
