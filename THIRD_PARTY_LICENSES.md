# Third-Party Licenses

DonDocs' **original source code** (everything under `src/`, `tex/`, `scripts/`,
and `tests/`) is MIT-licensed (see `LICENSE`). The application also ships or
downloads several third-party components under their own licenses. The MIT
grant in `LICENSE` does **not** extend to these components.

## Bundled / vendored components

| Component | Files | License |
|---|---|---|
| SwiftLaTeX (PdfTeXEngine) | `public/lib/PdfTeXEngine.js`, `public/lib/swiftlatexpdftex.js`, `public/lib/swiftlatexpdftex.wasm` | AGPL-3.0 (SwiftLaTeX project); the engine wraps pdfTeX, see below |
| pdfTeX (compiled into the SwiftLaTeX WASM) | `public/lib/swiftlatexpdftex.wasm` | GPL-2.0-or-later |
| TeX Live packages and fonts | `public/lib/texlive/`, `public/lib/texlive-packages.js` | LaTeX Project Public License (LPPL) and per-package licenses; Computer Modern fonts under their respective font licenses |
| Pandoc (WASM, fetched at build time) | `public/lib/pandoc/pandoc.wasm.part*` (downloaded and split by `scripts/vendor-assets.mjs` from the `pandoc-wasm` npm package) | GPL-2.0-or-later |
| pandoc.js interface | `public/lib/pandoc/pandoc.js` | MIT (Tweag I/O Limited and John MacFarlane) |
| browser_wasi_shim | `public/lib/pandoc/wasi-shim.js` (bundled from `@bjorn3/browser_wasi_shim`) | MIT OR Apache-2.0 |
| PDF.js worker | `public/lib/pdf.worker.min.mjs` (synced from `react-pdf`'s pdfjs-dist by `scripts/sync-pdf-worker.mjs`) | Apache-2.0 (Mozilla) |

## Notes

- GPL components (pdfTeX, Pandoc) are shipped as **unmodified compiled
  binaries** and invoked as separate WASM programs; their source is available
  from their upstream projects (tug.org/texlive, pandoc.org, swiftlatex.com).
- npm dependencies bundled into `dist/assets/` carry their own licenses
  (predominantly MIT/Apache-2.0); see `package-lock.json` for the full tree.
  `jszip` is dual-licensed `MIT OR GPL-3.0-or-later`; this project elects MIT.
- DoD seals and insignia displayed by the application are subject to
  DoD 5535.09; their presence does not imply DoD endorsement of this tool.
