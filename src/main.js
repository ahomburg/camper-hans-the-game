import * as THREE from 'three';
import { buildWorld } from './world.js';

import { buildHillsMap } from './hills.js';
import { buildNightRomeMap } from './nightrome.js';
import { buildArc, loadArcMonument } from './arc.js';
import { Car, CAR_TUNING } from './car.js';
import { Gespann } from './gespann.js';
import { Controls } from './controls.js';
import { Traffic } from './traffic.js';
import { RoadTraffic } from './roadtraffic.js';
import { ChapterManager, createArcLapChapter, createSpeedChapter, createRomeNightChapter } from './chapters.js';
import { Radio } from './radio.js';
import { truckHonk, crashSound, setRadioDucking, engineSputter, cameraShutter } from './audio.js';
import { Wallet, crashPenalty } from './coins.js';
import { Tank, TANK_MAX, FUEL_PRICE, loadFuelLevels, saveFuelLevels } from './fuel.js';
import { CrashFX } from './crashfx.js';
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
// hemi wird fuer die Kapitel-Atmosphaere gebraucht (Kapitel 3: Nacht, siehe
// applyMapAtmosphere weiter unten): Intensitaet/Farben wandern pro Map.
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x51604a, 0.9);
scene.add(hemi);
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

// --- Kapitel-Atmosphaere: Tag (Stadt/Huegelland) gegen Nacht (Kapitel 3) ---
// Kapitel 3 spielt tief in der Nacht: Das Fahrlicht des Autos ist kaputt,
// also bleibt als einzige Beleuchtung ein hauchduenner Mond/Sternenschein -
// und (falls gekauft) die Taschenlampe (Spotlight, siehe unten). Die Umschal-
// tung haengt an der AKTIVEN Map (map.night, siehe setActiveMap/ensureMap).
const DAY_ATMO = {
  bg: 0x8ec3e8, fog: 0x8ec3e8, fogNear: 70, fogFar: 260,
  hemiSky: 0xbfd9ff, hemiGround: 0x51604a, hemiInt: 0.9,
  sunColor: 0xfff2dd, sunInt: 2.2,
};
const NIGHT_ATMO = {
  bg: 0x070b14, fog: 0x0a1122, fogNear: 14, fogFar: 150,
  hemiSky: 0x22304a, hemiGround: 0x0d120c, hemiInt: 0.16,
  sunColor: 0xa9bde8, sunInt: 0.22, // schwacher Mond-Schein
};
function applyMapAtmosphere(m) {
  const a = m && m.night ? NIGHT_ATMO : DAY_ATMO;
  scene.background.set(a.bg);
  scene.fog.color.set(a.fog);
  scene.fog.near = a.fogNear;
  scene.fog.far = a.fogFar;
  hemi.color.set(a.hemiSky);
  hemi.groundColor.set(a.hemiGround);
  hemi.intensity = a.hemiInt;
  sun.color.set(a.sunColor);
  sun.intensity = a.sunInt;
}

// --- Welt, Auto, Steuerung ---
// Kapitel-Maps: Jede Map ist eine eigene Gruppe in der Szene; nur die aktive
// Map ist sichtbar. Kapitel 1 (Stadt mit Arc de Triomphe) wird hier beim
// Start gebaut; die Huegelland-Map von Kapitel 2 wird ERST beim ersten
// Auswaehlen des Kapitels geladen (Lazy Load, siehe ensureMap/startChapter).
const cityGroup = new THREE.Group();
scene.add(cityGroup);

const world = buildWorld(cityGroup);
const arc = buildArc(cityGroup);
const campervan = new Car(scene);
const gespann = new Gespann(scene);
let car = campervan; // aktives Fahrzeug, im Menue umschaltbar
const controls = new Controls();

// --- Tank: Der Van saeuft Lehr fuer Lehr - und der Tank gehoert dem Auto ---
// Jedes Fahrzeug hat einen EIGENEN 80-L-Tank (siehe fuel.js), der ueber
// Kapitel und Sitzungen gespeichert wird (localStorage): Wer ein Kapitel
// beendet, startet das naechste mit dem Restbestand - getankt wird am
// Tankstopp, nicht beim Kapitelwechsel. Der Tank leert sich mit der Zeit
// (Standgas im Stand, Vollgas richtig). Faehrt der Tank auf Reserve, blinkt
// die Tankuhr im HUD; laeuft er ganz leer, stirbt der Motor (kein Gas mehr),
// der Van rollt aus und die Fahrt haelt am Tankstopp: Eine volle
// Tankfuellung kostet FUEL_PRICE Muenzen aus der Reisekasse - ist die leer,
// uebernimmt Hans' Freund Wolfsgang grosszuegig die Rechnung (und legt still
// ein Schaefchen darauf, wie oft das schon noetig war).
const tanks = { gespann: new Tank(), campervan: new Tank() };
const storedFuel = loadFuelLevels(Object.keys(tanks));
for (const id of Object.keys(tanks)) {
  tanks[id].level = storedFuel[id];
  // Tank leer: Motor stirbt hoerbar, Gas ist weg, der Van rollt aus - sobald
  // er (fast) steht oder nach spaetestens 3 s oeffnet der Tankstopp.
  tanks[id].onEmpty = () => {
    if (state !== 'playing' || refueling) return;
    stalled = true;
    stallTimer = 0;
    engineSputter();
  };
}
let tank = tanks.gespann; // Tank des aktiven Fahrzeugs; setVehicle() schaltet um

let refueling = false;   // Tankstopp offen: Simulation + Kapitel-Timer stehen
let stalled = false;     // Motor ausgebrannt: Van rollt aus, dann erst Tankstopp
let stallTimer = 0;      // wie lange der Van schon ohne Sprit rollt
let lowFuelWarned = false; // Reserve-Toast nur einmal pro Leerfahrt
let runFuel = 0;         // Tankkosten der laufenden Fahrt (Erfolgs-/Scheitern-Screen)
let fuelSaveAcc = 0;      // 5-S-Takt: Fuellstaende unterwegs regelmaessig sichern
const WOLF_KEY = 'camperHansWolfsgang'; // wie oft Wolfsgang schon eingesprungen ist
let wolfsgang = 0;
try {
  wolfsgang = parseInt(localStorage.getItem(WOLF_KEY), 10);
  if (!Number.isFinite(wolfsgang) || wolfsgang < 0) wolfsgang = 0;
} catch { wolfsgang = 0; } // Private Mode o. ae.: nur keine Persistenz

const tankGaugeEl = document.getElementById('tank-gauge');
const tankNeedleEl = document.getElementById('tank-needle');
const tankNumEl = document.getElementById('tank-num');
const fuelstopEl = document.getElementById('fuelstop');
const fuelPriceEl = document.getElementById('fuelstop-price');
const fuelWolfEl = document.getElementById('fuelstop-wolf');
const btnRefuelEl = document.getElementById('btn-refuel');

// Alle Fuellstaende sichern (wird beim Tanken, alle 5 s unterwegs und am
// Kapitel-/Fahrtende aufgerufen).
function saveFuel() {
  saveFuelLevels({ gespann: tanks.gespann.level, campervan: tanks.campervan.level });
}

function renderFuelGauge() {
  const f = tank.fraction;
  tankNeedleEl.setAttribute('transform', `rotate(${-90 + f * 180} 60 60)`);
  tankNumEl.textContent = `${Math.ceil(tank.level)} L`;
  tankGaugeEl.classList.toggle('low', tank.low);
  tankGaugeEl.setAttribute('aria-valuenow', String(Math.round(tank.level)));
  tankGaugeEl.setAttribute('aria-valuetext', `${Math.ceil(tank.level)} von ${TANK_MAX} Litern`);
}

// Tankfuellung als Fortschrittsbalken: Startmenue-Kachel des gewaehlten
// Fahrzeugs + jede Werkstatt-Karte (jeder Balken zeigt den persistierten
// Stand seines eigenen Fahrzeugs, auch das ungewaehlte behaelt seinen Rest).
function renderVehicleFuelBadges() {
  const paint = (root, tk) => {
    if (!root || !tk) return;
    const fill = root.querySelector('.veh-fuel-fill');
    const label = root.querySelector('.veh-fuel-label');
    if (!fill || !label) return;
    fill.style.width = `${(tk.fraction * 100).toFixed(1)}%`;
    label.textContent = `⛽ ${Math.ceil(tk.level)} / ${TANK_MAX} L`;
    root.setAttribute('aria-valuenow', String(Math.ceil(tk.level)));
    root.setAttribute('aria-valuetext', `${Math.ceil(tk.level)} von ${TANK_MAX} Litern`);
    root.classList.toggle('low', tk.low);
  };
  paint(document.querySelector('#menu-vehicle-btn .veh-fuel'), tanks[selectedVehicleId]);
  document.querySelectorAll('.garage-veh').forEach((card) =>
    paint(card.querySelector('.veh-fuel'), tanks[card.dataset.veh]));
}

function openFuelStop() {
  refueling = true;
  const afford = wallet.amount >= FUEL_PRICE;
  fuelPriceEl.textContent = `Volle Tankfüllung: ${FUEL_PRICE} 🪙 · Reisekasse: ${wallet.amount} 🪙`;
  fuelWolfEl.classList.toggle('hidden', afford);
  if (!afford) {
    fuelWolfEl.innerHTML =
      `„Kein Sou in der Kasse, Hans? Kein Problem – <strong>Wolfsgang</strong> übernimmt die Rechnung!”` +
      (wolfsgang > 0 ? `<br>Schon ${wolfsgang}× ist Wolfsgang für Hans eingesprungen.` : '');
    btnRefuelEl.textContent = 'Wolfsgang, zahl mal! 🐺';
  } else {
    btnRefuelEl.textContent = `Volltanken · ${FUEL_PRICE} 🪙`;
  }
  fuelstopEl.classList.remove('hidden');
}

