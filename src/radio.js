// ---------------------------------------------------------------------------
// Hans' Autoradio: Drei Senderspeicher, und zwar:
//   1 = REGIONALSENDER - er bringt die Landesmusik des Kapitels:
//       Paris/Standard: "Le Roi du Camping" (song_camper_hans_francais),
//       Nachtfahrt nach Rom: "Radio Italia" (song_camper_hans_italiano).
//       main.js stellt beim Kapitel-Start per setRegion() um.
//   2 = Camping-Hop
//   3 = Schlager-Radio
// Die Blende im HUD (siehe index.html) hat getrennte Schalter:
//   "⏻" = ein/aus (auch Taste M) - das EINSCHALTEN dreht IMMER auf
//         Sender 1, den Regionalsender (wie im echten Auto der
//         Lieblingssender-Taste)
//   1..3 = Senderspeichertasten, waehlen den Sender (und schalten ein)
// Der zuletzt gewaehlte Sender bleibt ueber Sitzungen gespeichert
// (localStorage) - ob das Radio an ist, bewusst nicht: Nach einem Reload
// soll es still sein.
//
// Die Musik pausiert ausserhalb des Spiels (Menue, Erfolg, Scheitern) und
// laeuft beim naechsten Kapitel an derselben Stelle weiter (siehe
// pauseForMetaScreens/resumeForGameplay).
// ---------------------------------------------------------------------------

const SOUND_DIR = 'assets/sound/';
const STATION_KEY = 'camperHansRadioStation';

// Die regionalen Ausgaben von Sender 1: Datei, Name und Sendernetikett
// wechseln mit der Region, der Sendeplatz bleibt Taste 1 (key 'regional').
const REGIONAL_VARIANTS = {
  francais: {
    name: 'Le Roi du Camping 👑', display: 'FM 101.2 · LE ROI',
    file: SOUND_DIR + 'song_camper_hans_francais.mp3',
  },
  italiano: {
    name: 'Radio Italia 🍝', display: 'FM 105.0 · RADIO ITALIA',
    file: SOUND_DIR + 'song_camper_hans_italiano.mp3',
  },
};

export const STATIONS = [
  // Sender 1: REGIONALSENDER - Startausgabe ist Frankreich, kapitelweise per
  // Radio.setRegion() umgestellt (Kapitel 3 "Nachts nach Rom" -> italiano).
  { key: 'regional', ...REGIONAL_VARIANTS.francais },
  { key: 'hiphop', name: 'Camping-Hop 🎧', display: 'FM 93.7 · CAMPING-HOP', file: SOUND_DIR + 'Camper_Hans_Hiphop.mp3' },
  { key: 'schlager', name: 'Schlager-Radio 🪕', display: 'FM 105.5 · SCHLAGER', file: SOUND_DIR + 'Camper_Hans_Schlager.mp3' },
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

  // Regionalsender (Taste 1) auf die Landesmusik des Kapitels drehen:
  // 'italiano' in Kapitel 3 (Nachts nach Rom), 'francais' sonst. Tauscht
  // nur Name/Etikett/Datei von STATIONS[0] - der Sendeplatz bleibt Taste 1.
  setRegion(key) {
    if (!REGIONAL_VARIANTS[key]) key = 'francais';
    const s = STATIONS[0];
    const v = REGIONAL_VARIANTS[key];
    s.name = v.name;
    s.display = v.display;
    if (s.file !== v.file) {
      s.file = v.file;
      // Bereits erzeugtes Audio-Element auf die neue Datei zeigen; geladen
      // wird sie beim naechsten play() (das Radio laeuft beim Kapitelstart
      // eh noch still).
      if (s.el) s.el.src = v.file;
    }
    if (this.onChange) this.onChange(this.station);
  }

  // Ein-/Ausschalten ohne den Sender zu wechseln (Schalter "⏻" oder Taste M).
  // Beim Einschalten laeuft der gespeicherte bzw. per tune() gewaehlte Sender.
  powerToggle() {
    this.on = !this.on;
    this.apply();
    if (this.onChange) this.onChange(this.station);
    return this.station;
  }

  // Sendertaste: direkt auf diesen Sender drehen und Radio einschalten
  // (auch wenn es aus war - wie die Senderspeichertasten im echten Autoradio).
  select(key) {
    const i = STATIONS.findIndex((s) => s.key === key);
    if (i < 0) return null;
    this.index = i;
    this.on = true;
    this.persist();
    this.apply();
    if (this.onChange) this.onChange(this.station);
    return this.station;
  }

  // Direkt auf einen Sender drehen (ohne an/aus zu schalten): main.js ruft
  // tune('regional'), bevor das Radio eingeschaltet wird - das Einschalten
  // startet damit IMMER mit Sender 1, der Landesmusik der Region.
  tune(key) {
    const i = STATIONS.findIndex((s) => s.key === key);
    if (i < 0) return;
    this.index = i;
    this.persist();
    this.apply();
    if (this.onChange) this.onChange(this.station);
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
