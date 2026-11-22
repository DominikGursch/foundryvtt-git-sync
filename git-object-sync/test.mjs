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
    TextEncoder, crypto: webcrypto, fetch,
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

test("export status compares a renamed item to its original path", async () => {
  const { buildExportJson, gitBlobSha1, indexExportPaths, exportDeltaStatus } = loadModule();
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