function refuelAndResume() {
  if (wallet.amount >= FUEL_PRICE) {
    const { paid } = wallet.deduct(FUEL_PRICE);
    runCoins -= paid;
    runFuel += paid;
    popCoin(-paid, 'Vollgetankt');
    renderCoins();
    showToast('Vollgetankt – der Van brennt wieder!');
  } else {
    wolfsgang += 1;
    try { localStorage.setItem(WOLF_KEY, String(wolfsgang)); } catch { /* Private Mode: nur keine Persistenz */ }
    showToast(`Wolfsgang springt ein (${wolfsgang}. Rechnung): „Passt schon, alter Freund!” 🐺`);
  }
  tank.fill();
  saveFuel(); // Fuellstand des eigenen Fahrzeugs gleich mit sichern
  renderFuelGauge();
  renderVehicleFuelBadges();
  lowFuelWarned = false;
  stalled = false;
  refueling = false;
  fuelstopEl.classList.add('hidden');
}

btnRefuelEl.addEventListener('click', refuelAndResume);
document.getElementById('btn-fuel-giveup').addEventListener('click', toMenu);
renderFuelGauge();

// --- Fahrzeugauswahl & Werkstatt (bleibt ueber Sitzungen gespeichert) -----
// Grundidee: Hans startet mit dem Gespann, weitere Fahrzeuge werden in der
// Werkstatt mit Muenzen aus der Reisekasse gekauft. Das Startmenue zeigt nur
// das aktuell gewaehlte Fahrzeug (Klick -> Werkstatt).
const VEHICLES = [
  { id: 'gespann', name: 'Peugeot mit Wohnwagen', price: 0 },
  { id: 'campervan', name: 'Campervan', price: 500 },
];
const VEHICLE_KEY = 'camperHansVehicle';
const OWNED_KEY = 'camperHansVehiclesOwned';

function loadOwnedVehicles() {
  try {
    const a = JSON.parse(localStorage.getItem(OWNED_KEY));
    if (Array.isArray(a) && a.length) return a;
  } catch { /* Private Mode o. ae.: dann gilt der Standardbestand */ }
  return ['gespann']; // Neustart: nur das Auto mit Wohnwagen
}
const ownedVehicles = loadOwnedVehicles();
function isOwnedVehicle(id) { return ownedVehicles.includes(id); }
function saveOwnedVehicles() {
  try { localStorage.setItem(OWNED_KEY, JSON.stringify(ownedVehicles)); } catch { /* s.o. */ }
}

function storedVehicle() {
  try {
    const id = localStorage.getItem(VEHICLE_KEY);
    return isOwnedVehicle(id) ? id : 'gespann';
  } catch { return 'gespann'; }
}
let selectedVehicleId = 'gespann';
function updateMenuVehicleName() {
  const el = document.getElementById('menu-vehicle-name');
  if (el) el.textContent = VEHICLES.find((v) => v.id === selectedVehicleId)?.name ?? '';
}
function setVehicle(id) {
  if (!isOwnedVehicle(id)) return; // nicht gekauft: nicht waehlbar
  selectedVehicleId = id;
  car = id === 'gespann' ? gespann : campervan;
  tank = tanks[id]; // der Tank gehoert dem Fahrzeug: Beim Wechsel bleibt der Rest im jeweiligen Tank stehen
  campervan.group.visible = id !== 'gespann';
  gespann.group.visible = id === 'gespann';
  gespann.trailerGroup.visible = id === 'gespann';
  car.reset();
  try { localStorage.setItem(VEHICLE_KEY, id); } catch { /* Private Mode o. ae. */ }
  updateMenuVehicleName();
  renderFuelGauge(); // Tankuhr und Kachel-Balken zeigen den Stand des gewaehlten Autos
  renderVehicleFuelBadges();
}
document.getElementById('menu-vehicle-btn').addEventListener('click', () => {
  if (state === 'menu') openGarage();
});
setVehicle(storedVehicle());

// --- Verkehr auf dem Kreisverkehr (alle Kapitel starten mit 30 Autos) ---
const START_TRAFFIC = 30;
const traffic = new Traffic(cityGroup, arc);
traffic.setTarget(START_TRAFFIC);

// --- Muenz-System: Hans' Reisekasse -----------------------------------------
// Verdienen: +20 pro Runde um den Arc, +100 Kapitelbonus, +5 fuer knappe
// Ueberholmanöver im Verkehr. Zahlen: Jeder Crash (Fahrzeug, Hindernis,
// Welt-Grenze, abgerissener Wohnwagen) kostet Reparaturguthaben nach
// Aufprall-Haerte. Die Kasse ueberlebt die Sitzung (localStorage).
const wallet = new Wallet();
const crashFX = new CrashFX(scene);
const EARN = { lap: 20, chapter: 100, nearMiss: 5, tempo: 5 };
// Tempo-Bonus: Ab dieser Geschwindigkeit zaehlt gefahrene Strecke; alle
// TEMPO_DIST Meter gibt es EARN.tempo. 85 km/h sind bewusst ein Risiko:
// Im Ringverkehr heisst das schneidig durch den Verkehr (Ueberschlag-
// und Schlinger-Gefahr inklusive) - der Bonus honoriert genau das.
const TEMPO_KMH = 85;
const TEMPO_DIST = 100;
let tempoDist = 0; // schnell gefahrene Strecke seit der letzten Praemie
let runCoins = 0;   // Bilanz der laufenden Fahrt (+ verdient / - Reparaturen)
let runRepairs = 0; // Reparaturkosten der laufenden Fahrt (Scheitern-Screen)

const coinsNumEl = document.getElementById('coins-num');
const coinsEl = document.getElementById('coins');
const menuCoinsEl = document.getElementById('menu-coins-num');
const coinPopEl = document.getElementById('coin-pop');
const crashEl = document.getElementById('crash');
const crashFlashEl = document.getElementById('crashflash');

const blitzerEl = document.getElementById('blitzer');

// Blitzer: weisser Vollbild-Flash + Shutter-Sound + Toast (Kapitel 2, wenn das
// Zieltempo erreicht ist - Hans wird geblitzt).
function blitzerFlash() {
  blitzerEl.classList.remove('show');
  void blitzerEl.offsetWidth; // CSS-Animation neu starten
  blitzerEl.classList.add('show');
  cameraShutter();
  showToast('📸 Geblitzt! Zieltempo erreicht!');
}
const successCoinsEl = document.getElementById('success-coins');
const failedCoinsEl = document.getElementById('failed-coins');

function renderCoins() {
  coinsNumEl.textContent = wallet.amount;
  menuCoinsEl.textContent = wallet.amount; // Kachel im Startmenue: nur die Zahl, Label steht darunter
  const gc = document.getElementById('garage-coins');
  if (gc) gc.textContent = `Reisekasse: ${wallet.amount} 🪙`;
}

// --- Werkstatt (Garage): Fahrzeuge auswaehlen bzw. kaufen -------------------
const garageEl = document.getElementById('garage');

// Karten aktualisieren: Auswahl-Markierung, Grauschleier fuer Ungekauftes,
// Knopf-Text und -Zustand (Kaufen nur mit voller Reisekasse).
function renderGarage() {
  const coins = document.getElementById('garage-coins');
  if (coins) coins.textContent = `Reisekasse: ${wallet.amount} 🪙`;
  renderVehicleFuelBadges(); // Tank-Balken auf jeder Karte auf den gespeicherten Stand bringen
  document.querySelectorAll('.garage-veh').forEach((card) => {
    const v = VEHICLES.find((x) => x.id === card.dataset.veh);
    if (!v) return; // Taschenlampe ist kein Fahrzeug, eigene Karte (siehe unten)
    const owned = isOwnedVehicle(v.id);
    card.classList.toggle('active', v.id === selectedVehicleId);
    card.classList.toggle('locked', !owned);
    const btn = card.querySelector('.garage-action');
    if (!owned) {
      const afford = wallet.amount >= v.price;
      btn.textContent = `Kaufen · ${v.price} 🪙`;
      btn.className = 'ch-btn ch-btn-sun ch-btn-sm garage-action';
      btn.disabled = !afford;
      btn.title = afford ? '' : 'Nicht genug Münzen in der Reisekasse';
    } else if (v.id === selectedVehicleId) {
      btn.textContent = 'Fährt gerade';
      btn.className = 'ch-btn ch-btn-primary ch-btn-sm garage-action';
      btn.disabled = true;
      btn.title = '';
    } else {
      btn.textContent = 'Auswählen';
      btn.className = 'ch-btn ch-btn-primary ch-btn-sm garage-action';
      btn.disabled = false;
      btn.title = '';
    }
  });
  // Werkstatt-Artikel: Taschenlampe (Kapitel 3 - Fahrlicht kaputt, das
  // Stueckchen Licht leuchtet den Weg nur sehr begrenzt aus).
  const flCard = document.querySelector('.garage-veh[data-veh="taschenlampe"]');
  if (flCard) {
    const btn = flCard.querySelector('.garage-action');
    flCard.classList.toggle('locked', !flashlightOwned);
    if (flashlightOwned) {
      btn.textContent = '✔ Im Handschuhfach';
      btn.className = 'ch-btn ch-btn-primary ch-btn-sm garage-action';
      btn.disabled = true;
      btn.title = 'Im Nacht-Kapitel automatisch dabei';
    } else {
      const afford = wallet.amount >= FLASHLIGHT_PRICE;
      btn.textContent = `Kaufen · ${FLASHLIGHT_PRICE} 🪙`;
      btn.className = 'ch-btn ch-btn-sun ch-btn-sm garage-action';
      btn.disabled = !afford;
      btn.title = afford ? '' : 'Nicht genug Münzen in der Reisekasse';
    }
  }
}

