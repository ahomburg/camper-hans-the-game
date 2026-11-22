# Camper Hans – Testfahrt am Arc de Triomphe

Das Spiel zum Buch. [www.camper-hans.de](http://www.camper-hans.de)

Ein kleines 3D-Fahrspiel im Browser (Three.js): Camper Hans fährt durch Paris,
muss Runden um den Arc de Triomphe drehen, weicht dem Verkehr aus und hupt sich
mit der LKW-Hupe (H) durch den Kreisverkehr.

## Wie 3D-Objekte generiert werden

### Cars

1. Generieren: Tripo H3.1, Facelimit 100K, Texture-Quality: Standard
2. In Magnifica reduzieren: Edit -&gt; Simplify Stufe 2
   1. **oder besser** Remash ~25K
3. Texturen optimieren

### Optimieren mit online-Tool:

- [GLB Optimizer: Compress GLB and glTF Files in Your Browser](https://threejsresources.com/glb-optimizer)
- Meshopt
- Texture size 1024: No Convert to WebP 

### Alt: Texturen optimieren

```bash
npx @gltf-transform/cli resize car_mercedes.glb resized.glb --width 2048 --height 2048  

# Draco ist für diesen Einsatzfall nicht optimal, wir verwenden meshopt
# noch nicht getestet (AI hat mit die Modelle gewandelt)
# npx @gltf-transform/cli optimize resized.glb car_mercedes_opt.glb --compress draco --texture-compress webp
npx @gltf-transform/cli optimize car_mercedes.glb car_mercedes_meshopt.glb --texture-compress ktx2
```

## Start

```bash
node serve.mjs
# -> http://localhost:9999
```

Kein Build-Schritt nötig; statischer Server ohne Abhängigkeiten.

## Münz-System: Hans' Reisekasse

Coins verdienen und Blechschaden bezahlen – die Reisekasse steht direkt im
HUD (`src/coins.js`) und bleibt über Sitzungen gespeichert (localStorage,
Schlüssel `camperHansCoins`).

**Verdienen:**

| Aktion | Prämie |
|---|---|
| Volle Runde um den Arc de Triomphe | +20 🪙 |
| Kapitel abgeschlossen | +100 🪙 |
| Schnell knapp an einem Verkehrswagen vorbei (≥ 32 km/h, 3 s Sperre je Auto) | +5 🪙 |
| Schnell gefahrene Strecke, je 100 m ab 85 km/h („Tempo-Bonus“) | +5 🪙 |

**Zahlen:** Rammt man ein anderes Objekt (Verkehrswagen, Baum, Gebäude,
Bordstein, Welt-Grenze, abgerissener Wohnwagen), wird der Crash visualisiert
und es fallen Reparaturkosten an. Die Härte bemisst sich nach der
Annäherungsgeschwindigkeit entlang der Stoßnormalen (`crashPenalty()` in
`src/coins.js`):

| Closing-Speed | Kategorie | Kosten |
|---|---|---|
| unter 1,5 m/s (Streifen) | Lackschaden | 2 🪙 |
| 3 m/s | Blechschaden | 9 🪙 |
| 8 m/s | Crash! | 17 🪙 |
| 16 m/s | C'est la cata! | 30 🪙 |
| Frontal (30 m/s) | C'est la cata! | max. 45 🪙 |

**Italienische Manieren (nur Kapitel 3)**: In der Nacht nach Rom wird die
Crash-Kategorie freundlich-italienisch gerufen – ein Knall gehört halt zum
süßen Leben: *Un graffio, no problema!* (Lackschaden) · *Ahi ahi, ammacchi!*
(Blechschaden) · *Mamma mia!* (Crash!) · **Che disastro! Che spettacolo!**
(C'est la cata). Kosten und System bleiben unverändert (`crashTierLabel` in
`src/main.js`).

Die Kasse geht nie unter 0. Das Scheitern eines Kapitels kostet keine Münzen –
auch der Kupplungsabriss des Wohnwagens wird nicht zusätzlich berechnet
(de facto zahlt man nur für Crashs, die man selbst fährt). Der Verkehr fährt
Hans nicht hinten auf: Verkehrsautos bremsen automatisch – hinter Hans gilt
ein Folgegesetz (`Traffic.playerSpeedCap` in `src/traffic.js`, Zieltempo =
Spielertempo + (Abstand − 8,5 m) × 0,9), das kontaktfrei auf ~8,5 m Abstand
konvergiert und danach wieder auf Regeltempo beschleunigt. Wer trotzdem
crashen will, muss selbst lenken oder bremsen.

**Crash-Visualisierung** (`src/crashfx.js`, `src/audio.js`, `index.html`):
Funken- und Trümmer-Partikel am Aufprallpunkt, Kamera-Wackeln, roter
Rand-Blitz, Handschrift-Banner („💥 Blechschaden −14 🪙“), Crash-Sound
(WebAudio: Blech-Rauschen + dumpfer Aufprall) und ein Coin-Popup an der
Reisekasse. Mehrfach-Treffer im selben Aufprall werden zusammengefasst.

## Tank, Tankstelle & Wolfsgang

Der Tank gehört zum **Fahrzeug**, nicht zum Kapitel: Gespann und Campervan
haben je einen eigenen 80-Liter-Tank (`src/fuel.js`), der über Kapitel und
Sitzungen gespeichert wird (localStorage, Schlüssel `camperHansTank`).
Wer ein Kapitel beendet, startet das nächste mit dem Restbestand –
Vollgetankt wird nur am Tankstopp.

Die Tankuhr im HUD (SVG-Sticker neben dem Tacho) leert sich mit der Zeit –
auch im Stand (Standgas 0,3 l/s), richtig durstig wird der Van bei Tempo (bis
+0,6 l/s bei 120 km/h). Gemütliches Cruisen mit ~60 km/h trägt rund zwei
Minuten. Als Fortschrittsbalken steht die Tankfüllung auch im Startmenü auf
der Fahrzeug-Kachel und in der Werkstatt auf jeder Fahrzeugkarte.

| Meldung | Bedeutung |
|---|---|
| Reserve-Leuchte rot + blinkende Uhr (ab 20 L), Balken wird rot | „Der Tank läuft auf Reserve, Hans!" |
| Tank leer | Motor stirbt hörbar (`engineSputter`), Gas ist weg, Van rollt aus |
| Van steht | Tankstopp pausiert die Fahrt (auch der Kapitel-Timer) |
| Kapitel mit leerem Tank gestartet | Tankstopp öffnet nach der Kamerafahrt |

Wer am Tankstopp zahlt, entscheidet die Reisekasse:

- **Reisekasse reicht:** Volle Tankfüllung kostet **25 🪙** (`FUEL_PRICE`).
- **Reisekasse leer:** Hans' Freund **Wolfsgang** springt ein und übernimmt
  die Rechnung – Hans zahlt nichts. Wolfsgang legt still ein Schäfchen
  darauf, wie oft das schon nötig war (localStorage, Schlüssel
  `camperHansWolfsgang`).

Tankkosten fließen in die Fahrtbilanz (Erfolgs-/Scheitern-Screen,
Aufschlüsselung „davon Benzin"). Wer nicht tanken will, kann am Tankstopp
auch das Kapitel abbrechen.

## Docker

```bash
docker build -t camper-hans-the-game .
docker run -d --name camper-hans -p 9999:9999 camper-hans-the-game
# -> http://localhost:9999
```

Port über `-p <Host-Port>:9999` frei wählbar.

### Auf einem beliebigen Docker-Server hosten

Das Image ist ein normales OCI-Image und läuft auf jedem Docker-Host
(Linux x86_64/arm64, Docker Engine oder kompatibel wie Podman, Kubernetes, Portainer etc.).

**Variante A – Image über eine Registry verteilen (empfohlen für Server):**

```bash
# lokal bauen und in eine Registry pushen, z. B. Docker Hub oder eine private Registry
docker build -t <registry>/<user>/camper-hans-the-game:latest .
docker push <registry>/<user>/camper-hans-the-game:latest

# auf dem Docker-Server nur noch pullen und starten
docker pull <registry>/<user>/camper-hans-the-game:latest
docker run -d --name camper-hans \
  -p 9999:9999 \
  --restart unless-stopped \
  <registry>/<user>/camper-hans-the-game:latest
# -> http://<server-ip>:9999
```

**Variante B – Projekt direkt auf dem Server bauen:**

```bash
# Repo auf den Server klonen (oder per scp/rsync kopieren) und dort bauen
git clone <repo-url> && cd camper-hans-the-game
docker build -t camper-hans-the-game .
docker run -d --name camper-hans -p 9999:9999 --restart unless-stopped camper-hans-the-game
```

**Hinweise:**

- `-p 9999:9999` veröffentlicht den Port auf dem Host; mit `-p 80:9999` läuft
das Spiel auf dem Standard-HTTP-Port.
- `--restart unless-stopped` startet den Container nach einem Server-Neustart
automatisch neu.
- Für HTTPS/Port 80 ohne Portangabe: Reverse Proxy (z. B. nginx, Traefik,
Caddy) davor schalten, der auf `localhost:9999` weiterleitet.
- Das Image hat keine Volumes; Highscores liegen im Browser-localStorage,
es gehen also keine Daten verloren.
- Ressourcen sind gering (statischer Server, ~150 MB Image); ein kleines
VPS reicht völlig.

## Steuerung


| Taste                          | Funktion                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------- |
| Pfeiltasten / WASD             | Fahren (Gas, Bremsen/Rückwärts, Lenken)                                      |
| LINKS / RECHTS im Kreisverkehr | Spur wechseln (Sobald der Van den Kreis erreicht hat, bleibt er in der Spur) |
| H                              | LKW-Hupe (campervan\_horn.mp3)                                               |
| R                              | Zurücksetzen an den Startpunkt                                               |
| ESC                            | Kapitel abbrechen, zurück zum Hauptmenü                                        |


Auf Touch-Geräten erscheinen Buttons unten (GAS / BREMS / LINKS / RECHTS).

## Spielprinzip

- **Hauptmenü**: Übersicht über alle Kapitel als aufgeschlagenes Buch (Status Zu lesen/Gelesen, wird in
`localStorage` gespeichert). Per Klick auf „Aufschlagen“ startet man ein Kapitel.
- **Kapitel 1 – Arc de Triomphe**: 5 Runden gegen den Uhrzeigersinn um den Kreis.
Pro Runde +5 Autos. Highscore (schnellste Zeit) wird gespeichert.
- **Kapitel 2 – Temposünder**: 120 km/h erreichen – ohne von der Straße abzukommen.
Die eigene Huegelland-Map (sanfte Hügel, schlängelnde Landstraße, Bäume, Zelte, keine Häuser)
wird erst beim Auswählen des Kapitels geladen (Lazy Load, `src/hills.js`).
Spawn ist 10 m vor dem Strassenanfang, damit das Auto komplett auf dem Asphalt steht.
Beim Erreichen des Zieltempos wird Hans **geblitzt** (Vollbild-Flash + Shutter-Sound,
`cameraShutter` in `src/audio.js`); das Auto fährt noch ~2,5 s weiter, erst dann
erscheint der Erfolgs-Screen.
- **Kapitel 3 – Nachts nach Rom**: Hans fährt bei stockfinsterer Nacht durch ein
Wegenetz voller Abzweigungen nach Rom – das Fahrlicht ist kaputt! Die Karte
(`src/nightrome.js`, Lazy Load) ist **hügelig** (weiche Sinus-Hügel bis ~14 m,
nahe den Straßen, um Rom und am Rand abgeflacht – Straßen bleiben fahrflach)
und **serpentinös**: An **neun Gabeln in Folge** muss Hans für ROMA wirklich
abbiegen (links/rechts im Wechsel – jeder „geradeaus"-Ausgang ist eine Falle),
erst danach kommt das „ROMA“-Stadttor. An jeder Gabel steht ein hölzerner
Wegweiser – aber **kein Schild sagt „ROMA“**: Darauf steht nur erfundener
Unsinn („AL DENTE 205 km“, „MOZZARELLA 12 km →“, „VAL TRUFFA“ …) mit
willkürlichen Kilometern. Orientieren muss sich Hans per Ausschlussverfahren,
Fortschrittsbalken und Sackgassen-Toasts. Alle
falschen Abzweigungen enden in **17 benannten Sackgassen** (Siena, Pisa,
Modena, Neapel, Venedig …). Die Sackgassen haben **keine Absperrung**: Die
Straße schmälert sich dort einfach, wird zum sandigen Pfad und verschwindet
sanft im Gras – nur dunkler Wald dahinter. Dazu zwei Irrwege-Bäume
(Ost und West) mit weiteren acht Gabeln für echte Navigationskunst. Die Karte
schaltet die gesamte Szene auf Nacht (Sterne, Mond, dichter Nebel,
`applyMapAtmosphere` in `src/main.js`); ein dichter Zypressenwald verhindert
Abkürzungen querfeldein, Reflektoren am Straßenrand leuchten schwach im Dunkeln.
In der **Werkstatt** kann Hans eine **Taschenlampe** kaufen (60 🪙, bleibt über
Sitzungen gespeichert, Schlüssel `camperHansFlashlight`): ein enger, kurzer
Spotlight-Strahl am Fahrerfenster, der nur wenige Meter vorausleuchtet.
Der Fortschrittsbalken (10 Punkte) füllt sich pro richtiger Abzweigung, Toasts
melden Sackgassen und Wegpunkte, geschafft ist das Kapitel auf dem erleuchteten
Platz von Rom (Kolosseum-Silhouette hinter dem „ROMA“-Stadttor).
**Nächtlicher Verkehr**: 14× Mercedes, Käfer und Ente (die GLB-Vorlagen aus
`src/traffic.js`) fahren kreuz und quer über das **gesamte Wegenetz** – beide
Richtungen (Rechtsverkehr über den Spurversatz), an jeder Gabel zufällig
(`NetworkTraffic` in `src/roadtraffic.js`, `night: true`). Sie bremsen
rücksichtig hinter Hans, hupen nachts selbstverständlich nicht – und
**verschwinden an jedem Ende ohne Ausfahrt** (Sackgassen, Straßenanfang,
ROMA-Tor) fahren die Autos die auslaufende Straße ganz hinaus und
verschwinden dort, wo der Weg im Gras endet – um irgendwo anders im Netz neu
zu erscheinen.
Die **Ente** fährt übrigens mit einem **kaputten Scheinwerfer**: links bleibt
dunkel, nur rechts leuchtet. Sichtbar sind die Autos nachts vor allem an den
leuchtenden Scheinwerferpunkten, Lichtkegeln (~12 m, additiv) und roten
Rücklichtern.
- **Erfolgsbildschirm**: „Glückwunsch, du hast es geschafft!“ mit Zeit und
Highscore; bei Kapitel 1 bleibt das Bild stehen und die Kamera fährt nach
hinten/oben zur Außenseite des Kreises, sodass der Arc im Hintergrund sieht.

## Verkehr

- 30 Autos zu Kapitelbeginn (exakt 10× car1_simple, 10× car2_simple, 10× car3_simple),
danach +5 pro Runde.
- Jedes Auto fährt mit eigener Zufallsgeschwindigkeit in seiner Spur und hupt
zufällig (car1/2/3_horn.mp3 — drei verschiedene Sounds).
- Kollidiert ein Auto mit dem Van, prallt das Auto zurück **und** der Van wird
zurückgeschleudert (Kapsel-Kollision, damit Nachbarspuren nicht „treffen“).

## Welt

- Kreisverkehr (Place Charles de Gaulle) mit 5 Spuren, Arc de Triomphe als
`arch.glb` auf der Mittelinsel (6 Zufallsbäume mit runder Krone).
- Champs-Élysée (Startstraße, 21 m breit) mit Birken-Allee und anschließender,
lückenloser Gebäudezeile (`building2/3/4.glb`, Fenster nur aus den GLB-Texturen).
- Gebäude auch direkt am Kreis, mit Freiraum an den Ausfahrten.
- **Huegelland-Map (nur Kapitel 2, `src/hills.js`)**: grüne Wiese mit sanften
Hügeln (bis ~10 m, nahe der Straße abgeflacht), eine schlängelnde asphaltierte
Landstraße (Spline, ~510 m, min. Kurvenradius ~20 m – bei 120 km/h muss
Hans in den engen Kurven vom Gas), Birken-Gruppen und einzelne Zelte im Gras,
Hecke als Weltgrenze. Wer weiter als Straße + Schotter-Schulter von der
Mittellinie abkommt, verliert das Kapitel. Fahrdynamik pro Map einstellbar
(`tuning`): Auf der Huegelland-Map darf der Van bis ~36 m/s (129,6 km/h)
rennen (Stadt-Default: 30 m/s = 108 km/h), damit das Ziel 120 km/h erreichbar ist
(accel 18 -> 120 km/h nach ~5 s / ~122 m Vollgas).
- **Nacht-Rom-Map (nur Kapitel 3, `src/nightrome.js`)**: dunkles, hügeliges
Italien mit ~440 Zypressen/Bäumen (9 m Abstand zu allen Straßen – querfeldein
wird es teuer) auf weichen Sinus-Hügeln (nahe Straßen, um den Rom-Platz und am
Rand abgeflacht), Wegenetz aus 36 begehbaren Segmenten mit 17 Gabeln und
17 Sackgassen, Wegweisern mit ←/↑/→-Pfeilen (Richtung automatisch aus der
Geometrie berechnet) und erfundenen Orts-Namen samt willkürlichen Kilometern
– KEIN Schild nennt „ROMA“ – Reflektoren am Straßenrand, Weltgrenze aus dunkler
Baumreihe. Am Ende der Serpentinen-Route: „ROMA“-Stadttor, erleuchteter Platz
mit Laternen (PointLights) und stilisiertem Kolosseum. Die Map trägt
`night: true`; `applyMapAtmosphere` in `src/main.js` verdunkelt dafür Himmel,
Nebel, Hemisphären- und Sonnen-/Mond-Licht und stellt beim Wechsel auf Tag-Maps
alles zurück. Fahrdynamik: max. 24 m/s (86 km/h) – bei Nacht gilt Rücksicht
statt Rekordfahrt.

## Technik

- Reines ES-Module-Setup mit Importmap, `three` liegt lokal in `vendor/`.
- Modelle: `Campervan.glb`, `arch.glb`, `car*_simple.glb`, `building*.glb`.
Texturen sind als WebP in die GLBs eingebettet (offline konvertiert mit
`gltf-transform webp`), dadurch ~20 MB statt ~106 MB Download.
Die grossen `car1/2/3.glb` werden nicht verwendet und sind per `.dockerignore`
aus dem Docker-Image ausgeschlossen.
- Sounds: `car1/2/3_horn.mp3`, `campervan_horn.mp3` (WebAudio-Synthese nur als
  Fallback, falls eine Datei fehlt). Autoradio mit drei Senderspeichern:
  **Sender 1 ist der Regionalsender** mit der Landesmusik des Kapitels —
  Paris/Standard spielt „Le Roi du Camping“ (`song_camper_hans_francais.mp3`),
  die Nachtfahrt nach Rom spielt „Radio Italia“
  (`song_camper_hans_italiano.mp3`). **Einschalten** (Taste M) startet immer
  Sender 1; zusätzlich Camping-Hop (2) und Schlager-Radio (3).
Fallback, falls eine Datei fehlt).
- Persistenz: Highscore und gelesene Kapitel in `localStorage`.

## Projektstruktur

```
index.html      HUD, Menü, Erfolgsbildschirm, Touch-Buttons
serve.mjs       statischer Server (node serve.mjs -> :8080)
src/main.js     Spielzustände (Menü/Spiel/Erfolg), Kamera, Zeitmessung
src/world.js    Welt, Straßen, Birken-Allee (Kapitel-1-Map)
src/hills.js    Huegelland-Map für Kapitel 2 (lazy geladen)
src/nightrome.js Nacht-Rom-Map für Kapitel 3: Wegenetz, Sackgassen, Rom (lazy geladen)
src/arc.js      Kreisverkehr, Arc de Triomphe (arch.glb)
src/car.js      Van: Physik, Spurhaltung im Kreis
src/traffic.js  Verkehr: GLB-Autos, Zufallsgeschwindigkeit, Hupen, Kollision
src/buildings.js  Gebäudezeilen (building2/3/4.glb)
src/chapters.js Kapitel-System (Runden, Hupen, Tempo)
src/controls.js Tastatur/Touch
src/audio.js    MP3-Hupen + Synth-Fallback
vendor/         three.module.min.js + Addons
```