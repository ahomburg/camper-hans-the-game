import * as THREE from 'three';

import { Car } from './car.js';

// ---------------------------------------------------------------------------
// Gespann: gruenes Zugfahrzeug mit Wohnwagen (beide prozedural aus Primitiven,
// es gibt dafuer kein GLB-Modell). Der Wohnwagen haengt an einer Kupplung
// hinter dem Auto und hat eine eigene Giertynamik - er kann ins Schlingern
// geraten und im Extremfall abreißen. Schlingert er oder kippt das Fahrzeug,
// ist die Quest gescheitert (main.js entscheidet das).
// ---------------------------------------------------------------------------

// Geometrie (Welt-Einheiten, Fahrzeug-Lokalkoordinaten: +Z = vorwaerts)
const CAR_W = 1.9;
const CAR_LEN = 4.2;
const HITCH_DIST = 2.6;   // Kupplung hinter Zugfahrzeug-Mitte

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

    // Das gruene Auto neigt sich fast nicht und schwingt kaum nach:
    // sehr kleiner Wank-Anteil + hoehere Wank-Daempfung. Damit Kippen
    // trotzdem erreichbar bleibt, kompensiert load() das mit einem
    // entsprechend kleinen Kippwinkel.
    this.rollGain = 0.0008;
    this.rollDamping = 5.0;

    this.syncTrailer();
  }

  // Die Modelle werden prozedural gebaut (kein GLB noetig).
  async load() {
    this.buildCar();
    // Zugwagen: neigt sich fast gar nicht (rollGain/rollDamping s. Konstruktor),
    // kippt aber bei brutalen Rucklenkern bei Maxspeed. cogHeight ist der
    // Tuning-Regler, der die beiden Effekte voneinander entkoppelt.
    this.applySize(new THREE.Vector3(CAR_W, 2.0, CAR_LEN), 12.0);
    this.buildTrailer();
  }

  buildCar() {
    const green = new THREE.MeshLambertMaterial({ color: 0x3a8d3f });
    const darkGreen = new THREE.MeshLambertMaterial({ color: 0x2c6d31 });
    const glass = new THREE.MeshLambertMaterial({ color: 0x16202b });
    const tire = new THREE.MeshLambertMaterial({ color: 0x151515 });

    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.body.add(m);
      return m;
    };

    // Karosserie
    add(new THREE.BoxGeometry(CAR_W, 0.62, CAR_LEN), green, 0, 0.62, 0);
    // Kabine
    add(new THREE.BoxGeometry(CAR_W - 0.2, 0.62, 2.1), darkGreen, 0, 1.22, 0.15);
    // Front-/Heckscheibe
    add(new THREE.BoxGeometry(CAR_W - 0.5, 0.42, 0.1), glass, 0, 1.28, 1.22);
    add(new THREE.BoxGeometry(CAR_W - 0.5, 0.42, 0.1), glass, 0, 1.28, -0.92);
    // Seitenscheiben
    add(new THREE.BoxGeometry(0.08, 0.34, 1.7), glass, (CAR_W - 0.15) / 2, 1.28, 0.15);
    add(new THREE.BoxGeometry(0.08, 0.34, 1.7), glass, -(CAR_W - 0.15) / 2, 1.28, 0.15);
    // Stoßstangen
    add(new THREE.BoxGeometry(CAR_W - 0.1, 0.18, 0.14), darkGreen, 0, 0.4, CAR_LEN / 2);
    add(new THREE.BoxGeometry(CAR_W - 0.1, 0.18, 0.14), darkGreen, 0, 0.4, -CAR_LEN / 2);
    // Kupplungsstab am Heck
    add(new THREE.BoxGeometry(0.12, 0.1, 0.4), darkGreen, 0, 0.42, -CAR_LEN / 2 - 0.12);

    // Raeder (Zylinderachse = X)
    const wg = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14);
    wg.rotateZ(Math.PI / 2);
    for (const [x, z] of [[0.82, 1.35], [-0.82, 1.35], [0.82, -1.35], [-0.82, -1.35]]) {
      add(wg, tire, x, 0.36, z);
    }
  }

  buildTrailer() {
    // Lokaler Nullpunkt des Wohnwagens ist die KUPPLUNG; alles liegt dahinter (-Z).
    const white = new THREE.MeshLambertMaterial({ color: 0xf2efe6 });
    const green = new THREE.MeshLambertMaterial({ color: 0x3a8d3f });
    const glass = new THREE.MeshLambertMaterial({ color: 0x16202b });
    const tire = new THREE.MeshLambertMaterial({ color: 0x151515 });
    const metal = new THREE.MeshLambertMaterial({ color: 0x6b6f74 });

    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.trailerGroup.add(m);
      return m;
    };

    // Deichsel
    add(new THREE.BoxGeometry(0.14, 0.12, 1.0), metal, 0, 0.5, -0.5);
    // Aufbau: 4.2 lang, von z=-0.9 bis -5.1
    const h = 1.85;
    add(new THREE.BoxGeometry(2.0, h, 4.2), white, 0, 0.55 + h / 2, -3.0);
    // gruener Zierstreifen
    add(new THREE.BoxGeometry(2.04, 0.22, 4.2), green, 0, 0.95, -3.0);
    // Fensterband
    add(new THREE.BoxGeometry(2.06, 0.5, 1.9), glass, 0, 1.5, -3.1);
    // Dach (leicht schmaler, dunkler)
    add(new THREE.BoxGeometry(1.8, 0.12, 3.9), metal, 0, 0.55 + h + 0.06, -3.0);
    // Stuetzrad vorn
    add(new THREE.BoxGeometry(0.1, 0.45, 0.1), metal, 0, 0.25, -1.1);
    // Achse + Raeder bei z = -2.8 (TRAILER_L hinter der Kupplung)
    const wg = new THREE.CylinderGeometry(0.32, 0.32, 0.26, 14);
    wg.rotateZ(Math.PI / 2);
    add(wg, tire, 0.88, 0.32, -TRAILER_L);
    add(wg, tire, -0.88, 0.32, -TRAILER_L);
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
    this.trailerPos.set(this.spawn.x, 0, this.spawn.z);
    this.trailerHeading = this.spawn.heading;
    this.syncTrailer();
  }
}
