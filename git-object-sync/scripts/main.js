/**
 * Git Object Sync
 * -----------------------------------------------------------------------------
 * Exportiert einzelne Foundry-Dokumente (Actors, Items, Szenen, Journal) als
 * eigene JSON-Dateien direkt in ein GitHub-Repository und importiert sie von
 * dort wieder – inklusive referenzierter Bilder/Maps als Assets.
 *
 * - Rechtsklick auf ein Objekt in der Seitenleiste -> "Export nach Git"
 * - Button in der Seitenleiste -> Checkbox-Dialog für Mehrfach-Export/-Import
 */

const MODULE_ID = "git-object-sync";

/** Konfiguration je Dokumenttyp. */
const TYPE_CONFIG = {
  Actor: { folder: "actors", collection: () => game.actors, uiKey: "actors", renderHook: "renderActorDirectory", contextHook: "getActorDirectoryEntryContext" },
  Item: { folder: "items", collection: () => game.items, uiKey: "items", renderHook: "renderItemDirectory", contextHook: "getItemDirectoryEntryContext" },
  Scene: { folder: "scenes", collection: () => game.scenes, uiKey: "scenes", renderHook: "renderSceneDirectory", contextHook: "getSceneDirectoryEntryContext" },
  JournalEntry: { folder: "journal", collection: () => game.journal, uiKey: "journal", renderHook: "renderJournalDirectory", contextHook: "getJournalDirectoryEntryContext" }
};

/* -------------------------------------------------------------------------- */
/*  Hilfsfunktionen                                                            */
/* -------------------------------------------------------------------------- */

function t(key, data = {}) {
  return game.i18n.format(key, data);
}

/** Sollen referenzierte Assets (Bilder, Maps, Audio) mitsynchronisiert werden? */
function syncAssets() {
  return game.settings.get(MODULE_ID, "syncAssets");
}

/**
 * Fortschrittsanzeige über die eingebaute Foundry-Ladeleiste (oben mittig).
 * Liefert ein Objekt mit update(fraction 0..1, message) und done(message).
 * Fällt still zurück, falls die Ladeleiste nicht verfügbar ist.
 */
function makeProgress(label) {
  const show = (pct, msg) => {
    try {
      SceneNavigation.displayProgressBar({
        label: msg ?? label,
        pct: Math.round(Math.max(0, Math.min(100, pct)))
      });
    } catch (err) {
      /* Ladeleiste nicht verfügbar -> ignorieren. */
    }
  };
  show(0, label);
  return {
    update: (fraction, msg) => show(fraction * 100, msg),
    done: (msg) => show(100, msg)
  };
}

/** Dateinamen sicher machen (keine Sonderzeichen, keine Leerzeichen). */
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

