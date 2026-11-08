# Application update delivery

The normal build keeps the existing service worker until the rollout is qualified.
`DONDOCS_RELEASE_BUILD=1 npm run build` produces an immutable candidate. Its
`release.json` identifies the artifact independently of the package version or Git
availability. `/releases/<id>/` holds application files; `/runtimes/<hash>/` shares
unchanged engine resources. Saved immutable form revisions retain their URLs.

## Prepare a deployment

Run `npm run release:prepare -- dist release-site /path/to/previous-site` with the
complete previous deployment directory. The command verifies manifests and bytes,
retains older resources, and replaces current HTML and control files in a fresh
output directory. It rejects changed bytes at an existing immutable URL. Missing
files and the 20,000-file, 25-MiB-per-file, or 2-GiB deployment limits stop preparation.

For the first managed deployment only, use
`DONDOCS_BOOTSTRAP=1 npm run release:prepare -- dist release-site`. Bootstrap is
an explicit operator decision; subsequent deployments require the previous site.
An existing legacy site requires its previous directory and `DONDOCS_BOOTSTRAP=1`.
An empty directory is never valid history. Managed archives must have matching
root and immutable manifests, matching HTML, and verified retained resources.
Keep a durable copy of each published site. An expired CI artifact is not an empty
history and must not trigger another bootstrap.

Retain at least 30 days of application resources. The initial implementation
retains all history and fails at its budget instead of pruning. Saved-document
form revisions have a separate lifetime and must remain available while referenced.

## Hosting

The managed path uses Workers static assets with `wrangler.release.toml` and
exact HTML filenames. Upload the complete `release-site` directory in one
deployment. Build the matching container with
`docker build -f Dockerfile.release .`; it copies those same prepared bytes.
Container operators still control when their running containers are replaced.
The Worker routes `/` to `/index.html`; all other paths go directly to static
assets. This keeps immutable entry filenames exact without breaking root visits.
Cloudflare documents the routing behavior in its
[HTML handling reference](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/).

Cloudflare Pages and Workers Git integrations currently both build this repository.
Before managed publishing, verify which service owns the production custom domain
and disable competing production publishers. Do not enable release builds in the
existing Git integrations: those builds do not restore retained history.

Caddy and Cloudflare revalidate control files and cache immutable paths for a year.
Missing immutable files must return 404 rather than application HTML. Rollback
selects retained, compatible application files; it never clears document storage,
downgrades IndexedDB, or removes form revisions.

## Worker and tab behavior

The opt-in worker has a stable `/sw.js` URL. Application deployments change the
release manifest, rather than relying on worker activation to reload pages. The
worker verifies sizes, MIME types, and content hashes before committing readiness.
Cached bytes are keyed by content hash and shared across immutable resource URLs.
Unused Word WASM is fetched on demand; the shell and PDF runtime are prepared.
Once Word is used, subsequent releases prepare its complete runtime as well,
including when its hashes change or usage came from a legacy Workbox cache.

Only the accepting tab navigates to the selected release's HTML. Other tabs keep
their resource URLs. Cache collection retains identified live/offered releases and
the two most recently prepared releases; any unresponsive client prevents cleanup.
Worker takeover also requires every existing client to identify the supported
protocol. Legacy `SKIP_WAITING` messages cannot override that check.

## Accepting and reopening

An accepted update pauses new workspace interaction, checks active generation,
downloads, batch work, and backup transfers, then commits document writes and
retries retained attachment writes. Missing attachment bytes or unavailable form
pages stop the update. Readiness and the saved document are checked again before
the one navigation. Failures leave the editor available for retry.
Fresh drafts are saved before leaving, including changes to their settings.
File imports remain busy through the initial read and resulting document changes.
Attachment and form-page reads use the storage deadline so a stalled read returns
control to the editor.

The selected release, document, section, and view live in that tab's session
storage. Initialization restores them before exposing the workspace, rather than
relying on the shared current-document key. The point is cleared after successful
initialization. If the application fails to initialize, the HTML guard can retry
the compatible previous release once. It never unregisters workers or clears data.

A recovered tab stays on its previous immutable entry and suppresses the failed
release for that session. Reloading it does not immediately return to the broken
root release. A different release can still be offered.

## Qualify and enable publishing

`npm run test:release-builds` creates three real opt-in artifacts and an isolated,
hash-valid artifact with a failing entry module. `npm run test:releases` runs the
transitions in Chromium, Firefox, and WebKit. The qualification workflow also
builds the pinned legacy baseline to exercise the first worker transition. It
checks independent tab acceptance, last edits, attachment bytes, offline reopen,
incomplete staging, eviction, superseding releases, conservative cache collection,
legacy-worker coexistence, and recovery from failed initialization.
For local runs, set `RELEASE_BUILD_A`, `RELEASE_BUILD_B`, `RELEASE_BUILD_C`, and
`RELEASE_BUILD_BROKEN` to their `.release-fixtures` directories, and
`RELEASE_BUILD_LEGACY` to a production build of the pinned legacy baseline.

Desktop WebKit is not an iPhone qualification. Before enabling production, test
on a real iPhone in Safari and from an installed home-screen app: suspend/resume,
accept an update while another tab remains open, reopen offline, compare attachment
bytes, and export/restore a backup. Record the device, OS, browser, tested build,
and UTC timestamp in `.github/release-qualification.json`. Set the five named
checks to true only after observing them. Record the canonical HTTPS production
URL and confirm its Workers route and that competing production publishers are
disabled. `npm run release:check -- --digest` prints the source digest to record;
`npm run release:check` rejects incomplete records or changed source inputs. The
checked-in record is deliberately incomplete until those checks happen.

Configure repository variables `DONDOCS_PRODUCTION_URL` and
`DONDOCS_RELEASE_UPDATES=1`, the `production` environment, and its
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets. The token needs deployment
access to the canonical Worker. Configure GHCR package access for the workflow's
GitHub token. Require the qualification check in branch protection. The managed
publisher runs only through a manual dispatch on main, after qualification; it
builds once and uses the same prepared directory for Workers and the container.
The image keeps its exact, minor, major, and latest version tags alongside its
immutable release ID.
The existing source-build Docker publisher is disabled when this mode is enabled.

For the first dispatch, select `bootstrap`. It captures the actual live legacy
HTML, worker precache, support scripts, and public resources before overlaying the
new candidate. It checks that the origin did not change during capture. This
retains the old hashed bundles needed by open editors; rebuilding old source does
not guarantee the deployed hashes. Legacy tabs must be deliberately closed or
reopened before the managed worker can take over. Their already-shipped UI cannot
be changed retroactively.

Subsequent dispatches recover the last successful `deployed-site` artifact, verify
that it matches the live release, and retain its history. The complete prepared
site is archived before publication with 90-day CI retention. Keep an additional
durable copy outside CI before that archive expires. Missing history stops the
publisher. If a failed run already changed production, use its archived run ID as
`previous_run`; the live identity must match. Never bootstrap over managed history.

After upload, verification checks production control bytes and revalidation,
resource hashes, MIME/cache headers, and missing-resource 404s. A verification
failure stops container publication; inspect the archived site and production
route before retrying. Roll back by publishing a retained compatible deployment
and preserving the intervening release directories. Do not downgrade the stored
data format or clear browser databases as part of recovery.
