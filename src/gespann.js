import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { isTouchDevice, limitTextureSize } from './device.js';
import { Car } from './car.js';

// ---------------------------------------------------------------------------
// Gespann: Zugfahrzeug aus peugeot-optimized.glb mit Wohnwagen aus
// wohnwagen-optimized.glb. Der Wohnwagen haengt an einer Kupplung
// hinter dem Auto und hat eine eigene Giertynamik - er kann ins Schlingern
// geraten und im Extremfall abreißen. Schlingert er oder kippt das Fahrzeug,
// ist die Quest gescheitert (main.js entscheidet das).
// ---------------------------------------------------------------------------

// Geometrie (Welt-Einheiten, Fahrzeug-Lokalkoordinaten: +Z = vorwaerts)
const CAR_LEN = 4.2;
const HITCH_DIST = 2.3;   // Kupplung hinter Zugfahrzeug-Mitte: dicht am Heck
                          // (CAR_LEN/2 = 2.1), damit zwischen Auto und Wohnwagen
                          // kein sichtbarer Abstand bleibt

// Wohnwagen-Schlingerphysik (gegen car.js in der Simulation getestet):
//   psi          relativer Giervinkel Zug <-> Wohnwagen (0 = gerade hinterher)
//   sin(psi_eq)  kinematische Ruhelage = KUPPLUNG_AXLE_L * Gierrate / v
//   psiV' = ( -KA*v^2*clamp(sin psi - sin psi_eq, -TIRE_CAP, TIRE_CAP)
//             - (KB*v - KD*v^2)*psiV ) / TRAILER_J
// Feder ~ v^2, Daempfung ~ v; der v^2-Anteil macht das Gespann oberhalb
// von v* = KB/KD (~72 km/h) instabil: Ab ~60 km/h wird das Schlingern
// deutlich spuerbar, oberhalb von ~75 km/h eskaliert es unaufhaltsam,
// bis die Kupplung reisst - nur Runter vom Gas rettet dann.
// TIRE_CAP begrenzt die Rueckstellkraft wie die Haftgrenze des
// Wohnwagen-Reifens: keine Rueckzerreiss-Anteile ("Reifen rutscht"),
// dadurch bleibt auch hartem Lenken ein dutzendsmal wiederholbares
// Manoever moeglich - abzureissen ist extrem selten.
const TRAILER_L = 2.8;    // Kupplung <-> Wohnwagenachse
const BREAK_PSI = 1.45;   // ~83 Grad relativer Winkel -> Kupplung reisst ab
const KA = 0.004;         // Rueckstell-"Feder"
const KB = 0.30;          // Daempfung
const KD = 0.015;         // destabilisierender Anteil (Schlingern ab ~60 km/h, kritisch ab ~72)
const TRAILER_J = 1.0;    // normiertes Traegheitsmoment
const S_EQ_CAP = 0.45;    // gedeckelte Ruhelage (~26 Grad Einknickwinkel)
const TIRE_CAP = 0.26;     // Kraftsaettigung der Wohnwagen-Achse (Reifenhaftung)

// GLB-Modelle (beide Meshopt-komprimiert, EXT_meshopt_compression)
const CAR_MODEL_URL = 'assets/3d/peugeot-optimized.glb';
const TRAILER_MODEL_URL = 'assets/3d/wohnwagen-optimized.glb';
const TRAILER_MODEL_LEN = 5.0; // Ziel-Laenge des Wohnwagens in Welt-Einheiten
// Der Wohnwagen wird um diesen Betrag ueber die Kupplung hinaus nach vorn
// gezogen: die Deichsel verschwindet im Zugfahrzeug-Heck, damit zwischen
// Wagen und Auto kein sichtbarer Spalt bleibt.
const TRAILER_COUPLING_OVERLAP = 0.4;
// Der Peugeot liegt wie der Campervan mit der Laengsachse auf X; CAR_MODEL_ROT_Y
// dreht die Front auf +Z (Fahrtrichtung). Der Wohnwagen liegt mit der Laengsachse
// auf Z; TRAILER_MODEL_ROT_Y legt fest, welches Ende zur Kupplung (+Z) zeigt -
// haengt der Wohnwagen verkehrt herum am Auto: Math.PI einsetzen.
const CAR_MODEL_ROT_Y = Math.PI / 2;
const TRAILER_MODEL_ROT_Y = 0;


