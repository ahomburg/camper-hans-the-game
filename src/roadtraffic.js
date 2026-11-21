// Landstrassen-Verkehr fuer Kapitel 2 (Temposuender): EINIGE WENIGE Autos -
// Mercedes, Kaefer und Ente (die gleichen GLB-Vorlagen wie im Kreisverkehr,
// siehe traffic.js) - tuckern gemuetlich in Hans' Fahrtrichtung ueber die
// rechte Fahrbahnhaelfte der schlaengelnden Landstrasse (hills.js). Sie sind
// langsamer als Hans' Zieltempo: Ueberholen ist angesagt. Wer eines rammt,
// zahlt wie im Stadtverkehr Reparaturen (onCrash -> handleCrash in main.js).
//
// Landessitte auf der Landstrasse: KEIN HUPEN. Weder zufaelliges Hupen noch
// Frust-Hupen hinter Hans - die Autos bremsen stattdessen sanft ab und
// tuckern geduldig dahinter (siehe Ruecksicht-Block in update). Kapitel 1
// bleibt unveraendert: dort wird weiterhin geblasen wie in Paris.

import * as THREE from 'three';
import { capsuleHit, TRAILER_R, TRAILER_MID, TRAILER_HALF } from './traffic.js';

// Deterministischer Zufall (wie in traffic.js): Der Landstrassen-Verkehr
// sieht bei jedem Kapitel-Start gleich aus.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mindestabstand zweier Autos hintereinander (Kapsellaenge ~4.1 m + Puffer).
const MIN_GAP = 6;
// Sichtweite/Sicherheitsabstand der Van-Ruecksicht: haelt das Auto ~8.5 m
// hinter Hans, wenn er auf der Spur steht oder langsam fahren will.
const LOOK = 22;
const SAFE = 8.5;

// --- Nachtlichter (Kapitel 3, "Nachts nach Rom") ------------------------------
// Auf der Nacht-Map haben die Landstrassen-Autos Scheinwerfer und
// Ruecklichter, damit Hans ihre Positionen im Dunkeln sieht: leuchtende
// Punkte (MeshBasicMaterial) plus additive Streukegel, die wie ein
// Scheinwerferkegel nach vorn leuchten. Alles rein visuell - es gibt keine
// echten THREE-Lichter pro Auto (die waeren bei mehreren Autos zu teuer).
// Aeusserst wichtig: Die ENTE faehrt mit einem KAPUTTEN Scheinwerfer -
// links bleibt dunkel, nur rechts leuchtet (Vorsicht beim Ueberholen!).

let beamTexture = null;
// Vertikaler Gradient (weich auslaufend): hell an der Kegelspitze (am Auto),
// transparent am weiten Ende. Canvas oben = UV v=1 = Spitze nach dem Bau unten.
function getBeamTexture() {
  if (beamTexture) return beamTexture;
  const cnv = document.createElement('canvas');
  cnv.width = 16;
  cnv.height = 64;
  const g = cnv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,244,210,0.55)'); // nahe am Auto
  grad.addColorStop(0.45, 'rgba(255,244,210,0.20)');
  grad.addColorStop(1, 'rgba(255,244,210,0)');    // vorne weich ausgeblendet
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 64);
  beamTexture = new THREE.CanvasTexture(cnv);
  beamTexture.colorSpace = THREE.SRGBColorSpace;
  return beamTexture;
}

