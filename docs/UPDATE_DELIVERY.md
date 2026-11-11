# Application update delivery

DonDocs has two update paths. The build selects the path; setting a variable on an already-built server does not change its JavaScript.

| Build | Update delivery |
|---|---|
| `npm run build` | Existing Workbox service-worker updates. Confirmation flushes document writes and activates the offered worker. Worker activation can also cause other legacy tabs to reload. |
| `DONDOCS_RELEASE_BUILD=1 npm run build` | Managed immutable releases. The accepting tab saves a restore point, verifies resources and navigates independently. Other managed tabs keep their loaded release. |

The full checkpoint and per-tab behavior below apply to **managed releases**. The checked-in [qualification record](../.github/release-qualification.json) is incomplete, so managed production publishing remains gated. Passing automated tests alone does not complete the device and production-host checks.

## What users see

Both paths expose a passive **Update Available** action. A new deployment does not open the confirmation dialog while someone is editing. The user opens it and chooses **Update Now** or **Later**.

For managed releases:

1. Visible tabs check on startup, every 60 seconds, and on focus, visibility changes or reconnect. Background failures leave editing available.
2. The worker prepares the current release and the candidate's required resources before advertising the candidate. It verifies content hashes, sizes and applicable MIME types. An incomplete candidate is not offered.
3. A different release ID triggers the offer, even when the package version is unchanged. There is no feature-level or critical-update filter. A new bundle is not applied inside the running editor.
4. Choosing **Later** keeps the current editor open. The user can reopen confirmation through the update action.
5. Choosing **Update Now** pauses new workspace interaction. Generation, downloads, batch work, imports, backups and open workspace dialogs must finish before acceptance can continue.
6. The app flushes document writes, retries retained attachment writes and verifies the open document's stored attachments and selected configured-form pages. Fresh drafts and settings-only edits are saved. Storage reads use deadlines; missing or stalled resources pause the update.
7. The offered target is prepared and checked again, then the document checkpoint is verified. A newer release arriving during confirmation does not silently replace that target. Only the accepting tab navigates.

A failed checkpoint or preparation shows **Update paused** and returns control to the editor. Keep that tab open, resolve the reported problem and retry. Independent tab navigation does not provide isolation from shared browser storage; follow the [form compatibility and recovery guidance](FORM_LIBRARY_ROLLOUT.md) when old and new tabs coexist.

## Build an immutable candidate

