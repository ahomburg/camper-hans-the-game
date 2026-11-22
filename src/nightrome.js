// Kapitel 3 "Nachts nach Rom": eigene Map NUR fuer dieses Kapitel - stockdunkle
// italienische Landschaft mit einem verwinkelten Wegenetz aus vielen
// Abzweigungen. Das Fahrlicht des Autos ist kaputt (siehe Kapitel-Geschichte),
// die einzige Lichtquelle ist die in der Werkstatt kaufbare Taschenlampe
// (Spotlight, siehe main.js) - und die leuchtet nur einige Meter.
//
// Aufbau (alle Koordinaten [x, z], Hans startet im Sueden, Rom liegt im
// Norden): HUEGELIGES Gelaende (Sinus-Wellen, nahe den Strassen und am Rand
// abgeflacht, siehe hill()), darauf ein Wegenetz aus einer SERPENTINEN-
// Route: Von der Autobahnauffahrt bis zum ROMA-Stadttor muss Hans an NEUN
// Gabeln WIRKLICH abbiegen (links/rechts im Wechsel - die "geradeaus"-
// Ausfahrten sind alle Fallen in Sackgassen). Rund um die Route lugen zwei
// Irrwege-Baeume (Ost und West) mit nochmal drei bzw. fuenf Gabeln und
// insgesamt 17 benannten Sackgassen (Siena, Pisa, Neapel, Venedig ...).
// An jeder Gabel steht ein Holzschild; nur der richtige zeigt "ROMA" mit
// abnehmenden Kilometern - lesbar freilich nur mit Taschenlampe.
//
// Die Physik des Vans ist 2D (y = 0), deshalb liegen alle Strassen flach auf
// y ~ 0; die Huegel heben nur das GRUEN an (nahe der Strassen abgeflacht).

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

