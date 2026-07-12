# Git Object Sync (FoundryVTT v12)

Mit diesem Modul kannst du einzelne FoundryVTT-Objekte – **Charaktere (Actors),
Items, Szenen und Journale** – inklusive ihrer **Bilder und Maps** sichern und
wiederherstellen. Gespeichert wird bei **GitHub** (ein kostenloser Online-Speicher
für genau solche Dateien).

Es gibt **zwei Varianten**: entweder **komplett aus der Foundry-Oberfläche**
(Variante A) oder über einen **automatischen Dienst auf deinem Linux-Server**
(Variante B). Beide können auch Bilder/Maps vollständig mitsichern.

**Kurz gesagt:** Du klickst in Foundry auf „Exportieren" – den Rest übernimmt das Modul.

### Was macht das Modul konkret?

- **Exportieren:** Objekt in Foundry auswählen → wird als Datei gespeichert.
  - **Rechtsklick** auf ein Objekt in der Seitenleiste → „Export nach Git"
  - oder **Buttons** oben in jeder Seitenleiste → Dialog mit Checkboxen für
    mehrere Objekte auf einmal
- **Sicherung bei GitHub:** Je nach Variante lädt entweder das Modul direkt beim
  Klick hoch (Variante A) oder ein Hintergrunddienst auf dem Server erledigt es
  automatisch (Variante B).
- **Bilder & Maps inklusive:** Referenzierte Bilder (Karten, Portraits, Token)
  werden auf Wunsch mitgesichert, damit Objekte vollständig übertragen werden.
- **Importieren:** Auf derselben oder einer anderen Foundry-Instanz die Dateien
  wieder einspielen – ebenfalls per Klick.

### Was du brauchst

**Für beide Varianten:**
- Eine **FoundryVTT v12**-Installation (du als **Spielleiter/GM**).
- Ein kostenloses **GitHub-Konto**.

**Zusätzlich nur für Variante B (Server):**
- **Zugang zum Linux-Server** (Benutzername + Passwort für die SSH-Verbindung).
- Etwa **15–20 Minuten** für die einmalige Server-Einrichtung.

> Variante A braucht **keinen** Server-Zugang und **kein** Terminal – alles läuft in
> der Foundry-Oberfläche.

### Zwei Wege – welchen nimmst du?

Schritt 1 (Modul installieren) gilt für **beide** Varianten. Danach wählst du eine:

| | **Variante A – GitHub direkt** | **Variante B – Server (Git-Ordner)** |
| --- | --- | --- |
| **Aufwand** | Ein paar Felder in den Modul-Einstellungen | Einmalige Einrichtung im Terminal |
| **Linux/Terminal nötig?** | **Nein** – alles in Foundry | Ja |
| **Wie es sichert** | Modul lädt direkt zu GitHub hoch/runter | Hintergrunddienst auf dem Server |
| **Läuft ohne offenes Foundry?** | Nein (Sichern beim Klick) | Ja (Server sichert automatisch) |
| **Bilder/Maps** | ✅ inklusive | ✅ inklusive |
| **Empfohlen für** | Die meisten – am einfachsten | Voll-automatische Server-Sicherung |

