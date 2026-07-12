#!/usr/bin/env bash
#
# git-pull.sh
# Holt die neuesten Objekt-Exporte vom Remote (NUR Lesen, kein Push).
# Gedacht für Import-/Nur-Lese-Server. Wird per systemd-Timer regelmäßig aufgerufen.
#
# Aufruf:
#   ./git-pull.sh /pfad/zu/foundrydata/Data/git-export
#
set -euo pipefail

REPO_DIR="${1:-}"
if [[ -z "$REPO_DIR" || ! -d "$REPO_DIR/.git" ]]; then
  echo "Kein gültiges Git-Repository: $REPO_DIR" >&2
  echo "Hinweis: Auf einem Nur-Lese-Server das Repo zuerst mit 'git clone' anlegen." >&2
  exit 1
fi

cd "$REPO_DIR"

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Kein Remote 'origin' konfiguriert: $REPO_DIR" >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# Neueste Commits holen ...
git fetch --quiet origin "$BRANCH"

# ... und nur per Fast-Forward übernehmen, damit auf diesem Server nichts
# überschrieben wird, das nicht vom Remote stammt.
if git merge --ff-only "origin/$BRANCH" >/dev/null 2>&1; then
  echo "[ok] Aktualisiert auf origin/$BRANCH ($(date '+%Y-%m-%d %H:%M:%S'))"
else
  echo "[warn] Kein Fast-Forward möglich – lokale Änderungen vorhanden?" >&2
  echo "       Auf einem Nur-Lese-Server sollten hier keine eigenen Commits liegen." >&2
  exit 1
fi
