/**
 * Pure helper functions for the Compendium Builder, with no dependency on
 * @foundryvtt/foundryvtt-cli, so they can be tested without its native LevelDB
 * binding (see test.mjs).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const MODULE_ID = "git-object-sync"; // Must match the constant in git-object-sync/scripts/main.js.

/** Fixed mapping from world-document export folders to Foundry document types. */
export const WORLD_SOURCES = [
  { dir: "actors", type: "Actor", packName: "actors", packLabel: "Actors (Welt-Export)" },
  { dir: "items", type: "Item", packName: "items", packLabel: "Items (Welt-Export)" },
  { dir: "scenes", type: "Scene", packName: "scenes", packLabel: "Szenen (Welt-Export)" },
  { dir: "journal", type: "JournalEntry", packName: "journal", packLabel: "Journale (Welt-Export)" }
];

/** Map primary document types to LevelDB collection names (see foundryvtt-cli TYPE_COLLECTION_MAP). */
export const TYPE_COLLECTION_MAP = {
  Actor: "actors",
  Item: "items",
  Scene: "scenes",
  JournalEntry: "journal",
  Folder: "folders"
};

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Derive a deterministic, valid Foundry ID (16 alphanumeric characters) from a seed string. */
export function stableId(seed) {
  const hash = createHash("sha256").update(seed).digest();
  let id = "";
  for (let i = 0; i < 16; i++) id += ID_ALPHABET[hash[i] % ID_ALPHABET.length];
  return id;
}

/** Create a simple slug for folder/package names (no periods or special characters). */
export function slugify(str) {
  return (
    String(str)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pack"
  );
}

/**
 * Convert a folder hierarchy (name path, root -> leaf) into synthetic Folder
 * documents. Returns { leafId, folderDocs }; `folderDocs` are complete LevelDB
 * entries (including `_key`). Intermediate folders already created in this
 * pack are deduplicated with `seenFolders`, so the same name path always
 * produces the same deterministic ID, including across cron runs, without
 * needing to preserve state between runs.
 */
export function resolveFolderPath(names, { type, packName, seenFolders }) {
  let parentId = null;
  const folderDocs = [];
  const pathSoFar = [];
  for (const rawName of names) {
    const name = String(rawName ?? "").trim();
    if (!name) continue;
    pathSoFar.push(name);
    const key = `${packName}::${pathSoFar.join("/")}`;
    let id = seenFolders.get(key);
    if (!id) {
      id = stableId(key);
      seenFolders.set(key, id);
      folderDocs.push({
        _id: id,
        _key: `!folders!${id}`,
        name,
        type,
        folder: parentId,
        sort: 0,
        color: null,
        flags: {}
      });
    }
    parentId = id;
  }
  return { leafId: parentId, folderDocs };
}

/**
 * Convert one document exported by Foundry Git Sync into a LevelDB-compatible
 * entry: add `_key`, resolve the folder name path (flag) to a real pack-internal
 * folder reference, and remove this module's flags (they are only used when
 * re-importing through Foundry Git Sync and do not belong in the finished pack).
 */
export function reshapeDocument(raw, { type, packName, seenFolders }) {
  const data = structuredClone(raw);
  const collection = TYPE_COLLECTION_MAP[type];
  if (!collection) throw new Error(`Unbekannter Dokumenttyp: ${type}`);

  const moduleFlags = data.flags?.[MODULE_ID] ?? {};
  const folderPath = Array.isArray(moduleFlags.folderPath)
    ? moduleFlags.folderPath
    : Array.isArray(moduleFlags.compendium?.folderPath)
      ? moduleFlags.compendium.folderPath
      : [];

  if (data.flags) {
    delete data.flags[MODULE_ID];
    if (Object.keys(data.flags).length === 0) delete data.flags;
  }

  const { leafId, folderDocs } = resolveFolderPath(folderPath, { type, packName, seenFolders });
  data.folder = leafId;
  data._key = `!${collection}!${data._id}`;
  return { doc: data, folderDocs };
}

/** Load all `.json` files in a directory (non-recursively). */
export function readJsonFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
    .map((e) => JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8")));
}

/**
 * Find all compendiums to build: the fixed world-export directories, if
 * present, and each subdirectory of `compendia/`. Derive the type and label
 * for compendium directories from the Foundry Git Sync metadata
 * (`flags.<MODULE_ID>.compendium`) in the first file found.
 */
export function collectSourceGroups(repoRoot) {
  const groups = [];

  for (const src of WORLD_SOURCES) {
    const dir = path.join(repoRoot, src.dir);
    if (fs.existsSync(dir)) {
      groups.push({ ...src, srcDir: dir });
    }
  }

  const compendiaRoot = path.join(repoRoot, "compendia");
  if (fs.existsSync(compendiaRoot)) {
    for (const entry of fs.readdirSync(compendiaRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(compendiaRoot, entry.name);
      const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".json"));
      if (!files.length) continue;
      const sample = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
      const meta = sample.flags?.[MODULE_ID]?.compendium;
      if (!meta?.type) {
        console.warn(`Skipped (no Foundry Git Sync metadata found): ${dir}`);
        continue;
      }
      groups.push({
        dir: `compendia/${entry.name}`,
        srcDir: dir,
        type: meta.type,
        packName: slugify(entry.name),
        packLabel: meta.label || entry.name
      });
    }
  }

  return groups;
}

/** Create module.json or update its `packs` section using the built packs. */
export function buildModuleManifest(existingManifest, packs) {
  const manifest = existingManifest
    ? structuredClone(existingManifest)
    : {
        id: "foundry-content",
        title: "Foundry Content (auto-built)",
        description: "Compendiums built automatically from Foundry Git Sync exports.",
        version: "0.0.0",
        compatibility: { minimum: "12", verified: "13" },
        packs: []
      };

  manifest.packs = packs.map((p) => ({
    name: p.name,
    label: p.label,
    path: p.path,
    type: p.type,
    system: existingManifest?.packs?.find((e) => e.name === p.name)?.system,
    private: false
  }));

  return manifest;
}
