# DonDocs architecture

[Documentation index](README.md) · [Storage](STORAGE.md) · [Capabilities](CAPABILITIES.md)

## Document generation pipelines

```text
editor/store state
  → owned capture of one document revision
  → output projection, capabilities and deployment policy
  → content review / publication or form validation
  → prepared output
  → renderer using that capture
  → delivered file for that revision
```

Async exports must not reread the live editor after capturing a revision. Ownership/revision checks keep a later edit or document switch from receiving the previous operation's save/review/result. Preview is a separate, captured operation and can omit expensive finishing features; a download from preview still uses the canonical export route.

Correspondence PDF generates TeX fragments and uses the packaged SwiftLaTeX **pdfTeX** engine. Word uses flat TeX plus Pandoc and DOCX post-processing. They share content/layout rules but have separate engines and pagination. PDF finishing handles supported links, enclosure assembly and signature fields. Technical-publication families add structured preflight/rendering and are PDF-only.

Word package delivery in `src/services/exports/wordPackage.ts` captures one saved action-package revision through the existing portable resource validator. It renders approved correspondence through the ordinary prepared Word path with operation-owned image resources, preserves separate original bytes and emits a measured digest manifest. `WordPackageDownload` owns revision-scoped review/cancellation; ordinary clean PDF/DOCX exports retain their existing path.

Built-in NAVMC forms keep dedicated editors and PDF generators. Configured forms instead validate a pinned semantic definition and render answers/rows over checksummed immutable template pages. Current configured-form drafts, backups and encrypted handoffs include the exact template bytes, retained as hash-keyed IndexedDB attachments; Cache Storage is an optional accelerator. Legacy files may still require the hosted template pages.

The companion accepts HTTP/MCP requests, validates them, maps them to renderer input and writes final files locally. It does not depend on a browser's Zustand state. It uses the same publication preflight, and system Pandoc rather than the browser-vendored WASM converter for Word. See [the contract](COMPANION.md).

## Source map

| Area | Maintained entry points |
|---|---|
| Document formats and controls | `src/types/document.ts`, `src/lib/documentOutputConfig.ts`, `src/lib/documentCapabilities.ts` |
| Capture, projection and export | `src/lib/` capture/prepared-export modules; find current entry points with `rg --files src/lib` rather than copying a stale module tree |
| Rendering | `src/services/latex/`, `src/services/docx/`, `src/services/pdf/`, `src/services/forms/`; `tex/` is canonical TeX source |
| Shared paragraph layout | `src/services/latex/paragraphLayout.ts`, `subparagraphIndent.ts` |
| Publication data/preflight | `src/data/techpub/`, `src/lib/publicationPreflight.ts` and family-specific validators |
| Form definition/packages | `src/services/forms/model.ts`, `packages.ts`, `scripts/form-package.mts` |
| Workspace persistence | `src/stores/documentsStore.ts`, `src/lib/documentsDb.ts`, `backup.ts`; [storage contract](STORAGE.md) |
| Pinned native reviews | `src/lib/reviewRounds.ts`, `reviewRoundActions.ts`, `src/components/modals/ReviewRoundsModal.tsx`; reuse captured snapshots, draft transfer and existing attachment roots |
| Reusable content | `src/data/templates/`; `src/data/exampleDocuments.ts` and `public/drafts/` hold examples |
| Reference datasets | `src/data/units.json`, `ssic.json`, `office-codes.json` and reference modules/data under `src/data/` |
| Local companion | `companion/server.ts`, `mcp.ts`, `letterSchema.ts`, `validateLetter.ts`, `letterInput.ts` |
| Deployment/runtime paths | `src/lib/releasePaths.ts`, `src/config/paths.ts`; form-package paths also follow pinned definitions |
| Tests and build scripts | `tests/`, `scripts/`, the five root TypeScript project references and CI workflows |

The root TypeScript solution checks app, build configs, companion, tests and lifecycle contracts with `tsc -b`. A plain root `tsc --noEmit` does not follow the solution references.

## Generated assets and contracts

- `node build-templates.mjs` regenerates `public/lib/latex-templates.js` after `tex/` changes.
- `npm run sync:pdf-worker` stages the matching pdf.js worker after a dependency change.
- `npm run docs:capabilities` derives output/control tables from runtime configuration.
- `npm run docs:inventory` derives template/format/data and fixture totals.
- `npm run form-package -- schema docs/form-definition.schema.json` derives the external form schema from the runtime model.
- `npm run docs:check` checks generated documentation/schema drift, local links/anchors and documented JSON/example contracts.

The schema describes structure; `compileFormDefinition` additionally checks semantic references and geometry. The capability table describes operation availability, not engine readiness or regulatory certification.

Use [correspondence formatting](CORRESPONDENCE_FORMATTING.md) for selected rendering decisions, [contributor checks](CONTRIBUTING.md#testing) for validation and [update delivery](UPDATE_DELIVERY.md) for managed immutable artifacts.
