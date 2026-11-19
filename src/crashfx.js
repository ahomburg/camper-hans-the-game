import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Crash-Visualisierung: Funken- und Truemmerteilchen am Aufprallpunkt.
// Ein einziges THREE.Points mit fixem Partikelpool (Ring-Puffer): Crashs
// belegen einfach die naechsten freien (oder aeltesten) Partikel - kein
// Allokieren zur Laufzeit, kein Kontext-Verlust auf Mobilgeraeten.
// Kollisionen sind im Spiel auf Bodenniveau, die Teilchen starten am
// Kontaktpunkt in Brusthohe, fliegen entlang der Stossnormalen mit Streuung,
// fallen und hupfen einmal auf dem Asphalt auf.
// ---------------------------------------------------------------------------

const MAX_PARTICLES = 240;
const GRAVITY = -14;

// Funken in Campfire-Gold/Orange, Truemmerteilchen in Nachtgrau.
const SPARK_COLORS = [
  new THREE.Color(0xffcb3c), // ch-sun
  new THREE.Color(0xe8623c), // ch-campfire
  new THREE.Color(0xfdf6e3), // weisser Blitz-Anteil
];
const DEBRIS_COLOR = new THREE.Color(0x4e5d66); // ch-night-soft

export class CrashFX {
  constructor(scene) {
    this.max = MAX_PARTICLES;
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES); // 0 = Partikel frei
    this.next = 0;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pos[i * 3 + 1] = -1000; // unbenutzte Partikel unter dem Boden parken
    }

    const colors = new Float32Array(MAX_PARTICLES * 3);
    this.colors = colors;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false; // Partikel bewegen sich schnell, kein Frustum-Culling
    scene.add(this.points);
  }

  // severity: 0..1 (Annaeherungsgeschwindigkeit normiert), nx/nz = Stossnormale
  // (zeigt vom getroffenen Objekt zum Spieler), x/z = Kontaktpunkt in der Welt.
  spawn(x, z, nx = 0, nz = 1, severity = 0.5) {
    const count = Math.round(10 + severity * 34); // 10..44 Teilchen
    const baseAng = Math.atan2(nx, nz); // Hauptrichtung = Normalen-Apex
    for (let i = 0; i < count; i++) {
      const idx = this.next;
      this.next = (this.next + 1) % this.max;

      // Start am Kontaktpunkt, leicht gestreut
      this.pos[idx * 3] = x + (Math.random() - 0.5) * 0.7;
      this.pos[idx * 3 + 1] = 0.55 + Math.random() * 0.9;
      this.pos[idx * 3 + 2] = z + (Math.random() - 0.5) * 0.7;

      // Geschwindigkeit: entlang der Normalen (+/-120 Grad Streuung)
      const a = baseAng + (Math.random() - 0.5) * 4.2;
      const sp = 3 + severity * 9 + Math.random() * 4.5;
      this.vel[idx * 3] = Math.sin(a) * sp;
      this.vel[idx * 3 + 1] = 2.5 + Math.random() * 4.5;
      this.vel[idx * 3 + 2] = Math.cos(a) * sp;
      this.life[idx] = 0.55 + Math.random() * 0.45;

      // Farbe: 2/3 Funken, 1/3 Truemmerteilchen
      const c = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
      this.colors[idx * 3] = c.r;
      this.colors[idx * 3 + 1] = c.g;
      this.colors[idx * 3 + 2] = c.b;
    }
    // Der Regenbogen der Farben jedes Mal hochzuladen ist spottbillig
    // (240*3 Floats), aber in einem Frame mit Crash gut verdaulich:
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -1000;
        continue;
      }
      this.vel[i * 3 + 1] += GRAVITY * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // Einmal auf dem Asphalt aufhupfen, dann ausrollen
      if (this.pos[i * 3 + 1] < 0.06) {
        this.pos[i * 3 + 1] = 0.06;
        this.vel[i * 3 + 1] *= -0.35;
        this.vel[i * 3] *= 0.6;
        this.vel[i * 3 + 2] *= 0.6;
      }
    }
    if (any) this.points.geometry.attributes.position.needsUpdate = true;
  }
}
