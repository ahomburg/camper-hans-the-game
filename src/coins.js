// ---------------------------------------------------------------------------
// Hans' Reisekasse: das Muenz-System.
//
// Verdienen:
//   +20  pro volle Runde um den Arc de Triomphe (Rundenpraemie)
//   +100 Quest abgeschlossen (Questbonus)
//   +5   Schnell und knapp an einem Verkehrswagen vorbei (Ueberhol-Reaktion)
//   +5   Tempo-Bonus: je 100 m Strecke mit >= 85 km/h (siehe main.js)
//
// Zahlen:
//   Crash gegen ein anderes Objekt (Verkehrswagen, Baum, Bordstein,
//   Welt-Grenze ...) kostet Muenzen, skaliert nach der Harte des Aufpralls
//   (Annaeherungsgeschwindigkeit entlang der Stossnormalen). Wer nur sanft
//   streift, zahlt Lackschaden-Pauschale; wer mit Vollgas drauffaehrt,
//   zahlt bis zu 45 Muenzen. Die Kasse kann nie unter 0 fallen.
//
// Die Kasse bleibt über Sitzungen gespeichert (localStorage).
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'camperHansCoins';

// Reparaturkosten nach Crash-Härte. closing = Annäherungsgeschwindigkeit
// in m/s entlang der Stossnormalen (0 =<Contact, max ~30 m/s bei Frontal).
// Strenger Massstab: Der Verkehr passt sein Tempo automatisch an, Crashs
// sind fast immer Hans' eigene Schuld - dafuer gibt es fuer schnelles
// Fahren und knappe Ueberholer genug Einnahmen, um sie zu verkraften.
export function crashPenalty(closing) {
  if (closing < 1.5) return { coins: 2, tier: 'Lackschaden' };
  const coins = Math.min(45, 4 + Math.round(closing * 1.6));
  if (closing >= 16) return { coins, tier: 'TOTALSCHADEN!' };
  if (closing >= 8) return { coins, tier: 'Crash!' };
  return { coins, tier: 'Blechschaden' };
}

export class Wallet {
  constructor() {
    this._handlers = {};
    this.amount = this.load();
  }

  load() {
    try {
      const v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    } catch {
      return 0; // Private Mode o. ae.: nur keine Persistenz, spielen geht
    }
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, String(this.amount)); } catch { /* s.o. */ }
  }

  // Gutschrift (n > 0). Gibt den neuen Stand zurueck.
  add(n) {
    this.amount += n;
    this.save();
    this.emit(n);
    return this.amount;
  }

  // Abbuchlung (n > 0, Tillstandung bei 0 - die Kasse geht nie ins Minus).
  // Gibt { paid, amount } zurueck: paid = tatsaechlich abgezogene Muenzen.
  deduct(n) {
    const paid = Math.min(n, this.amount);
    this.amount -= paid;
    this.save();
    if (paid > 0) this.emit(-paid);
    return { paid, amount: this.amount };
  }

  on(cb) {
    this._handlers.change ||= [];
    this._handlers.change.push(cb);
  }

  emit(delta) {
    for (const cb of this._handlers.change || []) cb(delta, this.amount);
  }
}
