/**
 * URL safety for user-provided reference URLs that flow into embedded
 * clickable links in generated PDFs and DOCX files.
 *
 * # Threat model
 *
 * The reference URL field is user-typed in the editor, but the same
 * field also arrives via:
 *
 *   - Imported saved sessions (`.json` upload)
 *   - Encrypted share links (URL fragment payload)
 *   - Loaded templates (built-in or future user-contributed)
 *
 * In any of those flows the value can be attacker-controlled. An
 * attacker who can land a `javascript:`, `data:`, `vbscript:`, or
 * `file:` URI in a reference will get that URI embedded as a clickable
 * `/URI` annotation in the generated PDF. Modern desktop PDF readers
 * sandbox or refuse such schemes, but older readers, mobile in-app
 * viewers, and downstream PDF-processing pipelines vary widely. This
 * module is the chokepoint that prevents dangerous schemes from
 * reaching the output in the first place.
 *
 * # Design
 *
 * **Allowlist, not blocklist.** Anything not explicitly safe is
 * rejected. A blocklist that misses a dangerous scheme is a bug; an
 * allowlist that misses a useful scheme is a feature request.
 *
 * **Strip control characters before validation.** Browsers strip TAB,
 * CR, LF, NULL, etc. from URL schemes during parsing, so
 * `java\tscript:alert(1)` parses as `javascript:alert(1)` to a
 * permissive renderer. We strip and validate the cleaned form, and we
 * emit the cleaned form, so the same string can't reach a downstream
 * parser with the dangerous bytes intact.
 *
 * **`URL` constructor as final correctness gate.** The native parser
 * is strict about malformed URLs in ways our regex can't easily
 * replicate (invalid percent encoding, IDN host normalization, IPv6
 * brackets). If the URL constructor throws, we reject.
 *
 * **Auto-canonicalize bare inputs.** A user typing `marines.mil`
 * obviously means `https://marines.mil`; auto-prefix that. A user
 * typing `[email protected]` obviously means `mailto:[email protected]`;
 * auto-prefix that. A user typing `/orders/MCO-1610.7A` has no base
 * origin to resolve against (PDFs aren't hosted), so reject.
 *
 * # Out of scope
 *
 * - **IDN homograph detection** (`gооgle.com` with Cyrillic letters)
 *   — that's the PDF reader / OS shell's job to surface to the user.
 * - **Open redirect detection / phishing heuristics** — can't be done
 *   reliably without crawling, and false positives are user-hostile.
 * - **DNS / TLS / cert validation** — runs at click time, not
 *   compose time.
 *
 * # Behavior table
 *
 *   safeUrl('https://marines.mil')        -> 'https://marines.mil'
 *   safeUrl('marines.mil')                -> 'https://marines.mil'
 *   safeUrl('//example.com/path')         -> 'https://example.com/path'
 *   safeUrl('[email protected]')           -> 'mailto:[email protected]'
 *   safeUrl('mailto:[email protected]')    -> 'mailto:[email protected]'
 *   safeUrl('javascript:alert(1)')        -> null
 *   safeUrl('data:text/html,<script>...') -> null
 *   safeUrl('file:///etc/passwd')         -> null
 *   safeUrl('vbscript:msgbox 1')          -> null
 *   safeUrl('java\tscript:alert(1)')      -> null  (control char stripped)
 *   safeUrl('JAVASCRIPT:alert(1)')        -> null  (case-insensitive)
 *   safeUrl('/orders/MCO-1610.7A')        -> null  (no base origin)
 *   safeUrl('mailto:foo')                 -> null  (malformed mailto)
 *   safeUrl('https://')                   -> null  (no host)
 *   safeUrl('   ')                        -> null
 *   safeUrl('')                           -> null
 *   safeUrl(null)                         -> null
 *   safeUrl(undefined)                    -> null
 *
 * Issue #17.
 */

/**
 * Schemes we'll embed as clickable links. Anything else is rejected.
 *
 *   - `http`/`https`: standard web links — the overwhelming majority
 *     of references in naval correspondence.
 *   - `mailto`: occasionally used for POC contact in references.
 *
 * Notably NOT included:
 *
 *   - `tel`/`sms`: not used in naval correspondence references; can
 *     be added if a real use case shows up.
 *   - `ftp`/`ftps`: deprecated, often blocked by modern clients.
 *   - `file`: filesystem access — a textbook recipient-side attack
 *     vector if it leaks through.
 *   - `javascript`/`vbscript`/`data`/`blob`/`about`/`chrome*`: all
 *     code-execution or browser-internal schemes.
 */
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto']);

// RFC 3986 scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
// Anchored at start, case-insensitive (callers don't have to lowercase).
const SCHEME_RE = /^([a-z][a-z0-9+\-.]*):/i;

