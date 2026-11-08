import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARC } from './arc.js';
import { AVENUE } from './world.js';

// Gebaeude als durchgehende Bebauung entlang der Strassen — ausschliesslich
// building2/3/4.glb. Fenster kommen nur aus der baked Textur der GLB-Dateien
// (keine nachtraeglich hinzugefuegten Fenster).
// Start-Strasse (Nord-Sued, "Champs-Elysees"): Reihe hinter den Birken.
// Kreisstrasse: Gebaeude direkt am Strassenrand (aussen).
const BUILDING_URLS = ['building2.glb', 'building3.glb', 'building4.glb'];
const BUILDING_HEIGHT = 10; // Zielhoehe in Welt-Einheiten

// Modell normalisieren: laengste horizontale Achse (Fassade) auf lokale X,
// Hoehe auf BUILDING_HEIGHT skalieren, zentrieren, auf den Boden stellen.
// Rueckgabe: outer Group (rotation.y = Blickrichtung, Front = +Z), wie bei den Autos.
// userData enthaelt w/d/h (Fassade/Tiefe/Hoehe).
function normalizeBuilding(model) {
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(model);
  outer.add(inner);

  const box0 = new THREE.Box3().setFromObject(outer);
  const size0 = box0.getSize(new THREE.Vector3());
  if (size0.z > size0.x) inner.rotation.y = Math.PI / 2; // Fassade auf X drehen
  outer.updateMatrixWorld(true);

  const box1 = new THREE.Box3().setFromObject(outer);
  const size1 = box1.getSize(new THREE.Vector3());
  inner.scale.setScalar(BUILDING_HEIGHT / size1.y);
  outer.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(outer);
  const c = box2.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box2.min.y, -c.z);
  outer.updateMatrixWorld(true);

  const size2 = box2.getSize(new THREE.Vector3());
  outer.userData.w = size2.x; // Fassadenbreite
  outer.userData.d = size2.z; // Tiefe
  outer.userData.h = size2.y; // Hoehe

  return outer;
}

// Platziert GLB-Gebaeude und gibt die Anzahl zurueck. Collider landen in world.colliders.
export async function placeBuildings(scene, world, arc = ARC, onProgress = null) {
  const loader = new GLTFLoader();
  const templates = [];
  for (let i = 0; i < BUILDING_URLS.length; i++) {
    const gltf = await loader.loadAsync(BUILDING_URLS[i]);
    gltf.scene.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    templates.push(normalizeBuilding(gltf.scene));
    if (onProgress) onProgress(i + 1, BUILDING_URLS.length);
  }

  let n = 0;
  const place = (x, z, rotY, tplIdx) => {
    const b = templates[tplIdx % templates.length].clone(true);
    b.position.set(x, 0, z);
    b.rotation.y = rotY;
    scene.add(b);
    world.colliders.push({ x, z, r: 4.2 });
    n++;
  };

  // --- Champs-Elysees (Start-Strasse, Nord-Sued): eine Reihe Gebaeude hinter den
  // Birken-Allee (x = +-buildingX), direkt nebeneinander (beruehren sich). ---
  for (const x of [-AVENUE.buildingX, AVENUE.buildingX]) {
    const rotY = x > 0 ? -Math.PI / 2 : Math.PI / 2; // Fassade zur Strasse
    let z = -world.half + 12;
    let idx = 0;
    while (z <= world.half - 12) {
      const free = Math.hypot(x, z + 100) >= 15            // Spawn-Bereich
        && Math.abs(z) >= 9                                // Strassenkreuzung
        && Math.hypot(x - arc.cx, z - arc.cz) >= arc.rOuter + 10; // Kreisverkehr
      if (!free) { z += 2; continue; }
      const w = templates[idx % templates.length].userData.w;
      place(x, z, rotY, idx);
      const wNext = templates[(idx + 1) % templates.length].userData.w;
      z += (w + wNext) / 2; // Kante an Kante: Gebaeude beruehren sich
      idx++;
    }
  }

  // --- Kreisstrasse: Gebaeude direkt am Strassenrand (aussen). Zwischen den
  // Ausfahrten (radiale Alleen) werden die Luecken gefuellt. An den beiden
  // Stellen, wo die Champs-Elysees (Nord-Sued, Winkel 0 und Pi) auf den Kreis
  // trifft, bleibt ein grosses Stueck frei (kein Gebaeude). ---
  const rB = arc.rOuter + 3.5;
  const exits = [
    ...arc.radialAngles.map((a) => ({ a, m: 0.16 })),
    { a: 0, m: 0.35 },       // Champs-Elysees Sued
    { a: Math.PI, m: 0.35 }, // Champs-Elysees Nord
  ].sort((p, q) => p.a - q.a);
  const gap = 8.5; // gewuenschter Abstand der Gebaeude (m)
  for (let i = 0; i < exits.length; i++) {
    const e0 = exits[i];
    const e1 = exits[(i + 1) % exits.length];
    const a1 = e1.a + (i === exits.length - 1 ? 2 * Math.PI : 0);
    const segLen = a1 - e0.a - e0.m - e1.m; // verfuegbarer Bogen (rad)
    const count = Math.max(0, Math.floor((segLen * rB) / gap));
    for (let k = 0; k < count; k++) {
      const a = e0.a + e0.m + ((k + 0.5) / count) * segLen;
      const x = arc.cx + Math.sin(a) * rB;
      const z = arc.cz + Math.cos(a) * rB;
      place(x, z, a + Math.PI, n); // Fassade zeigt zum Kreismittelpunkt
    }
  }

  return n;
}
