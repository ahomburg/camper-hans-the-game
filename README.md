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

### Texturen optimieren

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
| ESC                            | Quest abbrechen, zurück zum Hauptmenü                                        |


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
Texturen sind als WebP in die GLBs eingebettet (offline konvertiert mit
`gltf-transform webp`), dadurch ~20 MB statt ~106 MB Download.
Die grossen `car1/2/3.glb` werden nicht verwendet und sind per `.dockerignore`
aus dem Docker-Image ausgeschlossen.
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