function openGarage() {
  if (state !== 'menu') return;
  state = 'garage';
  menuEl.classList.add('hidden');
  garageEl.classList.remove('hidden');
  renderGarage();
}

function closeGarage() {
  if (state !== 'garage') return;
  state = 'menu';
  garageEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
}

// Ein Klick, zwei Bedeutungen: gekauft -> auswaehlen, ungekauft -> kaufen
document.getElementById('garage-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.garage-action');
  if (!btn || btn.disabled) return;
  const id = btn.closest('.garage-veh').dataset.veh;
  // Werkstatt-Artikel: Taschenlampe (kein Fahrzeug, bleibt dauerhaft gekauft)
  if (id === 'taschenlampe') {
    if (flashlightOwned || wallet.amount < FLASHLIGHT_PRICE) return;
    wallet.deduct(FLASHLIGHT_PRICE);
    flashlightOwned = true;
    saveFlashlightOwned();
    showToast('🔦 Taschenlampe gekauft! Sie leuchtet im Nachtkapitel nur ein Stueckchen voraus …');
    renderCoins();
    renderGarage();
    return;
  }
  const v = VEHICLES.find((x) => x.id === id);
  if (!isOwnedVehicle(id)) {
    if (wallet.amount < v.price) return; // Knopf ist eh deaktiviert, hier nur zur Sicherheit
    wallet.deduct(v.price);
    ownedVehicles.push(id);
    saveOwnedVehicles();
    showToast(`${v.name} gekauft – frisch aus der Werkstatt!`);
    renderCoins();
    setVehicle(id); // frisch gekauft: automatisch auswaehlen
  } else {
    setVehicle(id);
  }
  renderGarage();
});
document.getElementById('btn-garage-back').addEventListener('click', closeGarage);

// Buchung schwebt kurz unter der Kasse auf, die Kasse selbst zuckt
function popCoin(delta, label = '') {
  const el = document.createElement('span');
  el.className = 'coin-delta ' + (delta >= 0 ? 'plus' : 'minus');
  el.textContent = `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}${label ? ' ' + label : ''}`;
  coinPopEl.appendChild(el);
  setTimeout(() => el.remove(), 1600);
  coinsEl.classList.remove('bump');
  void coinsEl.offsetWidth; // CSS-Animation neu starten
  coinsEl.classList.add('bump');
}

function earn(n, label) {
  wallet.add(n);
  runCoins += n;
  popCoin(n, label);
  renderCoins();
}

// Ein Crash: Funken + Truemmer am Aufprallpunkt, Kamera-Wackeln, roter
// Rand-Blitz, Crash-Banner mit Reparaturkosten - und die Kasse zahlt.
// Mehrere Treffer im selben Aufprall (z.B. zwei Autos gleichzeitig) sind
// EIN Crash: das Merge-Fenster faengt die Doppelabbuchung ab.
// free = true: nur die Show (Funken/Sound/Wackeln/Banner), ohne Kosten -
// fuer Ereignisse, an denen das Kapitel ohnehin scheitert (Kupplungsabriss).
let crashCool = 0;
let shakeT = 0, shakeAmp = 0;
let crashBannerTimer = null;
function handleCrash(info, free = false) {
  if (crashCool > 0) return;
  crashCool = 0.35;
  const sev = Math.min(1, info.closing / 22); // Haerte 0..1 fuer Sound/Funken/Wackeln
  let banner;
  if (free) {
    banner = `💥 ${info.banner || 'Crash!'}`;
  } else {
    const { coins, tier } = crashPenalty(info.closing);
    wallet.deduct(coins);
    runCoins -= coins;
    runRepairs += coins;
    popCoin(-coins, tier);
    banner = `💥 ${tier} −${coins} 🪙`;
  }
  renderCoins();

  crashFX.spawn(info.x, info.z, info.nx, info.nz, sev);
  crashSound(sev);
  shakeT = 0.45 + sev * 0.4;
  shakeAmp = 0.1 + sev * 0.55;

  crashEl.textContent = banner;
  crashEl.classList.remove('show');
  void crashEl.offsetWidth;
  crashEl.classList.add('show');
  clearTimeout(crashBannerTimer);
  crashBannerTimer = setTimeout(() => crashEl.classList.remove('show'), 1500);
  crashFlashEl.style.setProperty('--flash', String(0.3 + sev * 0.6));
  crashFlashEl.classList.add('show');
  setTimeout(() => crashFlashEl.classList.remove('show'), 80); // blendet per CSS-Transition aus
}

traffic.onCrash = handleCrash;
traffic.onNearMiss = () => earn(EARN.nearMiss, 'knapp!');
campervan.onObstacleCrash = handleCrash;
gespann.onObstacleCrash = handleCrash;

// --- Kapitel ---
const ROUNDS_TARGET = 5;
const chapters = new ChapterManager();
chapters.add(createArcLapChapter(arc, traffic, { target: ROUNDS_TARGET, startTraffic: START_TRAFFIC }));
chapters.add(createSpeedChapter({ target: 120 }));
chapters.add(createRomeNightChapter());

// --- Taschenlampe (Werkstatt-Artikel, Kapitel 3: Nachts nach Rom) -----------
// Das Fahrlicht des Autos ist kaputt; in der Werkstatt kann Hans fuer
// FLASHLIGHT_PRICE Muenzen eine Taschenlampe kaufen (bleibt ueber Sitzungen
// gespeichert). Sie leuchtet den Weg aber nur SEHR BEGRENZT: ein enger,
// kurzer Spot vor dem Auto. Ohne sie ist Kapitel 3 reiner Blindflug.
const FLASHLIGHT_KEY = 'camperHansFlashlight';
const FLASHLIGHT_PRICE = 60;
let flashlightOwned = (() => {
  try { return localStorage.getItem(FLASHLIGHT_KEY) === '1'; } catch { return false; } // Private Mode: ohne Kauf
})();
function saveFlashlightOwned() {
  try { localStorage.setItem(FLASHLIGHT_KEY, flashlightOwned ? '1' : '0'); } catch { /* Private Mode: nur keine Persistenz */ }
}
// Der Spot haengt nicht am Auto, sondern wird jeden Frame vor das aktive
// Fahrzeug gesetzt (geht fuer Auto UND Gespann, ohne Modelle zu aendern).
// Bewusst schwach: kleiner Oeffnungswinkel, kurze Reichweite, force decay -
// nur ein Stueckchen Strasse vor dem Van wird sichtbar.
const flashlight = new THREE.SpotLight(0xffe0a3, 45, 40, 0.38, 0.45, 1.8);
flashlight.visible = false;
scene.add(flashlight, flashlight.target);

// --- Kapitel-Maps: Registry + aktive Map -------------------------------------
// Kapitel 1 nutzt die Stadt-Map (cityGroup, oben beim Start gebaut). Kapitel 2
// bekommt seine eigene Huegelland-Map (hills.js) ERST beim ersten Auswaehlen
// des Kapitels - die Map wird also lazy geladen, nicht beim Spielstart.
const cityMap = {
  id: 'arc-de-triomphe',
  group: cityGroup,
  get colliders() { return world.colliders.concat(arc.colliders); },
  half: world.half,
  arc,
  spawn: { x: 0, z: -100, heading: 0 }, // wie der Car-Default-Spawn an der Champs-Elysees
};
const chapterMaps = new Map([['arc-de-triomphe', cityMap]]);
let activeMap = cityMap;

function setActiveMap(m) {
  activeMap = m;
  for (const [, mm] of chapterMaps) mm.group.visible = mm === m; // nur aktive Map sichtbar
  applyMapAtmosphere(m); // Tag/Nacht folgt der aktiven Map (Kapitel 3: Nacht)
}

// Lazy Load: Eine noch nicht gebaute Kapitel-Map wird hier zum ersten Mal
// erzeugt (mit Ladebildschirm); danach bleibt sie gecacht und wird nur noch
// sichtbar/unsichtbar geschaltet.
async function ensureMap(q) {
  if (!chapterMaps.has(q.id)) {
    loading.classList.remove('done');
    loadtext.textContent = `Lade ${q.title} …`;
    await new Promise((r) => setTimeout(r, 60)); // Ladebildschirm kurz sichtbar machen
    if (q.id === 'temposuender') {
      const m = buildHillsMap(scene);
      m.id = q.id;
      // Landstrassen-Verkehr: wenige Autos (Mercedes/Kaefer/Ente) in Hans'
      // Fahrtrichtung auf der rechten Spur - KEIN Hupen hier draussen (siehe
      // roadtraffic.js). Die GLB-Vorlagen teilt er sich mit dem Stadtverkehr.
      m.roadTraffic = new RoadTraffic(m.group, m.roadPath, { templates: traffic.templates });
      m.roadTraffic.onCrash = handleCrash;
      chapterMaps.set(q.id, m);
    }
    if (q.id === 'romnacht') {
      // Kapitel 3: stockdunkles Italien mit verzwicktem Wegenetz. Die Map
      // bringt ihre eigene Atmosphaere mit (night: true -> Sterne, Mond,
      // dichter Nebel, siehe applyMapAtmosphere). Kein Verkehr: Nachts sind
      // alle vernuenftigen Menschen im Bett - nur Hans nicht.
      const m = buildNightRomeMap(scene);
      m.id = q.id;
      chapterMaps.set(q.id, m);
    }
    loading.classList.add('done');
  }
  setActiveMap(chapterMaps.get(q.id));
}

