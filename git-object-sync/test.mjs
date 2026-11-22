import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

const source = readFileSync(new URL("./scripts/main.js", import.meta.url), "utf8");

function loadModule(fetch) {
  const context = createContext({
    Hooks: { once() {} },
    game: {
      i18n: { format: (key) => key },
      settings: { get: (_, key) => ({ githubRepo: "example/content", githubToken: "test" })[key] }
    },
    foundry: { utils: { setProperty: (data, path, value) => {
      const keys = path.split(".");
      const prop = keys.pop();
      const target = keys.reduce((obj, key) => (obj[key] ??= {}), data);
      target[prop] = value;
    } } },
    TextEncoder, TextDecoder, atob, crypto: webcrypto, fetch,
    setTimeout: (callback) => callback()
  });
  runInContext(source, context);
  return context;
}

const id = "Item1234";
const oldPath = `items/Old_name__${id}.json`;
const newPath = `items/New_name__${id}.json`;
const item = (name) => ({
  documentName: "Item", id, name,
  toObject: () => ({ _id: id, name })
});

test("world JSON imports into an unlocked target pack, preserving ID and applying the asset prefix", async () => {
  const data = { _id: id, name: "Old name", img: "Item/rope.png", _stats: { systemId: "test-system" } };
  const ctx = loadModule(async () => Response.json({ content: Buffer.from(JSON.stringify(data)).toString("base64") }));
  const created = [];
  const updated = [];
  const pack = {
    collection: "world.gear", documentName: "Item", metadata: { packageType: "world" },
    locked: false, getDocument: async (key) => created.find(([doc]) => doc._id === key)
      ? { update: async (doc) => updated.push(doc) } : null
  };
  ctx.game.packs = { filter: (fn) => [pack].filter(fn) };
  ctx.game.system = { id: "test-system" };
  ctx.game.release = { generation: 12 };
  ctx.game.settings.get = (_, key) => ({ githubRepo: "example/content", githubToken: "test", overwriteImport: true })[key];
  ctx.foundry.utils.getProperty = (obj, path) => path.split(".").reduce((value, key) => value?.[key], obj);
  ctx.getDocumentClass = () => ({ create: async (doc, opts) => created.push([doc, opts]) });
  const opts = { packCollection: pack.collection, assetPrefix: "worlds/example/custom/Items" };
  const tree = new Map([[oldPath, "blob-sha"]]);

  assert.equal(await ctx.importValue("Item", oldPath, tree, opts), "created");
  assert.equal(created[0][0]._id, id);
  assert.equal(created[0][0].img, "worlds/example/custom/Items/Item/rope.png");
  assert.equal(created[0][1].pack, pack.collection);
  assert.equal(created[0][1].keepId, true);
  assert.equal(await ctx.importValue("Item", oldPath, tree, opts), "updated");
  assert.equal(updated[0]._id, id);
  assert.equal(created.length, 1);
  pack.locked = true;
  await assert.rejects(ctx.importValue("Item", oldPath, tree, opts), /InvalidImportPack/);
});

test("creating an import destination does not reuse a colliding compendium ID", async () => {
  const ctx = loadModule();
  ctx.game.packs = new Map([["world.gear", {}]]);
  ctx.foundry.documents = { collections: { CompendiumCollection: { createCompendium: async (data) => data } } };
  const pack = await ctx.createImportTargetPack("Item", { slugify: () => "gear" });
  assert.equal(pack.name, "gear-2");
  assert.equal(pack.type, "Item");
});

test("export status compares a renamed item to its original path", async () => {
  const { buildExportJson, gitBlobSha1, indexExportPaths, exportDeltaStatus } = loadModule(async () =>
    Response.json({ content: Buffer.from(prior.json).toString("base64") })
  );
  const renamed = buildExportJson(item("New name"), false, false);
  const prior = buildExportJson(item("Old name"), false, false);
  const otherPath = `compendia/world.gear/Other_name__${id}.json`;
  const tree = new Map([[otherPath, "other-pack"]]);
  assert.equal(await exportDeltaStatus(renamed, tree, indexExportPaths(tree)), "new");
  tree.set(oldPath, await gitBlobSha1(prior.json));
  assert.equal(await exportDeltaStatus(renamed, tree, indexExportPaths(tree)), "changed");
  tree.set(oldPath, await gitBlobSha1(renamed.json));
  assert.equal(await exportDeltaStatus(renamed, tree, indexExportPaths(tree)), "unchanged");
});

