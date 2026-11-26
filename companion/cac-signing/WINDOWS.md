# Windows CAC signing proposal

A Windows user should be able to open a signature requirement in Packages, review the exact PDF field, connect their CAC, approve the signature, and save the signed original back to that package member. Standalone forms should use the same helper. The first implementation target is Windows 11 x64, an interactive user session, and an RSA signing certificate on a CAC exposed through the Microsoft Smart Card Key Storage Provider.

## Reuse the current signing path

| Component | Responsibility |
| --- | --- |
| DonDocs web app | Select the package member, revision and field. Display the PDF and collect the user's signing choice. |
| Local Python bridge | Pair with one DonDocs origin, check the edition and field locks, prepare the PDF signature, call the helper and verify the result. The existing DoD trust policy also applies on Windows. |
| Proposed Windows executable | Implement the existing [list and sign contract](README.md). Discover a card-backed identity, show native consent and ask its provider to sign. |
| Windows smart-card provider | Handle reader communication, PIN entry and the private-key operation. |

The browser already calls the loopback bridge, which accepts a helper path. The first prototype can use a Windows executable via the existing `--helper` argument. Keep PDF manipulation, certificate trust and package rules in their existing owners. For distribution, provide a signed per-user launcher that starts the bridge, selects the installed helper and font, and displays its pairing code. Verify the available font, trust bundle and managed-device installation permissions before packaging.

## First prototype

1. **Discover certificates without prompting for a PIN.** Start with a read-only `list` command. Windows can leave a public certificate in the user's Personal store after card removal. Match candidate certificates to a present reader/card and its smart-card provider. Exclude software keys and unrelated hardware such as TPMs. Use the existing lowercase SHA-256 fingerprint of the DER certificate. Return available public issuers for chain building. An unplugged reader should yield no available signing identity. Windows certificate propagation can be controlled by Group Policy. [Certificate propagation](https://learn.microsoft.com/en-us/windows/security/identity-protection/smart-cards/smart-card-certificate-propagation-service) · [Smart-card minidriver overview](https://learn.microsoft.com/en-us/windows-hardware/drivers/smartcard/smart-card-minidriver-overview)
2. **Sign through an interactive Windows helper.** A small C# executable can call the Windows certificate and CNG APIs. Start with the Microsoft smart-card KSP. Handle legacy CSP-only cards as an explicit compatibility case to measure on target machines. Validate the same metadata and stdin limits as the Mac helper. Display the purpose, certificate fingerprint and digest of the exact input in a native confirmation. Reacquire the selected card identity after consent. Hash the input once with SHA-256 and request an RSA PKCS#1 v1.5 signature. Verify the result with the selected public certificate before returning the raw bytes on stdout. Keep PIN handling in the provider and never silently switch identities. [Certificate key acquisition](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-cryptacquirecertificateprivatekey) · [Signing a digest](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptsignhash)
3. **Exercise the package editor.** Start with the existing bridge pairing flow on Edge. Verify that browser permissions and managed-device policy permit access to the local bridge. On cancel, card removal, or an unavailable reader, keep the current package revision and allow retry. Map the helper results to the existing exit codes. Update the bridge's Mac-specific diagnostics and the setup instructions. A user should see the signed revision in Packages only after existing verification succeeds.

## Qualification

| Environment | Evidence to collect |
| --- | --- |
| Mac, available now | Run the existing official-form regression suite with synthetic identities and saved fixtures. It covers the PDF logic shared by both platforms. |
| Windows runner, no card | Build the executable. Exercise JSON and binary pipes, SHA-256 and padding against a synthetic key through a test double, cancellation and empty discovery. Put a software certificate in a disposable store and verify the production discovery path excludes it. Test bridge startup with Windows paths containing spaces. |
| Windows 11 device with a real CAC | Discover the signing certificate with the card inserted, then remove and swap cards between selection and approval. Exercise cancellation at both consent and PIN prompts. Sign Page 11 and the UPB through Packages and verify the selected field, locks, earlier signatures and signed bytes after reopening the package. Compare a returned file in desktop Acrobat. Repeat under the browser and reader policy used on the intended deployment. |

The five existing official-form tests passed on macOS with pyHanko 0.38.2 while preparing this proposal. Windows executable, provider, browser and live-card qualification are pending. Keep real cardholder certificates, PINs, pairing codes and signed personnel documents out of test artifacts.
