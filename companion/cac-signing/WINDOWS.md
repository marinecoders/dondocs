# Windows CAC signing

DonDocs uses the same local signing workspace for standalone official forms, correspondence, and package members. The Windows helper uses the existing bridge and runs in the interactive user’s session. The implementation targets x64 Windows 11 and RSA document-signing certificates exposed by the Microsoft smart-card providers.

## Run from a checkout

Install Python 3.12 x64, connect the CAC reader, and obtain your organization’s DoD CA bundle in PEM format. Include the issuing intermediates and the applicable pinned DoD root. From the repository root, run in PowerShell:

```powershell
py -3.12 -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r .\companion\official-form-signing\requirements.txt
& .\.venv\Scripts\python.exe .\companion\official-form-signing\bridge.py --origin https://dondocs.marines.dev --ca-bundle 'C:\path\to\dod-ca-certificates.pem'
```

Replace the bundle path. To use a local build, supply its exact origin, including the port. The bridge reads Times New Roman from the Windows Fonts directory by default. Use `--font` if it is installed elsewhere. Leave the terminal open while signing. Ctrl+C stops the bridge.

## Sign in DonDocs

1. On Page 11 or the UPB, open **Download → Sign official form**. For standalone correspondence, choose **Download → Sign correspondence with CAC** to append a signature sheet to the reviewed PDF. In Packages, open the member’s signing action or select its outstanding signature in Delivery. The signing workspace can also reopen a supported PDF.
2. Review the field and page. Click **Connect CAC**, enter the pairing code from the terminal, and allow the browser’s local-network permission if prompted. The bridge listens on the loopback interface at port 47993 and accepts requests from the configured origin.
3. Choose the document-signing certificate and the intended field. Review locking options, approve the native prompt, and enter the PIN in the Windows provider if requested. The helper rechecks the selected certificate after consent and verifies the returned signature. DonDocs verifies the PDF revision before accepting it.
4. Download the signed original or transfer the portable package to retain its signatures. A combined package PDF is a printable copy. Generic PDFs with manually placed boxes use the existing external signing handoff.

## Verification

The helper discovers certificates in the inserted card’s reader-scoped store. The card provider performs the private-key operation. The bridge uses its configured DoD bundle to validate the chain offline, so revocation status can be unavailable. [Microsoft smart-card architecture](https://learn.microsoft.com/en-us/windows/security/identity-protection/smart-cards/smart-card-architecture) · [Smart-card certificate store](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-cryptgetprovparam)

From the repository root run the helper tests with the same virtual environment:

```powershell
& .\.venv\Scripts\python.exe -m unittest discover -s companion/cac-signing/windows
& .\.venv\Scripts\python.exe -m unittest discover -s companion/official-form-signing
```

The Windows signing workflow runs on a native Windows Server runner. It checks both RSA provider paths with ephemeral keys and pairs the browser with the production helper when the reader is empty. Browser signing tests use a temporary identity and trust authority confined to the test process.

Physical qualification requires an interactive Windows 11 PC, the intended managed browser, a reader, and a CAC. Check the PIN prompt, cancellation, and removal and replacement of the card. Sign a synthetic Page 11 and UPB, countersign a permitted second field, and reopen the portable package. Use an independent PDF validator to check both signatures, their fields, and their lock state.