/** Verzeichnis (rekursiv) im Data-Bereich anlegen, falls nicht vorhanden. */
async function ensureDir(path) {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      await FilePicker.createDirectory("data", current);
    } catch (err) {
      // Existiert bereits -> ignorieren. Andere Fehler weiterreichen.
      if (!/exist/i.test(err?.message ?? "")) throw err;
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Assets (Bilder, Maps, Audio) einsammeln und übertragen                     */
/* -------------------------------------------------------------------------- */

// Medien-Endungen, die als Asset gelten.
const ASSET_EXT = /\.(webp|png|jpe?g|gif|bmp|svg|webm|mp4|m4v|ogv|ogg|mp3|wav|m4a|flac|opus|pdf)(\?.*)?$/i;
// Pfade, die auf jeder Installation ohnehin vorhanden sind -> nicht mitsichern.
const ASSET_SKIP = /^(https?:|data:|icons\/|ui\/|cards\/|sounds\/|fonts\/|systems\/|modules\/)/i;

/**
 * Durchsucht ein Dokument-Objekt rekursiv nach lokalen Asset-Pfaden
 * (z. B. Karten-Hintergründe, Token-Bilder, Portraits). Liefert eindeutige,
 * relative Data-Pfade zurück. Externe URLs und Core-/System-Assets werden
 * ausgelassen.
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

/** URL, unter der eine Data-Datei abgerufen werden kann (inkl. Route-Präfix). */
function dataUrl(path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return foundry.utils.getRoute(encoded);
}

/** MIME-Typ grob aus der Dateiendung ableiten (für data:-URI-Vorschauen). */
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
 * Git-Blob-SHA1 eines Texts berechnen (identisch zu "git hash-object" bzw. der
 * SHA, die GitHubs Baum-API für eine Datei liefert). Damit lässt sich lokal
 * prüfen, ob ein Dokument gegenüber dem Repo-Stand unverändert ist, ohne den
 * Datei-Inhalt vom Server laden zu müssen (siehe Delta-Erkennung weiter unten).
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
    cache: "no-store", // sonst liefert der Browser beim erneuten Lesen des Branch-Tips einen veralteten (gecachten) Stand
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

/** Mehrere Dateien in einem einzigen Commit hochladen (Git-Data-API). */
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
    // Repo/Branch noch leer. Ein komplett leeres Repo (kein einziger Commit)
    // lehnt die Git-Data-API mit 409 ab -> ersten Commit per Contents-API anlegen.
    try {
      await ghApi(`/repos/${repo}/contents/.gitkeep`, {
        method: "PUT",
        body: {
          message: "Git Object Sync: Repository initialisiert",
          content: "",
          branch
        }
      });
      const ref = await ghApi(`/repos/${repo}/git/ref/heads/${branch}`);
      baseSha = ref.object.sha;
      const commit = await ghApi(`/repos/${repo}/git/commits/${baseSha}`);
      baseTree = commit.tree.sha;
    } catch (err2) {
      // Fallback: ohne Basis fortfahren (initialer Commit via Git-Data-API).
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

  // Aktuellen Branch-Stand (Tip-Commit + zugehörigen Baum) frisch lesen.
  const readBase = async () => {
    const ref = await ghApi(`/repos/${repo}/git/ref/heads/${branch}`);
    const sha = ref.object.sha;
    const commit = await ghApi(`/repos/${repo}/git/commits/${sha}`);
    return { sha, tree: commit.tree.sha };
  };

  // Commit anlegen und Ref setzen. Wenn der Branch zwischenzeitlich fortgeschrieben
  // wurde ("Update is not a fast forward", 422), holen wir den neuen Stand und
  // setzen unseren Commit darauf neu auf (Rebase auf den aktuellen Tip). Zwischen
  // den Versuchen warten wir kurz (Backoff), damit GitHub den neuen Ref-Stand
  // zuverlässig ausliefert und ein evtl. gleichzeitiger Server-Sync durchläuft.
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
      // Branch hat sich verschoben -> kurz warten, aktuellen Stand holen, erneut versuchen.
      await sleep(300 * attempt); // 300ms, 600ms, 900ms, ...
      const base = await readBase();
      baseSha = base.sha;
      baseTree = base.tree;
    }
  }
  // Alle Versuche erschöpft: verständlichen Konflikt-Fehler werfen.
  const detail = String(lastErr?.message ?? "").slice(0, 160);
  throw new Error(t("GOS.Notify.PushConflict", { detail }));
}

/** Kompletten Datei-Baum des Branches als Map path -> blob-sha holen. */
async function githubTree() {
  const { repo, branch } = ghConfig();
  const map = new Map();
  try {
    const data = await ghApi(`/repos/${repo}/git/trees/${branch}?recursive=1`);
    for (const e of data.tree || []) if (e.type === "blob") map.set(e.path, e.sha);
  } catch (err) {
    // Branch existiert noch nicht -> leerer Baum.
  }
  return map;
}

async function githubReadBlob(sha) {
  const { repo } = ghConfig();
  const blob = await ghApi(`/repos/${repo}/git/blobs/${sha}`);
  return base64ToBytes(blob.content);
}

/* -------------------------------------------------------------------------- */
/*  Export (beide Modi)                                                        */
/* -------------------------------------------------------------------------- */

/** Ob Assets beim Export in Sammelordner (assets/<Typ>/…) abgelegt werden. */
function exportFlattenAssets() {
  return game.settings.get(MODULE_ID, "exportFlattenAssets") === true;
}

/** Ordner-Pfad eines Dokuments in der Foundry-Oberfläche (Wurzel -> Blatt). */
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
 * Schreibt die Asset-Referenzen in `data` auf ihren repo-relativen Zielpfad um
 * und liefert die Zuordnung `dest -> src` für die Speicherung. Mutiert `data`.
 *
 * - `flatten` = true  -> alle Assets nach `<Typ>/<Dateiname>` (Sammelordner).
 * - `flatten` = false -> Originalpfade beibehalten (Referenzen unverändert).
 */
