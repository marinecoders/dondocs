# Using DonDocs

[Documentation index](README.md) · [Supported outputs](CAPABILITIES.md) · [Known limits](OUTPUT_LIMITS.md)

## Create and reopen a draft

1. Choose **Correspondence** or **Forms**, then a format. Changing category resumes that category's draft rather than converting the open document.
2. Fill the sections shown, or use **Templates** in the sidebar. Use a saved profile for unit/signer defaults. Applying a profile is explicit; reopening an old draft does not borrow a signature from the current profile.
3. Review the preview. For publications, complete the [structured publication workflow](TECHNICAL_PUBLICATIONS.md).
4. Wait for **Saved**. Recents holds saved drafts; search, pin, rename or duplicate one there. A save error means the revision has not been confirmed durable.

On mobile, open the workspace menu for sidebar destinations. Editor **One section** / **Full document** changes the view of the same draft.

Single-signer correspondence shows **formatting suggestions** above the relevant section for saved/imported date formats and extra spaces around a single dotted signature initial. Compare **Current** and **Proposed**, then choose **Apply fix** to change that field only. One **Undo** (`Ctrl/Cmd+Z`) restores the previous value. Inspecting a saved date without editing it preserves its value. Unclear or invalid dates have no Apply button and stay as entered when you leave the field; resolve them with an explicit date or the calendar. Forms, dual-signer documents and publication metadata keep their existing correction tools.

## Profiles and reusable templates

Fill in letterhead/sender details, then open **Profiles** in the sidebar (workspace menu on mobile) and choose **New profile**. Name it, review the unit/address and signer fields, and save. Use **Apply** to review changes to the current correspondence draft, or **Edit** to change saved defaults. A profile does not retroactively rewrite previously saved documents.

Open **Templates** in the sidebar to load a starter. Replace bracketed author prompts before export; publication prompts are checked by preflight. User templates and snippets are included in workspace backups. Batch `{{VARIABLE}}` substitutions have a separate supported-field contract described below.

## Checkpoints and history

**Document actions → Save checkpoint** (`Ctrl/Cmd+S`) keeps a manual copy in addition to autosave. **Open saved checkpoint** reopens that checkpoint. A checkpoint is local to this browser, not an external backup.

Open **History**, select a saved version, and choose **Prepare change report** to download a printable HTML review report. It compares the saved version with the current draft captured when History opened and includes full readable discussions from both versions, including resolved comments and retained context for deleted targets. Review its privacy notice before downloading: removed text and earlier comment context can contain sensitive information. Later edits are excluded. The report states its comparison limits; it is a review derivative, not an official letter, approval record, or audit proof. Clean PDF and Word exports remain separate.

Open a draft's **History** to inspect/compare or restore a prior snapshot. The ring keeps the ten most recent snapshots, captured at most once every three minutes during editing and on explicit saves. Restoring must first commit a safety snapshot of the current state; if that fails, restore stops. Undo/redo concerns the active editing session and is separate from persistent History.

History and change reports follow shared paragraph identities through reordering. A moved paragraph has a separate **Movement** item; its text or formatting edits stay attached to that paragraph. Insertions and deletions do not turn every shifted paragraph into rewritten prose. Position changes and automatic renumbering are described separately, and moves show one minimum reordering consistent with the snapshots, rather than a record of individual editing gestures. Older versions without unique shared identities explicitly fall back to positional comparison. Other repeated rows, including configured-form rows, remain positional. Internal paragraph identities are not printed in comparisons or reports.

## Portable draft files and imports

Use **Document actions → Export draft (.json)** for an editable portable copy, and the corresponding import action to open one. Draft JSON is **unencrypted**, can embed resolved assets, and does not run the pre-export PII/PHI review used by rendered downloads. Inspect it before transferring it.

