# Audit status

This records the 38 original verification items against the refactor stack,
not a new finding count. Original observations describe the older audited
revision. Some were fixed before this final batch; others were narrowed to
documented limitations rather than runtime defects. The changes through [#415](https://github.com/marinecoders/dondocs/pull/415)
are integrated into the reviewed main branch. The separate form-library data
branch remains outside this review; its definitions require their own repairs
and validation before publication.

| Original items | Current disposition | Main evidence or implementation |
|---|---|---|
| 1–3: cross-document undo, omitted edits, lost enclosure reference | Addressed by document-scoped history and complete snapshots; attachment handles survive restore | `tests/unit/workspaceHistory.test.ts`, `historyActivation.test.ts`, `builtInFormHistory.test.ts` |
| 4: Save claims success after a failed write | Failed writes retain failure state; retry performs a real write | `src/stores/documentsStore.ts`, `tests/unit/documentsStore.test.ts` |
| 5: document signature lost on switch | New uploads commit document-owned assets; saved records and history retain references | [#408](https://github.com/marinecoders/dondocs/pull/408), `tests/unit/documentSignatureAssets.test.ts` |
| 6: explicit restore replaces NAVMC buffers | Documented restore policy, not an undisputed runtime defect; included buffers replace current buffers, while saved documents use newer-wins merging | [Backup contract](STORAGE.md#backups) |
| 7: attachment read errors yield incomplete successful backups | Strict account/asset reads fail the backup instead of mirroring an incomplete bundle | `tests/unit/backupCapture.test.ts`, `backup.test.ts` |
| 8: automatic backup trigger scope | Registry saves, including active form drafts, trigger the full-account mirror; profile/preference changes and dormant legacy buffers alone do not | [Backup contract](STORAGE.md#backups) |
| 9–10: form share loses values; import overwrites active record | Versioned shares retain active form values/rows and import as a separate document | [#409](https://github.com/marinecoders/dondocs/pull/409), `tests/unit/versionedShares.test.ts`, `tests/component/ShareModal.test.tsx` |
| 11–15: effective classification, enclosure/custom markings, domain policy | Shared captured projection and resolved deployment policy feed prepared exports | [#398](https://github.com/marinecoders/dondocs/pull/398), [#399](https://github.com/marinecoders/dondocs/pull/399), `tests/unit/exportDeploymentPolicy.test.ts`, `preparedExport.test.ts` |
| 16–17: export review bypass and missed sensitive fields | Canonical export routes bind content review to captured revisions and scan supported text fields; detection is an aid, not a guarantee, and does not inspect embedded image or PDF contents | [#402](https://github.com/marinecoders/dondocs/pull/402), `tests/unit/preparedExport.test.ts`, `tests/unit/errorRecoveryOwnership.test.ts` |
| 18: MFR prints retained hidden addressing | Output projection and PDF template omit From/To/Via; draft retains dormant values | [#412](https://github.com/marinecoders/dondocs/pull/412), `tests/integration/output-control-contracts.test.ts` |
| 19–21: continuation indentation, spacing, deep-label underline | Already corrected in the stack; shared paragraph rules and native regressions preserve the behavior | [#414](https://github.com/marinecoders/dondocs/pull/414), `tests/integration/pdf-subparagraph-indent.test.ts`, `subparagraph-alignment.test.ts` |
| 22: off-page form boxes | Renderer/package validation and an actual-PDF geometry CI gate are added. The three audited source definitions are absent from this stack and still need data repairs on the separate form-library branch | [#413](https://github.com/marinecoders/dondocs/pull/413), `tests/unit/formGeometry.test.ts`, `tests/integration/form-geometry-render.test.ts` |
| 23–24: batch content loss and variable detection mismatch | Rows use the shared prepared renderer and traversal; review/retry retains row ownership | [#406](https://github.com/marinecoders/dondocs/pull/406), [#407](https://github.com/marinecoders/dondocs/pull/407), `tests/unit/preparedBatchRows.test.ts` |
| 25: custom business controls omitted from output | Numbering, references, enclosures, and recipient address survive PDF and Word rendering | [#412](https://github.com/marinecoders/dondocs/pull/412), `tests/integration/output-control-contracts.test.ts` |
| 26: Word reference hyperlinks | Retained as an explicit PDF-only annotation limit, not a newly fixed Word feature | [Capabilities](CAPABILITIES.md), [known limits](KNOWN_ISSUES.md) |
| 27: Word continuation-subject ignored | Already implemented in Word page-furniture post-processing and covered by native regressions | `tests/integration/docx-page-furniture.test.ts` |
| 28: TeX download omits distribution | Prepared TeX output includes every generated fragment; ordinary downloads remain configuration fragments, not a complete project | [#401](https://github.com/marinecoders/dondocs/pull/401), `tests/unit/preparedCorrespondence.test.ts` |
| 29: long recipient lists overflow | Existing breakable layout reverified with short/110-recipient PDF and final Word output | [#415](https://github.com/marinecoders/dondocs/pull/415), `tests/integration/recipient-list-pagination.test.ts` |
| 30: preview download bypasses export validation | Preview download actions use the canonical export route; displayed previews are bound to captured revisions | [#405](https://github.com/marinecoders/dondocs/pull/405), [#411](https://github.com/marinecoders/dondocs/pull/411) |
| 31: Enter does not split at caret | README corrected to the actual command: add an empty paragraph | [Editor behavior](../README.md#core-functionality) |
| 32: Recents misses special-format subjects | Workspace search uses the shared text traversal, including format-specific fields | `src/lib/documentFields.ts`, `src/stores/documentsStore.ts` |
| 33: Find/Replace scope overstated | README names the actual correspondence fields and built-in-form scope; other fields/configured forms are excluded | [Document management](../README.md#document-management), `src/components/modals/FindReplaceModal.tsx` |
| 34: nonexistent reference-library shortcut | Removed from README; library remains available through the UI/palette | [Keyboard shortcuts](../README.md#keyboard-shortcuts), `src/App.tsx` |
| 35: readiness implied signature approval | UI describes required-field completion; it does not certify a complete signing package or regulatory compliance | `tests/component/ReadinessMeter.test.tsx` |
| 36: form Save feedback implies data loss | Built-in and configured forms have document identities and autosave. Save checkpoint confirms success only after committing the captured document | `src/lib/saveCheckpoint.ts`, `src/stores/documentsStore.ts` |
| 37: smoke coverage does not gate placement issues | Added a separate actual-page geometry gate, with a baseline that rejects new/changed failures and stale exceptions; inventory count is explicit | [#413](https://github.com/marinecoders/dondocs/pull/413), `npm run test:form-geometry` |
| 38: root Makefile cannot find main.tex | Build stages a complete checked-in example and seal assets, then runs native pdfTeX twice outside the source directory | `scripts/prepare-tex-example.py`, `tests/integration/make-pdf.test.ts` |

## Structural boundaries

- Document identity/revision tokens prevent old asynchronous work from installing into another document. Captures own copied data before awaiting renderers or asset loading.
- Prepared exports separate policy/content review from rendering and download. Retrying retains the captured revision and requires the appropriate current review.
- Signatures and enclosures use committed asset handles; history, backups, and the reachability inventory share the ownership roots. Automatic orphan deletion remains deferred until cross-tab ownership can be established.
- Capability resolution drives both controls and execution checks. [Generated documentation](CAPABILITIES.md) is checked against that resolver in CI.
- Shared text traversal and paragraph layout reduce drift between supported consumers. Format-specific rendering and explicit capability limits remain necessary.

These changes reduce recurring defect classes. They do not prove the absence of
all defects, make Word identical to PDF, certify an unmerged form corpus, or
replace a document review before signature.
