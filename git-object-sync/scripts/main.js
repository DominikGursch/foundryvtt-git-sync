/**
 * Foundry Git Sync
 * -----------------------------------------------------------------------------
 * Export individual Foundry documents (Actors, Items, Scenes, Journals) and
 * user-owned world compendiums as JSON files directly to a GitHub repository,
 * then import them again, including referenced images/maps as assets.
 *
 * - Right-click an item in a sidebar -> "Export to Git"
 * - Sidebar button -> checkbox dialog for multi-item export/import
 *   (also in the compendium sidebar, across all world compendiums)
 */

const MODULE_ID = "git-object-sync";

/**
 * Configuration for each document type.
 *
 * `contextHook` is the Foundry v12 context-menu hook (`get<Doc>DirectoryEntryContext`,
 * with a jQuery element in the callback). `contextHookV13` is its renamed v13
 * successor (`get<Doc>ContextOptions`, with a native HTMLElement; see
 * `client/applications/sidebar/document-directory.mjs`). Only one hook fires
 * for a given Foundry version, so registering both names is safe and makes the
 * "Export to Git" context-menu entry available in both v12 and v13
 * (see addContextMenuEntry).
 */
const TYPE_CONFIG = {
  Actor: { folder: "actors", collection: () => game.actors, uiKey: "actors", renderHook: "renderActorDirectory", contextHook: "getActorDirectoryEntryContext", contextHookV13: "getActorContextOptions" },
  Item: { folder: "items", collection: () => game.items, uiKey: "items", renderHook: "renderItemDirectory", contextHook: "getItemDirectoryEntryContext", contextHookV13: "getItemContextOptions" },
  Scene: { folder: "scenes", collection: () => game.scenes, uiKey: "scenes", renderHook: "renderSceneDirectory", contextHook: "getSceneDirectoryEntryContext", contextHookV13: "getSceneContextOptions" },
  // Use the full document name ("JournalEntry") for the v12 hook, not "Journal";
  // otherwise, the "Export to Git" entry is missing from the Journal context menu
  // (see getJournalEntryDirectoryEntryContext in the Foundry API).
  JournalEntry: { folder: "journal", collection: () => game.journal, uiKey: "journal", renderHook: "renderJournalDirectory", contextHook: "getJournalEntryDirectoryEntryContext", contextHookV13: "getJournalEntryContextOptions" }
};

/* -------------------------------------------------------------------------- */
/*  Hilfsfunktionen                                                            */
/* -------------------------------------------------------------------------- */

function t(key, data = {}) {
  return game.i18n.format(key, data);
}

/** Whether to sync referenced assets (images, maps, audio). */
function syncAssets() {
  return game.settings.get(MODULE_ID, "syncAssets");
}

/**
 * Show progress using Foundry's built-in loading bar (top center).
 * Returns an object with update(fraction 0..1, message) and done(message).
 * Does nothing if the loading bar is unavailable.
 */
function makeProgress(label) {
  const show = (pct, msg) => {
    try {
      SceneNavigation.displayProgressBar({
        label: msg ?? label,
        pct: Math.round(Math.max(0, Math.min(100, pct)))
      });
    } catch (err) {
      /* Ignore when the loading bar is unavailable. */
    }
  };
  show(0, label);
  return {
    update: (fraction, msg) => show(fraction * 100, msg),
    done: (msg) => show(100, msg)
  };
}

/** Make a filename safe (no special characters or spaces). */
function sanitize(name) {
  return String(name ?? "unnamed")
    .normalize("NFKD")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80) || "unnamed";
}

function dirname(p) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}

function basename(p) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Recursively create a directory in the Data area if it does not exist. */
async function ensureDir(path) {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      await FilePicker.createDirectory("data", current);
    } catch (err) {
      // Ignore if it already exists; propagate all other errors.
      if (!/exist/i.test(err?.message ?? "")) throw err;
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Collect and transfer assets (images, maps, audio)                          */
/* -------------------------------------------------------------------------- */

// Media file extensions treated as assets.
const ASSET_EXT = /\.(webp|png|jpe?g|gif|bmp|svg|webm|mp4|m4v|ogv|ogg|mp3|wav|m4a|flac|opus|pdf)(\?.*)?$/i;
// Paths that are already present on every installation and should not be backed up.
const ASSET_SKIP = /^(https?:|data:|icons\/|ui\/|cards\/|sounds\/|fonts\/|systems\/|modules\/)/i;

/**
 * Recursively search a document object for local asset paths
 * (e.g. map backgrounds, token images, portraits). Returns unique,
 * relative Data paths. External URLs and core/system assets are skipped.
 */
function collectAssetPaths(data) {
  const found = new Set();
  const visit = (v) => {
    if (typeof v === "string") {
      const s = v.trim();
      if (s && ASSET_EXT.test(s) && !ASSET_SKIP.test(s)) {
        found.add(s.split("?")[0].replace(/^\/+/, ""));
      }
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (v && typeof v === "object") {
      for (const k of Object.keys(v)) visit(v[k]);
    }
  };
  visit(data);
  return [...found];
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** URL for retrieving a Data file, including the route prefix. */
function dataUrl(path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return foundry.utils.getRoute(encoded);
}

/** Infer a MIME type from the file extension for data-URI previews. */
function guessMime(path) {
  const ext = String(path).split(".").pop().toLowerCase();
  return (
    {
      webp: "image/webp",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      bmp: "image/bmp",
      svg: "image/svg+xml"
    }[ext] || "image/png"
  );
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Calculate the Git blob SHA-1 for text (equivalent to `git hash-object` or
 * the SHA returned by GitHub's tree API for a file). This lets us check locally
 * whether a document is unchanged from the repository without downloading its
 * contents (see delta detection below).
 */
async function gitBlobSha1(text) {
  const content = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${content.length}\0`);
  const combined = new Uint8Array(header.length + content.length);
  combined.set(header, 0);
  combined.set(content, header.length);
  const digest = await crypto.subtle.digest("SHA-1", combined);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function uploadBytes(dir, name, bytes) {
  const file = new File([bytes], name);
  await FilePicker.upload("data", dir, file, {}, { notify: false });
}

/* -------------------------------------------------------------------------- */
/*  GitHub-API                                                                 */
/* -------------------------------------------------------------------------- */

function ghConfig() {
  const repo = (game.settings.get(MODULE_ID, "githubRepo") || "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  const token = (game.settings.get(MODULE_ID, "githubToken") || "").trim();
  const branch = (game.settings.get(MODULE_ID, "githubBranch") || "main").trim();
  return { repo, token, branch };
}

async function ghApi(path, { method = "GET", body } = {}) {
  const { token } = ghConfig();
  if (!token) throw new Error(t("GOS.Notify.NoToken"));
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    cache: "no-store", // Prevent the browser from returning stale data when reading the branch tip again.
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

/** Upload multiple files in a single commit using the Git Data API. */
async function githubPushFiles(files, message, onProgress = null) {
  const { repo, branch } = ghConfig();
  if (!repo.includes("/")) throw new Error(t("GOS.Notify.BadRepo"));

  let baseSha = null;
  let baseTree = null;
  try {
    const ref = await ghApi(`/repos/${repo}/git/ref/heads/${branch}`);
    baseSha = ref.object.sha;
    const commit = await ghApi(`/repos/${repo}/git/commits/${baseSha}`);
    baseTree = commit.tree.sha;
  } catch (err) {
    // The repository/branch is empty. The Git Data API rejects a completely
    // empty repository (no commits) with 409, so create the first commit via
    // the Contents API.
    try {
      await ghApi(`/repos/${repo}/contents/.gitkeep`, {
        method: "PUT",
        body: {
          message: "Foundry Git Sync: Repository initialized",
          content: "",
          branch
        }
      });
      const ref = await ghApi(`/repos/${repo}/git/ref/heads/${branch}`);
      baseSha = ref.object.sha;
      const commit = await ghApi(`/repos/${repo}/git/commits/${baseSha}`);
      baseTree = commit.tree.sha;
    } catch (err2) {
      // Fall back to no base (initial commit via the Git Data API).
      baseSha = null;
      baseTree = null;
    }
  }

  const tree = [];
  for (const f of files) {
    const blobBody = f.bytes
      ? { content: bytesToBase64(f.bytes), encoding: "base64" }
      : { content: f.text, encoding: "utf-8" };
    const blob = await ghApi(`/repos/${repo}/git/blobs`, { method: "POST", body: blobBody });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    onProgress?.(tree.length, files.length + 1);
  }

  // Fetch the current branch state (tip commit and corresponding tree).
  const readBase = async () => {
    const ref = await ghApi(`/repos/${repo}/git/ref/heads/${branch}`);
    const sha = ref.object.sha;
    const commit = await ghApi(`/repos/${repo}/git/commits/${sha}`);
    return { sha, tree: commit.tree.sha };
  };

  // Create the commit and update the ref. If the branch advances in the meantime
  // ("Update is not a fast forward", 422), fetch the latest state and rebase our
  // commit onto its current tip. Wait briefly between retries so GitHub can serve
  // the updated ref and any concurrent sync can finish.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const maxAttempts = 8;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const newTree = await ghApi(`/repos/${repo}/git/trees`, {
      method: "POST",
      body: { ...(baseTree ? { base_tree: baseTree } : {}), tree }
    });
    const commit = await ghApi(`/repos/${repo}/git/commits`, {
      method: "POST",
      body: { message, tree: newTree.sha, parents: baseSha ? [baseSha] : [] }
    });

    try {
      if (baseSha) {
        await ghApi(`/repos/${repo}/git/refs/heads/${branch}`, { method: "PATCH", body: { sha: commit.sha } });
      } else {
        await ghApi(`/repos/${repo}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: commit.sha } });
      }
      onProgress?.(files.length + 1, files.length + 1);
      return commit.sha;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message ?? "");
      const conflict = /not a fast forward|fast-forward|reference already exists|422/i.test(msg);
      if (!conflict || attempt >= maxAttempts) break;
      // The branch advanced; wait briefly, fetch its latest state, and retry.
      await sleep(300 * attempt); // 300ms, 600ms, 900ms, ...
      const base = await readBase();
      baseSha = base.sha;
      baseTree = base.tree;
    }
  }
  // Retries exhausted: throw a clear conflict error.
  const detail = String(lastErr?.message ?? "").slice(0, 160);
  throw new Error(t("GOS.Notify.PushConflict", { detail }));
}

