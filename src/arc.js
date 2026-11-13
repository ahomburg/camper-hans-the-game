import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Lage und Masse des Kreisverkehrs (Place Charles de Gaulle / Arc de Triomphe).
// wird auch von world.js (Sperrbereiche) und traffic.js/quests.js (Spuren, Runden) benutzt.
export const ARC = {
  cx: 0,
  cz: 110,
  rInner: 28.8,  // innerer Rand der Kreisstrasse (20% kleiner als 36)
  rOuter: 40.416, // aeusserer Rand: Spuren sind 10% breiter (2.3232 statt 2.112); Auto-/Van-Groessen unveraendert
  lanes: 5,
  radialWidth: 7,
  radialLen: 26,
  // 12 Alleen wie am echten Platz; die Nord-Sued-Achse (Winkel 0 und Pi) ist
  // bereits die vorhandene kreuzende Strasse und wird ausgespart.
  radialAngles: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11].map((k) => (k * Math.PI) / 6),
};

export function laneRadii(arc = ARC) {
  const laneW = (arc.rOuter - arc.rInner) / arc.lanes;
  return Array.from({ length: arc.lanes }, (_, i) => arc.rInner + laneW * (i + 0.5));
}

export function buildArc(scene) {
  const { cx, cz, rInner, rOuter } = ARC;
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  // --- Kreisstrasse ---
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.9 });
  const road = new THREE.Mesh(new THREE.RingGeometry(rInner, rOuter, 96), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(cx, 0.03, cz);
  road.receiveShadow = true;
  group.add(road);

  // --- Bordstein innen (aeusserer grauer Ring entfernt) ---
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.8 });
  for (const r of [rInner - 0.6]) {
    const curb = new THREE.Mesh(new THREE.TorusGeometry(r, 0.28, 8, 96), curbMat);
    curb.rotation.x = Math.PI / 2;
    curb.position.set(cx, 0.18, cz);
    curb.castShadow = curb.receiveShadow = true;
    group.add(curb);
  }

  // --- Mittelinsel (befahrbarer Sperrbereich) ---
  const islandR = rInner - 1.6;
  const island = new THREE.Mesh(
    new THREE.CylinderGeometry(islandR, islandR + 0.4, 0.55, 64),
    new THREE.MeshStandardMaterial({ color: 0x4d7c3f, roughness: 1 })
  );
  island.position.set(cx, 0.275, cz);
  island.receiveShadow = true;
  group.add(island);
  colliders.push({ x: cx, z: cz, r: islandR + 0.4 });

  // --- Arc de Triomphe ---
  // Das alte Kistenmodell wurde durch das GLB-Modell arch_meshopt.glb ersetzt,
  // das nachtraeglich per loadArcMonument() geladen wird (async).

  // --- 6 Zufallsbaeume mit runder Krone auf der Insel ---
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x4d8a3f, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = 6 + Math.random() * (islandR - 9); // nicht direkt am Rand/am Arc
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.8, 8), trunkMat);
    trunk.position.y = 0.8;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), crownMat);
    crown.scale.y = 1.1;
    crown.position.y = 3.1;
    trunk.castShadow = crown.castShadow = true;
    tree.add(trunk, crown);
    tree.position.set(cx + Math.sin(a) * rr, 0.55, cz + Math.cos(a) * rr);
    group.add(tree);
  }

  // --- Radiale Alleen (Stern wie am Place Charles de Gaulle) ---
  for (const a of ARC.radialAngles) {
    const geo = new THREE.PlaneGeometry(ARC.radialWidth, ARC.radialLen);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, roadMat);
    m.rotation.y = a;
    const rMid = rOuter + ARC.radialLen / 2 - 2; // leicht in den Ring hinein
    m.position.set(cx + Math.sin(a) * rMid, 0.025, cz + Math.cos(a) * rMid);
    m.receiveShadow = true;
    group.add(m);
  }

  return { ...ARC, laneRadii: laneRadii(), colliders, group };
}

// Laedt arch_meshopt.glb als Arc de Triomphe auf die Mittelinsel.
// Das Modell ist ~1 Einheit gross und zentriert; es wird auf ~26 Einheiten
// Hoehe skaliert (wie das alte Kistenmodell), auf die Insel gesetzt und so
// gedreht, dass die Durchfahrt entlang der Nord-Sued-Strasse (Z) zeigt.
export async function loadArcMonument(scene, cx = ARC.cx, cz = ARC.cz) {
  const loader = new GLTFLoader();
  // arch_meshopt.glb ist Meshopt-komprimiert (EXT_meshopt_compression)
  await MeshoptDecoder.ready;
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync('arch_meshopt.glb');
  const model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  const wrapper = new THREE.Group();
  wrapper.add(model);
  wrapper.rotation.y = Math.PI / 2; // breite Seite auf X -> Oeffnung entlang Z
  wrapper.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(wrapper);
  const size = box.getSize(new THREE.Vector3());
  wrapper.scale.setScalar(26 / size.y);
  wrapper.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(wrapper);
  const c = box2.getCenter(new THREE.Vector3());
  wrapper.position.set(cx - c.x, 0.55 - box2.min.y, cz - c.z);
  scene.add(wrapper);
  return wrapper;
}