**Document actions → Import letter** accepts a PDF or Word file, or choose **Paste letter text**, paste the full letter, and select **Read letter**. Review the recognized fields and document type, then select **Import into editor** to open a new editable document. **Edit pasted text** returns to your text for corrections before importing. Imports preserve the previous open document.

Pasted text does not preserve fonts, images or page layout. Pasting directly into the body editor still creates paragraph blocks rather than importing the whole letter's fields. If no body paragraphs are recognized, review warns you to check the source text and paragraph numbers before importing. Keep the source for comparison: recognition is best effort, and you can correct fields in the editor.

## Password-protected sharing

1. On desktop choose **Share** in the header. On mobile choose **Document actions → Create share link**.
2. Set a password, optionally choose **Link expiration**, and generate the copy. Resolve any content-review warning. Expiration starts when the copy is generated; the default is **No expiration**.
3. If automatic clipboard copying fails, select/copy the displayed link manually or use its Copy control.
4. Copies longer than 8,000 URL characters offer **Download encrypted share file**. Send this file instead of a truncated link. The file is available for shorter links too.
5. Send the password through a separate channel. The recipient uses **Document actions → Open from share link**, pastes the link or selects **Encrypted share file**, and enters its password. After decryption, review and open it as a new document.

The encrypted copy is a snapshot, not a shared live document. Later edits do not update it. No server stores it for revocation, and there is no password-recovery service. Native copies include required enclosure/basic-letter PDFs, PNG signature images, and PNG/JPEG figures. Configured-form copies include their captured definition, answers and exact blank template pages. Each resource is checked against its recorded size, type and SHA-256 digest before import; metadata is published only after all required bytes can be retained. Current work remains in Recents. Older configured-form links may still need access to their hosted template revision. Review [capabilities](CAPABILITIES.md) and [security scope](../SECURITY.md) before transfer.

Asset-inclusive copies require an updated reader. Older readers reject their version 4 envelope rather than opening an incomplete document. File limits are 25 MB per attachment, 75 MB total attachment bytes, 256 resources and 110 MB expanded document data. Images and attached PDFs are not automatically inspected for sensitive content; inspect them yourself before sharing. Corruption, missing files, unsupported versions, expired imports and failed storage stop the operation without replacing the current draft. Unused staged attachment bytes are eligible for the normal orphan cleanup.

Expiration is checked by DonDocs using the recipient’s device clock after decryption and again when opening the reviewed document. At the deadline, ask the sender for a new link. Expiring links require DonDocs 1.3.74 or later. This check cannot remove already opened copies or prevent someone with the link and password from extracting the contents. It is not server-side revocation.

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

Batch jobs/results, UI preferences and backup file handles are excluded. Download batch files separately. Current backups include the exact blank PDF pages needed by saved configured forms and their history. Restore verifies and saves those pages before installing workspace records, so a fresh offline browser can reopen the captured forms. Older backups may need a connection and **Save for offline use** to retrieve the pinned template revision.

**Export draft (.json)** also includes a configured form's exact definition, answers and blank pages. Import opens a new document after verifying the complete resource inventory and durable template storage. A missing, corrupt or unsupported page prevents the import and preserves current work. Transfers allow at most 256 resource files, 25 MiB per file and 75 MiB of decoded template bytes; workspace backups retain their existing 100 MB JSON import limit. These files are unencrypted; use encrypted sharing when a password-protected handoff is needed.

Desktop Chrome/Edge can mirror backups to a file you choose. Registry saves trigger a debounced write; edits confined to profiles/preferences or dormant legacy buffers do not independently update that file. Use a manual backup after those edits. Reconnect permission after browser restart when prompted. A backup error must be resolved before assuming the external copy is current.

## Batch generation

