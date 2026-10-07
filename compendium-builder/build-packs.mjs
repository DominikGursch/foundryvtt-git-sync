#!/usr/bin/env node
/**
 * Foundry Git Sync – Compendium Builder
 * -------------------------------------------------------------------------
 * CI helper tool for the PRIVATE content repository (the other repository
 * exported to by the "Foundry Git Sync" Foundry module, NOT this module repo).
 *
 * Build installable FoundryVTT compendiums from the flat JSON exports
 *   actors/*.json, items/*.json, scenes/*.json, journal/*.json,
 *   compendia/<pack.collection>/*.json
 * (LevelDB packs under packs/<name>) and create/update module.json so the
 * repository itself can be installed as a Foundry module. No manual import
 * through the Foundry Git Sync dialog is needed.
 *
 * Important background (see README.md in this directory for details):
 * - A compendium contains only ONE document type. Mixed compendiums are not
 *   supported, so this script builds a separate pack for each source
 *   directory/compendium (multiple packs per run).
 * - compilePack() from @foundryvtt/foundryvtt-cli does NOT create folder
 *   hierarchies. It writes each file to LevelDB using its `_key` field
 *   ("!<collection>!<id>"); folders are additional documents with
 *   `_key: "!folders!<id>"`. This script therefore synthesizes Folder
 *   documents from the `folderPath` flag supplied by Foundry Git Sync and links
 *   content documents through `data.folder` (see resolveFolderPath/reshapeDocument
 *   in lib.mjs).
 * - To prevent duplicate folders on repeated (cron) runs, folder IDs are
 *   derived deterministically from the pack name and name path (see stableId()
 *   in lib.mjs), so the same path always has the same ID.
 *
 * Usage (from the root of the private content repository):
 *   npm install
 *   node build-packs.mjs
 *
 * See README.md for the recommended GitHub Actions automation.
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

  const seenFolders = new Map(); // "<packName>::<path>" -> folder ID; prevents duplicate folders
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
  // Always resolve the content repository root relative to this script's
  // location, not the current working directory. This lets the script work
  // whether `npm run build` or `node build-packs.mjs` is run from
  // "compendium-builder/", or `node compendium-builder/build-packs.mjs` is run
  // from the repository root.
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

// Run only when invoked directly, not when imported by tests.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
