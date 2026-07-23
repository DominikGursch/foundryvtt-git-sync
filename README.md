# Git Object Sync (FoundryVTT v12)

Mit diesem Modul kannst du einzelne FoundryVTT-Objekte – **Charaktere (Actors),
Items, Szenen und Journale** – inklusive ihrer **Bilder und Maps** sichern und
wiederherstellen. Gespeichert wird bei **GitHub** (ein kostenloser Online-Speicher
für genau solche Dateien) – **direkt aus der Foundry-Oberfläche**, ohne Server
und ohne Terminal.

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
- **Importieren:** Auf derselben oder einer anderen Foundry-Instanz die Dateien
  wieder einspielen – ebenfalls per Klick.

### Was du brauchst

- Eine **FoundryVTT v12**-Installation (du als **Spielleiter/GM**).
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
```

---

## 1. Modul installieren

In diesem Schritt bringst du das Modul in deine Foundry-Installation. Da dein
Modul-Repo **privat** ist, ist die **manuelle Installation (Methode 1)** der richtige
Weg. Die bequeme Manifest-Installation (Methode 2) funktioniert nur mit einem
**öffentlichen** Repo.

### Methode 1 – Manuell (Ordner kopieren, für privates Repo)

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

### Methode 2 – Über die Foundry-Oberfläche (Manifest-URL, nur bei öffentlichem Repo)

> **Nur möglich, wenn das Modul-Repo öffentlich ist.** Foundry lädt die Manifest-URL
> **ohne Anmeldung**; bei einem privaten Repo schlägt der Download fehl. Solange dein
> Repo privat bleibt, nutze **Methode 1**.

1. Starte Foundry und bleibe auf dem **Setup-/Startbildschirm** (nicht in einer Welt).
2. Wechsle zum Reiter **„Add-on Modules"** (Add-on-Module).
3. Klicke unten auf **„Install Module"** (Modul installieren).
4. Trage unten im Feld **„Manifest URL"** diese Adresse ein und klicke **„Install"**:
   ```
   https://github.com/DominikGursch/foundryvtt-git-sync/releases/latest/download/module.json
   ```

### Modul aktivieren (beide Methoden)

**Aktivieren:** Starte deine Welt in Foundry und gehe zu
**Game Settings → Manage Modules**. Setze bei **„Git Object Sync"** das Häkchen
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
2. **Token name:** z. B. `Foundry Git Object Sync`. **Expiration:** nach Wunsch.
3. **Repository access** → **Only select repositories** → dein Repo auswählen.
4. **Permissions** → **Repository permissions** → **Contents** auf
   **Read and write** stellen. (Mehr ist nicht nötig.)
5. **Generate token** → den angezeigten Token **kopieren** (er wird nur **einmal**
   angezeigt).

### 2.3 – Modul einstellen

In Foundry: **Settings → Module Settings → „Git Object Sync"**:

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

## Wenn etwas nicht klappt (Problemlösung)

- **„GitHub 401" / „GitHub 403":** Der Token fehlt, ist abgelaufen oder hat nicht
  **Contents: Read and write** für das Repo. Token in den Modul-Einstellungen prüfen
  (Schritt 2.2/2.3).
- **„GitHub 404":** Der Repository-Name ist falsch (muss `owner/repo` sein) oder der
  Token hat keinen Zugriff auf genau dieses Repo.
- **Nichts zu importieren:** Es wurde für diesen Typ noch nichts exportiert, oder der
  **GitHub-Branch** in den Einstellungen stimmt nicht (Standard: `main`).

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