> **Bilder & Maps:** Beide Varianten können referenzierte Bilder (Karten, Portraits,
> Token) **vollständig mitsichern** (Standard-Einstellung „Assets mitsichern").

**Schnellstart:**
1. **[Modul installieren](#1-modul-installieren)** (für beide Varianten)
2. Dann entweder **[Variante A – GitHub direkt](#variante-a--github-direkt-ui-only-empfohlen)**
   **oder** **[Variante B – Server](#2-server-einrichten-einmalig--schritt-für-schritt-für-einsteiger)**

---

## Paketinhalt (was in diesem Projekt liegt)

Dieses Projekt besteht aus zwei Teilen: dem **Modul** (kommt nach Foundry) und den
**Server-Skripten** (kommen auf den Linux-Server).

```
git-object-sync/            <- Das FoundryVTT-Modul (kommt in Data/modules/)
  module.json
  scripts/main.js
  lang/{de,en}.json

server/                     <- Die Server-Skripte (kommen z. B. nach /opt/git-object-sync)
  setup-repo.sh             <- Richtet den Sicherungs-Ordner einmalig ein
  git-sync-commit.sh        <- Lädt Änderungen zu GitHub hoch (Sichern-Server, automatisch)
  git-object-sync-commit.service
  git-object-sync-commit.timer
  git-pull.sh               <- Holt Änderungen von GitHub (Nur-Lese-Server, automatisch)
  git-object-sync-pull.service
  git-object-sync-pull.timer
  .gitattributes            <- Regelt, wie große Dateien (Karten) gespeichert werden
```

---

## 1. Modul installieren

In diesem Schritt bringst du das Modul in deine Foundry-Installation.

**a) Modul-Ordner kopieren:** Kopiere den Ordner `git-object-sync/` in das
`modules`-Verzeichnis deiner Foundry-Installation, sodass es am Ende so aussieht:

```
<foundrydata>/Data/modules/git-object-sync/
```

`<foundrydata>` ist dein Foundry-Data-Ordner. Wo der liegt, siehst du in Foundry
auf der Startseite unter **Configuration** → „User Data Path".

**b) Modul aktivieren:** Starte deine Welt in Foundry und gehe zu
**Game Settings → Manage Modules**. Setze bei **„Git Object Sync"** das Häkchen
und speichere.

**c) Einstellungen öffnen:** Unter **Settings → Module Settings → „Git Object Sync"**
findest du alle Optionen. Die wichtigste ist der **Sync-Modus**:

- **Server (Git-Ordner)** – für Variante B (Standard)
- **GitHub (direkt, UI-only)** – für Variante A

Lass **„Assets mitsichern"** aktiviert, damit Bilder/Maps vollständig mitgesichert
werden. Welche weiteren Felder du ausfüllst, hängt von deiner Variante ab (siehe unten).

---

## Variante A – GitHub direkt (UI-only, empfohlen)

Bei dieser Variante brauchst du **keinen Server-Zugriff und kein Terminal**. Das
Modul spricht direkt mit GitHub – alles passiert in der Foundry-Oberfläche.

### A.1 – Ein leeres Repository auf GitHub anlegen

1. Auf **https://github.com** anmelden (oder kostenlos registrieren).
2. Oben rechts **+** → **New repository**.
3. **Repository name:** z. B. `foundry-content`.
4. Auf **Private** stellen und alle Häkchen leer lassen (das Repo muss leer sein).
5. **Create repository**. Notiere dir den Namen als `DEIN_GITHUB_NAME/REPO_NAME`.

### A.2 – Einen Zugriffs-Token erstellen (deine „Credentials")

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

### A.3 – Modul einstellen

In Foundry: **Settings → Module Settings → „Git Object Sync"**:

- **Sync-Modus:** `GitHub (direkt, UI-only)`
- **GitHub-Repository:** `DEIN_GITHUB_NAME/REPO_NAME` (z. B. `DominikGursch/foundry-content`)
- **GitHub-Branch:** `main`
- **GitHub-Token:** den kopierten Token einfügen
- **Assets mitsichern:** aktiviert lassen (Bilder/Maps inklusive)

Speichern – **fertig.** Ab jetzt kannst du direkt exportieren/importieren (siehe
**[So benutzt du es im Alltag](#so-benutzt-du-es-im-alltag)**). Die Abschnitte 2
und 3 (Server) brauchst du für Variante A **nicht**.

> **Sicherheit:** Der Token liegt in den Welt-Einstellungen (nur der GM sieht ihn).
> Verwende einen **fein granularen** Token, der **nur** auf dieses eine Repo und
> **nur** auf „Contents" beschränkt ist – niemals dein Konto-Passwort. Setze bei
> Bedarf ein Ablaufdatum. Möchtest du, dass Foundry gar nichts überschreiben kann,
> nutze stattdessen Variante B mit einem Nur-Lese-Deploy-Key.

---

## 2. Server einrichten (einmalig) – Schritt-für-Schritt für Einsteiger

> **Diese Abschnitte 2 und 3 betreffen nur Variante B (Server).** Wenn du Variante A
> (GitHub direkt) nutzt, bist du bereits fertig und kannst hier weiter zu
> **[So benutzt du es im Alltag](#so-benutzt-du-es-im-alltag)** springen.

Diese Anleitung ist für Menschen gedacht, die **noch nie** mit Linux oder Git
gearbeitet haben. Arbeite die Schritte **von oben nach unten** ab. Jeder Befehl
wird in ein schwarzes Terminal-Fenster auf dem Server eingegeben und mit `Enter`
bestätigt.

### Deine Platzhalter – einmal ausfüllen und überall einsetzen

In den Befehlen unten stehen **Platzhalter in GROSSBUCHSTABEN**. Ersetze sie
jedes Mal durch deine eigenen Werte. Schreib sie dir am besten einmal auf:

| Platzhalter        | Was ist das?                                                        | Beispiel                                            |
| ------------------ | ------------------------------------------------------------------- | --------------------------------------------------- |
| `DEIN_LINUX_USER`  | Der Benutzername, unter dem Foundry auf dem Server läuft            | `foundry`                                           |
| `DATA_PFAD`        | Der Pfad zum Foundry-**Data**-Ordner                                | `/home/foundry/foundrydata`                         |
| `DEIN_GITHUB_NAME` | Dein Benutzername auf GitHub                                         | `DominikGursch`                                     |
| `REPO_NAME`        | Name des (leeren) GitHub-Repos für deine Foundry-Inhalte            | `foundry-content`                                   |

> Du kennst `DEIN_LINUX_USER` oder `DATA_PFAD` nicht? Wenn Foundry läuft, findest
> du den Data-Ordner in Foundry unter **Configuration** → „User Data Path". Der
> Linux-Benutzer ist meist der Name, mit dem du dich am Server anmeldest – tippe
> `whoami` ins Terminal, dann steht er da.

---

### Schritt 2.1 – Mit dem Server verbinden

Du steuerst den Server über eine Textverbindung namens **SSH**. Öffne auf deinem
PC ein Terminal (Windows: „PowerShell", Mac/Linux: „Terminal") und tippe:

```bash
ssh DEIN_LINUX_USER@SERVER-IP-ODER-ADRESSE
```

Beim ersten Mal fragt er „Are you sure…?" → tippe `yes` und `Enter`, danach dein
Passwort. Ab jetzt landen **alle** folgenden Befehle in diesem Fenster.

---

### Schritt 2.2 – Benötigte Programme installieren

Git (die Versionsverwaltung) und Git LFS (für große Karten-/Bilddateien):

```bash
sudo apt update
sudo apt install -y git git-lfs
```

> `sudo` bedeutet „mit Administrator-Rechten". Es fragt evtl. nach deinem Passwort.
> Falls dein Server kein `apt` nutzt (z. B. Fedora), ersetze `apt` durch `dnf`.

---

### Schritt 2.3 – Ein leeres Repository auf GitHub anlegen

Das „Repository" (kurz „Repo") ist der Online-Ordner, in den deine Foundry-Objekte
gesichert werden.

1. Melde dich auf **https://github.com** an (oder registriere dich kostenlos).
2. Klicke oben rechts auf **+** → **New repository**.
3. **Repository name:** trage deinen `REPO_NAME` ein (z. B. `foundry-content`).
4. Setze es auf **Private** (empfohlen, damit niemand deine Inhalte sieht).
5. Lass alle Häkchen (README, .gitignore, License) **leer** – das Repo muss leer sein.
6. Klicke **Create repository**.

Du brauchst jetzt keine weiteren Klicks – die Verbindung richten wir im nächsten
Schritt ein.

---

### Schritt 2.4 – Die „Credentials" einrichten (SSH-Schlüssel)

Damit der Server **ohne Passwort-Eingabe** zu GitHub hochladen darf, erzeugst du
ein Schlüsselpaar: einen **privaten** Schlüssel (bleibt geheim auf dem Server) und
einen **öffentlichen** Schlüssel (den trägst du bei GitHub ein). Das sind deine
„Credentials".

**a) Schlüssel auf dem Server erzeugen** (einfach mehrmals `Enter` drücken, keine
Passphrase nötig):

```bash
ssh-keygen -t ed25519 -C "foundry-server" -f ~/.ssh/id_ed25519 -N ""
```

**b) Den öffentlichen Schlüssel anzeigen und komplett kopieren:**

```bash
cat ~/.ssh/id_ed25519.pub
```

Es erscheint eine Zeile, die mit `ssh-ed25519 …` beginnt und mit `foundry-server`
endet. Markiere diese **ganze Zeile** und kopiere sie.

**c) Den Schlüssel bei GitHub hinterlegen:**

