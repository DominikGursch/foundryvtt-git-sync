/**
 * Smoke tests for lib.mjs (pure logic; no dependency on
 * @foundryvtt/foundryvtt-cli required). Run with:
 *   node --test test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  stableId,
  slugify,
  resolveFolderPath,
  reshapeDocument,
  collectSourceGroups,
  buildModuleManifest,
  MODULE_ID
} from "./lib.mjs";

test("stableId ist deterministisch und liefert eine valide Foundry-ID", () => {
  const a = stableId("items::Waffen/Schwerter");
  const b = stableId("items::Waffen/Schwerter");
  const c = stableId("items::Waffen/Schilde");
  assert.equal(a, b, "gleicher Seed muss dieselbe ID ergeben");
  assert.notEqual(a, c, "unterschiedliche Seeds sollten (praktisch immer) unterschiedliche IDs ergeben");
  assert.match(a, /^[A-Za-z0-9]{16}$/, "muss eine 16-stellige alphanumerische Foundry-ID sein");
});

test("slugify entfernt Sonderzeichen und liefert einen Fallback für leere Strings", () => {
  assert.equal(slugify("world.my-monsters"), "world-my-monsters");
  assert.equal(slugify("  Héllo Wörld!! "), "h-llo-w-rld");
  assert.equal(slugify(""), "pack");
});

test("resolveFolderPath baut die Hierarchie Wurzel -> Blatt auf und dedupliziert über seenFolders", () => {
  const seenFolders = new Map();
  const r1 = resolveFolderPath(["Waffen", "Schwerter"], { type: "Item", packName: "items", seenFolders });
  assert.equal(r1.folderDocs.length, 2, "beide Ordner müssen neu angelegt werden");
  assert.equal(r1.folderDocs[0].name, "Waffen");
  assert.equal(r1.folderDocs[0].folder, null, "Wurzelordner hat keinen Elternordner");
  assert.equal(r1.folderDocs[1].name, "Schwerter");
  assert.equal(r1.folderDocs[1].folder, r1.folderDocs[0]._id, "Kind zeigt auf die ID des Elternordners");
  assert.equal(r1.leafId, r1.folderDocs[1]._id);

  // A second call with an overlapping path (same root folder) must not recreate "Waffen".
  const r2 = resolveFolderPath(["Waffen", "Schilde"], { type: "Item", packName: "items", seenFolders });
  assert.equal(r2.folderDocs.length, 1, "nur der neue Unterordner 'Schilde' darf entstehen");
  assert.equal(r2.folderDocs[0].name, "Schilde");
  assert.equal(r2.folderDocs[0].folder, r1.folderDocs[0]._id, "muss denselben, bereits erzeugten 'Waffen'-Ordner referenzieren");
});

test("reshapeDocument löst flags.folderPath (Welt-Dokument-Schema) korrekt auf und entfernt eigene Flags", () => {
  const raw = {
    _id: "AAAAAAAAAAAAAAAA",
    name: "Langschwert",
    type: "weapon",
    folder: "irgendeine-fremde-id",
    flags: { [MODULE_ID]: { folderPath: ["Waffen", "Schwerter"] }, sonstwas: { behalten: true } }
  };
  const seenFolders = new Map();
  const { doc, folderDocs } = reshapeDocument(raw, { type: "Item", packName: "items", seenFolders });

  assert.equal(doc._key, "!items!AAAAAAAAAAAAAAAA");
  assert.equal(folderDocs.length, 2);
  assert.equal(doc.folder, folderDocs[1]._id, "data.folder muss auf den Blattordner zeigen");
  assert.equal(doc.flags[MODULE_ID], undefined, "eigene Modul-Flags müssen entfernt werden");
  assert.deepEqual(doc.flags.sonstwas, { behalten: true }, "fremde Flags anderer Module bleiben erhalten");
});

test("reshapeDocument löst flags.compendium.folderPath (Kompendium-Export-Schema) korrekt auf", () => {
  const raw = {
    _id: "BBBBBBBBBBBBBBBB",
    name: "Goblin",
    flags: { [MODULE_ID]: { compendium: { collection: "world.monster", label: "Monster", type: "Actor", folderPath: ["Kleine Monster"] } } }
  };
  const seenFolders = new Map();
  const { doc, folderDocs } = reshapeDocument(raw, { type: "Actor", packName: "monster", seenFolders });

  assert.equal(doc._key, "!actors!BBBBBBBBBBBBBBBB");
  assert.equal(folderDocs.length, 1);
  assert.equal(folderDocs[0].name, "Kleine Monster");
  assert.equal(doc.folder, folderDocs[0]._id);
  assert.equal(doc.flags, undefined, "flags-Objekt wird komplett entfernt, wenn nichts mehr übrig bleibt");
});

test("reshapeDocument setzt data.folder auf null, wenn kein Ordner-Pfad vorhanden ist", () => {
  const raw = { _id: "CCCCCCCCCCCCCCCC", name: "Ohne Ordner" };
  const seenFolders = new Map();
  const { doc, folderDocs } = reshapeDocument(raw, { type: "JournalEntry", packName: "journal", seenFolders });
  assert.equal(folderDocs.length, 0);
  assert.equal(doc.folder, null);
  assert.equal(doc._key, "!journal!CCCCCCCCCCCCCCCC");
});

test("collectSourceGroups erkennt Welt-Export-Ordner und compendia/*-Unterordner mit Metadaten", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gos-builder-test-"));
  try {
    fs.mkdirSync(path.join(tmp, "actors"));
    fs.writeFileSync(path.join(tmp, "actors", "held__AAAAAAAAAAAAAAAA.json"), JSON.stringify({ _id: "AAAAAAAAAAAAAAAA", name: "Held" }));

    fs.mkdirSync(path.join(tmp, "compendia", "world.monster"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "compendia", "world.monster", "goblin__BBBBBBBBBBBBBBBB.json"),
      JSON.stringify({
        _id: "BBBBBBBBBBBBBBBB",
        name: "Goblin",
        flags: { [MODULE_ID]: { compendium: { collection: "world.monster", label: "Monster", type: "Actor" } } }
      })
    );

    const groups = collectSourceGroups(tmp);
    const actorGroup = groups.find((g) => g.dir === "actors");
    const compendiumGroup = groups.find((g) => g.dir === "compendia/world.monster");

    assert.ok(actorGroup, "actors/-Ordner muss erkannt werden");
    assert.equal(actorGroup.type, "Actor");

    assert.ok(compendiumGroup, "compendia/world.monster muss erkannt werden");
    assert.equal(compendiumGroup.type, "Actor");
    assert.equal(compendiumGroup.packLabel, "Monster");
    assert.equal(compendiumGroup.packName, "world-monster");

    // Directories without export files (e.g. a missing items/ directory) must not appear.
    assert.ok(!groups.find((g) => g.dir === "items"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("buildModuleManifest legt ein neues Manifest an bzw. aktualisiert nur den packs-Abschnitt", () => {
  const fresh = buildModuleManifest(null, [{ name: "actors", label: "Actors", type: "Actor", path: "packs/actors" }]);
  assert.equal(fresh.id, "foundry-content");
  assert.equal(fresh.packs.length, 1);
  assert.equal(fresh.packs[0].name, "actors");

  const existing = {
    id: "my-content",
    title: "Meine Inhalte",
    version: "1.2.3",
    packs: [{ name: "actors", label: "Alt", type: "Actor", path: "packs/actors", system: "dnd5e" }]
  };
  const updated = buildModuleManifest(existing, [
    { name: "actors", label: "Actors (neu)", type: "Actor", path: "packs/actors" },
    { name: "items", label: "Items", type: "Item", path: "packs/items" }
  ]);
  assert.equal(updated.id, "my-content", "restliche Manifest-Felder bleiben unverändert");
  assert.equal(updated.version, "1.2.3");
  assert.equal(updated.packs.length, 2);
  assert.equal(updated.packs[0].label, "Actors (neu)", "Label wird aus dem Build übernommen");
  assert.equal(updated.packs[0].system, "dnd5e", "bereits gesetztes system-Feld bleibt erhalten");
});
