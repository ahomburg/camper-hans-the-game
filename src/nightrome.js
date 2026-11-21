// Kapitel 3 "Nachts nach Rom": eigene Map NUR fuer dieses Kapitel - stockdunkle
// italienische Landschaft mit einem verwinkelten Wegenetz aus vielen
// Abzweigungen. Das Fahrlicht des Autos ist kaputt (siehe Kapitel-Geschichte),
// die einzige Lichtquelle ist die in der Werkstatt kaufbare Taschenlampe
// (Spotlight, siehe main.js) - und die leuchtet nur einige Meter.
//
// Aufbau (alle Koordinaten [x, z], Hans startet im Sueden, Rom liegt im
// Norden): Das Wegenetz ist ein Baum aus Y-Gabeln. Auf der korrekten Route
// (start -> A -> L1 -> LR -> LRR -> C1 -> D1 -> gate -> Rom) zeigt an JEDEM
// Abzweig ein Holzschild "ROMA xx km" die richtige Fahrtrichtung an - aber
// im Dunkeln sind die Schilder nur mit der Taschenlampe lesbar. Alle falschen
// Abzweigungen enden in zehn benannten Sackgassen (Siena, Pisa, Neapel ...),
// jeweils mit rot-weisser Barriere. Eine dichte Zypressen-Reihe am Wegesrand
// und Reflektoren ("Katzenaugen") markieren die Strassen auch ohne Licht.
//
// Die Physik des Vans ist 2D (y = 0), deshalb liegt die ganze Karte flach.

import * as THREE from 'three';

// Deterministischer Zufall (wie in world.js/hills.js): Die Landschaft sieht
// bei jedem Start gleich aus - auch in der Nacht.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTexture(cnv) {
  const t = new THREE.CanvasTexture(cnv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Textur fuer ein Holz-Wegeschild mit einer Zeile je Abzweigung. Jede Zeile:
// "← ROMA 96 km" bzw. "NAPOLI 205 km →" - der Pfeil zeigt die Richtung
// relativ zum kommenden Hans (links/rechts der Anfahrt).
function signTexture(lines) {
  const W = 512;
  const LH = 72;
  const cnv = document.createElement('canvas');
  cnv.width = W;
  cnv.height = LH * lines.length;
  const g = cnv.getContext('2d');
  g.fillStyle = '#7a5a33';
  g.fillRect(0, 0, W, cnv.height);
  g.strokeStyle = '#54401f';
  g.lineWidth = 10;
  g.strokeRect(5, 5, W - 10, cnv.height - 10);
  g.fillStyle = '#f4ead2';
  g.font = 'bold 40px "Trebuchet MS", Verdana, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    const txt =
      (l.side === 0 ? '↑ ' : l.side < 0 ? '← ' : '') + l.n +
      (l.km ? `  ${l.km} km` : '') +
      (l.side > 0 ? ' →' : '');
    g.fillText(txt, W / 2, LH * i + LH / 2);
  });
  return makeTexture(cnv);
}

// Rot-weiss gestreifte Barriere mit "SACKGASSE"-Schriftzug (fuers Ende jeder
// falschen Abzweigung).
function barrierTexture() {
  const W = 512, H = 96;
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const g = cnv.getContext('2d');
  g.fillStyle = '#cfd2d6';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#c23b2e';
  g.save();
  for (let x = -H; x < W + H; x += 64) {
    g.beginPath();
    g.moveTo(x, 0); g.lineTo(x + 32, 0); g.lineTo(x + 32 + H, H); g.lineTo(x + H, H);
    g.closePath(); g.fill();
  }
  g.restore();
  g.fillStyle = '#10131a';
  g.font = 'bold 44px "Trebuchet MS", Verdana, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SACKGASSE', W / 2, H / 2 + 2);
  return makeTexture(cnv);
}

// "ROMA"-Balken ueber dem Stadttor am Ende der richtigen Route.
function romaNovaTexture() {
  const W = 512, H = 128;
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const g = cnv.getContext('2d');
  g.fillStyle = '#b39a6e';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#6e5a36';
  g.lineWidth = 8;
  g.strokeRect(4, 4, W - 8, H - 8);
  g.fillStyle = '#3d2c14';
  g.font = 'bold 78px "Trebuchet MS", Verdana, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('R O M A', W / 2, H / 2 + 4);
  return makeTexture(cnv);
}

