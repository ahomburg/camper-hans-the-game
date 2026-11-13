import * as THREE from 'three';
import { ARC } from './arc.js';

// Lage der Allee/Bebauung an der Start-Strasse (Nord-Sued): Birken 2.5 m hinter
// dem Strassenrand (Strassenhaelfte 10.5 -> treeX 13), Gebaeude weiter dahinter
// (buildingX 24) — dazwischen bleibt Platz/Gruenflaeche zwischen Baeumen und Haeusern
export const AVENUE = { treeX: 13, treeGap: 8, buildingX: 24 };

// Deterministischer Zufall, damit die Testwelt bei jedem Start gleich aussieht.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildWorld(scene) {
  const half = 180; // halbe Kantenlaenge der befahrbaren Welt
  const colliders = [];
  const rand = mulberry32(1337);

  // --- Boden (Asphalt mit Kaestchen-Muster) ---
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = 256;
  const g = cnv.getContext('2d');
  g.fillStyle = '#3a3f45';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  g.fillStyle = 'rgba(0,0,0,0.10)';
  for (let i = 0; i < 40; i++) g.fillRect(rand() * 256, rand() * 256, 3, 3);
  const groundTex = new THREE.CanvasTexture(cnv);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(half / 4, half / 4);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2 + 80, half * 2 + 80),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Strassenkreuz in der Mitte ---
  // Die Start-Strasse (Nord-Sued, "Champs-Elysees", darauf spawnt der Van) ist
  // 50% breiter als zuvor (21 statt 14) und breiter als die Ost-West-Strasse.
  const ROAD_NS_W = 21;
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.9 });
  const roadNS = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_NS_W, half * 2), roadMat);
  roadNS.rotation.x = -Math.PI / 2;
  roadNS.position.y = 0.02;
  roadNS.receiveShadow = true;
  const roadEW = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 9), roadMat);
  roadEW.rotation.x = -Math.PI / 2;
  roadEW.position.y = 0.02;
  roadEW.receiveShadow = true;
  scene.add(roadNS, roadEW);

  // Spawn-Flaeche, Strassen und der Kreisverkehr (Arc de Triomphe) bleiben frei.
  const arcBlocked = (x, z) => {
    const dx = x - ARC.cx;
    const dz = z - ARC.cz;
    if (Math.hypot(dx, dz) < ARC.rOuter + 8) return true;
    for (const a of ARC.radialAngles) {
      const sx = Math.sin(a), sz = Math.cos(a);
      const t = dx * sx + dz * sz; // Projektion auf die Allee-Richtung
      if (t > ARC.rOuter - 4 && t < ARC.rOuter + ARC.radialLen) {
        const px = dx - t * sx, pz = dz - t * sz;
        if (px * px + pz * pz < 5.5 * 5.5) return true;
      }
    }
    return false;
  };
  const blocked = (x, z) =>
    arcBlocked(x, z) || Math.hypot(x, z + 100) < 12 || Math.abs(x) < ROAD_NS_W / 2 + 1.5 || Math.abs(z) < 7
    || Math.abs(Math.abs(x) - AVENUE.buildingX) < 5; // Gebaeudezeile der Allee bleibt frei
  // --- Baeume: nur Birken (Laubbaum mit runder Krone, heller Stamm) ---
  // ~(90 Baeume) sind identisch: statt 180 einzelner Meshes/Geometrien
  // (je Stamm + Krone) zwei InstancedMeshes = 2 Draw Calls statt ~180 —
  // auf aelteren Tablets ein deutlicher Unterschied.
  const birchPts = [];
  const birchTrunkMat = new THREE.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.85 });
  const birchCrownMat = new THREE.MeshStandardMaterial({ color: 0xa9c86b, roughness: 1 });

  // --- Champs-Elysees (Start-Strasse, Nord-Sued): Allee mit Birken in regelmaessigen Abstaenden ---
  for (let z = -half + 10; z <= half - 10; z += AVENUE.treeGap) {
    for (const x of [-AVENUE.treeX, AVENUE.treeX]) {
      if (!blocked(x, z)) birchPts.push([x, z]);
    }
  }

  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.24, 2.4, 8);
  const crownGeo = new THREE.SphereGeometry(1.5, 9, 7);
  const trunks = new THREE.InstancedMesh(trunkGeo, birchTrunkMat, birchPts.length);
  const crowns = new THREE.InstancedMesh(crownGeo, birchCrownMat, birchPts.length);
  trunks.castShadow = crowns.castShadow = true;
  const m = new THREE.Matrix4();
  birchPts.forEach(([x, z], i) => {
    m.identity().setPosition(x, 1.2, z); // wie vorher: trunk.position.y = 1.2
    trunks.setMatrixAt(i, m);
    m.makeScale(1, 1.15, 1).setPosition(x, 3.6, z); // crown.scale.y/position wie vorher
    crowns.setMatrixAt(i, m);
    colliders.push({ x, z, r: 0.7 });
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  scene.add(trunks, crowns);

  // --- Begrenzungsmauern ---
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.9 });
  const mkWall = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.5, d), wallMat);
    m.position.set(x, 1.25, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  };
  mkWall(half * 2 + 80, 1.5, 0, -half);
  mkWall(half * 2 + 80, 1.5, 0, half);
  mkWall(1.5, half * 2 + 80, -half, 0);
  mkWall(1.5, half * 2 + 80, half, 0);

  return { colliders, half };
}
