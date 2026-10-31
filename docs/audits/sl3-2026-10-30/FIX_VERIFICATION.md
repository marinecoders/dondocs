# SL-3 audit fixes and verification

This implementation pass addresses the seven reproduced defects from baseline `51ba175d`, plus PDF inventory margins and continued-table rules. The full [document checklist](../../SL3_DOCUMENT_CHECKLIST.md) retains the order, standard, source-form and author/release requirements. The original `checklist-evidence.json` remains the historical audit snapshot; `fix-verification.json` records this pass independently.

| Finding | Implemented correction | Verification |
| --- | --- | --- |
| F01 | Print the selected dissemination control in the source designation field and every CUI banner. Keep the separate distribution statement. | Production CUI exports in both orientations assert `CUI//NOFORN` on every page; designation value is also asserted. |
| F02 | Underline navigation words in blue, with real spaces at which titles can wrap. Keep a separate page-number column and actual link destinations. | PDF title underline strokes, existing destination tests and overlong wrapped-title bounds. |
| F03 | Require an explicit lettering review for every used illustration. Authors confirm that artwork has no lettering, or supply artwork without baked-in lettering and add all lettering as positioned, visible searchable labels. | Original unreviewed labelled raster is rejected; replacement artwork with `VALVE INLET` prints visibly and is searchable. Operator-order regression ensures the opaque image cannot cover its labels. Labels crossing image edges fail compilation. |
| F04 | Complete fixed authentication/generated-field abbreviations and add custom definitions for abbreviations, symbols and applicability codes. Merge alphabetically, preserve portion markings, reject incomplete entries and conflicting terms. | Actual export contains PAE/PPO/DCI and a custom definition. Component, validation and persistence tests cover authoring, duplicate/incomplete definitions, classification and saved sessions. |
| F05 | Restore the date at the left of ordinary running headers while retaining the bold short title at right. | Actual front-matter PDF text and rendered pages. |
| F09 | Center source inventory grids in both PDF orientations, retaining every original column width. | Native PDF cell positions, equal computed margins and existing production optional-column boundary cases. |
| F11 | Treat inventory sheets as one continued Table 1; omit the bottom horizontal rule on nonfinal sheets and close the final sheet. | Production PDF vector rules distinguish nonfinal and final sheets. This follows the standard over the source example's closed continuation borders; that difference is recorded explicitly. |
| F12 | Select 10-point SL-3 authentication and cover nomenclature. Retain 12-point PCN under explicit source instruction 37. | Exported text transforms measure approximately 9.96 PDF bp for both corrected text blocks. I-Type retains its existing defaults through shared font hooks. |
| F13 | Replace one-em caption gaps with two current-font spaces in figure, table and continued captions. | Actual 10-point figure number/title separation measures 4.9813 PDF bp. |

Certification navigation now uses the exact printed caption `INVENTORIED BY`, without adding a heading to the source form. The portrait certification retains 20 writing rows; the wide certification retains 12. Both retain the supplied column geometry and matched line positions. The 19 fixed preface narrative/note blocks are unchanged.

The UI exposes custom definitions under **Technical data and notes**, and lettering review and label positions under **Illustrations**. Attaching a replacement illustration clears its previous lettering review. Drafts, backups, classification checks, search and Companion input retain the structured data.

## Verification record

The reproduction command in the [audit README](README.md) now exercises eight inputs: seven produce PDFs and the original unreviewed labelled raster is intentionally rejected. The new searchable-label case uses synthetic artwork without baked-in lettering. The observation script records actual text, underline strokes and CUI control preservation rather than returning an aggregate compliance score. Representative final pages are under [verified/](verified/).

Local verification includes the complete unit/component coverage run, complete integration run, lint, application build and Companion builds. Exact results and source/output hashes are recorded in `fix-verification.json`. New tests inspect output PDF text metrics, vector rules, destinations and paint order; successful compilation alone is not their acceptance condition.

## Requirements that code cannot certify from the supplied evidence

- **F06:** The actual contract-supplied USMC-V1-12 DTD and required tagged-source deliverable/profile are absent. Neither JSON nor LaTeX is presented as DTD-conforming source.
- **F07:** Actual sensitivity-label metadata and downstream protection/handling are not implemented or demonstrated. Distribution restrictions alone do not establish the program's CUI determination. The generated PDF is not represented as a labeled/protected release copy.
- **F08:** The supplied dedicated SL-3 cover/preface/authentication structure conflicts with the standard's brief-manual treatment for short outputs. No approved profile/tailoring decision was supplied; the software retains the supplied SL-3 structure and the conflict remains open.
- **F10:** Fixed source preface titles contain SSRI/UURI while the standard prohibits acronyms in headings. The immutable narrative is retained; the source/title conflict remains open. Matching certification navigation fixes only that separate part of F10.
- Actual equipment/configuration records, first-use definitions, artwork-label completeness and final lettering size, safety/security review, authority/delegation, certificate signing, acceptance and release remain author/program responsibilities. Explicit confirmation is an author assertion, not automatic OCR or content certification.

Times New Roman font-family embedding remains excluded at the user's request. Point sizes were included and corrected. No claim of 100% compliance or government authorization is made.

## Supporting terminology/marking references

The supplied source's **Portfolio Acquisition Executive** terminology agrees with the [Department of the Navy acquisition announcement](https://www.navy.mil/Press-Office/Press-Releases/display-pressreleases/Article/4435370/navy-reshapes-warfighting-acquisition-system/). **DCI** is defined by the [official Deputy Commandant for Information site](https://www.information.marines.mil/Leaders/), and PPO terminology is documented in the [HQMC correspondence supplement](https://www.trngcmd.marines.mil/Portals/207/Docs/TBS/MCO%205216.20%20HQMC%20Supplement%20to%20DoN%20Correspondence%20Manual.pdf). The [DoD CUI training guide](https://www.dodcui.mil/Portals/109/Documents/Desktop%20Aid%20Docs/20-S-2093%20cleared%20training%20guide-13_oct-20.pdf) illustrates CUI dissemination banners. Preserving the author's selected marking does not determine whether its use is authorized for actual data.

The source authentication message addressee CMC I is distinguished from DCI: its I denotes Intelligence, as shown by the [official CMC I intelligence-program message](https://www.marines.mil/News/Messages/Messages-Display/Article/3199858/academic-year-2023-24-full-time-study-for-enlisted-marines-national-intelligenc/).