export function buildNightRomeMap(parent) {
  const group = new THREE.Group();
  parent.add(group);

  const colliders = [];
  const half = 280;      // halbe Kantenlaenge der Welt
  const roadHalf = 5;    // halbe Strassenbreite der Landwege (10 m Gesamt)
  const rand = mulberry32(33071); // deterministisch: die Nacht sieht immer gleich aus

  // --- Wegenetz: Knoten (x, z) und gerade Strassenabschnitte [von, nach, Breite]
  const P = {
    start: [0, 262],
    A: [0, 208],        // Gabel 1 (links ROMA, rechts NAPOLI)
    L1: [-64, 176],     // richtig
    siena: [-124, 138],
    LR: [-52, 132],     // richtig
    pisa: [-108, 96],
    LRR: [-44, 84],     // richtig
    firenze: [-116, 44],
    C1: [-30, 22],      // richtig
    bologna: [-98, -18],
    D1: [-24, -40],     // richtig
    ancona: [-94, -44],
    gate: [-12, -70],   // Stadttor von Rom
    rome: [-12, -108],  // Platz (Kolosseum dahinter)
    R1: [58, 186],      // falsch
    napoli: [16, 146],
    RR: [116, 148],     // falsch (tief im Osten)
    venezia: [152, 102],
    RRR: [100, 82],
    genova: [130, 26],
    C2: [84, 8],
    torino: [130, -36],
    ravenna: [58, -44],
  };
  const ROADS = [
    ['start', 'A', 11],
    ['A', 'L1', 10], ['A', 'R1', 10],
    ['L1', 'siena', 10], ['L1', 'LR', 10],
    ['LR', 'pisa', 10], ['LR', 'LRR', 10],
    ['LRR', 'firenze', 10], ['LRR', 'C1', 10],
    ['C1', 'bologna', 10], ['C1', 'D1', 10],
    ['D1', 'ancona', 10], ['D1', 'gate', 11],
    ['gate', 'rome', 11],
    ['R1', 'napoli', 10], ['R1', 'RR', 10],
    ['RR', 'venezia', 10], ['RR', 'RRR', 10],
    ['RRR', 'genova', 10], ['RRR', 'C2', 10],
    ['C2', 'torino', 10], ['C2', 'ravenna', 10],
  ];

  const segs = ROADS.map(([a, b, w]) => {
    const A = P[a], B = P[b];
    return { a: A, b: B, w, name: [a, b] };
  });

  // Abstand Punkt -> Strassenabschnitt (fuer Baeume, die nicht auf der
  // Strasse stehen duerfen).
  function distToRoads(x, z) {
    let best = Infinity;
    for (const s of segs) {
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
      const len2 = dx * dx + dz * dz || 1e-9;
      const t = THREE.MathUtils.clamp(((x - s.a[0]) * dx + (z - s.a[1]) * dz) / len2, 0, 1);
      const px = s.a[0] + dx * t, pz = s.a[1] + dz * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  // --- Nachthimmel: Sterne (ueberstehen dem Nebel, material.fog = false),
  // Mond-Scheibe und ein sehr dunkler Boden mit dunklen Grasfarben.
  {
    const starGeo = new THREE.BufferGeometry();
    const n = 700;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // gleichmaessig auf der Himmelskuppel, immer ueberm Horizont
      const a = rand() * Math.PI * 2;
      const y = 0.15 + rand() * 0.85; // 0..1 -> Hoehe
      const r = Math.sqrt(1 - y * y) * 470;
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = y * 470;
      arr[i * 3 + 2] = Math.sin(a) * r;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xd6e0f0, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.9,
    });
    starMat.fog = false; // Sterne leuchten durch den Nebel
    group.add(new THREE.Points(starGeo, starMat));

    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(16, 24),
      new THREE.MeshBasicMaterial({ color: 0xe8e4d0 })
    );
    moon.material.fog = false;
    moon.position.set(160, 210, -340);
    moon.lookAt(0, 0, 0);
    group.add(moon);
  }

  // --- Boden: dunkle Wiese
  {
    const cnv = document.createElement('canvas');
    cnv.width = cnv.height = 256;
    const g = cnv.getContext('2d');
    g.fillStyle = '#232d1c';
    g.fillRect(0, 0, 256, 256);
    const shades = ['#1d2717', '#28331f', '#202b1a', '#2b3622'];
    for (let i = 0; i < 300; i++) {
      g.fillStyle = shades[Math.floor(rand() * shades.length)];
      const r = 2 + rand() * 8;
      g.beginPath();
      g.arc(rand() * 256, rand() * 256, r, 0, Math.PI * 2);
      g.fill();
    }
    const groundTex = makeTexture(cnv);
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(half / 5, half / 5);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2 + 120, half * 2 + 120),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);
  }

  // --- Strassen: dunkler Asphalt als flache Quads entlang der Segmente,
  // inkl. weisser Kantenlinien, gelber Mittelstriche ("Bordstein-Mitte") und
  // Reflektoren am Rand, die auch ohne Scheinwerfer schwach leuchten.
  const asphaltTex = (() => {
    const cnv = document.createElement('canvas');
    cnv.width = cnv.height = 128;
    const ag = cnv.getContext('2d');
    ag.fillStyle = '#2b2e33';
    ag.fillRect(0, 0, 128, 128);
    ag.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 60; i++) ag.fillRect(rand() * 128, rand() * 128, 2, 2);
    const t = makeTexture(cnv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();

  // Flaches, unten zentriertes Rechteck entlang a->b (Laenge = |b-a|), in der
  // Mitte des Rechtecks. off: seitlicher Versatz entlang der Normale (links
  // der Fahrtrichtung ist positiv).
  function addQuad(a, b, w, y, mat, off = 0, scaleUV = true) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const geo = new THREE.PlaneGeometry(w, len);
    geo.rotateX(-Math.PI / 2);
    if (scaleUV) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * w / 4, uv.getY(i) * len / 4);
      }
    }
    const h = Math.atan2(dx, dz);
    const nlx = Math.cos(h), nlz = -Math.sin(h); // Normale links der Richtung
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((a[0] + b[0]) / 2 + nlx * off, y, (a[1] + b[1]) / 2 + nlz * off);
    mesh.rotation.y = h;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.95 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xbfc0b4, roughness: 0.8 });
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xb9a13a, roughness: 0.8 });
  const reflectorPts = [];

  for (const s of segs) {
    addQuad(s.a, s.b, s.w, 0.04, roadMat);
    addQuad(s.a, s.b, 0.24, 0.05, edgeMat, (s.w / 2 - 0.45), false);
    addQuad(s.a, s.b, 0.24, 0.05, edgeMat, -(s.w / 2 - 0.45), false);
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const h = Math.atan2(dx, dz);
    const nlx = Math.cos(h), nlz = -Math.sin(h);
    // gelbe Mittelstriche alle 7 m
    for (let t = 4; t < len - 4; t += 7) {
      const m = addQuad(
        [s.a[0] + ux * t, s.a[1] + uz * t],
        [s.a[0] + ux * (t + 1.6), s.a[1] + uz * (t + 1.6)],
        0.18, 0.055, dashMat, 0, false
      );
      m.receiveShadow = false;
    }
    // Reflektoren ("Katzenaugen") an beiden Raendern: die kleinen Punkte
    // leuchten selbst und zeigen Hans die Strassen auch im Blindflug.
    for (let t = 5; t < len - 2; t += 12) {
      for (const side of [-1, 1]) {
        reflectorPts.push(
          s.a[0] + ux * t + nlx * side * (s.w / 2 - 0.35),
          0.14,
          s.a[1] + uz * t + nlz * side * (s.w / 2 - 0.35)
        );
      }
    }
  }
  {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(reflectorPts), 3));
    const mat = new THREE.PointsMaterial({ color: 0xe8ecf2, size: 0.3, sizeAttenuation: true });
    group.add(new THREE.Points(geo, mat));
  }

  // --- Gabel-Platz (kleiner Asphalt-Kreis) an jedem Knoten mit Verzweigung,
  // damit sich kreuzende Segmente nicht haesslich ueberlappen.
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0x2f3238, roughness: 0.95 });
  const addPlaza = (x, z, r) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 10), plazaMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.045, z);
    m.receiveShadow = true;
    group.add(m);
  };
  for (const k of ['A', 'L1', 'LR', 'LRR', 'C1', 'D1', 'R1', 'RR', 'RRR', 'C2', 'gate']) {
    addPlaza(P[k][0], P[k][1], 7.5);
  }

  // --- Wegweiser an den Gabeln: Holzschild mit einer Zeile je Ausfahrt. Die
  // Pfeil-Richtung wird aus der Geometrie berechnet ("links" der Anfahrt =
  // Kreuzprodukt-Anzeichen). Am richtigen Weg steht immer "ROMA" mit
  // abnehmenden Kilometern - im Dunkeln muss Hans mit der Taschenlampe nah
  // genug rangehen, um zu lesen.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.95 });
  const addSignpost = (x, z, headingIn, lines) => {
    const fx = Math.sin(headingIn), fz = Math.cos(headingIn);
    const rx = -Math.cos(headingIn), rz = Math.sin(headingIn); // rechts der Anfahrt
    const px = x - fx * 6 + rx * 6.8;
    const pz = z - fz * 6 + rz * 6.8;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.6, 8), poleMat);
    pole.position.set(px, 1.3, pz);
    pole.castShadow = true;
    group.add(pole);
    const boardH = 0.56 * lines.length;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, boardH),
      new THREE.MeshStandardMaterial({ map: signTexture(lines), roughness: 0.9, side: THREE.DoubleSide })
    );
    board.position.set(px, 2.9 - boardH / 2, pz);
    board.rotation.y = headingIn + Math.PI; // Front zeigt zum ankommenden Hans
    group.add(board);
    colliders.push({ x: px, z: pz, r: 0.4 });
  };

  // Seiten-Relativierung fuer die Schild-Pfeile: vergleicht Anfahrt und
  // Ausfahrt; nahezu geradeaus (sin < ~0.35, d.h. ~20 Grad) bekommt einen
  // "↑"-Pfeil, scharfe Winkel links "←" bzw. rechts "→".
  const STRAIGHT_SIN = 0.35;
  const sideFor = (from, atKey, toKey) => {
    const f = [P[atKey][0] - P[from][0], P[atKey][1] - P[from][1]];
    const d = [P[toKey][0] - P[atKey][0], P[toKey][1] - P[atKey][1]];
    const cross = f[0] * d[1] - f[1] * d[0];
    const dot = f[0] * d[0] + f[1] * d[1];
    // sin des Zwischenwinkels = cross / (|f| * |d|)
    const sinA = Math.abs(cross) / ((Math.hypot(f[0], f[1]) * Math.hypot(d[0], d[1])) || 1e-9);
    if (sinA < STRAIGHT_SIN) return 0;
    // Vorzeichen: zeigt die Ausfahrt von der Anfahrt aus "nach links gedreht"
    // (negatives Kreuzprodukt) oder nach rechts?
    return cross < 0 ? -1 : 1;
  };

  const headingBetween = (from, to) =>
    Math.atan2(P[to][0] - P[from][0], P[to][1] - P[from][1]);

  // Schild-Definitionen: at = Gabel-Knoten, from = Anfahrt, exits = je Ausfahrt
  // { name, km } (km = die auf dem Schild behauptete Restentfernung).
  const SIGN_DEFS = [
    { at: 'A', from: 'start', exits: [{ to: 'L1', n: 'ROMA', km: 96 }, { to: 'R1', n: 'NAPOLI', km: 205 }] },
    { at: 'L1', from: 'A', exits: [{ to: 'LR', n: 'ROMA', km: 72 }, { to: 'siena', n: 'SIENA', km: 34 }] },
    { at: 'LR', from: 'L1', exits: [{ to: 'LRR', n: 'ROMA', km: 52 }, { to: 'pisa', n: 'PISA', km: 12 }] },
    { at: 'LRR', from: 'LR', exits: [{ to: 'C1', n: 'ROMA', km: 36 }, { to: 'firenze', n: 'FIRENZE', km: 19 }] },
    { at: 'C1', from: 'LRR', exits: [{ to: 'D1', n: 'ROMA', km: 21 }, { to: 'bologna', n: 'BOLOGNA', km: 26 }] },
    { at: 'D1', from: 'C1', exits: [{ to: 'gate', n: 'ROMA', km: 9 }, { to: 'ancona', n: 'ANCONA', km: 44 }] },
    { at: 'R1', from: 'A', exits: [{ to: 'napoli', n: 'NAPOLI', km: 205 }, { to: 'RR', n: 'VENEZIA', km: 38 }] },
    { at: 'RR', from: 'R1', exits: [{ to: 'venezia', n: 'VENEZIA', km: 38 }, { to: 'RRR', n: 'GENOVA', km: 87 }] },
    { at: 'RRR', from: 'RR', exits: [{ to: 'genova', n: 'GENOVA', km: 87 }, { to: 'C2', n: 'TORINO', km: 66 }] },
    { at: 'C2', from: 'RRR', exits: [{ to: 'torino', n: 'TORINO', km: 66 }, { to: 'ravenna', n: 'RAVENNA', km: 39 }] },
  ];
  for (const sd of SIGN_DEFS) {
    const lines = sd.exits.map((e) => ({ n: e.n, km: e.km, side: sideFor(sd.from, sd.at, e.to) }));
    addSignpost(P[sd.at][0], P[sd.at][1], headingBetween(sd.from, sd.at), lines);
  }

  // --- Sackgassen: Barriere + Schild, dahinter ein kleiner dunkler Wald.
  const barrierTex = barrierTexture();
  const DEADEND_KEYS = ['siena', 'pisa', 'firenze', 'bologna', 'ancona', 'napoli', 'venezia', 'genova', 'torino', 'ravenna'];
  // Eingehende Strasse je Sackgasse (fuer die Ausrichtung der Barriere)
  const DEADEND_FROM = {
    siena: 'L1', pisa: 'LR', firenze: 'LRR', bologna: 'C1', ancona: 'D1',
    napoli: 'R1', venezia: 'RR', genova: 'RRR', torino: 'C2', ravenna: 'C2',
  };
  const deadEnds = DEADEND_KEYS.map((k) => {
    const [x, z] = P[k];
    const from = P[DEADEND_FROM[k]];
    const h = Math.atan2(x - from[0], z - from[1]);
    const fx = Math.sin(h), fz = Math.cos(h);
    const bx = x - fx * 3.5, bz = z - fz * 3.5; // Barreiraufstellung vor dem Ende
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 0.9),
      new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.85, side: THREE.DoubleSide })
    );
    board.position.set(bx, 1.0, bz);
    board.rotation.y = h + Math.PI;
    group.add(board);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.3, 8), poleMat);
      post.position.set(bx - fz * side * 2.1, 0.65, bz + fx * side * 2.1);
      group.add(post);
    }
    colliders.push({ x: bx, z: bz, r: 1.6 });
    return { name: k, x: P[k][0], z: P[k][1] };
  });

  // --- Zypressen-und-Baum-Wald: dichtes Gestruez zufaellig ueber die Karte,
  // aber 9 m Abstand zu jeder Strasse. Wer abseits abkuerzt, kollidiert
  // staendig mit den dunklen Gestalten - gruesst von Francesco.
  const cypressMat = new THREE.MeshStandardMaterial({ color: 0x152a1c, roughness: 1 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2b2116, roughness: 1 });
  const addTree = (x, z) => {
    const s = 0.75 + rand() * 0.7;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * s, 0.2 * s, 1.2 * s, 6), trunkMat);
    trunk.position.y = 0.6 * s;
    if (rand() < 0.55) {
      const cypress = new THREE.Mesh(new THREE.ConeGeometry(0.95 * s, 5.2 * s, 8), cypressMat);
      cypress.position.y = 1.2 * s + 2.6 * s;
      cypress.castShadow = true;
      tree.add(trunk, cypress);
    } else {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.6 * s, 8, 6), cypressMat);
      crown.scale.y = 0.85;
      crown.position.y = 1.2 * s + 1.4 * s;
      crown.castShadow = true;
      tree.add(trunk, crown);
    }
    tree.position.set(x, 0, z);
    group.add(tree);
    colliders.push({ x, z, r: 0.75 * s });
  };
  const inBounds = (x, z) => Math.abs(x) < half - 14 && Math.abs(z) < half - 14;
  {
    let placed = 0;
    for (let tries = 0; tries < 2400 && placed < 420; tries++) {
      const x = (rand() * 2 - 1) * (half - 20);
      const z = (rand() * 2 - 1) * (half - 20);
      if (!inBounds(x, z) || distToRoads(x, z) < 9) continue;
      addTree(x, z);
      placed++;
    }
    // Wald-Gruppchen an den Sackgassen-Enden (Fall, dass der Weg muede endet)
    for (const d of deadEnds) {
      for (let k = 0; k < 5; k++) {
        const x = d.x + (rand() * 2 - 1) * 7;
        const z = d.z + 6 + rand() * 7;
        if (distToRoads(x, z) >= 6 && inBounds(x, z)) addTree(x, z);
      }
    }
  }

  // --- Weltgrenze: dunkle Baumreihe (statt Hecke) rund um die Welt
  const borderMat = new THREE.MeshStandardMaterial({ color: 0x0e1a12, roughness: 1 });
  for (let t = -half; t <= half; t += 6) {
    for (const [bx, bz] of [[t, -half], [t, half], [-half, t], [half, t]]) {
      const w = new THREE.Mesh(new THREE.ConeGeometry(1.3, 6.5, 6), borderMat);
      w.position.set(bx, 3.2, bz);
      group.add(w);
    }
  }

  // --- Rom: Vorplatz mit warmem Licht, "ROMA"-Stadttor und stylisiertes
  // Kolosseum dahinter - das einzige leuchtende Ziel in der Ferne (derweil
  // Nebel es frueh verschluckt).
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a7f6e, roughness: 0.9 });
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x2a2013, emissive: 0xff9d4a, emissiveIntensity: 0.9, roughness: 0.8 });
  {
    const [rx, rz] = P.rome;
    // Platz
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(18, 26), new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.95 }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(rx, 0.05, rz);
    plaza.receiveShadow = true;
    group.add(plaza);

    // Laternen rund um den Platz (mit selbstleuchtenden Koepfen)
    const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x3a2f1d, emissive: 0xffb066, emissiveIntensity: 1.2, roughness: 0.7 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const lx = rx + Math.sin(a) * 15;
      const lz = rz + Math.cos(a) * 15;
      const poleL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 6), poleMat);
      poleL.position.set(lx, 1.7, lz);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), lampHeadMat);
      head.position.set(lx, 3.5, lz);
      group.add(poleL, head);
      colliders.push({ x: lx, z: lz, r: 0.35 });
    }
    const glowA = new THREE.PointLight(0xffb066, 90, 70, 1.6);
    glowA.position.set(rx, 6, rz);
    const glowB = new THREE.PointLight(0xffc080, 45, 40, 1.6);
    glowB.position.set(P.gate[0], 4, P.gate[1] - 8);
    group.add(glowA, glowB);

    // Stadttor: zwei Pfeiler + Balken mit ROMA-Schrift (Kollision: Pfeiler)
    const gateZ = P.gate[1] - 12;
    for (const side of [-1, 1]) {
      const gx = P.gate[0] + side * 6.2;
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6.4, 1.5), stoneMat);
      pillar.position.set(gx, 3.2, gateZ);
      pillar.castShadow = true;
      group.add(pillar);
      colliders.push({ x: gx, z: gateZ, r: 1.0 });
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 1.9), stoneMat);
      cap.position.set(gx, 6.6, gateZ);
      group.add(cap);
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(14, 1.6, 1.0),
      new THREE.MeshStandardMaterial({ map: romaNovaTexture(), roughness: 0.85 })
    );
    beam.position.set(P.gate[0], 6.2, gateZ);
    group.add(beam);

    // Kolosseum, stilisiert: zwei Ringwaende mit leuchtenden "Fensterbögen",
    // dahinter am Platz-Nordrand
    const colR = 10;
    const colZ = rz - 26;
    for (const [r, hgt] of [[colR, 5.6], [colR - 3.2, 4.2]]) {
      const wall = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, hgt, 28, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x8a7f6e, roughness: 0.95, side: THREE.DoubleSide })
      );
      wall.position.set(rx, hgt / 2, colZ);
      group.add(wall);
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const wx = rx + Math.sin(a) * (colR + 0.06);
      const wz = colZ + Math.cos(a) * (colR + 0.06);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.5), windowMat);
      win.position.set(wx, 2.2, wz);
      win.rotation.y = a;
      group.add(win);
    }
    // grobe Kollisionsscheiben fuer den Kolosseum-Ring
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      colliders.push({ x: rx + Math.sin(a) * (colR - 1.5), z: colZ + Math.cos(a) * (colR - 1.5), r: 2.5 });
    }
  }

  // --- Wegpunkte (Fortschritt) auf der korrekten Route: jeweils die Mitte
  // der richtigen Abzweigung - so zaehlt der Balken nur, wenn Hans wirklich
  // richtig abbiegt. Reihenfolge ist monoton (Ueberspringen erlaubt).
  const mid = (a, b) => ({ x: (P[a][0] + P[b][0]) / 2, z: (P[a][1] + P[b][1]) / 2 });
  const waypoints = [
    { ...mid('A', 'L1'), label: 'Erste Gabel – links nach ROMA!' },
    { ...mid('L1', 'LR'), label: 'Weiter geradeaus Richtung Rom …' },
    { ...mid('LR', 'LRR'), label: 'Rom kommt näher – das Schild sagt so.' },
    { ...mid('LRR', 'C1'), label: 'Noch ein Kaffee, dann Rom!' },
    { ...mid('C1', 'D1'), label: 'Unverdrossen: nur 2 Gabeln noch.' },
    { ...mid('D1', 'gate'), label: 'Da vorn: die Lichter von Rom!' },
    { x: P.gate[0], z: P.gate[1], label: 'Durch das Stadttor!' },
  ];

  // --- Spawn: auf der Startstrasse, Blick nach Norden (zum ersten Abzweig).
  const spawn = { x: P.start[0], z: P.start[1] - 10, heading: headingBetween('start', 'A') };

  // --- Route fuer den Nachtweg-Verkehr (roadtraffic.js, night: true):
  // Die korrekte Strecke bis vors ROMA-Stadttor als Polylinie mit Bogenlaenge.
  // Die Verkehrautos (Mercedes, Kaefer, Ente - die GLB-Vorlagen aus traffic.js)
  // tuckern mit Scheinwerfern ueber die richtige Route Richtung Rom; wer ihren
  // Lichtern folgt, biegt automatisch richtig ab. Am Tor tappen sie im Dunkeln
  // zurueck zum Start (Wrap der Bogenposition) - unsichtbar im Nachtfleck.
  const ROUTE = ['start', 'A', 'L1', 'LR', 'LRR', 'C1', 'D1', 'gate'];
  const routePts = ROUTE.map((k) => ({ x: P[k][0], z: P[k][1] }));
  const routeCum = [0];
  for (let i = 1; i < routePts.length; i++) {
    routeCum.push(routeCum[i - 1] + Math.hypot(
      routePts[i].x - routePts[i - 1].x,
      routePts[i].z - routePts[i - 1].z
    ));
  }
  const routeLength = routeCum[routeCum.length - 1];
  const pointOnRoute = (s) => {
    let i = 0;
    while (i < routeCum.length - 2 && routeCum[i + 1] < s) i++;
    const t = (s - routeCum[i]) / ((routeCum[i + 1] - routeCum[i]) || 1);
    const a = routePts[i], b = routePts[i + 1];
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  };
  const headingOnRoute = (s) => {
    const s0 = THREE.MathUtils.clamp(s - 2, 0, routeLength);
    const s1 = THREE.MathUtils.clamp(s + 2, 0, routeLength);
    const a = pointOnRoute(s0), b = pointOnRoute(s1);
    return Math.atan2(b.x - a.x, b.z - a.z);
  };

  return {
    id: 'romnacht',
    group,
    colliders,
    half,
    arc: null,   // kein Kreisverkehr auf dieser Map
    night: true, // main.js schaltet auf Nacht-Atmosphäre (Nebel, Sterne, Licht)
    roadHalf,
    spawn,
    waypoints,
    deadEnds,
    rome: { x: P.rome[0], z: P.rome[1] },
    roadPath: { length: routeLength, pointAt: pointOnRoute, headingAt: headingOnRoute },
    // Nachtfahrt: gemuetliches Tempo reicht - wer rast, faehrt gegen Zypressen.
    tuning: { maxSpeed: 24, accel: 12, drag: 0.55 },
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
