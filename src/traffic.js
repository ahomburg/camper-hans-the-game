import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { laneRadii } from './arc.js';
import { carHonk } from './audio.js';
import { isTouchDevice, limitTextureSize } from './device.js';

const CAR_MODEL_URLS = ['assets/3d/car_mercedes-optimized.glb', 'assets/3d/car_kaefer-optimized.glb', 'assets/3d/car_ente-optimized.glb'];
const CAR_LENGTH = 3.6; // Ziel-Laenge der Ente (10% kleiner als urspruenglich 4.0; der Van bleibt unveraendert)
// Mercedes und Kaefer sind nochmals 10% kleiner als die Ente; die Ente selbst 20% kleiner (3.6 * 0.8 = 2.88)
const CAR_MODEL_LENGTHS = CAR_MODEL_URLS.map((_, i) => (i < 2 ? CAR_LENGTH * 0.9 : CAR_LENGTH * 0.8));

const PALETTE = [
  0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad,
  0x16a085, 0xd35400, 0x2c3e50, 0xecf0f1, 0x7f8c8d,
];

// Deterministischer Zufall (fuer reproduzierbaren Verkehr).
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Kapselradius des Wohnwagens im Gespann (~1.8 breit: 10 % schmaler als die
// alte Annahme 2.0, passend zum um 10 % schmaler skalierten Modell).
const TRAILER_R = 0.9;
// Geometrie des Wohnwagens: trailerPos/trailerGroup-Ursprung ist die KUPPLUNG,
// der Aufbau (5.0 lang, 0.4 ueberlappen ins Zugheck) erstreckt sich dahinter:
// Mitte = 2.1 hinter der Kupplung, Kapselkreise bei ±1.6 um die Mitte decken
// damit den Aufbau von +0.4 bis -4.6 ab.
const TRAILER_MID = 2.1;
const TRAILER_HALF = 1.6;

function makeCarMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.55, 4.0),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 })
  );
  body.position.y = 0.55;
  body.castShadow = true;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.5, 2.0),
    new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.2, metalness: 0.6 })
  );
  cabin.position.set(0, 1.05, -0.2);
  cabin.castShadow = true;
  g.add(body, cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 });
  for (const [wx, wz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.34, wz);
    g.add(w);
  }
  return g;
}

// Kapsel-gegen-Kapsel-Kollision mit Aufloesung: Jede Kapsel ist eine Strecke
// (Kreiszentren bei ±aOff/±bOff entlang der Fahrzeugachse) mit Radius aR/bR.
// Die Stossnormale entsteht aus dem NAECHSTEN Punktepaar der beiden Strecken
// (Segment-Segment, nach Ericson) - im Gegensatz zu einem "tiefsten
// Kreispaar" ist das auch bei stark ueberlappenden Kapseln (z.B. Wohnwagen-
// Bug im Zugheck nach dem Abreissen) immer die korrekte Schieberichtung.
// Liefert null oder { nx, nz, depth }: Normale (von b auf a) + Eindringtiefe.
// aOff/bOff-Defaults passen fuer Van (4.4) und Ente/Kaefer/Mercedes; der
// Wohnwagen (5.0) im Gespann nutzt groessere.
export function capsuleHit(ax, az, aHeading, aR, bx, bz, bHeading, bR, aOff = 1.5, bOff = 1.1) {
  const adx = Math.sin(aHeading), adz = Math.cos(aHeading);
  const bdx = Math.sin(bHeading), bdz = Math.cos(bHeading);
  const a1x = ax - adx * aOff, a1z = az - adz * aOff; // Strecken-Endpunkte
  const a2x = ax + adx * aOff, a2z = az + adz * aOff;
  const b1x = bx - bdx * bOff, b1z = bz - bdz * bOff;
  const b2x = bx + bdx * bOff, b2z = bz + bdz * bOff;

  const d1x = a2x - a1x, d1z = a2z - a1z;
  const d2x = b2x - b1x, d2z = b2z - b1z;
  const rx = a1x - b1x, rz = a1z - b1z;
  const a = d1x * d1x + d1z * d1z;
  const e = d2x * d2x + d2z * d2z;
  const f = d2x * rx + d2z * rz;
  const eps = 1e-9;
  let s = 0, t = 0;
  if (a > eps && e > eps) {
    const c = d1x * rx + d1z * rz;
    const b = d1x * d2x + d1z * d2z;
    const denom = a * e - b * b;
    s = denom > eps ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
  } else if (e > eps) { // Strecke A ist ein Punkt
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  }

  const px = a1x + d1x * s, pz = a1z + d1z * s; // naechstes Paar: P auf A, Q auf B
  const qx = b1x + d2x * t, qz = b1z + d2z * t;
  const dx = px - qx, dz = pz - qz;
  const dist = Math.hypot(dx, dz);
  const depth = aR + bR - dist;
  if (depth <= 0) return null;

  let nx, nz;
  if (dist > 1e-4) {
    nx = dx / dist; nz = dz / dist;
  } else {
    // Entartet (Strecken kreuzen/ueberlappen): Richtung gegen den Mittelpunkt
    // von b schieben, sonst quer zur Achse von a.
    const cx = ax - bx, cz = az - bz;
    const cd = Math.hypot(cx, cz);
    if (cd > 1e-4) { nx = cx / cd; nz = cz / cd; }
    else { nx = adz; nz = -adx; }
  }
  return { nx, nz, depth };
}

