# DonDocs CAC signing companion

A macOS command-line executable for applications that need a signature from a
connected PIV-compatible CAC. Build it with `swift build -c release` and invoke
`.build/release/DonDocsCAC` as a subprocess.

## List identities

`DonDocsCAC list` writes a JSON array to stdout. Each entry contains the
lowercase SHA-256 `fingerprint` of the DER certificate, the base64 DER
`certificate`, and a `chain` of available base64 DER issuer certificates.
An empty array means discovery succeeded and found no available supported identities.
An unexpected Keychain error fails the command before it writes the list. The caller selects an identity and
checks certificate usage, trust, and revocation for its application.

## Sign bytes

Invoke `DonDocsCAC sign '<JSON metadata>'` and write the message bytes to stdin.
Close stdin after the final byte. A version 1 request has three required fields:

| Field | Meaning |
| --- | --- |
| `version` | The integer `1`. |
| `certificateSHA256` | A 64-character lowercase hexadecimal fingerprint from `list`. |
| `purpose` | A short, single-line description from the caller for the native consent dialog, up to 160 UTF-8 bytes. |

Metadata is limited to 4 KiB. Supply 1–16,384 message bytes. The companion
shows the caller's purpose, the selected certificate, and a SHA-256 hash
computed over those exact bytes. On approval it rechecks the selected identity
and uses RSA PKCS#1 v1.5 with SHA-256. The card operation hashes the supplied
message. The caller should supply the bytes required by its signature format.

Read stdout as binary on success. Read stderr for a diagnostic on error.
Use the exit status for program logic. Discard any partial output on failure.
If stdout closes during delivery, the companion exits with status 1. For a
signing request, the card may already have produced the signature.

| Status | Result |
| --- | --- |
| 0 | Success. JSON for `list`, raw signature bytes for `sign`. |
| 1 | Signing or local system failure. |
| 2 | User canceled. |
| 3 | Selected card or identity unavailable. |
| 4 | Unknown command, invalid metadata, or invalid payload size. |

The caller owns document formats, the meaning of the request, and storage of
the result. The private key stays on the card.

## Tests

Run `swift test` with Xcode and a Swift 6 toolchain.
For standalone Command Line Tools, use the bundled Swift Testing runtime:

```sh
dev="$(xcode-select -p)/Library/Developer"
swift test --disable-xctest -Xswiftc -F -Xswiftc "$dev/Frameworks" \
  -Xlinker -F -Xlinker "$dev/Frameworks" -Xlinker -rpath -Xlinker "$dev/Frameworks" \
  -Xlinker -rpath -Xlinker "$dev/usr/lib"
```
