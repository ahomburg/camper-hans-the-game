import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { laneRadii } from './arc.js';
import { carHonk } from './audio.js';

const CAR_MODEL_URLS = ['car_mercedes_meshopt.glb', 'car_kaefer_meshopt.glb', 'car_ente_meshopt.glb'];
const CAR_LENGTH = 3.6; // Ziel-Laenge der Ente (10% kleiner als urspruenglich 4.0; der Van bleibt unveraendert)
// Mercedes und Kaefer sind nochmals 10% kleiner als die Ente
const CAR_MODEL_LENGTHS = CAR_MODEL_URLS.map((_, i) => (i < 2 ? CAR_LENGTH * 0.9 : CAR_LENGTH));

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

// Kapsel-gegen-Kapsel-Kollision (je 2 Kreise entlang der Fahrzeugachse,
// Radius ~ halbe Fahrzeugbreite). Damit stoesst ein Auto in der Nachbarspur
// (Achsabstand = Spurbreite 2.64) nicht mehr an den Van, obwohl die alten
// Kreisradien (1.8 + 1.67 = 3.47) das falschelich taten.
function capsuleHit(ax, az, aHeading, aR, bx, bz, bHeading, bR) {
  const adx = Math.sin(aHeading), adz = Math.cos(aHeading);
  const bdx = Math.sin(bHeading), bdz = Math.cos(bHeading);
  const aPts = [[ax + adx * 1.5, az + adz * 1.5], [ax - adx * 1.5, az - adz * 1.5]];
  const bPts = [[bx + bdx * 1.1, bz + bdz * 1.1], [bx - bdx * 1.1, bz - bdz * 1.1]];
  const min = aR + bR;
  for (const [px, pz] of aPts) {
    for (const [qx, qz] of bPts) {
      const dx = px - qx, dz = pz - qz;
      if (dx * dx + dz * dz < min * min) return true;
    }
  }
  return false;
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
  }

  // Laedt car_mercedes/car_kaefer/car_ente_meshopt.glb als Vorlagen. onProgress(i, n).
  async loadCarModels(onProgress = null) {
    const loader = new GLTFLoader();
    // Die car_*_meshopt.glb sind Meshopt-komprimiert (EXT_meshopt_compression)
    await MeshoptDecoder.ready;
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.templates = [];
    for (let i = 0; i < CAR_MODEL_URLS.length; i++) {
      const gltf = await loader.loadAsync(CAR_MODEL_URLS[i]);
      gltf.scene.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
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
    // GLB-Modell im Wechsel (car_mercedes/car_kaefer/car_ente_meshopt): bei 30
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
      hitCool: 0,                     // Nachklang-Sperre nach einem Treffer
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

  update(dt, van = null) {
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
        if (
          car.bounceT <= 0 && car.hitCool <= 0 &&
          capsuleHit(van.pos.x, van.pos.z, van.heading, 1.1, car.collider.x, car.collider.z, car.mesh.rotation.y, 0.95)
        ) {
          car.bounceT = 1.1; // Sekunden Rueckwaerts-Fahrt
          car.hitCool = 2.0;
          // Der Van prallt ebenfalls zurueck (faehrt kurz rueckwaerts)
          van.speed = -Math.abs(van.speed) * 0.6 - 3;
        }
      }

      const r = this.laneRadii[car.lane];
      if (car.bounceT > 0) {
        // Bounce: das Auto faehrt ein Stueck gegen die Fahrtrichtung zurueck
        car.bounceT -= dt;
        car.ang -= (car.speed / r) * 1.4 * dt;
      } else {
        car.omega = car.speed / r;
        car.ang += car.omega * dt;
      }
      if (car.ang >= Math.PI * 2) car.ang -= Math.PI * 2;
      if (car.ang < 0) car.ang += Math.PI * 2;
      this.place(car);
    }
    // Abstand innerhalb einer Spur halten ( Auffahrschutz )
    for (let lane = 0; lane < this.laneRadii.length; lane++) {
      const r = this.laneRadii[lane];
      const inLane = this.cars.filter((c) => c.lane === lane).sort((a, b) => a.ang - b.ang);
      if (inLane.length < 2) continue;
      for (let i = 0; i < inLane.length; i++) {
        const car = inLane[i];
        const next = inLane[(i + 1) % inLane.length];
        let gap = next.ang - car.ang;
        if (gap < 0) gap += Math.PI * 2;
        const gapLen = gap * r;
        if (gapLen < 7) car.speed = Math.min(car.speed, next.speed * (gapLen / 7));
      }
    }
  }
}
