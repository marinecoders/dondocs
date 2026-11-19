/** Source-based personal checks: SECNAV M-5216.5 (June 2015, Ch 1 2018),
 * Chapter 2 paragraph 19b(1–11), 19c(1–3), and 19d. Rendered-page questions
 * remain human checks; matching editor values cannot establish their result. */
export const PROOFREAD_MANUAL_CHECKS = [
  { id: 'letterhead', group: 'Framework', label: 'Inspect the letterhead and its alignment.' },
  { id: 'margins', group: 'Framework', label: 'Check the rendered page margins.' },
  { id: 'page-numbers', group: 'Framework', label: 'Check page-number placement and sequence.' },
  { id: 'date-space', group: 'Framework', label: 'Check the space reserved for the date.' },
  { id: 'paragraph-alignment', group: 'Framework', label: 'Inspect paragraph alignment and indentation.' },
  { id: 'paragraph-sequence', group: 'Framework', label: 'Check paragraph numbering and lettering.' },
  { id: 'enclosure-markings', group: 'Framework', label: 'Inspect enclosure markings on the actual pages.' },
  { id: 'line-hyphenation', group: 'Framework', label: 'Inspect successive hyphenated lines and excessive line-end hyphenation.' },
  { id: 'signature-space', group: 'Framework', label: 'Check the space reserved for signatures.' },
  { id: 'header-margin', group: 'Framework', label: 'Inspect the header position.' },
  { id: 'footer-margin', group: 'Framework', label: 'Inspect the footer position.' },
  { id: 'word-review', group: 'Language', label: 'Read slowly and inspect each word, punctuation and spacing.' },
  { id: 'uncertain-words', group: 'Language', label: 'Look up uncertain spelling and hyphenated words.' },
  { id: 'spelling-tools', group: 'Language', label: 'Use spelling and grammar tools alongside your own review.' },
  { id: 'content', group: 'Content', label: 'Read for meaning, accuracy and completeness.' },
] as const;