/** Fetch the branch's complete file tree as a map of path -> blob SHA. */
async function githubTree() {
  const { repo, branch } = ghConfig();
  const map = new Map();
  try {
    const data = await ghApi(`/repos/${repo}/git/trees/${branch}?recursive=1`);
    for (const e of data.tree || []) if (e.type === "blob") map.set(e.path, e.sha);
  } catch (err) {
    // The branch does not exist yet, so return an empty tree.
  }
  return map;
}

async function githubReadBlob(sha) {
  const { repo } = ghConfig();
  const blob = await ghApi(`/repos/${repo}/git/blobs/${sha}`);
  return base64ToBytes(blob.content);
}

/* -------------------------------------------------------------------------- */
/*  Export (both modes)                                                        */
/* -------------------------------------------------------------------------- */

/** Whether to put exported assets in shared folders (assets/<type>/...). */
function exportFlattenAssets() {
  return game.settings.get(MODULE_ID, "exportFlattenAssets") === true;
}

/** A document's folder path in the Foundry UI (root -> leaf). */
function folderPathOf(doc) {
  const names = [];
  let f = doc?.folder ?? null;
  while (f) {
    names.unshift(f.name);
    f = f.folder ?? null;
  }
  return names;
}

/**
 * Rewrite asset references in `data` to their repository-relative destination
 * paths and return the `dest -> src` mapping for storage. Mutates `data`.
 *
 * - `flatten` = true  -> put all assets in `<type>/<filename>` (shared folder).
 * - `flatten` = false -> keep original paths (references unchanged).
 */
function remapExportAssets(data, flatten, docType) {
  const map = new Map(); // dest (repository path) -> src (original path to retrieve)
  const remap = (s) => {
    const trimmed = String(s).trim();
    if (trimmed && ASSET_EXT.test(trimmed) && !ASSET_SKIP.test(trimmed)) {
      const clean = trimmed.split("?")[0].replace(/^\/+/, "");
      const dest = flatten ? `${docType}/${basename(clean)}` : clean;
      if (!map.has(dest)) map.set(dest, clean);
      return flatten ? dest : null; // Keep the reference unchanged when not flattening.
    }
    return null;
  };
  const visit = (v) => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] === "string") {
          const nv = remap(v[i]);
          if (nv !== null) v[i] = nv;
        } else visit(v[i]);
      }
    } else if (v && typeof v === "object") {
      for (const k of Object.keys(v)) {
        if (typeof v[k] === "string") {
          const nv = remap(v[k]);
          if (nv !== null) v[k] = nv;
        } else visit(v[k]);
      }
    }
  };
  visit(data);
  return map;
}

/**
 * Build the export payload (repository path + JSON text + asset mapping) for
 * one document without uploading anything. Used by both the actual export and
 * delta detection (sync status in the dialog) so they calculate identical content.
 */
