// Kapitel-System: ChapterManager verwaltet eine Liste von Kapiteln (weitere
// koennen einfach per add() ergaenzt werden). Kapitel 1 zaehlt Runden um den
// Arc de Triomphe. Der Name lehnt sich ans Buch: Jede Aufgabe ist ein Kapitel.

export class Chapter {
  constructor({ id, title, desc, story = '', target, extra = null, update, onCarReset = null, onReset = null }) {
    this.id = id;
    this.title = title;
    this.desc = desc;
    this.story = story; // liebevoll-lustige Missionstexte fuer die rechte Buchseite (Missionszettel)
    this.target = target;
    this.extra = extra; // optionale Zusatzzeile im HUD, z.B. () => `Verkehr: ${n}`
    this.progress = 0;
    this.completed = false;
    this._update = update;
    this._onCarReset = onCarReset;
    this._onReset = onReset;
  }

  update(dt, ctx, mgr) {
    if (!this.completed) this._update(dt, ctx, mgr, this);
  }

  onCarReset() {
    if (this._onCarReset) this._onCarReset();
  }

  // Kapitel fuer einen neuen Durchlauf zuruecksetzen (Fortschritt + interner Zustand)
  reset() {
    this.progress = 0;
    this.completed = false;
    if (this._onReset) this._onReset();
  }
}

export class ChapterManager {
  constructor() {
    this.chapters = [];
    this._handlers = {};
  }

  add(chapter) {
    this.chapters.push(chapter);
    return chapter;
  }

  on(event, cb) {
    (this._handlers[event] ||= []).push(cb);
  }

  emit(event, chapter) {
    for (const cb of this._handlers[event] || []) cb(chapter);
  }

  update(dt, ctx) {
    for (const c of this.chapters) c.update(dt, ctx, this);
  }

  notifyCarReset() {
    for (const c of this.chapters) c.onCarReset();
  }
}

// Runden zaehlen per Sektor-Sprung: der Kreis um den Arc wird in 12 Sektoren
// geteilt; ein Sprung in den naechsten Sektor (gegen Uhrzeigersinn) gibt einen
// Punkt, ein Sektor zurueck zieht einen ab. So zaehlen Donuts im Kreisverkehr
// nicht als Runde.
const SECTORS = 12;
const SECTOR_W = (Math.PI * 2) / SECTORS;

export function createArcLapChapter(arc, traffic, { target = 10, startTraffic = 10 } = {}) {
  const state = { acc: 0, prevSector: null };

  const chapter = new Chapter({
    id: 'arc-de-triomphe',
    title: 'Kapitel 1: Arc de Triomphe',
    desc: `Fahre ${target} Runden um den Arc de Triomphe`,
    story: `<p>„Haaach Hans”, seufzt Liesel zum dreihundertsten Mal, „ich wollte schon immer mal nach Paris! Aber nicht im Ausflugsbus mit Pauschalbrot – wir umrunden den Arc de Triomphe wie die echten Pariser!”</p>
      <p>Hans schiebt die Sonnenbrille hoch und tätschelt das Armaturenbrett: „Zehn Runden im Kreisverkehr, Schatz. Croissants auf den Rücksitz, der Blinker geht gratis dazu.”</p>`,
    target,
    extra: () => `Verkehr: ${traffic.count} Autos (Start ${startTraffic}, +5 pro Runde)`,
    update(dt, ctx, mgr, c) {
      const { car } = ctx;
      const dx = car.pos.x - arc.cx;
      const dz = car.pos.z - arc.cz;
      const r = Math.hypot(dx, dz);
      const ang = Math.atan2(dx, dz);
      const sector = ((Math.floor(ang / SECTOR_W) % SECTORS) + SECTORS) % SECTORS;

      const inRing = r > arc.rInner - 6 && r < arc.rOuter + 6;
      if (!inRing) {
        // Ausserhalb des Kreisverkehrs: Fortschritt langsam abbauen
        state.acc -= state.acc * Math.min(1, 1.5 * dt);
        state.prevSector = sector;
        return;
      }
      if (state.prevSector === null) {
        state.prevSector = sector;
        return;
      }

      let diff = sector - state.prevSector;
      if (diff > SECTORS / 2) diff -= SECTORS;
      if (diff < -SECTORS / 2) diff += SECTORS;
      state.prevSector = sector;

      if (diff === 1) state.acc += 1;
      else if (diff === -1) state.acc -= 1;

      if (state.acc >= SECTORS) {
        state.acc = 0;
        c.progress++;
        mgr.emit('progress', c);
        if (c.progress >= c.target) {
          c.completed = true;
          mgr.emit('completed', c);
        }
      } else if (state.acc <= -SECTORS) {
        state.acc = 0; // volle Runde in die falsche Richtung
      }
    },
    onCarReset() {
      // Teleport nach Spawn: weder Sektor-Sprung noch angefangene Runde werten
      state.prevSector = null;
      state.acc = 0;
    },
    onReset() {
      state.prevSector = null;
      state.acc = 0;
    },
  });

  return chapter;
}

// Kapitel 3: Nachts nach Rom – auf der Nacht-Map (siehe nightrome.js) muss
// Hans im Blindflug (Fahrlicht kaputt, Taschenlampe nur aus der Werkstatt) den
// richtigen Weg durch ein Wegenetz voller Abzweigungen finden. Fortschritt:
// Wegpunkte auf der korrekten Route (Hälfte jeder richtigen Abzweigung);
// wer falsch abbiegt, landet in einer Sackgasse (Toast, siehe 'deadend').
// Geschafft ist das Kapitel, sobald Hans den erleuchteten Platz von Rom
// erreicht. Die Map liegt in ctx.map, und ctx.flashlight verrät, ob die
// Taschenlampe gekauft ist (main.js reicht es im update-ctx durch).

