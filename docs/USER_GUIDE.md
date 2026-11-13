# Using DonDocs

[Documentation index](README.md) · [Supported outputs](CAPABILITIES.md) · [Known limits](OUTPUT_LIMITS.md)

## Create and reopen a draft

1. Choose **Correspondence** or **Forms**, then a format. Changing category resumes that category's draft rather than converting the open document.
2. Fill the sections shown, or use **Templates** in the sidebar. Use a saved profile for unit/signer defaults. Applying a profile is explicit; reopening an old draft does not borrow a signature from the current profile.
3. Review the preview. For publications, complete the [structured publication workflow](TECHNICAL_PUBLICATIONS.md).
4. Wait for **Saved**. Recents holds saved drafts; search, pin, rename or duplicate one there. A save error means the revision has not been confirmed durable.

On mobile, open the workspace menu for sidebar destinations. Editor **One section** / **Full document** changes the view of the same draft.

## Profiles and reusable templates

Fill in letterhead/sender details, then open **Profiles** in the sidebar (workspace menu on mobile) and choose **New profile**. Name it, review the unit/address and signer fields, and save. Use **Apply** to review changes to the current correspondence draft, or **Edit** to change saved defaults. A profile does not retroactively rewrite previously saved documents.

Open **Templates** in the sidebar to load a starter. Replace bracketed author prompts before export; publication prompts are checked by preflight. User templates and snippets are included in workspace backups. Batch `{{VARIABLE}}` substitutions have a separate supported-field contract described below.

## Checkpoints and history

**Document actions → Save checkpoint** (`Ctrl/Cmd+S`) keeps a manual copy in addition to autosave. **Open saved checkpoint** reopens that checkpoint. A checkpoint is local to this browser, not an external backup.

Open a draft's **History** to inspect/compare or restore a prior snapshot. The ring keeps the ten most recent snapshots, captured at most once every three minutes during editing and on explicit saves. Restoring must first commit a safety snapshot of the current state; if that fails, restore stops. Undo/redo concerns the active editing session and is separate from persistent History.

## Portable draft files and imports

Use **Document actions → Export draft (.json)** for an editable portable copy, and the corresponding import action to open one. Draft JSON is **unencrypted**, can embed resolved assets, and does not run the pre-export PII/PHI review used by rendered downloads. Inspect it before transferring it.

**Document actions → Import letter** accepts a PDF or Word file, or choose **Paste letter text**, paste the full letter, and select **Read letter**. Review the recognized fields and document type, then select **Import into editor** to open a new editable document. **Edit pasted text** returns to your text for corrections before importing. Imports preserve the previous open document.

Pasted text does not preserve fonts, images or page layout. Pasting directly into the body editor still creates paragraph blocks rather than importing the whole letter's fields. If no body paragraphs are recognized, review warns you to check the source text and paragraph numbers before importing. Keep the source for comparison: recognition is best effort, and you can correct fields in the editor.

## Password-protected sharing

1. On desktop choose **Share** in the header. On mobile choose **Document actions → Create share link**.
2. Set a password and generate the link. Resolve any content-review warning.
3. If automatic clipboard copying fails, select/copy the displayed link manually or use its Copy control.
4. Send the password through a separate channel. The recipient uses **Document actions → Open from share link** and enters it.

The encrypted link is a snapshot, not a shared live document. Later edits do not update it. No server stores it for revocation, and there is no password-recovery service. Links omit binary attachments/signature images; configured forms also require their exact blank PDF template. Review [capabilities](CAPABILITIES.md) for formats that cannot be shared and [security scope](../SECURITY.md) before transfer.

## Trash and recovered work

Removing a draft moves the complete record and its history to **Trash**. Restore it there or use the immediate Undo action. Trash has no automatic age-based purge; it remains local until you permanently delete it or browser storage is cleared/evicted. Permanent deletion removes the record and history; it is not an undoable edit. Attachment cleanup is separately conservative, so deletion is not a secure-erasure guarantee.