function buildExportJson(doc, flatten, withAssets) {
  const cfg = TYPE_CONFIG[doc.documentName];
  const data = doc.toObject(); // Complete source data, including _id.
  // Store the UI folder path so it can be restored during import.
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.folderPath`, folderPathOf(doc));
  // The raw folder ID belongs to this installation's world sidebar and is never
  // read by our importer (see resolveImportFolder). It could confuse an external
  // tool (e.g. a compendium build pipeline) that reads this file directly, so
  // remove it consistently, as with compendium exports (see buildCompendiumExportJson).
  delete data.folder;
  const assetMap = withAssets ? remapExportAssets(data, flatten, doc.documentName) : new Map();
  const json = JSON.stringify(data, null, 2);
  const fileName = `${sanitize(doc.name)}__${doc.id}.json`;
  return { folder: cfg.folder, fileName, json, assetMap };
}

/** Export a single document (convenience wrapper). */
async function exportDocument(doc, opts = {}) {
  return exportDocuments([doc], opts);
}

/**
 * Export multiple documents. Collect their JSON and referenced assets, then
 * push them as a single commit to the configured GitHub repository.
 * Returns { count, assets }.
 *
 * `opts.flattenAssets` overrides the global setting for this export.
 */
async function exportDocuments(docs, opts = {}) {
  const withAssets = syncAssets();
  const flatten = opts.flattenAssets ?? exportFlattenAssets();
  const jsonWrites = [];
  const assetMap = new Map(); // Repo-Pfad (dest) -> Original-Pfad (src)

  for (const doc of docs) {
    const cfg = TYPE_CONFIG[doc.documentName];
    if (!cfg) continue;
    const { fileName, json, assetMap: docAssets } = buildExportJson(doc, flatten, withAssets);
    for (const [dest, src] of docAssets) if (!assetMap.has(dest)) assetMap.set(dest, src);
    jsonWrites.push({ folder: cfg.folder, fileName, json });
  }

  return pushExportBundle(jsonWrites, assetMap);
}

/**
 * Shared export upload logic: push the collected JSON files and their assets
 * to GitHub as a single commit. Used by both world-document and compendium
 * exports so they share the same progress and commit behavior.
 */
async function pushExportBundle(jsonWrites, assetMap) {
  const progress = makeProgress(t("GOS.Progress.Exporting"));
  try {
    const files = [];
    for (const w of jsonWrites) files.push({ path: `${w.folder}/${w.fileName}`, text: w.json });
    let assets = 0;
    const assetList = [...assetMap.entries()]; // [dest, src]
    for (let i = 0; i < assetList.length; i++) {
      const [dest, src] = assetList[i];
      progress.update((i / (assetList.length + 1)) * 0.5, t("GOS.Progress.Asset", { name: basename(dest) }));
      try {
        files.push({ path: `assets/${dest}`, bytes: await fetchBytes(dataUrl(src)) });
        assets++;
      } catch (err) {
        console.warn(`${MODULE_ID} | Asset übersprungen: ${src}`, err);
      }
    }
    await githubPushFiles(
      files,
      `Foundry Git Sync: ${jsonWrites.length} document(s), ${assets} asset(s)`,
      (done, total) =>
        progress.update(0.5 + (done / total) * 0.5, t("GOS.Progress.Uploading", { done, total }))
    );
    progress.done(t("GOS.Progress.Done"));
    return { count: jsonWrites.length, assets };
  } finally {
    // Always hide the loading bar, even if githubPushFiles fails.
    progress.done("");
  }
}

/* -------------------------------------------------------------------------- */
/*  Delta detection (sync status for export/import dialogs)                    */
/* -------------------------------------------------------------------------- */

/**
 * Determine the sync status of a local document against the GitHub repository:
 * "new" (never exported), "changed" (content differs from the repository), or
 * "unchanged" (identical to the last export). Compare Git blob SHAs to avoid
 * downloading the file contents. Uses the same export settings (assets/shared
 * folders) as an actual export, so different settings can make the status inaccurate.
 */
async function exportDeltaStatus(doc, tree, flatten, withAssets) {
  const cfg = TYPE_CONFIG[doc.documentName];
  if (!cfg) return "new";
  const { folder, fileName, json } = buildExportJson(doc, flatten, withAssets);
  const remoteSha = tree.get(`${folder}/${fileName}`);
  if (!remoteSha) return "new";
  const localSha = await gitBlobSha1(json);
  return localSha === remoteSha ? "unchanged" : "changed";
}

/**
 * Determine the sync status of an import entry against the local document:
 * "new" (no local document with this ID), "changed" (a local document exists
 * but its content differs from the repository), or "unchanged" (exporting the
 * local document again would produce this exact file, so there is nothing to import).
 */
async function importDeltaStatus(type, entry, tree, flatten, withAssets) {
  const id = entry.base.match(/__([A-Za-z0-9]+)\.json$/i)?.[1];
  const local = id ? TYPE_CONFIG[type].collection().get(id) : null;
  if (!local) return "new";
  const { json } = buildExportJson(local, flatten, withAssets);
  const localSha = await gitBlobSha1(json);
  const remoteSha = tree.get(entry.value);
  return localSha === remoteSha ? "unchanged" : "changed";
}

/* -------------------------------------------------------------------------- */
/*  Import                                                                     */
/* -------------------------------------------------------------------------- */

/** List available import entries for a type: [{ value, base }]. */
async function listImportEntries(type) {
  const cfg = TYPE_CONFIG[type];
  const tree = await githubTree();
  const prefix = `${cfg.folder}/`;
  return [...tree.keys()]
    .filter((p) => p.startsWith(prefix) && p.toLowerCase().endsWith(".json"))
    .map((p) => ({ value: p, base: p.slice(prefix.length) }));
}

/** Load the raw data for an import entry (for preview/import). */
async function readEntryData(value, tree = null) {
  const sha = (tree ?? (await githubTree())).get(value);
  if (!sha) return null;
  return JSON.parse(new TextDecoder().decode(await githubReadBlob(sha)));
}

/** Configured destination subfolder for imported assets (empty = original path). */
function importAssetPrefix() {
  return (game.settings.get(MODULE_ID, "importAssetPrefix") || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

/** Determine an asset's import destination path, with an optional prefix. */
function importAssetTarget(a, prefix) {
  return prefix ? `${prefix}/${a}` : a;
}

/** Global import folder mode: original | none | custom. */
function importFolderMode() {
  return game.settings.get(MODULE_ID, "importFolderMode") || "original";
}

/** Name of the fixed import folder (only in "custom" mode). */
function importFolderName() {
  return (game.settings.get(MODULE_ID, "importFolderName") || "").trim();
}

/** Create a folder hierarchy in the sidebar by name and return the leaf ID. */
async function ensureFolderPath(type, names) {
  let parentId = null;
  for (const name of names) {
    if (!name) continue;
    let folder = game.folders.find(
      (f) => f.type === type && f.name === name && (f.folder?.id ?? null) === parentId
    );
    if (!folder) folder = await Folder.create({ name, type, folder: parentId });
    parentId = folder.id;
  }
  return parentId;
}

/**
 * Determine the destination sidebar folder for an imported document and set
 * `data.folder`. This also removes the source folder ID, which is not valid in
 * the destination world. Modes:
 *  - original: recreate the exported folder structure by name
 *  - none:     no folder (root)
 *  - custom:   a fixed folder with the configured name
 */
async function resolveImportFolder(type, data, mode, customName) {
  if (mode === "none") {
    data.folder = null;
    return;
  }
  if (mode === "custom") {
    const name = (customName || "").trim();
    data.folder = name ? await ensureFolderPath(type, [name]) : null;
    return;
  }
  // original
  const path = foundry.utils.getProperty(data, `flags.${MODULE_ID}.folderPath`) || [];
  data.folder = Array.isArray(path) && path.length ? await ensureFolderPath(type, path) : null;
}

/**
 * Rewrite asset paths in the data object to point to their import destination
 * (with an optional prefix). Mutates `data` directly. Does nothing without a prefix.
 */
function rewriteAssetPaths(data, prefix) {
  if (!prefix) return;
  const remap = (s) => {
    const trimmed = String(s).trim();
    if (trimmed && ASSET_EXT.test(trimmed) && !ASSET_SKIP.test(trimmed)) {
      const clean = trimmed.split("?")[0].replace(/^\/+/, "");
      return `${prefix}/${clean}`;
    }
    return null;
  };
  const visit = (v) => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] === "string") {
          const nv = remap(v[i]);
          if (nv !== null) v[i] = nv;
        } else visit(v[i]);
      }
    } else if (v && typeof v === "object") {
      for (const k of Object.keys(v)) {
        if (typeof v[k] === "string") {
          const nv = remap(v[k]);
          if (nv !== null) v[k] = nv;
        } else visit(v[k]);
      }
    }
  };
  visit(data);
}

/** Restore referenced assets from GitHub to their destination paths. */
async function restoreAssetsGithub(data, tree, prefix = "") {
  for (const a of collectAssetPaths(data)) {
    try {
      const sha = tree.get(`assets/${a}`);
      if (!sha) continue;
      const bytes = await githubReadBlob(sha);
      const target = importAssetTarget(a, prefix);
      const dir = dirname(target);
      if (dir) await ensureDir(dir);
      await uploadBytes(dir, basename(target), bytes);
    } catch (err) {
      console.warn(`${MODULE_ID} | Asset-Restore übersprungen: ${a}`, err);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Version compatibility                                                      */
/* -------------------------------------------------------------------------- */
/*  Exports contain the raw source data of the exporting installation plus    */
/*  `_stats` metadata (coreVersion, systemId, systemVersion). Foundry can     */
/*  migrate older data forward (`migrateDataSafe`), but there is no backward  */
/*  migration, and data from another game system does not fit the local      */
/*  system schema. Imports are therefore checked before anything is written. */
/*  Only data from the same game system is accepted, for all document types: */
/*  even Scenes and Journals embed system data (token actor deltas, links,   */
/*  system-specific flags). Data without a system ID cannot be verified and  */
/*  is blocked as well.                                                       */
/* -------------------------------------------------------------------------- */

/** Shorten a version string to its first `parts` dot-separated components. */
function versionPrefix(version, parts) {
  return String(version ?? "").split(".").slice(0, parts).join(".");
}

/**
 * Compare the `_stats` metadata of exported data with this installation.
 * Returns `{ level, reasons }` where `level` is one of:
 * - "blocked": data from another game system, without a system ID, from a
 *   newer Foundry generation, or from a newer system major/minor version;
 * - "older": data from an older Foundry generation or system version (or a
 *   newer system patch release); Foundry migrates it on import, but system
 *   world-migration scripts do not run;
 * - "unknown": same system, but no Foundry core version available;
 * - "ok": same system, Foundry generation, and system version.
 */
function checkImportCompatibility(type, data) {
  const stats = data?._stats ?? {};
  const str = (v) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
  const coreVersion = str(stats.coreVersion);
  const systemId = str(stats.systemId);
  const systemVersion = str(stats.systemVersion);
  const isNewer = foundry.utils.isNewerVersion;
  const localGeneration = String(game.release?.generation ?? versionPrefix(game.version, 1));
  const localSystemId = game.system.id;
  const localSystemVersion = String(game.system.version ?? "");

  if (!systemId) return { level: "blocked", reasons: [t("GOS.Compat.NoSystem", { target: localSystemId })] };
  if (systemId !== localSystemId) {
    return { level: "blocked", reasons: [t("GOS.Compat.OtherSystem", { source: systemId, target: localSystemId })] };
  }
  if (!coreVersion) return { level: "unknown", reasons: [t("GOS.Compat.Unknown")] };

  const blocked = [];
  const older = [];
  const sourceGeneration = versionPrefix(coreVersion, 1);
  if (isNewer(sourceGeneration, localGeneration)) {
    blocked.push(t("GOS.Compat.NewerCore", { source: coreVersion, target: game.version }));
  } else if (isNewer(localGeneration, sourceGeneration)) {
    older.push(t("GOS.Compat.OlderCore", { source: coreVersion, target: game.version }));
  }

  if (systemVersion && localSystemVersion) {
    const fmt = { source: systemVersion, target: localSystemVersion };
    if (isNewer(versionPrefix(systemVersion, 2), versionPrefix(localSystemVersion, 2))) {
      blocked.push(t("GOS.Compat.NewerSystem", fmt));
    } else if (isNewer(localSystemVersion, systemVersion)) {
      older.push(t("GOS.Compat.OlderSystem", fmt));
    } else if (isNewer(systemVersion, localSystemVersion)) {
      // Newer patch release of the same major/minor version: allowed, but flagged.
      older.push(t("GOS.Compat.NewerSystemPatch", fmt));
    }
  }

  if (blocked.length) return { level: "blocked", reasons: blocked };
  if (older.length) return { level: "older", reasons: older };
  return { level: "ok", reasons: [] };
}

/** Throw if the data must not be imported into this installation. */
function assertImportCompatible(type, data) {
  const compat = checkImportCompatibility(type, data);
  if (compat.level === "blocked") {
    throw new Error(`${data?.name ?? data?._id ?? "?"}: ${compat.reasons.join(" ")}`);
  }
  return compat;
}

/**
 * Migrate source data to the local data schema before it is written.
 * `migrateDataSafe` applies Foundry core migrations and the `migrateData`
 * hooks of the active system's data models, including embedded documents.
 * It is called explicitly because `update()` does not reliably migrate the
 * replacement data the way document construction in `create()` does.
 */
function migrateImportData(type, data) {
  const cls = getDocumentClass(type);
  if (typeof cls?.migrateDataSafe === "function") cls.migrateDataSafe(data);
  return data;
}

/** Show a yes/no dialog; resolve to true only if the user confirms. */
async function confirmDialog(title, content) {
  const DV2 = foundry.applications?.api?.DialogV2;
  if (DV2?.confirm) {
    return (await DV2.confirm({ window: { title }, content, rejectClose: false, modal: true })) === true;
  }
  return (await Dialog.confirm({ title, content })) === true;
}

/**
 * Apply the compatibility check to a dialog selection: skip blocked entries
 * and ask for confirmation (with a backup hint) if older or unversioned data
 * is selected. Returns the values that may be imported.
 */
async function filterImportSelection(values, compatByValue) {
  const level = (v) => compatByValue.get(v)?.level;
  const blocked = values.filter((v) => level(v) === "blocked");
  const allowed = values.filter((v) => level(v) !== "blocked");
  if (blocked.length) ui.notifications.error(t("GOS.Compat.SkippedBlocked", { count: blocked.length }));
  const warned = allowed.filter((v) => level(v) === "older" || level(v) === "unknown");
  if (!warned.length) return allowed;
  const ok = await confirmDialog(
    t("GOS.Compat.ConfirmTitle"),
    `<p>${escHtml(t("GOS.Compat.ConfirmText", { count: warned.length }))}</p>`
  );
  return ok ? allowed : [];
}

/** Create or update a document from loaded data. */
async function importDataDoc(type, data, folderOpts = {}) {
  assertImportCompatible(type, data);
  migrateImportData(type, data);
  const cls = getDocumentClass(type);
  const collection = TYPE_CONFIG[type].collection();
  const existing = data._id ? collection.get(data._id) : null;
  const overwrite = game.settings.get(MODULE_ID, "overwriteImport");

  // Resolve the destination sidebar folder and replace the source folder ID.
  const mode = folderOpts.folderMode ?? importFolderMode();
  const name = folderOpts.folderName ?? importFolderName();
  await resolveImportFolder(type, data, mode, name);

  if (existing) {
    if (overwrite) {
      await existing.update(data, { diff: false, recursive: false });
      return "updated";
    }
    const clone = foundry.utils.deepClone(data);
    delete clone._id;
    await cls.create(clone);
    return "copied";
  }

  await cls.create(data, { keepId: true });
  return "created";
}

/**
 * Load an import entry (including assets) and import it as a document.
 * `tree` is passed once in GitHub mode to avoid repeated requests.
 * `opts` overrides the global settings for this import
 * ({ assetPrefix, folderMode, folderName }).
 */
async function importValue(type, value, tree = null, opts = {}) {
  const withAssets = syncAssets();
  const prefix = opts.assetPrefix ?? importAssetPrefix();
  const sha = (tree ?? (await githubTree())).get(value);
  if (!sha) throw new Error(`Nicht im Repo: ${value}`);
  const data = JSON.parse(new TextDecoder().decode(await githubReadBlob(sha)));
  // Check before restoring assets so nothing is written for blocked data.
  assertImportCompatible(type, data);
  if (withAssets) await restoreAssetsGithub(data, tree ?? (await githubTree()), prefix);
  // After restoring assets, update references to point to the destination.
  rewriteAssetPaths(data, prefix);
  return importDataDoc(type, data, { folderMode: opts.folderMode, folderName: opts.folderName });
}

/* -------------------------------------------------------------------------- */
/*  Compendiums (world compendiums)                                            */
/* -------------------------------------------------------------------------- */
/*  Only GM-owned world compendiums are supported (metadata.packageType ===  */
/*  "world"); module/system compendiums are skipped because their contents   */
/*  are versioned by their respective packages. All documents from all world */
/*  compendiums are combined into one list grouped by compendium for the     */
/*  export/import dialog (selection value "<pack.collection>::<id>").        */
/*  Internal compendium folders (separate from the world sidebar; see         */
/*  ensureCompendiumFolderPath) are exported by name path and recreated by   */
/*  name in the destination compendium.                                      */
/* -------------------------------------------------------------------------- */

/** Return all GM-owned world compendiums (excluding module/system compendiums). */
function worldPacks() {
  return game.packs.filter((p) => p.metadata.packageType === "world");
}

/** Find a world compendium by its stable collection ID, falling back to its label for legacy exports. */
function findLocalWorldPack(type, meta) {
  const packs = worldPacks().filter((p) => p.documentName === type);
  const collection = typeof meta.collection === "string" ? meta.collection : "";
  if (collection) return packs.find((p) => p.collection === collection) ?? null;
  return packs.find((p) => p.title === meta.label) ?? null;
}

/**
 * Resolve the destination pack for an import: reuse a world pack with the same
 * collection ID and document type, or create a distinct pack if none exists.
 * Legacy exports without a collection ID fall back to matching by label and type.
 * `packCache` stores the result per import run so a pack is only looked up or
 * created once when importing multiple documents from it.
 */
async function resolveOrCreateWorldPack(type, meta, packCache) {
  const label = meta.label || "Import";
  const collection = typeof meta.collection === "string" ? meta.collection : "";
  const identity = collection || label;
  const key = `${type}::${identity}`;
  if (packCache.has(key)) return packCache.get(key);
  let pack = findLocalWorldPack(type, meta);
  if (!pack) {
    const CompendiumCollectionCls = foundry.documents?.collections?.CompendiumCollection ?? CompendiumCollection;
    const sourceName = collection.startsWith("world.")
      ? collection.slice("world.".length)
      : collection || label;
    pack = await CompendiumCollectionCls.createCompendium({
      type,
      label,
      name: sourceName.slugify({ strict: true }) || label.slugify({ strict: true })
    });
  }
  packCache.set(key, pack);
  return pack;
}

/**
 * Create a folder hierarchy inside a compendium by name and return the leaf ID.
 * Similar to `ensureFolderPath()`, but uses pack folders instead of the world
 * sidebar (`pack.folders` instead of `game.folders`; created via
 * `Folder.create({..}, {pack: pack.collection})`). Foundry adds new folders to
 * `pack.folders`, so documents from the same compendium share folders created
 * earlier in this import run instead of creating duplicates.
 */
async function ensureCompendiumFolderPath(pack, names) {
  let parentId = null;
  for (const name of names) {
    if (!name) continue;
    let folder = pack.folders.find(
      (f) => f.name === name && (f.folder?.id ?? null) === parentId
    );
    if (!folder) {
      folder = await Folder.create(
        { name, type: pack.documentName, folder: parentId },
        { pack: pack.collection }
      );
    }
    parentId = folder.id;
  }
  return parentId;
}

/**
 * Build the export payload for one compendium document, similar to
 * `buildExportJson` but using the `compendia/<collection>` path scheme and
 * storing compendium metadata (collection ID, label, and type) in a flag so
 * import can find or create the matching compendium. The internal folder
 * hierarchy (root -> leaf, by name) is also stored as a flag because the raw
 * folder ID belongs to a different compendium on the destination installation
 * and cannot be reused directly (see ensureCompendiumFolderPath /
 * importCompendiumDataDoc).
 */
function buildCompendiumExportJson(doc, pack, flatten, withAssets) {
  const data = doc.toObject();
  const folderPath = folderPathOf(doc);
  delete data.folder;
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.compendium`, {
    collection: pack.collection,
    label: pack.title,
    type: pack.documentName,
    folderPath
  });
  const assetMap = withAssets ? remapExportAssets(data, flatten, pack.documentName) : new Map();
  const json = JSON.stringify(data, null, 2);
  const fileName = `${sanitize(doc.name)}__${doc.id}.json`;
  return { folder: `compendia/${pack.collection}`, fileName, json, assetMap };
}

