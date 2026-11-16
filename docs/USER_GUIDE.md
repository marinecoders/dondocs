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

Handling checks include retained fields, definition text and attachment filenames. A hidden preview keeps its error without interrupting a share import; request the preview to inspect that error.

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
7. Choose **Download ZIP** to collect the available saved PDFs in one file, or download results individually. The ZIP keeps existing filenames, adjusts names that cannot be extracted on Windows, and adds numbered suffixes for duplicates. Rows without an available PDF are omitted and identified in the panel, including failures, unfinished rows and missing results. If no PDFs are available, no ZIP is downloaded. ZIP preparation supports at most 500 retained files, 25 MB per PDF and 64 MB of combined PDF bytes, with a 66 MB archive cap and a conservative 256 MB assembly estimate that includes filename/header overhead. Memory use depends on the browser; this estimate is an admission budget, not a measured heap guarantee. Filenames must fit 255 UTF-8 bytes. Exceeding a budget stops the entire archive rather than silently leaving out oversized files. Your saved results remain available for individual download.
8. Download needed results before **New batch**, which clears the old job/results. Workspace backups do not contain them.

Each row's supported source/resolved text and retained values are reviewed. Saved downloads, including ZIP downloads, get a fresh review; if source text is missing/unreadable, the UI asks for explicit confirmation. Review attached content yourself: the text scan does not inspect PDF/image bytes. Configured-form batches map roster columns directly to supported fields, including multiple selections, with typed row checks and exact retained definitions and template pages. Each row supplies its own answers; source answers are not inherited. Signature fields remain blank for signing after export. For multiple-selection fields, enter a JSON array such as `["approve","notify"]`, using the displayed option IDs or unique labels. Review the normalized selections beneath each cell. `[]` selects none; required fields still need a selection. Repeated or unknown options are rejected. For a repeating group, use its group ID as a roster column and enter a JSON array of answer objects, such as `[{"name":"Example","active":true}]`. The field list shows column IDs and printed row capacity. Review normalized rows beneath each cell; unknown fields, wrong types and overflow block generation. Blank cells and `[]` supply no rows and never copy saved source rows. See [form roster formats and limits](FORM_TEMPLATES.md#configured-form-roster-mapping). Consult the [capability matrix](CAPABILITIES.md) for all formats.

## Classify review feedback

Comments and suggested replacements can be labeled **Edit**, **Question**, or
**Required correction**. Filter by category in the comments or suggested-edits
workspace. Older feedback remains **Unclassified** until deliberately categorized;
DonDocs does not infer reviewer intent. Categories travel with supported draft,
backup and review-return files. A required correction is a reviewer request, not
an authenticated approval requirement, and it never applies text automatically.

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

## Download review decisions

In **Review rounds**, choose **Prepare decision summary** on the round associated
with the open source draft or linked reviewer copy. Preparation saves pending
work and captures the round, current draft, suggestions, decision history and
readable discussions. Review the handling/privacy notice, then choose
**Download reviewed decision summary (.html)**. The printable file identifies its
captured baseline and draft; later edits are excluded.

Accepted, rejected, open and conflicting totals count each suggested-edit group
once. Open and resolved discussion totals are separate. Undo returns an accepted
item to open or conflicting; Redo restores its acceptance. Earlier accepted
resolutions remain visible even when the current draft has changed. Reviewer
labels are self-entered. This review derivative is not an authenticated approval
record, and it does not include attached PDF/image contents or feedback that has
not been imported into this local draft.

## Manage review round status

In **Review rounds**, the open source draft can **Close review**, deliberately
**Reopen review**, or choose a newer active round and **Supersede review**. State
history and earlier baselines remain retained. Superseded rounds cannot be
reopened. Refresh the rounds list after changes made in another tab.

Closed and superseded rounds reject new suggestions, decisions and feedback
imports. Keep late return files: reopen a closed round deliberately or ask the
reviewer to return feedback for the replacement. Previously imported files remain
recognized without applying them twice. Existing Undo/Redo may record reversals of
earlier accepted edits; closure does not disable ordinary document history.
Received copies show only their captured status, not a live or authenticated
status from the sender. Status and state history travel with current reviewer
copies and workspace backups; importing a copy never changes a local owner's
established state. For a received baseline, a later copy or backup can advance
the same retained state history. Older copies cannot roll it back, and conflicting
state histories are rejected.

