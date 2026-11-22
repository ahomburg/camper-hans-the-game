import * as THREE from 'three';

// Kapitel 2 "Temposuender": eigene Map NUR fuer dieses Kapitel - das Kapitel
// spielt im BAYERISCHEN VORALPENLAND: huegeliges Gruen mit Blumenwiesen,
// Mischwald aus Birken und Tannen, ein Maibaum am Strassenanfang, Marterln
// am Strassenrand, Almhuetten mit Kuhen auf der Weide - und hinter der
// Weltgrenze ragt die Alpen-Silhouette auf. Eine schlaengelnde Landstrasse
// fuehrt hindurch, ab und zu steht ein Zelt. Die Map wird erst gebaut, wenn
// das Kapitel ausgewaehlt wird (Lazy Load, siehe ensureMap in main.js). //
// NEBENBEI: Alle bayerischen Deko-Objekte ziehen aus einem EIGENEN
// Zufallsstroem (brand) - Birken, Zelte und Terrain behalten ihre
// vertrauten Plaetze.
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
  // Eigener Zufallsstroem fuers bayerische Deko (siehe unten): haelt die
  // Platzierung von Terrain, Birken und Zelten unangetastet.
  const brand = mulberry32(1809);

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
  // Bayerische Blumenwiese: weisse Gamsbluemli, blauer Enzian, roter Mohn
  // und gelbe Butterblumen als Tupfer im Gras (eigener brand-Strom, s.o.).
  const flowers = ['#f0eee2', '#7e9ff0', '#d94f3a', '#f0dc5a', '#f0eee2', '#a86fc4'];
  for (let i = 0; i < 120; i++) {
    g.fillStyle = flowers[Math.floor(brand() * flowers.length)];
    const r = 0.9 + brand() * 1.2;
    g.beginPath();
    g.arc(brand() * 256, brand() * 256, r, 0, Math.PI * 2);
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

  // --- Tannen: Birken allein sind nur halb Bayern - der Mischwald bekommt
  // dazu dunkle Nadelbaeume mit gestaffelten Kronenetagen.
  const firTrunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });
  const firMat = new THREE.MeshStandardMaterial({ color: 0x2b4a2f, roughness: 1 });
  let firs = 0;
  for (let c = 0; c < 18 && firs < 26; c++) {
    const cx = (brand() * 2 - 1) * (half - 34);
    const cz = (brand() * 2 - 1) * (half - 34);
    if (!clearOfRoad(cx, cz, 10) || !inBounds(cx, cz)) continue;
    const count = 3 + Math.floor(brand() * 3);
    for (let k = 0; k < count && firs < 26; k++) {
      const x = cx + (brand() * 2 - 1) * 7;
      const z = cz + (brand() * 2 - 1) * 7;
      if (!clearOfRoad(x, z, 9) || !inBounds(x, z)) continue;
      const s = 0.9 + brand() * 0.7;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * s, 0.2 * s, 1.1 * s, 6), firTrunkMat);
      trunk.position.y = 0.55 * s;
      tree.add(trunk);
      for (let tier = 0; tier < 3; tier++) { // drei gestaffelte Kegel-Etagen
        const r = (1.7 - tier * 0.42) * s;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 1.5 * s, 8), firMat);
        cone.position.y = (1.0 + tier * 1.0 + 0.75) * s;
        cone.castShadow = true;
        tree.add(cone);
      }
      tree.position.set(x, hill(x, z), z);
      group.add(tree);
      colliders.push({ x, z, r: 0.8 * s });
      firs++;
    }
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
  // Bogencoordinate entlang der Strassen-Mittellinie fuer den Landstrassen-
  // Verkehr (siehe roadtraffic.js): pointAt(s) = Position an der Stelle s
  // (0 <= s <= roadLength), headingAt(s) = Fahrtrichtung dort.
  const roadLength = cum[cum.length - 1];
  const headingAtLength = (s) => {
    const s0 = THREE.MathUtils.clamp(s - 2, 0, roadLength);
    const s1 = THREE.MathUtils.clamp(s + 2, 0, roadLength);
    const a = pointAtLength(s0), b = pointAtLength(s1);
    return Math.atan2(b.x - a.x, b.z - a.z);
  };
  const sp = pointAtLength(SPAWN_AHEAD);
  const spAhead = pointAtLength(SPAWN_AHEAD + 2);
  const spawn = { x: sp.x, z: sp.z, heading: Math.atan2(spAhead.x - sp.x, spAhead.z - sp.z) };

  // --- BAYERISCHES VORALPENLAND: Maibaum, Marterln, Almhuetten mit Kuhen
  // und die Alpen-Silhouette hinter der Weltgrenze. Alles steht mit dem
  // eigenen brand-Strom und weit genug von der Strasse, dass Hans' Tempos-
  // Jagd nichts davon im Weg steht.
  // Lateral-Versatz: Punkt an der Stellen s plus Normale (wie in ribbon)
  // mal `side` mal Abstand - side=1 links der Fahrtrichtung, -1 rechts.
  const beside = (s, offs, side) => {
    const p = pointAtLength(s);
    const h = headingAtLength(s);
    const nx = -Math.cos(h), nz = Math.sin(h);
    return { x: p.x + nx * offs * side, z: p.z + nz * offs * side, h };
  };

  // Maibaum am Strassenanfang: blau-weiss gestreifter Stamm mit Gruenkranz.
  {
    const b = beside(55, 9, 1);
    const mc = document.createElement('canvas');
    mc.width = 16; mc.height = 128;
    const mg = mc.getContext('2d');
    for (let i = 0; i < 8; i++) {
      mg.fillStyle = i % 2 ? '#f2f4f8' : '#2050a0'; // Bayern: blau-weiss
      mg.fillRect(0, i * 16, 16, 16);
    }
    const maiTex = new THREE.CanvasTexture(mc);
    maiTex.colorSpace = THREE.SRGBColorSpace;
    const gy = hill(b.x, b.z); // nahe der Strasse fast 0 (abgeflacht)
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.26, 9, 10),
      new THREE.MeshStandardMaterial({ map: maiTex, roughness: 0.8 })
    );
    pole.position.set(b.x, gy + 4.5, b.z);
    pole.castShadow = true;
    const wreath = new THREE.Mesh(
      new THREE.TorusGeometry(0.8, 0.17, 8, 18),
      new THREE.MeshStandardMaterial({ color: 0x2f6b33, roughness: 1 })
    );
    wreath.rotation.x = Math.PI / 2;
    wreath.position.set(b.x, gy + 7.5, b.z);
    wreath.castShadow = true;
    const top = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 1.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x2b4a2f, roughness: 1 })
    );
    top.position.set(b.x, gy + 9.6, b.z);
    top.castShadow = true;
    group.add(pole, wreath, top);
    colliders.push({ x: b.x, z: b.z, r: 0.5 });
  }

  // Marterln: kleine Wegekapellen am Strassenrand, das Bildchen mit dem
  // weissen Kreuz schaut zur Strasse.
  {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6e5236, roughness: 0.95 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 1 });
    const pc = document.createElement('canvas');
    pc.width = pc.height = 64;
    const pg = pc.getContext('2d');
    pg.fillStyle = '#9fc4e8'; pg.fillRect(0, 0, 64, 64);
    pg.fillStyle = '#f4f2e8';
    pg.fillRect(29, 12, 6, 40); pg.fillRect(18, 24, 28, 6); // schlichtes Kreuz
    pg.strokeStyle = '#b99a3e'; pg.lineWidth = 4; pg.strokeRect(2, 2, 60, 60);
    const picTex = new THREE.CanvasTexture(pc);
    picTex.colorSpace = THREE.SRGBColorSpace;
    for (const [s, side] of [[150, 1], [285, -1], [410, 1]]) {
      const b = beside(s, 8, side);
      const gy = hill(b.x, b.z);
      const shrine = new THREE.Group();
      for (const px of [-0.42, 0.42]) { // zwei Holzpfosten
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), darkMat);
        post.position.set(px, 0.75, 0);
        shrine.add(post);
      }
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 1.0), woodMat);
      body.position.y = 1.7;
      shrine.add(body);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.7, 4), darkMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 2.55;
      roof.castShadow = true;
      shrine.add(roof);
      const pic = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.6),
        new THREE.MeshStandardMaterial({ map: picTex, roughness: 0.9 })
      );
      pic.position.set(0, 1.7, 0.52);
      shrine.add(pic);
      shrine.position.set(b.x, gy, b.z);
      shrine.rotation.y = Math.atan2(-b.x + pointAtLength(s).x, -b.z + pointAtLength(s).z);
      group.add(shrine);
      colliders.push({ x: b.x, z: b.z, r: 0.9 });
    }
  }

  // Almhuetten: Holzhuett'n mit Steinfundament, rotem Pyramidendach,
  // Fenster mit warmem Licht und Kuhglocken-Vibe auf der Weide daneben.
  {
    const plankCnv = document.createElement('canvas');
    plankCnv.width = 64; plankCnv.height = 64;
    const plg = plankCnv.getContext('2d');
    plg.fillStyle = '#8a6a44'; plg.fillRect(0, 0, 64, 64);
    plg.fillStyle = '#79593a';
    for (let i = 0; i < 6; i++) plg.fillRect(0, i * 11 + 3, 64, 3); // Planken
    const plankTex = new THREE.CanvasTexture(plankCnv);
    plankTex.colorSpace = THREE.SRGBColorSpace;
    const plankMat = new THREE.MeshStandardMaterial({ map: plankTex, roughness: 0.95 });
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9a9488, roughness: 1 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x7a3428, roughness: 0.9 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x201408, emissive: 0xffb84a, emissiveIntensity: 0.8, roughness: 0.7 });
    const addHut = (s, side, off) => {
      const b = beside(s, off, side);
      if (!clearOfRoad(b.x, b.z, 12) || !inBounds(b.x, b.z)) return null;
      // Fundament in den TIEFSTEN Punkte der Grundflaeche setzen: Auf dem
      // sanften Hang versinkt die Basis dann leicht, statt auf der
      // Bergseite in der Luft zu schweben.
      let gy = Infinity;
      for (const [ox, oz] of [[-2.5, -2], [2.5, -2], [-2.5, 2], [2.5, 2], [0, 0]]) {
        gy = Math.min(gy, hill(b.x + ox, b.z + oz));
      }
      const hut = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.0, 4.6), stoneMat);
      base.position.y = 0.9; // Steinfundament, gleicht die Haenge aus
      base.receiveShadow = true;
      hut.add(base);
      const body = new THREE.Mesh(new THREE.BoxGeometry(5.0, 2.5, 4.0), plankMat);
      body.position.y = 2.6;
      body.castShadow = body.receiveShadow = true;
      hut.add(body);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 2.0, 4), roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = 0.82;
      roof.position.y = 4.9;
      roof.castShadow = true;
      hut.add(roof);
      const door = new THREE.Mesh(
        new THREE.PlaneGeometry(1.0, 1.7),
        new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 1 })
      );
      door.position.set(1.0, 2.35, 2.02);
      hut.add(door);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.6), windowMat);
      win.position.set(-1.2, 2.9, 2.02);
      hut.add(win);
      hut.position.set(b.x, gy, b.z);
      hut.rotation.y = Math.atan2(-b.x + pointAtLength(s).x, -b.z + pointAtLength(s).z);
      group.add(hut);
      colliders.push({ x: b.x, z: b.z, r: 3.3 });
      return b;
    };
    addHut(170, -1, 15);
    addHut(335, 1, 16);

    // Kuhe auf der Weide: weiss mit braunen Flecken, Huerner, Stups-Schnauze.
    const addCow = (x, z) => {
      const gy = hill(x, z);
      const cow = new THREE.Group();
      const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.9 });
      const spotMat = new THREE.MeshStandardMaterial({ color: 0x66452a, roughness: 0.9 });
      const legMat = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.9 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.85, 1.7), whiteMat);
      body.position.y = 1.15;
      body.castShadow = true;
      cow.add(body);
      for (const ox of [-0.25, 0.05]) { // Flecken als Plaettchen an den Seiten
        const spotPlate = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.5, 0.6), spotMat);
        spotPlate.position.set(0, 1.25, ox);
        cow.add(spotPlate);
      }
      const backSpot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.89, 0.5), spotMat);
      backSpot.position.set(0, 1.15, -0.5);
      cow.add(backSpot);
      for (const [lx, lz] of [[-0.3, 0.6], [0.3, 0.6], [-0.3, -0.6], [0.3, -0.6]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.95, 0.16), legMat);
        leg.position.set(lx, 0.48, lz);
        cow.add(leg);
      }
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.55), whiteMat);
      head.position.set(0, 1.5, 1.0);
      head.castShadow = true;
      cow.add(head);
      const snout = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.26, 0.2),
        new THREE.MeshStandardMaterial({ color: 0xd8a8a0, roughness: 0.9 })
      );
      snout.position.set(0, 1.36, 1.3);
      cow.add(snout);
      for (const hx of [-0.16, 0.16]) { // Huerner
        const horn = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.05, 0.3, 6),
          new THREE.MeshStandardMaterial({ color: 0xe8e4d4, roughness: 0.7 })
        );
        horn.position.set(hx, 1.85, 0.95);
        cow.add(horn);
      }
      cow.position.set(x, gy, z);
      cow.rotation.y = brand() * Math.PI * 2;
      const cs = 0.9 + brand() * 0.25;
      cow.scale.setScalar(cs);
      group.add(cow);
      colliders.push({ x, z, r: 1.1 * cs });
    };
    // Eine kleine Herde auf der Weide zwischen den Huett'n ...
    const herd = beside(245, 13, 1);
    for (let k = 0; k < 4; k++) {
      const x = herd.x + (brand() * 2 - 1) * 4;
      const z = herd.z + (brand() * 2 - 1) * 4;
      if (!clearOfRoad(x, z, 6) || !inBounds(x, z)) continue;
      addCow(x, z);
    }
  }

  // Alpen-Silhouette: graue Riesen mit Schneekappen ringförmig hinter der
  // Weltgrenze - von der Hecke aus ragen sie wie ein echtes Voralpenpanorama.
  {
    const alpMat = new THREE.MeshStandardMaterial({ color: 0x6a788e, roughness: 1 });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xe9eef5, roughness: 0.75 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + brand() * 0.4;
      const R = half + 42 + brand() * 26;
      const x = Math.sin(a) * R, z = Math.cos(a) * R;
      const h2 = 36 + brand() * 28;
      const br = 24 + brand() * 18;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(br, h2, 7), alpMat);
      cone.position.set(x, h2 / 2 - 8, z);
      group.add(cone);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(br * 0.36, h2 * 0.3, 7), snowMat);
      cap.position.set(x, h2 - 8 - h2 * 0.15, z);
      group.add(cap);
    }
  }

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
    roadPath: {
      length: roadLength,
      pointAt: pointAtLength,
      headingAt: headingAtLength,
    },
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