/** Export multiple compendium documents. `entries`: [{ doc, pack }]. */
async function exportCompendiumDocuments(entries, opts = {}) {
  const withAssets = syncAssets();
  const flatten = opts.flattenAssets ?? exportFlattenAssets();
  const jsonWrites = [];
  const assetMap = new Map();

  for (const { doc, pack } of entries) {
    const { folder, fileName, json, assetMap: docAssets } = buildCompendiumExportJson(doc, pack, flatten, withAssets);
    for (const [dest, src] of docAssets) if (!assetMap.has(dest)) assetMap.set(dest, src);
    jsonWrites.push({ folder, fileName, json });
  }

  return pushExportBundle(jsonWrites, assetMap);
}

/** Determine a compendium document's sync status against GitHub (see exportDeltaStatus). */
async function compendiumExportDeltaStatus(doc, pack, tree, flatten, withAssets) {
  const { folder, fileName, json } = buildCompendiumExportJson(doc, pack, flatten, withAssets);
  const remoteSha = tree.get(`${folder}/${fileName}`);
  if (!remoteSha) return "new";
  const localSha = await gitBlobSha1(json);
  return localSha === remoteSha ? "unchanged" : "changed";
}

/** List available compendium import entries from an already loaded tree. */
function listCompendiumImportEntriesFromTree(tree) {
  const prefix = "compendia/";
  return [...tree.keys()]
    .filter((p) => p.startsWith(prefix) && p.toLowerCase().endsWith(".json"))
    .map((p) => ({ value: p, base: basename(p) }));
}

/**
 * Determine the sync status of a compendium import entry against the local pack
 * (see importDeltaStatus).
 * `meta` contains the exported compendium metadata from
 * `flags.<MODULE_ID>.compendium`.
 */
async function compendiumImportDeltaStatus(meta, data, tree, entryValue, flatten, withAssets) {
  if (!data?._id || !meta?.type) return "new";
  const pack = findLocalWorldPack(meta.type, meta);
  if (!pack) return "new";
  const local = await pack.getDocument(data._id);
  if (!local) return "new";
  const { json } = buildCompendiumExportJson(local, pack, flatten, withAssets);
  const localSha = await gitBlobSha1(json);
  const remoteSha = tree.get(entryValue);
  return localSha === remoteSha ? "unchanged" : "changed";
}

/**
 * Create or update a compendium document from loaded data.
 * First restore or create its internal folder hierarchy in the destination
 * pack using the name path from `flags.<MODULE_ID>.compendium.folderPath`
 * (see ensureCompendiumFolderPath), then set `data.folder` to the resolved
 * leaf folder ID.
 */
async function importCompendiumDataDoc(pack, data) {
  assertImportCompatible(pack.documentName, data);
  migrateImportData(pack.documentName, data);
  const cls = getDocumentClass(pack.documentName);
  const existing = data._id ? await pack.getDocument(data._id) : null;
  const overwrite = game.settings.get(MODULE_ID, "overwriteImport");
  const path = foundry.utils.getProperty(data, `flags.${MODULE_ID}.compendium.folderPath`) || [];
  data.folder = Array.isArray(path) && path.length ? await ensureCompendiumFolderPath(pack, path) : null;

  if (existing) {
    if (overwrite) {
      await existing.update(data, { diff: false, recursive: false });
      return "updated";
    }
    const clone = foundry.utils.deepClone(data);
    delete clone._id;
    await cls.create(clone, { pack: pack.collection });
    return "copied";
  }

  await cls.create(data, { pack: pack.collection, keepId: true });
  return "created";
}

/**
 * Load a compendium import entry (including assets) and import it into the
 * matching world compendium, creating the pack if needed. `packCache` stores
 * packs already resolved or created during this import
 * (see resolveOrCreateWorldPack).
 */
async function importCompendiumValue(value, tree, opts, packCache) {
  const withAssets = syncAssets();
  const prefix = opts.assetPrefix ?? importAssetPrefix();
  const sha = tree.get(value);
  if (!sha) throw new Error(`Nicht im Repo: ${value}`);
  const data = JSON.parse(new TextDecoder().decode(await githubReadBlob(sha)));
  const meta = foundry.utils.getProperty(data, `flags.${MODULE_ID}.compendium`) || {};
  if (!meta.type) throw new Error("Kompendium-Metadaten fehlen in dieser Export-Datei.");
  // Check before restoring assets so nothing is written for blocked data.
  assertImportCompatible(meta.type, data);
  if (withAssets) await restoreAssetsGithub(data, tree, prefix);
  rewriteAssetPaths(data, prefix);

  const pack = await resolveOrCreateWorldPack(meta.type, meta, packCache);
  return importCompendiumDataDoc(pack, data);
}

/* -------------------------------------------------------------------------- */
/*  Dialogs                                                                    */
/* -------------------------------------------------------------------------- */

/** Escape HTML special characters. */
function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

/** Return the display label for grouping documents by their (sub)type. */
function groupLabel(docType, sub) {
  if (!sub || sub === "base") return t("GOS.Dialog.GroupOther");
  const key = CONFIG?.[docType]?.typeLabels?.[sub];
  if (key) {
    const loc = game.i18n.localize(key);
    if (loc && loc !== key) return loc;
  }
  return String(sub).charAt(0).toUpperCase() + String(sub).slice(1);
}

/** "Show deltas only" checkbox shared by the export and import dialogs. */
function deltaFilterOptionHtml() {
  const checked = game.settings.get(MODULE_ID, "hideUnchanged");
  return `
    <label class="gos-opt">
      <input type="checkbox" class="gos-opt-deltafilter" ${checked ? "checked" : ""}/>
      <span>${t("GOS.Dialog.OptHideUnchanged")}</span>
    </label>`;
}

/** Export dialog options (flatten checkbox and delta filter). */
function exportOptionsHtml() {
  const flatten = exportFlattenAssets();
  return `
    <label class="gos-opt">
      <input type="checkbox" class="gos-opt-flatten" ${flatten ? "checked" : ""}/>
      <span>${t("GOS.Dialog.OptFlatten")}</span>
    </label>
    ${deltaFilterOptionHtml()}`;
}

/** Read the selected export options from the dialog. */
function readExportOptions(root) {
  const cb = root.querySelector(".gos-opt-flatten");
  return { flattenAssets: cb ? cb.checked : undefined };
}