let nightAssets = null;
// Scheinwerfer-Kegel: Spitze am Auto, weite Oeffnung ~12 m davor (+Z = vorne).
// ConeGeometry hat die Spitze auf +Y; rotateX(-90 Grad) legt sie auf -Z und
// der translate schiebt die Spitze in den Ursprung - der Kegel ragt dann nach
// +Z (Fahrtrichtung), sobald er am Scheinwerfer des Autos sitzt.
function getNightAssets() {
  if (nightAssets) return nightAssets;
  const H = 12, R = 2.2;
  const beamGeo = new THREE.ConeGeometry(R, H, 12, 1, true);
  beamGeo.rotateX(-Math.PI / 2);
  beamGeo.translate(0, 0, H / 2); // Spitze bei z=0, Basis bei z=+H
  nightAssets = {
    beamGeo,
    beamMat: new THREE.MeshBasicMaterial({
      map: getBeamTexture(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }),
    headMat: new THREE.MeshBasicMaterial({ color: 0xfff3c4 }), // Scheinwerfer
    tailMat: new THREE.MeshBasicMaterial({ color: 0xff2418 }), // Ruecklicht
    bulbGeo: new THREE.SphereGeometry(0.09, 8, 6),
    tailGeo: new THREE.SphereGeometry(0.07, 8, 6),
  };
  return nightAssets;
}

// Scheinwerfer/Ruecklichter an ein geklontes GLB-Auto setzen. modelIdx: 0 =
// Mercedes, 1 = Kaefer, 2 = Ente (Vorlagenreihenfolge, siehe traffic.js).
// Die Ente hat EINEN kaputten Scheinwerfer (links dunkel).
function attachNightLights(mesh, modelIdx) {
  const A = getNightAssets();
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const hy = THREE.MathUtils.clamp(size.y * 0.55, 0.5, 0.78); // Scheinwerfer-Hoehe
  const fz = size.z / 2 - 0.12;                             // Front
  const rz = -size.z / 2 + 0.12;                             // Heck
  const hx = Math.min(0.62, size.x * 0.28);                  // seitlicher Abstand
  const entBrokenLeft = modelIdx === 2; // Ente: linker Scheinwerfer kaputt
  for (const side of [-1, 1]) {
    if (side < 0 && entBrokenLeft) continue; // kaputte Seite bleibt dunkel
    const beam = new THREE.Mesh(A.beamGeo, A.beamMat);
    beam.position.set(hx * side, hy, fz);
    beam.rotation.x = -0.03; // minimal nach unten geneigt, wie echtes Abblendlicht
    mesh.add(beam);
    const bulb = new THREE.Mesh(A.bulbGeo, A.headMat);
    bulb.position.set(hx * side, hy, fz);
    mesh.add(bulb);
  }
  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(A.tailGeo, A.tailMat);
    tail.position.set(hx * side, hy * 0.85, rz);
    mesh.add(tail);
  }
}

export class RoadTraffic {
  constructor(parent, road, { templates = [], count = 10, laneOffset = 2.1, seed = 20240602, night = false } = {}) {
    this.parent = parent;
    this.road = road; // hills.js roadPath: { length, pointAt(s), headingAt(s) }
    this.templates = Array.isArray(templates) ? templates : [];
    this.laneOffset = laneOffset; // Abstand rechts der Mittellinie (Rechtsverkehr)
    this.night = !!night; // Kapitel 3: Autos mit Scheinwerfern (Ente: 1 kaputt)
    this.rand = mulberry32(seed);
    this.cars = [];
    this.onCrash = null; // (info) -> Muenz-System in main.js (handleCrash)
    // Ohne GLB-Vorlagen (Ladefehler) gibt es schlicht keinen Verkehr.
    for (let i = 0; i < count && this.templates.length > 0; i++) this.addCar(i);
  }

  get count() {
    return this.cars.length;
  }

