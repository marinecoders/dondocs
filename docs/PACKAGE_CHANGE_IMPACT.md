# Package change impact

**Package change impact** compares the selected saved package revision with an earlier saved revision. Choose the baseline and select **Compare saved revisions**. The comparison is read-only. It does not update documents, requirements, reviews or outputs.

The report separates captured document changes, order changes and retained metadata changes. It also compares shared values, people, field links, evidence requirements, citations, saved intake answers, pinned template context and declared consistency relationships. Existing field-link, citation and consistency inspectors identify dependencies whose result changed even when the saved declaration itself stayed the same. Unrelated document edits do not automatically mark every field link or relationship as affected.

Expand a category to inspect its findings. **Inspect** opens the exact saved revision and target associated with that finding. Removed documents and older evidence keep their original destinations. A missing or pruned destination remains unavailable. A portable handoff containing only one selected revision cannot recreate earlier history. Large reports show the first 25 findings in each category; use **Show more** to continue.

## Previewing updates

Shared-information updates and changes to saved action intake include the same report in their existing preview. The engine computes it from the privately captured proposed revision that will actually be applied. Resolve overlapping local edits and prepare a fresh preview before a complete impact report is available. New actions have no earlier package revision to compare.

Proposed revision targets are not saved yet, so preview reports do not offer navigation into invented saved revisions. The existing preview and apply controls continue to decide whether an update is ready.

## PDFs and reviews

Retained PDFs are compared against their own recorded input fingerprint and source revision, including earlier PDFs when neither comparison endpoint owns an output. Only evidence available in the selected revision's retained history is included. Changed document content, order or assembly inputs require checking a new output. Matching document inputs with changed package context are reported separately so readiness can be checked again.

Every PDF stays associated with its exact captured revision. Matching metadata does not make an older PDF current, prove visual equivalence or transfer an approval. This report does not open file bytes; normal open and delivery operations verify retained files. Legacy outputs without recorded provenance and inconsistent provenance remain unavailable or unknown.

Recorded reviews are checked against their preserved baseline checksum. The report identifies changed and moved members and context changes while preserving each round's exact revision and active, closed or superseded status. Local work tracking does not change document applicability or grant approval.

## Limits

This is a captured-input dependency report, not a replacement for document redlines or rendering comparisons. Missing source records, inconsistent snapshots and exceeded comparison bounds produce explicit uncertainty. It does not infer signing authority, create a package-signing workflow or compare undeclared relationships. No report is persisted or exported automatically.
