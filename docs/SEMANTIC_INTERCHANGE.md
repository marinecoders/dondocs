# DonDocs semantic interchange v1

The companion can wrap a DonDocs draft or a portable export of one saved
package revision in a versioned JSON file. The original portable payload is
retained, including its resources.

```sh
npm run --silent companion:interchange -- schema
npm run --silent companion:interchange -- pack dondocs-draft.json interchange.json
npm run --silent companion:interchange -- unpack interchange.json restored-draft.json
```

Use the existing DonDocs draft or package importer to open the restored file.
The command creates new files and refuses to replace an existing path.

V1 indexes paragraph IDs and displayed designators for naval letters. For a
selected package revision it indexes the package, revision, and ordered member
IDs and roles. Other drafts retain their complete portable payload with a
source-only index. The compatibility object lists these limits. Workspace
draft IDs, earlier package revisions, and package working copies are outside
the ordinary portable exports.

An optional final argument to `pack` accepts an assertions JSON file with
`lifecycle` (`draft`, `issued`, `superseded`, or `withdrawn`) and an
`issuanceReferences` array. These are supplied by the author. Consumers should
treat them as assertions. The SHA-256 integrity field covers the envelope and
its portable payload using sorted JSON object keys and retained array order.
It provides no authentication or proof of official submission. The unpacker
recomputes the index from the validated portable payload and rejects an
unsupported version or any disagreement.
