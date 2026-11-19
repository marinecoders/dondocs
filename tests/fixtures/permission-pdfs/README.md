# Permission-protected PDF regression fixtures

All content is synthetic. `source.pdf` contains two labeled pages and red shapes;
page 2 has a 90-degree rotation. `source-cropped.pdf` has a 540 × 648 point crop and a 270-degree rotation; `owner-cropped.pdf` encrypts that same source. The files contain no personal or official data.
`receipt.json` records their SHA-256 digests. `red.png` is the two-pixel rendering
stand-in used by unit tests; browser checks use the real PDF.js worker.
`red.jpg` is a synthetic JPEG control for preserved native image encoding.
`corrupt-image.pdf` contains a deliberately unreadable JPEG stream;
`corrupt-image-owner-aes.pdf` encrypts that same source with an empty opening
password and the synthetic owner password below. A real PDF.js render can
complete while dropping this image, so the application must inspect its decoded
image dependencies. `printable-stamp.pdf` contains a synthetic red printable
stamp appearance that page embedding alone would omit.
`valued-field-missing-appearance-owner-aes.pdf` contains a synthetic text field
requiring regenerated appearances; it must be rejected rather than flattened
with an empty value. `xfa-only-owner-aes.pdf` contains synthetic XFA data and
blank static fallback content; hardened rendering must reject the unsupported
form. Both use the same empty opening/synthetic owner passwords.

The encrypted PDFs were produced with qpdf from the same source:

```sh
qpdf --encrypt '' synthetic-owner-password 256 --modify=none --extract=n --print=full -- source.pdf owner-aes.pdf
qpdf --allow-weak-crypto --encrypt '' synthetic-owner-password 128 --use-aes=n --modify=none --extract=n --print=full -- source.pdf owner-rc4.pdf
qpdf --encrypt synthetic-open-password synthetic-owner-password 256 -- source.pdf opening-password.pdf
```

The first two have empty opening passwords and an owner password, with editing and text extraction disabled while printing remains allowed. The last
requires an opening password. Unit tests exercise both assembly paths, resource
limits and cancellation. The attachment browser checks verify explicit image-copy
confirmation, cancellation, retry and original-byte retention after reload.
