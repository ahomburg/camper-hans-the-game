// Quest-System: QuestManager verwaltet eine Liste von Quests (weitere koennen
// einfach per add() ergaenzt werden). Quest 1 zaehlt Runden um den Arc de Triomphe.

export class Quest {
  constructor({ id, title, desc, target, extra = null, update, onCarReset = null, onReset = null }) {
    this.id = id;
    this.title = title;
    this.desc = desc;
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

  // Quest fuer einen neuen Durchlauf zuruecksetzen (Fortschritt + interner Zustand)
  reset() {
    this.progress = 0;
    this.completed = false;
    if (this._onReset) this._onReset();
  }
}

export class QuestManager {
  constructor() {
    this.quests = [];
    this._handlers = {};
  }

  add(quest) {
    this.quests.push(quest);
    return quest;
  }

  on(event, cb) {
    (this._handlers[event] ||= []).push(cb);
  }

  emit(event, quest) {
    for (const cb of this._handlers[event] || []) cb(quest);
  }

  update(dt, ctx) {
    for (const q of this.quests) q.update(dt, ctx, this);
  }

  notifyCarReset() {
    for (const q of this.quests) q.onCarReset();
  }
}

// Runden zaehlen per Sektor-Sprung: der Kreis um den Arc wird in 12 Sektoren
// geteilt; ein Sprung in den naechsten Sektor (gegen Uhrzeigersinn) gibt einen
// Punkt, ein Sektor zurueck zieht einen ab. So zaehlen Donuts im Kreisverkehr
// nicht als Runde.
const SECTORS = 12;
const SECTOR_W = (Math.PI * 2) / SECTORS;

export function createArcLapQuest(arc, traffic, { target = 10, startTraffic = 10 } = {}) {
  const state = { acc: 0, prevSector: null };

  const quest = new Quest({
    id: 'arc-de-triomphe',
    title: 'Quest 1: Arc de Triomphe',
    desc: `Fahre ${target} Runden um den Arc de Triomphe – mit dem Verkehr gegen den Uhrzeigersinn.`,
    target,
    extra: () => `Verkehr: ${traffic.count} Autos (Start ${startTraffic}, +5 pro Runde)`,
    update(dt, ctx, mgr, q) {
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
        q.progress++;
        mgr.emit('progress', q);
        if (q.progress >= q.target) {
          q.completed = true;
          mgr.emit('completed', q);
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

  return quest;
}

// Quest 2: Hupkonzert – der Spieler hupt mit H (ctx.honkCount zaehlt mit).
export function createHonkQuest({ target = 10 } = {}) {
  return new Quest({
    id: 'hupkonzert',
    title: 'Quest 2: Hupkonzert',
    desc: `Hupe ${target} mal mit der Taste H (LKW-Hupe).`,
    target,
    update(dt, ctx, mgr, q) {
      const n = Math.min(q.target, ctx.honkCount || 0);
      if (n > q.progress) {
        q.progress = n;
        mgr.emit('progress', q);
        if (q.progress >= q.target) {
          q.completed = true;
          mgr.emit('completed', q);
        }
      }
    },
  });
}

// Quest 3: Temposuender – erreichte Hoechstgeschwindigkeit in km/h.
export function createSpeedQuest({ target = 100 } = {}) {
  const state = { max: 0 };
  return new Quest({
    id: 'temposuender',
    title: 'Quest 3: Temposünder',
    desc: `Erreiche ${target} km/h mit dem Campervan.`,
    target,
    extra: () => `Top: ${Math.floor(state.max * 3.6)} km/h`,
    update(dt, ctx, mgr, q) {
      const kmh = Math.abs(ctx.car.speed) * 3.6;
      if (kmh > state.max) state.max = kmh;
      const p = Math.min(q.target, Math.floor(state.max));
      if (p > q.progress) {
        q.progress = p;
        mgr.emit('progress', q);
        if (q.progress >= q.target) {
          q.completed = true;
          mgr.emit('completed', q);
        }
      }
    },
    onReset() {
      state.max = 0;
    },
  });
}
