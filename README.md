# Foundry Git Sync (FoundryVTT v12)

🇩🇪 Deutsch (diese Datei) · 🇬🇧 [English](README.en.md)

Mit diesem Modul kannst du einzelne FoundryVTT-Objekte – **Charaktere (Actors),
Items, Szenen, Journale und eigene Welt-Kompendien** – inklusive ihrer
**Bilder und Maps** sichern und wiederherstellen. Gespeichert wird bei
**GitHub** (ein kostenloser Online-Speicher für genau solche Dateien) –
**direkt aus der Foundry-Oberfläche**, ohne Server und ohne Terminal.

**Kurz gesagt:** Du klickst in Foundry auf „Exportieren" – den Rest übernimmt das Modul.

### Was macht das Modul konkret?

- **Exportieren:** Objekt in Foundry auswählen → wird als Datei gespeichert.
  - **Rechtsklick** auf ein Objekt in der Seitenleiste → „Export nach Git"
  - oder **Buttons** oben in jeder Seitenleiste → Dialog mit Checkboxen für
    mehrere Objekte auf einmal
- **Sicherung bei GitHub:** Das Modul lädt beim Klick direkt zu GitHub hoch
  (ein einzelner Commit pro Export).
- **Bilder & Maps inklusive:** Referenzierte Bilder (Karten, Portraits, Token)
  werden auf Wunsch mitgesichert, damit Objekte vollständig übertragen werden.
- **Charaktere komplett:** Ein Actor nimmt beim Export/Import automatisch seine
  **getragenen Items, Active Effects und Prototype-Token-Daten** mit – es geht
  nichts verloren.
