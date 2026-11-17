# Review tracked Word text

Import a `.docx` with **Document actions → Import letter**. The preview lists the tracked text paragraphs that can be read. Import opens a new document and retains the exact original Word file. The prior draft stays in Recents.

The imported draft shows the text before pending Word edits. Choose **Review imported Word edits**, then select its **Word tracked text** review. Each supported body paragraph has one replacement proposal containing all of its tracked insertions and deletions. Compare the baseline, current draft and proposal before accepting or rejecting it. Native bold, italic and underline markers remain part of that comparison. Heading paragraphs and automatic paragraph identities are preserved separately.

**Accept suggestion** changes the current native paragraph. **Reject suggestion** records the decision while keeping the paragraph. The usual **Undo** and **Redo** controls reverse or restore an applied text change and its review decision. Review decisions and original source bytes survive a reload and are included in a complete workspace backup. A clean document export prints the current text, not pending proposals. A portable draft includes the retained original but does not transfer the workspace review history; use a workspace backup to retain that history.

If the native paragraph changed after import, direct acceptance is blocked. **Reconcile suggestion** uses the existing comparison against the pinned baseline. Independent edits can be combined for inspection. Overlapping edits require a deliberate choice of the current text, proposed text or a written resolution. Changes made after that comparison invalidate the proposed resolution. Word author names, revision IDs and dates are unverified source metadata, not authenticated reviewer identities or approvals.

## Supported boundary

Supported changes are text insertions, deletions and replacements inside one existing body paragraph whose complete baseline maps to exactly one native paragraph. An unchanged printed paragraph label can be removed as part of native numbering; a changed label cannot become a body-text proposal. Deleting every character leaves an empty paragraph rather than deleting its structure.

Changes to headings, paragraph boundaries, tables or cells, fields, images, moves, nested revisions, formatting-only revisions and ambiguous revision identities remain in the original Word file. Imported notices identify these limits. No proposal is invented for an inserted paragraph without a baseline. Review the retained file when unsupported changes are present.

If overlapping revisions hide text from both the before and after views, import stops before saving any content. Resolve those revisions in a copy of the original Word file, then import that copy.

A file can convert at most 100 changed paragraphs and 2,000 revision records. Each before/proposed value is limited to 20,000 UTF-16 code units, with a combined 190,000-code-unit extraction budget and the existing native review budget including metadata. At most 100 revision metadata entries are summarized for a paragraph; the original retains the complete records. A limit prevents conversion rather than silently applying a partial set. For a tracked import, the complete portable review baseline is limited to 32 MiB of source and image bytes, counting every embedded occurrence before base64 expansion. Missing or inconsistent resources stop installation.

The document, original source, images, review baseline and proposals are committed together. Cancellation or a failed storage transaction leaves the prior draft open and does not retain a partial review. Removing the original source prevents creating a complete reviewer copy until the resource is restored. Import does not alter the retained Word file or accept its changes automatically.