// --- Spielzustand: 'menu' | 'playing' | 'success' | 'failed' ---
let state = 'menu';
let activeChapter = null;
let failTimer = 0; // laeuft nach Umkippen/Abreissen, bis der Scheitern-Bildschirm kommt

const chapterEl = document.getElementById('chapter');
const toastEl = document.getElementById('toast');
const menuEl = document.getElementById('menu');
const menuChaptersEl = document.getElementById('menu-chapters');
const bookPrevBtn = document.getElementById('book-prev');
const bookNextBtn = document.getElementById('book-next');
const bookDotsEl = document.getElementById('book-dots');
const successEl = document.getElementById('success');
const successTimeEl = document.getElementById('success-time');
const successHsEl = document.getElementById('success-highscore');
const failedEl = document.getElementById('failed');
const failReasonEl = document.getElementById('fail-reason');
let toastTimer = null;

// --- Zeitmessung & Highscore (bleibt ueber Sitzungen gespeichert) ---
const HS_KEY = 'camperHansHighscore';
const DONE_KEY = 'camperHansChaptersDone';
const DONE_KEY_LEGACY = 'camperHansQuestsDone'; // alter Quest-Schluessel (Migration)
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
}

function loadDone() {
  try {
    let d = JSON.parse(localStorage.getItem(DONE_KEY));
    if (!d) {
      // Migration: Erledigt-Haken standen frueher unter dem Quest-Schluessel.
      d = JSON.parse(localStorage.getItem(DONE_KEY_LEGACY)) || [];
      if (d.length) localStorage.setItem(DONE_KEY, JSON.stringify(d));
    }
    return d;
  } catch { return []; }
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

// --- Hauptmenue: Kapitelauswahl als aufgeschlagenes Buch -------------------
// Jedes Kapitel ist eine Doppelseite: links "Kapitel N" mit Titel und Auftrag,
// rechts der Missionszettel (q.story - Liesels Ansagen in Handschrift, siehe
// chapters.js). Zwischen den Kapiteln wird per Blatt-Drehanimation
// umgeblaettert (flipToChapter), vorwaerts wie rueckwaerts.
let bookIndex = 0; // aktuell aufgeschlagenes Kapitel
let bookFlipping = false; // waehrend der Blatt-Drehung: keine Klicks/Rebuilds
const FLIP_MS = 850; // muss zur CSS-Variable --ch-leaf-duration (.85s) passen

// Eine einzelne Buchseite als HTML. side: 'left' (Kapitelkopf) oder 'right'
// (Missionszettel + Aufschlagen-Knopf).
function chapterPageHTML(q, side) {
  const done = isDone(q.id);
  const m = q.title.match(/^(.+?):\s*(.+)$/);
  const kicker = m ? m[1] : 'Kapitel';
  const bookTitle = m ? m[2] : q.title;
  if (side === 'left') {
    return `<div class="book-page side-left">
      <span class="book-ribbon${done ? ' done' : ''}">${done ? 'Gelesen' : 'Zu lesen'}</span>
      <div class="bp-kicker">${kicker}</div>
      <h3 class="bp-title">${bookTitle}</h3>
      <div class="bp-rule" aria-hidden="true">✦</div>
      <p class="bp-desc">${q.desc}</p>
      <button class="ch-btn ch-btn-primary ch-btn-sm bp-start" data-id="${q.id}">${done ? 'Erneut starten' : 'starten'}</button>
    </div>`;
  }
  return `<div class="book-page side-right">
      <div class="bp-story">${q.story}</div>
    </div>`;
}

function bindStartButtons() {
  menuChaptersEl.querySelectorAll('button[data-id]').forEach((b) => {
    b.addEventListener('click', () => startChapter(chapters.chapters.find((q) => q.id === b.dataset.id)));
  });
}

// Doppelseite des aktuell aufgeschlagenen Kapitels ins Buch legen
function renderSpread() {
  const q = chapters.chapters[bookIndex];
  menuChaptersEl.innerHTML = chapterPageHTML(q, 'left') + chapterPageHTML(q, 'right');
  bindStartButtons();
}

function renderMenu() {
  if (bookFlipping) return; // das Blatt liegt noch, ein Rebuild wuerde es abtrennen
  renderSpread();
  layoutBookHeight();
  bookDotsEl.innerHTML = chapters.chapters.map((_, i) =>
    `<button data-page="${i}" aria-label="Kapitel ${i + 1}"${i === bookIndex ? ' class="active"' : ''}></button>`
  ).join('');
  bookDotsEl.querySelectorAll('button[data-page]').forEach((d) => {
    d.addEventListener('click', () => flipToChapter(Number(d.dataset.page)));
  });
  bookPrevBtn.disabled = bookIndex === 0;
  bookNextBtn.disabled = bookIndex === chapters.chapters.length - 1;
  renderHighscore();
  renderCoins();
  renderVehicleFuelBadges(); // Fahrzeug-Kachel zeigt den mitgebrachten Tankstand
}

// Buchhoehe an den laengsten Text anpassen: Alle Doppelseiten werden in einem
// unsichtbaren Mess-Container (halb so breit wie das Buch, wie eine Seite)
// vermessen; die Hoehe des Buches entspricht der hoechsten gemessenen Seite.
// So passt der laengste Missionszettel rein, ohne dass die Kapitel verschieden
// hohe Buecher ergeben (das Blatt braucht beim Umblaettern ein stabiles
// Format). Auf schmalen Bildschirmen bleibt die Hoehe automatisch (CSS).
function layoutBookHeight() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute; visibility:hidden; pointer-events:none; width:50%;';
  menuChaptersEl.appendChild(probe);
  let max = 0;
  chapters.chapters.forEach((q) => {
    ['left', 'right'].forEach((side) => {
      probe.innerHTML = chapterPageHTML(q, side);
      max = Math.max(max, probe.firstElementChild.offsetHeight);
    });
  });
  probe.remove();
  const narrow = window.matchMedia('(max-width: 720px)').matches;
  menuChaptersEl.style.height = narrow ? '' : `${Math.ceil(max)}px`;
}

// Umblaetter-Animation: Das Blatt schwingt von einer Buchhaelfte auf die
// andere (Falz als Drehachse). Die Vorderseite zeigt die abgeblaetterte
// Seite, die Rueckseite die neue Seite des Zielkapitels; die Ziel-
// Gegenseite liegt schon unter dem Blatt bereit (Klasse "under" haelt ihr
// Lesebaendchen zurueck, bis das Blatt aufgelegt ist). direction = Zielindex.
function flipToChapter(target) {
  if (bookFlipping) return;
  const last = chapters.chapters.length - 1;
  if (target < 0 || target > last || target === bookIndex) return;
  const fwd = target > bookIndex;
  const from = chapters.chapters[bookIndex];
  const to = chapters.chapters[target];
  bookFlipping = true;
  bookPrevBtn.disabled = true;
  bookNextBtn.disabled = true;

  // Schmale Bildschirme: Die Doppelseite liegt gestapelt, ein Drehen am Falz
  // ergibt kein Bild - die neue Doppelseite wird kurz neu eingeblendet.
  if (window.matchMedia('(max-width: 720px)').matches) {
    bookIndex = target;
    renderSpread();
    menuChaptersEl.classList.remove('swap');
    void menuChaptersEl.offsetWidth; // Reflow: Animation neu starten
    menuChaptersEl.classList.add('swap');
    bookFlipping = false;
    renderMenu();
    return;
  }

  // Ziel-Gegenseite unter das Blatt legen: Sie bleibt vom Blatt verdeckt,
  // solange das Blatt diese Haelfte noch frei gibt.
  const staticPages = menuChaptersEl.querySelectorAll(':scope > .book-page');
  const underSide = fwd ? 'right' : 'left';
  staticPages[fwd ? 1 : 0].outerHTML =
    chapterPageHTML(to, underSide).replace('book-page side', 'book-page under side');
  const fromSide = fwd ? 'right' : 'left'; // Seite, die mit dem Blatt abblaettert
  const toSide = fwd ? 'left' : 'right'; // Seite, die mit dem Blatt ankommt

  const leaf = document.createElement('div');
  leaf.className = `book-leaf ${fwd ? 'fwd' : 'bwd'}`;
  leaf.innerHTML = `
    <div class="leaf-face front">${chapterPageHTML(from, fromSide)}<div class="leaf-shade"></div></div>
    <div class="leaf-face back">${chapterPageHTML(to, toSide)}<div class="leaf-shade"></div></div>`;
  menuChaptersEl.appendChild(leaf);

  const finish = () => {
    if (!leaf.parentNode) return; // schon aufgeraeumt (animationend oder Notnetz)
    leaf.remove();
    bookIndex = target;
    bookFlipping = false;
    renderMenu();
  };
  leaf.addEventListener('animationend', finish);
  setTimeout(finish, FLIP_MS + 150); // Notnetz, falls animationend nicht feuert
}

bookPrevBtn.addEventListener('click', () => flipToChapter(bookIndex - 1));
bookNextBtn.addEventListener('click', () => flipToChapter(bookIndex + 1));
// Fensterbreite aendert den Zeilenumbruch - Buchhoehe neu vermessen
window.addEventListener('resize', () => {
  if (state === 'menu' && !bookFlipping) layoutBookHeight();
});