If another tab changes the same document, DonDocs can report a conflict and keep pending edits as a recovery copy. Use **Document actions → Open recovered copies**, compare each copy with the saved version and keep the needed work. Concurrent edits are not automatically merged. If storage is unavailable, export an external draft copy before closing the tab. See [failure and multi-tab rules](STORAGE.md#multi-tab).

## Backup and restore

Open **Settings → Backup & restore** and choose **Download workspace backup**. Keep the JSON file in a location appropriate for its contents: it is **unencrypted** and includes embedded referenced assets. It does not run pre-export text screening.

Before **Restore from backup**, review the per-section policy:

| Section | Restore behavior |
|---|---|
| Saved documents, including Trash | Merge records; newer local document versions win. |
| Profiles, snippets and user templates | Add missing entries; local entries win collisions. |
| Referenced attachments | Add IDs missing locally. |
| Included live NAVMC buffers | Replace local buffers; these buffers lack per-draft timestamps. |
| Routing overrides | Included incoming values win matching keys; local-only entries remain. |
| History and other included form data | Restored under the detailed [backup contract](STORAGE.md#backups); review any partial-restore issues. |

Batch jobs/results, UI preferences, backup file handles and cached blank form PDFs are excluded. Download batch files separately. After restoring configured forms on another device, reconnect, open each form and choose **Save for offline use** for the pinned template revision.

Desktop Chrome/Edge can mirror backups to a file you choose. Registry saves trigger a debounced write; edits confined to profiles/preferences or dormant legacy buffers do not independently update that file. Use a manual backup after those edits. Reconnect permission after browser restart when prompted. A backup error must be resolved before assuming the external copy is current.

## Batch generation

1. Open **Batch** from the toolbar. Add variables through its field picker, or insert `{{NAME}}` into a supported text field. Follow the displayed field limits; not every editor field supports substitution.
2. Choose **Upload Excel roster (.xlsx)** or paste tab-separated rows from a spreadsheet. Excel upload reads only the first worksheet on your device. Preview it, set the **Header row** using the worksheet's row number (or select **No header row**), then choose **Map roster rows**. Rows above the selected header and empty rows are excluded.
3. Map columns to variables and skip columns you do not need. Each variable can use only one column. Apply the mapping, then review and edit the rows. **Roster checks** flag ambiguous text dates, missing variable values, numeric identifiers that may have lost leading zeros and identifiers Excel converted to dates. Excel date cells become `YYYY-MM-DD`; ambiguous text dates stay as entered. Text identifiers, displayed zero-padding and complete General-format numbers are preserved. Lost zeros or rounded digits cannot be recovered automatically. Formula cells use their last saved results, so recalculate and save in Excel first. Uploads support `.xlsx` files up to 10 MB (50 MB expanded), 5,000 worksheet rows, 100 columns and 100,000 cells. Changing the header selection clears its unapplied mapping. Closing the panel discards an unapplied import and preserves existing batch rows.
4. Generate PDFs. The saved job freezes its source document and retained row values; later edits to the editor do not change that job.
5. Closing the panel leaves work running. **Stop after current file** waits for that row; **Cancel current row** cancels the active row where available.
6. Reopen Batch to review saved results, **Resume remaining**, or retry applicable failed rows. Reload recovery uses the saved source/rows rather than the current editor.
7. Download needed results before **New batch**, which clears the old job/results. Workspace backups do not contain them.

Each row's supported source/resolved text and retained values are reviewed. Saved downloads get a fresh review; if source text is missing/unreadable, the UI asks for explicit confirmation. Review attached content yourself: the text scan does not inspect PDF/image bytes. Configured-form batch generation is unavailable; consult the [capability matrix](CAPABILITIES.md) for all formats.

## Export and sign

Choose an available output from Download. PDF enclosure merging and digital signature fields are PDF features; Word has [documented limits](OUTPUT_LIMITS.md). A downloaded TeX fragment needs the repository templates/assets to compile as a project.

For supported PDF formats, choose **Digital field** and sign the downloaded result in your PDF signing application. Typed-only and image-signature styles do not themselves apply a cryptographic signature. Review content, markings and authority before signing.