/** Import dialog options (asset destination, folder mode, and delta filter). */
function importOptionsHtml() {
  const prefix = importAssetPrefix();
  const mode = importFolderMode();
  const name = importFolderName();
  const opt = (v, label) =>
    `<option value="${v}" ${mode === v ? "selected" : ""}>${escHtml(label)}</option>`;
  return `
    <label class="gos-opt gos-opt--col">
      <span>${t("GOS.Dialog.OptAssetTarget")}</span>
      <input type="text" class="gos-opt-assetprefix" value="${escHtml(prefix)}" placeholder="z. B. git-import"/>
    </label>
    <label class="gos-opt gos-opt--col">
      <span>${t("GOS.Dialog.OptFolderMode")}</span>
      <select class="gos-opt-foldermode">
        ${opt("original", t("GOS.Settings.ImportFolderMode.Original"))}
        ${opt("none", t("GOS.Settings.ImportFolderMode.None"))}
        ${opt("custom", t("GOS.Settings.ImportFolderMode.Custom"))}
      </select>
    </label>
    <label class="gos-opt gos-opt--col">
      <span>${t("GOS.Dialog.OptFolderName")}</span>
      <input type="text" class="gos-opt-foldername" value="${escHtml(name)}" placeholder="z. B. Git Import"/>
    </label>
    ${deltaFilterOptionHtml()}`;
}

/** Read the selected import options from the dialog. */
function readImportOptions(root) {
  return {
    assetPrefix: (root.querySelector(".gos-opt-assetprefix")?.value ?? "")
      .trim()
      .replace(/^\/+|\/+$/g, ""),
    folderMode: root.querySelector(".gos-opt-foldermode")?.value || undefined,
    folderName: (root.querySelector(".gos-opt-foldername")?.value ?? "").trim()
  };
}

/**
 * Compendium import dialog options (asset destination and delta filter).
 * There is no folder mode because compendium documents have no sidebar folder.
 */
function compendiumImportOptionsHtml() {
  const prefix = importAssetPrefix();
  return `
    <label class="gos-opt gos-opt--col">
      <span>${t("GOS.Dialog.OptAssetTarget")}</span>
      <input type="text" class="gos-opt-assetprefix" value="${escHtml(prefix)}" placeholder="z. B. git-import"/>
    </label>
    ${deltaFilterOptionHtml()}`;
}

function buildCheckboxList(entries, optionsHtml = "") {
  // entries: [{ value, label, img, desc, group, ghSha, mime }]
  const esc = escHtml;

  const statusLabels = {
    new: t("GOS.Dialog.StatusNew"),
    changed: t("GOS.Dialog.StatusChanged"),
    unchanged: t("GOS.Dialog.StatusUnchanged")
  };
  const compatLabels = {
    blocked: t("GOS.Compat.BadgeBlocked"),
    older: t("GOS.Compat.BadgeOlder"),
    unknown: t("GOS.Compat.BadgeUnknown")
  };

  const rowHtml = (e) => {
    const fallbackAttrs = e.ghSha ? ` data-gh-sha="${esc(e.ghSha)}" data-mime="${esc(e.mime || "image/png")}"` : "";
    const thumb = e.img
      ? `<img class="gos-thumb" src="${esc(e.img)}" loading="lazy" alt="" style="width:40px;height:40px;"${fallbackAttrs}/>`
      : `<span class="gos-thumb gos-thumb--empty" style="width:40px;height:40px;"><i class="fa-solid fa-cube"></i></span>`;
    const desc = e.desc ? `<span class="gos-desc">${esc(e.desc)}</span>` : "";
    const search = esc(`${e.label ?? ""} ${e.desc ?? ""}`.toLowerCase());
    const status = e.status || null;
    const badge = status
      ? `<span class="gos-badge gos-badge--${status}">${esc(statusLabels[status] ?? status)}</span>`
      : "";
    const compatLevel = e.compat?.level;
    const compatBadge = compatLevel && compatLevel !== "ok"
      ? `<span class="gos-badge gos-badge--compat-${esc(compatLevel)}" title="${esc(e.compat.reasons.join("\n"))}">${esc(compatLabels[compatLevel] ?? compatLevel)}</span>`
      : "";
    return `
      <label class="gos-row" data-search="${search}" data-status="${esc(status || "")}">
        <input type="checkbox" name="gos" value="${esc(e.value)}"/>
        ${thumb}
        <span class="gos-text">
          <span class="gos-name">${esc(e.label)} ${badge}${compatBadge}</span>
          ${desc}
        </span>
      </label>`;
  };

  // Group entries alphabetically, with "Other" at the end.
  const otherLabel = t("GOS.Dialog.GroupOther");
  const groups = new Map();
  for (const e of entries) {
    const g = e.group || otherLabel;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(e);
  }
  const groupNames = [...groups.keys()].sort((a, b) => {
    if (a === otherLabel) return 1;
    if (b === otherLabel) return -1;
    return a.localeCompare(b);
  });
  const multi = groupNames.length > 1;

  const sections = groupNames
    .map((name) => {
      const rows = groups.get(name).map(rowHtml).join("");
      if (!multi) return `<div class="gos-list">${rows}</div>`;
      return `
        <details class="gos-group">
          <summary class="gos-group-head">
            <i class="fa-solid fa-chevron-right gos-group-chevron"></i>
            <span class="gos-group-name">${esc(name)}</span>
            <span class="gos-group-count">${groups.get(name).length}</span>
          </summary>
          <div class="gos-list">${rows}</div>
        </details>`;
    })
    .join("");

  // Embed all dialog styling (not only layout, but also colors and borders)
  // instead of loading it from the external CSS file. External stylesheets
  // were unreliable in practice (cache/load order), leaving the dialog
  // completely unstyled. Set a basic rgba() color first, then override it
  // with color-mix() based on currentColor when supported. This adapts the
  // dialog to the active theme without making it invisible where color-mix()
  // is unsupported.
  const style = `
    <style>
      /* Use one continuous scroll area for the entire window content so the
         search, toolbar, and object list scroll together instead of scrolling
         only the list internally. */
      .gos-dialog {
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
      }
      .gos-dialog * { box-sizing: border-box; }

      .gos-dialog .gos-search,
      .gos-dialog .gos-toolbar,
      .gos-dialog .gos-group {
        border-radius: 6px;
        background: rgba(127, 127, 127, 0.12);
        background: color-mix(in srgb, currentColor 8%, transparent);
        border: 1px solid rgba(127, 127, 127, 0.35);
        border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
      }

      .gos-dialog .gos-search {
        display: flex; align-items: center; gap: 8px; padding: 7px 12px;
        transition: border-color 0.12s ease;
        flex: 0 0 auto;
      }
      .gos-dialog .gos-search:focus-within {
        border-color: rgba(127, 127, 127, 0.7);
        border-color: color-mix(in srgb, currentColor 55%, transparent);
      }
      .gos-dialog .gos-search i { opacity: 0.65; }
      .gos-dialog .gos-search input {
        flex: 1; background: transparent; border: none; outline: none; color: inherit; font-size: 1em;
      }

      .gos-dialog .gos-toolbar { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; flex: 0 0 auto; }
      .gos-dialog .gos-selectall { display: flex; align-items: center; gap: 8px; padding: 2px; cursor: pointer; font-weight: 600; }
      .gos-dialog .gos-opt { display: flex; align-items: center; gap: 8px; margin: 0; padding: 2px; cursor: pointer; }
      .gos-dialog .gos-opt--col { flex-direction: column; align-items: stretch; gap: 3px; cursor: default; }
      .gos-dialog .gos-opt--col > span { font-size: 0.85em; opacity: 0.75; }
      .gos-dialog .gos-opt input[type="text"], .gos-dialog .gos-opt select {
        background: rgba(127, 127, 127, 0.1);
        background: color-mix(in srgb, currentColor 6%, transparent);
        color: inherit;
        border: 1px solid rgba(127, 127, 127, 0.35);
        border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
        border-radius: 4px; padding: 4px 6px;
      }
      /* Separator between option rows and "Select all" (only when options exist). */
      .gos-dialog .gos-toolbar .gos-opt ~ .gos-selectall {
        padding-top: 8px; margin-top: 2px;
        border-top: 1px solid rgba(127, 127, 127, 0.25);
        border-top: 1px solid color-mix(in srgb, currentColor 16%, transparent);
      }

      .gos-dialog input[type="checkbox"] { accent-color: currentColor; }

      /* Section separator between the toolbar and object list. */
      .gos-dialog .gos-divider {
        height: 2px; margin: 0 2px; flex: 0 0 auto; border-radius: 1px;
        background: rgba(127, 127, 127, 0.4);
        background: color-mix(in srgb, currentColor 30%, transparent);
      }

      .gos-dialog .gos-scroll { flex: 0 0 auto; padding-right: 2px; }
      .gos-dialog .gos-list { display: flex; flex-direction: column; gap: 4px; }
      .gos-dialog .gos-group { margin: 0 0 4px; overflow: hidden; }
      .gos-dialog .gos-group .gos-list { padding: 5px 6px 7px; }

      /* Group heading: clearly distinguish it as a heading (larger, bold,     */
      /* eigener Hintergrund + farbiger Akzentbalken links). */
      .gos-dialog .gos-group > summary {
        display: flex; align-items: center; gap: 8px; padding: 8px 10px;
        cursor: pointer; list-style: none;
        font-size: 1.05em; font-weight: 700;
        border-left: 4px solid rgba(127, 127, 127, 0.55);
        border-left: 4px solid color-mix(in srgb, currentColor 45%, transparent);
        background: rgba(127, 127, 127, 0.08);
        background: color-mix(in srgb, currentColor 6%, transparent);
      }
      .gos-dialog .gos-group > summary::-webkit-details-marker,
      .gos-dialog .gos-group > summary::marker { display: none; content: ""; }
      .gos-dialog .gos-group[open] > summary {
        border-bottom: 1px solid rgba(127, 127, 127, 0.3);
        border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      }
      .gos-dialog .gos-group-chevron { flex: 0 0 auto; font-size: 0.8em; opacity: 0.7; transition: transform 0.12s ease; }
      .gos-dialog .gos-group[open] .gos-group-chevron { transform: rotate(90deg); }
      .gos-dialog .gos-group-name { flex: 1; }
      .gos-dialog .gos-group-count {
        flex: 0 0 auto; border-radius: 10px; padding: 0 8px; font-size: 0.85em; font-weight: 400;
        background: rgba(127, 127, 127, 0.2);
        background: color-mix(in srgb, currentColor 18%, transparent);
      }

      .gos-dialog .gos-row {
        display: grid; grid-template-columns: 18px 40px 1fr; align-items: center;
        column-gap: 10px; padding: 5px 8px; cursor: pointer; border-radius: 3px;
        border: 1px solid transparent;
        transition: background 0.1s ease, border-color 0.1s ease;
      }
      .gos-dialog .gos-row:hover {
        background: rgba(127, 127, 127, 0.14);
        background: color-mix(in srgb, currentColor 10%, transparent);
        border-color: rgba(127, 127, 127, 0.3);
        border-color: color-mix(in srgb, currentColor 22%, transparent);
      }
      .gos-dialog .gos-row input[type="checkbox"] { width: 16px; height: 16px; margin: 0; cursor: pointer; }
      .gos-dialog .gos-thumb, .gos-dialog .gos-thumb--empty {
        width: 40px; height: 40px; border-radius: 3px; object-fit: cover;
        display: flex; align-items: center; justify-content: center;
        border: 1px solid rgba(127, 127, 127, 0.3);
        border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
      }
      .gos-dialog .gos-thumb--empty {
        opacity: 0.5;
        background: rgba(127, 127, 127, 0.1);
        background: color-mix(in srgb, currentColor 6%, transparent);
      }
      .gos-dialog .gos-text { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
      .gos-dialog .gos-name, .gos-dialog .gos-desc {
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .gos-dialog .gos-name { font-weight: 600; }
      .gos-dialog .gos-desc { font-size: 0.8em; opacity: 0.7; }

      /* Sync status badges (new/changed/unchanged) next to the document name. */
      .gos-dialog .gos-badge {
        display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 8px;
        font-size: 0.75em; font-weight: 700; vertical-align: middle; white-space: nowrap;
      }
      .gos-dialog .gos-badge--new {
        background: rgba(76, 175, 80, 0.22); color: #4caf50;
      }
      .gos-dialog .gos-badge--changed {
        background: rgba(255, 152, 0, 0.22); color: #ff9800;
      }
      .gos-dialog .gos-badge--unchanged {
        background: rgba(127, 127, 127, 0.22); color: inherit; opacity: 0.7;
      }
      /* Version compatibility badges (see checkImportCompatibility). */
      .gos-dialog .gos-badge--compat-blocked {
        background: rgba(244, 67, 54, 0.22); color: #f44336; cursor: help;
      }
      .gos-dialog .gos-badge--compat-older,
      .gos-dialog .gos-badge--compat-unknown {
        background: rgba(255, 193, 7, 0.22); color: #ffc107; cursor: help;
      }

      .gos-dialog .gos-hidden { display: none !important; }
      .gos-dialog .gos-empty { padding: 12px; text-align: center; font-style: italic; opacity: 0.6; }

      /* DialogV2 automatically inserts a "form.dialog-form.standard-form" and
         a "div.dialog-content.standard-form" between ".window-content" and our
         content. Both are flex columns by default with "min-height: auto" and
         "overflow: visible", which breaks the flex chain and prevents both
         window sizing and our inner ".gos-scroll" area from working. Explicitly
         pass sizing through the entire chain. */
      .git-object-sync-dialog .window-content,
      .git-object-sync-dialog .window-content .dialog-form,
      .git-object-sync-dialog .window-content .dialog-content {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
      }
      .git-object-sync-dialog .window-content {
        padding: 10px 12px 12px;
      }

      /* Foundry's built-in resize handle icon (a tiny 11x11px background image)
         can be hard to see depending on the theme/system. Add a separate,
         reliably visible grip indicator (diagonal stripes in the corner) using
         CSS only, independent of the image asset. */
      .git-object-sync-dialog .window-resize-handle {
        width: 15px;
        height: 15px;
        opacity: 0.6;
        background-image: repeating-linear-gradient(
          -45deg,
          currentColor 0,
          currentColor 1.5px,
          transparent 1.5px,
          transparent 4px
        );
        background-position: bottom right;
        background-repeat: no-repeat;
        clip-path: polygon(100% 0, 100% 100%, 0 100%);
      }
      .git-object-sync-dialog .window-resize-handle:hover { opacity: 1; }
    </style>`;

  return `
    ${style}
    <div class="gos-dialog">
      <div class="gos-search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" class="gos-search-input" placeholder="${t("GOS.Dialog.SearchPlaceholder")}"/>
      </div>
      <div class="gos-toolbar">
        ${optionsHtml}
        <label class="gos-selectall">
          <input type="checkbox" class="gos-select-all"/>
          <span>${t("GOS.Dialog.SelectAll")}</span>
        </label>
      </div>
      <div class="gos-divider"></div>
      <div class="gos-scroll">
        ${sections}
        <div class="gos-empty gos-hidden">${t("GOS.Dialog.NoMatches")}</div>
      </div>
    </div>`;
}

