# Compendium Builder (CI helper tool)

🇬🇧 English (this file) · 🇩🇪 [Deutsch](README.md)

> **Important:** this folder is **not** part of the FoundryVTT module itself
> (`git-object-sync/`). It's a standalone Node.js tool that you copy into your
> **other, private content repo** – i.e. exactly the repo that the "Git
> Object Sync" module exports to (`actors/`, `items/`, `scenes/`, `journal/`,
> `compendia/<pack>/`).

## Quick start (for the impatient)

1. Install **[Node.js](https://nodejs.org)** (LTS version) – only once, if
   you don't already have it.
2. Copy the **`compendium-builder/`** folder from this repo into the **root**
   of your private content repo (see
   [One-time setup](#one-time-setup-in-your-private-content-repo)).
3. Once, in a terminal: `cd compendium-builder` then `npm install`.
4. Copy the file `compendium-builder/example-workflow.yml` to
   `.github/workflows/build-packs.yml` (see
   [Automation](#automation-via-github-actions-scheduled--on-every-export)).
5. **Done.** From now on, GitHub Actions automatically builds an installable
   compendium module on every export (plus once a day) – you don't have to
   run anything manually.

## What does this do?

Git Object Sync exports every object as a single, flat JSON file. That's
ideal for Git (small, diffable commits), but not a compendium you can
directly install in Foundry. This script closes that gap:

1. It reads in all the exported JSON files.
2. It uses the official **`@foundryvtt/foundryvtt-cli`** (`compilePack`) to
   build real, native FoundryVTT compendiums from them (LevelDB packs under
   `packs/<name>`).
3. It creates/updates a `module.json`, so your content repo itself can be
   used as an **installable Foundry module** – with real, searchable,
   browsable compendiums, without needing Git Object Sync's manual
   compendium import dialog at all.
4. Via a GitHub Actions automation, this runs **on a schedule** (cron)
   and/or on every export push – so your compendium module always stays
   up to date.

## Important limitations (please read first)

- **One compendium = one document type.** Foundry doesn't support mixed
  compendiums. "All components (characters, items, maps, …) in one
  compendium" isn't technically possible. The script therefore builds
  **one pack per export folder** (`packs/actors`, `packs/items`,
  `packs/scenes`, `packs/journal`, plus one pack per own compendium under
  `compendia/<pack>`) – all in a single run, but as separate packs.
- **Folder structure is restored.** The folder paths supplied by Git Object
  Sync (`flags.git-object-sync.folderPath` and
  `flags.git-object-sync.compendium.folderPath`) are converted into real,
  pack-internal folder documents (see `lib.mjs`). Folder IDs are derived
  **deterministically** from the pack name and the name path, so repeated
  runs (cron) don't create duplicate folders.
- **The private repo stays private.** Foundry's convenient manifest-URL
  installation only works with public repos (Foundry downloads it without
  authentication). With a private repo, only **manual installation** remains
  (download ZIP, copy folder into `Data/modules/`) – see below, same as
  already described for `git-object-sync/` itself in the main README.
- **Only the mapping logic is custom code.** The actual packing into a
  LevelDB is entirely handled by the official, Foundry-maintained
  `@foundryvtt/foundryvtt-cli`. `lib.mjs` only contains the pure
  mapping/reshaping logic and is covered by `test.mjs` (Node's built-in
  `node --test`).

## One-time setup in your private content repo

1. Copy this entire folder (`compendium-builder/`) into the root of your
   private content repo. Two ways, depending on what you're comfortable with:
   - **With Git (local clone):** clone this repo (or download it as a ZIP),
     copy out the `compendium-builder/` folder, paste it into your local
     clone of the content repo, then `git add`, `git commit`, `git push`.
   - **Without Git, browser only:** in this repo, click **"Code" → "Download
     ZIP"** and unzip it. Then in your content repo on GitHub.com, go to
     **"Add file" → "Upload files"** and drag & drop the unzipped
     `compendium-builder/` folder (with all its files) in. GitHub preserves
     the folder structure automatically.
2. `cd compendium-builder && npm install`
3. Test run: `npm run build` (or `node build-packs.mjs`) – this creates
   `packs/` and `module.json` **in the repo root** (one level above this
   folder). The script automatically locates the repo root based on its own
   file location – so it doesn't matter whether you run it from inside
   `compendium-builder/` or with the full path
   (`node compendium-builder/build-packs.mjs`) from the repo root.

## Automation via GitHub Actions (scheduled + on every export)

Copy `example-workflow.yml` to `.github/workflows/build-packs.yml` in your
**private content repo** (not in this module repo!). The workflow:

- runs **daily via cron** as well as **on every push** (i.e. right after an
  export by Git Object Sync),
- installs Node and the dependencies,
- rebuilds all packs,
- commits `packs/` and `module.json` automatically back into the same repo
  (the built-in `GITHUB_TOKEN` is enough, since everything stays within the
  same repo – no extra secret needed).

`classic-level` (the LevelDB binding used by `@foundryvtt/foundryvtt-cli`)
ships prebuilt binaries for `linux-x64`, so **no** extra build tooling is
needed on the default `ubuntu-latest` runner.

## After the build: installing/updating the module

Same as with the main module (private repo → manual installation only):

1. In your private content repo on GitHub: **"Code" → "Download ZIP"** (or
   the release artifact produced by the workflow, if you've added one).
2. Copy the unzipped folder (which now contains `module.json` + `packs/`)
   into `<foundrydata>/Data/modules/<your-module-id>/`.
3. Enable it in Foundry under **Manage Modules**.
4. The compendiums appear directly in the Compendiums sidebar – native,
   searchable, with no further import step needed.

**Update:** simply repeat the ZIP download and copy the folder again
(replacing the existing one) once the workflow has built new packs.

## Files in this folder

```
compendium-builder/
  package.json          <- dependency: @foundryvtt/foundryvtt-cli
  lib.mjs               <- pure mapping/reshaping logic (tested)
  build-packs.mjs       <- CLI entry point (uses lib.mjs + compilePack)
  test.mjs              <- smoke tests (node --test test.mjs)
  example-workflow.yml  <- template for .github/workflows/ in the content repo
  README.md             <- this file (German)
  README.en.md          <- this file (English)
```