1. Öffne im Browser **https://github.com/settings/keys**
2. Klicke **New SSH key**.
3. **Title:** irgendein Name, z. B. `Foundry Server`.
4. **Key:** füge die kopierte Zeile aus Schritt b) ein.
5. Klicke **Add SSH key**.

**d) Testen, ob die Verbindung klappt** (zurück im Server-Terminal):

```bash
ssh -T git@github.com
```

Erscheint sinngemäß „Hi DEIN_GITHUB_NAME! You've successfully authenticated…",
sind deine Credentials korrekt eingerichtet. ✅

---

### Schritt 2.5 – Die Skripte auf den Server kopieren

Lege die mitgelieferten Server-Skripte an einen festen Ort (`/opt/git-object-sync`)
und mache sie ausführbar:

```bash
sudo mkdir -p /opt/git-object-sync
sudo cp server/*.sh server/.gitattributes /opt/git-object-sync/
sudo chmod +x /opt/git-object-sync/*.sh
```

> Das setzt voraus, dass die Dateien aus dem Ordner `server/` bereits auf dem
> Server liegen (z. B. per `git clone` dieses Projekts oder per Datei-Upload).
> Falls nicht: kopiere den `server/`-Ordner vorher auf den Server.

---

### Schritt 2.6 – Das Foundry-Repo einrichten