function renderChapter() {
  if (!activeChapter) { chapterEl.innerHTML = ''; return; }
  const q = activeChapter;
  // Bewusst reduziert (Feedback): nur Kapitelname und Fortschrittsbalken -
  // keine Beschreibung, kein Zaehler. Der Balken (Sonnen-Streifen, bei
  // Erfolg Waldgruen) traegt die ganze Information.
  const pct = Math.min(100, (q.progress / q.target) * 100);
  chapterEl.innerHTML = `<div class="chapter${q.completed ? ' done' : ''}">
    <div class="c-title">${q.title}</div>
    <div class="c-bar"><div class="c-fill" style="width:${pct}%"></div></div>
  </div>`;
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

let startingChapter = false;
async function startChapter(q) {
  if (startingChapter) return; // Doppelklick auf "Aufschlagen" abfangen
  startingChapter = true;
  try {
    activeChapter = q;
    q.reset();
    failTimer = 0;
    celebrating = null; // Blitzer-Weiterfahr-Phase des vorherigen Laufs verwerfen
    celebrateT = 0;
    await ensureMap(q); // Map des Kapitels laden/aktivieren (Kapitel 2: lazy)
    car.spawn = activeMap.spawn; // Spawn zur Map (Kapitel 2: Start der Landstrasse)
    // Fahrdynamik der Map: Defaults (Stadt, 108 km/h) bzw. Map-Tuning
    // (Kapitel 2: bis 136,8 km/h, damit 120 km/h als Ziel erreichbar sind).
    Object.assign(car, CAR_TUNING, activeMap.tuning || {});
    car.reset();
    // Verkehr pro Kapitel: Stadt = Kreisverkehr (30 Autos, mit Hupen),
    // Landstrasse = der Kreisverkehr bleibt leer, dafuer tuckern dort
    // ein paar gemuetliche Autos ohne jedes Hupen (roadTraffic) uebers Land.
    // Nachts (Kapitel 3) sind die Strassen leer - ausser Hans traegt alles auf.
    // setTarget(0) zuerst, damit die Verteilung von vorne beginnt.
    traffic.setTarget(0);
    traffic.setTarget(q.id === 'arc-de-triomphe' ? START_TRAFFIC : 0);
    if (activeMap.roadTraffic) activeMap.roadTraffic.reset(); // Kapitel-2-Autos neu verteilen
  elapsed = 0;
  timerRunning = true;
  state = 'playing';
  runCoins = 0;   // Reisekasse-Bilanz zaehlt pro Fahrt neu
  runRepairs = 0;
  runFuel = 0;    // auch die Tankkosten zaehlen pro Fahrt neu
  tempoDist = 0;  // Tempo-Bonus-Strecke startet bei jeder Fahrt von vorne
  refueling = false; // Tankstopp-Zustand der vorherigen Fahrt zuruecksetzen
  stalled = false;
  lowFuelWarned = false;
  fuelstopEl.classList.add('hidden');
  // KEIN tank.fill() mehr: Der Tank gehoert dem Fahrzeug und bleibt ueber
  // Kapitel gespeichert - wer leer in die Fahrt startet, tankt erst am
  // Tankstopp (der oeffnet nach der Kamerafahrt, siehe Hauptschleife).
  renderFuelGauge();
  introT = 0; // Kamerafahrt: schraeg von vorne auf die Chase-Position
  menuEl.classList.add('hidden');
  successEl.classList.add('hidden');
  failedEl.classList.add('hidden');
  radio.resumeForGameplay(); // Radio laeuft weiter, wenn es angelassen wurde
  renderChapter();
  // Kapitel 3: Hans' Fahrlicht ist kaputt. Zeige an, ob die Taschenlampe
  // dabei ist (falls gekauft) - oder schubse sanft Richtung Werkstatt.
    if (q.id === 'romnacht') {
      showToast(flashlightOwned
        ? '🔦 Taschenlampe griffbereit – mehr als ein Stueckchen Licht gibt sie aber nicht her …'
        : '💡 Das Fahrlicht ist kaputt! Ohne eine Taschenlampe aus der Werkstatt sieht Hans fast nichts …');
    }
  } finally {
    startingChapter = false;
  }
}

// Kippen bzw. Abreissen beendet das Kapitel: kurz den Schwenk/Bruch zeigen,
// dann Scheitern-Bildschirm mit Neustart.
function failChapter(reason) {
  timerRunning = false;
  state = 'failed';
  saveFuel(); // mitgebrachter Tankstand des Fahrzeugs sichern
  radio.pauseForMetaScreens(); // Musik aus, bis wieder gefahren wird
  failReasonEl.textContent = reason;
  // Scheitern selbst ist kostenlos - nur die unterwegs bezahlten
  // Reparaturen und Tankstopps werden (informativ) nochmal genannt.
  const paidBits = [];
  if (runRepairs > 0) paidBits.push(`Reparaturen: −${runRepairs} 🪙`);
  if (runFuel > 0) paidBits.push(`Benzin: −${runFuel} 🪙`);
  failedCoinsEl.textContent = paidBits.length
    ? `Scheitern kostet nichts · Bezahlt unterwegs: ${paidBits.join(' · ')}`
    : `Scheitern kostet nichts · Reisekasse unangetastet: ${wallet.amount} 🪙`;
  failedEl.classList.remove('hidden');
  renderChapter();
}

function retryChapter() {
  if (activeChapter) startChapter(activeChapter);
  else toMenu();
}

function toMenu() {
  state = 'menu';
  activeChapter = null;
  timerRunning = false;
  celebrating = null; // falls mitten in der Blitzer-Phase abgebrochen wird
  celebrateT = 0;
  saveFuel(); // Tankstand mit ins Menue/Speicher nehmen
  refueling = false; // ein offener Tankstopp gehoert zur Fahrt, nicht ins Menue
  stalled = false;
  fuelstopEl.classList.add('hidden');
  radio.pauseForMetaScreens();
  successEl.classList.add('hidden');
  failedEl.classList.add('hidden');
  garageEl.classList.add('hidden'); // falls aus der Werkstatt heraus (ESC) gestartet wurde
  menuEl.classList.remove('hidden');
  renderMenu();
  renderChapter();
}

chapters.on('progress', (q) => {
  if (q.id === 'arc-de-triomphe' && activeChapter === q) {
    traffic.setTarget(START_TRAFFIC + q.progress * 5); // pro Runde +5 Autos
    earn(EARN.lap, 'Runde'); // Rundenpraemie in die Reisekasse
  }
  // Kapitel 3: jede richtig genommene Abzweigung verdient sich einen Toast
  // mit dem Label des Wegpunkts (setzt das Kapitel in chapters.js).
  if (q.id === 'romnacht' && activeChapter === q && q._wpLabel) {
    showToast(`✅ Richtig abgebogen! ${q._wpLabel}`);
  }
  renderChapter();
});

// Kapitel 3: Hans ist in einer Sackgasse gelandet (Barriere "SACKGASSE"),
// freundlicher Hinweis zum Wenden - kostet kein Kapitel, nur Nerven.
chapters.on('deadend', (q) => {
  if (activeChapter === q && state === 'playing') {
    showToast('🚧 Sackgasse! Hier wird Hans nicht nach Rom kommen – wenden!');
  }
});

// Erfolgs-Screen (wird bei Kapitel 1 sofort gezeigt, bei Kapitel 2 erst nach
// der kleinen Weiterfahr-Phase, siehe chapters.on('completed')).
function showSuccess(q) {
  timerRunning = false;
  saveDone(q.id);
  saveFuel(); // Restbestand des Fahrzeugs fuer das naechste Kapitel sichern
  earn(EARN.chapter, 'Kapitelbonus');
  state = 'success';
  radio.pauseForMetaScreens(); // Geschafft! -> Feier ohne Radiomusik
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
  const balance = runCoins >= 0 ? `+${runCoins}` : `−${Math.abs(runCoins)}`;
  successCoinsEl.textContent = `Fahrtbilanz: ${balance} 🪙 · Reisekasse: ${wallet.amount}` +
    (runFuel > 0 ? ` · davon Benzin: −${runFuel} 🪙` : '');
  renderHighscore();
  renderChapter();
  successEl.classList.remove('hidden');
}

// Kapitel 2 (Temposuender): Beim Erreichen des Zieltempos wird Hans geblitzt
// (Vollbild-Flash + Shutter-Sound) und das Auto faehrt noch ein kleines Stueck
// weiter (celebrating in der Hauptschleife), erst dann kommt der Erfolgs-Screen.
let celebrating = null;
let celebrateT = 0;
const CELEBRATE_S = 2.5; // Sekunden Weiterfahren nach dem Blitzer

chapters.on('completed', (q) => {
  if (q.id === 'temposuender') {
    timerRunning = false;
    blitzerFlash();
    celebrating = q;
    celebrateT = 0;
  } else {
    showSuccess(q);
  }
});

document.getElementById('btn-to-menu').addEventListener('click', toMenu);

// Kapitel 2 (Temposuender): Wer von der Strasse abkommt, hat das Kapitel
// verloren - Scheitern-Bildschirm mit Grund "abgekommen".
chapters.on('failed', (q) => {
  if (activeChapter === q && state === 'playing') {
    failChapter('Von der Straße abgekommen! Nächstes Mal bleibt Hans auf dem Asphalt …');
  }
});

controls.onReset = () => {
  if (refueling) return; // am Tankstopp entscheidet der Klick, nicht die R-Taste
  if (celebrating) return; // in der Blitzer-Weiterfahr-Phase nicht neu spawnen
  if (state === 'failed') { retryChapter(); return; } // R im Scheitern-Bildschirm = Neustart
  car.reset();
  if (activeChapter) activeChapter.onCarReset();
  elapsed = 0;
  timerRunning = state === 'playing';
  failTimer = 0;
};
controls.onHonk = () => truckHonk();

// --- Kamera-Ansichten (Taste C): 0 Standard, 1 First Person, 2 hinten links ---
let viewMode = 0;
function cycleView() {
  viewMode = (viewMode + 1) % 3;
}
controls.onCycleView = cycleView;

// --- Hupe & Ansicht auch anklickbar (Tooltips nennen die Tastenkürzel) ---
// pointerdown statt click: reagiert sofort und preventDefault haelt den
// Fokus weg vom Button, damit Enter/Space danach nicht versehentlich hupen.
const hornBtn = document.getElementById('btn-horn');
hornBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  hornBtn.classList.add('active');
  truckHonk(); // Hans' Hupe: immer voll auf 1
});
const hornRelease = () => hornBtn.classList.remove('active');
hornBtn.addEventListener('pointerup', hornRelease);
hornBtn.addEventListener('pointercancel', hornRelease);
hornBtn.addEventListener('lostpointercapture', hornRelease);
// H-Taste spiegelt den Button auf dem Dashboard: runter = gedrueckt, los = losgelassen
window.addEventListener('keydown', (e) => { if (e.code === 'KeyH') hornBtn.classList.add('active'); });
window.addEventListener('keyup', (e) => { if (e.code === 'KeyH') hornBtn.classList.remove('active'); });
window.addEventListener('blur', hornRelease);
document.getElementById('btn-view').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  cycleView();
});

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
  if (state !== 'menu') toMenu(); // Kapitel abbrechen / Scheitern-Bildschirm -> Startbildschirm
};