// Loose email pattern — full RFC 5322 grammar is overkill for this
// chokepoint, and the URL constructor doesn't enforce mailto local-part
// shape, so we add a sanity check here. Requires a single @ and a dot
// in the domain side; rejects whitespace and the `?` / `#` characters
// that the URL constructor treats as query / fragment delimiters.
//
// Excluding `?` and `#` is required for idempotence: if we accepted
// them in the local-part, `safeUrl(bareEmail)` would canonicalize to
// `mailto:foo?bar@x.com`, and `safeUrl(thatResult)` would split at
// `?`, validate `mailto:foo` (no `@`), and reject — violating the
// safeUrl(safeUrl(x)) === safeUrl(x) round-trip property the
// canonicalization layer needs to be reliable.
const EMAIL_RE = /^[^\s@?#]+@[^\s@?#]+\.[^\s@?#]+$/;

// Bare host or host/path. Conservative: starts with alphanumeric,
// allows dots/dashes, optional :port, optional /path.
const BARE_HOST_RE = /^[a-z0-9][a-z0-9.-]*(:\d+)?(\/.*)?$/i;

// Control characters that browsers strip from URL parsing, plus all
// Unicode whitespace. Uses `\p{Cc}` (Unicode "Control" general
// category) which covers C0 (U+0000–U+001F), DEL (U+007F), and C1
// (U+0080–U+009F) without putting raw control bytes in source.
const CONTROL_AND_WHITESPACE_RE = /[\s\p{Cc}]/gu;

/**
 * Final correctness gate: does the native URL constructor accept this
 * string? Catches malformed URLs the regex didn't reject (bad percent
 * encoding, invalid IPv6 brackets, empty host, etc.).
 */
function urlConstructorAccepts(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate and canonicalize a user-provided URL for embedding in
 * generated documents. Returns `null` if the URL has an unsafe
 * scheme, looks malformed, or can't be made into a sensible link.
 *
 * Callers should treat `null` as "skip the link entirely" — the
 * reference text itself is still safe to render, just don't make it
 * clickable.
 */
export function safeUrl(input: string | null | undefined): string | null {
  if (!input) return null;

  // Strip whitespace and control chars BEFORE validation. See module
  // doc for why — `java\tscript:alert(1)` defeats a naive scheme
  // check, so we normalize first.
  const cleaned = input.replace(CONTROL_AND_WHITESPACE_RE, '');
  if (!cleaned) return null;

  // Has an explicit scheme?
  const schemeMatch = cleaned.match(SCHEME_RE);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (!ALLOWED_SCHEMES.has(scheme)) return null;

    // Allowed scheme — validate the rest with the URL constructor.
    if (!urlConstructorAccepts(cleaned)) return null;

    // Extra mailto sanity: the URL constructor accepts `mailto:foo`
    // as a valid (if useless) URL. Require a vaguely email-shaped
    // local-part@domain in the path portion.
    if (scheme === 'mailto') {
      // Strip `mailto:` and any `?subject=...&body=...` query.
      const addr = cleaned.slice('mailto:'.length).split('?')[0];
      if (!EMAIL_RE.test(addr)) return null;
    }

    // Extra http/https sanity: must have a non-empty host. The URL
    // constructor accepts `https://` (empty host) in some engines.
    if (scheme === 'http' || scheme === 'https') {
      try {
        const parsed = new URL(cleaned);
        if (!parsed.host) return null;
      } catch {
        return null;
      }
    }

    return cleaned;
  }

  // No scheme — try to canonicalize.

  // Protocol-relative: `//example.com/path` -> `https://example.com/path`.
  if (cleaned.startsWith('//')) {
    const candidate = 'https:' + cleaned;
    return urlConstructorAccepts(candidate) ? candidate : null;
  }

  // Absolute path with no host: PDFs have no base origin to resolve
  // against, so this can't become a valid link. Reject.
  if (cleaned.startsWith('/')) return null;

  // Bare email -> auto-prefix mailto:.
  if (EMAIL_RE.test(cleaned)) {
    const candidate = 'mailto:' + cleaned;
    return urlConstructorAccepts(candidate) ? candidate : null;
  }

  // Bare host or host/path -> auto-prefix https://.
  if (BARE_HOST_RE.test(cleaned)) {
    const candidate = 'https://' + cleaned;
    if (!urlConstructorAccepts(candidate)) return null;
    // Final host non-empty check
    try {
      const parsed = new URL(candidate);
      if (!parsed.host) return null;
    } catch {
      return null;
    }
    return candidate;
  }

  // Doesn't look like anything we can sensibly canonicalize.
  return null;
}
