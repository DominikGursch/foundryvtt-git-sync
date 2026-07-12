/**
 * Git Object Sync
 * -----------------------------------------------------------------------------
 * Exportiert einzelne Foundry-Dokumente (Actors, Items, Szenen, Journal) als
 * eigene JSON-Dateien in einen Ordner im Data-Verzeichnis und importiert sie
 * von dort wieder. Der Ordner wird serverseitig als Git-Repository versioniert
 * (siehe /server im mitgelieferten Paket).
 *
 * - Rechtsklick auf ein Objekt in der Seitenleiste -> "Export nach Git"
 * - Button in der Seitenleiste -> Checkbox-Dialog für Mehrfach-Export/-Import
 */

const MODULE_ID = "git-object-sync";

/** Konfiguration je Dokumenttyp. */
const TYPE_CONFIG = {
  Actor: { folder: "actors", collection: () => game.actors, renderHook: "renderActorDirectory", contextHook: "getActorDirectoryEntryContext" },
  Item: { folder: "items", collection: () => game.items, renderHook: "renderItemDirectory", contextHook: "getItemDirectoryEntryContext" },
  Scene: { folder: "scenes", collection: () => game.scenes, renderHook: "renderSceneDirectory", contextHook: "getSceneDirectoryEntryContext" },
  JournalEntry: { folder: "journal", collection: () => game.journal, renderHook: "renderJournalDirectory", contextHook: "getJournalDirectoryEntryContext" }
};

/* -------------------------------------------------------------------------- */
/*  Hilfsfunktionen                                                            */
/* -------------------------------------------------------------------------- */

function t(key, data = {}) {
  return game.i18n.format(key, data);
}

function exportRoot() {
  return game.settings.get(MODULE_ID, "exportPath") || "git-export";
}

/** Aktueller Sync-Modus: "server" (Git-Ordner) oder "github" (direkt via API). */
function syncMode() {
  return game.settings.get(MODULE_ID, "syncMode") || "server";
}