1. Open **Batch** from the toolbar. Add variables through its field picker, or insert `{{NAME}}` into a supported text field. Follow the displayed field limits; not every editor field supports substitution.
2. Choose **Upload Excel roster (.xlsx)** or paste tab-separated rows from a spreadsheet. Excel upload reads only the first worksheet on your device. Preview it, set the **Header row** using the worksheet's row number (or select **No header row**), then choose **Map roster rows**. Rows above the selected header and empty rows are excluded.
3. Map columns to variables and skip columns you do not need. Each variable can use only one column. Apply the mapping, then review and edit the rows. **Roster checks** flag ambiguous text dates, missing variable values, numeric identifiers that may have lost leading zeros and identifiers Excel converted to dates. Excel date cells become `YYYY-MM-DD`; ambiguous text dates stay as entered. Text identifiers, displayed zero-padding and complete General-format numbers are preserved. Lost zeros or rounded digits cannot be recovered automatically. Formula cells use their last saved results, so recalculate and save in Excel first. Uploads support `.xlsx` files up to 10 MB (50 MB expanded), 5,000 worksheet rows, 100 columns and 100,000 cells. Changing the header selection clears its unapplied mapping. Closing the panel discards an unapplied import and preserves existing batch rows.
4. Generate PDFs. The saved job freezes its source document and retained row values; later edits to the editor do not change that job.
5. Closing the panel leaves work running. **Stop after current file** waits for that row; **Cancel current row** cancels the active row where available.
6. Reopen Batch to review saved results, **Resume remaining**, or retry applicable failed rows. Reload recovery uses the saved source/rows rather than the current editor.
7. Choose **Download ZIP** to collect the available saved PDFs in one file, or download results individually. The ZIP keeps existing filenames, adjusts names that cannot be extracted on Windows, and adds numbered suffixes for duplicates. Rows without an available PDF are omitted and identified in the panel, including failures, unfinished rows and missing results. If no PDFs are available, no ZIP is downloaded.
8. Download needed results before **New batch**, which clears the old job/results. Workspace backups do not contain them.

Each row's supported source/resolved text and retained values are reviewed. Saved downloads, including ZIP downloads, get a fresh review; if source text is missing/unreadable, the UI asks for explicit confirmation. Review attached content yourself: the text scan does not inspect PDF/image bytes. Configured-form batch generation is unavailable; consult the [capability matrix](CAPABILITIES.md) for all formats.

## Keep an exact review baseline

1. Open native correspondence and choose **Document actions → Review rounds…**.
2. Enter a review name and choose **Start review from current draft**. DonDocs saves
   an independent baseline with its required native attachments. Later edits and
   History cleanup do not replace it.
3. Choose **Prepare reviewer copy**, inspect the text/privacy/marking summary and
   attachment files, then **Download reviewer copy**. This unencrypted JSON file
   includes the complete baseline, comments, signature images, figures and attached PDFs.
4. On another browser, open **Review rounds… → Import reviewer copy** and choose
   **Open as new review copy**. The original source is not replaced. A matching
   checksum checks the file's revision; it does not verify the sender's identity.

Saved baselines remain in the workspace list after their source is permanently
deleted and can be reopened or downloaded there. Workspace backups include them.
Use **Delete review baseline** when a pin is no longer needed; existing editable
copies and downloaded files remain. Review checksums need HTTPS or localhost.
Configured forms and technical-publication reviews are outside this first scope.

## Return feedback to the current draft

1. In a linked reviewer copy, add, reply to, edit or resolve comments as usual.
2. Open **Review rounds… → Prepare feedback return**. Inspect the full discussions,
   retained context, markings and privacy findings before **Download feedback return**.
   The unencrypted JSON contains comments, captured context, explicit suggested replacements
   and handling labels. Other draft edits and attachment files are excluded. Reviewer names are self-entered.
3. In the original draft, choose **Import feedback return**. Check returned and
   proposed discussions. If the drafter and reviewer changed the same message,
   removed an edited discussion, or changed its status concurrently, choose
   **Keep current** or **Use returned** for each conflict. Cancel leaves the draft alone.