// --- Autoradio (Ein/Aus-Schalter + Sendertasten, Taste M = Ein/Aus) --------
// Getrennte Schalter: "⏻" schaltet nur ein/aus (Sender bleibt), die Tasten
// 1-3 waehlen den Sender (und schalten ein). Kapitel 1 startet mit "Le Roi
// du Camping" - Hans' Pariser Camping-Hit. Der gewaehlte Sender bleibt
// gespeichert; ob das Radio an ist, nicht (nach Reload erst still).
const radio = new Radio();
const radioEl = document.getElementById('radio');
const radioDisplayEl = document.getElementById('radio-label');
const radioPresetsEl = document.querySelector('.radio-presets');
const radioPowerBtn = document.getElementById('radio-power');
function renderRadio() {
  const s = radio.station;
  radioEl.classList.toggle('on', !!s);
  radioPowerBtn.setAttribute('aria-pressed', String(!!s));
  radioDisplayEl.textContent = s ? s.display : 'RADIO AUS';
  radioPresetsEl.querySelectorAll('.radio-preset').forEach((p) => {
    p.classList.toggle('active', !!s && p.dataset.station === s.key);
  });
  setRadioDucking(!!s); // Verkehrshupen leiser, solange Musik laeuft
}
function toggleRadioPower() {
  if (state !== 'playing') return; // Radio nur waehrend der Fahrt, wie im echten Auto
  if (!radio.on && activeChapter?.id === 'arc-de-triomphe') radio.tune('roi');
  const s = radio.powerToggle();
  renderRadio();
  showToast(s ? `${s.name} an!` : 'Radio aus.');
}
function selectRadioStation(key) {
  if (state !== 'playing') return;
  const alreadyOn = radio.on;
  const s = radio.select(key);
  if (!s) return;
  renderRadio();
  showToast(alreadyOn ? `Sender: ${s.name}` : `${s.name} an!`);
}
controls.onRadio = toggleRadioPower; // M = Ein/Aus-Schalter
radioPowerBtn.addEventListener('click', toggleRadioPower);
radioPresetsEl.addEventListener('click', (e) => {
  const b = e.target.closest('.radio-preset');
  if (b) selectRadioStation(b.dataset.station);
});
renderRadio();

// Kippen oder Abreissen zeigt zunaechst einen Toast; das Kapitel scheitert
// kurz danach (failTimer in der Hauptschleife), damit man den Sturz noch sieht.
campervan.onTip = () => showToast('Umgekippt! Das Kapitel ist gescheitert …');
gespann.onTip = () => showToast('Umgekippt! Das Kapitel ist gescheitert …');
gespann.onBreakoff = () => {
  showToast('Der Wohnwagen ist abgerissen!');
  // Kupplungsabriss = Kapitel ohnehin gescheitert: nur die Show (Funken,
  // Sound, Wackeln, Banner), KEIN Muenz-Abzug - Scheitern ist kostenlos.
  handleCrash({
    kind: 'coupling', closing: 12, nx: 0, nz: 0,
    banner: 'Kupplung gerissen!',
    x: gespann.trailerPos.x, z: gespann.trailerPos.z,
  }, true);
};

document.getElementById('btn-retry').addEventListener('click', retryChapter);
document.getElementById('btn-fail-menu').addEventListener('click', toMenu);

renderHighscore();
renderMenu();

// --- Menue-Vorschau der Fahrzeuge: lebendige 3D-Drehscheiben im Button ---
// Statisch gerenderte Bilder hatten zwei Haken: Das Papier im Bild-Hintergrund
// stand als weisser Rand vor dem Button, und der nicht gewaehlte Wohnwagen war
// unsichtbar (clone() uebernimmt das visible=false des trailerGroup aus dem
// Spiel). Jetzt dreht eine Mini-Szene jedes Fahrzeug langsam auf einem Canvas
// im Button - mit transparentem Hintergrund, das Papier des Buttons scheint
// durch. Ein zusaetzlicher Mini-Renderer (alpha, preserveDrawingBuffer) rendert
// beide Szenen, solange das Menue offen ist; die Spiel-Szene wird dann nicht
// mitgerendert (das Menue verdeckt sie ohnehin vollstaendig).
const PREVIEW_W = 256, PREVIEW_H = 176;
const MENU_PREVIEW_ZOOM = 0.72; // Startmenue-Knopf: Kamera dieser Faktor naeher am Fahrzeug
let previewRenderer = null;
const vehiclePreviews = [];
let menuVehPreview = null; // Canvas im Startmenue-Knopf: zeigt das gewaehlte Fahrzeug
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function setupVehiclePreviews() {
  previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  previewRenderer.setSize(PREVIEW_W, PREVIEW_H);
  for (const [id, veh] of [['campervan', campervan], ['gespann', gespann]]) {
    veh.reset(); // definierte Pose an der Startlinie (Zugwagen + Wohnwagen an der Kupplung)
    const root = new THREE.Group();
    root.add(veh.group.clone(true));
    if (veh.trailerGroup) root.add(veh.trailerGroup.clone(true));
    root.traverse((o) => { o.visible = true; }); // im Spiel ist das abgewaehlte Fahrzeug versteckt
    // Mittelpunkt der Bounding-Box in den Ursprung schieben, damit die
    // Drehung um die eigene Achse laeuft statt um den Startpunkt.
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.children.forEach((ch) => ch.position.sub(center));
    const size = box.getSize(new THREE.Vector3());
    const scene = new THREE.Scene(); // kein Hintergrund: Button-Papier scheint durch
    scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x51604a, 1.0));
    const lamp = new THREE.DirectionalLight(0xffffff, 1.6);
    lamp.position.set(4, 6, 5);
    scene.add(lamp, root);
    const cam = new THREE.PerspectiveCamera(35, PREVIEW_W / PREVIEW_H, 0.1, 1000);
    const maxDim = Math.max(size.x, size.y, size.z);
    cam.position.set(maxDim * 0.9, maxDim * 0.55, maxDim * 1.5);
    cam.lookAt(0, 0, 0);
    // Der Knopf im Startmenue zeigt denselben Drehteller staerker
    // herangezoomt: gleiche Kamera, nur naeher dran (Rahmengroesse des
    // Canvas bleibt unberuehrt, nur der Bildausschnitt rueckt ans Auto).
    const menuCam = cam.clone();
    menuCam.position.multiplyScalar(MENU_PREVIEW_ZOOM); // < 1: Kamera wandert Richtung Ursprung
    menuCam.lookAt(0, 0, 0);
    // <img> in der Werkstatt-Karte durch den Ziel-<canvas> ersetzen (Faellt-
    // Software aus: ohne Vorschau bleibt der Alt-Text stehen, die Werkstatt
    // bleibt bedienbar).
    const placeholder = document.querySelector(`.garage-veh[data-veh="${id}"] .veh-img`);
    const canvas = document.createElement('canvas');
    canvas.className = 'veh-img';
    placeholder.replaceWith(canvas);
    vehiclePreviews.push({ id, scene, root, cam, menuCam, canvas, ctx: canvas.getContext('2d') });
  }
  // Startmenue-Knopf: eigenes Canvas, auf dem immer das aktuell gewaehlte
  // Fahrzeug dreht (die Werkstatt-Canvas bleibt bei ihrer Karte).
  const menuPh = document.querySelector('#menu-vehicle-btn .veh-img');
  const menuCanvas = document.createElement('canvas');
  menuCanvas.className = 'veh-img';
  menuPh.replaceWith(menuCanvas);
  menuVehPreview = { canvas: menuCanvas, ctx: menuCanvas.getContext('2d') };
  // ersten Frame aller Karten zeichnen (Standbild), Drehteller laufen nur
  // nachher, wenn Menue/Werkstatt offen sind - und nur fuer das gewaehlte
  // Fahrzeug.
  updateVehiclePreviews(0, false);
}
function updateVehiclePreviews(dt, onlySelected = true) {
  if (!previewRenderer) return;
  // Der Mini-Renderer wird mit der Menue-Durchfahrt (Fensterbreite x 150)
  // geteilt: vor jedem Button-Render zurueck auf das quadratischere
  // Button-Format schalten, sonst rendert die Drehscheibe in den flachen
  // Streifen-Puffer und das Fahrzeug wirkt gequetscht/verzerrt.
  previewRenderer.setSize(PREVIEW_W, PREVIEW_H);
  const src = previewRenderer.domElement;
  const paint = (c) => {
    if (c.canvas.width !== src.width || c.canvas.height !== src.height) {
      c.canvas.width = src.width;
      c.canvas.height = src.height;
    }
    c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.ctx.drawImage(src, 0, 0);
  };
  for (const pv of vehiclePreviews) {
    if (onlySelected && pv.id !== selectedVehicleId) continue; // nur die Auswahl dreht sich
    if (!reducedMotion) pv.root.rotation.y += dt * 0.7; // langsamer Drehteller
    previewRenderer.render(pv.scene, pv.cam);
    paint(pv);
    if (pv.id === selectedVehicleId && menuVehPreview) {
      // Knopf-Canvas bekommt einen eigenen Render mit der naeheren Kamera -
      // nicht einfach den Karten-Frame kopieren, sonst fehlt der Zoom.
      previewRenderer.render(pv.scene, pv.menuCam);
      paint(menuVehPreview);
    }
  }
}

