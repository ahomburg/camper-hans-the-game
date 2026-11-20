import * as THREE from 'three';

// Kapitel 2 "Temposuender": eigene Map NUR fuer dieses Kapitel - Huegelland
// mit einer schlaengelnden Landstrasse. Keine Haeuser, nur einige Baeume und
// viel Gruen, ab und zu ein Zelt. Die Map wird erst gebaut, wenn das Kapitel
// ausgewaehlt wird (Lazy Load, siehe ensureMap in main.js).
//
// Die Physik des Vans ist 2D (y = 0), deshalb liegt die Strasse selbst flach
// auf y ~ 0; die sanften Huegel hebt das Gelaende nur IM GRUEN an (die Hoehe
// wird nahe der Strasse und nahe der Welt-Grenze abgeflacht). Auto und Strasse
// liegen dadurch sauber auf dem Boden.

// Deterministischer Zufall (wie in world.js): Huegel, Baeume und Zelte sehen
// bei jedem Start gleich aus.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function buildHillsMap(parent) {
  const group = new THREE.Group();
  parent.add(group);

  const colliders = [];
  const half = 240;          // halbe Kantenlaenge der Welt
  const roadHalf = 5.5;      // halbe Strassenbreite
  const rand = mulberry32(90210);

  // --- Schlängelnde Strasse als Spline (Nord-Sued mit engen S-Kurven,
  // min. Kurvenradius ~20 m: bei 120 km/h muss Hans in den engen Kurven
  // deutlich vom Gas, sonst kippt er oder schiesst ueber die Schulter hinaus ---
  const ctrl = [
    [0, -half + 16],
    [0, -half + 62],
    [30, -138],
    [46, -84],
    [6, -34],
    [-28, 16],
    [-50, 72],
    [-22, 132],
    [14, 186],
    [0, half - 16],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5);
  const SAMPLES = 720;
  const pts = curve.getSpacedPoints(SAMPLES); // SAMPLES+1 Punkte, ~0.7 m Abstand

  // Abstand eines Punkts zur Strassen-Mittellinie (Punkt gegen alle Segmente
  // der Polylinie). step > 1 nutzt nur jedes step-te Segment (Coarse-Variante
  // fuers Terrain, wo die Genauigkeit nicht kritisch ist).
  function distanceToRoad(x, z, step = 1) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i += step) {
      const ax = pts[i].x, az = pts[i].z;
      const bx = pts[i + 1].x, bz = pts[i + 1].z;
      const abx = bx - ax, abz = bz - az;
      const len2 = abx * abx + abz * abz || 1e-9;
      const t = THREE.MathUtils.clamp(((x - ax) * abx + (z - az) * abz) / len2, 0, 1);
      const dx = x - (ax + abx * t);
      const dz = z - (az + abz * t);
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  // --- Sanfte Huegel: weiche Sinus-Wellen, nahe der Strasse und am Rand abgeflacht ---
  function hill(x, z) {
    let h = Math.sin(x * 0.05 + 1.7) * Math.cos(z * 0.042 + 0.6) * 4.2
      + Math.sin(x * 0.016 - 0.4) * Math.sin(z * 0.02 + 2.1) * 6.5
      + Math.sin((x + z) * 0.028 + 3.0) * 2.6;
    h *= smoothstep(roadHalf + 5, roadHalf + 26, distanceToRoad(x, z, 4)); // Strasse bleibt flach
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h *= 1 - smoothstep(half - 16, half - 6, edge); // Rand bleibt flach (Mauer steht sicher)
    return h;
  }

  // --- Boden: gruene Wiese mit Flecken, zu Huegeln verformt ---
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = 256;
  const g = cnv.getContext('2d');
  g.fillStyle = '#5d8f3e';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const shades = ['#6da24a', '#527f36', '#679a45', '#587f3a'];
    g.fillStyle = shades[Math.floor(rand() * shades.length)];
    const r = 2 + rand() * 7;
    g.beginPath();
    g.arc(rand() * 256, rand() * 256, r, 0, Math.PI * 2);
    g.fill();
  }
  const grassTex = new THREE.CanvasTexture(cnv);
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(half / 5, half / 5);
  grassTex.colorSpace = THREE.SRGBColorSpace;

  const SEG = 150;
  const groundGeo = new THREE.PlaneGeometry(half * 2 + 160, half * 2 + 160, SEG, SEG);
  groundGeo.rotateX(-Math.PI / 2);
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, hill(pos.getX(i), pos.getZ(i)));
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 })
  );
  ground.receiveShadow = true;
  group.add(ground);

  // --- Strassen-Band entlang des Splines (Schotter-Schulter, Asphalt, Kantenlinien) ---
  const asphaltCnv = document.createElement('canvas');
  asphaltCnv.width = asphaltCnv.height = 128;
  const ag = asphaltCnv.getContext('2d');
  ag.fillStyle = '#33373d';
  ag.fillRect(0, 0, 128, 128);
  ag.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 50; i++) ag.fillRect(rand() * 128, rand() * 128, 2, 2);
  const asphaltTex = new THREE.CanvasTexture(asphaltCnv);
  asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
  asphaltTex.colorSpace = THREE.SRGBColorSpace;

  // Band entlang der Mittellinie: Mitte bei lateral offset `off`, Breite `w`.
  function ribbon(off, w, y, material) {
    const n = pts.length;
    const positions = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    const indices = [];
    let len = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const pPrev = pts[Math.max(0, i - 1)];
      const pNext = pts[Math.min(n - 1, i + 1)];
      let tx = pNext.x - pPrev.x, tz = pNext.z - pPrev.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz, nz = tx; // Normale (links der Fahrtrichtung)
      if (i > 0) len += Math.hypot(p.x - pPrev.x, p.z - pPrev.z);
      const cx = p.x + nx * off, cz = p.z + nz * off;
      positions.set([cx + nx * w / 2, y, cz + nz * w / 2], i * 6);
      positions.set([cx - nx * w / 2, y, cz - nz * w / 2], i * 6 + 3);
      uvs.set([0, len / 4], i * 4);
      uvs.set([1, len / 4], i * 4 + 2);
      if (i < n - 1) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
        indices.push(a, c, b, b, c, d); // Winding: Normalen zeigen nach +Y (sichtbar von oben)
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  // Schotter-Schulter (etwas breiter, liegt unter dem Asphalt)
  ribbon(0, (roadHalf + 1.6) * 2, 0.025, new THREE.MeshStandardMaterial({ color: 0x8a8468, roughness: 1 }));
  // Asphalt
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.9 });
  ribbon(0, roadHalf * 2, 0.04, roadMat);
  // Kantenlinien
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xd9d9cf, roughness: 0.7 });
  ribbon(roadHalf - 0.35, 0.22, 0.055, lineMat);
  ribbon(-(roadHalf - 0.35), 0.22, 0.055, lineMat);

  // --- Baeume: nur einige Birken-Gruppen im Gruen (nicht an der Strasse) ---
  const birchTrunkMat = new THREE.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.85 });
  const birchCrownMat = new THREE.MeshStandardMaterial({ color: 0x4d8a3f, roughness: 1 });
  const addBirch = (x, z) => {
    const s = 0.8 + rand() * 0.5;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.24 * s, 2.4 * s, 8), birchTrunkMat);
    trunk.position.y = 1.2 * s;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.5 * s, 9, 7), birchCrownMat);
    crown.scale.y = 1.15;
    crown.position.y = 3.6 * s;
    trunk.castShadow = crown.castShadow = true;
    tree.add(trunk, crown);
    tree.position.set(x, hill(x, z), z);
    group.add(tree);
    colliders.push({ x, z, r: 0.7 * s });
  };

  const clearOfRoad = (x, z, margin) => distanceToRoad(x, z) > roadHalf + margin;
  const inBounds = (x, z) => Math.abs(x) < half - 12 && Math.abs(z) < half - 12;

  // ~14 Baumgruppen mit je 3-5 Birken + ein Dutzend einzelne Baeume
  let placed = 0;
  for (let c = 0; c < 14 && placed < 46; c++) {
    const cx = (rand() * 2 - 1) * (half - 30);
    const cz = (rand() * 2 - 1) * (half - 30);
    if (!clearOfRoad(cx, cz, 9) || !inBounds(cx, cz)) continue;
    const count = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < count && placed < 46; k++) {
      const x = cx + (rand() * 2 - 1) * 6;
      const z = cz + (rand() * 2 - 1) * 6;
      if (!clearOfRoad(x, z, 8) || !inBounds(x, z)) continue;
      addBirch(x, z);
      placed++;
    }
  }
  for (let k = 0; k < 14 && placed < 52; k++) {
    const x = (rand() * 2 - 1) * (half - 30);
    const z = (rand() * 2 - 1) * (half - 30);
    if (!clearOfRoad(x, z, 8) || !inBounds(x, z)) continue;
    addBirch(x, z);
    placed++;
  }

  // --- Zelte: ab und zu steht ein Zelt im Gruen ---
  const tentColors = [0xe07b39, 0x3f7fbf, 0xd9c04a, 0xc95b4a, 0x5b8f5a];
  let tents = 0;
  for (let k = 0; k < 40 && tents < 6; k++) {
    const x = (rand() * 2 - 1) * (half - 30);
    const z = (rand() * 2 - 1) * (half - 30);
    if (!clearOfRoad(x, z, 10) || !inBounds(x, z)) continue;
    const h = 1.9;
    const tent = new THREE.Mesh(
      new THREE.ConeGeometry(1.5, h, 4),
      new THREE.MeshStandardMaterial({ color: tentColors[tents % tentColors.length], roughness: 0.9 })
    );
    tent.rotation.y = rand() * Math.PI + Math.PI / 4; // Quadratgrundriss, Kante nach vorn
    tent.position.set(x, hill(x, z) + h / 2, z);
    tent.castShadow = tent.receiveShadow = true;
    group.add(tent);
    colliders.push({ x, z, r: 1.2 });
    tents++;
  }

  // --- Begrenzung: gruene Hecke rund um die Welt ---
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x3f6b34, roughness: 1 });
  const mkHedge = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, d), hedgeMat);
    m.position.set(x, 1.1, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  mkHedge(half * 2 + 160, 1.5, 0, -half);
  mkHedge(half * 2 + 160, 1.5, 0, half);
  mkHedge(1.5, half * 2 + 160, -half, 0);
  mkHedge(1.5, half * 2 + 160, half, 0);

  // --- Spawn: 10 m weiter vorn auf der Strasse (statt am absoluten Anfang),
  // damit das ganze Auto (4,4 m) samt Heck komplett auf dem Asphalt steht.
  // Heading entlang der Fahrtrichtung an dieser Stelle. ---
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  const pointAtLength = (s) => {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const t = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
    const a = pts[i], b = pts[i + 1];
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  };
  const SPAWN_AHEAD = 10; // m ab Strassenanfang
  const sp = pointAtLength(SPAWN_AHEAD);
  const spAhead = pointAtLength(SPAWN_AHEAD + 2);
  const spawn = { x: sp.x, z: sp.z, heading: Math.atan2(spAhead.x - sp.x, spAhead.z - sp.z) };

  return {
    id: 'temposuender',
    group,
    colliders,
    half,
    arc: null, // kein Kreisverkehr auf dieser Map
    roadHalf,
    spawn,
    // Kapitel-Ziel ist 120 km/h (33,3 m/s) - die Stadt-Defaults kommen nur auf
    // 108 km/h. Sanftere Beschleunigung als die Stadt (accel 18 statt 15, aber
    // Endgeschwindigkeit ~36 m/s = 129,6 km/h): 120 km/h nach ~5 s Vollgas
    // (~122 m) - die laengste Gerade der Strecke ist ~165 m lang.
    tuning: { maxSpeed: 38, accel: 18, drag: 0.5 },
    distanceToRoad: (x, z) => distanceToRoad(x, z, 1),
    dispose() {
      parent.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
    },
  };
}
