# Git Object Sync (FoundryVTT v12)

Export und Import einzelner FoundryVTT-Objekte (Actors, Items, Szenen, Journal)
als JSON-Dateien in einen Ordner, der auf deinem Linux-Server als **Git-Repository**
versioniert wird. Auswahl erfolgt bequem im Foundry-UI:

- **Rechtsklick** auf ein Objekt in der Seitenleiste → „Export nach Git"
- **Buttons** oben in jeder Verzeichnis-Seitenleiste → Checkbox-Dialog für
  Mehrfach-Export und -Import

Das Committen und Pushen nach Git passiert **vollautomatisch** im Hintergrund
(gebündelt per systemd-Timer). Dein einziger manueller Schritt ist das Auswählen.

---

## Paketinhalt

```
git-object-sync/            <- FoundryVTT-Modul (in Data/modules/ kopieren)
  module.json
  scripts/main.js
  lang/{de,en}.json

server/                     <- Auf dem Linux-Server ablegen (z. B. /opt/git-object-sync)
  setup-repo.sh             <- Repo einmalig einrichten (inkl. Git LFS)
  git-sync-commit.sh        <- Commit + Push (wird vom Timer aufgerufen)
  git-object-sync-commit.service
  git-object-sync-commit.timer
  .gitattributes            <- Text/LFS-Regeln
```

---

## 1. Modul installieren

Kopiere den Ordner `git-object-sync/` in das `modules`-Verzeichnis deiner
Foundry-Installation:

```
<foundrydata>/Data/modules/git-object-sync/
```

Dann in Foundry: **Game Settings → Manage Modules → „Git Object Sync"** aktivieren.

Unter **Settings → Module Settings** kannst du bei Bedarf den Export-Ordner
(Standard: `git-export`) und das Überschreib-Verhalten beim Import anpassen.

> Der Export-Ordner liegt relativ zum Foundry **Data**-Verzeichnis, d. h.
> `git-export` entspricht `<foundrydata>/Data/git-export`.

---

## 2. Server einrichten (einmalig) – Schritt-für-Schritt für Einsteiger

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

## 3. Die Automatik einschalten (Sicherung im Hintergrund)

Ab jetzt soll der Server deine Exporte **von allein** regelmäßig zu GitHub hochladen.
Dafür sorgt ein „Timer" von systemd (das ist die eingebaute Zeitschaltuhr von Linux).

### Schritt 3.1 – Die Konfigurationsdatei anpassen

In der Datei `git-object-sync-commit.service` stehen **zwei Dinge, die du auf deine
Umgebung anpassen musst**. Öffne sie mit einem einfachen Editor:

```bash
sudo nano server/git-object-sync-commit.service
```

Passe diese Zeilen an (die Platzhalter aus der Tabelle einsetzen):

```ini
User=DEIN_LINUX_USER
Group=DEIN_LINUX_USER
ExecStart=/opt/git-object-sync/git-sync-commit.sh DATA_PFAD/Data/git-export
Environment=HOME=/home/DEIN_LINUX_USER
```

Speichern in `nano`: `Strg`+`O`, dann `Enter`, dann `Strg`+`X` zum Schließen.

> Die Zeile `Environment=HOME=…` ist wichtig, damit der Timer deinen SSH-Schlüssel
> aus Schritt 2.4 findet.

### Schritt 3.2 – Den Timer aktivieren

```bash
sudo cp server/git-object-sync-commit.service /etc/systemd/system/
sudo cp server/git-object-sync-commit.timer   /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now git-object-sync-commit.timer
```

### Schritt 3.3 – Prüfen, ob es läuft

```bash
# Wann läuft der Timer das nächste Mal?
systemctl list-timers | grep git-object-sync

# Was ist beim letzten Lauf passiert?
journalctl -u git-object-sync-commit.service --no-pager -n 20
```

Standard: erster Lauf 2 Minuten nach dem Server-Start, danach **alle 5 Minuten**.
Möchtest du das Intervall ändern, passe in `git-object-sync-commit.timer` den Wert
`OnUnitActiveSec` an (z. B. `10min` oder `15min`) und führe danach
`sudo systemctl daemon-reload` aus.

---

## Typischer Ablauf

**Exportieren**
1. In Foundry Objekt(e) auswählen (Rechtsklick oder „Git Export …"-Button → anhaken).
2. Dateien landen unter `Data/git-export/{actors,items,scenes,journal}/`.
3. Der Timer committet + pusht sie automatisch.

**Importieren (auf einer anderen/derselben Instanz)**
1. Auf dem Server `git pull` im `git-export`-Ordner (z. B. per Cron/Timer, oder manuell).
2. In Foundry „Git Import …" klicken → gewünschte Dateien anhaken → importieren.

---

## Wichtige Hinweise

- **Maps/Bilder:** Der Szenen-Export speichert die JSON mit **Verweis** auf die
  Bilddatei (z. B. `worlds/…/maps/x.webp`). Die eigentlichen Bilddateien werden
  **nicht** vom Modul mitkopiert. Damit eine Szene woanders vollständig funktioniert,
  müssen die referenzierten Asset-Ordner ebenfalls im Repo liegen. Am einfachsten:
  Asset-Ordner in `git-export/` ablegen (oder hineinsymlinken) – die `.gitattributes`
  sorgt via Git LFS für effiziente Versionierung.
- **IDs bleiben erhalten:** Beim Import wird die ursprüngliche `_id` beibehalten
  (`keepId`). Existiert das Objekt schon, wird es aktualisiert (Einstellung
  „Beim Import überschreiben") – sonst als Kopie angelegt.
- **Nur GM:** Export/Import-Funktionen sind auf Spielleiter beschränkt.
- **Läuft im Betrieb:** Anders als das offizielle `fvtt`-CLI muss Foundry für
  Export/Import **nicht** heruntergefahren werden.
- **Embedded-Daten:** Actors exportieren ihre eingebetteten Items/Effekte mit;
  Journals ihre Seiten; Szenen ihre Tokens/Notes/Lights usw. – alles in einer Datei.
