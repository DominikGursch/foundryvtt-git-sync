#!/usr/bin/env node
/**
 * Git Object Sync – Compendium Builder
 * -------------------------------------------------------------------------
 * CI-Hilfswerkzeug für das PRIVATE Inhalte-Repo (das andere Repo, in das das
 * Foundry-Modul "Git Object Sync" exportiert – NICHT dieses Modul-Repo hier).
 *
 * Baut aus den flach exportierten JSON-Dateien
 *   actors/*.json, items/*.json, scenes/*.json, journal/*.json,
 *   compendia/<pack.collection>/*.json
 * echte, installierbare FoundryVTT-Kompendien (LevelDB-Packs unter packs/<name>)
 * und schreibt/aktualisiert ein module.json, damit das Repo selbst als
 * Foundry-Modul installiert/aktualisiert werden kann (kein manueller Import
 * über den Git-Object-Sync-Dialog mehr nötig).
 *
 * Wichtige Hintergründe (siehe README.md in diesem Ordner für Details):
 * - Ein Kompendium enthält immer nur EINEN Dokumenttyp. "Alle Komponenten in
 *   ein Kompendium" gibt es technisch nicht – dieses Skript baut daher pro
 *   Quell-Ordner/-Kompendium ein eigenes Pack (mehrere Packs pro Lauf).
 * - compilePack() aus @foundryvtt/foundryvtt-cli kümmert sich NICHT selbst um
 *   Ordner-Hierarchien – es schreibt jede Datei anhand ihres eigenen `_key`-
 *   Felds ("!<collection>!<id>") in die LevelDB, Ordner sind einfach weitere
 *   Dokumente mit `_key: "!folders!<id>"`. Dieses Skript synthetisiert daher
 *   aus dem von Git Object Sync mitgelieferten `folderPath`-Flag passende
 *   Folder-Dokumente und verknüpft die Inhalts-Dokumente per `data.folder`
 *   (siehe lib.mjs: resolveFolderPath/reshapeDocument).
 * - Damit wiederholte Läufe (Cron) keine doppelten Ordner anlegen, werden
 *   Ordner-IDs deterministisch aus (Pack-Name + Namenspfad) abgeleitet
 *   (siehe lib.mjs: stableId()) – derselbe Pfad ergibt immer dieselbe ID.
 *
 * Nutzung (im Wurzelverzeichnis des privaten Inhalte-Repos):
 *   npm install
 *   node build-packs.mjs
 *
 * Siehe README.md für die empfohlene GitHub-Actions-Automatisierung.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { collectSourceGroups, readJsonFiles, reshapeDocument, buildModuleManifest } from "./lib.mjs";

async function buildGroup(group, { repoRoot, stagingRoot, outRoot, log }) {
  const raws = readJsonFiles(group.srcDir);
  if (!raws.length) {
    if (log) console.log(`(übersprungen, keine Dateien) ${group.dir}`);
    return null;
  }

  const stagingDir = path.join(stagingRoot, group.packName);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  const seenFolders = new Map(); // "<packName>::<Pfad>" -> Folder-ID, verhindert doppelte Ordner
  const writtenFolderIds = new Set();
  let docCount = 0;

  for (const raw of raws) {
    const { doc, folderDocs } = reshapeDocument(raw, { type: group.type, packName: group.packName, seenFolders });
    for (const folderDoc of folderDocs) {
      if (writtenFolderIds.has(folderDoc._id)) continue;
      writtenFolderIds.add(folderDoc._id);
      fs.writeFileSync(path.join(stagingDir, `_folder-${folderDoc._id}.json`), JSON.stringify(folderDoc, null, 2));
    }
    fs.writeFileSync(path.join(stagingDir, `${doc._id}.json`), JSON.stringify(doc, null, 2));
    docCount++;
  }

  const outDir = path.join(outRoot, group.packName);
  await compilePack(stagingDir, outDir, { log });

  return {
    name: group.packName,
    label: group.packLabel,
    type: group.type,
    path: path.relative(repoRoot, outDir).replace(/\\/g, "/"),
    docCount,
    folderCount: writtenFolderIds.size
  };
}

function writeModuleManifest(repoRoot, packs, log) {
  const manifestPath = path.join(repoRoot, "module.json");
  const existing = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
  const manifest = buildModuleManifest(existing, packs);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  if (log) console.log(`module.json aktualisiert (${packs.length} Pack(s)).`);
}

async function main() {
  // Wurzelverzeichnis des Inhalte-Repos IMMER relativ zum Speicherort dieses
  // Skripts bestimmen (nicht relativ zum aktuellen Arbeitsverzeichnis). So
  // funktioniert der Aufruf unabhängig davon, ob man `npm run build` bzw.
  // `node build-packs.mjs` aus dem Ordner "compendium-builder/" heraus oder
  // `node compendium-builder/build-packs.mjs` aus der Repo-Wurzel ausführt -
  // beides ist in der Praxis üblich und soll ohne Stolperfallen funktionieren.
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.dirname(scriptDir);
  const stagingRoot = path.join(scriptDir, ".pack-build");
  const outRoot = path.join(repoRoot, "packs");
  const log = true;

  const groups = collectSourceGroups(repoRoot);
  if (!groups.length) {
    console.log("Keine Export-Ordner gefunden (actors/, items/, scenes/, journal/, compendia/*). Nichts zu tun.");
    return;
  }

  const built = [];
  for (const group of groups) {
    console.log(`\n--- Baue Pack "${group.packName}" (${group.type}) aus ${group.dir} ---`);
    const result = await buildGroup(group, { repoRoot, stagingRoot, outRoot, log });
    if (result) built.push(result);
  }

  fs.rmSync(stagingRoot, { recursive: true, force: true });

  if (!built.length) {
    console.log("Keine Dokumente gefunden – module.json bleibt unverändert.");
    return;
  }

  writeModuleManifest(repoRoot, built, log);

  console.log("\nFertig:");
  for (const p of built) {
    console.log(`  - ${p.name}: ${p.docCount} Dokument(e), ${p.folderCount} Ordner -> ${p.path}`);
  }
}

// Nur ausführen, wenn direkt aufgerufen (nicht beim Import in Tests).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