export class Gespann extends Car {
  constructor(scene) {
    super(scene); // this.group/this.body und die Fahrphysik kommen aus Car

    this.hitchDist = HITCH_DIST;
    this.psi = 0;            // relativer Winkel Zug <-> Wohnwagen
    this.psiVel = 0;
    this.trailerPos = new THREE.Vector3(); // nur relevant, wenn abgerissen
    this.trailerHeading = 0;
    this.trailerSpeed = 0;
    this.trailerSpin = 0;
    this.onBreakoff = null;  // Callback, feuert einmal beim Abreissen

    this.trailerGroup = new THREE.Group(); // sitzt an der Kupplung
    scene.add(this.trailerGroup);

    // Das Zugfahrzeug neigt sich fast nicht und schwingt kaum nach:
    // sehr kleiner Wank-Anteil + hoehere Wank-Daempfung. Damit Kippen
    // trotzdem erreichbar bleibt, kompensiert load() das mit einem
    // entsprechend kleinen Kippwinkel.
    this.rollGain = 0.0008;
    this.rollDamping = 5.0;

    this.syncTrailer();
  }

  // Die Modelle werden aus den GLB-Dateien geladen; die Geometrie-Konstanten
  // (CAR_LEN, TRAILER_L etc.) bleiben massgebend fuer die Physik und das Scaling.
  async load() {
    await Promise.all([this.loadCarModel(), this.loadTrailerModel()]);
  }

  // Gemeinsamer GLB-Lader: Meshopt-Decoder, Schatten, Mobil-Texturbegrenzung.
  async loadGlb(url) {
    const loader = new GLTFLoader();
    await MeshoptDecoder.ready;
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    if (isTouchDevice) limitTextureSize(model, 1024); // GPU-Speicher sparen (Mobil)
    return model;
  }

  // Peugeot auf Laengsachse X (wie der Campervan), Front auf +Z, auf CAR_LEN
  // skaliert, zentriert und auf den Boden gestellt (analog Car.load in car.js).
  async loadCarModel() {
    const model = await this.loadGlb(CAR_MODEL_URL);

    const rot = new THREE.Group();
    rot.add(model);
    rot.rotation.y = CAR_MODEL_ROT_Y;

    const inner = new THREE.Group();
    inner.add(rot);
    const box0 = new THREE.Box3().setFromObject(model);
    const size0 = box0.getSize(new THREE.Vector3());
    inner.scale.setScalar(CAR_LEN / size0.x); // Modell-Laenge liegt auf X

    const box = new THREE.Box3().setFromObject(inner);
    const center = box.getCenter(new THREE.Vector3());
    inner.position.set(-center.x, -box.min.y, -center.z);
    this.body.add(inner);

    // Zugwagen: neigt sich fast gar nicht (rollGain/rollDamping s. Konstruktor),
    // kippt aber bei brutalen Rucklenkern bei Maxspeed. cogHeight ist der
    // Tuning-Regler, der die beiden Effekte voneinander entkoppelt.
    const size = box.getSize(new THREE.Vector3());
    this.applySize(size, 12.0);
  }

  // Wohnwagen auf Laengsachse Z, auf TRAILER_MODEL_LEN skaliert. Lokaler
  // Nullpunkt des trailerGroup ist die KUPPLUNG: das zur Kupplung zeigende
  // Ende liegt bei z=0, der Aufbau erstreckt sich nach -Z (wie beim alten
  // prozeduralen Wohnwagen), unten auf dem Boden.
  async loadTrailerModel() {
    const model = await this.loadGlb(TRAILER_MODEL_URL);

    const rot = new THREE.Group();
    rot.add(model);
    rot.rotation.y = TRAILER_MODEL_ROT_Y;

    const inner = new THREE.Group();
    inner.add(rot);
    const box0 = new THREE.Box3().setFromObject(model);
    const size0 = box0.getSize(new THREE.Vector3());
    inner.scale.setScalar(TRAILER_MODEL_LEN / size0.z); // Laenge liegt auf Z
    inner.scale.x *= 0.9; // Wohnwagen 10 % schmaler (passend zum Kollisionsradius 0.9)

    const box = new THREE.Box3().setFromObject(inner);
    const center = box.getCenter(new THREE.Vector3());
    // Front ueber die Kupplung hinaus ins Zugfahrzeug-Heck gezogen (s. Konstante)
    inner.position.set(-center.x, -box.min.y, -box.max.z + TRAILER_COUPLING_OVERLAP);
    this.trailerGroup.add(inner);
  }