## See changes since a reviewer checkpoint

In **Review rounds → Since you last reviewed**, select the review and enter a
reviewer label. **Mark current view reviewed** saves that captured text and feedback
state. Select the saved marker explicitly on later visits, then choose **Show
changes since checkpoint** to inspect later document changes and feedback outcomes.
Names do not identify authenticated people, and a marker does not approve anything.
Without a selected marker, DonDocs reports that the earlier review point is unknown.

A comparison is captured when requested; request it again after further edits.
Native paragraph identities distinguish position changes from wording edits. File
names and metadata are compared, not attachment contents. Checkpoints contain
comparison text, cannot restore a draft, and retain earlier wording after it is
removed from the source. Marking a view again replaces only that reviewer's marker.
Each round supports 25 markers with a combined 2 MB limit.

**Prepare checkpoint file** runs the text/privacy/marking review before downloading
an unencrypted JSON marker. **Import reviewer checkpoint** checks its checksum and
exact round/baseline binding, previews the marker, and requires an explicit import
before replacing the same reviewer's marker. Import preserves document text and
review decisions. Current reviewer-copy files and workspace backups also retain
markers. Captured marking contexts and raw retained values remain part of the
export checks even when the baseline has a lower marking. DonDocs reloads the
deployment policy before downloading a checkpoint or reviewer copy.
Receiving another copy preserves local-owner state and existing comparison
markers; compatible received state history can advance as described above.
Keep a separate checkpoint file when deliberately moving a marker
between workspaces that already have the same round.

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
For a selected word or sentence, choose its paragraph, highlight complete
characters in **Select text in reviewed paragraph**, then choose **Use selected
text** and enter the replacement. **Cancel replacement** discards the unsent
proposal. The baseline and current draft stay unchanged. Selected replacements
support plain native text in one paragraph; formatted text, variables, headings,
markings, tables, figures and structural edits are excluded. The full paragraph
context travels with the selected range and is included in handling/privacy checks.

To type suggested changes naturally, turn on **Suggest Changes mode**, choose a
supported **Paragraph for suggested typing**, and edit **Suggested paragraph text**.
Caret typing, Backspace, Delete, complete-character selections, plain-text paste
and input-method composition create an **Unsaved suggested changes** preview. The
preview distinguishes insertion, deletion and replacement and shows the exact
reviewed span and proposed text. Separate edits in the same paragraph become one
replacement of the entire displayed span, including unchanged text between them.
Input coordinates identify repeated text; the editor never searches for matching
words. Reverting part of a draft can leave a wider displayed span. Review that
span before saving. There is no independent per-edit reconciliation in this mode.

**Save typed suggestion** submits one proposal for the entire typing session;
keystrokes do not create separate proposals. After submission, the editor shows
the baseline again and the saved proposal appears below. **Cancel typed changes**
discards unsaved typing. Save or cancel before changing paragraphs, switching mode
or reviews, preparing a return, or closing the review dialog. The browser also
warns before leaving a page with unsaved typing; unsaved drafts are held only in
this open editor and are not recovered after closing the tab. Unsupported input
is visibly refused and retains the last valid suggested text. This mode supports
plain paragraphs against the exact reviewed baseline. It does not track structural
edits, variables or formatting. Ordinary authoring outside this mode is unchanged.
Reviewer names remain self-entered and do not authenticate identity.

A reviewer returns proposals through **Prepare feedback return**. Importing stores
them as pending suggestions. In the source, select the same review and compare
reviewed, current and proposed values before **Accept suggestion** or **Reject
suggestion**. Acceptance changes only the selected target. A missing target blocks
acceptance. A selected replacement checks its stable paragraph ID, exact reviewed
paragraph context and selected span, then changes only that span. Changed context
blocks acceptance; reject it or start a new review. Repeated text is identified by
its captured offsets, never by searching for matching words. For a changed supported field or plain paragraph, choose **Reconcile
suggestion**. Review the baseline, current and proposed values, then confirm the
**Resolved replacement**. Separate edits within one contiguous span per side may
be combined for review; overlapping edits, ambiguous repeated text, boundary insertions and wider changed
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

