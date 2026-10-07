# Compendium Builder (CI-Hilfswerkzeug)

🇩🇪 Deutsch (diese Datei) · 🇬🇧 [English](README.en.md)

> **Wichtig:** Dieser Ordner gehört **nicht** zum FoundryVTT-Modul selbst
> (`git-object-sync/`). Er ist ein eigenständiges Node.js-Werkzeug, das du in
> dein **anderes, privates Inhalte-Repo** kopierst – also genau das Repo, in
> das das Modul „Foundry Git Sync" exportiert (`actors/`, `items/`, `scenes/`,
> `journal/`, `compendia/<pack>/`).

## Schnellstart (für Eilige)

1. **[Node.js](https://nodejs.org)** installieren (LTS-Version) – nur einmal,
   falls noch nicht vorhanden.
2. Den Ordner **`compendium-builder/`** aus diesem Repo in die **Wurzel**
   deines privaten Inhalte-Repos kopieren (siehe
   [Einmalige Einrichtung](#einmalige-einrichtung-im-privaten-inhalte-repo)).
3. Einmalig im Terminal: `cd compendium-builder` und dann `npm install`.
4. Datei `compendium-builder/example-workflow.yml` nach
   `.github/workflows/build-packs.yml` kopieren (siehe
   [Automatisierung](#automatisierung-per-github-actions-zyklisch--bei-jedem-export)).
5. **Fertig.** Ab jetzt baut GitHub Actions bei jedem Export automatisch
   (und zusätzlich täglich) ein installierbares Kompendium-Modul – du musst
   nichts mehr manuell ausführen.

## Was macht das?

Foundry Git Sync exportiert jedes Objekt als einzelne, flache JSON-Datei. Das
ist ideal für Git (kleine, diff-bare Commits), aber kein direkt in Foundry
installierbares Kompendium. Dieses Skript schließt die Lücke:

1. Es liest alle exportierten JSON-Dateien ein.
2. Es baut daraus mit dem offiziellen **`@foundryvtt/foundryvtt-cli`**
   (`compilePack`) echte, native FoundryVTT-Kompendien (LevelDB-Packs unter
   `packs/<name>`).
3. Es legt/aktualisiert ein `module.json`, damit dein Inhalte-Repo selbst als
   **installierbares Foundry-Modul** genutzt werden kann – mit echten,
   durchsuchbaren, browsbaren Kompendien, ganz ohne den manuellen
   Kompendium-Import-Dialog von Foundry Git Sync.
4. Über eine GitHub-Actions-Automatisierung läuft das **zyklisch** (Cron)
   und/oder bei jedem Export-Push – dein Kompendium-Modul bleibt so immer
   aktuell.

## Wichtige Einschränkungen (bitte vorher lesen)

- **Ein Kompendium = ein Dokumenttyp.** Foundry kennt keine gemischten
  Kompendien. „Alle Komponenten (Charaktere, Items, Maps, …) in ein
  Kompendium" ist technisch nicht möglich. Das Skript baut deshalb **pro
  Export-Ordner ein eigenes Pack** (`packs/actors`, `packs/items`,
  `packs/scenes`, `packs/journal`, plus ein Pack je eigenem Kompendium unter
  `compendia/<pack>`) – alle in einem Lauf, aber als separate Packs.
- **Ordner-Struktur wird wiederhergestellt.** Die von Foundry Git Sync
  mitgelieferten Ordner-Pfade (`flags.git-object-sync.folderPath` bzw.
  `flags.git-object-sync.compendium.folderPath`) werden in echte,
  pack-interne Ordner-Dokumente umgewandelt (siehe `lib.mjs`). Die Ordner-IDs
  werden **deterministisch** aus Pack-Name + Namenspfad abgeleitet, sodass
  wiederholte Läufe (Cron) keine doppelten Ordner erzeugen.
- **Das Inhalte-Repo bleibt privat.** Foundrys Manifest-URL-Installation
  funktioniert nur bei öffentlichen Repos (Foundry lädt sie ohne Anmeldung).
  Für das private Inhalte-Repo bleibt daher nur die **manuelle Installation**
  (ZIP herunterladen, Ordner nach `Data/modules/` kopieren) – anders als beim
  öffentlichen Foundry-Git-Sync-Modul.
- **Nur die Zuordnungslogik ist eigener Code.** Das eigentliche Packen in eine
  LevelDB übernimmt vollständig das offizielle, von Foundry selbst gepflegte
  `@foundryvtt/foundryvtt-cli`. `lib.mjs` enthält nur die reine
  Zuordnungs-/Reshaping-Logik und ist über `test.mjs` (Node-Bordmittel,
  `node --test`) abgedeckt.

## Einmalige Einrichtung im privaten Inhalte-Repo

1. Diesen ganzen Ordner (`compendium-builder/`) in die Wurzel deines privaten
   Inhalte-Repos kopieren. Zwei Wege, je nachdem, was du gewohnt bist:
   - **Mit Git (lokaler Klon):** Dieses Repo klonen bzw. als ZIP herunterladen,
     den Ordner `compendium-builder/` herauskopieren, in deinen lokalen Klon
     des Inhalte-Repos einfügen, dann `git add`, `git commit`, `git push`.
   - **Ohne Git, nur im Browser:** In diesem Repo auf **Code → Download ZIP**
     klicken und entpacken. Dann in deinem Inhalte-Repo auf GitHub.com zu
     **Add file → Upload files** gehen und den entpackten Ordner
     `compendium-builder/` (mit allen Dateien darin) per Drag & Drop
     hochladen. GitHub übernimmt die Ordnerstruktur automatisch.
2. `cd compendium-builder && npm install`
3. Testlauf: `npm run build` (oder `node build-packs.mjs`) – erzeugt
   `packs/` und `module.json` **in der Repo-Wurzel** (eine Ebene über diesem
   Ordner). Das Skript findet die Repo-Wurzel automatisch anhand seines
   eigenen Speicherorts – es spielt also keine Rolle, ob du es aus
   `compendium-builder/` heraus oder mit vollem Pfad
   (`node compendium-builder/build-packs.mjs`) aus der Repo-Wurzel aufrufst.

## Automatisierung per GitHub Actions (zyklisch + bei jedem Export)

Kopiere `example-workflow.yml` nach `.github/workflows/build-packs.yml` in
deinem **privaten Inhalte-Repo** (nicht in dieses Modul-Repo!). Der Workflow:

- läuft **täglich per Cron** sowie **bei jedem Push** (also direkt nach einem
  Export durch Foundry Git Sync),
- installiert Node + die Abhängigkeiten,
- baut alle Packs neu,
- committed `packs/` und `module.json` automatisch zurück ins selbe Repo
  (`GITHUB_TOKEN` reicht aus, da alles im selben Repo bleibt – kein
  zusätzliches Secret nötig).

`classic-level` (die LevelDB-Anbindung von `@foundryvtt/foundryvtt-cli`)
liefert vorkompilierte Binärdateien für `linux-x64` mit aus – auf dem
Standard-`ubuntu-latest`-Runner ist daher **kein** zusätzliches Build-Tooling
nötig.

## Nach dem Build: Modul installieren/aktualisieren

Wie beim Hauptmodul (privates Repo → nur manuelle Installation möglich):

1. Im privaten Inhalte-Repo auf GitHub: **Code → Download ZIP** (oder das vom
   Workflow erzeugte Release-Artefakt, falls du das ergänzt).
2. Den entpackten Ordner (der jetzt `module.json` + `packs/` enthält) nach
   `<foundrydata>/Data/modules/<dein-modul-id>/` kopieren.
3. In Foundry unter **Manage Modules** aktivieren.
4. Die Kompendien erscheinen direkt in der Kompendium-Seitenleiste – nativ,
   durchsuchbar, ohne weiteren Import-Schritt.

**Update:** Einfach den ZIP-Download wiederholen und den Ordner erneut
kopieren (vorhandenen ersetzen), sobald der Workflow neue Packs gebaut hat.

## Dateien in diesem Ordner

```
compendium-builder/
  package.json          <- Abhängigkeit: @foundryvtt/foundryvtt-cli
  lib.mjs               <- reine Zuordnungs-/Reshaping-Logik (getestet)
  build-packs.mjs       <- CLI-Einstiegspunkt (nutzt lib.mjs + compilePack)
  test.mjs              <- Smoke-Tests (node --test test.mjs)
  example-workflow.yml  <- Vorlage für .github/workflows/ im Inhalte-Repo
  README.md             <- diese Datei (Deutsch)
  README.en.md          <- diese Datei (Englisch)
```
