import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { isTouchDevice, limitTextureSize } from './device.js';

// Das GLB-Modell liegt mit seiner Laengsachse auf der X-Achse und ist in Y zentriert.
// MODEL_ROT_Y dreht das Modell so, dass seine Front auf +Z (Fahrtrichtung) zeigt.
// Falls der Van im Spiel rueckwaerts faehrt: Vorzeichen wechseln (+Math.PI / 2).
const MODEL_ROT_Y = -Math.PI / 2;
const TARGET_LENGTH = 4.4; // Laenge des vans in Welt-Einheiten

export class Car {
  constructor(scene) {
    this.group = new THREE.Group();
    this.body = new THREE.Group(); // traegt die Karosserie-Neigung
    this.group.add(this.body);
    scene.add(this.group);

    this.pos = new THREE.Vector3(0, 0, -100);
    this.heading = 0; // 0 = Fahrtrichtung +Z
    this.speed = 0;
    this.radius = 1.6; // Kollisions-Radius
    this.spawn = { x: 0, z: -100, heading: 0 }; // weiter weg vom Arc de Triomphe

    // Spurhaltung im Kreisverkehr: sobald der Van den Ring erreicht hat,
    // faehrt er in einer Spur weiter; LINKS/RECHTS wechselt nur die Spur.
    this.inRing = false;
    this.ringAng = 0;   // Winkel um den Arc-Mittelpunkt
    this.ringR = 0;     // aktueller Abstand zum Mittelpunkt
    this.ringLane = 0;  // Index der Zielfahrspur
    this._prevLeft = false;
    this._prevRight = false;

    // --- Wank-/Kipp-Physik (hoher Schwerpunkt) ---
    // roll: aktueller Wankwinkel um die Laengsachse (rad), rollVel: Wankgeschwindigkeit
    this.roll = 0;
    this.rollVel = 0;
    this.halfWidth = 0.95;     // halbe Van-Breite (nach dem Laden aus dem Modell)
    this.criticalRoll = 0.6;   // ab diesem Wankwinkel kippt der Van um
    this.tipped = false;       // liegt das Fahrzeug auf der Seite?
    this.tipDir = 0;            // Kipprichtung: -1 links, +1 rechts
    this.tipTimer = 0;
    this.yawRate = 0;           // Gierrate des letzten update()-Schritts ( fuer Gespann)
    this.detached = false;      // nur beim Gespann relevant: Wohnwagen abgerissen
    this.rollGain = 0.004;      // Wank-Verstaerkung (Fahrzeug-abhaengig, s. updateRoll)
    this.rollDamping = 3.0;     // Wank-Daempfung: kleiner = weniger Nachschwingen
    this.onTip = null;          // Callback, feuert einmal pro Umkippen (z.B. Toast)

    this.sync();
  }

  async load(url, onProgress) {
    const loader = new GLTFLoader();
    // campervan-optimized.glb ist Meshopt-komprimiert (EXT_meshopt_compression)
    await MeshoptDecoder.ready;
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url, onProgress);
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    if (isTouchDevice) limitTextureSize(model, 1024); // GPU-Speicher sparen (Mobil)

    const rot = new THREE.Group();
    rot.add(model);
    rot.rotation.y = MODEL_ROT_Y;

    const inner = new THREE.Group();
    inner.add(rot);
    const box0 = new THREE.Box3().setFromObject(model);
    const size0 = box0.getSize(new THREE.Vector3());
    inner.scale.setScalar(TARGET_LENGTH / size0.x); // Modell-Laenge liegt auf X

    // Zentrieren (X/Z) und auf den Boden stellen (min.Y = 0)
    const box = new THREE.Box3().setFromObject(inner);
    const center = box.getCenter(new THREE.Vector3());
    inner.position.set(-center.x, -box.min.y, -center.z);
    this.body.add(inner);

