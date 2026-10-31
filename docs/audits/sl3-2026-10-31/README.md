# Certification spacing and completed-field verification

This follow-up checks the closely spaced lines above the first inventory signature entry and tests populated content against the supplied desktop SL-3 forms.

The close portrait line is **the top border of the 20-row writing table**, not the first writing baseline. The original DOCX contains 20 rows, each 518 twips high, with a top and bottom border on the first row. Its rendered PDF has a 13.25-point gap from the full-width caption separator to the table's top border, followed by 26.4-point writing spaces. The wide source has no top border, 12 rows and 29.3-point writing spaces; its caption separator is 41.2 points above the first writing baseline (11.9-point gap plus one row).

The implementation previously used a common 12-point spacer, producing measured gaps of 12.375 points in portrait and 41.675 points to the first wide writing baseline. It now uses the source-specific distances and accounts explicitly for half the separator stroke width. The source border is retained, and all 20/12 writing spaces remain usable. No writing entry belongs in the narrow space between the caption separator and the table's top border.

## Populated cases

Four production exports cover both orientations with ordinary and extended content. The extended cases use a long nomenclature, command/address, signatory name and billet, seven cover entries (cover overflow), and synthetic CUI control banners. Assertions check:

- Every rendered word remains inside the page's horizontal content bounds.
- Wrapped nomenclature retains every word and clears the certification captions.
- Authentication stays together after the cover continuation, including its final distribution line.
- The unsigned digital-signature widget is on the authentication page and fits between OFFICIAL and the printed name.
- All 20 portrait or 12 wide rows accommodate synthetic names/ranks and dates; a longer portrait name wraps onto two lines inside its own row.
- An eight-digit serial fits the existing serial-writing line.
- Entries remain inside their columns/rows, and the final row retains footer/control-banner clearance.

The completed copies are **QA simulations of writing on the source form**. The inventory rows remain blank writing spaces in the application export; these samples do not introduce application text fields or apply certificate signatures. All names, serials and equipment details are synthetic. Handwritten signatures still require the user to stay inside the writing area.

An additional production regression deliberately overfills the command address. The renderer now refuses an authentication that would span multiple pages, with a specific message to shorten the completed fields, instead of returning a malformed authentication layout.

## Reproduce

From the repository root:

```sh
npx vitest run --config vitest.integration.config.ts tests/integration/sl3-filled-layout.test.ts tests/integration/sl3-render.test.ts tests/integration/sl3-companion.test.ts
```

All 24 focused tests pass, including the five new populated/overflow cases. Lint, application build and both Companion builds also pass. `filled-layout-verification.json` records the measured distances and synthetic output identities. The PNGs show extended completed certification sheets in both orientations and the extended authentication page.

This spacing verification supplements the [full checklist](../../SL3_DOCUMENT_CHECKLIST.md) and [prior fix verification](../sl3-2026-10-30/FIX_VERIFICATION.md). It does not change their unresolved source/delivery/profile requirements or the user's font-family exclusion.