function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function makeTexture(cnv) {
  const t = new THREE.CanvasTexture(cnv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Textur fuer ein Holz-Wegeschild mit einer Zeile je Abzweigung. Jede Zeile:
// "← ROMA 96 km" bzw. "NAPOLI 205 km →" - der Pfeil zeigt die Richtung
// relativ zum kommenden Hans (links / geradeaus / rechts).
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

// Rot-weiss gestreifte Barriere mit "SACKGASSE"-Schriftzug (fuer das Ende
// jeder Sackgasse).
function barrierTexture() {
  const W = 512, H = 96;
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const g = cnv.getContext('2d');
  g.fillStyle = '#cfd2d6';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#c23b2e';
  for (let x = -H; x < W + H; x += 64) {
    g.beginPath();
    g.moveTo(x, 0); g.lineTo(x + 32, 0); g.lineTo(x + 32 + H, H); g.lineTo(x + H, H);
    g.closePath(); g.fill();
  }
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

  // --- Wegpunkte-Knoten (x, z) -------------------------------------------------
  // SERPENTINEN-ROUTE (korrekt, man muss an jeder Gabel abbiegen):
  //   start -> f1 -> w1 -> w2 -> w3 -> w4 -> w5 -> w6 -> w7 -> w8 -> gate -> rome
  // Jede w-Gabel hat zwei Ausfahrten: die ROMA-Kurve (links/rechts im
  // Wechsel) und eine "bequeme Geradeaus"-Falle in eine Sackgasse.
  // Falsch-Umwege: Ostbaum (e1..e5, NAPOLI/VENEZIA/... ), Westbaum
  // (m1..m3, SIENA/PISA/... ) und Links-Fallen wie LUCCA direkt neben der
  // Route.
  const P = {
    start: [0, 262],
    f1: [0, 218],        // Gabel 1: links ROMA, rechts ab in den Ostbaum
    w1: [-42, 192],      // Gabel 2: rechts ROMA (scharf), "geradeaus" SIENA-Baum
    w2: [-50, 144],      // Gabel 3: rechts ROMA, links taeuschend nach LUCCA
    w3: [-12, 112],      // Gabel 4: links ROMA, "geradeaus" MODENA-Sackgasse
    w4: [-4, 62],        // Gabel 5: links ROMA, "geradeaus" VOLTERRA-Sackgasse
    w5: [-32, 30],       // Gabel 6: rechts ROMA, "geradeaus" GROSSETO-Sackgasse
    w6: [-12, -18],      // Gabel 7: links ROMA, "geradeaus" ORVIETO-Sackgasse
    w7: [-44, -56],      // Gabel 8: rechts ROMA, "geradeaus" AREZZO-Sackgasse
    w8: [-24, -104],     // Gabel 9: links zum ROMA-Tor, "geradeaus" FERRARA
    gate: [-36, -152],   // ROMA-Stadttor (Verkehr verschwindet hier)
    rome: [-36, -192],   // Erleuchteter Platz, Kolosseum dahinter
    // Ostbaum (alles Sackgassen bzw. weitere Gabeln)
    e1: [42, 194],
    napoli: [82, 210],
    e2: [86, 166],
    venezia: [134, 160],
    e3: [108, 128],
    genova: [148, 104],
    e4: [116, 76],
    torino: [154, 40],
    e5: [92, 28],
    ravenna: [118, -22],
    ancona: [44, -20],
    // Westbaum
    m1: [-92, 170],
    siena: [-134, 192],
    m2: [-108, 118],
    pisa: [-148, 100],
    m3: [-92, 60],
    firenze: [-132, 40],
    pienza: [-62, 26],
    // Sackgassen-Falle "LUCCA" direkt hinter der w2-Gabel (taeuschend links)
    lucca: [-82, 96],
    // Sackgassen direkt an der Route ("Geradeaus"-Fallen)
    modena: [34, 84],
    volterra: [10, 12],
    grosseto: [-64, -6],
    orvieto: [24, -64],
    arezzo: [-84, -80],
    ferrara: [2, -150],
  };
  const ROADS = [
    ['start', 'f1', 11],
    ['f1', 'w1', 10], ['f1', 'e1', 10],
    ['w1', 'w2', 10], ['w1', 'm1', 10],
    ['w2', 'w3', 10], ['w2', 'lucca', 10],
    ['w3', 'w4', 10], ['w3', 'modena', 10],
    ['w4', 'w5', 10], ['w4', 'volterra', 10],
    ['w5', 'w6', 10], ['w5', 'grosseto', 10],
    ['w6', 'w7', 10], ['w6', 'orvieto', 10],
    ['w7', 'w8', 10], ['w7', 'arezzo', 10],
    ['w8', 'gate', 11], ['w8', 'ferrara', 10],
    ['gate', 'rome', 11],
    ['e1', 'napoli', 10], ['e1', 'e2', 10],
    ['e2', 'venezia', 10], ['e2', 'e3', 10],
    ['e3', 'genova', 10], ['e3', 'e4', 10],
    ['e4', 'torino', 10], ['e4', 'e5', 10],
    ['e5', 'ravenna', 10], ['e5', 'ancona', 10],
    ['m1', 'siena', 10], ['m1', 'm2', 10],
    ['m2', 'pisa', 10], ['m2', 'm3', 10],
    ['m3', 'firenze', 10], ['m3', 'pienza', 10],
  ];

  const segs = ROADS.map(([a, b, w]) => {
    const A = P[a], B = P[b];
    return { a: A, b: B, w };
  });

  // Abstand Punkt -> Strassenabschnitt (fuer Huegel-Abflachung, Baeume und
  // Zufalls-Platzierungen; alle Segmente, inkl. gate->rome).
  function distToRoads(x, z, step = 1) {
    let best = Infinity;
    for (let i = 0; i < segs.length; i += step) {
      const s = segs[i];
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
      const len2 = dx * dx + dz * dz || 1e-9;
      const t = THREE.MathUtils.clamp(((x - s.a[0]) * dx + (z - s.a[1]) * dz) / len2, 0, 1);
      const px = s.a[0] + dx * t, pz = s.a[1] + dz * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  // --- Huegel: weiche Sinus-Wellen (etwas © · 1.3 × staerker als das
  // Huegelland in Kapitel 2), nahe den Strassen, um den erleuchteten Platz
  // von Rom und an der Weltgrenze abgeflacht. Auto und Strassen liegen
  // sauber auf y ~ 0.
  function hill(x, z) {
    let h = Math.sin(x * 0.05 + 1.7) * Math.cos(z * 0.042 + 0.6) * 5.4
      + Math.sin(x * 0.016 - 0.4) * Math.sin(z * 0.02 + 2.1) * 8.2
      + Math.sin((x + z) * 0.028 + 3.0) * 3.4;
    h *= smoothstep(roadHalf + 5, roadHalf + 26, distToRoads(x, z, 2)); // Strassen bleiben flach
    h *= 1 - smoothstep(36, 54, Math.hypot(x - P.rome[0], z - P.rome[1])); // Platz + Kolosseum flach
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h *= 1 - smoothstep(half - 16, half - 6, edge); // Weltgrenze bleibt flach
    return h;
  }

  // --- Nachthimmel: Sterne (ueberstehen dem Nebel, material.fog = false),
  // Mond-Scheibe und ein sehr dunkler Boden mit dunklen Grasfarben.
  {
    const starGeo = new THREE.BufferGeometry();
    const n = 700;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const y = 0.15 + rand() * 0.85;
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

  // --- Boden: dunkle Wiese, zu Huegeln verformt ---
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

  {
    const SEG = 168;
    const groundGeo = new THREE.PlaneGeometry(half * 2 + 160, half * 2 + 160, SEG, SEG);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, hill(pos.getX(i), pos.getZ(i)));
    }
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
    );
    ground.receiveShadow = true;
    group.add(ground);
  }

  // --- Strassen: dunkler Asphalt als flache Quads entlang der Segmente,
  // inkl. weisser Kantenlinien, gelber Mittelstriche und Reflektoren am
  // Rand, die auch ohne Scheinwerfer schwach leuchten.
  const asphaltTex = (() => {
    const ac = document.createElement('canvas');
    ac.width = ac.height = 128;
    const ag = ac.getContext('2d');
    ag.fillStyle = '#2b2e33';
    ag.fillRect(0, 0, 128, 128);
    ag.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 60; i++) ag.fillRect(rand() * 128, rand() * 128, 2, 2);
    const t = makeTexture(ac);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();

  // Flaches Rechteck entlang a->b, seitlich versetzbar (off entlang der
  // Normale links der Fahrtrichtung, positiv = links).
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
    for (let t = 4; t < len - 4; t += 7) { // gelbe Mittelstriche
      const m = addQuad(
        [s.a[0] + ux * t, s.a[1] + uz * t],
        [s.a[0] + ux * (t + 1.6), s.a[1] + uz * (t + 1.6)],
        0.18, 0.055, dashMat, 0, false
      );
      m.receiveShadow = false;
    }
    for (let t = 5; t < len - 2; t += 12) { // Reflektoren ("Katzenaugen")
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

  // --- Gabel-Platz (kleiner Asphalt-Kreis) an jedem Knoten mit Verzweigung
  // oder Biegung, damit sich kreuzende Segmente sauber ueberlappen.
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0x2f3238, roughness: 0.95 });
  const addPlaza = (x, z, r) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 10), plazaMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.045, z);
    m.receiveShadow = true;
    group.add(m);
  };
  const PLAZAS = [
    'f1', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8',
    'e1', 'e2', 'e3', 'e4', 'e5', 'm1', 'm2', 'm3', 'gate',
  ];
  for (const k of PLAZAS) addPlaza(P[k][0], P[k][1], 7.5);

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
    const gy = hill(px, pz); // nahe der Strasse flach (~0), sicherheitshalber
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.6, 8), poleMat);
    pole.position.set(px, gy + 1.3, pz);
    pole.castShadow = true;
    group.add(pole);
    const boardH = 0.56 * lines.length;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, boardH),
      new THREE.MeshStandardMaterial({ map: signTexture(lines), roughness: 0.9, side: THREE.DoubleSide })
    );
    board.position.set(px, gy + 2.9 - boardH / 2, pz);
    board.rotation.y = headingIn + Math.PI; // Front zeigt zum ankommenden Hans
    group.add(board);
    colliders.push({ x: px, z: pz, r: 0.4 });
  };

  // Pfeil-Seite fuer die Schilder: vergleicht Anfahrt und Ausfahrt;
  // nahezu geradeaus (sin < ~0.35, d.h. ~20 Grad) bekommt einen "↑"-Pfeil,
  // scharfe Winkel links "←" bzw. rechts "→".
  const STRAIGHT_SIN = 0.35;
  const sideFor = (from, atKey, toKey) => {
    const f = [P[atKey][0] - P[from][0], P[atKey][1] - P[from][1]];
    const d = [P[toKey][0] - P[atKey][0], P[toKey][1] - P[atKey][1]];
    const cross = f[0] * d[1] - f[1] * d[0];
    const sinA = Math.abs(cross) / ((Math.hypot(f[0], f[1]) * Math.hypot(d[0], d[1])) || 1e-9);
    if (sinA < STRAIGHT_SIN) return 0;
    return cross < 0 ? -1 : 1;
  };

  const headingBetween = (from, to) =>
    Math.atan2(P[to][0] - P[from][0], P[to][1] - P[from][1]);

  // Schild-Definitionen: at = Gabel-Knoten, from = Anfahrt, exits = je
  // Ausfahrt { name, km } (km = die auf dem Schild behauptete Restentfernung
  // - auf der ROMA-Route wird es spuerbar weniger mit jeder Gabel).
  const ROMA_KM = { f1: 140, w1: 108, w2: 92, w3: 74, w4: 58, w5: 44, w6: 30, w7: 18, w8: 6 };
  const SIGN_DEFS = [
    { at: 'f1', from: 'start', exits: [{ to: 'w1', n: 'ROMA', km: ROMA_KM.f1 }, { to: 'e1', n: 'NAPOLI', km: 205 }] },
    { at: 'w1', from: 'f1', exits: [{ to: 'w2', n: 'ROMA', km: ROMA_KM.w1 }, { to: 'm1', n: 'SIENA', km: 34 }] },
    { at: 'w2', from: 'w1', exits: [{ to: 'w3', n: 'ROMA', km: ROMA_KM.w2 }, { to: 'lucca', n: 'LUCCA', km: 27 }] },
    { at: 'w3', from: 'w2', exits: [{ to: 'w4', n: 'ROMA', km: ROMA_KM.w3 }, { to: 'modena', n: 'MODENA', km: 61 }] },
    { at: 'w4', from: 'w3', exits: [{ to: 'w5', n: 'ROMA', km: ROMA_KM.w4 }, { to: 'volterra', n: 'VOLTERRA', km: 18 }] },
    { at: 'w5', from: 'w4', exits: [{ to: 'w6', n: 'ROMA', km: ROMA_KM.w5 }, { to: 'grosseto', n: 'GROSSETO', km: 24 }] },
    { at: 'w6', from: 'w5', exits: [{ to: 'w7', n: 'ROMA', km: ROMA_KM.w6 }, { to: 'orvieto', n: 'ORVIETO', km: 41 }] },
    { at: 'w7', from: 'w6', exits: [{ to: 'w8', n: 'ROMA', km: ROMA_KM.w7 }, { to: 'arezzo', n: 'AREZZO', km: 52 }] },
    { at: 'w8', from: 'w7', exits: [{ to: 'gate', n: 'ROMA', km: ROMA_KM.w8 }, { to: 'ferrara', n: 'FERRARA', km: 33 }] },
    { at: 'e1', from: 'f1', exits: [{ to: 'napoli', n: 'NAPOLI', km: 205 }, { to: 'e2', n: 'VENEZIA', km: 38 }] },
    { at: 'e2', from: 'e1', exits: [{ to: 'venezia', n: 'VENEZIA', km: 38 }, { to: 'e3', n: 'GENOVA', km: 87 }] },
    { at: 'e3', from: 'e2', exits: [{ to: 'genova', n: 'GENOVA', km: 87 }, { to: 'e4', n: 'TORINO', km: 66 }] },
    { at: 'e4', from: 'e3', exits: [{ to: 'torino', n: 'TORINO', km: 66 }, { to: 'e5', n: 'RAVENNA', km: 39 }] },
    { at: 'e5', from: 'e4', exits: [{ to: 'ravenna', n: 'RAVENNA', km: 39 }, { to: 'ancona', n: 'ANCONA', km: 44 }] },
    { at: 'm1', from: 'w1', exits: [{ to: 'siena', n: 'SIENA', km: 34 }, { to: 'm2', n: 'PISA', km: 12 }] },
    { at: 'm2', from: 'm1', exits: [{ to: 'pisa', n: 'PISA', km: 12 }, { to: 'm3', n: 'FIRENZE', km: 19 }] },
    { at: 'm3', from: 'm2', exits: [{ to: 'firenze', n: 'FIRENZE', km: 19 }, { to: 'pienza', n: 'PIENZA', km: 9 }] },
  ];
  for (const sd of SIGN_DEFS) {
    const lines = sd.exits.map((e) => ({ n: e.n, km: e.km, side: sideFor(sd.from, sd.at, e.to) }));
    addSignpost(P[sd.at][0], P[sd.at][1], headingBetween(sd.from, sd.at), lines);
  }

  // --- Sackgassen: Barriere + Schild, dahinter ein kleiner dunkler Wald.
  const barrierTex = barrierTexture();
  const DEADENDS = [
    { n: 'napoli', from: 'e1' }, { n: 'venezia', from: 'e2' },
    { n: 'genova', from: 'e3' }, { n: 'torino', from: 'e4' },
    { n: 'ravenna', from: 'e5' }, { n: 'ancona', from: 'e5' },
    { n: 'siena', from: 'm1' }, { n: 'pisa', from: 'm2' },
    { n: 'firenze', from: 'm3' }, { n: 'pienza', from: 'm3' },
    { n: 'lucca', from: 'w2' },
    { n: 'modena', from: 'w3' }, { n: 'volterra', from: 'w4' },
    { n: 'grosseto', from: 'w5' }, { n: 'orvieto', from: 'w6' },
    { n: 'arezzo', from: 'w7' }, { n: 'ferrara', from: 'w8' },
  ];
  const deadEnds = DEADENDS.map(({ n, from }) => {
    const [x, z] = P[n];
    const h = headingBetween(from, n);
    const fx = Math.sin(h), fz = Math.cos(h);
    const bx = x - fx * 3.5, bz = z - fz * 3.5; // Barriere vor dem Strassenende
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
    return { name: n, x, z, from };
  });

  // --- Zypressen-und-Baum-Wald: dichtes Gestruez zufaellig ueber die Huegel,
  // aber 9 m Abstand zu jeder Strasse. Wer abseits abkuerzt, kollidiert
  // staendig mit den dunklen Gestalten - gruesst von Francesco.
  const cypressMat = new THREE.MeshStandardMaterial({ color: 0x152a1c, roughness: 1 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2b2116, roughness: 1 });
  function addTree(x, z) {
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
    tree.position.set(x, hill(x, z), z); // auf dem Huegel, nicht drin
    group.add(tree);
    colliders.push({ x, z, r: 0.75 * s });
  }
  function inBounds(x, z) { return Math.abs(x) < half - 14 && Math.abs(z) < half - 14; }
  {
    let placed = 0;
    for (let tries = 0; tries < 2400 && placed < 440; tries++) {
      const x = (rand() * 2 - 1) * (half - 20);
      const z = (rand() * 2 - 1) * (half - 20);
      if (!inBounds(x, z) || distToRoads(x, z) < 9) continue;
      addTree(x, z);
      placed++;
    }
    // Wald-Grueppchen hinter den Sackgassen-Barrieren: Die Strasse endet im
    // Dunkeln zwischen dunklen Gestalten (in Anfahrtsrichtung weiter).
    for (const d of deadEnds) {
      const h = headingBetween(d.from, d.name);
      const fx = Math.sin(h), fz = Math.cos(h);
      for (let k = 0; k < 5; k++) {
        const t = 5 + rand() * 8;
        const ox = (rand() * 2 - 1) * 6;
        const tx = d.x + fx * t - fz * ox;
        const tz = d.z + fz * t + fx * ox;
        if (distToRoads(tx, tz) >= 6 && inBounds(tx, tz)) addTree(tx, tz);
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
  // Kolosseum dahinter - das einzige leuchtende Ziel der Nacht (derweil
  // Nebel es frueh verschluckt). Der Platz ist im hill()-Gelaende bewusst
  // rundum abgeflacht.
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a7f6e, roughness: 0.9 });
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x2a2013, emissive: 0xff9d4a, emissiveIntensity: 0.9, roughness: 0.8 });
  {
    const [rx, rz] = P.rome;
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

    // Kolosseum, stilisiert: zwei Ringwaende mit leuchtenden "Fenstern" am
    // Nordrand des Platzes (nahe genug, um im abgeflachten Gelaende zu stehen)
    const colR = 10;
    const colZ = rz - 20;
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
    for (let i = 0; i < 6; i++) { // grobe Kollisionsscheiben fuer den Ring
      const a = (i / 6) * Math.PI * 2;
      colliders.push({ x: rx + Math.sin(a) * (colR - 1.5), z: colZ + Math.cos(a) * (colR - 1.5), r: 2.5 });
    }
  }

  // --- Wegpunkte (Fortschritt) auf der korrekten Route: jeweils die Mitte
  // der richtigen Abzweigung - so zaehlt der Balken nur, wenn Hans wirklich
  // richtig abbiegt. Reihenfolge ist monoton (Ueberspringen erlaubt).
  const mid = (a, b) => ({ x: (P[a][0] + P[b][0]) / 2, z: (P[a][1] + P[b][1]) / 2 });
  const waypoints = [
    { ...mid('f1', 'w1'), label: 'Erste Gabel: links nach ROMA!' },
    { ...mid('w1', 'w2'), label: 'Serpentine geschafft – Rom rückt näher!' },
    { ...mid('w2', 'w3'), label: 'Kurve 3 – der Espresso-Horner wird öfter!' },
    { ...mid('w3', 'w4'), label: 'Halbzeit auf kurvigem Pfad!' },
    { ...mid('w4', 'w5'), label: 'Fuenf Gabeln ueberlebt!' },
    { ...mid('w5', 'w6'), label: 'Noch drei Kurven bis zum Tor!' },
    { ...mid('w6', 'w7'), label: 'Zwei Gabeln noch – Espresso-Luft!' },
    { ...mid('w7', 'w8'), label: 'Letzte Serpentine vor Rom!' },
    { x: P.gate[0], z: P.gate[1], label: 'Da: das ROMA-Stadttor!' },
  ];

  // --- Spawn: auf der Startstrasse, Blick nach Norden (zur ersten Gabel).
  const spawn = { x: P.start[0], z: P.start[1] - 10, heading: headingBetween('start', 'f1') };

  // --- Wegenetz fuer den naechtlichen Verkehr (NetworkTraffic in
  // roadtraffic.js): ALLE Strassen, BEIDE Richtungen, zufaellige Abbieger.
  // Die Kante gate->rome bleibt dem Verkehr erspart - der Platz vor dem
  // Kolosseum ist Hans' grosse Buehne, die Autos verschwinden am Stadttor.
  const networkEdges = ROADS
    .filter(([a, b]) => !(a === 'gate' && b === 'rome'))
    .map(([from, to]) => ({ from, to }));

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
    roadNetwork: { nodes: P, edges: networkEdges },
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
