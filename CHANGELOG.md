# Changelog

Notable changes to DonDocs. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

Releases before 1.2.0 predate this file and are recorded only as git tags.

## [1.2.139] — 2026-08-10

### Added

- **An endpoint check, under the menu.** Enter an address and it sends one
  request from the browser and reports what came back, in the page rather than
  the console. It separates the two problems that look identical from
  JavaScript: an endpoint that answered but would not let the browser read the
  response, and one that never answered at all. An address that is dropped
  rather than refused gives up after fifteen seconds and says so, instead of
  waiting forever. The address is typed in, not built in, and nothing it is
  given is stored: closing the dialog ends the run and takes the token with it.

## [1.2.138] — 2026-08-10

### Fixed

- **A drag that ends off-screen no longer leaves the app stuck.** Release the
  mouse outside the window while dragging the sidebar's edge, the split between
  the outline and Recents, or the preview divider, and the page never heard
  about it: the panel went on following the cursor with no button held, behind
  an invisible layer that swallowed every click until you clicked again. The
  same applied when the browser took the gesture over, which is how a touch
  drag ends when it turns into a scroll.

## [1.2.137] — 2026-08-10

### Added

- **The sidebar's two halves can be resized against each other.** Drag the line
  between the section outline and Recents, the way you already drag the
  sidebar's outer edge; arrow keys move it too, and double-clicking puts it back
  to fitting the outline's content. The position is remembered.

### Fixed

- **A short window no longer squeezes Recents out of existence.** The outline
  took its content height and never gave any of it back, so everything the
  window lost came out of Recents — at a 500px-tall window that left it 40px,
  with its search box below the bottom edge. The outline now scrolls and is
  capped so Recents always keeps enough room for its header, search and a row.
- **Double-clicking a sidebar divider resets it.** The width handle has offered
  this since it was added, but it never fired: the handle suppressed the mouse
  events a double-click is built from, and the drag overlay swallowed the rest.

## [1.2.136] — 2026-08-10

### Fixed

- **The New button no longer gets squeezed off the Recents header.** The
  sidebar's width is set in pixels but the row inside it is sized in text, so
  turning up the browser's font size — or narrowing the sidebar — grew the row
  inside a box that stayed put, and the New button, being last, was the part
  that ran off the edge. It now gives way in order: the word "New" drops to
  leave the plus on its own, and past that the controls take their own line.
  The heading no longer truncates and nothing is cut off.

## [1.2.135] — 2026-08-09

### Fixed

- **The preview toolbar no longer cuts off its own buttons.** On a 1280-wide
  screen with the preview at its default width, Fullscreen, Download PDF and
  Open in browser tab were clipped off the right edge — not scrolled, hidden,
  with nothing to say they existed. Download has a copy in the header, but the
  other two had no other route anywhere in the app. Every common laptop width
  was affected. Those three and the two fit-mode buttons now collapse into a
  single overflow menu when the preview is narrow, and sit out in the open when
  there is room for them; the zoom percentage yields first, as it did before.

## [1.2.134] — 2026-08-09

### Changed

- **The sidebar resizes.** It was a fixed 248px — a fifth of a 1280px screen,
  whether you were reading the section outline or not — and the only alternative
  was collapsing it to an icon rail that dropped both the outline and Recents.
  Drag its right edge to any width between 200 and 420px; the width is
  remembered like the preview panel's. Dragging past the low end snaps to the
  rail and dragging back out restores the width you had, so collapsing is part
  of the same gesture rather than a separate mode. Double-click resets it, and
  the arrow keys move it 16px at a time.

## [1.2.133] — 2026-08-09

### Fixed

- **A dollar sign no longer disappears from the Word export.** `$` was escaped
  as `{\char36}` everywhere except body text — a form carried over from the PDF
  generator, where it works around a font-encoding limit. Pandoc does not
  understand it and drops it, so `FY25 $5M BUDGET REQUEST` in a subject line,
  reference or enclosure title reached Word as `FY25 5M BUDGET REQUEST`. The PDF
  was always correct, and nothing reported an error.

## [1.2.132] — 2026-08-09

### Fixed

- **Typing `ZZZTEXTBACKSLASHZZZ` no longer produces a backslash.** The DOCX
  escaping pass used placeholder strings to stop a replacement being escaped a
  second time, and those placeholders were themselves typeable. Each special
  character is now rewritten in a single pass, so no placeholder is needed and
  the ordering hazard that produced the `\{}` bug in 1.2.131 cannot recur.
  Output is byte-for-byte unchanged for every other input.

## [1.2.131] — 2026-08-09

### Fixed