- **Eigene Welt-Kompendien:** Auch selbst angelegte Kompendien (samt ihrer
  kompendium-internen Ordnerstruktur) lassen sich sichern und wiederherstellen
  – siehe **[Kompendien sichern und wiederherstellen](#kompendien-sichern-und-wiederherstellen)**.
- **Importieren:** Auf derselben oder einer anderen Foundry-Instanz die Dateien
  wieder einspielen – ebenfalls per Klick.

### Was du brauchst

- Eine **FoundryVTT v12**-Installation (du als **Spielleiter/GM**). Das Modul
  ist aktuell nur für v12 freigegeben und getestet; die automatisierten Tests
  prüfen nicht die Foundry-Integration (siehe [Kompatibilität](#kompatibilität)).
- Ein kostenloses **GitHub-Konto**.

**Schnellstart:**
1. **[Modul installieren](#1-modul-installieren)**
2. **[GitHub einrichten](#2-github-einrichten)**

---

## Paketinhalt (was in diesem Projekt liegt)

```
git-object-sync/            <- Das FoundryVTT-Modul (kommt in Data/modules/)
  module.json
  scripts/main.js
  lang/{de,en}.json
compendium-builder/         <- Optionales CI-Werkzeug für dein PRIVATES Inhalte-Repo
                                (baut aus den Exporten echte, installierbare
                                Kompendien – siehe compendium-builder/README.md)
```

---

## 1. Modul installieren

In diesem Schritt bringst du das Modul in deine Foundry-Installation. Das
Modul-Repo ist öffentlich; du kannst es daher direkt über die Manifest-URL in
Foundry installieren und aktualisieren (Methode 2).

### Methode 1 – Manuell (Ordner kopieren)

1. Öffne das Projekt auf GitHub (angemeldet):
   `https://github.com/DominikGursch/foundryvtt-git-sync`
2. Klicke auf den grünen Button **„Code" → „Download ZIP"** und entpacke die
   heruntergeladene Datei.
3. Im entpackten Ordner findest du den Unterordner **`git-object-sync/`**. Kopiere
   **genau diesen Ordner** in das `modules`-Verzeichnis deiner Foundry-Installation,
   sodass es am Ende so aussieht:
   ```
   <foundrydata>/Data/modules/git-object-sync/
   ```

`<foundrydata>` ist dein Foundry-Data-Ordner. Wo der liegt, siehst du in Foundry
auf der Startseite unter **Configuration** → „User Data Path".

> **Update später:** Zum Aktualisieren einfach den ZIP-Download wiederholen und den
> Ordner `git-object-sync/` erneut in `Data/modules/` kopieren (vorhandenen ersetzen).
> Foundry vorher beenden und den vorhandenen Modulordner vollständig durch den
> neuen ersetzen. Den Ordnernamen `git-object-sync` beibehalten; er ist die
> technische Modul-ID. Danach Foundry neu starten. Welt-Einstellungen bleiben
> erhalten, da sie in Foundrys Datenbank und nicht im Modulordner gespeichert sind.

### Methode 2 – Über die Foundry-Oberfläche (empfohlen)

Das Modul-Repo ist öffentlich, sodass Foundry Manifest und ZIP ohne Anmeldung
abrufen kann. Bei Änderungen am Modulcode unter `git-object-sync/` erstellt
GitHub Actions automatisch ein Release mit einer erhöhten Patch-Version.

1. Starte Foundry und bleibe auf dem **Setup-/Startbildschirm** (nicht in einer Welt).
2. Wechsle zum Reiter **„Add-on Modules"** (Add-on-Module).
3. Klicke unten auf **„Install Module"** (Modul installieren).
4. Trage unten im Feld **„Manifest URL"** diese Adresse ein und klicke **„Install"**:
   ```
   https://github.com/DominikGursch/foundryvtt-git-sync/releases/latest/download/module.json
   ```
   Die Versionsnummer im Manifest und der Download-Link zum passenden ZIP
   werden für jedes Release automatisch aktualisiert.

### Modul aktivieren (beide Methoden)

**Aktivieren:** Starte deine Welt in Foundry und gehe zu
**Game Settings → Manage Modules**. Setze bei **„Foundry Git Sync"** das Häkchen
und speichere. Die eigentliche Einrichtung folgt jetzt in **[GitHub einrichten](#2-github-einrichten)**.

---

## 2. GitHub einrichten

### 2.1 – Ein leeres Repository auf GitHub anlegen

1. Auf **https://github.com** anmelden (oder kostenlos registrieren).
2. Oben rechts **+** → **New repository**.
3. **Repository name:** z. B. `foundry-content`.
4. Auf **Private** stellen und alle Häkchen leer lassen (das Repo muss leer sein).
5. **Create repository**. Notiere dir den Namen als `DEIN_GITHUB_NAME/REPO_NAME`.

### 2.2 – Einen Zugriffs-Token erstellen (deine „Credentials")

Der Token erlaubt dem Modul, in **genau dieses eine Repo** zu schreiben und daraus
zu lesen – nichts weiter.

1. Öffne **https://github.com/settings/personal-access-tokens** →
   **Generate new token** (Fine-grained).
2. **Token name:** z. B. `Foundry Git Sync`. **Expiration:** nach Wunsch.
3. **Repository access** → **Only select repositories** → dein Repo auswählen.
4. **Permissions** → **Repository permissions** → **Contents** auf
   **Read and write** stellen. (Mehr ist nicht nötig.)
5. **Generate token** → den angezeigten Token **kopieren** (er wird nur **einmal**
   angezeigt).

### 2.3 – Modul einstellen

In Foundry: **Settings → Module Settings → „Foundry Git Sync"**:

- **GitHub-Repository:** `DEIN_GITHUB_NAME/REPO_NAME` (z. B. `DominikGursch/foundry-content`)
- **GitHub-Branch:** `main`
- **GitHub-Token:** den kopierten Token einfügen
- **Assets mitsichern:** aktiviert lassen (Bilder/Maps inklusive)

Speichern – **fertig.** Ab jetzt kannst du direkt exportieren/importieren (siehe
**[So benutzt du es im Alltag](#so-benutzt-du-es-im-alltag)**).

> **Sicherheit:** Der Token liegt in den Welt-Einstellungen (nur der GM sieht ihn).
> Verwende einen **fein granularen** Token, der **nur** auf dieses eine Repo und
> **nur** auf „Contents" beschränkt ist – niemals dein Konto-Passwort. Setze bei
> Bedarf ein Ablaufdatum.

### Asset- und Ordner-Pfade steuern (optional)

Standardmäßig werden Assets **genau unter ihrem Original-Pfad** abgelegt – im Repo
unter `assets/<Original-Pfad>` und beim Import wieder am selben Ort. Objekte landen
beim Import in demselben Seitenleisten-Ordner wie beim Export. Über einige
Einstellungen kannst du das anpassen. Alle stehen als **globales Modul-Setting** und
zusätzlich **direkt im Export-/Import-Dialog** zur Verfügung (die Dialog-Werte
überschreiben die globale Vorgabe für diesen einen Vorgang).

**Export:**

- **Assets in Sammelordner ablegen** (`store assets in collective folders`) — ein
  Haken. Ist er gesetzt, werden alle Assets ordentlich nach `assets/<Typ>/<Dateiname>`
  gelegt (z. B. `assets/Item/schwert.webp`, `assets/Actor/portrait.webp`) und die
  Referenzen in den Objekten passend umgeschrieben. Ist der Haken **nicht** gesetzt,
  bleiben die vollständigen Originalpfade erhalten.

**Import:**

- **Import-Zielordner für Assets** (`Import target folder for assets`) — der Pfad im
  Data-Verzeichnis, unter dem importierte Bilder/Maps lokal gespeichert werden.
  Beispiel: `git-import` schreibt die Assets nach `git-import/…` und biegt
  die Pfade in den importierten Objekten automatisch dorthin um. Leer = Originalpfad.
- **Ordner-Verhalten** (`folder behaviour`) — steuert, in welchen Seitenleisten-Ordner
  importierte Objekte gelegt werden:
  - **Gleicher Ordner wie beim Export** — die Ordner-Struktur (z. B. `Weapons`) wird
    bei Bedarf neu angelegt und das Objekt dort einsortiert.
  - **Kein Ordner (Wurzel)** — das Objekt landet ohne Ordner ganz oben.
  - **Fester Ordner** — alle importierten Objekte kommen in einen selbst benannten
    Ordner (Feld **fester Ordnername**, z. B. `Git Import`).

Damit „Gleicher Ordner wie beim Export" funktioniert, wird der Ordner-Pfad beim
Export automatisch mitgespeichert – ältere Exporte (ohne diese Info) landen bei
diesem Modus in der Wurzel.

### Nur Deltas anzeigen (optional)

Export- und Import-Dialog markieren jedes Objekt mit einem Status-Badge:

- **Neu** — es existiert noch keine passende Datei im Repo bzw. kein passendes
  lokales Dokument.
- **Geändert** — Datei bzw. Dokument existiert bereits, der Inhalt weicht aber ab.
- **Unverändert** — Inhalt ist identisch zum letzten Export/Import.

Der Status wird lokal per Git-Blob-Hash-Vergleich ermittelt (kein zusätzlicher
Download nötig). Über die Checkbox **„Unveränderte Objekte ausblenden"** direkt im
Dialog kannst du unveränderte Einträge ausblenden und siehst so nur die Deltas.
Das globale Modul-Setting **„Standardmäßig unveränderte Objekte ausblenden"**
(Standard: aktiviert) legt nur den Vorgabewert dieser Checkbox fest.

> **Hinweis:** Der Vergleich nutzt die aktuell global konfigurierten Export-
> Einstellungen (Assets mitsichern, Sammelordner). Wurden diese seit dem letzten
> Export/Import geändert, kann der angezeigte Status ungenau sein.

---

## So benutzt du es im Alltag

Nach der Einrichtung bleibst du komplett in Foundry.

### Etwas sichern (Exportieren)

1. Objekt(e) auswählen – per **Rechtsklick → „Export nach Git"** oder über den
   **„Git Export …"-Button** oben in der Seitenleiste (dort kannst du mehrere
   Objekte anhaken).
2. Das Modul sichert die Objekte **inklusive Bilder/Maps** direkt zu GitHub (sofort).

### Etwas wiederherstellen (Importieren)

Funktioniert auf derselben Instanz (z. B. nach einem Fehler) oder auf einer anderen
Foundry-Installation.

1. Auf den **„Git Import …"-Button** klicken.
2. Gewünschte Dateien anhaken → importieren. Referenzierte Bilder/Maps werden
   automatisch mit wiederhergestellt.

Das Modul liest beim Import direkt den aktuellen Stand aus GitHub – ein manuelles
Nachladen ist nicht nötig.

---

## Kompendien sichern und wiederherstellen

Genau wie einzelne Objekte lassen sich auch **eigene, in dieser Welt angelegte
Kompendien** sichern und wiederherstellen. Kompendien, die aus einem
**System** oder **Modul** kommen, werden **nicht** angeboten – deren Inhalt
kommt ja bereits über die jeweilige Installation und muss nicht separat
gesichert werden.

1. Öffne die **Kompendium-Seitenleiste** (Reiter „Compendia"/„Kompendien").
2. Oben erscheinen dieselben zwei Buttons **„Git Export …"** / **„Git Import …"**
   wie bei Actors, Items, Szenen und Journalen – hier zeigen sie **alle Einträge
   deiner eigenen Welt-Kompendien**, gruppiert nach Kompendium-Name.
3. **Export:** Einträge auswählen (auch über mehrere Kompendien hinweg möglich)
   und exportieren. Sie landen im Repo unter `compendia/<technischer-Name>/…`.
4. **Import:** Der Export speichert die technische Kompendium-ID und den
   Dokumenttyp. Dadurch bleiben auch Kompendien mit gleichem Anzeigenamen
   getrennt. Existiert das passende Kompendium auf der Ziel-Installation noch
   nicht, wird es **automatisch neu angelegt**. Ältere Exporte ohne technische
   ID werden anhand von Anzeigename und Dokumenttyp zugeordnet.
5. **Ordner innerhalb des Kompendiums** (die du z. B. per Rechtsklick direkt im
   Kompendium anlegst) werden mitexportiert und beim Import an gleicher Stelle
   wiederhergestellt.

Die gleichen Optionen wie bei normalen Objekten gelten auch hier: Assets werden
mitgesichert, der Delta-Status (Neu/Geändert/Unverändert) wird ebenso ermittelt,
und „Unveränderte ausblenden" funktioniert identisch. Ein **Seitenleisten-Ordner**
gibt es bei Kompendium-Einträgen naturgemäß nicht – die Ordner-Verhalten-Einstellung
(„Gleicher Ordner/Kein Ordner/Fester Ordner") greift hier daher nicht.

> **Kompendien automatisch aus vielen kleinen Exporten bauen:** Wenn du Items,
> Charaktere, Szenen usw. einzeln in ein separates Inhalte-Repo exportierst und
> daraus regelmäßig ein fertiges, installierbares Kompendium-Modul erzeugen
> willst, wirf einen Blick auf das mitgelieferte CI-Werkzeug
> **[`compendium-builder/`](compendium-builder/README.md)** – es baut per
> GitHub Actions automatisch (z. B. täglich) aus allen Exporten ein Kompendium.

---

## Wenn etwas nicht klappt (Problemlösung)

- **„GitHub 401" / „GitHub 403":** Der Token fehlt, ist abgelaufen oder hat nicht
  **Contents: Read and write** für das Repo. Token in den Modul-Einstellungen prüfen
  (Schritt 2.2/2.3).
- **„GitHub 404":** Der Repository-Name ist falsch (muss `owner/repo` sein) oder der
  Token hat keinen Zugriff auf genau dieses Repo.
- **Nichts zu importieren:** Es wurde für diesen Typ noch nichts exportiert, oder der
  **GitHub-Branch** in den Einstellungen stimmt nicht (Standard: `main`).
- **„No world compendiums found" / „Keine Welt-Kompendien gefunden":** Es existieren
  in dieser Welt aktuell keine **eigenen** Kompendien – lege zuerst eines im
  Kompendium-Reiter an (System-/Modul-Kompendien werden bewusst nicht angeboten,
  siehe [Kompendien sichern und wiederherstellen](#kompendien-sichern-und-wiederherstellen)).

---

## Gut zu wissen (technische Hinweise)

- **Karten & Bilder:** Mit aktivierter Einstellung **„Assets mitsichern"** kopiert das
  Modul referenzierte Bilder (Karten, Portraits, Token) automatisch mit – beim Export
  **und** beim Import. So funktionieren Szenen und Charaktere auch auf einer anderen
  Instanz vollständig. Ausgelassen werden nur allgemein vorhandene Dateien (Core-,
  System- und Modul-Assets) sowie externe Web-Adressen (`http(s)://…`). Die Bilder
  werden als eigene Dateien im Repo abgelegt (bis 100 MB pro Datei).
- **IDs bleiben erhalten:** Beim Import behält ein Objekt seine ursprüngliche Kennung.
  Existiert es schon, wird es aktualisiert (wenn „Beim Import überschreiben" aktiv
  ist) – ansonsten als Kopie angelegt.
- **Nur für Spielleiter:** Export und Import sind nur als GM verfügbar.
- **Kein Neustart nötig:** Anders als das offizielle `fvtt`-Tool muss Foundry zum
  Exportieren/Importieren **nicht** heruntergefahren werden.
- **Alles-in-einer-Datei:** Charaktere nehmen ihre Items/Effekte mit, Journale ihre
  Seiten, Szenen ihre Tokens/Notizen/Lichter – jeweils in einer einzigen Datei.

---

## Kompatibilität

- **Zielversion:** FoundryVTT **v12**. Die automatisierten Tests im Repository
  prüfen die reine Zuordnungslogik des optionalen `compendium-builder`
  (`node --test compendium-builder/test.mjs`), nicht die Foundry-Integration.
  Buttons, Dialoge sowie Export/Import sollten daher in einer Foundry-Instanz
  separat geprüft werden.
- **Freigegebene Version:** `module.json` setzt `minimum`, `verified` und
  `maximum` auf **12**. Das Modul ist aktuell **nur auf Foundry v12 getestet**
  und lässt sich auch nur dort installieren und aktivieren.
- **v13 (noch nicht freigegeben):** Foundry v13 hat die internen „Hooks" für
  Rechtsklick-Menüs in der Seitenleiste umbenannt und liefert an
  Callback-Funktionen kein jQuery-Objekt mehr, sondern ein natives HTML-Element.
  Der Code registriert vorsorglich **beide** Varianten (v12- **und**
  v13-Hook-Namen) und erkennt beide Übergabeformen automatisch. Solange kein
  vollständiger Test auf einer echten v13-Welt erfolgt ist, bleibt v13 in
  `module.json` aber ausgeschlossen.
- **Rückmeldung willkommen:** Falls dir etwas auffällt, melde es gerne als
  Issue im Repository.

### Import zwischen verschiedenen Versionen

Ein Export ist **nicht versionsunabhängig**. Er enthält die Rohdaten im Format
der exportierenden Installation sowie deren Versionsangaben (`_stats`:
Foundry-Version, System und Systemversion). Vor jedem Import vergleicht das
Modul diese Angaben mit der eigenen Installation und zeigt im Import-Dialog ein
Badge an (Tooltip mit Details):

| Situation | Verhalten |
|---|---|
| Gleiche Foundry-Generation und Systemversion | Normaler Import |
| Ältere Foundry-Generation (z. B. v12 → v13) oder ältere Systemversion | Badge **„Andere Version"**. Nach Bestätigung inklusive Backup-Hinweis werden die Daten über Foundrys eigene Migration (`migrateDataSafe`) an das aktuelle Schema angepasst |
| Neuere Systemversion, nur Patch-Unterschied (z. B. 4.1.2 → 4.1.0) | Badge **„Andere Version"**, Import nach Bestätigung |
| Gleiches System, aber keine Foundry-Versionsangabe | Badge **„Version unbekannt"**, Import nach Bestätigung |
| Neuere Foundry-Generation (z. B. v13 → v12) oder neuere System-Haupt-/Nebenversion | Badge **„Inkompatibel"**, Import wird **blockiert** (eine Rückkonvertierung gibt es in Foundry nicht) |
| Objekt aus einem **anderen System** (z. B. dnd5e → Cyberpunk RED), egal ob Actor, Item, Szene oder Journal | **Blockiert** – es lassen sich nur Objekte aus demselben System importieren |
| Datei ohne System-Angabe (`_stats.systemId`) | **Blockiert**, da die Herkunft nicht prüfbar ist |

**Grenzen:** Die automatische Migration deckt das Foundry-Kernschema und die
`migrateData`-Logik der Datenmodelle des Systems ab. **Welt-Migrationsskripte
eines Systems** (die z. B. nach einem dnd5e-Update einmalig laufen) werden beim
Import nicht ausgeführt. Lege deshalb vor einem versionsübergreifenden Import
immer ein **Backup der Welt** an. Bei gemeinsam genutzten Repos ist es am
sichersten, wenn alle Welten dieselbe Foundry- und Systemversion verwenden.

## Hinweis zur KI-Unterstützung

Bei der Entwicklung dieses Projekts wurden KI-Tools zur Codeerstellung und
-überarbeitung eingesetzt. Die Änderungen werden vom Maintainer geprüft; die
Verantwortung für den Code und seine Pflege liegt beim Maintainer.