test("re-export after import ignores only top-level Foundry timestamps and JSON formatting", async () => {
  const path = `items/Bungee_Cord__${id}.json`;
  const remote = { name: "Bungee-Seil", _id: id, _stats: { createdTime: 1, modifiedTime: 2, coreVersion: "12" } };
  const raw = `${JSON.stringify(remote, null, 2)}\n`;
  const { gitBlobSha1, indexExportPaths, exportDeltaStatus, documentContentStatus } = loadModule(async () =>
    Response.json({ content: Buffer.from(raw).toString("base64") })
  );
  const local = { _id: id, _stats: { coreVersion: "12", modifiedTime: 3, createdTime: 3 }, name: remote.name };
  const tree = new Map([[path, await gitBlobSha1(raw)]]);
  assert.equal(await exportDeltaStatus({
    folder: "items", fileName: `Bungee-Seil__${id}.json`, json: JSON.stringify(local)
  }, tree, indexExportPaths(tree)), "unchanged");
  assert.equal(documentContentStatus(JSON.stringify({
    ...local, _stats: { ...local._stats, coreVersion: "13" }
  }), remote), "changed");
  assert.equal(documentContentStatus(JSON.stringify({ ...local, system: { values: [2, 1] } }), {
    ...remote, system: { values: [1, 2] }
  }), "changed");
});

test("import compares preview data without downloading it again", () => {
  const { game, buildExportJson, importDeltaStatus } = loadModule();
  const local = item("Old name");
  local.toObject = () => ({
    _id: id, name: local.name, img: "Item/rope.png", _stats: { createdTime: 3, modifiedTime: 3 }
  });
  game.items = new Map([[id, local]]);
  const prior = JSON.parse(buildExportJson(local, false, false).json);
  prior._stats = { createdTime: 1, modifiedTime: 2 };
  const entry = { base: `Old_name__${id}.json` };
  assert.equal(importDeltaStatus("Item", entry, prior, false, false), "unchanged");
  assert.equal(importDeltaStatus("Item", entry, { ...prior, img: "Item/other.png" }, false, false), "changed");
});

test("a concurrent first export is updated rather than duplicated after retry", async () => {
  let branchTip = "base1";
  const writes = [];
  const { exportDocument } = loadModule(async (url, { method, body }) => {
    const path = new URL(url).pathname.replace("/repos/example/content/git/", "");
    const payload = body && JSON.parse(body);
    switch (`${method} ${path}`) {
      case "GET ref/heads/main":
        return Response.json({ object: { sha: branchTip } });
      case "GET commits/base1":
      case "GET commits/base2":
        return Response.json({ tree: { sha: `tree-${branchTip}` } });
      case "GET trees/tree-base1":
        return Response.json({ tree: [] });
      case "GET trees/tree-base2":
        return Response.json({ tree: [{ type: "blob", path: oldPath, sha: "old-blob" }] });
      case "POST blobs":
        assert.deepEqual(JSON.parse(payload.content), {
          _id: id, name: "New name", flags: { "git-object-sync": { folderPath: [] } }
        });
        return Response.json({ sha: "new-blob" });
      case "POST trees":
        writes.push(payload);
        return Response.json({ sha: "new-tree" });
      case "POST commits":
        return Response.json({ sha: "new-commit" });
      case "PATCH refs/heads/main":
        if (branchTip === "base1") {
          branchTip = "base2";
          return new Response("Update is not a fast forward", { status: 422 });
        }
        return Response.json({});
      default:
        assert.fail(`Unexpected request: ${method} ${path}`);
    }
  });
  await exportDocument(item("New name"));
  assert.deepEqual(writes.map(({ base_tree, tree }) => [base_tree, tree.map(({ path, sha }) => [path, sha])]), [
    ["tree-base1", [[newPath, "new-blob"]]],
    ["tree-base2", [[oldPath, "new-blob"]]]
  ]);
});

test("historical duplicate paths are not chosen arbitrarily", () => {
  const { indexExportPaths, resolveExportPath } = loadModule();
  const index = indexExportPaths(new Map([[oldPath, "old"], [newPath, "new"]]));
  assert.equal(resolveExportPath(newPath, index), newPath);
  assert.equal(resolveExportPath(`items/Third_name__${id}.json`, index), null);
});
