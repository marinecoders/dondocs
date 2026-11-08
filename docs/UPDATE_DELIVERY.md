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

Cloudflare Pages and Workers Git integrations currently both build this repository.
Before managed publishing, verify which service owns the production custom domain
and disable competing production publishers. Do not enable release builds in the
existing Git integrations: those builds do not restore retained history.

Caddy and Cloudflare revalidate control files and cache immutable paths for a year.
Missing immutable files must return 404 rather than application HTML. Rollback
selects retained, compatible application files; it never clears document storage,
downgrades IndexedDB, or removes form revisions.
