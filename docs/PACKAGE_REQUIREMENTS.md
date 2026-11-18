# Package evidence requirements

A requirement can name a captured document or record a user's confirmation. An unassigned document requirement stays as a slot in package metadata. It does not create a blank PDF or a placeholder document.

Requirements apply separately to starting a review, assembling a PDF, and exporting an editable package. Missing evidence for PDF assembly can remain in an editable draft when no editable-transfer requirement blocks that operation. Workspace backups retain incomplete requirements, including requirements that would block ordinary editable delivery.

Document evidence passes its requirement check only when the assigned member exists in that revision and its captured files are intact. Native drafts must match their saved model and include their required embedded resources and exact form templates. Original PDFs must contain readable PDF structure and at least one page. These checks establish captured-file integrity, not whether the document proves the requested facts or has been approved.

A confirmation records what the user declares. False and unanswered confirmations remain unresolved. They do not establish approval, signature authority or independent verification. An unknown condition remains unresolved for every operation to which that requirement applies. Inactive conditions preserve existing assignments and files.

`PackageRequirementsPanel` inspects saved or unapplied assignments for a selected operation. Choose an existing captured member or record a declaration, review the changes and save a new revision. Saving incomplete choices remains possible. Document completeness, citations and deployment policy still receive their own checks when delivering the package.

`PackageRevision.requirements` stores declarations and assignments without a cached satisfied flag. Runtime inspection reads the actual captured resources. Stable requirement identities keep their definition, kind and person across revision history; materialization preserves an assignment or declaration only when those identities still match. Labels, provenance and retained inactive declarations receive privacy and deployment review during delivery.

Declarations are bounded to 500 items and 256 KB per revision, with an 8 MB combined limit across retained revisions and review baselines. Review rounds preserve the exact requirements captured in their baseline. Editable transfers and backups preserve missing slots so work can continue in another browser.