Jetzt verbindest du den Foundry-Export-Ordner mit deinem GitHub-Repo. Ersetze die
Platzhalter durch deine Werte aus der Tabelle oben:

```bash
/opt/git-object-sync/setup-repo.sh \
  DATA_PFAD/Data/git-export \
  git@github.com:DEIN_GITHUB_NAME/REPO_NAME.git
```

Konkretes Beispiel:

```bash
/opt/git-object-sync/setup-repo.sh \
  /home/foundry/foundrydata/Data/git-export \
  git@github.com:DominikGursch/foundry-content.git
```

Das Skript legt den Ordner an, macht ihn zum Git-Repo, aktiviert Git LFS und
verbindet ihn mit GitHub. Wenn am Ende `[setup] Fertig.` steht, hat alles geklappt.

---

## 3. Die Automatik einschalten (im Hintergrund)

Jetzt richtest du ein, dass der Server **von allein** arbeitet. Dafür sorgt ein
„Timer" von systemd (die eingebaute Zeitschaltuhr von Linux).

Es gibt **zwei Betriebsarten** – wähle die, die zu deinem Server passt:

| Betriebsart | Für welchen Server? | Was macht er? | Zugriff aufs Repo |
| ----------- | ------------------- | ------------- | ----------------- |
| **A – Sichern (Pull + Push)** | Dein Haupt-Server, auf dem du in Foundry exportierst | Lädt neue Exporte **zu GitHub hoch** | Schreiben |
| **B – Nur Laden (Nur Pull)** | Ein Zweit-/Import-Server, der Inhalte nur übernimmt | **Holt** die neuesten Dateien von GitHub, ändert selbst nichts | Nur Lesen |

> Du hast nur **einen** Server, auf dem du exportierst? Dann brauchst du nur
> **Option A**. Option B ist für ein zweites, reines „Empfänger"-System gedacht.

---

### Option A – Automatisch sichern (Pull + Push)

Für den Server, auf dem du Objekte exportierst. Er lädt deine Exporte regelmäßig
zu GitHub hoch. Voraussetzung: die Schritte 1 und 2 sind erledigt.

**A.1 – Konfigurationsdatei anpassen.** Öffne die Datei mit einem einfachen Editor:

```bash
sudo nano server/git-object-sync-commit.service
```

Passe diese Zeilen an (Platzhalter aus der Tabelle in Abschnitt 2 einsetzen):

```ini
User=DEIN_LINUX_USER
Group=DEIN_LINUX_USER
ExecStart=/opt/git-object-sync/git-sync-commit.sh DATA_PFAD/Data/git-export
Environment=HOME=/home/DEIN_LINUX_USER
```

Speichern in `nano`: `Strg`+`O`, dann `Enter`, dann `Strg`+`X` zum Schließen.

> Die Zeile `Environment=HOME=…` ist wichtig, damit der Timer deinen SSH-Schlüssel
> aus Schritt 2.4 findet.

**A.2 – Timer aktivieren.**

```bash
sudo cp server/git-object-sync-commit.service /etc/systemd/system/
sudo cp server/git-object-sync-commit.timer   /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now git-object-sync-commit.timer
```

**A.3 – Prüfen, ob es läuft.**

```bash
# Wann läuft der Timer das nächste Mal?
systemctl list-timers | grep git-object-sync

# Was ist beim letzten Lauf passiert?
journalctl -u git-object-sync-commit.service --no-pager -n 20
```

