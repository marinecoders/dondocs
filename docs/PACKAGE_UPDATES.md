# Shared package updates

`preparePackageUpdate` receives the desired complete information and binding snapshots. Omitting either removes that metadata; callers editing only information must supply the existing bindings. Preparation owns a validated copy, reads captured native drafts, and stages replacement bytes in memory. It does not install templates, open an editor, or write storage.

The preview distinguishes field replacements, unchanged values, local overrides, unavailable targets, independent-edit conflicts, and detached links. Existing link identities cannot be retargeted. Replace a link with a new identity when choosing another field or shared value. Unrelated stale links remain available for diagnosis while another value is edited.

Applying requires the issued preview, explicit review, the same resolved deployment policy, and the exact unchanged saved package. The package revision and all replacement draft assets commit in one transaction. Cancellation, a stale owner, or storage failure leaves the prior complete package intact. No-op previews cannot publish revisions.

Qualified scalar updates preserve raw embedded resources and narrative identities. Citation occurrences are rebound only when their captured content still matches; a package-enclosure target whose content changed remains stale for deliberate repair. Existing outputs, review baselines, signing handoffs, and historical document bytes remain tied to their original revisions.

Undo uses an in-memory receipt and creates another saved revision. It preserves the applied revision in history, rechecks current deployment policy, and refuses to overwrite intervening work. After reload, use saved revision history to inspect earlier content; the in-memory Undo receipt is intentionally unavailable.
