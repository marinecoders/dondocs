# Portrait and landscape UI verification

The UI preview previously fitted every page to the same pixel width. This hid the physical width difference between SL-3 portrait front matter and the wider inventory/certification pages. It also copied a raw scroll offset between recompiles, which could move the visible content when the selected layout changed.

The viewer now resolves every page's actual PDF dimensions before laying out or restoring the document. It applies one physical scale across the document and fits the widest page to the panel. For the SL-3 wide profile, portrait front matter measures 612/792 of the inventory page's displayed width, while both have the same displayed height. The selected landscape inventory profile remains the prescribed widened 11-by-11-inch PDF, rather than rotating the portrait cover.

Recompiles and zoom/layout changes retain the page and fractional position at the viewport center. Incoming pages pre-render around that logical position. Manual zoom also allocates enough horizontal space to reach both edges, and repeated zoom clicks advance using the stored zoom stop rather than a rounded pixel ratio. The previous rounding could trap zoom at 110 percent.

The form now explicitly says that the selected layout applies to inventory and certification while cover/front matter stay portrait.

Validation:

- The complete unit/component coverage suite passes 3,240 tests.
- Focused viewer, toolbar, preview-panel, mobile-preview and SL-3 authoring tests pass 52 cases. The mixed-paper component case checks portrait-to-wide-to-portrait swaps, retained page position, relative widths, both fit modes, repeated zoom and horizontal space for enlarged paper.
- Four tests parse real generated PDFs with the exact pdf.js used by the viewer. The added SL-3 case verifies the physical width ratio and equal page heights from actual output.
- Lint and the production application build pass.
- Browser inspection checks both layout selections, page retention and rendered page dimensions. The accompanying UI screenshots and measurements record the synthetic demonstration draft.

This changes preview rendering and navigation. PDF publication geometry and the existing source/delivery/profile findings in the full checklist are unchanged.