// --- Gespann tuckert durchs Startmenue (Gag hinter dem Buch) ---
// Das gruene Auto mit Wohnwagen faehrt auf einem breiten, transparenten
// Hintergrund-Streifen langsam von Bildkante zu Bildkante - huepft wie
// auf Pflastersteinen und wackelt ein wenig. Nutzt denselben Mini-Renderer
// wie die Fahrzeug-Buttons. Die Renderbreite folgt der Fensterbreite, damit
// das Gespann wirklich GANZ links einsetzt und GANZ rechts verschwindet
// (ein fixer 720er-Puffer wuerde auf weiten Fenstern nur mittig liegen).
const RIDE_H = 150;
let menuRide = null;
function setupMenuRide() {
  gespann.reset(); // definierte Pose: Zugwagen mit Wohnwagen an der Kupplung
  const root = new THREE.Group();
  root.add(gespann.group.clone(true));
  root.add(gespann.trailerGroup.clone(true));
  root.traverse((o) => { o.visible = true; });
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.children.forEach((ch) => ch.position.sub(center)); // Dreh-/Fahrtmitte in den Ursprung
  const size = box.getSize(new THREE.Vector3());
  const scene = new THREE.Scene(); // transparent: die Menue-Creme scheint durch
  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x51604a, 1.0));
  const lamp = new THREE.DirectionalLight(0xffffff, 1.5);
  lamp.position.set(3, 5, 6);
  scene.add(lamp, root);
  // Orthografische Kamera: parallele Projektion, das Gespann bleibt am
  // Bildrand genauso maechtig wie in der Mitte. (Eine Perspektivkamera
  // braeuchte bei Fensterbreite x 150 px ein horizontales FOV von weit
  // ueber 120 Grad - der Grund fuer die Rand-Verzerrung.)
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const halfH = size.y * 0.8; // sichtbare Streifenhoehe mit Luft
  cam.position.set(0, size.y * 0.4, 10); // Seitenansicht, minimal von oben
  cam.lookAt(0, 0, 0);
  const canvas = document.getElementById('menu-ride');
  menuRide = { root, scene, cam, canvas, ctx: canvas.getContext('2d'),
    halfH, sizeX: size.x,
    w: 0, span: 1, x: -1, t: 0, speed: 1 };
  updateMenuRide(0);
}
function updateMenuRide(dt) {
  if (!previewRenderer || !menuRide) return;
  const r = menuRide;
  // Renderbreite = Fensterbreite: Durchfahrt von ganz links bis ganz rechts.
  // (Aenderungen gibt es praktisch nur beim Resize; dann Strecke neu vermessen.)
  const wantW = Math.max(320, Math.ceil(window.innerWidth));
  if (wantW !== r.w) {
    r.w = wantW;
    const halfW = r.halfH * (wantW / RIDE_H); // Aspect: Breite/Hoehe des Streifens
    r.cam.left = -halfW;
    r.cam.right = halfW;
    r.cam.top = r.halfH;
    r.cam.bottom = -r.halfH;
    r.cam.updateProjectionMatrix();
    r.span = halfW + r.sizeX / 2 + 1; // hinter dem Rand unsichtbar ein-/aussetzen
    r.x = -r.span; // neue Durchfahrt von links beginnen
    r.speed = (2 * r.span) / 11; // ~11 s pro Durchfahrt
  }
  if (!reducedMotion) {
    r.t += dt;
    r.x += r.speed * dt;
    if (r.x > r.span) r.x = -r.span; // naechste Durchfahrt
  }
  // Front nach rechts (lokale Fahrtrichtung +Z => 90-Grad-Drehung), leichtes Lenk-Wackeln
  r.root.rotation.y = Math.PI / 2 + (reducedMotion ? 0 : 0.02 * Math.sin(r.t * 9));
  r.root.position.x = r.x;
  // Huepfen wie auf Pflastersteinen
  r.root.position.y = reducedMotion ? 0 : 0.05 * Math.abs(Math.sin(r.t * 7));
  previewRenderer.setSize(r.w, RIDE_H);
  previewRenderer.render(r.scene, r.cam);
  const src = previewRenderer.domElement;
  if (r.canvas.width !== src.width || r.canvas.height !== src.height) {
    r.canvas.width = src.width;
    r.canvas.height = src.height;
  }
  r.ctx.clearRect(0, 0, r.canvas.width, r.canvas.height);
  r.ctx.drawImage(src, 0, 0);
}

