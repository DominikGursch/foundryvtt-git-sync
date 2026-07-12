#!/usr/bin/env bash
#
# setup-repo.sh
# Initialisiert den Git-Export-Ordner als Repository (inkl. Git LFS für Maps).
#
# Aufruf:
#   ./setup-repo.sh /pfad/zu/foundrydata/Data/git-export [git@remote:user/repo.git]
#
set -euo pipefail

REPO_DIR="${1:-}"
REMOTE_URL="${2:-}"

if [[ -z "$REPO_DIR" ]]; then
  echo "Verwendung: $0 <REPO_DIR> [REMOTE_URL]" >&2
  echo "Beispiel:  $0 /home/foundry/foundrydata/Data/git-export git@github.com:user/foundry-content.git" >&2
  exit 1
fi

mkdir -p "$REPO_DIR"
cd "$REPO_DIR"

if [[ ! -d .git ]]; then
  git init -b main
  echo "[setup] Git-Repository in $REPO_DIR angelegt."
else
  echo "[setup] Git-Repository existiert bereits."
fi

# Git LFS für binäre Assets (Maps, Tokens, Audio) aktivieren.
if command -v git-lfs >/dev/null 2>&1; then
  git lfs install --local
else
  echo "[setup] WARNUNG: git-lfs ist nicht installiert. Große Bild-/Audiodateien werden ohne LFS versioniert."
fi

# .gitattributes aus dem Skriptverzeichnis kopieren, falls vorhanden.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/.gitattributes" && ! -f "$REPO_DIR/.gitattributes" ]]; then
  cp "$SCRIPT_DIR/.gitattributes" "$REPO_DIR/.gitattributes"
  echo "[setup] .gitattributes kopiert."
fi

# Sinnvolle Git-Identität setzen, falls global nichts konfiguriert ist.
git config user.name  >/dev/null 2>&1 || git config user.name  "Foundry Git Object Sync"
git config user.email >/dev/null 2>&1 || git config user.email "foundry@localhost"

if [[ -n "$REMOTE_URL" ]]; then
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$REMOTE_URL"
  else
    git remote add origin "$REMOTE_URL"
  fi
  echo "[setup] Remote 'origin' = $REMOTE_URL"
fi

git add -A
git commit -m "Initial commit (Git Object Sync)" --allow-empty
echo "[setup] Fertig. Ordner ist bereit für automatische Commits."
