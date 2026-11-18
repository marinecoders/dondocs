# Package signing

**Package signing** connects an exact retained package PDF or unsigned original member to the existing signing workspace. Editable native members first need a retained rendered PDF. An assembled output needs matching recorded input provenance; legacy or inconsistent outputs must be rendered again before use.

## Prepare an exact handoff

1. Choose **Exact saved PDF**, then **Review signing source**. Inspect the read-only PDF preview and the marking/privacy notices.
2. Confirm the source review and open the existing signing workspace. Place fields or use existing signature fields, review the pages and save an exact signing handoff there.
3. Return to the package and select **Refresh saved signing handoffs**. Choose the saved record and handoff for that same PDF.
4. Review the prepared handoff PDF and signer assignments, then capture it in a new package revision.

The prepared source stays tied to its package, revision, target and exact bytes. A changed package, cancelled operation or changed deployment policy requires another review. Save or discard the signing preparation before changing unrelated package work.

Capturing a handoff preserves every existing member and the earlier package revision. It records the original revision and target, source checksum, package-context checksum, exact handoff bytes and signer field assignments. The signing application handles signatures and certificate checks. Association with a handoff does not authenticate a signer or establish approval.

## Retain and transfer

Captured handoffs are available in historical and reviewer views for inspection. Review the retained source and handoff before downloading the exact signing ZIP. A current owning package can reopen the captured signing record; newer local signing history is preserved when it contains the same source and handoff.

Portable packages and workspace recovery carry the captured signing metadata and PDF assets. Source and handoff PDFs are separate immutable assets, avoiding duplicated base64 content inside metadata. Reopening a portable capture can restore its signing record in a fresh browser. Duplicating a package clears its signing associations so another action cannot inherit them.

A package revision supports ten captured handoffs. Each PDF uses the existing signing limit of 20 MB and 100 pages. A metadata record supports 128 KB, each revision supports 512 KB of signing metadata, and retained signing metadata is bounded to 8 MB across revisions and review baselines. Existing package transfer and storage limits also apply.