export function createRomeNightChapter({ target = 10, wpRadius = 14, romeRadius = 15, deadendRadius = 12 } = {}) {
  const state = { wpIdx: 0, deadSeen: new Set(), synced: false };
  return new Chapter({
    id: 'romnacht',
    title: 'Kapitel 3: Nachts nach Rom',
    desc: 'Stockdunkle Serpentinen durchs Hügelland: Finde den Weg nach Rom – das Fahrlicht ist kaputt!',
    story: `<p>„Hans!” flüstert Liesel um drei Uhr nachts, „wacht endlich auf! Der Espresso in Rom wartet nicht – aber mach zuerst das Licht an!”</p>
      <p>Hans klickt. Klickt nochmal. Nichts. „Ähem … das Licht ist kaputt, Schatz.” – Stille. Dann, mit zusammengekniffenen Augen: „Dann kauf eine <strong>Taschenlampe</strong> in der Werkstatt – die leuchtet zwar nur ein Stueckchen, aber besser als Blindflug! Und nun: gib GAS, aber lies die Wegweiser!”</p>`,
    target,
    update(dt, ctx, mgr, c) {
      const m = ctx.map;
      const { car } = ctx;
      if (!m || !m.waypoints) return;

      // Ziel automatisch an die Map anpassen: Jeder Wegpunkt zaehlt einen
      // Punkt, die Ankunft in Rom das letzte (fuller Balken = feiernd in Rom).
      // So bleibt das Kapitel unempfindlich, wenn die Map um Gabeln waechst.
      if (!state.synced) {
        state.synced = true;
        c.target = Math.max(c.target, m.waypoints.length + 1);
      }

      // Wegpunkte: monoton weiterzaehlen (auch Ueberspringen erlaubt, wer
      // querfeldein abkuerzt, verpasst dafuer die Zwischenpunkte nicht doppelt).
      const wps = m.waypoints;
      for (let i = state.wpIdx; i < wps.length; i++) {
        if (Math.hypot(car.pos.x - wps[i].x, car.pos.z - wps[i].z) < wpRadius) {
          c.progress += i + 1 - state.wpIdx;
          state.wpIdx = i + 1;
          c._wpLabel = wps[i].label || '';
          mgr.emit('progress', c);
        }
      }

      // Sackgasse: Toast, einmal pro Sackgasse (Hans soll umkehren)
      if (m.deadEnds && car.speed !== 0) {
        for (const d of m.deadEnds) {
          if (!state.deadSeen.has(d.name) &&
              Math.hypot(car.pos.x - d.x, car.pos.z - d.z) < deadendRadius) {
            state.deadSeen.add(d.name);
            mgr.emit('deadend', c);
          }
        }
      }

      // Ziel: Rom erreicht -> Kapitel abgeschlossen
      if (m.rome && Math.hypot(car.pos.x - m.rome.x, car.pos.z - m.rome.z) < romeRadius) {
        c.progress = c.target;
        mgr.emit('progress', c);
        c.completed = true;
        mgr.emit('completed', c);
      }
    },
    onReset() {
      state.wpIdx = 0;
      state.deadSeen = new Set();
      state.synced = false; // Ziel beim naechsten Start erneut mit der Map abgleichen
    },
  });
}

// Kapitel 2: Temposuender – Ziel ist Tempo 120, aber auf der eigenen
// Huegelland-Map (siehe hills.js): eine schlaengelnde Landstrasse durch Gruen.
// Neu: Wer von der Strasse abkommt (ueber Schotter-Schulter hinaus ins Gras),
// hat das Kapitel verloren -> mgr.emit('failed'). Die Map liegt in ctx.map
// (wird von main.js beim Kapitel-Start lazy geladen und mitgegeben).

export function createSpeedChapter({ target = 120, offroadMargin = 2.5 } = {}) {
  const state = { max: 0 };
  return new Chapter({
    id: 'temposuender',
    title: 'Kapitel 2: Temposünder',
    desc: `Erreiche ${target} km/h – ohne von der Straße abzukommen!`,
    story: `<p>„Draußen auf dem Land”, ruft Liesel und kurbelt das Fenster herunter, „da kann Hans mal zeigen, was der Wagen kann! Mindestens ${target} km/h – aber bitte auf dem Asphalt bleiben, ja?”</p>
      <p>Hans nickt grimmig und lässt den Motor aufheulen: „Keine Sorge, Schatz. Die Wiese ist zum Zelten da, nicht zum Fahren. Anschnallen!”</p>`,
    target,
    extra: () => `Top: ${Math.floor(state.max * 3.6)} km/h`,
    update(dt, ctx, mgr, c) {
      const kmh = Math.abs(ctx.car.speed) * 3.6;
      if (kmh > state.max) state.max = kmh;
      const p = Math.min(c.target, Math.floor(state.max));
      if (p > c.progress) {
        c.progress = p;
        mgr.emit('progress', c);
        if (c.progress >= c.target) {
          c.completed = true;
          mgr.emit('completed', c);
        }
      }
      // Von der Strasse abgekommen? (Abstand zur Mittellinie groesser als
      // halbe Strassenbreite + Schulter) -> Kapitel gescheitert.
      const m = ctx.map;
      if (m && typeof m.distanceToRoad === 'function') {
        const d = m.distanceToRoad(ctx.car.pos.x, ctx.car.pos.z);
        if (d > m.roadHalf + offroadMargin) mgr.emit('failed', c);
      }
    },
    onReset() {
      state.max = 0;
    },
  });
}
