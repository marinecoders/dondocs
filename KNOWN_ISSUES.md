# Known Issues

## SwiftLaTeX Dollar Sign (`$`) Rendering

**Status:** Open
**Affected:** Standard Letter example (temporarily removed)
**Date Identified:** January 2026

### Problem

SwiftLaTeX fails to compile documents containing dollar signs (`$`) with the error:

```
Font TS1/cmr/m/n/12=tcrm1200 at 12.0pt not loadable: Metric (TFM) file not found
```

The `\$` command in LaTeX requires the Text Companion (TS1) encoding font metrics (`tcrm1200`), which are not included in SwiftLaTeX's bundled fonts.

### Symptoms

- Compilation fails with "Font TS1/cmr/m/n/12 not loadable"
- Error occurs at any `\$` in the document body
- The `escapeLatex()` function correctly converts `$` to `\$`, but SwiftLaTeX cannot render it

### Attempted Solutions

1. Pre-escaping `\$` in source data - caused double-escaping (`\textbackslash{}\$`)
2. Using plain `$` (letting escaper handle it) - still triggers TS1 font error
3. Using "USD" format instead - still fails (may be caching issue)

### Potential Fixes

1. **Add TS1 font metrics to SwiftLaTeX** - Would require modifying the SwiftLaTeX bundle to include `tcrm*.tfm` files
2. **Use math mode for dollar signs** - Replace `\$` with `\text{\$}` wrapped in math mode, but this may have its own issues
3. **Custom macro** - Define a custom `\dollar` command that uses a different approach
4. **Avoid dollar signs** - Use "USD" or spell out currency (workaround, not ideal)

### Workaround

For now, avoid using dollar signs in document content. Use formats like:
- "347.82 USD" instead of "$347.82"
- "three hundred dollars" instead of "$300"

### Files Affected

- `src/data/exampleDocuments.ts` - Standard Letter example removed
- `src/services/latex/escaper.ts` - Contains the `$` to `\$` escaping logic
