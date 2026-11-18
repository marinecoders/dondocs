# Package relationships

Use **Package relationships** in Packages to declare how confirmed package values should relate. Confirm values in **Package information** first. Existing linked-field checks continue to inspect native document values and deliberate local overrides.

## Declare a relationship

Choose a label, scope and two confirmed values. Supported relationships are:

- **Values must match:** compares the same value type. Identifiers and text remain exact; leading zeros, case and spacing matter. Decimal comparison preserves precision while treating equivalent decimal representations alike.
- **First date on or before second date:** compares two valid package dates, including equal dates.

A package-wide relationship uses package-wide values. A person-specific relationship can use that person’s values and common package values. Values belonging to another person are excluded. DonDocs does not infer that separate recipients, requesters or approvers should have matching names or identifiers.

**Check declared relationships** inspects the saved values against the current declarations. Findings identify the exact package values and their linked document fields. **Inspect** opens the corresponding value or field; missing values remain unavailable rather than redirecting to a different target.

## Save and handle conflicts

Changes remain local until you review and save them. Saving creates a new package revision; it does not rewrite historical documents, files, declarations or review baselines. Unapplied relationship changes protect the current workspace from being closed or switched accidentally.

A required conflict or unresolved value blocks starting a review and assembling a PDF. Optional conflicts remain warnings. Editable transfer can preserve unfinished relationship work, subject to its other evidence and disclosure checks.

For a resolved conflict, enter a reason and choose **Add exception to changes**. The exception records a local decision for the exact relationship, values, source descriptions and person context. It is not an approval. Changes to that context make the saved exception inapplicable. An exception cannot waive a missing value, incompatible type or incorrect person scope.

To change a relationship’s operands, relation or person, remove it and declare a new one. Its label and required flag can be edited directly; those changes also require reviewing any saved exception again.

Historical declarations can be inspected read-only. Their original values and exceptions remain associated with that exact revision. Relationship data survives portable transfer, workspace recovery and exact package review copies. Labels and retained exception reasons are included in disclosure review.

## Supported scope

Relationships use confirmed package information. They do not guess at unlinked narrative text, read missing evidence into existence, infer signing authority or compare unrelated people automatically. Declarations are bounded to 100 relationships and 100 exceptions, 256 KB per saved revision and 8 MB across retained package and review history.
