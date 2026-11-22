# Assigned approval service

Run this optional service on an authorized network with Node.js 22.13 or later.
The public DonDocs web app does not require it. The service stores package
and revision IDs, artifact digests, assignments, decisions and certificate
fingerprints. Deliver the exact saved PDF or portable package separately through
your approved channel. Keep the retained artifact for review and audit.

## Configure the service

Create a private configuration and state directory for a dedicated service
account. Provision client certificates from your approved CA. Map each
certificate's SHA-256 fingerprint to a stable individual identity in the
identities JSON file:

```json
[
  {
    "id": "drafter",
    "fingerprint256": "REPLACE_WITH_COLON_SEPARATED_UPPERCASE_SHA256",
    "canRequest": true,
    "canApprove": false
  },
  {
    "id": "reviewer",
    "fingerprint256": "REPLACE_WITH_COLON_SEPARATED_UPPERCASE_SHA256",
    "canRequest": false,
    "canApprove": true
  }
]
```

Set `database`, `identities`, `key`, `cert` and `ca` to absolute paths in
the server configuration JSON. Set `crl` to the applicable PEM revocation
list when policy requires it. The default listener is `127.0.0.1:7713`.
For a network installation, choose an authorized private listener and set
`host` and `port` explicitly. The endpoint must terminate TLS itself so
it can authenticate each client certificate.

```sh
node tools/approvals/server.mjs /absolute/path/approvals-config.json
```

Rotate client certificates by updating the map and restarting the service.
The previous fingerprints remain in the history. Back up the SQLite database
using a consistent SQLite backup that includes committed WAL changes. Restrict
database and service configuration access to the service operator.

## Use the browser workspace

For an approved deployment, add the exact HTTPS DonDocs origin to the
service's `browserOrigins` allowlist and build that DonDocs installation with
`VITE_DONDOCS_APPROVAL_ORIGIN=https://approvals.example.test:7713`. The
approval service still requires a provisioned client certificate. An empty
allowlist keeps the service available to authenticated non-browser clients.

In a saved package, assemble and retain the PDF in **Delivery**. In
**Review → Approvals**, connect to the service, select that exact PDF, and
enter the ordered approver identities. Send the returned route ID and saved
PDF using the approved channel. Include the editable package for the saved
revision when participants need to open it on another device. A participant
with that revision can enter the route ID to inspect and act on it. An unconfirmed
request can be found by its route ID. In the same browser workspace, retry
with the original assignments and due dates to reuse its ID, even after reload
or in another tab. Start from a new saved revision when the work changes.

The browser sends identifiers, assignments, and the PDF checksum. PDF bytes
stay in the workspace. The service authorizes each decision, delegation,
and cancellation. Choose historical revisions to inspect their own routes.

## Route a saved revision

1. Export the exact package revision and compute SHA-256 on the retained
   artifact. Generate a request UUID. Send JSON to `POST /approvals` with
   `requestId`, `revision` containing `packageId`, `revisionId` and
   `artifactSha256`, plus ordered `assignments` of `assignee` and optional
   UTC `dueAt`. Retrying the same request UUID and content returns that route.
2. Share its returned route ID and retained artifact through your approved
   channel. Requesters and participants can read `GET /approvals/ROUTE_ID`.
   Reviewers check that their local artifact hash matches the recorded digest
   before making a decision.
3. The current assignee submits `approve` or `return` with
   `expectedSequence` and the reviewed `artifactSha256` to
   `POST /approvals/ROUTE_ID`. Approval advances one stage. A return closes
   the route. The requester can submit `delegate` with a new `assignee` or
   `cancel`, using the expected sequence. A stale action requires a fresh read.
4. Create a new request for changed work. The old approval remains tied to its
   original digest. The route read includes the append-only event history.

Use mutual TLS for every request, for example:

```sh
curl --cacert server-ca.pem --cert client.pem --key client.key \
  -H 'Content-Type: application/json' --data-binary @request.json \
  https://approvals.example.test:7713/approvals
```

This service authenticates provisioned client certificates and enforces the
configured assignment roles. The organization defines those roles and decides
which documents may be routed. Database administrators retain administrative
control over the journal. A journal entry is a workflow decision about a
specific artifact and does not apply a PDF signature.

In the browser, **Download approval history** reads the journal again over
the authenticated connection. The JSON copy includes the exact saved revision,
PDF SHA-256, service origin, and the identity, certificate fingerprint and
server timestamp of each event. Keep that copy alongside the PDF or editable
package. The live service remains the source for the current route status.