const loading = document.getElementById('loading');
const loadtext = document.getElementById('loadtext');
try {
  await campervan.load('assets/3d/campervan-optimized.glb', (e) => {
    if (e.total) loadtext.textContent = `Lade Campervan … ${Math.round((e.loaded / e.total) * 100)} %`;
  });
  loadtext.textContent = 'Lade Gespann …';
  await gespann.load();
  loadtext.textContent = 'Modellbilder fürs Menü …';
  try {
    setupVehiclePreviews();
    setupMenuRide();
  } catch (err) {
    console.warn('Vorschau-Renderer nicht verfügbar:', err);
  }
  await traffic.loadCarModels((i, n) => {
    loadtext.textContent = `Lade Autos … ${i}/${n}`;
  });
  loadtext.textContent = 'Lade Arc de Triomphe …';
  await loadArcMonument(cityGroup, arc.cx, arc.cz);
  await placeBuildings(cityGroup, world, arc, (i, n) => {
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
// --- Kamerafahrt bei Kapitel-Start ---
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
// Hoeher und Blick etwas staerker aufs Fahrzeug gerichtet, damit das
// Dashboard unten das Auto nicht verdeckt.
const CHASE_HEIGHT = 5.4;
const CHASE_LOOK_FWD = 6;   // Blickziel vor dem Fahrzeug
const CHASE_LOOK_Y = 1.1;   // Blickziel-Hoehe
const introLook = new THREE.Vector3();
function placeCameraBehindCar() {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  camera.position.set(car.pos.x - fx * CHASE_RADIUS, CHASE_HEIGHT, car.pos.z - fz * CHASE_RADIUS);
  camera.lookAt(car.pos.x + fx * CHASE_LOOK_FWD, CHASE_LOOK_Y, car.pos.z + fz * CHASE_LOOK_FWD);
}
placeCameraBehindCar();

// --- Hauptschleife ---
const clock = new THREE.Clock();

// --- Tacho (SVG-Zaegerinstrument im Hans-Stil): Skala einmalig zeichnen ---
// Skala 0..120 km/h: 120 km/h ist das Kapitel-2-Ziel (Temposuender) = Vollausschlag.
// Zeiger startet bei -135 Grad (unten links) und laeuft 270 Grad bis unten rechts.
const MAX_KMH = 120;
const speedoNeedle = document.getElementById('speedo-needle');
const speedoNum = document.getElementById('speedo-num');
(function buildSpeedoScale() {
  const g = document.getElementById('speedo-scale');
  const NS = 'http://www.w3.org/2000/svg';
  for (let v = 0; v <= MAX_KMH; v += 10) {
    const rad = (-135 + (v / MAX_KMH) * 270) * Math.PI / 180;
    const major = v % 20 === 0;
    const r1 = major ? 47 : 50;
    const r2 = 54;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', 60 + Math.sin(rad) * r1);
    line.setAttribute('y1', 60 - Math.cos(rad) * r1);
    line.setAttribute('x2', 60 + Math.sin(rad) * r2);
    line.setAttribute('y2', 60 - Math.cos(rad) * r2);
    line.setAttribute('stroke', 'var(--ch-night)');
    line.setAttribute('stroke-width', major ? 2 : 1);
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', major ? 1 : 0.45);
    g.appendChild(line);
    if (major) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', 60 + Math.sin(rad) * 38);
      t.setAttribute('y', 60 - Math.cos(rad) * 38 + 3);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'speedo-tick');
      t.textContent = v;
      g.appendChild(t);
    }
  }
})();

function updateSpeedo(mps) {
  const kmh = Math.min(Math.abs(mps) * 3.6, MAX_KMH);
  speedoNum.textContent = Math.round(kmh);
  speedoNeedle.setAttribute('transform', `rotate(${-135 + (kmh / MAX_KMH) * 270} 60 60)`);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // Muenz-System: Crash-Merge-Fenster und Funken laufen immer weiter
  // (auch im Erfolgs-/Scheitern-Bildschirm fliegen die Funken noch aus)
  crashCool = Math.max(0, crashCool - dt);
  crashFX.update(dt);

  // Im Menue/Erfolgsbildschirm laeuft die Simulation nicht weiter; am
  // Tankstopp (refueling) steht sie ebenfalls still: Van und Verkehr frieren
  // ein, der Kapitel-Timer wartet - nur die Kamera schwebt weiter uebers Bild.
  if (state === 'playing' && !refueling) {
    // Reihenfolge: erst den Van bewegen, dann den Verkehr. traffic.update
    // trennt den Van danach von getroffenen Autos ab (Positionskorrektur +
    // Bounce), damit nichts ineinander verschwinden kann.
    // Ohne Sprit kein Gas: Ist der Tank leer, gibt der Motor keinen Vortrieb
    // mehr, egal wie tief Hans aufs Pedal tritt.
    const input = tank.empty ? { ...controls.state, up: false } : controls.state;
    // Kollisionsdaten + Welt-Grenze + Kreisverkehr kommen von der AKTIVEN
    // Kapitel-Map (Stadt: world/arc, Kapitel 2: Huegelland-Map ohne Arc).
    const mapColliders = activeMap.colliders;
    car.update(dt, input, mapColliders, activeMap.half, activeMap.arc || null);
    // colliders/worldHalf: dafuer die Kollision des abgerissenen Wohnwagens
    // mit Hindernissen und Welt-Grenze (siehe traffic.update).
    traffic.update(dt, car, mapColliders, activeMap.half);
    // Kapitel 2 (Landstrasse): die wenigen Strassen-Autos bewegen und gegen
    // Hans' Fahrzeug samt Wohnwagen pruefen (im Stadtverkehr ist dieses
    // roadTraffic null bzw. unsichtbar).
    if (activeMap.roadTraffic) activeMap.roadTraffic.update(dt, car);
    if (activeChapter) activeChapter.update(dt, { car, arc, map: activeMap, flashlight: flashlightOwned }, chapters);

    // Tank leert sich mit der Zeit (Standgas + Tempo-Anteil, siehe fuel.js).
    // Faehrt der Tank auf Reserve, warnt der Toast einmalig pro Leerfahrt;
    // faellt er auf 0, uebernimmt stall-Timer + openFuelStop den Rest.
    tank.update(dt, car);
    if (!lowFuelWarned && tank.low) {
      lowFuelWarned = true;
      showToast('⛽ Der Tank läuft auf Reserve, Hans!');
    }
    if (stalled) {
      stallTimer += dt;
      if (Math.abs(car.speed) < 0.6 || stallTimer > 3) openFuelStop();
    }
    // Mit leerem (persistiertem) Tank ins Kapitel gestartet? Nach der
    // Kamerafahrt oeffnet der Tankstopp - erst zapfen, dann orgeln.
    if (tank.empty && !stalled && !refueling && introT >= 1) openFuelStop();

    // Fuellstaende regelmaessig sichern: Ein Reload mitten in der Fahrt
    // verliert hoechstens ein paar Sekunden Sprit.
    fuelSaveAcc += dt;
    if (fuelSaveAcc >= 5) {
      fuelSaveAcc = 0;
      saveFuel();
    }

    // Umgekippt oder Wohnwagen abgerissen? Kurz zeigen, dann ist die
    // Kapitel gescheitert (Scheitern-Bildschirm mit Neustart).
    // Ausnahme: waehrend der Blitzer-Weiterfahr-Phase (Kapitel 2) ist das
    // Kapitel bereits geschafft - ein Kippen wird dann nicht mehr gewertet.
    if (!celebrating && (car.tipped || car.detached)) {
      failTimer += dt;
      if (failTimer > 1.2) {
        failChapter(
          car.detached
            ? 'Der Wohnwagen ist abgerissen – nächstes Mal früher vom Gas.'
            : 'Das Fahrzeug ist umgekippt!'
        );
      }
    }

    // Tempo-Bonus: Flottes Fahren sammelt Praemien-Strecke. Unter der
    // Schwelle verliert der Zaehler langsam an Schwung (0.4x), ein kurzer
    // Brems-Wimpernschlag loescht ihn also nicht sofort - stehen bleiben
    // oder Schneckentempo aber auch schon.
    {
      const kmh = Math.abs(car.speed) * 3.6;
      if (kmh >= TEMPO_KMH) tempoDist += Math.abs(car.speed) * dt;
      else tempoDist = Math.max(0, tempoDist - Math.abs(car.speed) * dt * 0.4);
      while (tempoDist >= TEMPO_DIST) {
        tempoDist -= TEMPO_DIST;
        earn(EARN.tempo, 'Tempo');
      }
    }

    if (timerRunning) elapsed += dt;
    timeEl.textContent = `Zeit: ${fmtTime(elapsed)}`;

    // Kapitel 2: Hans wurde geblitzt - das Auto faehrt noch ein kleines
    // Stueck weiter, erst dann erscheint der Erfolgs-Screen.
    if (celebrating) {
      celebrateT += dt;
      if (celebrateT >= CELEBRATE_S) {
        const q = celebrating;
        celebrating = null;
        showSuccess(q);
      }
    }
  }

  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  // --- Taschenlampe (Kapitel 3): gehoert Hans in die Hand, nicht ans Auto -
  // deshalb sitzt der Spot leicht versetzt am Fahrerfenster und wackelt ein
  // wenig. Nur auf der Nacht-Map aktiv (und nur, wenn gekauft); ausserhalb
  // der Fahrt bleibt sie aus.
  {
    const on = flashlightOwned && activeMap && activeMap.night && state === 'playing';
    flashlight.visible = on;
    if (on) {
      const t = clock.elapsedTime;
      const wx = -fz * 0.45; // links vom Fahrzeug (Fahrerfenster)
      const wz = fx * 0.45;
      flashlight.position.set(
        car.pos.x + fx * 0.6 + wx + Math.sin(t * 2.3) * 0.12,
        1.6,
        car.pos.z + fz * 0.6 + wz + Math.cos(t * 1.9) * 0.12
      );
      // Blickziel: der Strahl wandert mit der Fahrzeugfront mit und liegt
      // bewusst flach und nah - nur ein Stueck Strasse wird sichtbar.
      flashlight.target.position.set(car.pos.x + fx * 14, 0.35, car.pos.z + fz * 14);
    }
  }
  // Ansicht 1/2 (Taste C): views.js setzt die Kamera; nur die Standard-
  // Ansicht durchlaeuft die folgenden Zwoege (Erfolg/Schwenk/Verfolgung).
  if (viewMode !== 0 && state !== 'menu') {
    applyView(camera, car, viewMode, 1 - Math.exp(-6 * dt));
  } else if (state === 'success' && activeChapter && activeChapter.id === 'arc-de-triomphe') {
    // Kapitel 1 geschafft: Bild bleibt stehen (keine Simulation mehr), die
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
    desired.set(car.pos.x - fx * CHASE_RADIUS, CHASE_HEIGHT, car.pos.z - fz * CHASE_RADIUS);
    lookTarget.set(car.pos.x + fx * CHASE_LOOK_FWD, CHASE_LOOK_Y, car.pos.z + fz * CHASE_LOOK_FWD);
    if (introT < 1) {
      // Kamerafahrt nach dem Kapitel-Start: Kreisbogen um das Fahrzeug vom
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

  // Crash-Wackeln: kurz und heftig, am staerksten bei hartem Aufprall.
  // Wirkt als Versatz NACH der Kamera-Platzierung (nur Position, kein
  // Drehen), deshalb zittert es in jeder Ansicht einschliesslich FPV.
  if (shakeT > 0) {
    shakeT -= dt;
    const s = shakeAmp * Math.max(0, shakeT);
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s * 0.6;
    camera.position.z += (Math.random() - 0.5) * s;
  }

  // Sonne (und Schatten) folgt dem Auto
  sun.position.set(car.pos.x + 45, 70, car.pos.z + 25);
  sun.target.position.set(car.pos.x, 0, car.pos.z);
  sun.target.updateMatrixWorld();

  updateSpeedo(car.speed);
  renderFuelGauge(); // Tankuhr haelt auch am Tankstopp/im Menue synchron

  if (camDebugEl) {
    const veh = car === campervan ? 'Campervan' : 'Peugeot-Gespann';
    camDebugEl.textContent =
      `FPV-Tuning (${veh})  I/K Höhe  J/L vor/zurück  C Ansicht (${viewMode})\n` +
      `seatY=${car.seatY.toFixed(2)}  seatFwd=${car.seatFwd.toFixed(2)}  Modell sizeY=${(car.modelSize?.y ?? 0).toFixed(2)}\n` +
      `Kamera ${camera.position.x.toFixed(1)} / ${camera.position.y.toFixed(2)} / ${camera.position.z.toFixed(1)}  Auto ${car.pos.x.toFixed(1)} / ${car.pos.z.toFixed(1)}`;
  }

  if ((state === 'menu' || state === 'garage') && previewRenderer) {
    // Menue/Werkstatt verdecken die Spielflaeche komplett: statt der Welt die
    // Fahrzeug-Drehscheiben aktualisieren (in der Werkstatt alle, sonst nur
    // die Auswahl) - die Gespann-Durchfahrt laeuft nur im Startmenue.
    updateVehiclePreviews(dt, state !== 'garage');
    if (state === 'menu') updateMenuRide(dt);
  } else {
    renderer.render(scene, camera);
  }
}
animate();

// Debug-/Test-Zugang
window.__game = { scene, camera, renderer, get car() { return car; }, controls, world, arc, traffic, chapters, wallet, tanks, tank, radio, chapterMaps, get activeMap() { return activeMap; }, ensureMap, get state() { return state; }, startChapter, toMenu };