    const size = box.getSize(new THREE.Vector3());
    // Campervan: sehr "hoher" (getunter) Schwerpunkt, kippt frueh um
    this.applySize(size, 3.5);
  }

  // Aus der Modellgeometrie abgeleitete Werte: Kollisionsradius, Breite
  // und kippkritischer Wankwinkel. cogHeight ist ein Tuning-Regler:
  // je groesser, desto frueher kippt das Fahrzeug bei kleiner Neigung um.
  applySize(size, cogHeight) {
    this.radius = Math.max(size.x, size.z) * 0.38;
    this.halfWidth = size.x * 0.5;
    const halfTrack = size.x * 0.45;
    this.criticalRoll = Math.atan2(halfTrack, cogHeight);
  }

  // Einfache Arcade-Physik: Geschwindigkeit entlang der Heading-Richtung.
  // Sobald der Van den Kreisverkehr erreicht (arc), bleibt er in der Spur:
  // LINKS/RECHTS wechselt nur die Fahrspur, gelenkt wird automatisch entlang
  // der Kreisstrasse (gegen den Uhrzeigersinn).
  update(dt, input, colliders, worldHalf, arc = null) {
    const maxSpeed = 30;
    const maxReverse = 9;
    const accel = 15;
    const brake = 28;
    const reverseAccel = 9;

    let yawRate = 0;

    if (this.tipped) {
      // Umgekippt: Motor aus, kein Bremsen - der Van rutscht nur aus
      this.speed -= this.speed * 2.5 * dt;
    } else {
      if (input.up) {
        this.speed += accel * dt;
      } else if (input.down) {
        this.speed = this.speed > 0.5
          ? this.speed - brake * dt
          : this.speed - reverseAccel * dt;
      }

      // Luft- und Rollwiderstand
      this.speed -= this.speed * 0.5 * dt;
      if (!input.up && !input.down) {
        const r = 2.5 * dt;
        this.speed = Math.abs(this.speed) <= r ? 0 : this.speed - Math.sign(this.speed) * r;
      }
    }
    this.speed = THREE.MathUtils.clamp(this.speed, -maxReverse, maxSpeed);

    let steerAngle = 0;

    // Eintritt in den Kreisverkehr erkennen
    if (!this.inRing && arc) {
      const dx = this.pos.x - arc.cx;
      const dz = this.pos.z - arc.cz;
      const r = Math.hypot(dx, dz);
      if (r > arc.rInner - 2 && r < arc.rOuter + 2) {
        this.inRing = true;
        this.ringAng = Math.atan2(dx, dz);
        this.ringR = THREE.MathUtils.clamp(r, arc.rInner, arc.rOuter);
        this.ringLane = this.nearestLane(arc, this.ringR);
      }
    }

    if (this.inRing && arc) {
      // Spurwechsel nur per Tastendruck (Kante), nie durch Dauerhalten
      if (input.left && !this._prevLeft) this.ringLane = Math.max(0, this.ringLane - 1);
      if (input.right && !this._prevRight) this.ringLane = Math.min(arc.lanes - 1, this.ringLane + 1);

      const targetR = arc.laneRadii[this.ringLane];
      this.ringR += (targetR - this.ringR) * Math.min(1, 6 * dt);
      this.ringAng += (this.speed / this.ringR) * dt;
      if (this.ringAng >= Math.PI * 2) this.ringAng -= Math.PI * 2;
      if (this.ringAng < 0) this.ringAng += Math.PI * 2;

      this.pos.x = arc.cx + Math.sin(this.ringAng) * this.ringR;
      this.pos.z = arc.cz + Math.cos(this.ringAng) * this.ringR;
      this.heading = this.ringAng + Math.PI / 2; // Tangente, gegen Uhrzeigersinn
      yawRate = this.speed / this.ringR; // Kurvenfahrt erzeugt Querkraft
      steerAngle = THREE.MathUtils.clamp((targetR - this.ringR) * 0.12, -0.5, 0.5);
    } else {
      // Lenken (vereinfachtes Bicycle-Modell); bei Rueckwaertsfahrt dreht es natuerlich umgekehrt.
      // Umgekippt wird nicht mehr gelenkt, der Van rutscht geradeaus aus.
      const steerInput = this.tipped ? 0 : ((input.left ? 1 : 0) - (input.right ? 1 : 0));
      const maxSteer = 0.62 / (1 + Math.abs(this.speed) * 0.05);
      steerAngle = steerInput * maxSteer;
      const wheelBase = 2.7;
      yawRate = (this.speed / wheelBase) * Math.tan(steerAngle);
      this.heading += yawRate * dt;

      this.pos.x += Math.sin(this.heading) * this.speed * dt;
      this.pos.z += Math.cos(this.heading) * this.speed * dt;

      // Kollision mit Hindernissen (Kreis gegen Kreis)
      for (const c of colliders) {
        const dx = this.pos.x - c.x;
        const dz = this.pos.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + this.radius;
        if (d < min) {
          const nx = d > 1e-4 ? dx / d : 1;
          const nz = d > 1e-4 ? dz / d : 0;
          this.pos.x = c.x + nx * min;
          this.pos.z = c.z + nz * min;
          this.speed *= -0.25; // leichter Bounce
        }
      }

      // Welt-Grenze
      const lim = worldHalf - 3;
      if (Math.abs(this.pos.x) > lim) { this.pos.x = Math.sign(this.pos.x) * lim; this.speed *= 0.4; }
      if (Math.abs(this.pos.z) > lim) { this.pos.z = Math.sign(this.pos.z) * lim; this.speed *= 0.4; }
    }

    this._prevLeft = !!input.left;
    this._prevRight = !!input.right;

    // Gierrate fuer abgeleitete Physik (z.B. Wohnwagen-Schlingern)
    this.yawRate = yawRate;

    // Wank-Physik: Querkraft = Geschwindigkeit * Gierrate.
    // Im Kreisverkehr zaehlt die Kurvenfahrt (v^2 / r), sonst die Lenkung.
    if (this.tipped) this.updateTip(dt);
    else this.updateRoll(dt, this.speed * yawRate);

    this.sync();
  }

  // Feder-Daempfer-Modell um die Laengsachse. Der Van ist bewusst
  // unterdaempft, damit die Karosserie beim Ein- und Auslenken noch
  // sichtbar nachschwingt. Ueberschwingt der Wankwinkel den kritischen
  // (bewusst niedrigen) Winkel, kippt der Van um.
  updateRoll(dt, lateralAccel) {
    // Zielwankwinkel proportional zur Querbeschleunigung, nach oben begrenzt:
    // jenseits der Grenze drueckt die Querkraft das Fahrzeug staendig weiter.
    // this.rollGain ist pro Fahrzeug einstellbar (z.B. weicher fuer Gespann).
    const maxTarget = this.criticalRoll * 1.15;
    const target = THREE.MathUtils.clamp(-lateralAccel * this.rollGain, -maxTarget, maxTarget);

    const stiffness = 26;          // omega ~ 5.1 rad/s -> gut sichtbares Schwanken
    const damping = this.rollDamping; // daempfungsverhaeltnis ~0.3 -> Nachschwingen
    this.rollVel += (target - this.roll) * stiffness * dt;
    this.rollVel -= this.rollVel * damping * dt;
    this.roll += this.rollVel * dt;

    if (Math.abs(this.roll) >= this.criticalRoll) {
      this.tipped = true;
      this.tipDir = Math.sign(this.roll) || 1;
      this.tipTimer = 0;
      if (this.onTip) this.onTip();
    }
  }

  // Umgekippt: Das Fahrzeug faellt weiter, bis es (fast) flach auf der
  // Seite liegt, und bleibt liegen - das beendet die Quest (siehe main.js).
  updateTip(dt) {
    const restRoll = this.tipDir * 1.45; // ~83 Grad: fast flach auf der Seite
    this.rollVel += this.tipDir * 7 * dt; // Gravitation zieht weiter in Kipprichtung
    this.roll += this.rollVel * dt;
    if (this.tipDir * this.roll >= this.tipDir * restRoll) {
      this.roll = restRoll;
      if (Math.abs(this.rollVel) > 0.6) this.rollVel *= -0.25; // Abprall beim Aufschlagen
      else this.rollVel = 0;
    }
    this.tipTimer += dt;
  }

  nearestLane(arc, r) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < arc.laneRadii.length; i++) {
      const d = Math.abs(arc.laneRadii[i] - r);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
    // Wankwinkel um die Laengsachse; beim Kippen wird der Van angehoben,
    // damit die Seite nicht im Boden versinkt (Drehachse liegt am Boden).
    this.body.rotation.z = this.roll;
    this.body.position.y = this.halfWidth * Math.abs(Math.sin(this.roll));
  }

  reset() {
    this.pos.set(this.spawn.x, 0, this.spawn.z);
    this.heading = this.spawn.heading;
    this.speed = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.y = 0;
    this.roll = 0;
    this.rollVel = 0;
    this.tipped = false;
    this.tipDir = 0;
    this.tipTimer = 0;
    this.yawRate = 0;
    this.inRing = false;
    this.ringAng = 0;
    this.ringR = 0;
    this.ringLane = 0;
    this._prevLeft = false;
    this._prevRight = false;
    this.sync();
  }
}
