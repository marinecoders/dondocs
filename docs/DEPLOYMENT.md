# Building and deploying DonDocs

[Documentation index](README.md) · [Classification configuration](CLASSIFICATION_CONFIG.md) · [Licensing](LICENSING.md)

## Normal source build

Use the checked-in lockfile and a Node version satisfying all locked engines (Node 22.13+ on the Node 22 line; CI uses Node 22).

```sh
npm ci
npm run build
npm run preview
```

`dist/` is the normal site's output. npm's prebuild stages vendor assets/icons and postbuild runs packaging/no-CDN checks. Invoke the npm build rather than bypassing those hooks with Vite directly. Initial dependency and Pandoc/vendor staging requires network access. Use `npm run dev` for development; preview is not a production server.

## Docker source-build path

From the repository root:

```sh
docker build -t dondocs:local .
docker run --rm -p 8080:80 dondocs:local
```

The image builds the application and serves it with Caddy on container port 80. Use `http://localhost:8080` for local inspection. Put a production deployment behind HTTPS so service workers, signing/crypto and supported file-system APIs have the secure context they require. The checked-in Caddy configuration handles static/WASM/TeX content and SPA fallback; a non-local HTTP hostname does not provide the same browser capabilities as localhost.

`Dockerfile` accepts `--build-arg BASE_PATH=/prefix/` for the Vite asset base. That is only the application URL prefix: arrange the reverse proxy/static mount to serve those URLs correctly and check worker, WASM, template and offline paths at that prefix. The default Caddy setup serves the root; a build argument alone does not configure a proxy mount. Keep scheme/hostname/port stable when updating so browser storage remains on the same origin.

Build-time classification variables must be set in the builder's environment before the npm build, as shown in [classification configuration](CLASSIFICATION_CONFIG.md). Merely setting Vite variables on the running static server does not rebuild the app. Runtime policy has its own documented precedence and host matching. Neither policy nor banners establish processing authorization.

## Offline preparation

Stage npm dependencies and the complete successfully built `dist/` while connected. Retain required vendor/TeX assets and the exact immutable configured-form revisions used by saved documents. The web app's postbuild guard rejects known CDN references in built assets; it is not proof that every optional action is network-free. The developer-only box editor separately loads cdnjs resources unless adapted to local assets.

Before disconnecting, open/install the app, exercise required exports and cache each configured form with **Save for offline use**. Test reopening and exporting under the intended network restrictions. Preserve external document backups and filled PDFs; browser caches can be evicted. This workflow does not qualify SIPR/JWICS or any other classified environment.

## Managed immutable updates

[UPDATE_DELIVERY.md](UPDATE_DELIVERY.md) is the authoritative runbook for candidate artifacts, retained deployment history, verification and rollback. It is separate from the normal source build above. Its checked-in qualification record is incomplete; do not turn on publishing by treating this documentation update as qualification.

Managed builds use `DONDOCS_RELEASE_BUILD=1`; preparation requires the complete previous site and retains immutable URLs/resources. `Dockerfile.release` consumes a prepared release site rather than rebuilding it. Follow the runbook's explicit bootstrap, retention and production-environment gates. Do not substitute an empty directory for missing deployment history.

Before rollout/rollback, follow [form recovery guidance](FORM_LIBRARY_ROLLOUT.md), preserve origin and old pinned form assets, and rehearse the previous-to-candidate storage upgrade. Native device acceptance is distinct from Playwright emulation.

## Distribution

Retain AGPL/source information and all applicable component notices. See [LICENSING.md](LICENSING.md), [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md) and the generated `SOURCE.txt` in packaged outputs. Serving your own deployment also means operating its HTTPS, headers, update history and backups.