/** Preview image URL: leave external/data URLs unchanged and route other paths. */
function thumbUrl(img) {
  if (!img) return null;
  if (/^(https?:|data:)/i.test(img)) return img;
  try {
    return dataUrl(String(img).replace(/^\/+/, ""));
  } catch {
    return img;
  }
}

/** Select the first useful preview image from a document/data object. */
function pickImg(o) {
  return (
    o?.img ||
    o?.thumb ||
    o?.background?.src ||
    o?.prototypeToken?.texture?.src ||
    null
  );
}

/** Build a short, HTML-free description from common system fields. */
function docSummary(o) {
  const raw =
    o?.system?.description?.value ??
    (typeof o?.system?.description === "string" ? o.system.description : null) ??
    o?.system?.biography?.value ??
    o?.system?.details?.biography?.value ??
    o?.system?.details?.notes ??
    "";
  const text = String(raw)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function wireSelectAll(dialogElement) {
  const root = dialogElement?.element ?? dialogElement;
  if (!root || typeof root.querySelector !== "function") return;

  // Replace broken/missing preview images. During import, the image reference
  // stored in the JSON (for a shared-folder export) may no longer point to a
  // locally reachable path. Try the blob from the GitHub tree as a data URI
  // before falling back to a placeholder icon.
  root.querySelectorAll("img.gos-thumb").forEach((img) => {
    img.addEventListener("error", async () => {
      const stage = Number(img.dataset.gosStage || 0);
      if (stage === 0 && img.dataset.ghSha) {
        img.dataset.gosStage = "1";
        try {
          const bytes = await githubReadBlob(img.dataset.ghSha);
          img.src = `data:${img.dataset.mime || "image/png"};base64,${bytesToBase64(bytes)}`;
          return;
        } catch (err) {
          console.warn(`${MODULE_ID} | Vorschau (GitHub-Blob) fehlgeschlagen`, err);
        }
      }
      const span = document.createElement("span");
      span.className = "gos-thumb gos-thumb--empty";
      span.innerHTML = '<i class="fa-solid fa-cube"></i>';
      img.replaceWith(span);
    });
  });

  const isHidden = (el) => el.closest(".gos-hidden") !== null;

  const all = root.querySelector(".gos-select-all");
  if (all) {
    all.addEventListener("change", () => {
      // Toggle only currently visible (not filtered out) entries.
      root.querySelectorAll('input[name="gos"]').forEach((cb) => {
        if (!isHidden(cb)) cb.checked = all.checked;
      });
    });
  }

  // Combine live search (name/description) with the delta filter (hide
  // unchanged objects). Hide rows that fail either filter, hide empty groups,
  // and show a message when there are no matches.
  const search = root.querySelector(".gos-search-input");
  const deltaFilter = root.querySelector(".gos-opt-deltafilter");
  if (search || deltaFilter) {
    const rows = Array.from(root.querySelectorAll(".gos-row"));
    const groups = Array.from(root.querySelectorAll(".gos-group"));
    const empty = root.querySelector(".gos-empty");
    const applyFilters = () => {
      const q = (search?.value ?? "").trim().toLowerCase();
      const hideUnchanged = deltaFilter?.checked ?? false;
      let anyVisible = false;
      for (const row of rows) {
        const matchesSearch = !q || (row.dataset.search || "").includes(q);
        const matchesDelta = !hideUnchanged || row.dataset.status !== "unchanged";
        const match = matchesSearch && matchesDelta;
        row.classList.toggle("gos-hidden", !match);
        if (match) anyVisible = true;
      }
      for (const g of groups) {
        const groupHasMatch = g.querySelector(".gos-row:not(.gos-hidden)") !== null;
        g.classList.toggle("gos-hidden", !groupHasMatch);
        if (q && groupHasMatch) g.open = true; // Expand matching groups during search.
      }
      if (empty) empty.classList.toggle("gos-hidden", anyVisible);
    };
    search?.addEventListener("input", applyFilters);
    deltaFilter?.addEventListener("change", applyFilters);
    applyFilters(); // Anfangszustand (Delta-Filter-Default) sofort anwenden.
  }
}

function readSelected(dialogElement) {
  const root = dialogElement?.element ?? dialogElement;
  return Array.from(
    root.querySelectorAll('input[name="gos"]:checked')
  ).map((cb) => cb.value);
}

/**
 * Show a selection dialog. Use DialogV2 when available, falling back to the
 * classic dialog otherwise or if an error occurs. `onConfirm` receives the
 * root HTMLElement of the dialog content.
 */
async function openSelectionDialog({ title, content, confirmLabel, confirmIcon, onConfirm }) {
  const DV2 = foundry.applications?.api?.DialogV2;
  if (DV2) {
    try {
      await DV2.wait({
        window: { title, resizable: true },
        position: { width: 520, height: 600 },
        classes: ["git-object-sync-dialog"],
        content,
        rejectClose: false,
        buttons: [
          {
            action: "ok",
            label: confirmLabel,
            icon: confirmIcon,
            default: true,
            callback: (event, button, dialog) => onConfirm(dialog.element ?? dialog)
          },
          { action: "cancel", label: t("GOS.Dialog.Cancel") }
        ],
        render: (event, dialog) => wireSelectAll(dialog.element ?? dialog)
      });
      return;
    } catch (err) {
      console.error(`${MODULE_ID} | DialogV2 fehlgeschlagen, Fallback auf Dialog`, err);
    }
  }

  // Fallback: classic dialog (V1). It has been deprecated since v12 and is
  // scheduled for removal in v14 according to the Foundry roadmap. Prefer the
  // reference already moved into the "appv1" namespace, then try the global
  // identifier. This avoids a ReferenceError if "Dialog" is removed and lets
  // us show a clear error message instead.
  const DialogV1 = foundry.appv1?.api?.Dialog ?? (typeof Dialog !== "undefined" ? Dialog : null);
  if (!DialogV1) {
    ui.notifications.error(
      t("GOS.Notify.DialogError", { error: "Weder DialogV2 noch ein klassischer Dialog sind verfügbar." })
    );
    return;
  }

  await new Promise((resolve) => {
    new DialogV1(
      {
        title,
        content,
        default: "ok",
        buttons: {
          ok: {
            icon: `<i class="${confirmIcon}"></i>`,
            label: confirmLabel,
            callback: (html) => onConfirm(html?.[0] ?? html)
          },
          cancel: { label: t("GOS.Dialog.Cancel") }
        },
        render: (html) => wireSelectAll(html?.[0] ?? html),
        close: () => resolve()
      },
      { classes: ["git-object-sync-dialog"], resizable: true }
    ).render(true);
  });
}

/** Open the export dialog for a document type. */
async function openExportDialog(type) {
  const cfg = TYPE_CONFIG[type];
  const label = game.i18n.localize(`DOCUMENT.${type}`) || type;
  const docs = cfg.collection().contents.sort((a, b) => a.name.localeCompare(b.name));

  // Load the repository tree to determine each object's sync status
  // (new/changed/unchanged). If this fails (e.g. an invalid token), continue
  // without status data; the dialog remains usable but has no badges/filter.
  let tree = null;
  try {
    tree = await githubTree();
  } catch (err) {
    console.warn(`${MODULE_ID} | Sync-Status konnte nicht ermittelt werden`, err);
  }
  const withAssets = syncAssets();
  const flatten = exportFlattenAssets();

  const entries = await Promise.all(
    docs.map(async (d) => {
      const src = d.toObject();
      return {
        value: d.id,
        label: d.name,
        img: thumbUrl(pickImg(src)),
        desc: docSummary(src),
        group: groupLabel(type, src.type),
        status: tree ? await exportDeltaStatus(d, tree, flatten, withAssets) : null
      };
    })
  );
  const content = docs.length
    ? buildCheckboxList(entries, exportOptionsHtml())
    : `<p>${t("GOS.Dialog.NothingSelected")}</p>`;

  await openSelectionDialog({
    title: t("GOS.Dialog.ExportTitle", { label }),
    content,
    confirmLabel: t("GOS.Dialog.ExportButton"),
    confirmIcon: "fa-solid fa-code-branch",
    onConfirm: async (root) => {
      const ids = readSelected(root);
      if (!ids.length) return ui.notifications.warn(t("GOS.Dialog.NothingSelected"));
      const selected = ids.map((id) => cfg.collection().get(id)).filter(Boolean);
      const opts = readExportOptions(root);
      try {
        const { count, assets } = await exportDocuments(selected, opts);
        ui.notifications.info(t("GOS.Notify.Exported", { count, assets }));
      } catch (err) {
        console.error(`${MODULE_ID} | Export`, err);
        ui.notifications.error(t("GOS.Notify.ExportError", { error: err.message }));
      }
    }
  });
}

/**
 * Open the export dialog for all world compendiums. Unlike other types, there
 * is no single document type here; instead, all documents from all world
 * compendiums are shown in one list grouped by compendium
 * (selection value "<pack.collection>::<id>").
 */
async function openCompendiumExportDialog() {
  const label = t("GOS.Dialog.CompendiaLabel");
  const packs = worldPacks();
  if (!packs.length) {
    return ui.notifications.warn(t("GOS.Dialog.NoCompendia"));
  }

  let tree = null;
  try {
    tree = await githubTree();
  } catch (err) {
    console.warn(`${MODULE_ID} | Sync-Status konnte nicht ermittelt werden`, err);
  }
  const withAssets = syncAssets();
  const flatten = exportFlattenAssets();

  const entries = [];
  for (const pack of packs) {
    const docs = (await pack.getDocuments()).slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const d of docs) {
      const src = d.toObject();
      entries.push({
        value: `${pack.collection}::${d.id}`,
        label: d.name,
        img: thumbUrl(pickImg(src)),
        desc: docSummary(src),
        group: pack.title,
        status: tree ? await compendiumExportDeltaStatus(d, pack, tree, flatten, withAssets) : null
      });
    }
  }

  const content = entries.length
    ? buildCheckboxList(entries, exportOptionsHtml())
    : `<p>${t("GOS.Dialog.NothingSelected")}</p>`;

  await openSelectionDialog({
    title: t("GOS.Dialog.ExportTitle", { label }),
    content,
    confirmLabel: t("GOS.Dialog.ExportButton"),
    confirmIcon: "fa-solid fa-code-branch",
    onConfirm: async (root) => {
      const values = readSelected(root);
      if (!values.length) return ui.notifications.warn(t("GOS.Dialog.NothingSelected"));
      const selected = [];
      for (const v of values) {
        const sep = v.indexOf("::");
        if (sep < 0) continue;
        const pack = game.packs.get(v.slice(0, sep));
        const doc = pack?.get(v.slice(sep + 2));
        if (pack && doc) selected.push({ doc, pack });
      }
      const opts = readExportOptions(root);
      try {
        const { count, assets } = await exportCompendiumDocuments(selected, opts);
        ui.notifications.info(t("GOS.Notify.Exported", { count, assets }));
      } catch (err) {
        console.error(`${MODULE_ID} | Export`, err);
        ui.notifications.error(t("GOS.Notify.ExportError", { error: err.message }));
      }
    }
  });
}