Standard: erster Lauf 2 Minuten nach dem Server-Start, danach **alle 5 Minuten**.
Intervall ändern: in `git-object-sync-commit.timer` den Wert `OnUnitActiveSec`
anpassen (z. B. `10min`) und danach `sudo systemctl daemon-reload` ausführen.

---

### Option B – Automatisch nur laden (Nur Pull, Nur-Lese-Server)

Für einen zweiten Server, der Inhalte nur **empfängt** und selbst nichts verändert.
Damit dieser Server technisch **gar nicht** hochladen kann, bekommt er nur einen
**Lese-Zugriff** auf GitHub („Deploy Key") und lädt regelmäßig herunter.

**B.1 – Programme installieren** (falls noch nicht geschehen, wie Schritt 2.2):

```bash
sudo apt update
sudo apt install -y git git-lfs
```

**B.2 – SSH-Schlüssel erzeugen** (wie Schritt 2.4a):

```bash
ssh-keygen -t ed25519 -C "foundry-readonly" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Kopiere die angezeigte `ssh-ed25519 …`-Zeile.

**B.3 – Als NUR-LESE-Zugriff bei GitHub hinterlegen (Deploy Key).** Das ist der
entscheidende Unterschied zu Option A – so kann dieser Server nicht hochladen:

1. Öffne dein Repo auf GitHub → **Settings** → **Deploy keys**
   (direkt: `https://github.com/DEIN_GITHUB_NAME/REPO_NAME/settings/keys`)
2. Klicke **Add deploy key**.
3. **Title:** z. B. `Foundry Import-Server (read-only)`.
4. **Key:** die kopierte Zeile aus B.2 einfügen.
5. **„Allow write access" NICHT anhaken.** ← sorgt für reinen Lesezugriff.
6. Klicke **Add key**.

> **Wichtig:** Diesen Schlüssel **nicht** zusätzlich unter
> `github.com/settings/keys` (Konto-Ebene) eintragen – das würde den Schreibschutz
> aushebeln.

**B.4 – Skripte auf den Server kopieren** (wie Schritt 2.5):

```bash
sudo mkdir -p /opt/git-object-sync
sudo cp server/*.sh server/.gitattributes /opt/git-object-sync/
sudo chmod +x /opt/git-object-sync/*.sh
```

**B.5 – Das Repo herunterladen (klonen).** Auf dem Nur-Lese-Server richtest du das
Repo **nicht** mit `setup-repo.sh` ein, sondern klonst das bestehende Repo direkt
in den Export-Ordner:

```bash
git clone git@github.com:DEIN_GITHUB_NAME/REPO_NAME.git DATA_PFAD/Data/git-export
```

Konkretes Beispiel:

```bash
git clone git@github.com:DominikGursch/foundry-content.git /home/foundry/foundrydata/Data/git-export
```

**B.6 – Konfigurationsdatei anpassen.**

```bash
sudo nano server/git-object-sync-pull.service
```

Passe diese Zeilen an (Platzhalter einsetzen):

```ini
User=DEIN_LINUX_USER
Group=DEIN_LINUX_USER
ExecStart=/opt/git-object-sync/git-pull.sh DATA_PFAD/Data/git-export
Environment=HOME=/home/DEIN_LINUX_USER
```

Speichern: `Strg`+`O`, `Enter`, `Strg`+`X`.

**B.7 – Timer aktivieren.**

```bash
sudo cp server/git-object-sync-pull.service /etc/systemd/system/
sudo cp server/git-object-sync-pull.timer   /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now git-object-sync-pull.timer
```

**B.8 – Prüfen, ob es läuft.**

```bash
systemctl list-timers | grep git-object-sync
journalctl -u git-object-sync-pull.service --no-pager -n 20
```

Standard: erster Lauf 2 Minuten nach dem Start, danach **alle 5 Minuten**.
Intervall ändern: in `git-object-sync-pull.timer` den Wert `OnUnitActiveSec`
anpassen und danach `sudo systemctl daemon-reload` ausführen.

> **Hinweis:** Aktiviere auf einem Nur-Lese-Server **nur** den Pull-Timer
> (`…-pull.timer`), **nicht** den Commit-Timer aus Option A.

---

## So benutzt du es im Alltag

Nach der Einrichtung ist die tägliche Nutzung in **beiden Varianten** gleich einfach –
du bleibst komplett in Foundry.

### Etwas sichern (Exportieren)

1. Objekt(e) auswählen – per **Rechtsklick → „Export nach Git"** oder über den
   **„Git Export …"-Button** oben in der Seitenleiste (dort kannst du mehrere
   Objekte anhaken).
