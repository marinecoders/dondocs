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

## Add an associated return

First use **Open captured signing workspace** to compare a returned file with its exact saved handoff and associate it there. The signing workspace retains its existing geometry, content, resource and handoff-marker checks. Unchanged, differing and inconclusive files need an explicit decision; none of these checks authenticate a signer.

Return to the package, review the retained handoff and select **Refresh associated signing returns**. Choose the associated returned PDF and select **Review adding return to package**. The preview identifies its matching evidence and shows its preserved pages and privacy findings. Confirm the returned-file review; acknowledge an unchanged, differing or inconclusive match separately.

**Add reviewed return in new package revision** appends one supporting original and an association receipt. Every current member, newer answer, local override and earlier revision remains intact. The original file bytes are retained; the member label and receipt keep signer authenticity unverified. This operation deliberately adds evidence rather than replacing or merging a reviewed draft automatically.

Captured returns remain available under their handoff. Choose a captured returned file and preview it before acknowledging download or reopening it. The viewer identity must match the selected return; selecting a file alone does not make an older preview's review acknowledgement apply to it. Downloads use the existing signing PDF delivery path, including gesture-sensitive browser handling.

A portable package carries each captured return and its exact associated-record snapshot. Reopening a captured return can restore that file into the existing signing workspace. When a newer local signing record already exists, compatible captured handoffs and returns merge additively while preserving current field placements; conflicting identities require resolution. A handoff supports up to ten captured returns, subject to the existing package and signing limits.
