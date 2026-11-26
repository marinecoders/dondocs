# Official form signing bridge

Run this local adapter on the computer that holds the CAC. For Windows, follow the [PowerShell setup and qualification instructions](../cac-signing/WINDOWS.md). DonDocs sends the selected PDF revision to loopback. The adapter checks its official edition, reads native field locks, prepares the PDF signature, and invokes the DonDocs CAC executable for card access and native approval. It verifies the incremental result before returning the file. Certificate-chain checks use the supplied DoD CA bundle offline. Revocation information can be unavailable.

On macOS, from this directory, create a Python 3.12 virtual environment, install `requirements.txt`, and run:

```sh
python bridge.py --origin http://127.0.0.1:4399 \
  --helper /absolute/path/to/DonDocsCAC \
  --ca-bundle /absolute/path/to/dod-ca-certificates.pem \
  --font '/System/Library/Fonts/Supplemental/Times New Roman.ttf'
```

Open **Download → Sign official form** in DonDocs. Enter the pairing code shown in the terminal. The browser may request permission to connect to a local device. The bridge binds only to 127.0.0.1:47993, accepts one exact web origin, and issues a new pairing code on restart. Stop it with Ctrl-C. The form catalog lives in `src/data/officialPdfEditions.json` in the same checkout.

Run `python -m unittest` here for the software-certificate qualification. Physical CAC approval and Acrobat interoperability are separate checks.

## Qualified workflows

The editor fills the pinned Page 11 XFA edition and the three-page NAVMC 10132 AcroForm. A maintained action can include `{ kind: 'official-form', key: 'upb', formId: 'navmc10132', role: 'enclosure', required: true }` in its recipe. The forms catalog supplies the draft, original PDF and editor. Each package member owns its answers.

Software-certificate tests exercise repeated signing, native field locks and a first-signature final lock on Page 11. Browser transfer tests compared signed original bytes before and after importing both forms in a separate browser context. Use the portable package or download the signed original to retain verifiable signatures. Combined PDFs contain printable copies. Signed dynamic XFA originals require separate delivery when their appearance cannot be qualified.

For a mixed Acrobat and DonDocs workflow, sign in Acrobat first, open that file with **Signing workspace → Open an official form PDF**, then countersign in DonDocs. Acrobat can rewrite the XFA catalog or a locked AcroForm widget appearance when it signs second. Strict return verification rejects those changes. Automatic association with an unsigned package revision also requires evidence that only the signature changed.

On the May 2014 Page 11, desktop Acrobat can replace the XFA viewer fallback with a printable form when it adds a signature. Both certificate signatures can verify across that rewrite. The bridge reports the change and rejects the return. The regression tests replay desktop Acrobat returns in both signing orders, including a populated training form. With Poppler installed, they also check the printable text before and after countersigning. The fixture certificate is public, synthetic, and trusted only by the tests.