/** Sollen referenzierte Assets (Bilder, Maps, Audio) mitsynchronisiert werden? */
function syncAssets() {
  return game.settings.get(MODULE_ID, "syncAssets");
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

async function uploadText(dir, name, text) {
  const file = new File([text], name, { type: "application/json" });
  await FilePicker.upload("data", dir, file, {}, { notify: false });
}

async function uploadBytes(dir, name, bytes) {
  const file = new File([bytes], name);
  await FilePicker.upload("data", dir, file, {}, { notify: false });
}

/* -------------------------------------------------------------------------- */
/*  GitHub-API (Variante "UI-only")                                            */
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
async function githubPushFiles(files, message) {
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
    // Branch/Repo noch leer -> ohne Basis fortfahren (initialer Commit).
    baseSha = null;
    baseTree = null;
  }

  const tree = [];
  for (const f of files) {
    const blobBody = f.bytes
      ? { content: bytesToBase64(f.bytes), encoding: "base64" }
      : { content: f.text, encoding: "utf-8" };
    const blob = await ghApi(`/repos/${repo}/git/blobs`, { method: "POST", body: blobBody });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const newTree = await ghApi(`/repos/${repo}/git/trees`, {
    method: "POST",
    body: { ...(baseTree ? { base_tree: baseTree } : {}), tree }
  });
  const commit = await ghApi(`/repos/${repo}/git/commits`, {
    method: "POST",
    body: { message, tree: newTree.sha, parents: baseSha ? [baseSha] : [] }
  });

  if (baseSha) {
    await ghApi(`/repos/${repo}/git/refs/heads/${branch}`, { method: "PATCH", body: { sha: commit.sha } });
  } else {
    await ghApi(`/repos/${repo}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: commit.sha } });
  }
  return commit.sha;
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

/** Ein einzelnes Dokument exportieren (Komfort-Wrapper). */
async function exportDocument(doc) {
  return exportDocuments([doc]);
}

/**
 * Mehrere Dokumente exportieren. Sammelt JSON + referenzierte Assets und
 * überträgt sie je nach Modus in den Git-Ordner (server) oder direkt zu
 * GitHub (github). Gibt { count, assets } zurück.
 */
async function exportDocuments(docs) {
  const withAssets = syncAssets();
  const jsonWrites = [];
  const assetPaths = new Set();

  for (const doc of docs) {
    const cfg = TYPE_CONFIG[doc.documentName];
    if (!cfg) continue;
    const data = doc.toObject(); // vollständige Quelldaten inkl. _id
    const json = JSON.stringify(data, null, 2);
    const fileName = `${sanitize(doc.name)}__${doc.id}.json`;
    jsonWrites.push({ folder: cfg.folder, fileName, json });
    if (withAssets) for (const a of collectAssetPaths(data)) assetPaths.add(a);
  }

  if (syncMode() === "github") {
    const files = [];
    for (const w of jsonWrites) files.push({ path: `${w.folder}/${w.fileName}`, text: w.json });
    let assets = 0;
    for (const a of assetPaths) {
      try {
        files.push({ path: `assets/${a}`, bytes: await fetchBytes(dataUrl(a)) });
        assets++;
      } catch (err) {
        console.warn(`${MODULE_ID} | Asset übersprungen: ${a}`, err);
      }
    }
    await githubPushFiles(files, `Git Object Sync: ${jsonWrites.length} Objekt(e), ${assets} Asset(s)`);
    return { count: jsonWrites.length, assets };
  }

  // Server-Modus: in den Git-Ordner schreiben.
  for (const w of jsonWrites) {
    const dir = `${exportRoot()}/${w.folder}`;
    await ensureDir(dir);
    await uploadText(dir, w.fileName, w.json);
  }
  let assets = 0;
  for (const a of assetPaths) {
    try {
      const bytes = await fetchBytes(dataUrl(a));
      const dir = `${exportRoot()}/assets/${dirname(a)}`.replace(/\/+$/, "");
      await ensureDir(dir);
      await uploadBytes(dir, basename(a), bytes);
      assets++;
    } catch (err) {
      console.warn(`${MODULE_ID} | Asset übersprungen: ${a}`, err);
    }
  }
  return { count: jsonWrites.length, assets };
}

/* -------------------------------------------------------------------------- */
/*  Import (beide Modi)                                                         */
/* -------------------------------------------------------------------------- */

/** Verfügbare Import-Einträge eines Typs auflisten: [{ value, base }]. */
async function listImportEntries(type) {
  const cfg = TYPE_CONFIG[type];
  if (syncMode() === "github") {
    const tree = await githubTree();
    const prefix = `${cfg.folder}/`;
    return [...tree.keys()]
      .filter((p) => p.startsWith(prefix) && p.toLowerCase().endsWith(".json"))
      .map((p) => ({ value: p, base: p.slice(prefix.length) }));
  }
  const urls = await listExportedFiles(type);
  return urls.map((u) => ({ value: u, base: decodeURIComponent(u.split("/").pop()) }));
}

/** Server-Modus: exportierte JSON-Dateien eines Typs als URLs auflisten. */
async function listExportedFiles(type) {
  const cfg = TYPE_CONFIG[type];
  const dir = `${exportRoot()}/${cfg.folder}`;
  try {
    const result = await FilePicker.browse("data", dir);
    return (result.files ?? []).filter((f) => f.toLowerCase().endsWith(".json"));
  } catch (err) {
    return [];
  }
}

/** Referenzierte Assets aus dem Git-Ordner an ihren Originalort zurückschreiben. */
async function restoreAssetsServer(data) {
  for (const a of collectAssetPaths(data)) {
    try {
      const bytes = await fetchBytes(dataUrl(`${exportRoot()}/assets/${a}`));
      const dir = dirname(a);
      if (dir) await ensureDir(dir);
      await uploadBytes(dir, basename(a), bytes);
    } catch (err) {
      console.warn(`${MODULE_ID} | Asset-Restore übersprungen: ${a}`, err);
    }
  }
}

/** Referenzierte Assets aus GitHub an ihren Originalort zurückschreiben. */
async function restoreAssetsGithub(data, tree) {
  for (const a of collectAssetPaths(data)) {
    try {
      const sha = tree.get(`assets/${a}`);
      if (!sha) continue;
      const bytes = await githubReadBlob(sha);
      const dir = dirname(a);
      if (dir) await ensureDir(dir);
      await uploadBytes(dir, basename(a), bytes);
    } catch (err) {
      console.warn(`${MODULE_ID} | Asset-Restore übersprungen: ${a}`, err);
    }
  }
}

/** Aus geladenen Daten ein Dokument anlegen bzw. aktualisieren. */
async function importDataDoc(type, data) {
  const cls = getDocumentClass(type);
  const collection = TYPE_CONFIG[type].collection();
  const existing = data._id ? collection.get(data._id) : null;
  const overwrite = game.settings.get(MODULE_ID, "overwriteImport");

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
 */
async function importValue(type, value, tree = null) {
  const withAssets = syncAssets();
  let data;
  if (syncMode() === "github") {
    const sha = (tree ?? (await githubTree())).get(value);
    if (!sha) throw new Error(`Nicht im Repo: ${value}`);
    data = JSON.parse(new TextDecoder().decode(await githubReadBlob(sha)));
    if (withAssets) await restoreAssetsGithub(data, tree ?? (await githubTree()));
  } else {
    const response = await fetch(`${value}?t=${Date.now()}`); // Cache umgehen
    if (!response.ok) throw new Error(`HTTP ${response.status} für ${value}`);
    data = await response.json();
    if (withAssets) await restoreAssetsServer(data);
  }
  return importDataDoc(type, data);
}

/* -------------------------------------------------------------------------- */
/*  Dialoge                                                                    */
/* -------------------------------------------------------------------------- */

function buildCheckboxList(entries) {
  // entries: [{ value, label, sub }]
  const rows = entries
    .map(
      (e) => `
      <label class="gos-row" style="display:flex;gap:.5rem;align-items:center;padding:.15rem 0;">
        <input type="checkbox" name="gos" value="${foundry.utils.escapeHTML(e.value)}"/>
        <span style="flex:1;">${foundry.utils.escapeHTML(e.label)}</span>
        ${e.sub ? `<span style="opacity:.6;font-size:.85em;">${foundry.utils.escapeHTML(e.sub)}</span>` : ""}
      </label>`
    )
    .join("");

  return `
    <form>
      <div style="margin-bottom:.5rem;">
        <label style="display:flex;gap:.5rem;align-items:center;font-weight:bold;">
          <input type="checkbox" class="gos-select-all"/>
          <span>${t("GOS.Dialog.SelectAll")}</span>
        </label>
      </div>
      <hr/>
      <div class="gos-list" style="max-height:50vh;overflow:auto;">${rows}</div>
    </form>`;
}

function wireSelectAll(dialogElement) {
  const all = dialogElement.querySelector(".gos-select-all");
  if (!all) return;
  all.addEventListener("change", () => {
    dialogElement
      .querySelectorAll('input[name="gos"]')
      .forEach((cb) => (cb.checked = all.checked));
  });
}

function readSelected(dialogElement) {
  return Array.from(
    dialogElement.querySelectorAll('input[name="gos"]:checked')
  ).map((cb) => cb.value);
}

/** Export-Dialog für einen Dokumenttyp öffnen. */
async function openExportDialog(type) {
  const cfg = TYPE_CONFIG[type];
  const label = game.i18n.localize(`DOCUMENT.${type}`) || type;
  const docs = cfg.collection().contents.sort((a, b) => a.name.localeCompare(b.name));

  const entries = docs.map((d) => ({ value: d.id, label: d.name, sub: d.id }));
  const content = docs.length
    ? buildCheckboxList(entries)
    : `<p>${t("GOS.Dialog.NothingSelected")}</p>`;

  await foundry.applications.api.DialogV2.wait({
    window: { title: t("GOS.Dialog.ExportTitle", { label }) },
    position: { width: 480 },
    content,
    buttons: [
      {
        action: "export",
        label: t("GOS.Dialog.ExportButton"),
        icon: "fa-solid fa-code-branch",
        default: true,
        callback: async (event, button, dialog) => {
          const ids = readSelected(dialog.element);
          if (!ids.length) return ui.notifications.warn(t("GOS.Dialog.NothingSelected"));
          const docs = ids.map((id) => cfg.collection().get(id)).filter(Boolean);
          try {
            const { count, assets } = await exportDocuments(docs);
            ui.notifications.info(t("GOS.Notify.Exported", { count, assets }));
          } catch (err) {
            console.error(`${MODULE_ID} | Export`, err);
            ui.notifications.error(t("GOS.Notify.ExportError", { error: err.message }));
          }
        }
      },
      { action: "cancel", label: t("GOS.Dialog.Cancel") }
    ],
    render: (event, dialog) => wireSelectAll(dialog.element)
  });
}

/** Import-Dialog für einen Dokumenttyp öffnen. */
async function openImportDialog(type) {
  const label = game.i18n.localize(`DOCUMENT.${type}`) || type;
  const items = await listImportEntries(type);

  if (!items.length) {
    return ui.notifications.warn(t("GOS.Dialog.NothingToImport"));
  }

  const entries = items.map((it) => {
    const nice = it.base.replace(/__[A-Za-z0-9]+\.json$/i, "").replace(/\.json$/i, "");
    return { value: it.value, label: nice || it.base, sub: it.base };
  });

  await foundry.applications.api.DialogV2.wait({
    window: { title: t("GOS.Dialog.ImportTitle", { label }) },
    position: { width: 520 },
    content: buildCheckboxList(entries),
    buttons: [
      {
        action: "import",
        label: t("GOS.Dialog.ImportButton"),
        icon: "fa-solid fa-download",
        default: true,
        callback: async (event, button, dialog) => {
          const values = readSelected(dialog.element);
          if (!values.length) return ui.notifications.warn(t("GOS.Dialog.NothingSelected"));
          let count = 0;
          const tree = syncMode() === "github" ? await githubTree() : null;
          for (const value of values) {
            try {
              await importValue(type, value, tree);
              count++;
            } catch (err) {
              console.error(`${MODULE_ID} | Import`, err);
              ui.notifications.error(t("GOS.Notify.ImportError", { error: err.message }));
            }
          }
          ui.notifications.info(t("GOS.Notify.Imported", { count }));
        }
      },
      { action: "cancel", label: t("GOS.Dialog.Cancel") }
    ],
    render: (event, dialog) => wireSelectAll(dialog.element)
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

  wrap.querySelector(".gos-export").addEventListener("click", () => openExportDialog(type));
  wrap.querySelector(".gos-import").addEventListener("click", () => openImportDialog(type));
  header.appendChild(wrap);
}

/* -------------------------------------------------------------------------- */
/*  Setup                                                                      */
/* -------------------------------------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "syncMode", {
    name: t("GOS.Settings.SyncMode.Name"),
    hint: t("GOS.Settings.SyncMode.Hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      server: t("GOS.Settings.SyncMode.Server"),
      github: t("GOS.Settings.SyncMode.Github")
    },
    default: "server"
  });

  game.settings.register(MODULE_ID, "syncAssets", {
    name: t("GOS.Settings.SyncAssets.Name"),
    hint: t("GOS.Settings.SyncAssets.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "exportPath", {
    name: t("GOS.Settings.ExportPath.Name"),
    hint: t("GOS.Settings.ExportPath.Hint"),
    scope: "world",
    config: true,
    type: String,
    default: "git-export"
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
});

Hooks.once("ready", () => {
  for (const [type, cfg] of Object.entries(TYPE_CONFIG)) {
    Hooks.on(cfg.contextHook, (html, entryOptions) => addContextMenuEntry(type, entryOptions));
    Hooks.on(cfg.renderHook, (app, html) => injectDirectoryButtons(type, html));
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