/**
 * Determine preview image information for an import entry. The reference
 * (`rawImg`) stored in the JSON may have been rewritten to a shared folder
 * during export (`exportFlattenAssets`), so it may not point to a local path
 * until the asset has been imported. Include the blob SHA from the repository
 * tree (`assets/<reference>`) so a data URI can be created for the preview.
 */
function buildImportImgInfo(rawImg, tree) {
  const img = thumbUrl(rawImg);
  if (!rawImg) return { img };
  const clean = String(rawImg).split("?")[0].replace(/^\/+/, "");
  const assetPath = `assets/${clean}`;
  const info = { img, mime: guessMime(clean) };
  const sha = tree.get(assetPath);
  if (sha) info.ghSha = sha;
  return info;
}

/** Open the import dialog for a document type. */
async function openImportDialog(type) {
  const label = game.i18n.localize(`DOCUMENT.${type}`) || type;
  const items = await listImportEntries(type);

  if (!items.length) {
    return ui.notifications.warn(t("GOS.Dialog.NothingToImport"));
  }

  // Load preview data (name, image, description). Reuse the tree.
  const tree = await githubTree();
  const withAssets = syncAssets();
  const flatten = exportFlattenAssets();
  const loadProgress = makeProgress(t("GOS.Progress.Loading"));
  let loaded = 0;
  const entries = await Promise.all(
    items.map(async (it) => {
      const nice = it.base.replace(/__[A-Za-z0-9]+\.json$/i, "").replace(/\.json$/i, "");
      let data = null;
      let status = null;
      try {
        data = await readEntryData(it.value, tree);
      } catch (err) {
        console.warn(`${MODULE_ID} | Vorschau übersprungen: ${it.value}`, err);
      }
      try {
        status = await importDeltaStatus(type, it, tree, flatten, withAssets);
      } catch (err) {
        console.warn(`${MODULE_ID} | Sync-Status konnte nicht ermittelt werden: ${it.value}`, err);
      }
      loaded++;
      loadProgress.update(loaded / items.length);
      return {
        value: it.value,
        label: data?.name || nice || it.base,
        ...buildImportImgInfo(pickImg(data ?? {}), tree),
        desc: docSummary(data ?? {}),
        group: groupLabel(type, data?.type),
        status,
        compat: data ? checkImportCompatibility(type, data) : null
      };
    })
  );
  loadProgress.done();
  const compatByValue = new Map(entries.map((e) => [e.value, e.compat]));

  await openSelectionDialog({
    title: t("GOS.Dialog.ImportTitle", { label }),
    content: buildCheckboxList(entries, importOptionsHtml()),
    confirmLabel: t("GOS.Dialog.ImportButton"),
    confirmIcon: "fa-solid fa-download",
    onConfirm: async (root) => {
      const selected = readSelected(root);
      if (!selected.length) return ui.notifications.warn(t("GOS.Dialog.NothingSelected"));
      const opts = readImportOptions(root);
      const values = await filterImportSelection(selected, compatByValue);
      if (!values.length) return;
      let count = 0;
      const progress = makeProgress(t("GOS.Progress.Importing"));
      for (let i = 0; i < values.length; i++) {
        progress.update(i / values.length);
        try {
          await importValue(type, values[i], tree, opts);
          count++;
        } catch (err) {
          console.error(`${MODULE_ID} | Import`, err);
          ui.notifications.error(t("GOS.Notify.ImportError", { error: err.message }));
        }
      }
      progress.done(t("GOS.Progress.Done"));
      ui.notifications.info(t("GOS.Notify.Imported", { count }));
    }
  });
}

/**
 * Open the import dialog for all world compendiums. Show all entries found
 * under `compendia/` in the repository, grouped by compendium display name.
 * During import, resolve or create the destination pack for each entry using
 * its stored metadata.
 */
