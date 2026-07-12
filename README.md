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

## 2. Git-Repository einrichten (einmalig, auf dem Server)

```bash
# Skripte ablegen und ausführbar machen
sudo mkdir -p /opt/git-object-sync
sudo cp server/*.sh server/.gitattributes /opt/git-object-sync/
sudo chmod +x /opt/git-object-sync/*.sh

# Repo im Foundry-Data-Ordner initialisieren (Pfad anpassen!)
# Optional mit Remote-URL als 2. Argument.
/opt/git-object-sync/setup-repo.sh \
  /home/foundry/foundrydata/Data/git-export \
  git@github.com:DEINUSER/foundry-content.git
```

`setup-repo.sh` legt das Repo an, aktiviert Git LFS (für Maps/Tokens/Audio) und
kopiert die `.gitattributes` hinein.

> **Remote/Push:** Wenn du automatisch pushen willst, muss der Foundry-Systembenutzer
> Zugriff auf das Remote haben (SSH-Key in `~/.ssh` oder ein Credential-Helper).
> Ohne Remote wird nur lokal committet.

---

## 3. Automatisches Commit/Push aktivieren (systemd-Timer)

Passe in `git-object-sync-commit.service` **User/Group** und den **Repo-Pfad**
(letztes Argument von `ExecStart`) an. Dann:

```bash
sudo cp server/git-object-sync-commit.service /etc/systemd/system/
sudo cp server/git-object-sync-commit.timer   /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now git-object-sync-commit.timer

# Status / letzte Läufe prüfen
systemctl list-timers | grep git-object-sync
journalctl -u git-object-sync-commit.service --no-pager -n 20
```

Standard: erster Lauf 2 Minuten nach Boot, danach alle 5 Minuten. Intervall in
der `.timer`-Datei (`OnUnitActiveSec`) anpassbar.

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
