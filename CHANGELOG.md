# Changelog

Notable changes to DonDocs. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

Releases before 1.2.0 predate this file and are recorded only as git tags.

## [1.2.26] — 2026-07-04

### Changed

- One focus-ring geometry across the whole app. Buttons and badges added a 2px
  offset that every other control (inputs, selects, the custom header buttons,
  etc.) never used, so tabbing across the UI visibly changed the ring. Buttons
  and badges now use the same flush `ring-[3px]` as everything else.

## [1.2.25] — 2026-07-04

### Fixed

- Keyboard and touch access for three editor controls: the reference and
  enclosure drag handles now carry an accessible name and an explicit button
  type (they defaulted to form-submit); the "@" variable menu's "Create new
  variable" row now responds to Enter as its footer promises (not mouse only);
  and the reference-library "Add" button, previously invisible until hover, is
  now shown on touch devices and revealed on keyboard focus.

## [1.2.24] — 2026-07-04

### Changed

- Releases are now cut automatically. A GitHub release is created whenever the
  version in `package.json` is bumped on `main`, with notes drawn from that
  version's CHANGELOG entry — so tags, releases, and the changelog can no
  longer drift, and the published release still triggers the Docker image build.

## [1.2.23] — 2026-07-04

### Fixed

- The required "Unit Name" letterhead field now shows a red asterisk and,
  when validation flags it empty, a visible "Unit name is required" message
  wired to the input via `aria-describedby` — previously it only painted the
  invalid ring, leaving both sighted and screen-reader users without a remedy.

## [1.2.22] — 2026-07-04

### Fixed

- The dialog close (✕) button is now a 36px touch target (was 28px), so it
  clears the WCAG minimum comfortably on touch. The icon is unchanged; only
  the hit area grew.

## [1.2.21] — 2026-07-04

### Fixed

- The "compile failed" preview banner no longer covers the PDF viewer's own
  toolbar. It sat at the top of the content area, directly over the page,
  zoom, and fit controls; it now offsets below the toolbar so those controls
  stay usable while the banner is shown.

## [1.2.20] — 2026-07-04

### Added

- Backups now include each document's version history. "Back up all
  documents" and the synced auto-backup previously captured only the current
  state of every document — restoring on a new machine silently dropped the
  per-document undo/restore-an-earlier-version rings. The bundle now carries
  those snapshots (and any enclosure file a snapshot alone still references),
  and a restore merges them into any local history without ever dropping a
  snapshot you have taken since. Older backup files that predate this still
  restore cleanly.

## [1.2.19] — 2026-07-04

### Changed

- Hardened the storage pipeline's automated test coverage. Added regression
  tests for the durability probe's full state matrix, the corrupt-payload
  recovery stash, blocked/private-mode storage handling, the legacy-migration
  ledger, graceful attachment-persist failure, backup restore of legacy files,
  the restore-in-flight guard, malformed-backup tolerance, and the soft-delete
  undo window keeping enclosure attachments reachable. No behavior change —
  coverage only.

## [1.2.18] — 2026-07-04

### Fixed

- Enclosure file attachments no longer leak IndexedDB storage. Their bytes
  were written when you attached a file but never removed — deleting a
  document, replacing an enclosure's file, or removing an enclosure all left
  the old blob behind forever, quietly eating the storage quota this app
  warns you about when it runs low. A reachability sweep now reclaims any
  blob no longer reachable from a document, its version history, the open
  editor, or the just-attached-not-yet-saved state. It runs once at startup
  and after each document delete commits, aborts without touching anything
  if storage can't be fully read, and stands down during a backup restore —
  so it can never remove a blob a live document, an undo step, or a running
  backup still needs.

## [1.2.17] — 2026-07-04

### Changed

- Every message the app raises now appears in its own themed dialog instead
  of a native browser popup. `alert()`/`confirm()` follow the operating
  system's theme, not the app's — a white OS popup over a dark UI (the same
  class of bug as the old crash screen). All ten remaining native alerts
  (storage-full warnings, signature-size limits, import errors, in-app
  browser download instructions) and the profile-delete confirm were moved
  to an in-app alert dialog, and a lint rule keeps native popups from
  coming back.

## [1.2.16] — 2026-07-04

### Added

- The PDF preview is fully keyboard-accessible. Keyboard users could reach
  its toolbar but never scroll or navigate the document itself; the viewer
  is now focusable with arrow keys to scroll, Page Up/Down to change pages,
  Home/End for first/last page, `+`/`-` to zoom, and `0` to fit the width —
  plus Ctrl/⌘ + scroll (and trackpad pinch) to zoom, matching every desktop
  PDF reader.

## [1.2.15] — 2026-07-03

### Added

- Phones finally get the getting-started checklist. It was desktop-only —
  the floating launcher collides with the mobile Preview button, so mobile
  hid it entirely and the menu's "Getting started" item silently did
  nothing. On mobile it now opens as a bottom sheet with the same steps
  (tour, profile, first document, back up, install, power features),
  closing itself when a step opens its surface.

## [1.2.14] — 2026-07-03

### Fixed

- On phones, the bottom controls (Preview PDF, Recents) no longer sit partly
  under the browser's own toolbar: the app shell now sizes to the *visible*
  viewport (`100dvh`, with a fallback for older browsers) instead of the
  full 100vh that mobile browser chrome overlaps.