- **A backslash in your text now survives into Word.** A Windows path in body
  text — `C:\Users\smith\budget.xlsx` — arrived as `C:\{}Users\{}smith\{}…`. The
  escaping pass replaced `\` first and then escaped braces, catching the braces
  its own replacement had just added. The document opened without complaint, so
  the only sign was the wrong text on the page.
- **An enclosure titled with a path no longer kills the PDF.** The same
  backslash reached a template macro that expanded its argument, and expanding
  `\textbackslash` ran away until TeX exhausted its input stack — no PDF at all,
  just `TeX capacity exceeded`. The title is bound without expansion now.

## [1.2.129] — 2026-08-08

### Added

- **Headless rendering.** A local companion service renders correspondence from
  JSON, so a script or an agent on the same machine can produce a naval letter,
  standard letter or memorandum as PDF or DOCX without opening a browser. It runs
  the same generator the app does — the document rules live behind a `LatexEngine`
  port that the browser satisfies with its WASM worker and the companion with a
  Node worker thread, so there is no second implementation to drift.

  Two front doors: `npm run companion` serves HTTP on `127.0.0.1:7712`, and
  `npm run companion:mcp` speaks MCP over stdio for clients that prefer it. Both
  share one render step and one set of validation rules. Output is written under
  `~/Documents/DonDocs` by default and the service answers with a path rather than
  the document. See [docs/COMPANION.md](docs/COMPANION.md).

  Nothing in the app changes: the companion is developer tooling, its dependencies
  are dev-only, and none of it ships in the PWA bundle.

## [1.2.130] — 2026-08-09

- **The originator's code now appears on the letter.** The office code was
  collected in the editor — with a lookup modal — stored, and then never printed:
  no generator code and no template referenced it. It renders in the sender's
  symbols block now, where SECNAV M-5216.5 Ch 7 ¶2a(2) puts it: fused with the
  serial as `Ser Code 13/271`, or alone under the SSIC when there is no serial.
- **A serial number is prefixed with `Ser`.** A bare `001` used to sit under the
  SSIC; the manual's examples are `Ser 02/318`, `Ser N00J/S20`, `Ser Code 13/271`.
  The office code prints exactly as your activity writes it — ¶2a(2) leaves its
  makeup to the command — so an activity using `Code 13` enters `Code 13`. A
  serial already typed as `Ser 12/001` is left as the author wrote it.

## [1.2.128] — 2026-08-08

### Fixed

- **A word with an underscore no longer breaks the PDF.** `user_id`,
  `report_final.docx`, `first_last@usmc.mil` — anything with a single underscore
  in a body paragraph failed to export, with no PDF produced. Underscores are
  left alone during escaping because `__text__` is the underline marker, but
  only the paired form is a marker; a lone one reached LaTeX raw, opened math
  mode, and killed the compile. `__underline__` and fill-in rules like
  `Signature: __________` are unaffected. Word exports were never affected.

## [1.2.127] — 2026-08-06

### Added

- **Downloading a letter with paragraph-structure findings asks first.** The
  Ch 7 ¶13/¶13d findings already sat under the paragraph editor; they now also
  appear when you hit Download, which is the moment that reliably has your
  attention. It is a confirmation, not a gate — "Download anyway" is right
  there, because a lone subparagraph is what a work-in-progress looks like and
  drafts get circulated for comment all the time. Runs ahead of the PII check
  so the privacy warning stays the last thing seen, and covers both the PDF and
  the Word export.

## [1.2.126] — 2026-08-06

### Added

- **The editor flags two paragraph-structure rules it used to let through.**
  SECNAV M-5216.5 Ch 7 ¶13 requires a second subparagraph wherever there is a
  first ("if there is a paragraph 1a, there must be a paragraph 1b"), and ¶13d
  asks for headings to be consistent across siblings. Neither was checked, so a
  letter with a lone 1a, or with a heading on 1a but not 1b, exported without
  comment. The check reads the paragraph model rather than either export, so it
  covers the PDF and the Word document alike, and it sits under the paragraph
  editor as an advisory notice — it never blocks an export.

## [1.2.125] — 2026-08-06

### Fixed

- **"Copy to:" and "Distribution:" addressees now sit at the left margin.**
  SECNAV M-5216.5 Ch 7 ¶15c lists them "in a single column at the left margin
  and single spaced below" the label line, and the manual renders a Copy to
  block that way five times in Ch 7. Both exports built a two-column table, so
  the first addressee sat beside the label instead of below it, and every one
  of them was 47pt in from the margin. Applies to the PDF and the Word export.

## [1.2.124] — 2026-08-05

### Fixed

- **A subparagraph now lines up under the paragraph above it.** SECNAV
  M-5216.5 Figure 7-8 says to "indent each new subdivision to align with the
  first letter of the paragraph above", so the step is the width of the
  parent's label, not a constant. We used a flat 0.25in, which at Courier 12pt
  put the first level three character cells in where the figure puts it seven,
  and drifted further with every level. Each label now starts within 0.1pt of
  its parent's text, in both fonts and both exports.
- **The PDF and the Word export print the same gap after a paragraph label.**
  LaTeX collapsed the PDF's two spaces into one while Word emitted two, so the
  same document came out differently spaced in each.

## [1.2.123] — 2026-08-05

### Fixed

- **An acronym in a paragraph heading keeps its capitals.** Headings were
  lowercased after each word's first letter, so "TCCOR" printed as "Tccor",
  "1st MarDiv" as "1st Mardiv" and "MedEvac" as "Medevac". MCO 5216.20B Ch 13
  ¶5b keeps an acronym in capitals, and SECNAV M-5216.5 Ch 7 ¶13d asks only
  that key words be capitalized. This covers an acronym that happens to spell
  a small word, so "AT" and "SO" no longer come out as "at" and "so" either.
  Ordinary headings are still Title Cased. Applies to the PDF and the Word
  export.
- **The Word export no longer deletes punctuation from a heading.** It stripped
  every bracket, comma, colon and slash, so "Roles, Duties, and Limits" lost
  its commas and "Commander/Commanding Officer" arrived welded together, while
  the PDF kept both. Only a period the author typed at the end is dropped, the
  same as the PDF does.

## [1.2.122] — 2026-08-05

### Fixed

- **A paragraph heading with no text after it no longer gets a period.** A
  heading that stands alone over its subparagraphs printed as "1. Format."
  where it should read "1. Format" — the period belongs to the sentence the
  heading introduces. SECNAV M-5216.5 Ch 7 sets 69 of its own 75 standalone
  headings bare. Applies to the PDF and the Word export.
- **A period typed into the heading field no longer doubles up.** The PDF kept
  the author's period and added its own, so "Format." printed as "Format..".

## [1.2.121] — 2026-08-04

### Fixed

- **A long reference or enclosure now wraps under its own text.** Titles too
  long for one line used to continue at the "(a)" column — the column that
  starts a *new* entry, so a continuation read as one. SECNAV M-5216.5 Ch 7
  ¶10c lines the second line up "under the first word after the heading", and
  Figure 7-1 shows both lists that way. Applies to the reference list and the
  enclosure list, in the PDF and the Word export.

## [1.2.120] — 2026-08-04

### Fixed

- **Subparagraphs get a full blank line before them, like every other
  paragraph.** They were opening on half a line, so lettered and numbered
  subparagraphs ran together on the page. SECNAV M-5216.5 Ch 7 ¶13 makes no
  distinction — "each paragraph or subparagraph begins on the second line below
  the previous paragraph or subparagraph" — and Figure 7-8 prints a hard return
  between every pair it shows, down to (1)/(2). Applies to both the PDF and the
  Word export.

## [1.2.119] — 2026-08-03

### Changed

- **The save indicator now says whether your work has a copy outside this
  browser.** It reads "Local only" until an auto-backup is set up, and clicking
  it sets one up. Before, it only ever said "Saved", which reads as safe — and
  isn't, if the browser profile is wiped by something like an enterprise
  Windows update. On browsers that can't keep an auto-backup file (Safari,
  Firefox) it stays plain text and points at Download / Back up everything
  instead.

## [1.2.118] — 2026-08-03

### Fixed

- **A new-page endorsement no longer prints its subject over the seal.** With
  "show subject line on continuation pages" turned on, the subject was also
  appearing at the top of the endorsement's own first page, across the
  letterhead — on a sheet that already carries the real Subj: line in its
  address block. The page number stays where Ch 9 Figure 9-2 puts it: an
  endorsement continues the basic letter's sequence, so its first sheet is
  numbered, unlike a letter's.

## [1.2.117] — 2026-08-03

### Fixed

- **Word exports carry the subject line on continuation pages**, with a clear
  line between it and the text below, as Ch 7 ¶16 requires ("continue the text
  beginning on the second line below the subject") — matching the spacing the
  PDF already produced. SECNAV
  M-5216.5 Ch 7 ¶16 requires the subject to be repeated at the top of every page
  after the first. The PDF has always done this — gated on the "Show subject
  line on continuation pages" setting — but the Word export ignored the setting
  entirely. Memoranda and business letters get the "SUBJECT:" label their PDF
  uses; letters and endorsements get "Subj:".

- **Word exports are page numbered.** Ch 7 ¶17: no number on the first page of a
  letter, then centred half an inch from the bottom starting at 2. Word files
  had no page numbers at all. An endorsement continues the basic letter's
  sequence, so it starts at its own number and its first sheet is numbered too,
  per Ch 9 Figure 9-2.

## [1.2.116] — 2026-08-03

### Fixed

- **The SSIC, serial and date sit at the right margin in Word again.** They were
  landing in the middle of the page — the block was being laid out as if it were
  a signature block, which is centred, rather than the right-aligned
  identification block SECNAV M-5216.5 Ch 7 puts in the upper right. The PDF was
  always correct; only the Word export was affected.

## [1.2.115] — 2026-08-03

### Fixed

- **Subparagraphs indent only their first line.** Wrapped lines were being
  pushed right along with the first, so a subparagraph sat as an indented
  block. SECNAV M-5216.5 Ch 7 ¶13 is explicit: "All other lines of a
  subparagraph continue at the left margin. Do not indent the continuation
  lines of a subparagraph." Both the PDF and the Word export were wrong, in
  different ways. Business letters keep the block indent — Ch 11 has no
  equivalent rule.

- **Paragraph labels are underlined where the manual underlines them.** Figure
  7-8 runs the 1. / a. / (1) / (a) cycle twice and underlines the counter the
  second time through, on the numeral or letter only — never the period or the
  parentheses. The PDF underlined nothing; Word underlined whole labels,
  punctuation included. The two exports now agree with the figure and with each
  other.

- **Deep paragraph labels no longer print as LaTeX in Word.** A label below the
  fourth level came out as the literal characters `\uline{1.}` in front of the
  paragraph.

- **A line break above a bracketed line no longer breaks the PDF.** Pressing
  Enter on the line above text starting with "[" — which the starting body
  placeholder does — produced no PDF at all.

- **Paragraph letters continue past "z".** The 27th subparagraph at a lettered
  level was labelled "{", and beyond the 52nd the label became an invisible
  character. It now continues aa, ab, and so on.

## [1.2.114] — 2026-07-19

### Added

- **"Spell out on first use" check for letters and memos.** As you write a naval
  letter or memorandum, DonDocs flags any acronym used before it's defined and
  reminds you to spell it out with the acronym in parentheses the first time —
  "North Atlantic Treaty Organization (NATO)" — per SECNAV M-5216.5 ¶17c. It's
  advisory (never blocks), hidden when the body is clean, and skips the
  abbreviations a naval reader knows on sight (USMC, DoD, MCO, i.e., etc.). This
  is the correspondence counterpart to the recordkeeping-form abbreviations: on a
  letter the rule is to use acronyms sparingly and define them, not to compress.

### Fixed

- **Recovered the first entry of the IRAM abbreviation list.** The dataset was
  missing "abbreviation → abbr" — the list's opening row, which the importer had
  mistaken for a column heading. The recordkeeping forms now carry all 1,602
  authorized entries.

## [1.2.113] — 2026-07-19

### Added

- **Authorized abbreviations on the recordkeeping forms.** As you write a Page 11
  (NAVMC 118(11)) or Administrative Action (NAVMC 10274) entry, DonDocs shows the
  approved abbreviations from the IRAM (MCO P1070.12K, ch. 6) for the words in
  your text — "commanding officer → CO", "headquarters → hq" — and you apply one,
  or all of them, with a click. It's suggestion-only: nothing rewrites your entry
  on its own, and the helper stays hidden until a word in the field actually has
  an approved abbreviation. The ~1,600-entry list is bound to the order that
  governs it, so it appears only on those recordkeeping forms; other document
  types keep their own conventions.
- **"Did you mean?" for misspelled terms.** The abbreviation helper now also
  catches a likely typo of an approved word — "adminstrative", "corrspondence",
  "reconaissance" — and offers the correction with its abbreviation in one click.
  It is deliberately cautious: it only speaks up for a longer word that is a
  single typo away from exactly one approved term, and never touches an ordinary
  English word (or a slip of one), so a correctly spelled word is left alone.
## [1.2.112] — 2026-07-19

### Added

- **Routing help on the Administrative Action (NAVMC 10274) form.** The "7. To"
  field now offers a suggestion for where a package usually routes based on the
  action type — read from your "Nature of Action" text (e.g. dependents, pay,
  reenlistment, TAD, records correction) or picked from a list. Each suggestion
  names the typical section (IPAC / S-1 / Career Planner / a HQMC Manpower
  branch), cites the governing order to check, and one click drops it into the
  field. It is deliberately advisory — routing varies by command, so every
  suggestion is hedged ("IPAC, or your S-1") and reminds you to confirm with
  your unit SOP or S-1 before submitting. (Also corrects the field's placeholder,
  which described the wrong thing.)
- **Save your command's actual routing.** The bundled suggestions are
  doctrine-level; you can edit any one to your command's real routing (e.g.
  "IPAC Bldg 100, pay window 3") and it's remembered. Your overrides ride in the
  backup file, so an admin chief can configure the command's routing once and
  share the backup with the unit — every Marine then gets their command's real
  routing, not just doctrine.

### Changed

- **The command palette (⌘K) now matches on subsequences, not just substrings.**
  Typing an acronym like "nnl" finds "New Naval Letter"; the matched letters are
  highlighted in each result, and results are ranked by match quality (a
  start-of-word or prefix match beats a scattered one).

### Fixed

- A few design-token strays: the "Clear fields" confirm button now uses the
  shared warning color instead of a raw orange; two focus rings that were still
  the old 2px width match the app's 3px ring; and the paragraph editor's text
  caret is tinted to the brand color.

### Added

- **Import a letter from a PDF or Word document.** Save → "Import letter…" opens
  an existing letter and reads it back into the editor as a new document —
  the From/To/Via/Subj header, the SSIC / serial / date, the reference,
  enclosure, and copy-to lists, the numbered-paragraph tree, and the signer's
  name (multiple Via addressees import as separate lines, so the letter
  re-numbers them correctly). The old
  way to reuse a letter you only had as a file was to retype it; now it's a file
  pick and a review. The whole read happens in your browser — PDFs through the
  pdf.js already bundled for the preview, Word (.docx) files through the same
  pandoc engine that powers DOCX export — so nothing is uploaded and it's fine
  on NMCI/air-gapped networks. It's a best-effort parse: a review dialog shows
  every recognized field before anything is written, the letter opens as a new
  document so your current one is untouched, and you check the fields after.
  Text-based PDFs and .docx only — a scanned image has no text to read (that's a
  later feature). The file type is detected from its contents (magic bytes) as
  well as its name, so a Word document saved with the wrong extension still
  imports; and the header block of a real letterhead Word document — which the
  converter lays out as a table — is read correctly (From/To/Via/Subj and the
  SSIC/serial/date) rather than skipped.
- **The importer detects the document type.** It reads the file's text for the
  tell-tale opener — an endorsement line, "MEMORANDUM FOR THE RECORD",
  "MEMORANDUM OF AGREEMENT/UNDERSTANDING", or a From/To/Subj letter skeleton —
  and pre-selects the matching type in the review dialog. When the type is clear
  it says so; when it can't be sure (a bare "MEMORANDUM", or only partial
  addressing) it flags the guess and asks you to confirm from the full list of
  importable types before the letter opens.
- **The importer carries classification across.** When the source is marked, it
  reads the banner (UNCLASSIFIED / CUI / CONFIDENTIAL / SECRET / TOP SECRET /
  TOP SECRET//SCI — highest wins), the derivative-classification authority block
  ("Classified by / Derived from / Declassify on / Reason"), and the
  per-paragraph portion markings, and pre-sets the Classification section from
  them. For Word files the banner lives in the page header/footer, which the
  body read skips, so those parts are read directly from the .docx. Anything
  above Unclassified is called out in the review dialog with a reminder to
  verify the marking before you export; an unmarked file stays Unclassified.

## [1.2.109] — 2026-07-18

### Added

- The Classification section now **checks your markings against each other**.
  DonDocs renders the banner and per-paragraph portion marks; it now also
  validates that they agree, following the "highest classification wins" rule
  (DoDM 5200.01 for classified, DoDI 5200.48 / 32 CFR 2002 for CUI). The
  serious case it catches is **under-marking** — a paragraph marked higher than
  the document's banner (e.g. a (S) paragraph under a CONFIDENTIAL banner),
  flagged as an error because the overall marking must be at least the highest
  portion. It also warns on a classified/CUI document with no portion marks,
  on partial marking (some paragraphs marked and some not), on over-marking
  (a banner higher than every portion), and on mixing CUI with legacy FOUO.
  The findings appear inline in the section as you edit — advisory, never
  blocking — and are announced to screen readers.

## [1.2.108] — 2026-07-18

### Added

- The AA form (NAVMC 10274) now types its signature blocks for you — up to
  four, in signing order, because a counseling action carries more than one:
  the originator (whose block the form's own caption mandates — "type name of
  originator and sign 3 lines below text"), the counseled Marine's
  acknowledgement, and sometimes a witness. Each block takes an optional
  statement ("I acknowledge receipt…", "Witnessed:") printed above its signing
  space, with the typed name on the third line below. Users had to fake all of
  this by hand, tabbing across the supplemental-information box or editing the
  exported file — and tabs are normalized to spaces in a proportional font, so
  that alignment could never come out right. The originator's name fills from
  your profile in one click, and a signature block never splits across the
  page break: if it won't fit, the whole block (statement, signing space, and
  name) moves to the continuation page together.
- Each AA-form signature block now chooses how it signs — **Typed** name,
  **Image** (upload a scanned signature, drawn into the signing space), or
  **Digital** (an empty CAC-signable AcroForm field, signed later in Acrobat) —
  the same three-way choice the naval letter offers. Image and digital marks are
  placed by computed geometry, not a text search, and follow their block onto
  the continuation page so they can never be stranded away from the name. (The
  cryptographic CAC signature is applied in Acrobat; a browser cannot reach a
  CAC's private key.)
- The **NAVMC 118(11) / Page 11 (6105)** entry can now carry its signatures too.
  A counseling entry is authenticated by the counselor and the counseled Marine
  (MCO 1610.7 / IRAM); DonDocs appends signature blocks — typed, image, or
  digital — to the end of the remarks, with the acknowledgement wording yours to
  set and the counselor's name a one-click fill from your profile (as on the AA
  form). The form's three pre-printed "(Signature)" cells (Art 137, SBP) are
  left alone; these close the entry text, where a 6105's signatures actually go.
- Under the hood, both forms now share one signature model and one set of
  pdf-lib primitives, so the AA form and the 118(11) can't drift apart as
  signing grows.
- Adding a signature block is now role-aware on both forms: **Add signature…**
  offers Originator/Counselor, Marine acknowledgement, and Witness, each seeded
  with the right starting statement so the boilerplate is one click away instead
  of retyped. The wording stays fully editable — it's a starting point, not a
  locked value.
- On the AA form, signatures now live in their own **Signatures** section in the
  editor outline rather than buried at the bottom of Counseling Content, so the
  originator's block is where you'd look for it. (The 118(11) already had one.)
- Digital (CAC-signable) signature fields now carry the signer's name — a block
  for "R. L. SMITH" produces a field named for them instead of an anonymous
  "Signature 1", so Acrobat's signature panel and any downstream tooling can
  tell the counselor's field from the Marine's.
- Signature blocks on both forms can be **dragged to reorder** (grip handle,
  keyboard-operable like the References list). Order is the top-to-bottom
  signing/print order, so a counselor added after the fact no longer has to be
  deleted and re-added to sit above the Marine's acknowledgement — and on the
  AA form the block dragged to the top becomes the originator automatically.
- Signature presets now arrive with the typed name already filled where the app
  knows it: the counselor/originator from the active profile, and — on the
  118(11) — the Marine's acknowledgement from the Marine Identification fields
  the form already collects ("J. M. DOE"), instead of asking you to retype a
  name that's two sections up. Witness stays blank; the app can't guess who
  witnessed. All fills are editable.
- An empty Signatures section offers the standard counseling setup in one
  click — "Add originator/counselor + Marine acknowledgement" — which, with a
  profile and the Marine's name on file, produces a ready-to-export pair
  without typing.
- After adding a signature block, focus lands in the new block's first field —
  a preset pick flows straight into editing instead of leaving you to click
  into the card (the add-menu suppresses its own focus-return to make room).
- The 118(11) editor now shows how the entry **fits the printed page**: a live
  "≈ N of 37 printed lines" readout under each remarks column and a warning
  the moment text (or the closing date/signature blocks) runs past what the
  column can hold. The form is a single physical page — there is no
  continuation sheet — and previously anything past the cap was silently left
  off the exported PDF. The counts come from the generator's own font metrics
  and wrapping, so the warning and the printout can't disagree.
- The AA form's **From** and **Organization/Station** gained one-click "Use
  profile" fills — the originator's rank and name, and your own unit's
  name/address, straight from the active profile (the fields users retype most
  often). Both fills are explicit buttons, never written silently.

### Fixed

- The 118(11) remarks columns' line cap is now calibrated to the printed form:
  a rendered probe showed the old 40-line cap letting the last three lines
  print **on top of the NAME/EDIPI identification strip** at the bottom of the
  page. Each column now stops at 37 lines — the last line that clears the
  strip — and the new fit warning surfaces what didn't make it instead of
  dropping it silently.

### Changed

- Removing a signature block that holds a statement, name, or uploaded
  signature image now asks first — the same rule References and Enclosures
  follow — and on the AA form warns that the next block becomes the
  originator. An empty block still removes in one click.
- Signature drag handles grew a padded hit area for touch, and a small drag
  threshold keeps a touch-scroll that starts on a handle from becoming an
  accidental reorder.

### Fixed

- The AA form's "Proposed/Recommended Action" is no longer silently dropped
  from the PDF. The field was collected and saved but never rendered — the
  printed form has no box for it (its fields run 1–12) — so anything typed
  there vanished on export. It now closes block 12 as its own labeled
  paragraph.
- Removed a phantom "13." from that field's label (the printed form has no
  field 13) and a never-rendered, never-collected signature field from the
  6105 generator.

## [1.2.107] — 2026-07-18

### Fixed

- The unstyled-page flash on refresh now heals instantly instead of after
  seconds. When a stale service worker serves a shell whose stylesheet no
  longer exists, the boot watchdog previously waited 10 seconds before
  recovering; the failed stylesheet's own error event now triggers the same
  one-shot recovery the moment the failure lands. All guards carry over:
  only the app's own stylesheets count, a healthy styled session is never
  touched, offline clients are left alone, and recovery still can never loop.
- Attacked the root of the recurrence: the app now asks the browser for
  **persistent storage** once a user has saved documents. Persistence protects
  IndexedDB, Cache Storage, and the service-worker registration from
  disk-pressure eviction — the mechanism that strands an installed worker
  serving a shell whose assets were evicted, producing the
  broken-refresh-then-recover loop on affected machines. Chromium grants or
  denies silently; the storage-health notice now reflects the post-request
  state. A brand-new visitor with nothing to lose is never prompted.

## [1.2.106] — 2026-07-17

### Fixed

- Jumping to a section near the end of the editor outline (e.g. Distribution)
  now highlights that section, not the last one. The scroll-spy has a
  bottom-edge override that lights the final section once you reach the end of
  the form — but a short second-to-last section can't scroll any higher than
  the bottom, so clicking it in the outline snapped the highlight straight to
  the last section (Signature). A jump is now authoritative: the section you
  jumped to stays selected until you actually scroll — a later re-render or
  layout shift can't quietly re-fire the override and un-stick it — and the
  first real scroll (wheel, touch, or arrow key) resumes normal scroll-spying.

## [1.2.105] — 2026-07-17

### Fixed

- The boot watchdog now heals an *unstyled* shell, not just a blank one.
  Previously it treated "the JavaScript booted" as health — but a stale
  service worker can serve a poisoned stylesheet, so the app mounts and renders
  with no CSS (the white/unstyled page some users were stuck on). Booting is no
  longer sufficient: the watchdog also checks that the stylesheet actually
  applied (our `--background` token resolved), and when it hasn't, it now
  **unregisters the service worker** — the thing serving the bad CSS — before
  reloading, so the healing load fetches the current assets straight from the
  network. This runs inline in `index.html` (served fresh on every visit), so a
  currently-stuck client self-heals on its next load with no cache-clearing or
  DevTools needed. It still runs at most once per distinct shell (never loops),
  never touches saved documents (IndexedDB/localStorage), and leaves offline
  clients alone.

## [1.2.104] — 2026-07-16

### Fixed

- Missing files now return a real 404 instead of the app shell. The Pages
  deployment served 200 + index.html for every missing path — including hashed
  bundles an update had replaced — and the request-path header rules stamped
  that HTML with "cache for a year, immutable". A browser that asked for a
  just-rotated stylesheet cached HTML in its place and rendered the app
  unstyled until a hard refresh. A top-level 404.html switches Pages to real
  404s, matching the Docker/Workers deployments.
- The service worker can no longer cache a non-200 response as the app shell
  (error pages, redirect bodies, and opaque responses are rejected). The
  stale-shell-via-HTTP-cache vector itself is closed at the origin — "/" is
  served no-cache, so a cached shell has zero freshness and must revalidate
  before it can satisfy the service worker's fetch. (A no-store fetch option
  on the navigation rule was considered and rejected: workbox silently drops
  fetchOptions for navigation requests, so it would compile in and do
  nothing.)
- The boot watchdog now retries once per distinct broken shell rather than
  once per tab session, so a tab can self-heal again when the first recovery
  didn't stick, and still can never loop.

## [1.2.103] — 2026-07-16

### Fixed

- The PDF now numbers via addressees. SECNAV M-5216.5 Ch 9 ¶2: one remaining
  via addressee is not numbered; two or more are numbered "(1)", "(2)", … The
  DOCX export always did this; the PDF templates rendered the lines verbatim.
  Numbering now happens once, in a helper both exports share.
- The exported DOCX of a same-page endorsement carries its serial and date,
  right-aligned between the separating rule and the endorsement line, as the
  PDF already did (Ch 9 Fig 9-1: "Ser 019/870" / "23 Apr 15").
- "Base on a saved letter" no longer copies the letter's references and
  enclosures into the endorsement — Ch 9 ¶3-4: "Do not repeat a reference …
  already … identified in the reference line of the basic letter"; sequences
  are continued instead. Autofill now sets "First reference" / "First
  enclosure" just past the source's last item (refs a-c → d, 5 enclosures →
  6), leaving any start you already typed alone.

## [1.2.102] — 2026-07-16

### Fixed

- Endorsement pages now genuinely continue the basic letter's sequence
  (SECNAV M-5216.5 Ch 9, Fig 9-2: "Number each page of your endorsement and
  continue the sequence of numbers from ... the basic letter"). "First page
  number" was a dead field in PDF export — the generator never emitted it and
  the template had no counter to receive it — and the Word export suppressed
  the continued number on the endorsement's own sheet, where Fig 9-2 prints
  it. Uploading a basic letter now also defaults the field from the letter's
  page count instead of discarding it.

## [1.2.101] — 2026-07-16

### Added

- An endorsement can now be assembled onto the basic letter it endorses. Upload
  the letter's PDF in the Basic Letter section of a new-page endorsement, and the
  exported PDF is the letter followed by your endorsement — a new-page
  endorsement continues the basic letter's page numbers (SECNAV M-5216.5 Ch 9),
  so the letter reads first. The preview shows the assembled document, and the
  uploaded letter is stored like an enclosure — it survives a reload and rides
  along in a backup.
- New-page assembly only, by design: Ch 9 ¶1 makes a new-page endorsement always
  valid, and DonDocs does not overlay text onto the signature page of a letter it
  did not generate. PDF export only — the Word file contains the endorsement
  alone.

## [1.2.100] — 2026-07-16

### Fixed

- Endorsements now number their paragraphs, and their editor offers paragraph
  labels, Tab to indent, and subparagraphs like any other letter. Both same-page
  and new-page endorsements rendered their bodies unnumbered, against SECNAV
  M-5216.5 Ch 7 ¶13a ("Identify all paragraphs or subparagraphs with a number or
  letter"), to which Ch 9 states no exception — Fig 9-1 numbers its body even
  though it is a single paragraph, and Fig 9-2 numbers "1." and "2.". Ch 9's
  "continue the sequence" language, which had been read as a paragraph rule,
  never is: it governs references (letters), enclosures (numbers), and page
  numbers.
  **If you render endorsements, their paragraphs will now be numbered.**

## [1.2.99] — 2026-07-16

### Added

- An appointment letter can now carry the appointee's acknowledgement on the
  same sheet: you sign the top, a rule divides the page, and the appointee
  endorses back below it. Tick "Add an acknowledgement endorsement" in the
  Signature section of a naval letter or standard letter. The
  From/To lines invert the letter automatically, so the common case needs no
  typing beyond the acknowledgement text and the appointee's name.
- Previously the endorsement could only be produced as its own separate
  document, which is not what an appointment letter looks like in practice
  (SECNAV M-5216.5 Ch 9, Fig 9-1).

### Fixed

- The acknowledgement carries its own date line. Ch 9 ¶2.1a starts the
  endorsement line "on the second line below the date line", and the relief a
  same-page endorsement gets is limited to the SSIC, subject, and the basic
  letter's identification symbols — not the date, which Fig 9-1 shows. The date
  and serial are optional and blank by default, printing the line for the
  appointee to hand-date at signature.
- The rendered-PDF tests (`by-direction-render`) were skipping in CI rather than
  running: the compile-matrix job installs texlive and pandoc but never
  installed poppler-utils, and the tests skip themselves when `pdftotext` is
  absent. CI now installs poppler-utils, and the suites fail rather than skip
  when the toolchain is missing, so a skip can no longer be mistaken for a pass.

## [1.2.98] — 2026-07-16

### Added

- An "Appointment Acknowledgement (Endorsement)" template — the appointee's
  half of an appointment, endorsing back to the appointing officer that they
  have read the references and assume the duties. It pairs with the existing
  "Appointment to Collateral Duty" letter, which had no acknowledgement to go
  with it. The duty title and unit are placeholders and no program's orders are
  baked in, so the same template serves any collateral duty.
- This is the first template that isn't a naval letter; loading it switches the
  document type to a same-page endorsement.

## [1.2.97] — 2026-07-16

### Added

- A security policy (`SECURITY.md`) covering private vulnerability reporting,
  what is and isn't in scope, and what the project does not promise.
- A CycloneDX SBOM of production dependencies, generated on every CI run
  (`npm run sbom`) and kept as a build artifact for 90 days.

### Changed

- The package is named `dondocs` rather than the `web-react` scaffold default,
  so the SBOM identifies the software it describes.

## [1.2.96] — 2026-07-16

### Fixed

- The SSIC lookup now searches all 2,240 codes instead of 129. The full
  SECNAV M-5210.2 code list already shipped in the app but nothing imported it,
  so the lookup only ever rendered a small hand-maintained subset — searching a
  real code such as 11013 or 3120 returned nothing at all.
- Corrected three SSIC major-group names. The hand-maintained list omitted
  General Material (10000), which shifted every group above it down by one:
  Facilities and Activities was filed under 10000, Civilian Personnel under
  11000, and an invented "Science and Technology" filled 12000. Groups are now
  named to match the codes actually filed under them, and the four groups that
  had no category at all (13000 Aeronautical, plus Ships, Combat Service
  Support, and Civil Affairs) are reachable.
- Searching now expands the groups that contain matches, rather than leaving
  hits hidden behind collapsed headings.

## [1.2.95] — 2026-07-16

### Fixed

- The app now self-heals from a stale app shell instead of white-screening.
  After a deploy, a cached `index.html` can point at hashed bundles that no
  longer exist — the service worker's network-first navigation fetch can be
  satisfied by the browser's HTTP cache and then store that stale shell in its
  own runtime cache, so every new tab white-screened until a hard refresh. A
  boot watchdog in the shell now detects that the app never started and, once
  per session, drops the shell caches, re-fetches the page past the HTTP
  cache, and reloads. Offline launches are left untouched, and deploying this
  release automatically abandons any already-poisoned shell cache.

## [1.2.94] — 2026-07-06

### Added

- Endorsements can now say where they pick up. An endorsement continues the
  basic letter's numbering rather than opening its own (SECNAV M-5216.5 Ch 9
  ¶3) — if the basic letter ran to reference (f), the endorsement starts at
  (g) — but DonDocs restarted every sequence from scratch: page 1, reference
  (a), enclosure (1). The basic letter is a separate document the app cannot
  read, so a "Continues from the basic letter" group on endorsement document
  types takes the first page number, first reference letter, and first
  enclosure number. The starting page number was already honored by the
  generator but had no control to set it.

  The continuation applies to endorsements only, so a value left behind after
  switching document type can never silently offset a basic letter's sequence.

## [1.2.93] — 2026-07-06

### Fixed

- The "By direction" signature block now reads "By direction" instead of
  "By direction of the Commanding Officer". Per SECNAV M-5216.5 Ch 7
  ¶14b(4)-(5) the bare form is the norm; the "of the <activity head>" long
  form is reserved for correspondence affecting pay and allowances. Both the
  PDF and DOCX paths hardcoded the long form with a "the Commanding Officer"
  fallback, so every by-direction letter carried it. The Authority field is
  now optional and only adds the long form when a name is entered.

## [1.2.92] — 2026-07-06

### Fixed

- New builds now reach open sessions reliably. The service worker and the HTML
  entry are the two files that tell a running app a newer version exists, but
  they had no cache rule, so a CDN- or browser-cached copy could hide new
  releases — leaving people on stale UI until a manual hard-refresh. They're now
  served `no-cache, must-revalidate` (hashed assets stay cached forever), and the
  app also checks for updates the moment its tab is refocused or the network
  reconnects — not only on the 60-second timer. Together these get a fresh build
  in front of active users within seconds of them returning to the tab.

## [1.2.91] — 2026-07-06

### Fixed

- The Marine Corps EGA emblem no longer appears twice. A faint full-viewport
  watermark sat behind the whole app in addition to the denser one in the editor
  column; because they were centered on different things, they drifted apart at
  some zoom levels and read as a doubled emblem (with one bleeding behind the
  sidebar and header). Removed the full-viewport copy, leaving the single
  contained editor watermark. The animated background is unchanged.

## [1.2.90] — 2026-07-05

### Changed

- The About dialog's title now uses the same size and weight as every other
  dialog title. In the date picker, "today" is marked with a ring outline
  instead of a fill, so it reads distinctly from the solid-filled selected day.

## [1.2.89] — 2026-07-05

### Changed

- The preview panel's idle "your document preview will appear here" icon is now
  the same size as the loading spinner, and its helper text uses the same width,
  so the empty and loading states line up. The PDF page-number field is a touch
  wider so three-digit page numbers aren't cramped.

## [1.2.88] — 2026-07-05

### Changed

- The "@" insert menu no longer changes width as you type (its empty / create /
  results states are now the same width).
- The reference and enclosure trash buttons show a faint red hover fill instead
  of a no-op hover.
- The References "Library" button reads "Browse Library," parallel to "Add
  Reference."

## [1.2.87] — 2026-07-05

### Changed

- Small editor-panel touch-ups: the signature-style buttons give a subtle press
  response, the custom-classification preset chips show a pointer cursor on
  hover, and the letterhead "Street / Box (optional)" hint drops a stray italic
  so it matches the other "(optional)" hints.

## [1.2.86] — 2026-07-05

### Changed

- The sidebar's collapse, expand, and New-document buttons now show a hover
  tooltip (they already had screen-reader names). Tidied a no-op ellipsis style
  on the Recents timestamps.

## [1.2.85] — 2026-07-05

### Changed

- Tooltips now sit a few pixels off their trigger (instead of touching it) and
  cap their width, so a long hint wraps into a tidy box rather than stretching.
- The About dialog's title icon is now the same size as every other dialog
  title's icon.

## [1.2.84] — 2026-07-05

### Changed

- Scoped the remaining `transition-all` animations to just the properties that
  actually change (colors on the document-guide cards, width on the progress
  bar and the tour's step dots, and position/size on the tour spotlight — which
  no longer tries to interpolate its full-screen dimming overlay). Same motion,
  less work per frame.

## [1.2.83] — 2026-07-05

### Changed

- The inserted variable chips in the body editor (and the "@" glyphs) now draw
  from the theme's informational-blue token instead of hardcoded Tailwind blue.
  The color is essentially the same — it's now a theme token, so it stays in
  step with the rest of the palette.

## [1.2.82] — 2026-07-05

### Changed

- Corner radii now come from the theme's radius scale instead of a few one-off
  pixel values: the keyboard-shortcut chips, the PDF thumbnail frames, the
  page-number field, and the "@" insert menu (which now matches the app's other
  popovers). Differences are 1–2px — a consistency cleanup, not a redesign.

## [1.2.81] — 2026-07-05

### Changed

- Popovers, dropdown menus, and select lists now use the app's "popover"
  elevation rung (a slightly stronger navy-tinted shadow), matching the
  documented shadow ladder — and a submenu no longer casts a heavier shadow than
  the menu it opens from. Added a top `shadow-2xl` rung on the navy ladder so it
  never falls back to a raw-black shadow.

## [1.2.80] — 2026-07-05

### Changed

- The "Saved · N ago" indicator now uses tabular figures, so its digits don't
  shift width as the time ticks up.
- Internal: the block editor's serif reading size moved off a repeated arbitrary
  value onto one named token. No visible change.

## [1.2.79] — 2026-07-05

### Changed

- File sizes now read in KB or MB as appropriate. A signature image or an
  attached enclosure PDF over a megabyte showed as, e.g., "2048.0 KB"; it now
  reads "2 MB". Small files still show KB (or bytes), and a trailing ".0" is
  dropped. The "Copy log" control and its instructions now read consistently.

## [1.2.78] — 2026-07-05

### Fixed

- Reordering by drag now works reliably on touch devices. The drag handles on
  Via routing, references, enclosures, and body paragraphs didn't opt out of the
  browser's touch-scrolling, so grabbing a handle on a phone could scroll the
  page instead of starting the drag; they now claim the gesture (`touch-action:
  none`). Keyboard reordering was unaffected and still works.

## [1.2.77] — 2026-07-05

### Fixed

- The References help tip said "Browse 107 common military references," but the
  library actually has 135. The count is now derived from the dataset, so it
  can't go stale again.

## [1.2.76] — 2026-07-05

### Fixed

- The "View on GitHub" links (in the About dialog and the header menus) now open
  with `noopener,noreferrer`, so the new tab can't reach back into the app via
  `window.opener` (reverse-tabnabbing). The other external links already did this.

## [1.2.75] — 2026-07-05

### Fixed

- The "remove" button on an addressing "Via" line now has an accessible name —
  it was an icon-only button a screen reader announced as just "button".
- The "(Custom)" classification label and the "Custom Classification" menu item
  used a fixed grey with no dark variant, which failed WCAG AA contrast on the
  dark theme; both now use the theme's secondary-text color, which passes in
  both light and dark.

## [1.2.74] — 2026-07-05

### Changed

- Removed dead entries from the NAVMC 6105 / 118(11) form autocomplete's
  "show these first" list. It named variables (LAST_NAME, EDIPI, RANK, …) that
  aren't in those forms' example set, so they never had any effect; the list now
  matches what the forms actually offer. No visible change. (You can still type
  `@ANYTHING` to create any custom variable.)

## [1.2.73] — 2026-07-05

### Changed

- Added a neutral informational color (`--info`) to the theme, defined for light
  and dark schemes (with an sRGB fallback), and moved the classification "Domain
  Restrictions" note onto it. It was the last banner still using hardcoded blue
  palette classes instead of a semantic token.

## [1.2.72] — 2026-07-05

### Changed

- PDF preview pages now show a subtle loading shimmer while they render, instead
  of a blank white rectangle. On a slow render you get feedback that the page is
  on its way rather than an empty box. (The thumbnail rail already did this.)

## [1.2.71] — 2026-07-05

### Changed

- The per-paragraph portion-marking chip (U / CUI / C / S / TS) now opens a menu
  to pick any marking directly, each shown with its full name. It previously
  only cycled forward one step per click, so stepping back a level meant clicking
  through all the others; the current marking is now checked in the menu.

## [1.2.70] — 2026-07-05

### Changed

- The "@" variable-and-cross-reference menu now eases in with a subtle rise
  instead of snapping into place, matching how the rest of the app's popovers
  and menus appear.

## [1.2.69] — 2026-07-05

### Fixed

- The signature-style selector (Typed Only / Upload Image / Digital Field) is
  now a proper radio group. It was three independent toggle buttons, so a
  screen reader announced them as unrelated controls instead of one choice, and
  keyboard users had to Tab through each. It now announces as a single group,
  and the arrow keys move the selection between the three options.

## [1.2.68] — 2026-07-05

### Added

- Removing a reference or an enclosure that has content — a title, a URL, or an
  attached PDF — now asks for confirmation first, so a stray click can't quietly
  delete your work (and, for references, silently re-letter the rest of the
  list). Blank rows still clear in a single click.

## [1.2.67] — 2026-07-05

### Fixed

- The signature drag-and-drop zone (in the signature block and in the profile
  editor) no longer flickers its highlight as you move the file over it. The
  highlight now clears only when the file actually leaves the zone.

## [1.2.66] — 2026-07-05

### Changed

- The "Generating PDF" message now reads the same on mobile as on desktop
  ("Generating PDF… — This should only take a moment."), with a real ellipsis.

## [1.2.65] — 2026-07-05

### Changed

- The "Save draft" menu item now shows its keyboard shortcut, matching the other
  shortcut-bearing menu items.

## [1.2.64] — 2026-07-05

### Fixed

- On macOS, the Redo control now shows its native ⌘⇧Z shortcut instead of ⌘Y
  (Windows/Linux still show Ctrl+Y). Both gestures already worked; only the
  displayed hint was wrong on Mac.

## [1.2.63] — 2026-07-05

### Accessibility

- The remove buttons on references and enclosures (and the "remove attached PDF"
  button) now carry accessible names, so screen-reader users hear what each
  destructive button does instead of just "button".

## [1.2.62] — 2026-07-05

### Fixed

- The "Blue" swatch in the letterhead color picker now shows navy blue in every
  theme. It was borrowing the theme's brand-accent color, which is gold in the
  USMC theme (and its dark mode) and red in another — so the "Blue" option looked
  yellow. The swatch now uses the actual navy the letterhead prints (RGB 0,32,91).

## [1.2.61] — 2026-07-05

### Changed

- The two-column rows on the NAVMC 6105 and 11811 forms now stack into one
  column on phones instead of staying cramped side by side.
- The document guide's reset button reads "Start over" consistently.
- The welcome screen's letter preview uses the standard elevation shadow instead
  of a hard-coded heavy black drop.

## [1.2.60] — 2026-07-05

### Changed

- The zoom percentage in the PDF viewer toolbar is now a button — click it to
  reset the zoom to fit-width — instead of a static label.

## [1.2.59] — 2026-07-05

### Changed

- The classified-document warning and the custom-classification handling notice
  now use the shared themed notice component, so they match every other in-app
  notice and the caution notice draws its amber from the theme (tracking light/
  dark and every color scheme) instead of a hard-coded shade.

## [1.2.58] — 2026-07-05

### Accessibility

- The copy-to recipient and action-addressee fields (and their remove buttons),
  plus an enclosure's cover-page description, now carry proper accessible names
  so screen-reader users hear what each field is instead of just "edit text".

## [1.2.57] — 2026-07-05

### Fixed

- The Custom Classification "quick fill" no longer offers CONFIDENTIAL, SECRET,
  TOP SECRET, or TOP SECRET//SCI as one-click markings. This browser tool is not
  accredited for classified processing, and those one-click presets let an
  otherwise-unclassified document be stamped with a classified banner, bypassing
  the domain check that keeps classified levels out of the main dropdown. The
  quick fill now offers only unclassified caveats (Unclassified, CUI, For
  Official Use Only). Classified levels remain available only through the
  domain-gated Classification Level dropdown, on accredited networks. (A new
  document still correctly defaults to Unclassified with no marking.)

## [1.2.56] — 2026-07-05

### Fixed

- Dropping or selecting a non-image file for a profile's signature now shows a
  clear "image files only" message instead of silently doing nothing.

## [1.2.55] — 2026-07-05

### Fixed

- Signature images uploaded as JPG or GIF now render correctly in the preview and
  in the exported PDF. Previously they were stored and embedded as if they were
  PNG, so a JPG or GIF signature could render wrong or fail to appear on the
  document. Every non-PNG signature upload is now converted to PNG when you add
  it (existing letters are unaffected until you re-upload).

## [1.2.54] — 2026-07-05

### Changed

- Small UI labels (badges, group headers, keycaps, counts, and similar micro-text)
  now all draw from one shared type step instead of a scatter of hand-picked 9px,
  10px, and 11px sizes. The smallest 9px and 10px labels move up to a consistent,
  more legible size, and the masthead subtitle is a touch larger and less faint.

## [1.2.53] — 2026-07-05

### Accessibility

- The document sidebar's sort and multi-select buttons and the preview's
  readiness "jump to the first incomplete section" control now use the themed
  tooltip that appears on keyboard focus, instead of a native browser tooltip
  that keyboard and touch users never saw.

## [1.2.52] — 2026-07-05

### Accessibility

- The per-paragraph controls in the body editor (indent, outdent, move up, move
  down, delete) now use the themed tooltip that appears on keyboard focus and
  carries an accessible name with its keyboard shortcut, instead of a native
  browser tooltip that keyboard and touch users never saw.

## [1.2.51] — 2026-07-05

### Accessibility

- The profile bar's controls (profile picker, create, edit, and more) are now the
  standard 32px size instead of 28px, easier to hit, and the icon buttons use the
  themed tooltip that reaches keyboard and touch users and carries an accessible
  name. Their labels were normalized to sentence case.

## [1.2.50] — 2026-07-05

### Changed

- Placeholder and loading text now use a real ellipsis character (…) instead of
  three periods (...) everywhere, for consistent, properly-typeset microcopy.
- The "via" address row numbers are the same width and use the same tabular
  figures as the reference and enclosure row numbers, so the columns line up.

## [1.2.49] — 2026-07-05

### Accessibility

- The remaining lookup buttons — browse SSIC codes (joint / MOA letters, the
  6105 counseling form, and command profiles), browse the unit directory and
  reference library on the 6105 form, and search/clear the signature office code
  — now use the themed tooltip that appears on keyboard focus and carries a real
  accessible name, matching the addressing section. Their labels were also
  normalized to sentence case.

## [1.2.48] — 2026-07-05

### Accessibility

- The "look up a unit" and "browse SSIC codes" buttons in the addressing section
  now use a proper themed tooltip that appears on keyboard focus and carries a
  real accessible name, instead of a native browser tooltip that keyboard and
  touch users never saw.

## [1.2.47] — 2026-07-05

### Accessibility

- Caution/warning surfaces now draw from the theme's warning color instead of a
  hard-coded amber, so they track light/dark and every color scheme and stay
  legible. The warning color was also darkened slightly in light mode so warning
  text clears the WCAG AA 4.5:1 contrast ratio on its own tinted background
  (previously ~4.06:1) — this also sharpens the storage and backup banners.

### Changed

- The PII/PHI and encryption notices in Share, the reference/enclosure
  "not applicable to this document type" notices, the batch "some failed"
  summary, the browser-compatibility notice, the status-message helper, and the
  "Clear fields" confirm button all route through the semantic warning/success
  tokens now.

## [1.2.46] — 2026-07-05

### Changed

- Form controls now share one rest/hover/focus behaviour: text areas and select
  menus shift their border the same quiet way inputs already do (previously text
  areas tinted red and lifted a shadow, and selects didn't react at all), and
  hover/focus transitions are scoped so borders no longer snap. Checkboxes and
  accordion headers use the same scoped transitions, and the checkbox corner
  radius now comes from the shared radius token. The "Get set up" launcher's
  press animation matches every other button.

## [1.2.45] — 2026-07-05

### Changed

- Modal chrome is more consistent: dialogs and confirmation dialogs now open and
  close at the same speed, the Update and Profile close buttons match the
  standard one, the Share "copy link" button shows a copy icon (not a key), and
  the About dialog scrolls within a capped height so its footer can't clip on
  short screens.

### Accessibility

- The Find & Replace, Unit Directory, and Office Code dialogs now carry a
  description for screen readers (and no longer trip a console warning).

## [1.2.44] — 2026-07-04

### Changed

- The Letterhead section opens with a one-line description like every other
  section, and the color picker shows a small swatch next to Blue/Black.

### Fixed

- The ZIP field now accepts only digits and the ZIP+4 hyphen (up to 10
  characters) instead of arbitrary text.
- The Seal picker has a help tip explaining the DoW vs DoD choice, since the
  wrong one produces an officially incorrect letterhead.

### Accessibility

- Required-field markers are now consistent across the addressing and signature
  fields, the Via routing drag handle has a proper label and keyboard focus
  ring, and the salutation field only shows its error once you've tried to
  export, matching every other field.

## [1.2.43] — 2026-07-04

### Fixed

- Deeply-nested body paragraphs (levels 5–8) now show an underlined label in the
  editor, matching the printed PDF. The label pattern repeats every four levels
  per SECNAV Ch 7, so without the underline a level-8 "(a)" looked identical to
  a level-4 "(a)" in the editor even though the exported document distinguished
  them correctly.

## [1.2.42] — 2026-07-04

### Fixed

- In the body editor, the @-insert menu now scrolls the highlighted option into
  view when you arrow past the visible rows or wrap top-to-bottom.
- The floating bold/italic/underline toolbar no longer clips off the top of the
  screen when the selected text is near the top — it flips below the selection
  when there isn't room above.

### Changed

- The @-menu, its "create variable" panel, and the floating toolbar now share
  one shadow depth instead of three different ones.

## [1.2.41] — 2026-07-04

### Accessibility

- The Classification section's decorative icons are now hidden from screen
  readers, and its advisory banners carry a spoken "Warning:"/"Important:"
  prefix so their intent is clear without the icon.
- The Classified POC email fields now validate: a malformed address shows an
  inline error and is flagged to assistive tech, clearing once it's valid.
- The custom-classification preset chips are a little taller so they clear the
  minimum touch-target size.

### Fixed

- The CUI Configuration heading uses the official CUI color (and a dark-mode
  variant) instead of a generic purple, matching the classification swatches
  elsewhere.

## [1.2.40] — 2026-07-04

### Changed

- The active document in the Recents sidebar now shows a single indicator (the
  scarlet left bar, matching the section outline above) instead of also filling
  the row, so the two lists speak the same visual language.
- Sidebar micro-labels (section headers, doc-type chips, timestamps) now use one
  shared type size instead of three slightly different hand-set sizes, and the
  recency group labels ("Today", "Pinned") are a touch more legible.

### Accessibility

- The sidebar's collapse, expand, and New buttons now show a keyboard focus ring.
- The per-row "…" actions menu rests faintly visible and reveals on row
  hover/focus instead of popping into view row-by-row while tabbing; it's always
  visible on touch.
- The mobile Recents pin and delete buttons are now full 44px touch targets with
  a gap between them, so the destructive delete is harder to hit by mistake.

## [1.2.39] — 2026-07-04

### Added

- The PDF preview toolbar now has a Download button, so you can save the
  rendered PDF straight from the viewer instead of only opening it in a new tab.

### Changed

- Preview-toolbar buttons are a bit larger (32px) for easier tapping, the
  Fit-width/Fit-page toggles now show a filled background when active (not just
  a color tint), and the zoom percentage stays visible on narrower panels.

## [1.2.38] — 2026-07-04

### Changed

- The command palette gained a persistent hint bar (Run / Navigate / Close and
  a live result count), a clearer empty state with an icon and a steady height
  so the panel no longer jumps, and its corner radius and border now match the
  other dialogs. Keyboard-shortcut chips on the selected row invert so they
  stay legible, and hovering a row gives a lighter tint distinct from the
  keyboard selection.

### Fixed

- Scrolling the command-palette list under a stationary cursor no longer yanks
  the selection to whatever row slides beneath it during keyboard navigation.

## [1.2.37] — 2026-07-04

### Accessibility

- Reference and enclosure title/URL fields now have proper labels, so screen
  readers announce which field they are instead of "edit text, blank".
- The reorder drag handles show a keyboard focus ring and a hover surface.

### Changed

- The References and Enclosures sections now show a short line when empty
  instead of just bare Add buttons, and a library-picker row highlights when a
  control inside it is focused by keyboard.

## [1.2.36] — 2026-07-04

### Fixed

- Attaching an unsupported file now tells you why instead of doing nothing.
  Dropping or picking a non-PDF for an enclosure, or a non-image for a
  signature, silently ignored the file; it now shows a clear message naming the
  skipped file, and valid files in the same drop still attach.

## [1.2.35] — 2026-07-04

### Changed

- The storage and backup notice strips and the beta banner now use the shared
  warning color, so they restain correctly in every theme instead of a fixed
  amber, and the banner text matches the strips' size.

### Fixed

- Stacked notice strips now read as separate: each carries a left accent bar
  and a firmer divider instead of merging into one slab.
- A notice's leading icon aligns to the first line when the message wraps, and
  the dismiss/action controls have larger touch targets.

### Accessibility

- Blocked storage and failed-backup conditions are now announced assertively to
  screen readers (role="alert") instead of politely, where they could be
  missed; the benign heads-up cases stay polite.

## [1.2.34] — 2026-07-04

### Changed

- Severity notices across the app now draw from theme tokens instead of
  hardcoded palette colors, so they restain correctly in every color scheme. A
  new shared Notice primitive (info / warning / error / success) backs the
  panels in the PII warning, enclosure warning, NIST compliance, and update
  modals, replacing three ambers, two oranges, and a blue that used to drift.
  The PII warning header also drops its decorative red/amber gradient for a
  flat, AA-contrast token color.

## [1.2.33] — 2026-07-04

### Changed

- Button labels now use consistent sentence case. The editor add-buttons ("Add
  reference", "Add enclosure", "Add via", "Add recipient", "Add action
  addressee") and the reset/clear/restore dialog actions ("Reset everything",
  "Clear fields", "Start fresh", "Restore session") were a mix of Title Case
  and sentence case; they now all follow sentence case, matching the Save menu.

## [1.2.32] — 2026-07-04

### Accessibility

- The custom-classification preset chips now show a keyboard focus ring. The
  ring was bound to the selected state only, so tabbing across the chips gave
  no focus indicator (WCAG 2.4.7). They now carry the standard focus-visible
  ring independent of selection.

## [1.2.31] — 2026-07-04

### Fixed

- The Recipient Address field now uses the shared textarea component, so it
  gets the same focus ring, focus/hover transitions, and invalid-state styling
  as every neighboring field instead of a hand-rolled variant that had a
  thinner ring and no hover state.
- The signature upload hint no longer contradicts the limit it enforces. It
  read "max 500KB recommended" while the guard rejects at 2 MB; it now states
  the real 2 MB cap and keeps "under 500 KB" as a soft suggestion.

## [1.2.30] — 2026-07-04

### Changed

- The command palette's selected row now uses a neutral selection tint instead
  of a saturated brand fill. Arrow-keying through results previously flooded
  each row with the brand accent (navy, gold, or dress-blue depending on
  scheme); it now uses the same quiet accent wash as every other menu, keeping
  saturated color for genuine emphasis.

## [1.2.29] — 2026-07-04

### Fixed

- The top-bar controls now share one height. The undo, redo, refresh, and
  appearance icon buttons grew to 36px at ≥640px while every other control
  stayed 32px, breaking the row into two heights; they're now a uniform 32px.
- The Document Type, font-size, font-family, and Form Type pickers now span
  their field column. They were sized to their content (w-fit), so the trigger
  and its chevron floated mid-row out of line with every sibling field, which
  is full-width.

## [1.2.28] — 2026-07-04

### Fixed

- The guided tour no longer spotlights controls that aren't on screen. The
  appearance and help buttons are hidden below 1280px, so those two steps used
  to fall back to a centered card describing invisible buttons; they're now
  filtered out at narrower widths.

### Accessibility

- The guided tour announces each step to screen readers via a polite live
  region ("Step 3 of 8: …") and shows a visible step counter next to the
  progress dots. Previously the only progress indicator was the aria-hidden dot
  row, so assistive tech got no notice when the step changed.

## [1.2.27] — 2026-07-04

### Fixed

- Every clickable control in the document-guide modal now shows a keyboard
  focus ring. Its custom tabs, finder option cards, recommendation cards,
  category pills, and "Show me where" links were raw buttons with no
  focus-visible indicator; all now carry the standard ring.

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
