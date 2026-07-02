# Changelog

Notable changes to DonDocs. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

Releases before 1.2.0 predate this file and are recorded only as git tags.

## [1.2.5] — 2026-07-02

### Fixed

- DOCX export now works on a genuinely air-gapped network. The pandoc
  engine (WASI shim + 56 MB WASM binary) was fetched from public CDNs at
  runtime — fine with a warm cache, a hard failure on isolated networks
  with a cold one, despite the app's air-gap promise. Both assets are now
  vendored same-origin at build time; the binary ships as sub-25 MiB parts
  (the hosting platform's per-file limit) reassembled in the browser.

### Added

- A build guard (`check-no-cdn`) that fails CI if any shipped asset
  references a public CDN, so the air-gap capability can't silently
  regress.

## [1.2.4] — 2026-07-01

### Fixed

- Synced backup now says when it's paused. Browsers revoke a file's write
  permission every time the app fully closes, so auto-backup silently
  stopped after each restart until you reopened the Save menu — a returning
  user had no way to know their backup wasn't current. A dismissible strip
  now appears when the backup needs reconnecting (or a write failed), with a
  one-click Reconnect (or Choose file) action.

## [1.2.3] — 2026-07-01

### Fixed

- Memorandum For (mf) documents can finally address someone: the editor
  gains a required "Memorandum For" field (with unit lookup) that fills the
  `MEMORANDUM FOR [addressee]` title line, which previously always rendered
  blank because no field wrote it. Guarded by an integration test that
  compiles a real document and checks the line in the output.

## [1.2.2] — 2026-07-01

### Security

- Overrode the transitive `qs` dependency to 6.15.3
  (GHSA-q8mj-m7cp-5q26, moderate DoS). The vulnerable copy lived only in a
  dev-tool chain (`@stryker-mutator/core` → `typed-rest-client`) and never
  shipped in the app; the repository now has zero open advisories of any
  severity.

## [1.2.1] — 2026-07-01

### Changed

- **One PDF viewer everywhere** — the desktop preview drops the browser's
  iframe viewer and mobile drops its per-platform split; every surface renders
  through a shared in-app viewer with zoom, fit-width and fit-page modes,
  page navigation with direct page entry, a collapsible thumbnail rail on
  multi-page documents, fullscreen, and an open-in-tab escape hatch.
  Recompiles swap in place: the old page stays visible while the new one
  renders, then dissolves — no white flash, no scroll jump.

### Removed

- `@react-pdf-viewer` (all five packages) and its CDN-hosted pdf.js 3.x
  worker. This closes the 21 high-severity audit advisories
  (CVE-2024-4367) that CI previously carried an explicit allowlist for —
  `npm audit --audit-level=high` now gates with zero exceptions, and a new CI
  check keeps the vendored pdf.js worker in lockstep with the installed
  library.

## [1.2.0] — 2026-07-01

The editor becomes a multi-document workspace. Existing data migrates in
place on first load; no action required.

### Added

- **Multi-document workspace** — every document autosaves to a Recents list
  (sidebar) with full-text search, pin, rename, duplicate, and delete with
  undo. Documents survive reloads and browser restarts, backed by a
  per-document IndexedDB registry ([docs/STORAGE.md](docs/STORAGE.md)).
- **Block paragraph editor** — body paragraphs as keyboard-driven blocks:
  Enter splits, Backspace merges, Tab/Shift+Tab indent within SECNAV nesting
  rules, drag reorder moves sub-paragraphs with their parent, inline
  bold/italic/underline, per-paragraph portion markings, and an `@` menu for
  variables and cross-references. Pasting a Word/Outlook draft splits it into
  real paragraphs.
- **Command palette** (`Ctrl+K` / `Cmd+K`) — search every action and open
  document.
- **Version history** — per-document snapshots (as you edit and on each Save)
  with restore; restoring first snapshots the current state so it is
  reversible.
- **Library backup** — export all saved documents to one JSON file and
  restore later (the newer copy of a document always wins). On Chromium
  desktop, a synced backup file auto-mirrors the library after every save.
- **User templates and clause library** — save any document as a reusable
  template; save and insert reusable body paragraphs.
- **Endorsement inheritance** — base an endorsement on a saved letter:
  composes the basic-letter reference line and carries subject, references,
  and enclosures forward.
- **Unit lookup for To/Via** — insert an expanded unit name from the
  directory directly into addressing fields.
- **NAVMC form persistence** — form field data survives reload and is
  included in draft export/import.
- **Pre-share PII scan** — share links are checked for SSN/EDIPI/PII before
  they leave the device, including paragraph headings, distribution lines,
  and enclosure titles.
- **Storage health notice** — a dismissible strip when the browser blocks
  storage, may evict it, or the saved library cannot be read.
- **Document readiness meter** — one shared completeness rule with a jump to
  the first incomplete section.

### Changed

- Honest save signals: the indicator reflects the real write result
  (IndexedDB commit for correspondence, verified localStorage write for
  forms) instead of claiming "Saved" optimistically; `Ctrl+S` forces a real
  save.
- Legacy FOUO portion markings migrate to CUI on load, per DoDI 5200.48;
  FOUO is no longer offered in the marking palette.
- Design system pass: neutral chrome with a single brand accent across all
  color schemes, cross-platform shortcut labels, unified tooltips,
  transitions, focus rings, and modal scrim; self-hosted Geist with no
  first-paint font flash.
- Compliant mode keeps the font-size picker (10/11/12pt are all
  regulation-permitted).
- The offline app shell cache is versioned per build, so a stale shell can
  never load against newer assets after a service-worker update.

### Fixed

- Storage integrity: a failed IndexedDB read is no longer mistaken for an
  empty library — previously it could overwrite a good backup file with an
  empty one, download an empty "Backed up!" export, show a blank Recents, or
  let an old import overwrite newer work.
- Version restore could permanently lose up to ~3 minutes of edits when its
  safety snapshot raced the save checkpoint; snapshot writes are now atomic
  and the safety copy must commit before anything is overwritten.
- An idle tab could overwrite another tab's newer save of the same document
  on close; it now flushes only its own edits.
- A partially failed storage migration retries exactly the missing records on
  the next load instead of stranding them, and documents deleted in between
  do not resurrect.
- Deleted documents no longer reappear after closing the tab during the undo
  window.
- Profile signature images were lost on resume or profile switch.
- The block editor no longer traps keyboard focus (Tab) in document types
  without paragraph numbering.
- Saving a profile, template, or clause with browser storage full warns
  instead of silently discarding the data; corrupt saved data is preserved
  under a recovery key instead of being overwritten.
- Command palette: focus stays trapped in the dialog and arrow-key selection
  is announced to screen readers.
- A share link whose clipboard copy fails no longer reports the link itself
  as failed.