4. Choose **Import reviewed feedback**. Newer letter text, fields and attachments
   remain. Feedback for a deleted paragraph stays detached with its captured context;
   DonDocs does not guess a replacement paragraph. Use Undo to restore prior discussions.

Returns must match the original draft's exact review round and baseline. Reopening
an imported file does not duplicate or reapply it, including after Undo. Export a
new return file for subsequent feedback. A checksum detects content changes; it
is not a verified reviewer identity or proof of a handling label's authority.

If Save fails, the feedback remains pending with its receipt. Retry Save before
exporting or closing the tab. If interrupted recovery conflicts with newer saved
work, open the retained recovered copy and keep the original return file. If more
recovery remains after opening copies, reload the same tab to retry it. Keep the
tab open if its recovery format needs a newer compatible version. Workspace
backups preserve committed receipts and review links. Ordinary draft/share/template
copies carry comments without granting review ownership. Suggested replacements and
review decisions require a feedback return or workspace backup; ordinary draft,
share and template transfers do not carry them.

## Propose and decide replacements

In **Review rounds… → Review for suggested edits**, select the baseline belonging
to the current source or linked reviewer copy. Enter a reviewer name, choose one
supported field or complete plain paragraph, and add its proposed replacement.
The baseline and current draft stay unchanged. Partial text ranges, paragraph
moves, tables, figures and structural edits are outside this workflow.

A reviewer returns proposals through **Prepare feedback return**. Importing stores
them as pending suggestions. In the source, select the same review and compare
reviewed, current and proposed values before **Accept suggestion** or **Reject
suggestion**. Acceptance changes only the selected target. A missing target blocks
acceptance. For a changed supported field or plain paragraph, choose **Reconcile
suggestion**. Review the baseline, current and proposed values, then confirm the
**Resolved replacement**. Separate edits within one contiguous span per side may
be combined for review; overlapping edits, boundary insertions and wider changed
spans require a deliberate choice. You can keep the current text, use the proposal
or enter a combined result. Nothing changes until **Apply resolution**, and a newer
edit invalidates the captured resolution. Mechanical groups retain their original
unchanged-target guards. Handling checks may require correcting the current
draft's markings first.

Undo/Redo of an acceptance records its reversal/restoration while that action is
in the current session's history. Reopening a document clears ordinary Undo but
keeps saved proposals and decisions. If saving fails, use **Retry suggestion save**
before closing or exporting. A reconciled acceptance records the exact prior
current text, so Undo restores that text rather than the older review baseline.
Keeping the current text records a decision without adding a text Undo action.
Version 9 workspace backups retain ordinary suggestion history; version 10
preserves reconciled decisions and their prior text. This includes
archived review records after source/copy deletion. Deleting the review
baseline explicitly removes its local proposals and decision history. Reviewer
names and decisions do not establish authenticated approval.

## Propose formatting corrections in a review

Open **Review rounds…**, choose **Review for suggested edits**, then use
**Propose formatting corrections**. These are the existing formatting checks;
this workflow sends their findings for a drafter's decision instead of applying
them to the reviewer copy.

1. Enter a reviewer name. Choose a **Body date audience for review** to include
   body-date findings; DonDocs does not infer the audience from a recipient.
2. Inspect and select corrections. Supported findings include header date format,
   spacing around signature initials, body dates and existing terminal NOTAL
   markers. Ambiguous dates remain advisory. Quotes, code, URLs and placeholders
   keep the protections of the existing checks.
3. Choose **Propose corrections**. Selected spans in the same paragraph become
   one complete paragraph replacement. All selected targets belong to one group;
   creating it leaves the letter text unchanged.
4. From a linked reviewer copy, prepare and download the usual feedback return.
   Inspect its privacy and marking summary: the file includes reviewer names and
   full before/after values of selected fields and paragraphs, including their
   unchanged surrounding text.
