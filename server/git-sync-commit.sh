#!/usr/bin/env bash
#
# git-sync-commit.sh
# Committet neue/geänderte Exporte gebündelt und pusht sie zum Remote.
# Wird per systemd-Timer regelmäßig aufgerufen.
#
# Aufruf:
#   ./git-sync-commit.sh /pfad/zu/foundrydata/Data/git-export
#
set -euo pipefail

REPO_DIR="${1:-}"
if [[ -z "$REPO_DIR" || ! -d "$REPO_DIR/.git" ]]; then
  echo "Kein gültiges Git-Repository: $REPO_DIR" >&2
  exit 1
fi

cd "$REPO_DIR"

# Nichts zu tun?
if git diff --quiet && git diff --cached --quiet && [[ -z "$(git status --porcelain)" ]]; then
  exit 0
fi

git add -A

# Kurze Zusammenfassung der Änderungen in die Commit-Message.
SUMMARY="$(git diff --cached --shortstat || true)"
STAMP="$(date '+%Y-%m-%d %H:%M:%S')"
git commit -m "Auto-Sync ${STAMP}" -m "${SUMMARY}" >/dev/null

# Push nur, wenn ein Remote namens origin existiert.
if git remote get-url origin >/dev/null 2>&1; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  git push -u origin "$BRANCH" || echo "[warn] git push fehlgeschlagen (Remote/Credentials prüfen)." >&2
fi

echo "[ok] Commit erstellt: Auto-Sync ${STAMP}"