  update(dt, input, colliders, worldHalf, arc = null) {
    super.update(dt, input, colliders, worldHalf, arc);
    this.updateTrailer(dt);
    this.syncTrailer(); // super.update sync'd schon, aber psi hat sich danach geaendert
  }

  // --- Wohnwagen-Dynamik (siehe K_const-Kommentar oben) ---
  updateTrailer(dt) {
    if (this.detached) {
      // Abgerissen: Der Wohnwagen gleitet geradeaus aus und dreht langsam nach.
      this.trailerSpeed -= this.trailerSpeed * 1.6 * dt;
      this.trailerPos.x += Math.sin(this.trailerHeading) * this.trailerSpeed * dt;
      this.trailerPos.z += Math.cos(this.trailerHeading) * this.trailerSpeed * dt;
      this.trailerHeading += this.trailerSpin * dt;
      this.trailerSpin -= this.trailerSpin * 1.5 * dt;
      return;
    }

    const v = this.speed;
    if (Math.abs(v) < 1.0) {
      // Kriechen/Rangieren: rein kinematisches Nachziehen, damit Rueckwaerts
      // und Einparken steuerbar bleiben (keine Schlinger-Dynamik im Stand).
      this.psi += (this.yawRate - (v / TRAILER_L) * Math.sin(this.psi)) * dt;
      this.psiVel = 0;
      return;
    }

    // Kinematische Ruhelage (gedeckelt): sin psi_eq = L * Gierrate / v –
    // der Wohnwagen schwingt beim Kurvenfahren auf bis zu ~16 Grad ein.
    const sEq = THREE.MathUtils.clamp((TRAILER_L * this.yawRate) / v, -S_EQ_CAP, S_EQ_CAP);
    // Rueckstellkraft mit Haftgrenze (TIRE_CAP): wie ein Reifen, der ab
    // einer gewissen Querlast blockiert statt beliebig stark zurueckzuziehen.
    const spring = -KA * v * v * THREE.MathUtils.clamp(Math.sin(this.psi) - sEq, -TIRE_CAP, TIRE_CAP);
    const damp = -(KB * v - KD * v * v) * this.psiVel;
    this.psiVel += ((spring + damp) / TRAILER_J) * dt;
    this.psi += this.psiVel * dt;

    if (Math.abs(this.psi) >= BREAK_PSI) this.detach();
  }

  // Der Wohnwagen ist so weit ausgeschlagen, dass die Kupplung bricht.
  detach() {
    if (this.detached) return;
    this.detached = true;
    this.trailerSpeed = Math.abs(this.speed); // gleitet mit Schwung aus
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    this.trailerPos.set(this.pos.x - fx * this.hitchDist, 0, this.pos.z - fz * this.hitchDist);
    this.trailerHeading = this.heading - this.psi;
    this.trailerSpin = THREE.MathUtils.clamp(this.psiVel * 0.5, -0.8, 0.8);
    if (this.onBreakoff) this.onBreakoff();
  }

  // Wohnwagen an der Kupplung ausrichten (oder als freien Koerper bewegen).
  syncTrailer() {
    if (!this.trailerGroup) return;
    if (this.detached) {
      this.trailerGroup.position.copy(this.trailerPos);
      this.trailerGroup.rotation.y = this.trailerHeading;
    } else {
      const fx = Math.sin(this.heading);
      const fz = Math.cos(this.heading);
      this.trailerGroup.position.set(
        this.pos.x - fx * this.hitchDist, 0, this.pos.z - fz * this.hitchDist
      );
      this.trailerGroup.rotation.y = this.heading - this.psi;
    }
  }

  sync() {
    super.sync();
    this.syncTrailer();
  }

  reset() {
    super.reset();
    this.psi = 0;
    this.psiVel = 0;
    this.detached = false;
    this.trailerSpeed = 0;
    this.trailerSpin = 0;
    this.trailerHitCool = 0; // Crash-Abklang des freien Wohnwagens (traffic.js)
    this.trailerPos.set(this.spawn.x, 0, this.spawn.z);
    this.trailerHeading = this.spawn.heading;
    this.syncTrailer();
  }
}
