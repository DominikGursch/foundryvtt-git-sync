# Git Object Sync (FoundryVTT v12 / v13)

🇬🇧 English (this file) · 🇩🇪 [Deutsch](README.md)

This module lets you back up and restore individual FoundryVTT objects –
**Characters (Actors), Items, Scenes, Journals and your own world compendiums**
– including their **images and maps**. Everything is stored on **GitHub**
(a free online storage service perfectly suited for this) – **directly from
the Foundry interface**, with no server and no terminal required.

**In short:** you click "Export" inside Foundry – the module does the rest.

### What exactly does the module do?

- **Export:** select an object in Foundry → it is saved as a file.
  - **Right-click** an object in the sidebar → "Export to Git"
  - or use the **buttons** at the top of every sidebar tab → a dialog with
    checkboxes lets you export several objects at once
- **Backed up on GitHub:** the module uploads directly to GitHub on click
  (one single commit per export).
- **Images & maps included:** referenced images (maps, portraits, tokens) are
  optionally backed up as well, so objects transfer completely.
- **Characters, complete:** an Actor automatically brings along its
  **carried Items, Active Effects and Prototype Token data** on export/import
  – nothing gets lost.
- **Your own world compendiums:** self-created compendiums (including their
  internal folder structure) can be backed up and restored too – see
  **[Backing up and restoring compendiums](#backing-up-and-restoring-compendiums)**.
- **Import:** load the files back in on the same or a different Foundry
  instance – again, with a single click.

### What you need

- A **FoundryVTT v12** installation (you, as **Game Master/GM**). The
  context menus and buttons also work on **v13**; only v12 has been
  thoroughly tested so far (see [Compatibility](#compatibility)).
- A free **GitHub account**.

**Quick start:**
1. **[Install the module](#1-install-the-module)**
2. **[Set up GitHub](#2-set-up-github)**

---

## Package contents (what's in this project)

```
git-object-sync/            <- The FoundryVTT module (goes into Data/modules/)
  module.json
  scripts/main.js
  lang/{de,en}.json
compendium-builder/         <- Optional CI tool for your PRIVATE content repo
                                (turns exports into a real, installable
                                compendium – see compendium-builder/README.md)
```

---

## 1. Install the module

This step brings the module into your Foundry installation. Since your
module repo is **private**, the **manual installation (method 1)** is the
right approach. The convenient manifest-URL installation (method 2) only
works with a **public** repo.

### Method 1 – Manual (copy the folder, for a private repo)

1. Open the project on GitHub (while signed in):
   `https://github.com/DominikGursch/foundryvtt-git-sync`
2. Click the green **"Code" → "Download ZIP"** button and unzip the
   downloaded file.
3. In the unzipped folder you'll find the subfolder **`git-object-sync/`**.
   Copy **exactly this folder** into the `modules` directory of your Foundry
   installation, so that it ends up looking like this:
   ```
   <foundrydata>/Data/modules/git-object-sync/
   ```

`<foundrydata>` is your Foundry data folder. You can find its location in
Foundry on the setup screen under **Configuration** → "User Data Path".

> **Updating later:** to update, simply repeat the ZIP download and copy the
> `git-object-sync/` folder into `Data/modules/` again (replacing the
> existing one).

### Method 2 – Via the Foundry interface (manifest URL, public repo only)

> **Only possible if the module repo is public.** Foundry downloads the
> manifest URL **without authentication**; with a private repo, the download
> fails. As long as your repo stays private, use **Method 1**.

1. Start Foundry and stay on the **setup/start screen** (not inside a world).
2. Switch to the **"Add-on Modules"** tab.
3. Click **"Install Module"** at the bottom.
4. Enter this address in the **"Manifest URL"** field and click **"Install"**:
   ```
   https://github.com/DominikGursch/foundryvtt-git-sync/releases/latest/download/module.json
   ```

### Enable the module (both methods)

**Enable:** start your world in Foundry and go to
**Game Settings → Manage Modules**. Check the box for **"Git Object Sync"**
and save. The actual setup continues in **[Set up GitHub](#2-set-up-github)**.

---

## 2. Set up GitHub

### 2.1 – Create an empty repository on GitHub

1. Sign in at **https://github.com** (or register for free).
2. Top right **+** → **New repository**.
3. **Repository name:** e.g. `foundry-content`.
4. Set it to **Private** and leave all checkboxes unchecked (the repo must be
   empty).
5. **Create repository**. Note the name down as `YOUR_GITHUB_NAME/REPO_NAME`.

### 2.2 – Create an access token (your "credentials")

The token allows the module to write to and read from **exactly this one
repo** – nothing more.

1. Open **https://github.com/settings/personal-access-tokens** →
   **Generate new token** (Fine-grained).
2. **Token name:** e.g. `Foundry Git Object Sync`. **Expiration:** as you
   prefer.
3. **Repository access** → **Only select repositories** → choose your repo.
4. **Permissions** → **Repository permissions** → set **Contents** to
   **Read and write**. (Nothing else is needed.)
5. **Generate token** → **copy** the token shown (it is only displayed
   **once**).

### 2.3 – Configure the module

In Foundry: **Settings → Module Settings → "Git Object Sync"**:

- **GitHub repository:** `YOUR_GITHUB_NAME/REPO_NAME` (e.g.
  `DominikGursch/foundry-content`)
- **GitHub branch:** `main`
- **GitHub token:** paste the copied token
- **Sync assets:** leave enabled (images/maps included)

Save – **done.** From now on you can export/import directly (see
**[Day-to-day use](#day-to-day-use)**).

> **Security:** the token lives in the world settings (only the GM can see
> it). Use a **fine-grained** token scoped **only** to this one repo and
> **only** to "Contents" – never your account password. Set an expiration
> date if you like.

### Controlling asset and folder paths (optional)

By default, assets are stored **exactly under their original path** – in the
repo under `assets/<original path>`, and put back at the same location on
import. Objects are placed on import into the same sidebar folder they had
on export. Several settings let you change this. All of them exist as a
**global module setting** and are additionally available **directly in the
export/import dialog** (the dialog values override the global default for
that one operation).

**Export:**

- **Store assets in collective folders** — a checkbox. If checked, all
  assets are neatly placed under `assets/<type>/<filename>` (e.g.
  `assets/Item/sword.webp`, `assets/Actor/portrait.webp`) and references
  inside the objects are rewritten accordingly. If unchecked, the full
  original paths are kept.

**Import:**

- **Import target folder for assets** — the path inside the data directory
  where imported images/maps are stored locally. Example: `git-import`
  writes assets to `git-import/…` and rewrites the paths inside imported
  objects accordingly. Empty = original path.
- **Folder behaviour** — controls which sidebar folder imported objects are
  placed into:
  - **Same folder as on export** — the folder structure (e.g. `Weapons`) is
    recreated if needed and the object is placed there.
  - **No folder (root)** — the object ends up at the top level, no folder.
  - **Fixed folder** — all imported objects go into a self-named folder
    (field **fixed folder name**, e.g. `Git Import`).

For "Same folder as on export" to work, the folder path is stored
automatically at export time – older exports (without this info) end up at
the root in this mode.

### Showing only deltas (optional)

The export and import dialogs mark every object with a status badge:

- **New** — no matching file exists yet in the repo, or no matching local
  document exists.
- **Changed** — the file/document already exists, but the content differs.
- **Unchanged** — the content is identical to the last export/import.

The status is determined locally via a git blob hash comparison (no extra
download needed). Using the **"Hide unchanged objects"** checkbox right in
the dialog, you can hide unchanged entries and see only the deltas. The
global module setting **"Hide unchanged objects by default"** (default: on)
only controls the default state of that checkbox.

> **Note:** the comparison uses the currently configured global export
> settings (sync assets, collective folders). If these have changed since
> the last export/import, the displayed status may be inaccurate.

---

## Day-to-day use

Once set up, you stay entirely inside Foundry.

### Backing something up (Export)

1. Select object(s) – via **right-click → "Export to Git"** or the
   **"Git Export …" button** at the top of the sidebar (there you can check
   off several objects at once).
2. The module backs up the objects **including images/maps** directly to
   GitHub (immediately).

### Restoring something (Import)

Works on the same instance (e.g. after an error) or on a different Foundry
installation.

1. Click the **"Git Import …" button**.
2. Check off the desired files → import. Referenced images/maps are
   automatically restored along with them.

The module reads the current state directly from GitHub on import – no
manual refresh is needed.

---

## Backing up and restoring compendiums

Just like individual objects, you can also back up and restore **your own
compendiums created in this world**. Compendiums that come from a **system**
or a **module** are **not** offered – their content already comes through
that installation and doesn't need a separate backup.

1. Open the **Compendiums sidebar tab**.
2. The same two buttons **"Git Export …"** / **"Git Import …"** appear at the
   top, just like for Actors, Items, Scenes and Journals – here they show
   **all entries from your own world compendiums**, grouped by compendium
   name.
3. **Export:** select the entries you want (across multiple compendiums is
   fine) and export them. They land in the repo under
   `compendia/<technical-name>/…`.
4. **Import:** the file remembers which compendium (name + document type) it
   came from. If that compendium doesn't exist yet on the target
   installation, it is **created automatically**.
5. **Folders inside the compendium** (the ones you create e.g. via
   right-click directly inside the compendium) are exported and restored to
   the same place on import.

The same options as for regular objects also apply here: assets are backed
up, the delta status (New/Changed/Unchanged) is determined the same way, and
"hide unchanged" works identically. There naturally is no **sidebar folder**
for compendium entries – the folder-behaviour setting ("Same folder/No
folder/Fixed folder") therefore doesn't apply here.

> **Automatically building a compendium from many small exports:** if you
> export items, characters, scenes, etc. one by one into a separate content
> repo and want to regularly turn them into a finished, installable
> compendium module, check out the included CI tool
> **[`compendium-builder/`](compendium-builder/README.en.md)** – it uses
> GitHub Actions to automatically (e.g. daily) build a compendium from all
> your exports.

---

## When something doesn't work (troubleshooting)

- **"GitHub 401" / "GitHub 403":** the token is missing, expired, or doesn't
  have **Contents: Read and write** for the repo. Check the token in the
  module settings (step 2.2/2.3).
- **"GitHub 404":** the repository name is wrong (must be `owner/repo`) or
  the token doesn't have access to exactly this repo.
- **Nothing to import:** nothing has been exported for this type yet, or the
  **GitHub branch** in the settings doesn't match (default: `main`).
- **"No world compendiums found":** this world currently has no **own**
  compendiums – create one in the Compendiums tab first (system/module
  compendiums are deliberately not offered, see
  [Backing up and restoring compendiums](#backing-up-and-restoring-compendiums)).

---

## Good to know (technical notes)

- **Maps & images:** with the **"Sync assets"** setting enabled, the module
  automatically copies referenced images (maps, portraits, tokens) along –
  on both export **and** import. This means scenes and characters work
  fully on a different instance too. Only commonly-available files (core,
  system and module assets) and external web addresses (`http(s)://…`) are
  skipped. Images are stored as their own files in the repo (up to 100 MB
  per file).
- **IDs are preserved:** on import, an object keeps its original ID. If it
  already exists, it is updated (if "Overwrite on import" is enabled) –
  otherwise it is created as a copy.
- **GM only:** export and import are only available as the GM.
- **No restart needed:** unlike the official `fvtt` tool, Foundry does
  **not** need to be shut down to export/import.
- **Everything in one file:** characters bring their items/effects along,
  journals their pages, scenes their tokens/notes/lights – each in a single
  file.

---

## Compatibility

- **Tested:** FoundryVTT **v12**. All workflows described in this guide
  (buttons, dialogs, export/import, compendiums) are designed for and
  verified on it.
- **v13:** Foundry v13 renamed the internal "hooks" for sidebar right-click
  menus, and no longer passes a jQuery object to callback functions but a
  native HTML element instead. The module therefore registers **both**
  variants (v12 **and** v13 hook names) and automatically detects both
  argument shapes – so the "Export to Git" context-menu entry should also
  appear on v13. The buttons at the top of the sidebars and all dialogs are
  unaffected by this change either way. `module.json` accordingly allows
  `"maximum": "13"` – a full end-to-end test on a real v13 world by the
  module author is still pending, so v13 is considered **compatible, but not
  fully verified**.
- **Feedback welcome:** if you notice anything on v13 (or a newer version),
  please file it as an issue in the repository.