- The full-screen mobile PDF preview now respects notched phones: its
  header (title, Download, Logs, Close) pads below the status bar / dynamic
  island, and its bottom edge clears the home indicator — previously both
  rendered underneath in an installed app.

## [1.2.13] — 2026-07-03

### Fixed

- Readability failures on the labels that matter most: the TOP SECRET and
  TOP SECRET//SCI classification labels (2.3:1 and 3.0:1 against a light
  card — both WCAG AA failures) and the NIST modal's "Development Domain"
  warning heading (2.9:1) now use darkened text that clears 4.5:1, while the
  bright banner colors remain for fills. The labels on "Reset Everything" /
  "Discard Changes" confirm buttons rendered near-black on dark red because
  their text token was never defined; it now resolves to white (12.5:1).
- One focus ring everywhere: 28 controls drew a thinner 2px keyboard-focus
  ring than the app's 3px standard (so tabbing visibly changed the ring),
  one drew an amber ring, and three icon buttons had no ring at all.
- Cards and every dialog now use the app's navy-tinted elevation instead of
  bespoke pure-black shadows that read as grey smudges on the light canvas.
- Status greens and warning ambers are driven by semantic theme tokens
  (`--success` was defined but never wired; `--warning` didn't exist), so
  they stay consistent across all color schemes.

## [1.2.12] — 2026-07-03

### Added

- DonDocs can now invite you to install it. Installing was always possible
  but the app never offered: Help (and the mobile menu) gain an
  **"Install app"** entry, a slim dismissible strip suggests installing where
  it's actually possible (never a dead button — snoozes for two weeks, gone
  forever once installed), and the getting-started checklist gains an
  "Install the app" step. On Chrome/Edge the native install dialog opens
  directly; everywhere else a short guide shows the exact steps for the
  device — including iOS's Share → Add to Home Screen, which Safari never
  offers on its own. The Android install splash now matches the app canvas
  instead of flashing white. Everything is on-device; no network calls.

## [1.2.11] — 2026-07-03

### Added

- Proper install icons on every platform, all derived from one source. iOS
  Add-to-Home-Screen previously produced a degraded icon (no
  `apple-touch-icon`, no Apple meta tags), and the Android/Chromium manifest
  reused the raw SVG for its maskable slot, so circular launcher masks could
  crop the emblem. The build now rasterizes `icon.svg` into the Apple
  home-screen icon, 192/512 PNG icons, and a dedicated safe-zone maskable
  icon — one canonical image, so the installed-app icon can never drift from
  the brand mark. The installed-PWA title bar color now matches the app
  canvas instead of a stale navy.

## [1.2.10] — 2026-07-03

### Fixed

- The crash-recovery screen ("Something went wrong") now follows the app's
  light/dark scheme instead of always rendering a bright white page — it
  still uses only inline styles (so it works even when a CSS regression is
  what crashed), but reads the active scheme off the document. Its
  "Reset and reload" confirmation is now an in-app inline prompt instead of
  the browser's native dialog, which followed the OS theme rather than the
  app's.

## [1.2.9] — 2026-07-03

### Added

- Backup is now taught, not just available. The full-account backup shipped
  over the last releases was buried in a dropdown with nothing pointing at
  it. Now: the guided tour gains a "Back up everything" step; the Document
  Guide's Features tab gains a backup card with a "Walk me through it"
  spotlight of the real controls; the getting-started checklist gains a
  "Back up your work" step (completed by an actual backup — a downloaded
  bundle or a connected auto-backup); and the passive save indicator shows a
  persistent "Backed up" segment whenever the synced auto-backup is live, so
  you can see at a glance that your work is mirrored outside the browser.

## [1.2.8] — 2026-07-03

### Fixed

- The synced auto-backup file (Chromium desktop) was still docs-only. While
  the manual **"Back up everything"** download became a full-account bundle,
  the file that auto-mirrors after every save kept writing just documents — so
  anyone relying on it for cross-machine backup still lost profiles and
  signatures, snippets, user templates, in-progress NAVMC form fields, and
  enclosure files on restore. The mirror now writes the same complete
  `dondocs-backup` bundle, so a restore from it brings back everything. A
  failed account read still skips the write, so an incomplete bundle can't
  overwrite a good backup file.

## [1.2.7] — 2026-07-03

### Added

- Enclosure attachments now persist. The PDF you attach to an enclosure used
  to live only in memory on the open document — a reload dropped it (you had
  to re-attach) and a full backup couldn't carry it. Attached files are now
  stored in a new IndexedDB `attachments` store, streamed back into the
  document on load, and embedded in the **"Back up everything"** bundle, so a
  restore on another machine brings the enclosure files back too. Restore adds
  only attachments the local database doesn't already have, so re-importing a
  backup never duplicates data. The IndexedDB schema bumps to v2 with a purely
  additive upgrade (existing documents are untouched).

## [1.2.6] — 2026-07-03

### Fixed

- "Back up all documents" was silently incomplete: it saved only your
  documents, so restoring a backup on another machine lost your profiles
  and saved signatures, snippets, user templates, and in-progress NAVMC
  form fields — each lives in its own store. The action (now **"Back up
  everything"**) writes a full-account bundle covering all of them, and
  restore merges non-destructively so re-importing an older backup can't
  overwrite newer local work. Legacy documents-only backup files still
  restore.

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
