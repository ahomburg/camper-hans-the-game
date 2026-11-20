// ---------------------------------------------------------------------------
// Tank & Tankstelle: Der Van saeuft Lehr fuer Lehr.
//
// Jedes Fahrzeug hat einen EIGENEN 80-L-Tank, der ueber Kapitel und Sitzungen
// gespeichert wird (localStorage, siehe loadFuelLevels/saveFuelLevels): Wer
// ein Kapitel beendet, startet das naechste mit dem Restbestand - getankt
// wird am Tankstopp, nicht beim Kapitelwechsel. Der Tank leert sich mit der
// Zeit - auch im Stand (Standgas), aber richtig durstig wird der Van erst
// bei Tempo. Faehrt der Tank auf Reserve, leuchtet die Tankanzeige rot;
// laeuft er ganz leer, stirbt der Motor (kein Gas mehr) und die Fahrt
// haelt an der Tankstelle:
//
//   - Volle Tankfuellung: FUEL_PRICE Muenzen aus Hans' Reisekasse.
//   - Ohne Geld in der Kasse? Zum Glueck hat Hans einen Freund: Wolfsgang
//     springt ein und uebernimmt die Rechnung (Hans zahlt dann nichts).
// ---------------------------------------------------------------------------

const FUEL_KEY = 'camperHansTank'; // localStorage: { "<fahrzeug-id>": Liter }

// Fuellstaende pro Fahrzeug laden (ids = Liste der Fahrzeug-IDs, siehe
// VEHICLES in main.js). Ungespeicherte oder ungueltige Werte gelten als
// Volltank - ein frisches Spiel startet mit vollen Tanks. Private Mode
// ohne localStorage liefert genauso Volle Tanks (nur ohne Persistenz).
export function loadFuelLevels(ids) {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(FUEL_KEY)) || {}; } catch { /* s.o. */ }
  const levels = {};
  for (const id of ids) {
    const v = parseFloat(stored[id]);
    levels[id] = Number.isFinite(v) && v >= 0 && v <= TANK_MAX ? v : TANK_MAX;
  }
  return levels;
}

// Fuellstaende speichern: levels = { "<fahrzeug-id>": Liter, ... }
export function saveFuelLevels(levels) {
  try { localStorage.setItem(FUEL_KEY, JSON.stringify(levels)); } catch { /* Private Mode o. ae. */ }
}

export const TANK_MAX = 80;    // Fassung in Litern (Voll = 80 L)
export const FUEL_PRICE = 25; // Muenzen pro voller Tankfuellung
export const LOW_FUEL = 0.25; // ab diesem Fuellstand gilt: Reserve

// Verbrauch in Litern pro Sekunde: Standgas plus anteilig zur Geschwindigkeit
// (skaliert linear bis 120 km/h). Gemuetliches Cruisen (~60 km/h) traegt den
// 80-L-Tanker rund zwei Minuten - ein 5-Runden-Kapitel orgelt also einmal
// an die Reserve, Vollgas-Fahrer tanken oefter. Ab dem letzten Viertel
// leuchtet die Reserve-Leuchte, ganz leer stoppt die Fahrt an der Tanke.
export const IDLE_BURN = 0.3; // Liter/s Standgas (wartend vor dem Arc)
export const FULL_BURN = 0.6; // zusaetzliche Liter/s bei 120 km/h

export class Tank {
  constructor(capacity = TANK_MAX) {
    this.capacity = capacity;
    this.level = capacity;
    this.onEmpty = null; // Callback, wenn der Tank von > 0 auf 0 faellt
  }

  fill() {
    this.level = this.capacity;
  }

  get fraction() { return this.level / this.capacity; }
  get empty() { return this.level <= 0; }
  get low() { return !this.empty && this.fraction <= LOW_FUEL; }

  // Verbrauch fuer einen Frame. car liefert die aktuelle Geschwindigkeit
  // (m/s, wie ueblich in der Simulation).
  update(dt, car) {
    if (this.empty) return;
    const kmh = Math.abs(car.speed) * 3.6;
    this.level = Math.max(0, this.level - dt * (IDLE_BURN + (kmh / 120) * FULL_BURN));
    if (this.empty && this.onEmpty) this.onEmpty();
  }
}
