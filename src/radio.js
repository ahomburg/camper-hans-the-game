// ---------------------------------------------------------------------------
// Hans' Autoradio: Zwei Sender (Camping-Hop & Schlager), per Taste M oder
// Klick aufs HUD-Sticker umzuschalten. Der Radio-Knopf haelt sich im Zyklus
//   aus -> Sender 1 -> Sender 2 -> aus
// Der zuletzt gewaehlte Sender bleibt ueber Sitzungen gespeichert (localStorage)
// - ob das Radio an ist, bewusst nicht: Nach einem Reload soll es still sein.
//
// Die Musik pausiert ausserhalb des Spiels (Menue, Erfolg, Scheitern) und
// laeuft beim naechsten Kapitel an derselben Stelle weiter, wenn der
// Radioknopf noch auf "an" steht (pauseForMetaScreens/resumeForGameplay).
// ---------------------------------------------------------------------------

const SOUND_DIR = 'assets/sound/';
const STATION_KEY = 'camperHansRadioStation';

export const STATIONS = [
  { key: 'hiphop', name: 'Camping-Hop 🎧', file: SOUND_DIR + 'Camper_Hans_Hiphop.mp3' },
  { key: 'schlager', name: 'Schlager-Radio 🪕', file: SOUND_DIR + 'Camper_Hans_Schlager.mp3' },
];
const VOLUME = 0.55;

function storedStationIndex() {
  try {
    const key = localStorage.getItem(STATION_KEY);
    const i = STATIONS.findIndex((s) => s.key === key);
    if (i >= 0) return i;
  } catch { /* Private Mode o. ae.: Standard-Sender */ }
  return 0;
}

export class Radio {
  constructor() {
    this.index = storedStationIndex(); // Reglerstellung: gewaehlter Sender
    this.on = false;                   // Knopfstellung: Radio an/aus
    this.onChange = null;              // Callback mit (station | null)
    if (typeof Audio === 'undefined') return; // uralte Software: Radio bleibt stumm
    for (const s of STATIONS) {
      s.el = new Audio(s.file);
      s.el.loop = true;
      s.el.preload = 'auto';
      s.el.volume = VOLUME;
    }
  }

  get station() { return this.on ? STATIONS[this.index] : null; }

  // Knopfdruck: aus -> Sender 1 -> Sender 2 -> aus. Beim Einschalten laeuft
  // der gespeicherte (bzw. zuletzt gewaehlte) Sender los. Gibt die neue
  // Einstellung zurueck (station | null, null = aus).
  cycle() {
    if (!this.on) {
      this.on = true;
    } else if (this.index >= STATIONS.length - 1) {
      this.on = false;
    } else {
      this.index += 1;
    }
    this.persist();
    this.apply();
    if (this.onChange) this.onChange(this.station);
    return this.station;
  }

  // Nur den laufenden Sender weiterspielen, alle anderen anhalten.
  apply() {
    for (const s of STATIONS) {
      if (!s.el) continue;
      if (this.on && s === STATIONS[this.index]) {
        const p = s.el.play();
        if (p && p.catch) p.catch(() => { /* Autoplay verweigert: naechster Knopfdruck versucht es erneut */ });
      } else {
        s.el.pause();
      }
    }
  }

  // Kapitel vorbei / zurueck ins Menue: Musik anhalten, Knopfstellung merken.
  pauseForMetaScreens() {
    for (const s of STATIONS) { if (s.el) s.el.pause(); }
  }

  // Neues Kapitel: weiterlaufen lassen, wenn das Radio noch angeschaltet ist.
  resumeForGameplay() {
    this.apply();
  }

  persist() {
    try { localStorage.setItem(STATION_KEY, STATIONS[this.index].key); } catch { /* s.o. */ }
  }
}
