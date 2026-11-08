import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
    this.sync();
  }

  async load(url, onProgress) {
    const gltf = await new GLTFLoader().loadAsync(url, onProgress);
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });

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
    this.radius = Math.max(size.x, size.z) * 0.38;
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
      steerAngle = THREE.MathUtils.clamp((targetR - this.ringR) * 0.12, -0.5, 0.5);
    } else {
      // Lenken (vereinfachtes Bicycle-Modell); bei Rueckwaertsfahrt dreht es natuerlich umgekehrt
      const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
      const maxSteer = 0.62 / (1 + Math.abs(this.speed) * 0.05);
      steerAngle = steerInput * maxSteer;
      const wheelBase = 2.7;
      this.heading += (this.speed / wheelBase) * Math.tan(steerAngle) * dt;

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

    this.sync(steerAngle);
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

  sync(steerAngle = 0) {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
    // leichte Karosserie-Neigung beim Lenken
    const targetRoll = -steerAngle * Math.min(Math.abs(this.speed) / 10, 1) * 0.08;
    this.body.rotation.z += (targetRoll - this.body.rotation.z) * 0.2;
  }

  reset() {
    this.pos.set(this.spawn.x, 0, this.spawn.z);
    this.heading = this.spawn.heading;
    this.speed = 0;
    this.body.rotation.set(0, 0, 0);
    this.inRing = false;
    this.ringAng = 0;
    this.ringR = 0;
    this.ringLane = 0;
    this._prevLeft = false;
    this._prevRight = false;
    this.sync();
  }
}
