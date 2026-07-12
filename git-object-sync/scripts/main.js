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

/** Dateinamen sicher machen (keine Sonderzeichen, keine Leerzeichen). */
function sanitize(name) {
  return String(name ?? "unnamed")
    .normalize("NFKD")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80) || "unnamed";
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

/** Ein einzelnes Dokument als JSON-Datei in den Git-Ordner schreiben. */
async function exportDocument(doc) {
  const cfg = TYPE_CONFIG[doc.documentName];
  if (!cfg) throw new Error(`Unsupported document type: ${doc.documentName}`);

  const data = doc.toObject(); // vollständige Quelldaten inkl. _id
  const json = JSON.stringify(data, null, 2);
  const fileName = `${sanitize(doc.name)}__${doc.id}.json`;
  const dir = `${exportRoot()}/${cfg.folder}`;

  await ensureDir(dir);
  const file = new File([json], fileName, { type: "application/json" });
  await FilePicker.upload("data", dir, file, {}, { notify: false });
  return fileName;
}

/** Alle exportierten JSON-Dateien eines Typs auflisten (URLs). */
async function listExportedFiles(type) {
  const cfg = TYPE_CONFIG[type];
  const dir = `${exportRoot()}/${cfg.folder}`;
  try {
    const result = await FilePicker.browse("data", dir);
    return (result.files ?? []).filter((f) => f.toLowerCase().endsWith(".json"));
  } catch (err) {
    // Ordner existiert noch nicht.
    return [];
  }
}

/** Eine JSON-Datei laden und als Dokument anlegen bzw. aktualisieren. */
async function importFile(type, url) {
  const response = await fetch(`${url}?t=${Date.now()}`); // Cache umgehen
  if (!response.ok) throw new Error(`HTTP ${response.status} für ${url}`);
  const data = await response.json();

  const cls = getDocumentClass(type);
  const collection = TYPE_CONFIG[type].collection();
  const existing = data._id ? collection.get(data._id) : null;
  const overwrite = game.settings.get(MODULE_ID, "overwriteImport");

  if (existing) {
    if (overwrite) {
      await existing.update(data, { diff: false, recursive: false });
      return "updated";
    }
    // Nicht überschreiben -> als neue Kopie ohne feste ID anlegen.
    const clone = foundry.utils.deepClone(data);
    delete clone._id;
    await cls.create(clone);
    return "copied";
  }

  await cls.create(data, { keepId: true });
  return "created";
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
          let count = 0;
          for (const id of ids) {
            const doc = cfg.collection().get(id);
            if (!doc) continue;
            try {
              await exportDocument(doc);
              count++;
            } catch (err) {
              console.error(`${MODULE_ID} | Export`, err);
              ui.notifications.error(t("GOS.Notify.ExportError", { error: err.message }));
            }
          }
          ui.notifications.info(t("GOS.Notify.Exported", { count }));
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
  const files = await listExportedFiles(type);

  if (!files.length) {
    return ui.notifications.warn(t("GOS.Dialog.NothingToImport"));
  }

  const entries = files.map((url) => {
    const base = decodeURIComponent(url.split("/").pop());
    const nice = base.replace(/__[A-Za-z0-9]+\.json$/i, "").replace(/\.json$/i, "");
    return { value: url, label: nice || base, sub: base };
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
          const urls = readSelected(dialog.element);
          if (!urls.length) return ui.notifications.warn(t("GOS.Dialog.NothingSelected"));
          let count = 0;
          for (const url of urls) {
            try {
              await importFile(type, url);
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
        await exportDocument(doc);
        ui.notifications.info(t("GOS.Notify.Exported", { count: 1 }));
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
  game.settings.register(MODULE_ID, "exportPath", {
    name: t("GOS.Settings.ExportPath.Name"),
    hint: t("GOS.Settings.ExportPath.Hint"),
    scope: "world",
    config: true,
    type: String,
    default: "git-export"
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
      openExportDialog,
      openImportDialog,
      listExportedFiles
    };
  }

  console.log(`${MODULE_ID} | ready`);
});