Open **Packages** beside **Templates** in workspace navigation. Name and create a package, then
capture the current native document or add an original PDF. Assign a main/basic
letter, endorsements, coordination, supporting-document and enclosure roles.
The first member must be the single main document. Existing native correspondence
and forms use their existing editors and renderers; uploaded originals support
PDF only. Selecting a role does not create a new document format.
Native publication PDF figures keep their original bytes. Long member labels are
shortened for display; original filenames remain intact in editable transfers.

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
manual editing unless explicit citation links establish the intended targets. Supported linked reordering is described below; package review rounds remain planned.

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
inside its 25 MB limit. The JSON file is limited to 100 MB. These editable JSON
packages are unencrypted. Workspace backups preserve every retained revision in version 12;
ordinary package delivery does not include removed members or older revisions.
Keep an intact transfer/backup when storage fails. Corrupt package inventory never
becomes an empty workspace, and an aborted save preserves the last committed
revision. Cancel or close the package dialog to stop an unfinished operation.

### Send an encrypted action package

Select the revision to send, then choose **Share encrypted package**. Review the
listed members, original files, privacy findings and classification markings,
acknowledge the review, and enter a password. Only that revision and its captured
assets and retained PDFs are included; other revisions and unsaved working copies
are excluded. The transfer preserves the selected revision’s captured binary
assets, including any signature images and retained PDFs. PDF text review covers
native enclosure files, basic-letter attachments and PDF figures as well as
separate package members and retained output. Inspect every included file; images
and scanned pages still need manual review.

Choose no expiration, one hour, 24 hours or seven days, then generate the package.
Copy the encrypted link when it fits within the 8,000-character URL limit, or
choose **Download encrypted package file**. Larger packages require the file.
Send the password separately. Passwords and decrypted review content stay in
memory; they are not saved as settings or included in the link or file.

Recipients can use **Open from share link** for either form, or select the
encrypted file in **Import editable package**. Decryption opens a complete
package review. **Open reviewed package** validates and installs the package,
then selects it in Packages without replacing the active document. Closing the
review installs nothing. Plain editable package imports remain supported.

The optional deadline is authenticated inside the encrypted payload and checked
again when the reviewed package is installed. Expiry uses the device clock; it
cannot revoke an opened copy or prevent a password holder extracting its contents.
An expired share must be regenerated by its sender. Package JSON remains limited
to 100 MB, expanded share plaintext to 110 MB, and encrypted payloads to 140 MB
(with a small JSON wrapper allowance for encrypted files). The existing per-asset
and total-resource package limits still apply. PDF review is cancellable and
limited to 500 pages, 200,000 text items, two million text characters and 45 seconds
per file; exceeding a limit blocks this encrypted handoff. A changed saved package or
deployment policy requires a new review before sending.

## Export and sign

Choose an available output from Download. PDF enclosure merging and digital signature fields are PDF features; Word has [documented limits](OUTPUT_LIMITS.md). A downloaded TeX fragment needs the repository templates/assets to compile as a project.

For a saved action, open **Packages**, select the saved revision, and choose **Review Word package**. Review its captured content, privacy/marking findings and original files, then choose **Download reviewed Word package**. The ZIP contains an editable main DOCX, separate DOCX files for other supported native correspondence, and unchanged original PDFs, enclosures and supported images. `README.txt` identifies the main document; `manifest.json` lists member roles, order, captured member revisions, file sizes and SHA-256 digests. The download uses those captured bytes even if a library source changes later.

Every listed enclosure needs a captured original file. Missing, corrupt or unreadable required content blocks a complete Word package; attach the missing file and save a new package revision. Word packages support native correspondence with existing Word export support and original PDF members. Deliver native forms/publications through the separate editable package export, or add their original PDFs as supporting members. The Word ZIP includes the selected revision’s delivered content and original files; comments, suggestions, older revisions and retained assembled PDFs are excluded.

