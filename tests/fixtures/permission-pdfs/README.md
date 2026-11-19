# Permission-protected PDF regression fixtures

All content is synthetic. `source.pdf` contains two labeled pages and red shapes;
page 2 has a 90-degree rotation. `source-cropped.pdf` has a 540 × 648 point crop and a 270-degree rotation; `owner-cropped.pdf` encrypts that same source. The files contain no personal or official data.
`receipt.json` records their SHA-256 digests. `red.png` is the two-pixel rendering
stand-in used by unit tests; browser checks use the real PDF.js worker.
`red.jpg` is a synthetic JPEG control for preserved native image encoding.

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
