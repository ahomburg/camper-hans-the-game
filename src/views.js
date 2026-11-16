// Kamera-Ansichten, per Taste C durchzuschalten (main.js zaehlt viewMode hoch):
//   0 = Standard-Verfolgung  (in main.js, bleibt unberuehrt)
//   1 = First Person         (Fahrersitz, starr am Fahrzeug)
//   2 = schraeg von hinten links (45 Grad, leicht erhoeht)
// Ansicht 1 darf nicht weich folgen (sonst schwimmt das Cockpit beim Lenken),
// Ansicht 2 folgt weich mit dem smooth-Faktor aus main.js.
import * as THREE from 'three';

const CAM_RADIUS = 9;   // wie die Standard-Verfolgung
const CAM_HEIGHT = 3.2;  // "leicht erhoeht"

const followPos = new THREE.Vector3();

export function applyView(camera, car, mode, smooth) {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);

  if (mode === 1) {
    // First Person: auf dem Fahrersitz (links Innen, leicht hinter der Mitte),
    // Augenhohe knapp ueber dem Cockpit, Blick nach vorn.
    // Links von der Fahrtrichtung = heading + 90 Grad -> (cos h, -sin h).
    const lx = Math.cos(car.heading);
    const lz = -Math.sin(car.heading);
    camera.position.set(
      car.pos.x - fx * 0.2 + lx * 0.35, 1.45,
      car.pos.z - fz * 0.2 + lz * 0.35
    );
    camera.lookAt(car.pos.x + fx * 10, 1.25, car.pos.z + fz * 10);
    return;
  }

  if (mode === 2) {
    // Schraeg von hinten links: 45 Grad zwischen "direkt dahinter"
    // (heading + 180 Grad) und "links daneben" (heading + 90 Grad),
    // Blick von leicht oben auf das Fahrzeug.
    const a = car.heading + Math.PI * 0.75;
    followPos.set(
      car.pos.x + Math.sin(a) * CAM_RADIUS, CAM_HEIGHT,
      car.pos.z + Math.cos(a) * CAM_RADIUS
    );
    camera.position.lerp(followPos, smooth);
    camera.lookAt(car.pos.x, 1.0, car.pos.z);
    return;
  }
}