Original PDF pages and signing fields stay in separate files. Review the DOCX in Word and complete signing through your organization’s Word signing process. A visual signature image is not a certificate signature, and a DOCX derivative inherits no original signature or approval. Word and PDF pagination can differ. The ZIP is unencrypted; its manifest checks file integrity without authenticating the sender.

For supported PDF formats, choose **Digital field** and sign the downloaded result in your PDF signing application. Typed-only and image-signature styles do not themselves apply a cryptographic signature. Review content, markings and authority before signing.


### Identify package references and enclosures

Open **Packages**, select the current saved revision, and use **Identify current
references and enclosures**. This creates durable target identities for each
supported native reference, each native enclosure, and each package member whose
role is enclosure. Native enclosure labels come from that document's own list, including endorsement
continuation offsets;
package enclosure numbers count only enclosure-role members in package order.

Under **Citation occurrence**, choose an explicit reference or enclosure citation
in a native correspondence paragraph or heading, then select its intended target
and choose **Save citation link**. The current printed label must match that
target; references and native enclosures must belong to the citing document's own
list. Quoted text, code and URLs are not editable citation occurrences. A bare
“(a)” does not establish a reference citation. Paragraphs without unique stable
identities cannot be linked.

Every identity or link save creates a new package revision. Captured documents,
original signed files and historical revisions stay unchanged. IDs and hashes
survive editable package transfer and backups; they grant no authority over a
foreign library document. Metadata retains no copied titles or paragraph text.

With citation identities present, package **Move up** / **Move down** opens a
**Citation reorder review** before saving. For a native document's references or
enclosures, use **Native member to reorder**, choose the list, arrange its items,
and select **Review native list reorder**. Review the proposed order, before/after
paragraph text, privacy findings and markings; approve, then select **Save reviewed
citation reorder**. Cancel leaves the saved package unchanged.

Supported explicit linked citations update together with list labels in one new
package revision. Reference case, repeated occurrences, UTF-16 text positions and
endorsement continuation offsets are preserved. Native enclosure files and original
signed PDFs retain their exact bytes. An affected unlinked citation, quoted/code/URL
citation, ambiguous enclosure list/range, stale link or conflicting save blocks the
operation instead of partially updating text. Expand lists/ranges into individually
linked citations or correct unsupported text in a working copy first. Preview is
limited to two million before/after text characters.

A changed or removed member, changed literal or mismatched binding remains stale
or missing until deliberately repaired. Older revisions remain readable; a same-title
item is never assumed to be the original target. Historical and archived revisions
show identity details without editing controls.

The registry supports at most 1,000 targets and 2,000 links per revision. Source
offsets use UTF-16 editor positions, checked against full-field and selection
SHA-256 hashes and never across a surrogate pair. Unsupported metadata or a stale
save is rejected without replacing the last complete revision.


### Repair linked package citations

A tracked citation whose source text or target changed is shown under **Citation
repair**. A changed visible label also needs repair. These findings prevent a
package from becoming ready for assembly; they do not rewrite the document or
change an older package revision. Unlinked literal citations still need manual
review.

Choose **Link to repair**, select the exact **Current citation occurrence**, and
choose its intended **Replacement citation target**. Only supported explicit
reference/enclosure clauses outside quoted text, code and URLs are selectable.
A native reference or native enclosure belongs to the citing member's own list;
package enclosures use the package enclosure sequence. **Review citation repair**
shows the chosen occurrence and target and any visible label change. Acknowledge
the preview, then **Save reviewed citation repair** to create a new revision.
Other current links retain their exact bindings through a supported label edit.
A changed or missing binding is never resolved by a matching title or nearby text.

**Review discarding link** removes only the selected link after explicit
acknowledgement. Its text stays unchanged and unverified; remove or correct that
literal separately where needed. Unused target identities can be removed through
**Remove unused identities**. A target still used by any link cannot be removed.
Cancelling a review, changing packages, a stale save, or a failed save leaves the
previous package revision intact. Original signed files and retained historical
PDFs remain unchanged.