function remapExportAssets(data, flatten, docType) {
  const map = new Map(); // dest (Repo-Pfad) -> src (Original-Pfad zum Abrufen)
  const remap = (s) => {
    const trimmed = String(s).trim();
    if (trimmed && ASSET_EXT.test(trimmed) && !ASSET_SKIP.test(trimmed)) {
      const clean = trimmed.split("?")[0].replace(/^\/+/, "");
      const dest = flatten ? `${docType}/${basename(clean)}` : clean;
      if (!map.has(dest)) map.set(dest, clean);
      return flatten ? dest : null; // ohne Flatten die Referenz unverändert lassen
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
 * Baut die Export-Nutzdaten (Repo-Pfad + JSON-Text + Asset-Zuordnung) für ein
 * einzelnes Dokument – ohne etwas hochzuladen. Wird sowohl vom eigentlichen
 * Export als auch von der Delta-Erkennung (Sync-Status im Dialog) genutzt,
 * damit beide exakt denselben Inhalt berechnen.
 */
function buildExportJson(doc, flatten, withAssets) {
  const cfg = TYPE_CONFIG[doc.documentName];
  const data = doc.toObject(); // vollständige Quelldaten inkl. _id
  // Ordner-Pfad der Oberfläche mitspeichern, damit der Import ihn wiederherstellen kann.
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.folderPath`, folderPathOf(doc));
  const assetMap = withAssets ? remapExportAssets(data, flatten, doc.documentName) : new Map();
  const json = JSON.stringify(data, null, 2);
  const fileName = `${sanitize(doc.name)}__${doc.id}.json`;
  return { folder: cfg.folder, fileName, json, assetMap };
}

/** Ein einzelnes Dokument exportieren (Komfort-Wrapper). */
async function exportDocument(doc, opts = {}) {
  return exportDocuments([doc], opts);
}

/**
 * Mehrere Dokumente exportieren. Sammelt JSON + referenzierte Assets und
 * pusht sie als einzelnen Commit direkt ins konfigurierte GitHub-Repository.
 * Gibt { count, assets } zurück.
 *
 * `opts.flattenAssets` überschreibt die globale Einstellung für diesen Export.
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
      `Git Object Sync: ${jsonWrites.length} Objekt(e), ${assets} Asset(s)`,
      (done, total) =>
        progress.update(0.5 + (done / total) * 0.5, t("GOS.Progress.Uploading", { done, total }))
    );
    progress.done(t("GOS.Progress.Done"));
    return { count: jsonWrites.length, assets };
  } finally {
    // Ladeleiste immer ausblenden – auch wenn githubPushFiles abbricht.
    progress.done("");
  }
}

/* -------------------------------------------------------------------------- */
/*  Delta-Erkennung (Sync-Status für Export-/Import-Dialog)                    */
/* -------------------------------------------------------------------------- */

/**
 * Sync-Status eines lokalen Dokuments gegenüber dem GitHub-Repo ermitteln:
 * "new" (noch nie exportiert), "changed" (Inhalt weicht vom Repo-Stand ab)
 * oder "unchanged" (identisch zum letzten Export). Basiert auf einem
 * Vergleich der Git-Blob-SHA, damit kein zusätzlicher Datei-Download nötig ist.
 * Nutzt dieselben Export-Einstellungen (Assets/Sammelordner) wie ein
 * tatsächlicher Export – bei abweichenden Einstellungen kann der Status daher
 * ungenau sein.
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
 * Sync-Status eines Import-Eintrags gegenüber dem lokalen Dokument ermitteln:
 * "new" (noch kein lokales Dokument mit dieser ID), "changed" (lokales
 * Dokument existiert, Inhalt weicht vom Repo-Eintrag ab) oder "unchanged"
 * (ein erneuter Export des lokalen Dokuments würde exakt diese Datei ergeben –
 * es gibt also nichts zu importieren).
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

/** Verfügbare Import-Einträge eines Typs auflisten: [{ value, base }]. */
async function listImportEntries(type) {
  const cfg = TYPE_CONFIG[type];
  const tree = await githubTree();
  const prefix = `${cfg.folder}/`;
  return [...tree.keys()]
    .filter((p) => p.startsWith(prefix) && p.toLowerCase().endsWith(".json"))
    .map((p) => ({ value: p, base: p.slice(prefix.length) }));
}

/** Rohdaten eines Import-Eintrags laden (für Vorschau/Import). */
async function readEntryData(value, tree = null) {
  const sha = (tree ?? (await githubTree())).get(value);
  if (!sha) return null;
  return JSON.parse(new TextDecoder().decode(await githubReadBlob(sha)));
}

/** Konfigurierter Ziel-Unterordner für importierte Assets (leer = Originalpfad). */
function importAssetPrefix() {
  return (game.settings.get(MODULE_ID, "importAssetPrefix") || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

/** Zielpfad eines Assets beim Import (mit optionalem Präfix). */
function importAssetTarget(a, prefix) {
  return prefix ? `${prefix}/${a}` : a;
}

/** Globaler Import-Ordner-Modus: original | none | custom. */
function importFolderMode() {
  return game.settings.get(MODULE_ID, "importFolderMode") || "original";
}

/** Name des festen Import-Ordners (nur im Modus "custom"). */
function importFolderName() {
  return (game.settings.get(MODULE_ID, "importFolderName") || "").trim();
}

/** Ordner-Hierarchie (nach Namen) in der Seitenleiste anlegen; Blatt-ID zurückgeben. */
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
 * Ziel-Ordner (Seitenleiste) für ein importiertes Dokument bestimmen und in
 * `data.folder` setzen. Entfernt so auch die weltfremde Original-Ordner-ID. Modi:
 *  - original: gleiche Ordner-Struktur wie beim Export (per Namen neu anlegen)
 *  - none:     kein Ordner (Wurzel)
 *  - custom:   fester Ordner mit konfiguriertem Namen
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
 * Schreibt die Asset-Pfade im Datenobjekt so um, dass sie auf den Import-Zielort
 * (mit Präfix) zeigen. Mutiert `data` direkt. Ohne Präfix passiert nichts.
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

/** Referenzierte Assets aus GitHub an ihren Zielort zurückschreiben. */
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

/** Aus geladenen Daten ein Dokument anlegen bzw. aktualisieren. */
async function importDataDoc(type, data, folderOpts = {}) {
  const cls = getDocumentClass(type);
  const collection = TYPE_CONFIG[type].collection();
  const existing = data._id ? collection.get(data._id) : null;
  const overwrite = game.settings.get(MODULE_ID, "overwriteImport");

  // Ziel-Ordner in der Seitenleiste bestimmen (und weltfremde Ordner-ID ersetzen).
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
 * Einen Import-Eintrag laden (inkl. Assets) und als Dokument importieren.
 * `tree` wird im GitHub-Modus einmalig übergeben, um Mehrfach-Abfragen zu sparen.
 * `opts` überschreibt die globalen Einstellungen für diesen Import
 * ({ assetPrefix, folderMode, folderName }).
 */
async function importValue(type, value, tree = null, opts = {}) {
  const withAssets = syncAssets();
  const prefix = opts.assetPrefix ?? importAssetPrefix();
  const sha = (tree ?? (await githubTree())).get(value);
  if (!sha) throw new Error(`Nicht im Repo: ${value}`);
  const data = JSON.parse(new TextDecoder().decode(await githubReadBlob(sha)));
  if (withAssets) await restoreAssetsGithub(data, tree ?? (await githubTree()), prefix);
  // Nach dem Zurückschreiben die Referenzen auf den Zielort umbiegen.
  rewriteAssetPaths(data, prefix);
  return importDataDoc(type, data, { folderMode: opts.folderMode, folderName: opts.folderName });
}

/* -------------------------------------------------------------------------- */
/*  Dialoge                                                                    */
/* -------------------------------------------------------------------------- */

/** HTML-Sonderzeichen maskieren. */
function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

/** Anzeige-Label für die Gruppierung nach (Sub-)Typ eines Dokuments. */
function groupLabel(docType, sub) {
  if (!sub || sub === "base") return t("GOS.Dialog.GroupOther");
  const key = CONFIG?.[docType]?.typeLabels?.[sub];
  if (key) {
    const loc = game.i18n.localize(key);
    if (loc && loc !== key) return loc;
  }
  return String(sub).charAt(0).toUpperCase() + String(sub).slice(1);
}

/** Checkbox „Nur Deltas anzeigen" – gemeinsam für Export- und Import-Dialog. */
function deltaFilterOptionHtml() {
  const checked = game.settings.get(MODULE_ID, "hideUnchanged");
  return `
    <label class="gos-opt">
      <input type="checkbox" class="gos-opt-deltafilter" ${checked ? "checked" : ""}/>
      <span>${t("GOS.Dialog.OptHideUnchanged")}</span>
    </label>`;
}

/** Options-Block für den Export-Dialog (Flatten-Checkbox + Delta-Filter). */
function exportOptionsHtml() {
  const flatten = exportFlattenAssets();
  return `
    <label class="gos-opt">
      <input type="checkbox" class="gos-opt-flatten" ${flatten ? "checked" : ""}/>
      <span>${t("GOS.Dialog.OptFlatten")}</span>
    </label>
    ${deltaFilterOptionHtml()}`;
}

/** Ausgewählte Export-Optionen aus dem Dialog lesen. */
function readExportOptions(root) {
  const cb = root.querySelector(".gos-opt-flatten");
  return { flattenAssets: cb ? cb.checked : undefined };
}

/** Options-Block für den Import-Dialog (Asset-Zielordner + Ordner-Modus + Delta-Filter). */
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

/** Ausgewählte Import-Optionen aus dem Dialog lesen. */
function readImportOptions(root) {
  return {
    assetPrefix: (root.querySelector(".gos-opt-assetprefix")?.value ?? "")
      .trim()
      .replace(/^\/+|\/+$/g, ""),
    folderMode: root.querySelector(".gos-opt-foldermode")?.value || undefined,
    folderName: (root.querySelector(".gos-opt-foldername")?.value ?? "").trim()
  };
}

function buildCheckboxList(entries, optionsHtml = "") {
  // entries: [{ value, label, img, desc, group, ghSha, mime }]
  const esc = escHtml;

  const statusLabels = {
    new: t("GOS.Dialog.StatusNew"),
    changed: t("GOS.Dialog.StatusChanged"),
    unchanged: t("GOS.Dialog.StatusUnchanged")
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
    return `
      <label class="gos-row" data-search="${search}" data-status="${esc(status || "")}">
        <input type="checkbox" name="gos" value="${esc(e.value)}"/>
        ${thumb}
        <span class="gos-text">
          <span class="gos-name">${esc(e.label)} ${badge}</span>
          ${desc}
        </span>
      </label>`;
  };

  // Einträge nach Gruppe bündeln (Reihenfolge alphabetisch, "Sonstige" ans Ende).
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

  // Das komplette Aussehen (nicht nur Layout, sondern auch Farben/Rahmen) wird
  // direkt mit dem Dialog eingebettet statt aus der externen CSS-Datei bezogen.
  // Grund: Externe Stylesheets waren in der Praxis nicht zuverlässig aktiv
  // (Cache/Ladereihenfolge), wodurch der Dialog völlig ungestylt aussah. Für
  // Farben wird zuerst ein einfacher rgba()-Wert gesetzt und danach – als
  // Verbesserung, falls unterstützt – per color-mix() aus "currentColor"
  // überschrieben, damit sich der Dialog an das aktive Theme anpasst, ohne
  // dass ein fehlendes color-mix()-Support die Optik komplett unsichtbar macht.
  const style = `
    <style>
      /* Ein einziger durchgehender Scrollbereich für das gesamte Fensterinhalt
         (Suche, Toolbar UND Objektliste scrollen gemeinsam als eine Einheit),
         statt nur die Liste intern scrollen zu lassen. */
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
      /* Trennlinie zwischen Options-Zeilen und "Alle auswählen" (nur bei vorhandenen Optionen). */
      .gos-dialog .gos-toolbar .gos-opt ~ .gos-selectall {
        padding-top: 8px; margin-top: 2px;
        border-top: 1px solid rgba(127, 127, 127, 0.25);
        border-top: 1px solid color-mix(in srgb, currentColor 16%, transparent);
      }

      .gos-dialog input[type="checkbox"] { accent-color: currentColor; }

      /* Sektionstrenner zwischen Toolbar und Objektliste. */
      .gos-dialog .gos-divider {
        height: 2px; margin: 0 2px; flex: 0 0 auto; border-radius: 1px;
        background: rgba(127, 127, 127, 0.4);
        background: color-mix(in srgb, currentColor 30%, transparent);
      }

      .gos-dialog .gos-scroll { flex: 0 0 auto; padding-right: 2px; }
      .gos-dialog .gos-list { display: flex; flex-direction: column; gap: 4px; }
      .gos-dialog .gos-group { margin: 0 0 4px; overflow: hidden; }
      .gos-dialog .gos-group .gos-list { padding: 5px 6px 7px; }

      /* Gruppen-Kopf: deutlich als Überschrift erkennbar (größer, fett,       */
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

      /* Sync-Status-Badges (neu/geändert/unverändert) neben dem Objektnamen. */
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

      .gos-dialog .gos-hidden { display: none !important; }
      .gos-dialog .gos-empty { padding: 12px; text-align: center; font-style: italic; opacity: 0.6; }

      /* DialogV2 fügt zwischen ".window-content" und unserem Inhalt automatisch
         ein "form.dialog-form.standard-form" und ein "div.dialog-content.standard-form"
         ein. Beide sind standardmäßig Flex-Spalten mit "min-height: auto" und
         "overflow: visible" - das unterbricht die Flex-Kette, wodurch weder die
         Fenstergröße begrenzt noch unser innerer Scrollbereich (".gos-scroll")
         wirksam wird. Daher müssen wir die gesamte Kette explizit durchreichen. */
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

      /* Foundrys eingebautes Resize-Handle-Icon (ein winziges 11x11px
         Hintergrundbild) ist je nach Theme/System kaum zu erkennen. Wir
         zeichnen daher zusätzlich einen eigenen, garantiert sichtbaren
         Grip-Indikator (diagonale Streifen in der Ecke) rein per CSS,
         unabhängig vom Bild-Asset. */
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

/** Bild-URL für die Vorschau (externe URLs/Data-URLs unverändert, sonst geroutet). */
function thumbUrl(img) {
  if (!img) return null;
  if (/^(https?:|data:)/i.test(img)) return img;
  try {
    return dataUrl(String(img).replace(/^\/+/, ""));
  } catch {
    return img;
  }
}

/** Erstes sinnvolles Vorschaubild aus einem Dokument/Datenobjekt wählen. */
function pickImg(o) {
  return (
    o?.img ||
    o?.thumb ||
    o?.background?.src ||
    o?.prototypeToken?.texture?.src ||
    null
  );
}

/** Kurze, HTML-freie Beschreibung aus verbreiteten System-Feldern ableiten. */
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

  // Kaputte/fehlende Vorschaubilder ersetzen. Beim Import kann die im JSON
  // gespeicherte Bild-Referenz (bei "Sammelordner"-Export) auf keinen lokal
  // erreichbaren Pfad mehr zeigen – dann erst den Blob aus dem GitHub-Baum als
  // data:-URI probieren, bevor endgültig ein Platzhalter-Icon angezeigt wird.
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
      // Nur aktuell sichtbare (nicht weggefilterte) Einträge umschalten.
      root.querySelectorAll('input[name="gos"]').forEach((cb) => {
        if (!isHidden(cb)) cb.checked = all.checked;
      });
    });
  }

  // Kombinierter Filter: Live-Suche (Name/Beschreibung) UND Delta-Filter
  // (unveränderte Objekte ausblenden), Zeilen die durch einen der beiden
  // Filter nicht passen werden ausgeblendet; leere Gruppen werden mit
  // ausgeblendet, ebenso erscheint bei "keine Treffer" ein Hinweistext.
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
        if (q && groupHasMatch) g.open = true; // bei Suche passende Gruppen aufklappen
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
 * Auswahl-Dialog anzeigen. Nutzt DialogV2, wenn verfügbar, und fällt sonst
 * (oder bei einem Fehler) auf den klassischen Dialog zurück. `onConfirm`
 * erhält das Wurzel-HTMLElement des Dialoginhalts.
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

  // Fallback: klassischer Dialog (V1). Dieser ist seit v12 als deprecated
  // markiert und laut Foundry-Roadmap für die Entfernung in v14 vorgesehen.
  // Wir greifen daher zuerst auf den bereits ins "appv1"-Namespace verschobenen
  // Verweis zurück und erst danach auf den globalen Bezeichner - so stürzt der
  // Code nicht mit einem harten ReferenceError ab, sobald "Dialog" irgendwann
  // entfernt wird, sondern zeigt stattdessen eine verständliche Fehlermeldung.
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

/** Export-Dialog für einen Dokumenttyp öffnen. */
async function openExportDialog(type) {
  const cfg = TYPE_CONFIG[type];
  const label = game.i18n.localize(`DOCUMENT.${type}`) || type;
  const docs = cfg.collection().contents.sort((a, b) => a.name.localeCompare(b.name));

  // Repo-Baum laden, um den Sync-Status (neu/geändert/unverändert) je Objekt
  // zu bestimmen. Schlägt das fehl (z. B. ungültiges Token), wird ohne Status
  // fortgefahren – der Dialog bleibt trotzdem nutzbar, nur ohne Badges/Filter.
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
 * Vorschaubild-Infos für einen Import-Eintrag ermitteln. Die im JSON gespeicherte
 * Referenz (`rawImg`) kann beim Export in einen Sammelordner umgeschrieben worden
 * sein (`exportFlattenAssets`) und zeigt dann auf keinen lokal existierenden Pfad
 * mehr – bis das Asset tatsächlich importiert wurde. Für die Vorschau wird daher
 * zusätzlich die SHA des Blobs im Repo-Baum (`assets/<referenz>`) mitgegeben, aus
 * der bei Bedarf eine data:-URI gebaut wird.
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

/** Import-Dialog für einen Dokumenttyp öffnen. */
async function openImportDialog(type) {
  const label = game.i18n.localize(`DOCUMENT.${type}`) || type;
  const items = await listImportEntries(type);

  if (!items.length) {
    return ui.notifications.warn(t("GOS.Dialog.NothingToImport"));
  }

  // Vorschaudaten (Name, Bild, Beschreibung) laden. tree wird wiederverwendet.
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
        status
      };
    })
  );
  loadProgress.done();

  await openSelectionDialog({
    title: t("GOS.Dialog.ImportTitle", { label }),
    content: buildCheckboxList(entries, importOptionsHtml()),
    confirmLabel: t("GOS.Dialog.ImportButton"),
    confirmIcon: "fa-solid fa-download",
    onConfirm: async (root) => {
      const values = readSelected(root);
      if (!values.length) return ui.notifications.warn(t("GOS.Dialog.NothingSelected"));
      const opts = readImportOptions(root);
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

/* -------------------------------------------------------------------------- */
/*  UI-Integration                                                             */
/* -------------------------------------------------------------------------- */

/** Kontextmenü-Eintrag "Export nach Git" für ein einzelnes Objekt. */
function addContextMenuEntry(type, entryOptions) {
  const cfg = TYPE_CONFIG[type];
  entryOptions.push({
    name: t("GOS.Context.Export"),
    icon: '<i class="fa-solid fa-code-branch"></i>',
    condition: () => game.user.isGM,
    callback: async (li) => {
      const id = li.data("documentId") ?? li.data("entryId") ?? li.attr("data-document-id") ?? li.attr("data-entry-id");
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

/** Export/Import-Buttons oben in der jeweiligen Verzeichnis-Seitenleiste. */
function injectDirectoryButtons(type, html) {
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

  wrap.querySelector(".gos-export").addEventListener("click", surface(() => openExportDialog(type)));
  wrap.querySelector(".gos-import").addEventListener("click", surface(() => openImportDialog(type)));
  header.appendChild(wrap);
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

// Kontextmenü- und Render-Hooks bereits im "setup" registrieren – also bevor
// die Seitenleisten-Verzeichnisse zum ersten Mal gerendert werden. Würden sie
// erst im "ready" registriert, fehlte der Kontextmenü-Eintrag bei Verzeichnissen,
// die schon gerendert wurden (z. B. der standardmäßig offene Actors-Tab).
Hooks.once("setup", () => {
  for (const [type, cfg] of Object.entries(TYPE_CONFIG)) {
    Hooks.on(cfg.contextHook, (html, entryOptions) => addContextMenuEntry(type, entryOptions));
    Hooks.on(cfg.renderHook, (app, html) => injectDirectoryButtons(type, html));
  }
});

Hooks.once("ready", () => {
  // Bereits gerenderte Verzeichnisse nachrüsten: Die Seitenleisten-Tabs werden
  // vor diesem "ready"-Hook einmalig dargestellt, wodurch der renderHook für sie
  // nicht mehr feuert. Ohne dies fehlten die Buttons auf den offenen Tabs.
  for (const [type, cfg] of Object.entries(TYPE_CONFIG)) {
    const app = ui[cfg.uiKey];
    if (app?.element) injectDirectoryButtons(type, app.element);
  }

  // Öffentliche API, z. B. für eigene Makros.
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      exportDocument,
      exportDocuments,
      openExportDialog,
      openImportDialog,
      listImportEntries,
      importValue
    };
  }

  console.log(`${MODULE_ID} | ready`);
});