// GLB-Automodell normalisieren: laengste horizontale Achse auf +Z drehen
// (Fahrtrichtung), auf CAR_LENGTH skalieren, zentrieren und auf den Boden
// stellen. Rueckgabe ist ein Group-Template, das per clone() vervielfaelt wird.
// WICHTIG: Die Orientierung liegt auf dem inneren Group – place() setzt
// naemlich jedes Frame die rotation.y des aeusseren Group (Fahrtrichtung)
// und wuerde eine aeussere Drehung sonst ueberschreiben (Auto faehrt quer).
function normalizeCarModel(model, targetLength = CAR_LENGTH) {
  const outer = new THREE.Group(); // bekommt von place() die Heading-Drehung
  const inner = new THREE.Group(); // traegt Modell-Orientierung/Skalierung
  inner.add(model);
  outer.add(inner);

  const box0 = new THREE.Box3().setFromObject(outer);
  const size0 = box0.getSize(new THREE.Vector3());
  if (size0.x > size0.z) inner.rotation.y = -Math.PI / 2; // Laenge auf X -> Z (+X ist Front)
  outer.updateMatrixWorld(true);

  const box1 = new THREE.Box3().setFromObject(outer);
  const size1 = box1.getSize(new THREE.Vector3());
  inner.scale.setScalar(targetLength / Math.max(size1.x, size1.z));
  outer.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(outer);
  const c = box2.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box2.min.y, -c.z); // zentriert, min.y = 0
  outer.updateMatrixWorld(true);
  return outer;
}

// Verkehrsautos auf den Spuren des Kreisverkehrs. Fahren gegen den
// Uhrzeigersinn (Rechtsverkehr wie in Paris), eine Geschwindigkeit pro Spur.
export class Traffic {
  constructor(scene, arc, { baseSpeed = 11, seed = 20240601 } = {}) {
    this.scene = scene;
    this.arc = arc;
    this.baseSpeed = baseSpeed;
    this.rand = mulberry32(seed);
    this.laneRadii = laneRadii(arc);
    this.cars = [];
    this.colliders = []; // ein Eintrag pro Auto, wird in update() mitbewegt
    this.templates = []; // GLB-Vorlagen (car_*.glb), leer = Kisten-Fallback
    // Muenz-System (main.js verdrahtet das): onCrash = Spieler hat ein
    // Objekt gerammt ({ kind, closing, nx, nz, x, z }), onNearMiss = knapp
    // und schnell an einem Auto vorbeigeschert (+ Ueberhol-Praemie).
    this.onCrash = null;
    this.onNearMiss = null;
  }

  // Laedt car_mercedes/car_kaefer/car_ente-optimized.glb als Vorlagen. onProgress(i, n).
  async loadCarModels(onProgress = null) {
    const loader = new GLTFLoader();
    // Die car_*-optimized.glb sind Meshopt-komprimiert (EXT_meshopt_compression)
    await MeshoptDecoder.ready;
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.templates = [];
    for (let i = 0; i < CAR_MODEL_URLS.length; i++) {
      const gltf = await loader.loadAsync(CAR_MODEL_URLS[i]);
      gltf.scene.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      if (isTouchDevice) limitTextureSize(gltf.scene, 1024); // GPU-Speicher sparen (Mobil)
      this.templates.push(normalizeCarModel(gltf.scene, CAR_MODEL_LENGTHS[i]));
      if (onProgress) onProgress(i + 1, CAR_MODEL_URLS.length);
    }
    return this.templates;
  }