async function openCompendiumImportDialog() {
  const label = t("GOS.Dialog.CompendiaLabel");
  const tree = await githubTree();
  const items = listCompendiumImportEntriesFromTree(tree);

  if (!items.length) {
    return ui.notifications.warn(t("GOS.Dialog.NothingToImport"));
  }

  const withAssets = syncAssets();
  const flatten = exportFlattenAssets();
  const loadProgress = makeProgress(t("GOS.Progress.Loading"));
  let loaded = 0;
  const entries = await Promise.all(
    items.map(async (it) => {
      const nice = it.base.replace(/__[A-Za-z0-9]+\.json$/i, "").replace(/\.json$/i, "");
      let data = null;
      let status = null;
      try {
        data = await readEntryData(it.value, tree);
      } catch (err) {
        console.warn(`${MODULE_ID} | Vorschau übersprungen: ${it.value}`, err);
      }
      const meta = data ? foundry.utils.getProperty(data, `flags.${MODULE_ID}.compendium`) : null;
      try {
        status = meta ? await compendiumImportDeltaStatus(meta, data, tree, it.value, flatten, withAssets) : "new";
      } catch (err) {
        console.warn(`${MODULE_ID} | Sync-Status konnte nicht ermittelt werden: ${it.value}`, err);
      }
      loaded++;
      loadProgress.update(loaded / items.length);
      return {
        value: it.value,
        label: data?.name || nice || it.base,
        ...buildImportImgInfo(pickImg(data ?? {}), tree),
        desc: docSummary(data ?? {}),
        group: meta?.label || t("GOS.Dialog.GroupOther"),
        status,
        compat: data && meta?.type ? checkImportCompatibility(meta.type, data) : null
      };
    })
  );
  loadProgress.done();
  const compatByValue = new Map(entries.map((e) => [e.value, e.compat]));

  await openSelectionDialog({
    title: t("GOS.Dialog.ImportTitle", { label }),
    content: buildCheckboxList(entries, compendiumImportOptionsHtml()),
    confirmLabel: t("GOS.Dialog.ImportButton"),
    confirmIcon: "fa-solid fa-download",
    onConfirm: async (root) => {
      const selected = readSelected(root);
      if (!selected.length) return ui.notifications.warn(t("GOS.Dialog.NothingSelected"));
      const opts = readImportOptions(root);
      const values = await filterImportSelection(selected, compatByValue);
      if (!values.length) return;
      let count = 0;
      const packCache = new Map(); // "<type>::<collection-or-label>" -> resolved/created pack per run.
      const progress = makeProgress(t("GOS.Progress.Importing"));
      for (let i = 0; i < values.length; i++) {
        progress.update(i / values.length);
        try {
          await importCompendiumValue(values[i], tree, opts, packCache);
          count++;
        } catch (err) {
          console.error(`${MODULE_ID} | Import`, err);
          ui.notifications.error(t("GOS.Notify.ImportError", { error: err.message }));
        }
      }
      progress.done(t("GOS.Progress.Done"));
      ui.notifications.info(t("GOS.Notify.Imported", { count }));
    }
  });
}

/* -------------------------------------------------------------------------- */
/*  UI-Integration                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Read the document ID from the context-menu target element. Foundry v12 passes
 * a jQuery object (`li.data(...)`/`li.attr(...)`), while v13 passes a native
 * HTMLElement without jQuery methods (`ContextMenu` is created with
 * `{jQuery: false}` there; see document-directory.mjs). `.closest()` also handles
 * cases where the element itself, rather than a child, is the target; closest()
 * matches the element itself too.
 */
function contextMenuDocumentId(li) {
  const el = li?.jquery ? li[0] : li;
  const row = el?.closest?.("[data-document-id], [data-entry-id]") ?? el;
  return row?.dataset?.documentId ?? row?.dataset?.entryId ?? row?.getAttribute?.("data-document-id") ?? row?.getAttribute?.("data-entry-id");
}

/** Add the "Export to Git" context-menu entry for one document. */
function addContextMenuEntry(type, entryOptions) {
  const cfg = TYPE_CONFIG[type];
  entryOptions.push({
    name: t("GOS.Context.Export"),
    icon: '<i class="fa-solid fa-code-branch"></i>',
    condition: () => game.user.isGM,
    callback: async (li) => {
      const id = contextMenuDocumentId(li);
      const doc = cfg.collection().get(id);
      if (!doc) return;
      try {
        const { count, assets } = await exportDocuments([doc]);
        ui.notifications.info(t("GOS.Notify.Exported", { count, assets }));
      } catch (err) {
        console.error(`${MODULE_ID} | Export`, err);
        ui.notifications.error(t("GOS.Notify.ExportError", { error: err.message }));
      }
    }
  });
}

/**
 * Add export/import buttons to a directory header. Shared by world document
 * directories and the compendium sidebar.
 */
function injectActionButtons(html, onExport, onImport) {
  if (!game.user.isGM) return;
  const root = html instanceof jQuery ? html[0] : html;
  const header = root.querySelector(".directory-header");
  if (!header || header.querySelector(".gos-buttons")) return;

  const wrap = document.createElement("div");
  wrap.className = "gos-buttons action-buttons flexrow";
  wrap.style.gap = "4px";
  wrap.style.margin = "4px 0";
  wrap.innerHTML = `
    <button type="button" class="gos-export"><i class="fa-solid fa-code-branch"></i> ${t("GOS.Menu.Export")}</button>
    <button type="button" class="gos-import"><i class="fa-solid fa-download"></i> ${t("GOS.Menu.Import")}</button>`;

  const surface = (fn) => () => {
    try {
      Promise.resolve(fn()).catch((err) => {
        console.error(`${MODULE_ID} | Dialog`, err);
        ui.notifications.error(t("GOS.Notify.DialogError", { error: err.message }));
      });
    } catch (err) {
      console.error(`${MODULE_ID} | Dialog`, err);
      ui.notifications.error(t("GOS.Notify.DialogError", { error: err.message }));
    }
  };

  wrap.querySelector(".gos-export").addEventListener("click", surface(onExport));
  wrap.querySelector(".gos-import").addEventListener("click", surface(onImport));
  header.appendChild(wrap);
}

/** Add export/import buttons to a world-document directory sidebar header. */
function injectDirectoryButtons(type, html) {
  injectActionButtons(html, () => openExportDialog(type), () => openImportDialog(type));
}

/** Add export/import buttons to the world-compendium sidebar header. */
function injectCompendiumButtons(html) {
  injectActionButtons(html, () => openCompendiumExportDialog(), () => openCompendiumImportDialog());
}

/* -------------------------------------------------------------------------- */
/*  Setup                                                                      */
/* -------------------------------------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "syncAssets", {
    name: t("GOS.Settings.SyncAssets.Name"),
    hint: t("GOS.Settings.SyncAssets.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "githubRepo", {
    name: t("GOS.Settings.GithubRepo.Name"),
    hint: t("GOS.Settings.GithubRepo.Hint"),
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "githubBranch", {
    name: t("GOS.Settings.GithubBranch.Name"),
    hint: t("GOS.Settings.GithubBranch.Hint"),
    scope: "world",
    config: true,
    type: String,
    default: "main"
  });

  game.settings.register(MODULE_ID, "githubToken", {
    name: t("GOS.Settings.GithubToken.Name"),
    hint: t("GOS.Settings.GithubToken.Hint"),
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "overwriteImport", {
    name: t("GOS.Settings.OverwriteImport.Name"),
    hint: t("GOS.Settings.OverwriteImport.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "exportFlattenAssets", {
    name: t("GOS.Settings.ExportFlattenAssets.Name"),
    hint: t("GOS.Settings.ExportFlattenAssets.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "hideUnchanged", {
    name: t("GOS.Settings.HideUnchanged.Name"),
    hint: t("GOS.Settings.HideUnchanged.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "importAssetPrefix", {
    name: t("GOS.Settings.ImportAssetPrefix.Name"),
    hint: t("GOS.Settings.ImportAssetPrefix.Hint"),
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "importFolderMode", {
    name: t("GOS.Settings.ImportFolderMode.Name"),
    hint: t("GOS.Settings.ImportFolderMode.Hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      original: t("GOS.Settings.ImportFolderMode.Original"),
      none: t("GOS.Settings.ImportFolderMode.None"),
      custom: t("GOS.Settings.ImportFolderMode.Custom")
    },
    default: "original"
  });

  game.settings.register(MODULE_ID, "importFolderName", {
    name: t("GOS.Settings.ImportFolderName.Name"),
    hint: t("GOS.Settings.ImportFolderName.Hint"),
    scope: "world",
    config: true,
    type: String,
    default: ""
  });
});

// Register context-menu and render hooks during "setup", before the sidebar
// directories are rendered for the first time. Registering them only in
// "ready" would miss directories that have already rendered (e.g. the
// Actors tab, which is open by default).
Hooks.once("setup", () => {
  for (const [type, cfg] of Object.entries(TYPE_CONFIG)) {
    // Register both context-menu hook names (v12 and v13; see TYPE_CONFIG).
    // Only one hook fires per Foundry version, so this cannot add duplicate entries.
    Hooks.on(cfg.contextHook, (html, entryOptions) => addContextMenuEntry(type, entryOptions));
    Hooks.on(cfg.contextHookV13, (html, entryOptions) => addContextMenuEntry(type, entryOptions));
    Hooks.on(cfg.renderHook, (app, html) => injectDirectoryButtons(type, html));
  }
  // The compendium sidebar needs its own render hook because compendiums are
  // not part of TYPE_CONFIG: a compendium pack is a container for many
  // documents, not a single document.
  Hooks.on("renderCompendiumDirectory", (app, html) => injectCompendiumButtons(html));
});

Hooks.once("ready", () => {
  // Patch directories that have already rendered. Sidebar tabs render once
  // before this "ready" hook, so their render hooks will not fire again.
  // Without this, buttons would be missing from already-open tabs.
  for (const [type, cfg] of Object.entries(TYPE_CONFIG)) {
    const app = ui[cfg.uiKey];
    if (app?.element) injectDirectoryButtons(type, app.element);
  }
  if (ui.compendium?.element) injectCompendiumButtons(ui.compendium.element);

  // Public API, e.g. for custom macros.
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      exportDocument,
      exportDocuments,
      openExportDialog,
      openImportDialog,
      listImportEntries,
      importValue,
      openCompendiumExportDialog,
      openCompendiumImportDialog,
      exportCompendiumDocuments,
      importCompendiumValue
    };
  }

  console.log(`${MODULE_ID} | ready`);
});