  addCar(i = this.cars.length) {
    // GLB-Modell im Wechsel (Mercedes/Kaefer/Ente), wie im Kreisverkehr.
    const modelIdx = i % this.templates.length;
    const mesh = this.templates[modelIdx].clone(true);
    // Kapitel 3 (Nacht): Scheinwerfer + Ruecklichter ans Auto bauen - bei der
    // Ente bleibt der linke Scheinwerfer dunkel (siehe attachNightLights).
    if (this.night) attachNightLights(mesh, modelIdx);
    this.parent.add(mesh);
    const car = {
      mesh, model: modelIdx,
      s: 0,               // Bogenposition entlang der Strasse (0 .. road.length)
      speed: 10, baseSpeed: 10,
      blockT: 0,          // > 0: wurde gebremst, laeuft erst wieder an, wenn es abklingt
      x: 0, z: 0, heading: 0,
      hitCool: 0,         // Nachklang-Sperre nach einem Treffer
      shoveT: 0,          // > 0: von Hans angestossen, eilt kurz vorwaerts
    };
    this.cars.push(car);
    this.place(car);
    return car;
  }

  // Autos fuer einen neuen Kapitel-Start neu verteilen: gleichmaessig ueber
  // die Strecke - aber das ERSTE steht bewusst nah am Start (s ~34, der
  // Campervan spawnt bei s ~10): Schon in der Kamerafahrt guckt Hans auf ein
  // Blechdach, und wer das Zieltempo erreichen will, muss gleich zu Beginn
  // ueberholen. Der Rest reiht sich dahinter mit ~43 m Luft auf.
  reset() {
    const L = this.road.length;
    const n = Math.max(1, this.cars.length);
    const FIRST_CAR_S = 34; // ~24 m vor dem spawnenden Campervan
    const span = Math.max(0, L - 30 - FIRST_CAR_S);
    const step = n > 1 ? span / (n - 1) : 0; // Luft zwischen den Startplaetzen
    let lastS = -Infinity;
    this.cars.forEach((car, i) => {
      const jitter = step > 0 ? (this.rand() - 0.5) * Math.min(8, step * 0.3) : 0;
      car.s = FIRST_CAR_S + step * i + jitter;
      car.s = Math.min(car.s, L - 6);
      car.s = Math.max(car.s, lastS + MIN_GAP); // nie ineinander starten
      lastS = car.s;
      car.baseSpeed = 10 + this.rand() * 6; // ~36-59 km/h: gemuetliches Landtempo
      car.speed = car.baseSpeed;
      car.blockT = 0;
      car.hitCool = 0;
      car.shoveT = 0;
      this.place(car);
    });
  }

  place(car) {
    const p = this.road.pointAt(car.s);
    const h = this.road.headingAt(car.s);
    // Rechte Normale auf Fahrtrichtung (forward x up) -> rechte Fahrbahnseite.
    const rx = -Math.cos(h), rz = Math.sin(h);
    car.x = p.x + rx * this.laneOffset;
    car.z = p.z + rz * this.laneOffset;
    car.heading = h;
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = h;
  }

  // Abstandsbremse gegen ein Hindernis VOR dem Auto auf seiner Spur:
  // Zieltempo = Vordermann-Tempo + (Abstand - SicherhAbstand) * 0.9, weiches
  // Bremsen mit hoechstens 14 m/s^2. Setzt blockT, damit das Auto nach dem
  // Freikommen zunaechst kurz Tempo haelt statt sofort wieder Vollgas zu geben.
  brakeTowards(car, ahead, aheadSpeed, dt) {
    const target = Math.max(0, aheadSpeed + (ahead - SAFE) * 0.9);
    if (target >= car.speed) return false;
    car.speed = Math.max(target, car.speed - 14 * dt);
    car.blockT = 0.4;
    return true;
  }

