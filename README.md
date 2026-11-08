# Camper Hans – Testfahrt am Arc de Triomphe

Das Spiel zum Buch. www.camper-hans.de

Ein kleines 3D-Fahrspiel im Browser (Three.js): Camper Hans fährt durch Paris,
muss Runden um den Arc de Triomphe drehen, weicht dem Verkehr aus und hupt sich
mit der LKW-Hupe (H) durch den Kreisverkehr.

## Start

```bash
node serve.mjs
# -> http://localhost:8080
```

Kein Build-Schritt nötig; statischer Server ohne Abhängigkeiten.

## Steuerung

| Taste | Funktion |
|---|---|
| Pfeiltasten / WASD | Fahren (Gas, Bremsen/Rückwärts, Lenken) |
| LINKS / RECHTS im Kreisverkehr | Spur wechseln (Sobald der Van den Kreis erreicht hat, bleibt er in der Spur) |
| H | LKW-Hupe (campervan_horn.mp3) |
| R | Zurücksetzen an den Startpunkt |
| ESC | Quest abbrechen, zurück zum Hauptmenü |

Auf Touch-Geräten erscheinen Buttons unten (GAS / BREMS / LINKS / RECHTS).

## Spielprinzip

- **Hauptmenü**: Übersicht über alle Quests mit Status (Offen/Erledigt, wird in
  `localStorage` gespeichert). Per Klick startet man eine Quest.
- **Quest 1 – Arc de Triomphe**: 5 Runden gegen den Uhrzeigersinn um den Kreis.
  Pro Runde +5 Autos. Highscore (schnellste Zeit) wird gespeichert.
- **Quest 2 – Temposünder**: 100 km/h erreichen.
- **Erfolgsbildschirm**: „Glückwunsch, du hast es geschafft!“ mit Zeit und
  Highscore; bei Quest 1 bleibt das Bild stehen und die Kamera fährt nach
  hinten/oben zur Außenseite des Kreises, sodass der Arc im Hintergrund sieht.

## Verkehr

- 30 Autos zu Questbeginn (exakt 10× car1_simple, 10× car2_simple, 10× car3_simple),
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

## Technik

- Reines ES-Module-Setup mit Importmap, `three` liegt lokal in `vendor/`.
- Modelle: `Campervan.glb`, `arch.glb`, `car*_simple.glb`, `building*.glb`.
- Sounds: `car1/2/3_horn.mp3`, `campervan_horn.mp3` (WebAudio-Synthese nur als
  Fallback, falls eine Datei fehlt).
- Persistenz: Highscore und erledigte Quests in `localStorage`.

## Projektstruktur

```
index.html      HUD, Menü, Erfolgsbildschirm, Touch-Buttons
serve.mjs       statischer Server (node serve.mjs -> :8080)
src/main.js     Spielzustände (Menü/Spiel/Erfolg), Kamera, Zeitmessung
src/world.js    Welt, Straßen, Birken-Allee
src/arc.js      Kreisverkehr, Arc de Triomphe (arch.glb)
src/car.js      Van: Physik, Spurhaltung im Kreis
src/traffic.js  Verkehr: GLB-Autos, Zufallsgeschwindigkeit, Hupen, Kollision
src/buildings.js  Gebäudezeilen (building2/3/4.glb)
src/quests.js   Quest-System (Runden, Hupen, Tempo)
src/controls.js Tastatur/Touch
src/audio.js    MP3-Hupen + Synth-Fallback
vendor/         three.module.min.js + Addons
```