2. Das Modul sichert die Objekte **inklusive Bilder/Maps**:
   - **Variante A:** direkt zu GitHub (sofort).
   - **Variante B:** in den Ordner `Data/git-export/…`; der Server-Dienst lädt sie
     innerhalb weniger Minuten hoch.

### Etwas wiederherstellen (Importieren)

Funktioniert auf derselben Instanz (z. B. nach einem Fehler) oder auf einer anderen
Foundry-Installation.

1. Auf den **„Git Import …"-Button** klicken.
2. Gewünschte Dateien anhaken → importieren. Referenzierte Bilder/Maps werden
   automatisch mit wiederhergestellt.

> **Variante B – neueste Stände holen:** Auf einem Import-/Zweitserver holt der
> Pull-Timer die Dateien automatisch (siehe **Option B**). Manuell geht es per SSH
> mit `git pull` im `git-export`-Ordner. Bei **Variante A** liest das Modul beim
> Import ohnehin direkt den aktuellen Stand aus GitHub.

---

## Wenn etwas nicht klappt (Problemlösung)

**Variante A (GitHub direkt):**

- **„GitHub 401" / „GitHub 403":** Der Token fehlt, ist abgelaufen oder hat nicht
  **Contents: Read and write** für das Repo. Token in den Modul-Einstellungen prüfen
  (Schritt A.2/A.3).
- **„GitHub 404":** Der Repository-Name ist falsch (muss `owner/repo` sein) oder der
  Token hat keinen Zugriff auf genau dieses Repo.
- **Nichts zu importieren:** Es wurde für diesen Typ noch nichts exportiert, oder der
  **GitHub-Branch** in den Einstellungen stimmt nicht (Standard: `main`).

**Variante B (Server):**

- **Der SSH-Test in Schritt 2.4d schlägt fehl** („Permission denied"): Der
  öffentliche Schlüssel wurde nicht (korrekt) bei GitHub eingetragen. Wiederhole
  Schritt 2.4b/c und achte darauf, die **ganze** Zeile zu kopieren.
- **Es wird nichts zu GitHub hochgeladen:** Prüfe den letzten Lauf mit
  `journalctl -u git-object-sync-commit.service --no-pager -n 20`. Steht dort
  „git push fehlgeschlagen", stimmt meist der Schlüssel (2.4) oder die Zeile
  `Environment=HOME=…` in der `.service`-Datei (3.1) nicht.
- **„command not found: git":** Git ist noch nicht installiert – hole Schritt 2.2 nach.
- **Falscher Pfad / falscher Benutzer:** In der `.service`-Datei müssen `User`,
  `Group`, der Pfad hinter `ExecStart` und `HOME` zu deinem Server passen (Schritt 3.1).

---

## Gut zu wissen (technische Hinweise)

- **Karten & Bilder:** Mit aktivierter Einstellung **„Assets mitsichern"** kopiert das
  Modul referenzierte Bilder (Karten, Portraits, Token) automatisch mit – beim Export
  **und** beim Import. So funktionieren Szenen und Charaktere auch auf einer anderen
  Instanz vollständig. Ausgelassen werden nur allgemein vorhandene Dateien (Core-,
  System- und Modul-Assets) sowie externe Web-Adressen (`http(s)://…`).
  - **Variante A (GitHub):** Bilder werden als eigene Dateien im Repo abgelegt
    (bis 100 MB pro Datei).
  - **Variante B (Server):** Bilder landen unter `git-export/assets/…`; die
    mitgelieferte `.gitattributes` speichert große Dateien effizient per Git LFS.
- **IDs bleiben erhalten:** Beim Import behält ein Objekt seine ursprüngliche Kennung.
  Existiert es schon, wird es aktualisiert (wenn „Beim Import überschreiben" aktiv
  ist) – ansonsten als Kopie angelegt.
- **Nur für Spielleiter:** Export und Import sind nur als GM verfügbar.
- **Kein Neustart nötig:** Anders als das offizielle `fvtt`-Tool muss Foundry zum
  Exportieren/Importieren **nicht** heruntergefahren werden.
- **Alles-in-einer-Datei:** Charaktere nehmen ihre Items/Effekte mit, Journale ihre
  Seiten, Szenen ihre Tokens/Notizen/Lichter – jeweils in einer einzigen Datei.