  update(dt, van = null) {

    // --- Untereinander: nicht auffahren. Das hintere Auto bremst auf das
    // vordere, sobald der Abstand unter ~12 m faellt. Die Autos werden nach
    // Bogenposition sortiert; fuer das letzte in der Sortierung ergaenzt die
    // Luecke um die Strassenlaenge (es haengt sozusagen am anderen
    // Strassenende dran, wo der vorderste wieder aufsetzt).
    const L = this.road.length;
    const sorted = [...this.cars].sort((a, b) => a.s - b.s);
    for (let i = 0; i < sorted.length; i++) {
      const car = sorted[i];
      const next = sorted[(i + 1) % sorted.length];
      if (next === car) break; // nur ein Auto: nichts zu tun
      let gap = next.s - car.s;
      if (gap < 0) gap += L;
      this.brakeTowards(car, gap, next.speed, dt);
      if (gap < MIN_GAP) { // harte Trennung, falls ein Schub doch zu nah kam
        const back = (MIN_GAP - gap) * 0.5;
        car.s -= back;
        if (car.s < 0) car.s += L;
        this.place(car);
      }
    }

    for (const car of this.cars) {
      if (car.hitCool > 0) car.hitCool -= dt;
      if (car.shoveT > 0) car.shoveT -= dt;
      if (car.blockT > 0) car.blockT -= dt;

      // --- Ruecksicht auf Hans: steht er auf der Spur oder tuckert nur
      // langsam dahin, bremst das Auto hinter ihm sanft ab und faehrt in
      // seinem Tempo dahinter - kein Hupen, kein Auffahren, nur Geduld.
      if (van) {
        const dvx = van.pos.x - car.x, dvz = van.pos.z - car.z;
        const dist = Math.hypot(dvx, dvz);
        if (dist > 0.5 && dist < LOOK) {
          const fwdDot = (Math.sin(car.heading) * dvx + Math.cos(car.heading) * dvz) / dist;
          if (fwdDot > 0.75) { // Hans ist VOR dem Auto, grob auf seiner Spur
            // Geschwindigkeitsanteil von Hans entlang meiner Fahrtrichtung
            const vTang = Math.max(0,
              van.speed * (Math.sin(van.heading) * Math.sin(car.heading)
                + Math.cos(van.heading) * Math.cos(car.heading)));
            this.brakeTowards(car, dist * fwdDot, vTang, dt);
          }
        }
      }

      // --- Wiederanlauf: Nach dem Bremsen fuellt das Auto sein Regeltempo
      // langsam wieder auf - Stockungen loesen sich von selbst auf.
      if (car.shoveT <= 0 && car.blockT <= 0 && car.speed < car.baseSpeed) {
        car.speed = Math.min(car.baseSpeed, car.speed + 2.5 * dt);
      }

      // --- Bewegung: alle Autos fahren in Hans' Fahrtrichtung (steigender
      // Bogen). Erreicht ein Auto das ENDE DER STRASSE, verschwindet es
      // dort und erscheint am ANFANG wieder (Bogenposition springt zurueck
      // auf 0): Beide Stellen liegen an gegenueberliegenden Weltkanten tief
      // im Nebel, der Wechsel ist fuer den Spieler nur ein Auto weniger am
      // einen und eines mehr am anderen Ende. Nach einem Anstoss (shoveT)
      // eilt das Auto kurz mit Schub vorwaerts.
      const shove = car.shoveT > 0 ? 6 * Math.max(0, car.shoveT / 0.55) : 0;
      car.s += (car.speed + shove) * dt;
      if (car.s >= L) car.s -= L;
      this.place(car);

      // --- Kollision mit Hans' Zugfahrzeug (Kapsel-gegen-Kapsel wie im
      // Kreisverkehr): IMMER auseinanderschieben, Impuls und Muenzen nur
      // bei frischem Treffer (hitCool-Sperre).
      if (!van) continue;
      const hit = capsuleHit(van.pos.x, van.pos.z, van.heading, 1.1, car.x, car.z, car.heading, 0.95);
      if (hit) {
        van.pushOut(hit.nx * (hit.depth + 0.02), hit.nz * (hit.depth + 0.02));
        if (car.hitCool <= 0) {
          car.hitCool = 1.0;
          if (this.onCrash) {
            const vvx = Math.sin(van.heading) * van.speed;
            const vvz = Math.cos(van.heading) * van.speed;
            const vcx = Math.sin(car.heading) * car.speed;
            const vcz = Math.cos(car.heading) * car.speed;
            const closing = Math.max(0, (vcx - vvx) * hit.nx + (vcz - vvz) * hit.nz);
            this.onCrash({
              kind: 'car', closing,
              nx: hit.nx, nz: hit.nz,
              x: (van.pos.x + car.x) / 2,
              z: (van.pos.z + car.z) / 2,
            });
          }
          const nDotH = Math.sin(van.heading) * hit.nx + Math.cos(van.heading) * hit.nz;
          if (Math.abs(nDotH) < 0.5) {
            van.speed *= 0.5; // seitlicher Streifer (Ueberholmanover schief)
          } else if (nDotH >= 0) {
            // Auto rammt Hans von hinten (kuemmert sich eigentlich um Abstand;
            // passiert praktisch nur nach Verschiebungen/Stoessen)
            van.speed = Math.abs(van.speed) * 0.6 + 3;
            car.shoveT = 0.55;
          } else {
            // Hans rammt das Auto von hinten (der Normalfall auf der
            // Landstrasse): Hans verliert deutlich Tempo, das Auto wird
            // vorwaerts geschubst - kein Huckepack bis zum Zieltempo.
            van.speed = Math.abs(van.speed) * 0.4;
            car.shoveT = 0.55;
          }
        }
        van.sync();
      }

      // --- Kollision mit dem Wohnwagen des Gespanns (angekuppelt wie
      // abgerissen): derselbe Kapselvergleich wie im Kreisverkehr.
      if (van.trailerGroup) {
        const det = !!van.detached;
        const hh = det ? van.trailerHeading : van.heading - (van.psi || 0);
        const kupX = det ? van.trailerPos.x : van.pos.x - Math.sin(van.heading) * (van.hitchDist || 0);
        const kupZ = det ? van.trailerPos.z : van.pos.z - Math.cos(van.heading) * (van.hitchDist || 0);
        const mx = kupX - Math.sin(hh) * TRAILER_MID;
        const mz = kupZ - Math.cos(hh) * TRAILER_MID;
        const hitch = capsuleHit(mx, mz, hh, TRAILER_R, car.x, car.z, car.heading, 0.95, TRAILER_HALF, 1.1);
        if (hitch) {
          const push = hitch.depth + 0.02;
          if (det) {
            van.trailerPos.x += hitch.nx * push;
            van.trailerPos.z += hitch.nz * push;
          } else {
            van.pushOut(hitch.nx * push, hitch.nz * push);
          }
          if (car.hitCool <= 0) {
            car.hitCool = 1.0;
            const ch = car.heading;
            const cDotN = Math.sin(ch) * hitch.nx + Math.cos(ch) * hitch.nz;
            // Abgerissen zaehlt immer, angekuppelt nur, wenn das Gespann das
            // Auto von hinten gerammt hat (sonst ist es nicht Hans' Rechnung).
            if (this.onCrash && (det || cDotN < -0.5)) {
              const tSpeed = det ? van.trailerSpeed : van.speed;
              const tvx = Math.sin(hh) * tSpeed;
              const tvz = Math.cos(hh) * tSpeed;
              const vcx = Math.sin(ch) * car.speed;
              const vcz = Math.cos(ch) * car.speed;
              const closing = Math.max(0, (vcx - tvx) * hitch.nx + (vcz - tvz) * hitch.nz);
              this.onCrash({
                kind: 'trailer', closing,
                nx: hitch.nx, nz: hitch.nz,
                x: (mx + car.x) / 2,
                z: (mz + car.z) / 2,
              });
            }
            car.shoveT = 0.55; // Auto vorwaerts aus dem Wohnwagen schieben
            if (det) van.trailerSpeed *= -0.25; // freier Wohnwagen prallt ab
            else van.speed *= 0.9;             // leichter Schlag ins Gespann
          }
          if (det) van.syncTrailer();
          else van.sync();
        }
      }
    }
  }
}
