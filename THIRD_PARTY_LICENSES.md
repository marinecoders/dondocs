# Third-Party Licenses

DonDocs is distributed under GNU AGPL version 3 only (`AGPL-3.0-only`); see
`LICENSE` and `docs/LICENSING.md`. This project license does not replace the
licenses or notices of third-party components, fonts, government materials, or
other separately licensed assets.

## Bundled / vendored components

| Component | Files | License |
|---|---|---|
| PdfTeXEngine JavaScript wrapper | `public/lib/PdfTeXEngine.js` | Its file header declares EPL-2.0 with a conditional GPL-2.0 / Classpath-exception-2.0 secondary license; retain that notice. |
| SwiftLaTeX engine | `public/lib/swiftlatexpdftex.js`, `public/lib/swiftlatexpdftex.wasm` | The upstream project declares AGPL-3.0; the engine wraps pdfTeX, see below. |
| pdfTeX (compiled into the SwiftLaTeX WASM) | `public/lib/swiftlatexpdftex.wasm` | GPL-2.0-or-later |
| TeX Live packages and fonts | `public/lib/texlive/`, `public/lib/texlive-packages.js` | LaTeX Project Public License (LPPL) and per-package licenses; Computer Modern fonts under their respective font licenses |
| Pandoc (WASM, fetched at build time) | `public/lib/pandoc/pandoc.wasm.part*` (downloaded and split by `scripts/vendor-assets.mjs` from the `pandoc-wasm` npm package) | GPL-2.0-or-later |
| pandoc.js interface | `public/lib/pandoc/pandoc.js` | MIT (Tweag I/O Limited and John MacFarlane) |
| browser_wasi_shim | `public/lib/pandoc/wasi-shim.js` (bundled from `@bjorn3/browser_wasi_shim`) | MIT OR Apache-2.0 |
| PDF.js worker | `public/lib/pdf.worker.min.mjs` (synced from `react-pdf`'s pdfjs-dist by `scripts/sync-pdf-worker.mjs`) | Apache-2.0 (Mozilla) |

## Notes

- pdfTeX and Pandoc are invoked as separate WASM programs. Preserve their notices
  and provide the corresponding source required by their applicable licenses,
  matching the binaries actually shipped, including any patches and build scripts.
- npm dependencies bundled into `dist/assets/` carry their own licenses
  (predominantly MIT/Apache-2.0); see `package-lock.json` for the full tree.
  `jszip` is dual-licensed `MIT OR GPL-3.0-or-later`; this project elects MIT.
- DoD seals and insignia displayed by the application are subject to
  DoD 5535.09; their presence does not imply DoD endorsement of this tool.

## Additional copyright notice

The following notice is retained for incorporated contributions received under
these terms. It does not license new AGPL-only contributions under these terms.

Copyright (c) 2026 Roberto Chiofalo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