5. In the source draft, import the return and inspect the pending group. **Accept
   suggestion** validates every member before changing any text; **Reject
   suggestion** records a decision without applying it. Unrelated newer work is
   kept. One Undo reverses the whole accepted group in the current document
   session; reopening keeps the saved decisions but clears ordinary Undo history.

Reference entries do not have stable editing identities. A NOTAL group can be
accepted only while the entire ordered reference list still matches the reviewed
baseline, including titles, letters and URLs. Propose related reference fixes
together; accepting one changes that list and blocks separate old-baseline
reference proposals. Other overlapping edits also block acceptance; keep the newer
work, reject the proposal or start a fresh review.

A group supports at most 20 distinct fields, paragraphs or reference titles,
with complete values up to 20,000 characters each and an overall text limit.
Larger groups are rejected rather than shortened. Reference ordering and citation
relabeling remain in the existing reference tools; they are not proposed by this
workflow. Clean PDF and Word output omit pending proposals and review metadata.

## Save an action package

Open **Packages** beside document readiness. Name and create a package, then
capture the current native document or add an original PDF. Assign a main/basic
letter, endorsements, coordination, supporting-document and enclosure roles.
The first member must be the single main document. Existing native correspondence
and forms use their existing editors and renderers; uploaded originals support
PDF only. Selecting a role does not create a new document format.

Every change creates a package revision. Reopen earlier revisions to inspect their
members and retained outputs. Removing a member from the current revision preserves
its older content and original files. Rename, duplicate or archive a package from
the same workspace. Archived packages can be reopened for editing.

**Edit working copy** opens a separate draft in Recents. Edit normally, reopen
Packages and choose **Save working copy as new revision**. The library source and
older package revisions keep their own identities. A working copy is outside the
saved package until that explicit save. **Compare newer source** shows the captured
member beside its library source; **Adopt source as new revision** deliberately
captures the reviewed source. Imported source IDs are foreign provenance and do
not automatically bind to documents on the receiving browser.

**Check readiness and assemble** checks preserved bytes, required native fields,
citations, deployment policy and supported native endorsement relationships.
Review every member and original PDF, including text inside images that automated
inspection cannot read. Missing or corrupt required content blocks assembly.
Package enclosure labels are separate from the continued main/endorsement sequence;
matching literal `enclosure (1)` citations are checked when a native document has
no embedded enclosure list. Mixed embedded/package citation numbering requires
manual editing. Linked citation relabeling and package review rounds come later.

Assembly retains the exact combined PDF, checksum and member page boundaries.
Preview and retained download read those same bytes. An assembled PDF is an
unsigned derivative; a signed original remains a separate unchanged file.
Retrieving an older artifact is distinct from rendering it again with a later
renderer. Every download or preview receives a new policy/content review.

**Export editable package** transfers only the selected revision, its original
files, exact form templates and retained outputs. Import that file through
**Import editable package** in a fresh browser with the app available offline.
Native members can be opened as working copies without their original library
sources. Portable transfer allows 256 resources, 25 MB per resource and 75 MB total;
a native draft resource includes its embedded attachments, so those bytes count
inside its 25 MB limit. The JSON file is limited to 100 MB. Package files are
unencrypted. Workspace backups preserve every retained revision in version 12;
ordinary package delivery does not include removed members or older revisions.
Keep an intact transfer/backup when storage fails. Corrupt package inventory never
becomes an empty workspace, and an aborted save preserves the last committed
revision. Cancel or close the package dialog to stop an unfinished operation.

## Export and sign

Choose an available output from Download. PDF enclosure merging and digital signature fields are PDF features; Word has [documented limits](OUTPUT_LIMITS.md). A downloaded TeX fragment needs the repository templates/assets to compile as a project.

For supported PDF formats, choose **Digital field** and sign the downloaded result in your PDF signing application. Typed-only and image-signature styles do not themselves apply a cryptographic signature. Review content, markings and authority before signing.