Use the normal [source-build prerequisites](DEPLOYMENT.md#normal-source-build), then run:

```sh
DONDOCS_RELEASE_BUILD=1 npm run build
```

`dist/release.json` identifies the artifact independently of the package version or Git availability. A build generates an ID unless `DONDOCS_RELEASE_ID` is supplied; IDs contain lowercase letters, digits and hyphens, start with a letter or digit, and are at most 64 characters. Do not reuse an ID for different bytes.

Application files live under `/releases/<id>/`. Unchanged engine resources share `/runtimes/<hash>/`; saved immutable form revisions retain their `/templates/.../revisions/...` URLs. Root HTML and control files select the currently published release.

## Prepare a deployment

Run from the repository root with a complete previous deployment archive:

```sh
npm run release:prepare -- dist release-site /path/to/previous-site
```

The output directory must not already exist. Preparation verifies candidate and previous manifests and resource bytes, retains history, then overlays the candidate's HTML and control files. It rejects changed bytes at an existing immutable URL, missing resources, mismatched managed manifests/HTML and symlinks. The prepared site is limited to 20,000 files, 25 MiB per file and 2 GiB total. A failed preparation can leave a partial output directory; do not publish it or reuse it for a retry.

For the first managed deployment:

| Existing origin | Preparation |
|---|---|
| No previous site | `DONDOCS_BOOTSTRAP=1 npm run release:prepare -- dist release-site` |
| Legacy site | Capture its actual deployed bytes, then run `DONDOCS_BOOTSTRAP=1 npm run release:prepare -- dist release-site /path/to/captured-legacy-site`. |
| Managed site | Use its complete previous archive without bootstrap. |

The no-previous-site option is for standalone preparation. The publication workflow's bootstrap mode expects a live legacy site to capture.

An empty directory is never valid history. Bootstrap does not repair lost managed history. Keep a durable copy of every published prepared site; an expired CI artifact must not trigger another bootstrap.

Retain application resources for at least 30 days. This is an operating requirement, not a pruning timer: preparation currently keeps all history and fails at its budget. Form revisions have a separate lifetime and must remain available while saved documents reference them.

## Hosting

Publish the complete prepared `release-site/` directory as one deployment. Managed Workers hosting uses [wrangler.release.toml](../wrangler.release.toml) and [serve-release.ts](../scripts/serve-release.ts): `/` maps to `/index.html`, while other paths use exact static-asset filenames. HTML rewriting and SPA fallback are disabled so immutable entry URLs remain exact and missing immutable resources return 404. See Cloudflare's [HTML handling reference](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/).

The matching container copies the same prepared bytes:

```sh
docker build -f Dockerfile.release -t dondocs:prepared .
```

Container operators control when running containers are replaced. Both hosting paths revalidate control files and mark immutable resources cacheable for a year. Preserve the site's origin so browser documents and attachments remain accessible.

Check which service owns the production custom domain and disable competing production publishers before managed rollout. Cloudflare Pages and Workers Git builds have both been observed for this repository; a green build does not establish which one serves the domain. Do not enable release builds in those integrations: they do not restore retained deployment history.

## Worker and browser caches

The managed worker has a stable `/sw.js` URL. Application updates are selected through release manifests rather than worker activation reloading pages. Cache entries are keyed by content hash and can serve multiple immutable URLs.

The shell and PDF runtime are prepared. Unused Word WASM is fetched on demand. Once Word is used, subsequent releases prepare its complete runtime too, including changed hashes and usage discovered in a legacy Workbox cache. Form pages are loaded separately; preparing a release does not cache every library form.

Browser cache collection retains identified live/offered releases and the two most recently prepared releases. Any unresponsive client prevents collection. This browser policy is separate from server-side history retention. Worker takeover requires every existing window client to identify the supported protocol; legacy `SKIP_WAITING` messages cannot bypass that check. Existing legacy tabs must be deliberately closed or reopened before takeover.

## Accepting and reopening

The accepting tab stores its selected release, document, section, scroll position and view in session storage. Initialization restores that tab's selection before exposing the workspace, rather than relying on the shared current-document key. The restore point is cleared after successful initialization.

The HTML recovery guard waits 15 seconds. With a valid update restore point, it can try the compatible previous immutable entry once if the workspace has not reported readiness and the main workspace element is absent. It does not roll back every error that occurs after the workspace renders. It never unregisters workers or clears document storage.

A recovered tab stays on the previous immutable entry and suppresses the failed target for that session. Reloading that tab does not immediately return it to the failed root release. A different release can still be offered. A normally initialized update may return the address bar to `/`; its already-loaded resource URLs remain pinned to the accepted release.

## Qualify and enable publishing

[qualify-release.yml](../.github/workflows/qualify-release.yml) runs on pull requests and main pushes and is reused by the publisher. It builds three real managed artifacts plus an isolated, hash-valid artifact whose entry module fails. It tests transitions in Chromium, Firefox and desktop WebKit, including the pinned legacy baseline `a6bab99c2eb394bd677a00312bc595e82f4e0a2a`. It also checks the prepared container and local Workers routing/headers.

For local transition tests, install Playwright's browsers, build the fixtures with `npm run test:release-builds`, and build that legacy revision in a separate checkout. Set `RELEASE_BUILD_A`, `RELEASE_BUILD_B`, `RELEASE_BUILD_C` and `RELEASE_BUILD_BROKEN` to the corresponding `.release-fixtures/` directories, and `RELEASE_BUILD_LEGACY` to the legacy checkout's `dist/`, then run `npm run test:releases`. The suite covers independent tab acceptance, last edits, attachments, offline reopening, incomplete staging, eviction, superseding releases, conservative collection, legacy-worker coexistence and initialization recovery.

Desktop WebKit is not a real-iPhone qualification. Test Safari and an installed home-screen app on a real iPhone: suspend/resume, accept an update with another tab open, reopen offline, compare attachment bytes and export/restore a backup. Record the observed results in [.github/release-qualification.json](../.github/release-qualification.json):

| Field | Required evidence |
|---|---|
| `sourceDigest` | Output of `npm run release:check -- --digest` for the tested source inputs. |
| `iphone` | Device, OS, browser, tested build and UTC `checkedAt`; set `installedResume`, `acceptedUpdate`, `offlineReopen`, `attachmentBytes` and `backupRestore` to `true` only after observing them. |
| `production` | Canonical HTTPS `url`, verified Worker ownership and competing production publishers disabled. |

`npm run release:check` rejects an incomplete record, a changed source digest or a conflicting `DONDOCS_PRODUCTION_URL` origin. Recheck the source and device/host evidence when covered inputs change. Do not copy attestations from an unrelated build.

Configure repository variables `DONDOCS_PRODUCTION_URL` and `DONDOCS_RELEASE_UPDATES=1`, the `production` environment, and its `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets. The token needs deployment access to the canonical Worker; the workflow's GitHub token needs GHCR package access. Require the qualification check in branch protection.

[publish-release.yml](../.github/workflows/publish-release.yml) runs only by manual dispatch on main after eligibility and qualification. It builds the candidate once and uses the same prepared directory for Workers and the container. The container receives an immutable release-ID tag plus exact, minor, major and latest version tags. The ordinary source-build Docker publisher is disabled when managed publishing is enabled.

For the first dispatch, select `bootstrap`. The workflow captures live legacy HTML, precached bundles, worker support scripts and public resources, and checks that the origin did not change during capture. Rebuilding old source is not a substitute for capturing its actual deployed hashes. Existing legacy tabs cannot acquire new update behavior retroactively.

Subsequent dispatches recover the last successful `deployed-site` artifact and verify that it matches the live release before retaining its history. The prepared site is archived before publication with 90-day CI retention; keep a durable copy outside CI. Missing history stops publication. If a failed run already changed production, `previous_run` can select that run's archive, provided its live identity matches. This input selects retained history, not a rollback target.

## Verify and recover a publication

After upload, the publisher runs:

```sh
npm run release:verify-live -- https://your-production-host.example release-site
```

Replace the example with the canonical production origin. Verification checks the live manifest against the archive, root HTML/worker/control bytes and revalidation, candidate resource hashes, applicable MIME/cache headers and missing-resource 404s. A failure stops subsequent container publication; it does **not** automatically undo the Workers deployment that already occurred. Inspect production and the archived site before retrying.

For a deliberate rollback, use a retained, data-compatible site as the candidate and the current complete site as history. In a clean workspace where `release-site/` does not exist:

```sh
npm run release:prepare -- /archives/known-good-site release-site /archives/current-site
```

Publish and verify the resulting prepared directory through the same hosting path. This keeps intervening immutable resources for tabs still using them. The manual publisher normally builds current main; its `previous_run` input alone does not roll back application code. Check data compatibility before selecting an older build. Do not downgrade IndexedDB, clear document storage or remove referenced form revisions as part of recovery.
