/**
 * Reine Hilfsfunktionen für den Compendium Builder – ohne Abhängigkeit zu
 * @foundryvtt/foundryvtt-cli, damit sie sich ohne die native LevelDB-Bindung
 * isoliert testen lassen (siehe test.mjs).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const MODULE_ID = "git-object-sync"; // muss mit der Konstante in git-object-sync/scripts/main.js übereinstimmen

/** Feste Zuordnung: Export-Ordner der Welt-Dokumente -> Foundry-Dokumenttyp. */
export const WORLD_SOURCES = [
  { dir: "actors", type: "Actor", packName: "actors", packLabel: "Actors (Welt-Export)" },
  { dir: "items", type: "Item", packName: "items", packLabel: "Items (Welt-Export)" },
  { dir: "scenes", type: "Scene", packName: "scenes", packLabel: "Szenen (Welt-Export)" },
  { dir: "journal", type: "JournalEntry", packName: "journal", packLabel: "Journale (Welt-Export)" }
];

/** Primärer Dokumenttyp -> LevelDB-Collection-Name (siehe foundryvtt-cli TYPE_COLLECTION_MAP). */
export const TYPE_COLLECTION_MAP = {
  Actor: "actors",
  Item: "items",
  Scene: "scenes",
  JournalEntry: "journal",
  Folder: "folders"
};

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Deterministische, valide Foundry-ID (16 alphanumerische Zeichen) aus einem Seed-String ableiten. */
export function stableId(seed) {
  const hash = createHash("sha256").update(seed).digest();
  let id = "";
  for (let i = 0; i < 16; i++) id += ID_ALPHABET[hash[i] % ID_ALPHABET.length];
  return id;
}

/** Einfacher Slug für Ordner-/Paketnamen (keine Punkte/Sonderzeichen). */
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
 * Ordner-Hierarchie (Namenspfad, Wurzel -> Blatt) in synthetisierte Folder-
 * Dokumente umwandeln. Gibt { leafId, folderDocs } zurück; `folderDocs` sind
 * bereits vollständige LevelDB-Einträge (inkl. `_key`). Bereits im selben Pack
 * erzeugte Zwischenordner werden über `seenFolders` dedupliziert – derselbe
 * Namenspfad ergibt so immer dieselbe (deterministische) ID, auch bei
 * wiederholten Läufen (Cron), ohne dass zwischen Läufen ein State gehalten
 * werden müsste.
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
 * Ein einzelnes, von Git Object Sync exportiertes Dokument in einen LevelDB-
 * tauglichen Eintrag umwandeln: `_key` ergänzen, Ordner-Namenspfad (Flag) in
 * eine echte, pack-interne Ordner-Referenz auflösen, eigene Modul-Flags
 * entfernen (die waren nur für den Re-Import durch Git Object Sync selbst
 * gedacht und haben im fertigen Kompendium nichts verloren).
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

/** Alle `.json`-Dateien eines Verzeichnisses (nicht rekursiv) laden. */
export function readJsonFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
    .map((e) => JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8")));
}

/**
 * Alle zu bauenden Kompendien ermitteln: die festen Welt-Export-Ordner (sofern
 * vorhanden) sowie jedes Unterverzeichnis von `compendia/`, dessen Typ/Label
 * aus den Git-Object-Sync-Metadaten (`flags.<MODULE_ID>.compendium`) der ersten
 * gefundenen Datei abgeleitet wird.
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
        console.warn(`Übersprungen (keine Git-Object-Sync-Metadaten gefunden): ${dir}`);
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

/** module.json anlegen bzw. den `packs`-Abschnitt anhand der gebauten Packs aktualisieren. */
export function buildModuleManifest(existingManifest, packs) {
  const manifest = existingManifest
    ? structuredClone(existingManifest)
    : {
        id: "foundry-content",
        title: "Foundry Content (auto-built)",
        description: "Automatisch aus Git-Object-Sync-Exporten gebaute Kompendien.",
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
