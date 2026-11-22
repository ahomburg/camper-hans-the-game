import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { isTouchDevice, limitTextureSize } from './device.js';

// Das GLB-Modell liegt mit seiner Laengsachse auf der X-Achse und ist in Y zentriert.
// MODEL_ROT_Y dreht das Modell so, dass seine Front auf +Z (Fahrtrichtung) zeigt.
// Falls der Van im Spiel rueckwaerts faehrt: Vorzeichen wechseln (+Math.PI / 2).
const MODEL_ROT_Y = -Math.PI / 2;
const TARGET_LENGTH = 4.4; // Laenge des vans in Welt-Einheiten

// Fahrdynamik-Defaults (Stadt/Kapitel 1: 30 m/s = 108 km/h). Eine Kapitel-Map
// kann ueber ihr `tuning`-Feld davon abweichen (Kapitel 2 braucht mehr, damit
// 120 km/h ueberhaupt erreichbar sind - siehe hills.js / main.js startChapter).
export const CAR_TUNING = {
  maxSpeed: 30,      // m/s, harte Klemme
  maxReverse: 9,     // m/s
  accel: 15,         // m/s^2, Endgeschwindigkeit ~ accel/drag
  brake: 28,         // m/s^2
  reverseAccel: 9,   // m/s^2
  drag: 0.5,         // linearer Luft-/Rollwiderstand (1/s)
};

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
    Object.assign(this, CAR_TUNING); // Fahrdynamik (pro Kapitel-Map umstellbar)

    // Spurhaltung im Kreisverkehr: sobald der Van den Ring erreicht hat,
    // faehrt er in einer Spur weiter; LINKS/RECHTS wechselt nur die Spur.
    this.inRing = false;
    this.ringAng = 0;   // Winkel um den Arc-Mittelpunkt
    this.ringR = 0;     // aktueller Abstand zum Mittelpunkt
    this.ringLane = 0;  // Index der Zielfahrspur
    this.ringLaneFrom = null; // Spur vor dem Spurwechsel (fuer abortLaneChange)
    this.arc = null;    // zuletzt uebergebener Kreisverkehr (fuer pushOut)
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
    this.onObstacleCrash = null; // Callback: Spieler rammt Baum/Gebaeude/Bordstein
                                  // ({ kind, closing, nx, nz, x, z }) -> Muenz-System
    this.obstacleCool = 0;      // Abklang-Sperre fuer Hindernis-Crashs (Sekunden)
    this.seatY = 1.45;          // FPV-Augenhoehe (First Person), bis zum Laden;
                                 // Peugeot behaelt diesen Wert, Campervan: s. load()
    this.seatFwd = -0.2;         // FPV-Sitz vor/zurueck (negativ = hinter der Mitte)
    this.modelSize = null;       // Bounding-Box des geladenen Modells (Debug/FPV)

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

    // FPV-Sitzposition (First Person, s. views.js), kalibriert per
    // ?debugcam: Augenhoehe 1.92, Sitz 0.45 VOR der Modell-Mitte (das
    // Cockpit sitzt beim Cab-over-Van weit vorn). Der Peugeot im Gespann
    // nutzt die Konstruktor-Defaults (1.45 / -0.2) weiter.
    this.seatY = 1.92;
    this.seatFwd = 0.45;
  }

  // Aus der Modellgeometrie abgeleitete Werte: Kollisionsradius, Breite
  // und kippkritischer Wankwinkel. cogHeight ist ein Tuning-Regler:
  // je groesser, desto frueher kippt das Fahrzeug bei kleiner Neigung um.
  applySize(size, cogHeight) {
    this.radius = Math.max(size.x, size.z) * 0.38;
    this.halfWidth = size.x * 0.5;
    const halfTrack = size.x * 0.45;
    this.criticalRoll = Math.atan2(halfTrack, cogHeight);
    // Fuer Debug/FPV: Modell-Bounding-Box bereitstellen (?debugcam HUD).
    this.modelSize = { x: size.x, y: size.y, z: size.z };
  }

  // Einfache Arcade-Physik: Geschwindigkeit entlang der Heading-Richtung.
  // Sobald der Van den Kreisverkehr erreicht (arc), bleibt er in der Spur:
  // LINKS/RECHTS wechselt nur die Fahrspur, gelenkt wird automatisch entlang
  // der Kreisstrasse (gegen den Uhrzeigersinn).
  update(dt, input, colliders, worldHalf, arc = null) {
    const { maxSpeed, maxReverse, accel, brake, reverseAccel, drag } = this;

    if (arc) this.arc = arc; // Kreisverkehr merken (pushOut braucht cx/cz)
    if (this.obstacleCool > 0) this.obstacleCool -= dt; // Crash-Abklang (s.u.)

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
      this.speed -= this.speed * drag * dt;
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
      // Spurwechsel nur per Tastendruck (Kante), nie durch Dauerhalten.
      // ringLaneFrom merkt sich die Herkunftsspur: Stoesst der Van beim
      // Wechsel gegen ein Auto in der Zielspur, bricht der Wechsel ab und
      // der Van prallt in die Herkunftsspur zurueck (siehe abortLaneChange).
      if (input.left && !this._prevLeft && this.ringLane > 0) {
        this.ringLaneFrom = this.ringLane;
        this.ringLane--;
      }
      if (input.right && !this._prevRight && this.ringLane < arc.lanes - 1) {
        this.ringLaneFrom = this.ringLane;
        this.ringLane++;
      }

      const targetR = arc.laneRadii[this.ringLane];
      this.ringR += (targetR - this.ringR) * Math.min(1, 6 * dt);
      // Spurwechsel abgeschlossen: Herkunftsspur vergessen, spaetere
      // Kollisionen (z.B. von hinten) brechen dann nichts mehr ab.
      if (this.ringLaneFrom !== null && Math.abs(targetR - this.ringR) < 0.15) {
        this.ringLaneFrom = null;
      }
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
        // Leitplanken/Waende: Kapsel-Collider (x1,z1 -> x2,z2 + Radius) statt
        // Kreis. Hans gleitet an der Schiene entlang statt steckenzubleiben:
        // Nur die Komponente IN die Wand prallt ab (-75%), die Tangential-
        // Fahrt bleibt erhalten - genau wie eine echte Leitplanke.
        if (c.x1 !== undefined) {
          const ex = c.x2 - c.x1, ez = c.z2 - c.z1;
          const l2 = ex * ex + ez * ez || 1e-9;
          const t = THREE.MathUtils.clamp(
            ((this.pos.x - c.x1) * ex + (this.pos.z - c.z1) * ez) / l2, 0, 1
          );
          const px = c.x1 + ex * t, pz = c.z1 + ez * t;
          const dx = this.pos.x - px, dz = this.pos.z - pz;
          const d = Math.hypot(dx, dz);
          const min = c.r + this.radius;
          if (d < min) {
            const nx = d > 1e-4 ? dx / d : 0;
            const nz = d > 1e-4 ? dz / d : 1;
            this.pos.x = px + nx * min;
            this.pos.z = pz + nz * min;
            const vx = Math.sin(this.heading) * this.speed;
            const vz = Math.cos(this.heading) * this.speed;
            const vn = vx * nx + vz * nz; // < 0 = fährt in die Wand
            if (vn < 0) {
              const closing = -vn;
              const nvx = vx - 1.25 * vn * nx; // Reflexion mit 25% Restitution
              const nvz = vz - 1.25 * vn * nz;
              this.heading = Math.atan2(nvx, nvz);
              this.speed = Math.hypot(nvx, nvz);
              if (this.onObstacleCrash && closing > 1.2 && this.obstacleCool <= 0) {
                this.obstacleCool = 1.0; // Entlang-Rutschen nicht mehrfach abrechnen
                this.onObstacleCrash({
                  kind: 'obstacle', closing, nx, nz, x: px, z: pz,
                });
              }
            }
          }
          continue;
        }
        const dx = this.pos.x - c.x;
        const dz = this.pos.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + this.radius;
        if (d < min) {
          const nx = d > 1e-4 ? dx / d : 1;
          const nz = d > 1e-4 ? dz / d : 0;
          this.pos.x = c.x + nx * min;
          this.pos.z = c.z + nz * min;
          // Muenz-System: Crash gegen ein statisches Hindernis (Baum,
          // Gebaeude, Bordstein des Arc ...) - Harte = Tempo vor dem Bounce.
          const closing = Math.abs(this.speed);
          this.speed *= -0.25; // leichter Bounce
          if (this.onObstacleCrash && closing > 1.2 && this.obstacleCool <= 0) {
            this.obstacleCool = 1.0; // Entlang-Rutschen nicht mehrfach abrechnen
            this.onObstacleCrash({
              kind: 'obstacle', closing, nx, nz,
              x: c.x + nx * c.r, z: c.z + nz * c.r,
            });
          }
        }
      }

      // Welt-Grenze (Begrenzungsmauer): leichter Crash, Tempo vor dem Abbremsen
      const lim = worldHalf - 3;
      if (Math.abs(this.pos.x) > lim) {
        const closing = Math.abs(this.speed);
        const sx = Math.sign(this.pos.x);
        this.pos.x = sx * lim; this.speed *= 0.4;
        if (this.onObstacleCrash && closing > 2 && this.obstacleCool <= 0) {
          this.obstacleCool = 1.0;
          this.onObstacleCrash({ kind: 'border', closing: closing * 0.7, nx: -sx, nz: 0, x: this.pos.x, z: this.pos.z });
        }
      }
      if (Math.abs(this.pos.z) > lim) {
        const closing = Math.abs(this.speed);
        const sz = Math.sign(this.pos.z);
        this.pos.z = sz * lim; this.speed *= 0.4;
        if (this.onObstacleCrash && closing > 2 && this.obstacleCool <= 0) {
          this.obstacleCool = 1.0;
          this.onObstacleCrash({ kind: 'border', closing: closing * 0.7, nx: 0, nz: -sz, x: this.pos.x, z: this.pos.z });
        }
      }
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

  // Externe Positionskorrektur (Kollisions-Trennung, siehe traffic.js).
  // Der Van wird um (dx, dz) verschoben - bei aktiver Spurfuehrung im
  // Kreisverkehr wird die Korrektur ZUSAETZLICH in den Ring-Zustand
  // (ringAng/ringR) uebernommen. Ohne das wuerde die Spurfuehrung die
  // Korrektur im naechsten Frame wieder ueberschreiben: der Van ruckelt
  // dann sichtbar zwischen Spur- und Kollisionsposition hin und her.
  pushOut(dx, dz) {
    this.pos.x += dx;
    this.pos.z += dz;
    if (this.inRing && this.arc) {
      const px = this.pos.x - this.arc.cx;
      const pz = this.pos.z - this.arc.cz;
      this.ringAng = Math.atan2(px, pz);
      this.ringR = Math.hypot(px, pz);
    }
  }

  // Bricht einen laufenden Spurwechsel ab: der Van kehrt in die Spur
  // zurueck, aus der er kam, (Aufrufer: traffic.js bei seitlicher
  // Kollision, typisch Spurwechsel in ein besetztes Auto). Ohne
  // laufenden Spurwechsel ist der Aufruf wirkungslos.
  abortLaneChange() {
    if (this.ringLaneFrom === null) return;
    this.ringLane = this.ringLaneFrom;
    this.ringLaneFrom = null;
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
  // Seite liegt, und bleibt liegen - das beendet das Kapitel (siehe main.js).
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
    this.ringLaneFrom = null;
    this._prevLeft = false;
    this._prevRight = false;
    this.obstacleCool = 0;
    this.sync();
  }
}
