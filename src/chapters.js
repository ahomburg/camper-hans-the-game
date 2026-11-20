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

// Kapitel 2: Temposuender – erreichte Hoechstgeschwindigkeit in km/h.
export function createSpeedChapter({ target = 100 } = {}) {
  const state = { max: 0 };
  return new Chapter({
    id: 'temposuender',
    title: 'Kapitel 2: Temposünder',
    desc: `Erreiche ${target} km/h.`,
    story: `<p>„Heute”, verkündet Liesel und klammert sich ans Armaturenbrett, „will ich Autobahn-Wind in den Haaren! Mindestens ${target} km/h, Hans – sonst ist das kein Rums, sondern Gemüsefahren!”</p>
      <p>Hans grinst und knipst die Zündung an: „Anschnallen, mein Schatz. Wir hängen die Wohnwagen-Rallye einfach ab.”</p>`,
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
    },
    onReset() {
      state.max = 0;
    },
  });
}