  get count() {
    return this.cars.length;
  }

  setTarget(n) {
    while (this.cars.length < n) this.addCar();
    while (this.cars.length > n) this.removeCar();
  }

  addCar() {
    // Spur mit den wenigsten Autos waehlen
    const counts = this.laneRadii.map((_, i) => this.cars.reduce((n, c) => n + (c.lane === i ? 1 : 0), 0));
    let lane = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] < counts[lane]) lane = i;

    // Groesste Winkelluecke in dieser Spur finden und das Auto mittig platzieren
    const inLane = this.cars.filter((c) => c.lane === lane).map((c) => c.ang).sort((a, b) => a - b);
    let ang;
    if (inLane.length === 0) {
      ang = this.rand() * Math.PI * 2;
    } else {
      let bestGap = -1, bestMid = 0;
      for (let i = 0; i < inLane.length; i++) {
        const a0 = inLane[i];
        const a1 = inLane[(i + 1) % inLane.length] + (i === inLane.length - 1 ? Math.PI * 2 : 0);
        const gap = a1 - a0;
        if (gap > bestGap) { bestGap = gap; bestMid = a0 + gap / 2; }
      }
      ang = bestMid + (this.rand() - 0.5) * 0.15;
    }

    // Jedes Auto bekommt eine eigene Zufallsgeschwindigkeit (deutlich gestreut)
    const speed = this.baseSpeed * (0.6 + this.rand() * 0.8) * (0.92 + 0.04 * lane);
    // GLB-Modell im Wechsel (car_mercedes/car_kaefer/car_ente-optimized): bei 30
    // Autos ab Start sind das genau 10x Mercedes, 10x Kaefer, 10x Ente.
    // Kisten-Fallback, falls die Modelle nicht geladen sind.
    const modelIdx = this.cars.length % Math.max(1, this.templates.length);
    let mesh;
    if (this.templates.length > 0) {
      mesh = this.templates[modelIdx].clone(true);
    } else {
      mesh = makeCarMesh(PALETTE[Math.floor(this.rand() * PALETTE.length) % PALETTE.length]);
    }
    this.scene.add(mesh);
    const collider = { x: 0, z: 0, r: 1.8 };
    const car = {
      lane, ang, speed, omega: speed / this.laneRadii[lane], mesh, collider,
      honkVariant: modelIdx,          // jedes Automodell hat seine eigene Hupe
      nextHonk: 2 + this.rand() * 12, // zufaelliges Hupen
      bounceT: 0,                     // > 0: Auto prallt zurueck
      shoveT: 0,                      // > 0: Van hat es von hinten angestossen,
                                       // faehrt kurz mit Schubtempo nach vorn
      hitCool: 0,                     // Nachklang-Sperre nach einem Treffer
      nearMissCool: 0,                // Sperre fuer die Ueberhol-Praemie
    };
    this.cars.push(car);
    this.colliders.push(collider);
    this.place(car);
    return car;
  }

  removeCar() {
    const counts = this.laneRadii.map((_, i) => this.cars.reduce((n, c) => n + (c.lane === i ? 1 : 0), 0));
    let lane = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] > counts[lane]) lane = i;
    const idx = this.cars.findIndex((c) => c.lane === lane);
    if (idx === -1) return;
    const [car] = this.cars.splice(idx, 1);
    this.scene.remove(car.mesh);
    this.colliders.splice(this.colliders.indexOf(car.collider), 1);
  }

  place(car) {
    const r = this.laneRadii[car.lane];
    const x = this.arc.cx + Math.sin(car.ang) * r;
    const z = this.arc.cz + Math.cos(car.ang) * r;
    car.mesh.position.set(x, 0, z);
    car.mesh.rotation.y = car.ang + Math.PI / 2; // Tangente, gegen Uhrzeigersinn
    car.collider.x = x;
    car.collider.z = z;
  }

  update(dt, van = null, colliders = [], worldHalf = 0) {
    // Abgerissener Wohnwagen des Gespanns (nur das Gespann hat detached /
    // trailerPos): Er ist ein eigenstaendiges Objekt und kollidiert mit den
    // statischen Hindernissen, der Welt-Grenze und dem Zugfahrzeug. Die
    // Verkehrautos behandelt die Schleife unten pro Auto. Der Wohnwagen ist
    // 5.0 lang / ~1.8 breit -> Kapsel: 2 Kreise (r = TRAILER_R) bei ±1.6.
    if (van && van.detached) {
      if (van.trailerHitCool > 0) van.trailerHitCool -= dt; // Crash-Abklang (s.o.)
      const t = van.trailerPos;
      const fx = Math.sin(van.trailerHeading), fz = Math.cos(van.trailerHeading);
      // Kapselmitte des Aufbaus: 2.1 hinter der Kupplung (trailerPos)
      const mx = t.x - fx * TRAILER_MID;
      const mz = t.z - fz * TRAILER_MID;
      // Statische Hindernisse (Gebaeude, Baeume, ...): Kreis gegen Kapsel
      for (const c of colliders) {
        for (const off of [TRAILER_HALF, -TRAILER_HALF]) {
          const px = mx + fx * off, pz = mz + fz * off;
          const dx = px - c.x, dz = pz - c.z;
          const d = Math.hypot(dx, dz);
          const min = c.r + TRAILER_R;
          if (d < min && d > 1e-4) {
            const p = (min - d) / d;
            t.x += dx * p; t.z += dz * p;
            // Muenz-System: der abgerissen Wohnwagen knallt gegen ein
            // Hindernis - Hans' Blech, Hans' Rechnung. Abkling-Sperre, damit
            // das Rutschen entlang eines Zauns nicht jeden Kontakt einzeln
            // abrechnet.
            if (this.onCrash && Math.abs(van.trailerSpeed) > 2 && !(van.trailerHitCool > 0)) {
              van.trailerHitCool = 1.0;
              this.onCrash({
                kind: 'trailer', closing: Math.abs(van.trailerSpeed),
                nx: dx / d, nz: dz / d,
                x: (px + c.x) / 2, z: (pz + c.z) / 2,
              });
            }
            van.trailerSpeed *= -0.25; // leichter Bounce
          }
        }
      }
      // Welt-Grenze (wie beim Zugfahrzeug in car.js)
      if (worldHalf > 0) {
        const lim = worldHalf - 3;
        if (Math.abs(t.x) > lim) { t.x = Math.sign(t.x) * lim; van.trailerSpeed *= 0.4; }
        if (Math.abs(t.z) > lim) { t.z = Math.sign(t.z) * lim; van.trailerSpeed *= 0.4; }
      }
      // Zugfahrzeug: Kapsel gegen Kapsel, beide werden auseinandergeschoben.
      // Der groesste Teil schiebt den freien Wohnwagen, ein kleineres Stueck
      // das Zugfahrzeug (pushOut uebernimmt auch die Spurfuehrung im Ring).
      // In der gekoppelten Position ueberlappt der Wohnwagen-Bug das Heck des
      // Zugfahrzeugs absichtlich (TRAILER_COUPLING_OVERLAP); deshalb bis zu
      // drei Durchgaenge pro Frame. Die Korrektur ist pro Durchgang auf 0.5
      // begrenzt, damit der Wohnwagen nach dem Abreissen nicht springt.
      let tugBounced = false;
      for (let i = 0; i < 3; i++) {
        const tug = capsuleHit(mx, mz, van.trailerHeading, TRAILER_R, van.pos.x, van.pos.z, van.heading, 1.1, TRAILER_HALF, 1.5);
        if (!tug) break;
        const push = Math.min(tug.depth + 0.02, 0.5);
        t.x += tug.nx * push * 0.7;
        t.z += tug.nz * push * 0.7;
        // Das Zugfahrzeug wandert ENTLANG der entgegengesetzten Richtung
        // (Normale zeigt vom Zug zum Wohnwagen).
        van.pushOut(-tug.nx * push * 0.3, -tug.nz * push * 0.3);
        if (!tugBounced) {
          tugBounced = true;
          van.trailerSpeed *= -0.25; // Wohnwagen prallt ab
          van.speed *= 0.85;         // leichter Schlag aufs Zugfahrzeug
        }
      }
      van.sync();            // pushOut bewegte moeglicherweise das Zugfahrzeug
      van.syncTrailer();    // Positionskorrekturen ins Rendering uebernehmen
    }

    for (const car of this.cars) {
      // Zufaelliges Hupen
      car.nextHonk -= dt;
      if (car.nextHonk <= 0) {
        carHonk(car.honkVariant || 0);
        car.nextHonk = 4 + this.rand() * 12;
      }

      // Trifft das Auto den Campervan, prallen beide zurueck
      if (van) {
        if (car.hitCool > 0) car.hitCool -= dt;
        const hit = capsuleHit(van.pos.x, van.pos.z, van.heading, 1.1, car.collider.x, car.collider.z, car.mesh.rotation.y, 0.95);
        if (hit) {
          // 1) Positionskorrektur - IMMER, damit Van und Auto nie ineinander
          // verschwinden: der Van wird entlang der Stossnormalen herausgeschoben,
          // bis die Kapseln sich gerade nicht mehr ueberlappen. pushOut nimmt
          // die Korrektur auch in die Spurfuehrung auf, damit sie nicht im
          // naechsten Frame wieder rueckgaengig gemacht wird (kein Ruckeln).
          van.pushOut(hit.nx * (hit.depth + 0.02), hit.nz * (hit.depth + 0.02));
          // 2) Bounce-Impuls nur bei frischem Treffer (Nachklang-Sperre), sonst
          // wiederholte Impulse solange sich beide noch beruehren.
          if (car.bounceT <= 0 && car.hitCool <= 0) {
            car.hitCool = 1.0;
            // Wo sitzt der Treffer? Stossnormale (Auto -> Van) gegen die
            // Fahrtrichtung des Autos: zeigt sie nach HINTEN, sitzt der Van
            // dahinter (Auffahrunfall - das Auto wird nach vorn geschoben),
            // zeigt sie nach vorn, faehrt das Auto auf den Van auf (- Rueckstoss).
            const ch = car.mesh.rotation.y;
            const cDotN = Math.sin(ch) * hit.nx + Math.cos(ch) * hit.nz;
            // Muenz-System: Crash an die Reisekasse melden, BEVOR die
            // Bounce-Impulse unten das Tempo verbiegen - die Harte des
            // Aufpralls ist die Annaeherungsgeschwindigkeit beider Fahrzeuge
            // entlang der Stossnormalen. Sanftes Streifen im Gleichtritt ist
            // billiger Lackschaden, ein Frontal-Crash der Totalschaden.
            if (this.onCrash) {
              const vvx = Math.sin(van.heading) * van.speed;
              const vvz = Math.cos(van.heading) * van.speed;
              const vcx = Math.sin(ch) * car.speed;
              const vcz = Math.cos(ch) * car.speed;
              const closing = Math.max(0, (vcx - vvx) * hit.nx + (vcz - vvz) * hit.nz);
              this.onCrash({
                kind: 'car', closing,
                nx: hit.nx, nz: hit.nz,
                x: (van.pos.x + car.collider.x) / 2,
                z: (van.pos.z + car.collider.z) / 2,
              });
            }
            if (cDotN < -0.5) {
              // Auffahrunfall: Auto ein Stueck nach vorn schieben
              // (Positionsschub + kurzer, auslaufender Schubtempo-Anteil).
              car.shoveT = 0.55;
              car.ang += Math.min(hit.depth, 0.3) / this.laneRadii[car.lane];
            } else {
              car.bounceT = 0.45; // kurzer Rueckstoss statt langem Rueckwaerts-Sprung
            }
            // Richtung, in die der Van abbounce (Stossnormale gegenueber der
            // Fahrzeug-Nase des Vans):
            const nDotH = Math.sin(van.heading) * hit.nx + Math.cos(van.heading) * hit.nz;
            if (Math.abs(nDotH) < 0.5) {
              // Seitentreffer (typisch: Spurwechsel in ein besetztes Auto):
              // Spurwechsel abbrechen - der Van prallt in seine alte Spur
              // zurueck und verliert deutlich Tempo. Ohne laufenden
              // Spurwechsel spielt abortLaneChange keine Rolle, der
              // Temposchlag bleibt als Aufprall spuerbar.
              van.abortLaneChange();
              van.speed *= 0.4;
            } else if (nDotH >= 0) {
              // Van zeigt vom Auto weg -> Schwung nach vorn (Heck-Kollision)
              van.speed = Math.abs(van.speed) * 0.6 + 3;
            } else {
              // Van faehrt mit der Nase aufs Auto -> rueckwaerts abbounce
              van.speed = -Math.abs(van.speed) * 0.6 - 3;
            }
          }
          // Positionskorrektur auch ins Rendering uebernehmen (Van wurde bewegt)
          van.sync();
        }
      }

      // Wohnwagen des Gespanns - angekuppelt wie abgerissen ein fester
      // Koerper: Verkehrautos koennen nie durch ihn hindurchfahren. Der
      // ANGEKUPPELTE Wagen verhaelt sich wie das Zugfahrzeug (Auto prallt
      // ab, Gespann wird entlang der Stossnormalen herausgeschoben, pushOut
      // haelt die Spurfuehrung im Ring synchron - der Wagen folgt der
      // Kupplung kinematisch mit). Der ABGERISSENE ist ein freier Koerper.
      if (van && van.trailerGroup) {
        const det = !!van.detached;
        // Wagenposition/-ausrichtung: angekuppelt an der Kupplung hinter
        // dem Zug (inkl. Schlingern psi), abgerissen frei (trailerPos).
        const hh = det
          ? van.trailerHeading
          : van.heading - (van.psi || 0);
        const kupX = det
          ? van.trailerPos.x
          : van.pos.x - Math.sin(van.heading) * van.hitchDist;
        const kupZ = det
          ? van.trailerPos.z
          : van.pos.z - Math.cos(van.heading) * van.hitchDist;
        // Kapselmitte des Aufbaus: 2.1 hinter der Kupplung - trailerPos ist
        // der ANKER (Aufbau erstreckt sich dahinter), nicht die Wagenmitte.
        const mx = kupX - Math.sin(hh) * TRAILER_MID;
        const mz = kupZ - Math.cos(hh) * TRAILER_MID;
        const hitch = capsuleHit(mx, mz, hh, TRAILER_R, car.collider.x, car.collider.z, car.mesh.rotation.y, 0.95, TRAILER_HALF, 1.1);
        if (hitch) {
          // 1) Trennung: angekuppelt das ganze Gespann, abgerissen nur den
          // freien Wohnwagen entlang der Stossnormalen hinausschieben.
          const push = hitch.depth + 0.02;
          if (det) {
            van.trailerPos.x += hitch.nx * push;
            van.trailerPos.z += hitch.nz * push;
          } else {
            van.pushOut(hitch.nx * push, hitch.nz * push);
          }
          // 2) Bounce-Impuls nur bei frischem Treffer (Nachklang-Sperre)
          if (car.bounceT <= 0 && car.hitCool <= 0) {
            car.hitCool = 1.0;
            // Wie beim Van: Stossnormale gegen die Fahrtrichtung des Autos.
            const ch = car.mesh.rotation.y;
            const cDotN = Math.sin(ch) * hitch.nx + Math.cos(ch) * hitch.nz;
            // Muenz-System: Spieler-Haftung am Wohnwagen - Severity VOR den
            // Bounce-Impulsen erfassen. Der ABGERISSENE Wagen zaehlt immer
            // (Hans' entlaufener Besitz), der ANGEKUPPELTE nur, wenn das
            // Gespann das Auto von hinten gerammt hat (cDotN < -0.5) - rammt
            // umgekehrt ein Auto den Wohnwagen, ist das nicht Hans' Rechnung.
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
                x: (mx + car.collider.x) / 2,
                z: (mz + car.collider.z) / 2,
              });
            }
            if (cDotN < -0.5) {
              // Wohnwagen/Gespann rammt das Auto von hinten -> vorschieben
              car.shoveT = 0.55;
              if (!det) van.speed *= 0.9; // leichter Schlag ins Gespann
            } else {
              car.bounceT = 0.45; // Auto prallt rueckwaerts ab
              // Rammt das Auto den Wagen von hinten, wird das Gespann mit-
              // geschoben (wie der Van bei einer Heckkollision).
              if (!det && cDotN > 0.5) van.speed = Math.abs(van.speed) * 0.6 + 3;
            }
            if (det) van.trailerSpeed *= -0.25; // freier Wohnwagen prallt ab
          }
          // Positionskorrektur ins Rendering uebernehmen
          if (det) van.syncTrailer();
          else van.sync();
        }
      }

      // Ueberhol-Praemie (Muenz-System): Wer schnell durch den Verkehr
      // schiebt, OHNE etwas zu treffen, verdient ein paar Muenzen. "Knapp
      // vorbei" = die um einen Sicherheitssaum (0.45 je Seite) aufgetriebenen
      // Kollisionsradien ueberlappen, die echten nicht; ab 9 m/s
      // (~32 km/h) und mit 3 s Sperre je Auto, damit statisch-parallel
      // dahertuckern nichts abwirft.
      if (van && this.onNearMiss) {
        car.nearMissCool = Math.max(0, (car.nearMissCool || 0) - dt);
        if (car.nearMissCool <= 0 && car.hitCool <= 0 && Math.abs(van.speed) >= 9) {
          const near = capsuleHit(van.pos.x, van.pos.z, van.heading, 1.55,
            car.collider.x, car.collider.z, car.mesh.rotation.y, 1.4);
          if (near) {
            car.nearMissCool = 3;
            this.onNearMiss({
              x: (van.pos.x + car.collider.x) / 2,
              z: (van.pos.z + car.collider.z) / 2,
            });
          }
        }
      }

      const r = this.laneRadii[car.lane];
      if (car.bounceT > 0) {
        // Bounce: kurzer Rueckstoss gegen die Fahrtrichtung (kein grosser
        // Sprung - sonst landet das Auto hinter dem Van und rammt erneut)
        car.bounceT -= dt;
        car.ang -= (car.speed / r) * 1.2 * dt;
      } else {
        car.omega = car.speed / r;
        if (car.shoveT > 0) {
          // Von hinten angestossen (Auffahrunfall): kurzer, linear
          // auslaufender Vorwaerts-Schub obendrauf.
          car.shoveT -= dt;
          car.omega += (6 / r) * Math.max(0, car.shoveT / 0.55);
        }
        car.ang += car.omega * dt;
      }
      if (car.ang >= Math.PI * 2) car.ang -= Math.PI * 2;
      if (car.ang < 0) car.ang += Math.PI * 2;
      this.place(car);
    }
    // Abstand innerhalb einer Spur halten ( Auffahrschutz )
    // MIN_CAR_GAP = Kapsel-Laenge eines Autos (2*(1.1+0.95)=4.1) plus Puffer:
    // diesen Abstand duerfen zwei Autos einer Spur nie unterschreiten.
    const MIN_CAR_GAP = 4.3;
    for (let lane = 0; lane < this.laneRadii.length; lane++) {
      const r = this.laneRadii[lane];
      const inLane = this.cars.filter((c) => c.lane === lane).sort((a, b) => a.ang - b.ang);
      if (inLane.length < 2) continue;
      for (let i = 0; i < inLane.length; i++) {
        const car = inLane[i];
        const next = inLane[(i + 1) % inLane.length];
        let gap = next.ang - car.ang;
        if (i === inLane.length - 1 && gap < 0) gap += Math.PI * 2;
        const gapLen = gap * r;
        if (gapLen < 7) car.speed = Math.min(car.speed, next.speed * (gapLen / 7));
        // Harte Trennung: dringen zwei Autos einer Spur doch ineinander ein
        // (z.B. bei einem Bounce rueckwaerts), werden beide auseinandergeschoben.
        if (gapLen < MIN_CAR_GAP) {
          const push = (MIN_CAR_GAP - gapLen) * 0.5 / r;
          car.ang -= push;
          next.ang += push;
          if (car.ang < 0) car.ang += Math.PI * 2;
          if (car.ang >= Math.PI * 2) car.ang -= Math.PI * 2;
          if (next.ang < 0) next.ang += Math.PI * 2;
          if (next.ang >= Math.PI * 2) next.ang -= Math.PI * 2;
          this.place(car);
          this.place(next);
        }
      }
    }
  }
}
